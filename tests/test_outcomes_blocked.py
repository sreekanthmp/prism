"""The near-miss review (`python -m app.outcomes --blocked`): what the setups Prism did NOT call ready would have done, replayed like the ones it did. Hand-made journal records and candles only; READ-ONLY.

The question behind it: Prism says WAIT most of the time, so are its rules too strict? A setup whose confirming candle had closed, with the price inside its entry area, but which something held back (the room
rule, the size of the risk, the data, the session, the volatility) was never offered. What is held here:

  * the entry is the FIRST moment it would have been ready but for what held it back (confirming candle closed, price inside the entry area, edges included), with the price and levels shown then
  * only setups that NEVER became ready count (one that was later called ready is a ready one), and one held back with its price never in the area is listed, not replayed
  * what held it back is told from the words of its blockers, in each kind, and a setup with no blocker words is the session or the data
  * the replay is the ready one's (target 1, invalidation, Prism ending it, the close), a long and a short, and `run` is the best the price did before the invalidation, whatever else happened
  * the tallies by what held them back, next to the ones called ready; several days at once, then together; the single-day output is unchanged"""

import json
from datetime import date

import pytest
from helpers import FRI, MON, ist
from test_outcomes import ended, flat, rec, setup, write_journal

from app import outcomes
from app.outcomes import blocker_kinds, group_by_kind, lifecycles, main, merge, review, summarise

ROOM = "only 18.0 pts to the next level 25,018.00 (under 1x the 37.3 pts at risk)"


def t(h, m, s=0, day=FRI):
    return ist(h, m, s, day=day)


def bars(*rows, day=FRI):
    return [(t(h, m, day=day), o, hi, lo, c) for h, m, o, hi, lo, c in rows]


def held(sid="trend_pullback:bull:7", direction="CE", zone=(25000.0, 25023.0), trigger=25000.0, inv=24962.7, targets=(25018.0, 25060.0), blockers=(ROOM,), stage="BLOCKED", name="Trend Pullback"):
    return {"id": sid, "strategy": sid.split(":")[0], "strategy_name": name, "direction": direction, "stage": stage, "zone": list(zone) if zone else None, "trigger": trigger, "invalidation": inv,
            "blockers": list(blockers), "plan": {"targets": [{"n": i + 1, "price": p} for i, p in enumerate(targets)]}}  # fmt: skip


def with_session(r, entries_allowed=True):
    r["session"] = {"phase": "morning", "entries_allowed": entries_allowed}
    return r


def near(records, candles=None):
    rep = review(records, candles, blocked=True)
    return rep["blocked"], rep


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 1. The entry
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def test_a_room_blocked_setup_in_its_entry_area_is_replayed_like_a_ready_one_and_says_what_held_it_back():
    records = [rec(t(10, 0, 20), 25010.0, [held()])]
    candles = bars((10, 1, 25010, 25012, 25005, 25011), (10, 2, 25011, 25019, 25008, 25015), (10, 3, 25015, 25060, 25012, 25055), (10, 4, 25055, 25058, 24960, 24965))
    (b,), rep = near(records, candles)
    assert (b["kind"], b["kinds"], b["blockers"]) == ("room", ["room"], [ROOM]) and b["entry"] == 25010.0 and b["ready_at"] == t(10, 0, 20)
    assert b["risk"] == pytest.approx(25010 - 24962.7) and b["target1"] == 25018.0 and b["target2"] == 25060.0
    assert b["outcome"] == "target1" and b["exit_at"] == t(10, 2) and b["r"] == pytest.approx(8 / 47.3)  # the near level (18 pts from the trigger) was reached: a small win
    assert b["run_r"] == pytest.approx(50 / 47.3) and b["target2_reached"] is True  # ... and the price went on to run more than 1 R before the stop, which is what the rule was keeping out of
    assert rep["setups"] == []  # it was never called ready


def test_the_entry_is_the_first_moment_in_the_area_not_an_earlier_one_below_it_or_a_later_one_above_it():
    records = [rec(t(9, 58, 0), 24990.0, [held()]), rec(t(10, 0, 20), 25010.0, [held()]), rec(t(10, 1, 0), 25030.0, [held()])]  # below the zone, inside it, above it
    (b,), _ = near(records, bars(flat(10, 2, 25010)))
    assert b["entry"] == 25010.0 and b["ready_at"] == t(10, 0, 20)


