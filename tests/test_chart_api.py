"""Stage 9.2: GET /api/chart, the data of the React dashboard's Chart tab.

What is held here:
  * the candles are the market's own: the last 5M candle is the one the scenario table says (not one the engine said), times are the candle starts in epoch seconds, ascending and unique
  * every timeframe is served (1m, 5m, 15m, 1h, 1d); `limit` is honoured and bounded; a daily candle carries its IST day and is one per day
  * what is drawn on them is what Prism already says: the EMAs end at the Analysis tab's EMAs, the swings are exactly the confirmed pivots of the drawn candles, the previous-day levels are the
    previous session's own high, low and close, the setups are the decision's own (trigger, entry area, invalidation, targets) and only the decision's setup is in focus
  * the candle still forming is drawn only when it is newer than every closed one, and never for the daily chart
  * a read changes nothing (also covered, over the routes, in test_reads_do_not_write.py) and reaches no database, broker or order
  * what cannot be drawn is said, not invented: before the history is in there are no candles and a reason; a candle with a price that is not a number is left out and counted"""

import asyncio
import json
import math
import re
from datetime import date
from pathlib import Path

import pytest
from helpers import CFG, FRI, MON, SPOT_TOKEN, THU, Clock, ist, sample_contracts
from test_phase2_integration import live_md, stream
from test_phase3_integration import World
from test_rest_websocket_consistency import http_get, strict

from app import analysis as an
from app import chart
from app.candles import Candle
from app.engine import MarketData
from app.main import create_app

SLOT = 19  # the slot that confirms the Trend Pullback: the BUY CE
FRI_DATE = date(2026, 11, 6)


@pytest.fixture(scope="module")
def world():
    return World()


@pytest.fixture(scope="module")
def buy(world):
    """The engine at the moment of the BUY CE, evaluated once (the way the ticker does it)."""
    md, clock = world.engine()
    out = world.step(md, clock, SLOT)
    assert out["decision"]["action"] == "BUY CE"
    return md, out


def served(md):
    app = create_app(md, feed=None)
    app.state.md = md
    return app


# -- the candles -----------------------------------------------------------------------------------------------------------------------------------
def test_the_last_5m_candle_is_the_one_the_market_made_and_its_time_is_its_start(world, buy):
    md, _ = buy
    out = chart.view(md, "5m", 300)
    c = out["candles"][-1]
    assert (c["open"], c["high"], c["low"], c["close"]) == pytest.approx(world.rows[SLOT])  # the scenario table's candle (10:50), not the engine's
    assert c["time"] == ist(10, 50, day=FRI) and "date" not in c
    assert out["available"] and out["timeframe"] == "5m" and out["seconds"] == 300 and out["session_date"] == "2026-11-06"
    assert out["window"] == {"returned": 300, "held": out["window"]["held"], "limit": 300, "first": out["candles"][0]["time"], "last": c["time"]}


@pytest.mark.parametrize("tf", ["1m", "5m", "15m", "1h", "1d"])
def test_every_timeframe_is_served_ascending_and_one_candle_per_time(buy, tf):
    md, _ = buy
    out = chart.view(md, tf, 400)
    times = [c["time"] for c in out["candles"]]
    assert out["available"] and out["timeframe"] == tf and len(times) >= 10
    assert times == sorted(set(times)), "ascending, and no time twice"
    assert all(math.isfinite(c[k]) and c["low"] <= c["high"] for c in out["candles"] for k in ("open", "high", "low", "close"))
    if tf == "1d":
        dates = [c["date"] for c in out["candles"]]
        assert dates == sorted(set(dates)) and all(re.fullmatch(r"\d{4}-\d\d-\d\d", d) for d in dates)
    else:
        assert all("date" not in c for c in out["candles"])
        step = chart.SECONDS[tf]
        assert all(t % step == (ist(9, 15) % step) for t in times)  # every candle starts on its timeframe's grid, anchored at 09:15


def test_the_last_completed_hour_is_the_one_whose_four_quarters_are_all_in(world, buy):
    md, _ = buy
    last = chart.view(md, "1h", 50)["candles"][-1]
    assert last["time"] == ist(9, 15, day=FRI)  # at 10:55 the 10:15 hour still waits for its 11:00 quarter: it is not drawn, and no short hour is invented
    assert chart.view(md, "15m", 50)["candles"][-1]["time"] == ist(10, 30, day=FRI)


def test_limit_is_honoured_bounded_and_always_the_most_recent_candles(buy):
    md, _ = buy
    whole = chart.view(md, "5m", 300)["candles"]
    few = chart.view(md, "5m", 25)
    assert few["candles"] == whole[-25:] and few["window"]["returned"] == 25 and few["window"]["limit"] == 25
    assert chart.view(md, "5m", 1)["window"]["limit"] == 10 == len(chart.view(md, "5m", 1)["candles"]) and chart.MIN_LIMIT == 10
    big = chart.view(md, "1m", 10**6)
    assert big["window"]["limit"] == chart.MAX_LIMIT and len(big["candles"]) == big["window"]["returned"] == chart.MAX_LIMIT < big["window"]["held"]  # (this market holds more 1M candles than the cap)


def test_a_window_larger_than_what_is_held_says_so(buy):
    md, _ = buy
    out = chart.view(md, "1d", 500)
    assert out["window"]["returned"] == out["window"]["held"] < 500
    assert any("holds" in n and "1d candles" in n for n in out["notes"]) and any("Daily candles come from" in n for n in out["notes"])


def test_two_daily_candles_on_one_day_are_one_bar_and_the_last_wins():
    md = MarketData(CFG, Clock(ist(10, 0, day=FRI)))
    day = lambda h, price: Candle(ist(h, 0, day=THU), ist(h, 0, day=THU) + 86400, price, price + 2, price - 2, price + 1, 0, source="db")  # noqa: E731
    md.set_history({"1m": [], "5m": [], "15m": [], "1d": [day(0, 100.0), day(1, 200.0)]}, {"state": "ready", "error": None}, current_date=FRI_DATE, loaded_at=ist(10, 0, day=FRI))
    out = chart.view(md, "1d", 50)
    assert [(c["date"], c["open"]) for c in out["candles"]] == [("2026-11-05", 200.0)] and out["forming"] is None


# -- what is drawn on the candles --------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("tf", ["1m", "5m", "15m", "1h"])
def test_the_ema_lines_end_where_the_analysis_tab_says_they_end(buy, tf):
    md, _ = buy
    out = chart.view(md, tf, 300)
    facts = md.analysis()["timeframes"][tf]
    for n in chart.EMAS:
        line = out[f"ema{n}"]
        assert line and line[-1]["time"] == out["candles"][-1]["time"] and line[-1]["value"] == pytest.approx(facts[f"ema{n}"])
        times = [p["time"] for p in line]
        win = min(out["window"]["held"], an.WINDOW)  # the engine's window; an average of n has no value before its n-th candle
        first = max(0, (n - 1) - (win - len(out["candles"])))  # the first drawn candle with a value under it
        assert times == [c["time"] for c in out["candles"]][first:] and times, (n, first)  # a point under every candle from there on, and none where there is no value
    assert out["facts"]["ema20"] == facts["ema20"] and out["facts"]["trend"] == facts["trend"] and out["facts"]["atr14_intraday"] == facts["atr14_intraday"]


def brute_pivots(candles, k=2):
    """The definition of a confirmed pivot, written out: a high above the k candles before it and not below the k after it (lows mirrored)."""
    out = []
    for i in range(k, len(candles) - k):
        h, low = candles[i]["high"], candles[i]["low"]
        if all(h > c["high"] for c in candles[i - k : i]) and all(h >= c["high"] for c in candles[i + 1 : i + 1 + k]):
            out.append((i, "H", candles[i]["time"], h))
        if all(low < c["low"] for c in candles[i - k : i]) and all(low <= c["low"] for c in candles[i + 1 : i + 1 + k]):
            out.append((i, "L", candles[i]["time"], low))
    return [(t, kind, p) for _, kind, t, p in out][-chart.MAX_SWINGS :]


@pytest.mark.parametrize("tf", ["1m", "5m", "15m"])
def test_the_swings_are_exactly_the_confirmed_pivots_of_the_candles_drawn(buy, tf):
    md, _ = buy
    out = chart.view(md, tf, 300)
    expected = brute_pivots(out["candles"])
    assert expected, "the market has pivots to find (or this test proves nothing)"
    assert [(s["time"], s["kind"], s["price"]) for s in out["swings"]] == expected
    assert out["swings"][-1]["time"] < out["candles"][-2]["time"]  # a pivot needs two later candles: none is on the last two