@pytest.mark.parametrize("price, inside", [(25000.0, True), (25023.0, True), (25011.5, True), (24999.99, False), (25023.01, False)])
def test_the_edges_of_the_entry_area_are_inside_it(price, inside):
    items, rep = near([rec(t(10, 0, 20), price, [held()])], bars(flat(10, 1, price)))
    assert bool(items) is inside and bool(rep["blocked_not_in_area"]) is (not inside)


def test_a_short_is_the_mirror_image():
    records = [rec(t(10, 0, 20), 24990.0, [held("breakout_retest:bear:3", "PE", zone=(24977.0, 25000.0), trigger=25000.0, inv=25037.3, targets=(24982.0, 24940.0), name="Breakout and Retest")])]
    candles = bars((10, 1, 24990, 24995, 24975, 24980), (10, 2, 24980, 24984, 24981.5 - 3.5, 24982), (10, 3, 24982, 24985, 24930, 24935), (10, 4, 24935, 25040, 24930, 25030))
    (b,), _ = near(records, candles)
    assert b["direction"] == "PE" and b["entry"] == 24990.0 and b["risk"] == pytest.approx(25037.3 - 24990.0)
    assert b["outcome"] == "target1" and b["exit_price"] == 24982.0 and b["r"] == pytest.approx(8 / 47.3)
    assert b["run_r"] == pytest.approx((24990 - 24930) / 47.3)  # the best the SHORT did before 25,037.3 was touched


def test_a_setup_held_back_with_its_price_never_in_the_area_is_listed_and_not_replayed():
    items, rep = near([rec(t(10, 0, 20), 25100.0, [held()]), rec(t(10, 5, 0), 24950.0, [held()])], bars(flat(10, 6, 25000)))
    assert items == [] and rep["blocked_not_in_area"] == [{"id": "trend_pullback:bull:7", "strategy": "trend_pullback", "strategy_name": "Trend Pullback", "direction": "CE"}]


def test_a_setup_that_was_held_back_and_later_called_ready_is_a_ready_one_not_a_near_miss():
    records = [rec(t(10, 0, 20), 25010.0, [held()]), rec(t(10, 10, 0), 25012.0, [setup("trend_pullback:bull:7", stage="READY_TO_ACT", inv=24962.7, targets=(25060.0,))])]
    items, rep = near(records, bars(flat(10, 11, 25020)))
    assert items == [] and [r["id"] for r in rep["setups"]] == ["trend_pullback:bull:7"] and rep["setups"][0]["entry"] == 25012.0 and rep["blocked_not_in_area"] == []


def test_a_ready_setup_that_was_blocked_afterwards_is_not_a_near_miss_either():
    records = [rec(t(10, 0, 20), 25010.0, [setup("a:bull:1", stage="READY_TO_ACT", inv=24962.7)]), rec(t(10, 3, 0), 25012.0, [held("a:bull:1")])]
    assert near(records, bars(flat(10, 4, 25012)))[0] == []


def test_stages_that_are_not_blocked_are_never_near_misses():
    for stage in ("DETECTED", "WAITING_FOR_CONFIRMATION", "CONFIRMED", "INVALIDATED", "EXPIRED"):
        assert near([rec(t(10, 0, 20), 25010.0, [held(stage=stage)])], bars(flat(10, 1, 25010)))[0] == [], stage


@pytest.mark.parametrize("bad_zone", [None, [], [25000.0], [None, 25023.0], ["a", "b"]])
def test_a_record_with_no_usable_zone_or_price_is_skipped_not_fatal(bad_zone):
    s = held()
    s["zone"] = bad_zone
    assert near([rec(t(10, 0, 20), 25010.0, [s]), rec(t(10, 1, 0), None, [held("x:bull:2")])], bars(flat(10, 2, 25010)))[0] == []


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 2. What held it back
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("text, kind", [
    ("only 20.8 pts to the next level 25,276.15 (under 1x the 37.2 pts at risk)", "room"),
    ("invalidation only 6.1 pts away (under 0.5x ATR5): inside normal noise", "risk"),
    ("invalidation 105.6 pts away (over 1.5x ATR15): the entry is too far from the structure", "risk"),
    ("volatility is unusually high (15M ATR 2.3x its average)", "volatility"),
    ("opening range forming: no entries before 09:30", "session"),
    ("late session: no new entries after 14:45", "session"),
    ("before the market opens (09:15)", "session"),
    ("the market is closed", "session"),
    ("historical data is stale: today's refresh has not completed", "data"),
    ("5M candles missing 12:10-13:05 (inside the last 12 candles)", "data"),
    ("15M: not enough completed candles to classify yet", "data"),
    ("the live feed has stopped (auth_failed): restart Prism after fixing it", "data"),
    ("no live connection for 42 s (feed down)", "data"),
    ("the clock cannot be trusted: PC clock jumped", "data"),
    ("something nobody has written a pattern for", "other"),
])
def test_what_held_a_setup_back_is_told_from_the_words_of_its_blocker(text, kind):
    assert blocker_kinds([text]) == [kind]


def test_several_blockers_make_several_kinds_sorted_and_named_together():
    records = [rec(t(10, 0, 20), 25010.0, [held(blockers=(ROOM, "5M candles missing 12:10-13:05 (inside the last 12 candles)", "volatility is unusually high (15M ATR 2.3x its average)"))])]
    (b,), _ = near(records, bars(flat(10, 1, 25010)))
    assert b["kinds"] == ["data", "room", "volatility"] and b["kind"] == "data + room + volatility"
    assert blocker_kinds([ROOM, ROOM]) == ["room"]  # the same kind twice is one


def test_a_blocked_setup_with_no_blocker_words_is_held_by_the_session_when_entries_are_not_allowed_and_by_the_data_otherwise():
    (a,), _ = near([with_session(rec(t(10, 0, 20), 25010.0, [held(blockers=())]), entries_allowed=False)], bars(flat(10, 1, 25010)))
    assert a["kinds"] == ["session"]
    (b,), _ = near([with_session(rec(t(10, 0, 20), 25010.0, [held(blockers=())]), entries_allowed=True)], bars(flat(10, 1, 25010)))
    assert b["kinds"] == ["data"]  # (no fresh tick)
    (c,), _ = near([rec(t(10, 0, 20), 25010.0, [held(blockers=())])], bars(flat(10, 1, 25010)))  # a record that does not say
    assert c["kinds"] == ["data"]


def test_the_blockers_and_kinds_are_the_ones_of_the_first_moment_not_a_later_one():
    records = [rec(t(10, 0, 20), 25010.0, [held(blockers=(ROOM,))]), rec(t(10, 1, 0), 25012.0, [held(blockers=("historical data is stale: today's refresh has not completed",))])]
    (b,), _ = near(records, bars(flat(10, 2, 25010)))
    assert b["kinds"] == ["room"] and b["blockers"] == [ROOM]


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 3. The replay and the run
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def test_the_run_is_the_best_before_the_invalidation_and_does_not_count_what_comes_after_it():
    records = [rec(t(10, 0, 20), 25010.0, [held()])]
    candles = bars((10, 1, 25010, 25040, 25005, 25030), (10, 2, 25030, 25045, 24960, 24970), (10, 3, 24970, 25200, 24970, 25190))  # up 30, then the stop at 24,962.7, then a rally that is not the trade's
    (b,), _ = near(records, candles)
    assert b["outcome"] == "target1" and b["run_r"] == pytest.approx(30 / 47.3)  # (the candle that touched the stop does not count its own high)


def test_the_run_ignores_prism_ending_the_setup_and_is_the_price_path_alone():
    sid = "trend_pullback:bull:7"
    records = [rec(t(10, 0, 20), 25010.0, [held()]), rec(t(10, 1, 10), 25011.0, [], [ended(sid, t(10, 1, 10), "expired")])]
    (b,), _ = near(records, bars(flat(10, 1, 25011), (10, 2, 25011, 25070, 25005, 25060), (10, 3, 25060, 25065, 24950, 24955)))
    assert b["outcome"] == "setup_ended" and b["end_code"] == "expired" and b["run_r"] == pytest.approx(60 / 47.3)