def test_daily_swings_sit_on_their_day():
    import market as MK

    md = MarketData(CFG, Clock(ist(10, 0, day=FRI)))
    days = MK.sessions_before(FRI, 14)
    peaks = [100, 104, 112, 105, 101, 106, 118, 107, 102, 108, 115, 109, 103, 107]  # a zig-zag: highs at days 2, 6 and 10, lows between
    daily = [Candle(ist(0, 0, day=d), ist(0, 0, day=d) + 86400, h - 2, h, h - 4, h - 1, 0, source="db") for d, h in zip(days, peaks)]
    md.set_history({"1m": [], "5m": [], "15m": [], "1d": daily}, {"state": "ready", "error": None}, current_date=FRI_DATE, loaded_at=ist(10, 0, day=FRI))
    out = chart.view(md, "1d", 50)
    expected = brute_pivots(out["candles"])
    assert {k for _, k, _ in expected} == {"H", "L"} and len(expected) >= 4
    assert [(s["time"], s["kind"], s["price"]) for s in out["swings"]] == expected
    by_time = {c["time"]: c["date"] for c in out["candles"]}
    assert all(s["date"] == by_time[s["time"]] for s in out["swings"])  # a swing sits on its IST day, as the candle does
    assert out["facts"] is None and out["ema20"] == [] and len(out["candles"]) == 14  # (the engine reads no daily trend; 14 days are too few for a 20-day average)


def test_the_previous_day_levels_are_the_previous_sessions_own_high_low_and_close(world, buy):
    md, _ = buy
    thursday = [c for c in world.m1 if ist(9, 15, day=THU) <= c.start < ist(15, 30, day=THU)]
    pd = chart.view(md, "5m", 50)["levels"]["previous_day"]
    assert (pd["date"], pd["pdh"], pd["pdl"], pd["pdc"]) == ("2026-11-05", max(c.high for c in thursday), min(c.low for c in thursday), thursday[-1].close)
    assert chart.view(md, "5m", 50)["levels"]["session_open"] == pytest.approx(world.rows[0][0]) and chart.view(md, "5m", 50)["levels"]["session_date"] == "2026-11-06"


def test_support_is_under_the_price_and_resistance_over_it_and_both_are_the_analysis_own(buy):
    md, _ = buy
    out, a = chart.view(md, "5m", 50), md.analysis()
    assert out["levels"]["support"] == a["levels"]["support"] and out["levels"]["resistance"] == a["levels"]["resistance"] and out["price"] == a["price"]
    assert all(x["price"] < out["price"] for x in out["levels"]["support"]) and all(x["price"] > out["price"] for x in out["levels"]["resistance"])


@pytest.fixture(scope="module")
def ranged():
    """A sideways market: 28 sessions of a triangle wave around 24000, with the price in the middle of the range, so there are levels on both sides of it."""
    import market as MK

    md = MarketData(CFG, Clock(ist(10, 0, day=FRI)))
    m1 = MK.chain(MK.sessions_before(FRI, 28), MK.oscillation(28 * 375, 24000.0, 150.0))
    md.set_history(MK.to_history(m1), {"state": "ready", "error": None}, current_date=FRI_DATE, loaded_at=ist(10, 0, day=FRI))
    return md


def test_the_nearest_levels_are_on_the_right_side_of_the_price_and_come_from_the_analysis(ranged):
    out, a = chart.view(ranged, "15m", 100), ranged.analysis()
    sup, res = out["levels"]["support"], out["levels"]["resistance"]
    assert sup and res, "the market has levels on both sides of the price (or this test proves nothing)"
    assert (sup, res) == (a["levels"]["support"], a["levels"]["resistance"])
    assert all(x["price"] < out["price"] for x in sup) and all(x["price"] > out["price"] for x in res)
    assert all(set(x) == {"price", "touches"} and x["touches"] >= 1 for x in sup + res)


def two_setups(md):
    """The decision's own answer with a second, different live setup added to it: what the chart draws when two strategies have a setup at once."""
    t = json.loads(json.dumps(md.safe_trading()))
    other = json.loads(json.dumps(t["setups"][0]))
    other.update(id="range_bounce:bear:1", strategy="range_bounce", strategy_name="Range Bounce", direction="PE", side="bear", trigger=24300.0, zone=[24290.0, 24300.0], invalidation=24310.0)
    other["plan"] = {"targets": []}
    t["setups"].append(other)
    return t