def test_a_ready_setup_has_a_run_too_and_the_ready_report_is_unchanged():
    records = [rec(t(10, 0, 20), 25005.0, [setup()])]
    rep = review(records, bars((10, 1, 25005, 25050, 25000, 25049), (10, 2, 25049, 25110, 25040, 25100)))
    (r,) = rep["setups"]
    assert r["outcome"] == "target1" and r["run_r"] == pytest.approx(105 / 35) and "blocked" not in rep  # (the old call has no near-miss keys)


def test_without_candles_the_near_misses_are_listed_and_not_replayed():
    (b,), _ = near([rec(t(10, 0, 20), 25010.0, [held()])], None)
    assert b["outcome"] is None and "not replayed" in b["note"] and b["entry"] == 25010.0 and b["kind"] == "room"


def test_a_near_miss_at_or_through_the_invalidation_has_no_risk_to_measure():
    (b,), _ = near([rec(t(10, 0, 20), 25010.0, [held(inv=25010.0)])], bars(flat(10, 1, 25010)))
    assert b["outcome"] is None and "no risk" in b["note"]


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 4. The tallies
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def result(outcome, r, run, kind="room"):
    return {"outcome": outcome, "r": r, "mfe_r": run, "mae_r": -0.2, "run_r": run, "ambiguous": False, "kind": kind}


def test_the_summary_has_the_average_run_and_the_share_that_ran_one_r_or_more():
    s = summarise([result("target1", 0.5, 1.5), result("invalidation", -1.0, 0.0), result("unresolved", 0.2, 1.0), result(None, None, None)])
    assert s["average_run_r"] == pytest.approx((1.5 + 0.0 + 1.0) / 3) and s["run_1r_share"] == pytest.approx(2 / 3)  # 1.0 counts as "1 R or more"
    assert summarise([])["average_run_r"] is None and summarise([])["run_1r_share"] is None


def test_the_tallies_are_by_what_held_them_back_and_a_combination_is_its_own_group():
    items = [result("target1", 0.5, 1.2, "room"), result("invalidation", -1.0, 0.1, "room"), result("target1", 0.4, 0.4, "data"), result("unresolved", 0.0, 0.0, "data + room")]
    g = group_by_kind(items)
    assert list(g) == ["data", "data + room", "room"] and g["room"]["ready"] == 2 and g["room"]["target1"] == 1 and g["room"]["invalidation"] == 1 and g["data + room"]["unresolved"] == 1
    assert g["room"]["average_r"] == pytest.approx(-0.25) and g["room"]["run_1r_share"] == pytest.approx(0.5)


def test_a_review_makes_the_tallies_and_sets_them_beside_the_ones_called_ready():
    records = [rec(t(10, 0, 20), 25005.0, [setup("a:bull:1")]), rec(t(10, 30, 20), 25010.0, [held("b:bull:2")]), rec(t(11, 0, 20), 25010.0, [held("c:bull:3", blockers=("5M candles missing 10:50-11:00 (inside the last 12 candles)",))])]
    candles = bars((10, 1, 25005, 25060, 25000, 25055), (10, 31, 25010, 25019, 25005, 25015), (11, 1, 25010, 25012, 24960, 24965))
    rep = review(records, candles, blocked=True)
    assert [r["kind"] for r in rep["blocked"]] == ["room", "data"] and set(rep["blocked_by_kind"]) == {"room", "data"}
    assert rep["blocked_by_kind"]["room"]["target1"] == 1 and rep["blocked_by_kind"]["data"]["invalidation"] == 1 and rep["total"]["ready"] == 1


def test_days_are_merged_with_their_day_kept_and_the_tallies_made_again():
    d1 = review([rec(t(10, 0, 20), 25010.0, [held()])], bars((10, 1, 25010, 25019, 25005, 25015)), blocked=True)
    d2 = review([rec(t(10, 0, 20, day=MON), 25010.0, [held("z:bull:9")]), rec(t(11, 0, 20, day=MON), 25005.0, [setup("r:bull:8")])], bars((10, 1, 25010, 25012, 24960, 24965), (11, 1, 25005, 25060, 25000, 25055), day=MON), blocked=True)
    m = merge([(date(2026, 11, 6), d1), (date(2026, 11, 9), d2)])
    assert [b["day"] for b in m["blocked"]] == ["2026-11-06", "2026-11-09"] and [s["day"] for s in m["setups"]] == ["2026-11-09"]
    assert m["blocked_by_kind"]["room"]["ready"] == 2 and m["blocked_by_kind"]["room"]["target1"] == 1 and m["blocked_by_kind"]["room"]["invalidation"] == 1 and m["total"]["ready"] == 1


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 5. The command
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def make_day(tmp_path, name, records, candles):
    j = tmp_path / name
    write_journal(j, records)
    c = tmp_path / (name + ".candles.json")
    c.write_text(json.dumps(candles), encoding="utf-8")
    return j, c


def test_the_command_prints_the_near_misses_only_when_asked_and_the_old_output_is_the_same(tmp_path, capsys):
    j, c = make_day(tmp_path, "decisions-2026-11-06.jsonl", [rec(t(10, 0, 20), 25010.0, [held()])], bars((10, 1, 25010, 25019, 25005, 25015)))
    assert main([str(j), "--candles", str(c)]) == 0
    plain = capsys.readouterr().out
    assert "NOT called ready" not in plain and "No setup reached READY_TO_ACT" in plain
    assert main([str(j), "--candles", str(c), "--blocked"]) == 0
    out = capsys.readouterr().out
    assert out.startswith(plain.rstrip("\n")) and "Setups that were NOT called ready, replayed as if they had been (hypothetical" in out
    assert "10:00 CE Trend Pullback 7: held back by the room rule (only 18.0 pts to the next level 25,018.00 (under 1x the 37.3 pts at risk)): entry 25010.00" in out
    assert "target1 at 10:01 25018.00 = +0.17 R (ran +0.19 R before the invalidation)" in out  # (it touched 25,018 and went on to 25,019: 9 pts of 47.3) and "By what held them back" in out and "  room: 1 / 1 / 0 / 0 / 0" in out
    assert "small sample" in out and "never offered" in out


def test_the_command_says_when_nothing_was_held_back(tmp_path, capsys):
    j, c = make_day(tmp_path, "decisions-2026-11-06.jsonl", [rec(t(10, 0, 20), 25005.0, [setup()])], bars((10, 1, 25005, 25060, 25000, 25055)))
    assert main([str(j), "--candles", str(c), "--blocked"]) == 0
    out = capsys.readouterr().out
    assert "none: no setup was held back while its price was in the entry area." in out


def test_several_days_are_shown_day_by_day_and_then_together(tmp_path, capsys, monkeypatch):
    j1, _ = make_day(tmp_path, "decisions-2026-11-06.jsonl", [rec(t(10, 0, 20), 25010.0, [held()])], [])
    j2, _ = make_day(tmp_path, "decisions-2026-11-09.jsonl", [rec(t(10, 0, 20, day=MON), 25010.0, [held("z:bull:9", blockers=("5M candles missing 10:50-11:00 (inside the last 12 candles)",))])], [])
    candles = {date(2026, 11, 6): bars((10, 1, 25010, 25019, 25005, 25015)), date(2026, 11, 9): bars((10, 1, 25010, 25012, 24960, 24965), day=MON)}
    monkeypatch.setattr(outcomes, "candles_from_db", lambda day, **kw: candles[day])
    assert main([str(j1), str(j2), "--blocked"]) == 0
    out = capsys.readouterr().out
    assert out.count("Outcomes of the setups Prism called ready, 2026-11-") == 2  # each day on its own, as before
    assert "ALL 2 DAYS TOGETHER (2 with candles to replay" in out
    together = out[out.index("ALL 2 DAYS TOGETHER"):]
    assert "2026-11-06 10:00 CE Trend Pullback 7: held back by the room rule" in together  # (together, every line says its day)
    assert "2026-11-09 10:00 CE Trend Pullback 9: held back by the data (not trusted)" in together and "  data: 1 / 0 / 1 / 0 / 0" in together and "  room: 1 / 1 / 0 / 0 / 0" in together