def test_only_the_decisions_setup_is_in_focus_when_there_are_two(buy, monkeypatch):
    md, _ = buy
    crafted = two_setups(md)
    monkeypatch.setattr(md, "safe_trading", lambda: crafted)
    out = chart.view(md, "5m", 50)
    assert [(s["id"], s["focus"]) for s in out["setups"]] == [(crafted["setups"][0]["id"], True), ("range_bounce:bear:1", False)]
    assert out["setups"][1]["targets"] == [] and out["setups"][1]["direction"] == "PE" and out["setups"][1]["zone"] == [24290.0, 24300.0]


def test_when_the_decision_names_no_setup_none_is_in_focus(buy, monkeypatch):
    md, _ = buy
    crafted = two_setups(md)
    crafted["decision"] = {**crafted["decision"], "action": "WAIT", "setup_id": None}
    monkeypatch.setattr(md, "safe_trading", lambda: crafted)
    out = chart.view(md, "5m", 50)
    assert [s["focus"] for s in out["setups"]] == [False, False] and out["decision"] == {"action": "WAIT", "setup_id": None}


def test_the_setup_on_the_chart_is_the_decisions_own_and_is_the_one_in_focus(buy):
    md, trading = buy
    out = chart.view(md, "5m", 50)
    (s,), (t,) = out["setups"], trading["setups"]
    assert out["decision"] == {"action": "BUY CE", "setup_id": t["id"]} and s["focus"] is True
    for k in ("id", "strategy", "strategy_name", "direction", "side", "status", "stage", "stage_text", "actionable", "trigger", "invalidation", "detected_at", "confirmed_at"):
        assert s[k] == t[k], k
    assert s["zone"] == list(t["zone"]) and s["status"] == "CONFIRMED" and s["actionable"] is True
    assert s["targets"] == [{"n": x["n"], "price": x["price"], "label": x["label"]} for x in t["plan"]["targets"]]


def test_a_setup_that_is_not_the_decisions_is_drawn_but_not_in_focus(world):
    md, clock = world.engine()
    out = world.step(md, clock, 16)  # the pullback has come down into the zone: detected, no decision yet
    view = chart.view(md, "5m", 50)
    assert [x["status"] for x in view["setups"]] == ["DETECTED"] and out["decision"]["action"] == "WAIT"
    assert [x["focus"] for x in view["setups"]] == [out["decision"]["setup_id"] == view["setups"][0]["id"]]
    assert view["decision"]["action"] == "WAIT"


def test_before_any_evaluation_there_is_no_setup_and_no_decision_to_draw(world):
    md, clock = world.engine()
    from market import to_history

    now = world.clock_after(SLOT)
    clock.t = now
    md.set_history(to_history([c for c in world.m1 if c.end <= now]), {"state": "ready", "error": None}, current_date=FRI_DATE, loaded_at=now)
    out = chart.view(md, "5m", 50)
    assert out["available"] and out["candles"] and out["setups"] == [] and out["decision"] == {"action": "NO TRADE", "setup_id": None}


# -- the forming candle ------------------------------------------------------------------------------------------------------------------------------
def test_the_candle_still_forming_is_drawn_when_it_is_newer_than_the_closed_ones():
    md, clock = live_md()
    assert chart.view(md, "1m", 50)["forming"] is None  # no tick yet
    stream(md, clock, ist(9, 15, day=MON), ist(9, 16, 5, day=MON))
    out = chart.view(md, "1m", 50)
    f = out["forming"]
    assert out["candles"][-1]["time"] == ist(9, 15, day=MON) and f["time"] == ist(9, 16, day=MON) > out["candles"][-1]["time"]
    assert f["open"] == f["high"] == f["low"] == f["close"] == 24226.0 and f["ticks"] >= 1 and "partial" in f and f["time"] not in [c["time"] for c in out["candles"]]
    assert chart.view(md, "5m", 50)["forming"]["time"] == ist(9, 15, day=MON)
    assert chart.view(md, "1d", 50)["forming"] is None  # today's daily bar is not built from ticks
    md.builder.current[(SPOT_TOKEN, "1d")] = Candle(ist(9, 15, day=MON), ist(9, 15, day=MON) + 86400, 1.0, 2.0, 0.5, 1.5)  # (and if the builder ever held one, it would still not be drawn)
    assert chart.view(md, "1d", 50)["forming"] is None