def test_a_day_with_no_candles_still_counts_what_the_journal_says(tmp_path, capsys, monkeypatch):
    j1, _ = make_day(tmp_path, "decisions-2026-11-06.jsonl", [rec(t(10, 0, 20), 25010.0, [held()])], [])
    j2, _ = make_day(tmp_path, "decisions-2026-11-09.jsonl", [rec(t(10, 0, 20, day=MON), 25010.0, [held("z:bull:9")])], [])
    monkeypatch.setattr(outcomes, "candles_from_db", lambda day, **kw: bars((10, 1, 25010, 25019, 25005, 25015)) if day == date(2026, 11, 6) else [])
    assert main([str(j1), str(j2), "--blocked"]) == 0
    out = capsys.readouterr().out
    assert "ALL 2 DAYS TOGETHER (1 with candles to replay" in out and "the source holds no 1-minute candle for that day" in out and "no candles: not replayed" in out.split("ALL 2 DAYS")[1]


def test_candles_from_a_file_belong_to_one_journal(tmp_path, capsys):
    j1, c1 = make_day(tmp_path, "decisions-2026-11-06.jsonl", [rec(t(10, 0, 20), 25010.0, [held()])], [])
    j2, _ = make_day(tmp_path, "decisions-2026-11-09.jsonl", [], [])
    with pytest.raises(SystemExit) as e:
        main([str(j1), str(j2), "--candles", str(c1)])
    assert e.value.code == 2 and "one journal" in capsys.readouterr().err


def test_an_unreadable_journal_among_several_is_exit_two_naming_it(tmp_path, capsys):
    j1, c1 = make_day(tmp_path, "decisions-2026-11-06.jsonl", [], [])
    assert main([str(j1), str(tmp_path / "nope.jsonl")]) == 2
    assert "nope.jsonl: cannot be read" in capsys.readouterr().err


def test_the_json_of_one_day_keeps_its_shape_and_gains_the_near_misses_and_several_days_have_a_combined_one(tmp_path, capsys, monkeypatch):
    j1, c1 = make_day(tmp_path, "decisions-2026-11-06.jsonl", [rec(t(10, 0, 20), 25010.0, [held()])], bars((10, 1, 25010, 25019, 25005, 25015)))
    assert main([str(j1), "--candles", str(c1), "--json"]) == 0
    one = json.loads(capsys.readouterr().out)
    assert one["day"] == "2026-11-06" and one["replayed"] is True and "blocked" not in one and one["setups"] == []
    assert main([str(j1), "--candles", str(c1), "--json", "--blocked"]) == 0
    one = json.loads(capsys.readouterr().out)
    assert one["blocked"][0]["kind"] == "room" and one["blocked_by_kind"]["room"]["target1"] == 1 and one["blocked_not_in_area"] == []
    j2, _ = make_day(tmp_path, "decisions-2026-11-09.jsonl", [], [])
    monkeypatch.setattr(outcomes, "candles_from_db", lambda day, **kw: bars((10, 1, 25010, 25019, 25005, 25015)))
    assert main([str(j1), str(j2), "--json", "--blocked"]) == 0
    many = json.loads(capsys.readouterr().out)
    assert [d["day"] for d in many["days"]] == ["2026-11-06", "2026-11-09"] and many["combined"]["blocked"][0]["day"] == "2026-11-06"


def test_the_near_miss_review_reads_and_prints_and_never_writes(tmp_path):
    import hashlib

    j, c = make_day(tmp_path, "decisions-2026-11-06.jsonl", [rec(t(10, 0, 20), 25010.0, [held()])], bars((10, 1, 25010, 25019, 25005, 25015)))
    before = hashlib.sha256(j.read_bytes()).hexdigest()
    main([str(j), "--candles", str(c), "--blocked"])
    assert hashlib.sha256(j.read_bytes()).hexdigest() == before and lifecycles([rec(t(10, 0, 20), 25010.0, [held()])])["trend_pullback:bull:7"]["near"]["price"] == 25010.0