def test_a_forming_candle_that_is_not_newer_than_the_last_closed_one_is_not_drawn():
    md, clock = live_md()
    stream(md, clock, ist(9, 15, day=MON), ist(9, 16, 5, day=MON))
    last = chart.view(md, "1m", 50)["candles"][-1]["time"]
    forming = md.builder.current[(SPOT_TOKEN, "1m")]
    forming.start = last  # (a candle that starts where a closed one already is)
    assert chart.view(md, "1m", 50)["forming"] is None


# -- what is left out, and what cannot be drawn ------------------------------------------------------------------------------------------------------
def test_before_the_history_is_in_there_is_nothing_to_draw_and_the_reason_is_said():
    md = MarketData(CFG, Clock(ist(9, 10, day=MON)))
    out = chart.view(md, "5m", 100)
    assert out["available"] is False and out["candles"] == [] and out["setups"] == [] and out["forming"] is None and out["timeframe"] == "5m"
    assert "still loading" in out["reason"]
    json.dumps(out, allow_nan=False)


def test_a_candle_with_a_price_that_is_not_a_number_is_left_out_counted_and_the_answer_is_still_json():
    md, clock = live_md()
    bad = md.history["5m"][-1]
    bad.high = float("nan")
    md.history_version += 1  # (the history changed: the analysis is built again)
    out = chart.view(md, "5m", 100)
    assert bad.start not in [c["time"] for c in out["candles"]] and any("1 candle(s)" in n for n in out["notes"])
    json.dumps(out, allow_nan=False)


def test_clean_turns_a_number_that_json_cannot_hold_into_none_at_any_depth():
    got = chart.clean({"a": float("nan"), "b": [1.5, float("inf"), {"c": -float("inf")}], "d": (2.0, None, "x"), "e": 3})
    assert got == {"a": None, "b": [1.5, None, {"c": None}], "d": [2.0, None, "x"], "e": 3}


def test_an_unknown_timeframe_is_refused_by_the_function():
    md, _ = live_md()
    with pytest.raises(ValueError, match="timeframe must be one of"):
        chart.view(md, "2m")


# -- the route ---------------------------------------------------------------------------------------------------------------------------------------
def get(app, path):
    r = asyncio.run(http_get(app, path))
    return r["status"], (strict(r["body"]) if r["status"] == 200 else r["body"])


def test_the_route_answers_for_every_timeframe_and_defaults_to_5m_and_300_candles(buy):
    md, _ = buy
    app = served(md)
    status, body = get(app, "/api/chart")
    assert status == 200 and body["timeframe"] == "5m" and body["window"]["limit"] == chart.DEFAULT_LIMIT == 300
    for tf in chart.TIMEFRAMES:
        status, body = get(app, f"/api/chart?timeframe={tf}&limit=60")
        assert status == 200 and body["timeframe"] == tf and len(body["candles"]) == min(60, body["window"]["held"])
    assert body == chart.view(md, "1d", 60)  # (the route adds nothing and takes nothing away)


@pytest.mark.parametrize("query", ["timeframe=2m", "timeframe=", "timeframe=1D", "limit=abc", "limit=1.5", "limit="])
def test_a_query_that_is_not_understood_is_refused_not_guessed(buy, query):
    status, body = get(served(buy[0]), f"/api/chart?{query}")
    assert status == 422


def test_the_route_cannot_write_and_there_is_no_other_way_to_it(buy):
    md, _ = buy
    app = served(md)
    routes = [(sorted(r.methods), r.path) for r in app.routes if getattr(r, "path", "") == "/api/chart"]
    assert routes == [(["GET"], "/api/chart")]


# -- the module reaches nothing but memory ---------------------------------------------------------------------------------------------------------------
SOURCE = (Path(__file__).resolve().parent.parent / "app" / "chart.py").read_text(encoding="utf-8")


def test_the_module_reads_memory_and_nothing_else():
    imports = sorted(set(re.findall(r"(?m)^(?:from|import)\s+(\S+)", SOURCE)))
    assert imports == [".", ".candles", ".engine", ".series", "datetime", "math"], imports
    assert not re.search(r"psycopg|requests|SmartApi|smartapi|\.journal|journal\.|load_db|fill_gap|place|order|\.post\(|open\(|\.write", SOURCE, re.I)
    assert "reading()" in SOURCE and "md.trading(" not in SOURCE  # the decision is only ever read
