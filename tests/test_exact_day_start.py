"""A real clock has a fraction of a second, and midnight must still be exact.

The live incident of 2026-11-12 (Prism restarted at 13:13 in the session; NOT READY for minutes with "5M 12 missing, 15M 8 missing" although the log said the history held every one of those candles):
`day_start()` was `ts - seconds_into_day`, and with a real clock's fraction it was about 2e-7 s off in three moments out of four. A candle that started at exactly 12:10:00 then did not equal its
slot 12:10:00, so a complete history was "missing" every candle (only the last few, the decision window, were reported), the start-up validation passed one try in four whatever the data held, and each
retry fetched the whole day again, which fed Angel One's rate limit. Every test used a whole-second clock such as ist(10, 0, 30), where the old and the exact value are the same.

What is held here: midnight is exact for any fraction; a complete history is never reported missing at any moment; a refresh at the moment of the incident validates at once; the next refresh asks only for
what is really missing and never for the whole day again; live candles built from ticks with a fraction (milliseconds) land on exact slots."""

import random
from datetime import date, datetime

import pytest
from helpers import CFG, SPOT_TOKEN, WED, Clock, ist, sample_contracts, session_candles
from test_history import PG, AngelHistory, db_hist

from app import history
from app.candles import CLOSE_S, IST, OPEN_S, Candle, bucket, day_start, in_session
from app.engine import MarketData
from app.readiness import decision_window_gaps, today_gaps
from app.series import missing_starts, slots

TODAY = (2026, 11, 12)  # a Thursday
MIDNIGHT = datetime(*TODAY, tzinfo=IST).timestamp()
SECS = {"1m": 60, "5m": 300, "15m": 900}
# Windows' clock ticks in 100 ns, so a moment has digits below the microsecond. These are fractions (of 13:13:22) where the OLD formula was wrong, found by search (it was wrong at 75.5% of such
# moments; at a whole second or a few-decimal fraction such as .030 it happens to be right, which is why no test ever saw it), and four where it was right, as controls.
BAD_FRACTIONS = [0.0655289, 0.1506164, 0.2379646, 0.3699552, 0.4702635, 0.4763532, 0.5231812, 0.5442292, 0.6257203, 0.6348607, 0.6390681, 0.8364615, 0.8680453, 0.9956448]
FRACTIONS = BAD_FRACTIONS + [0.0, 0.5, 0.25, 0.030]


def at(h, m, s=0, fraction=0.0):
    return MIDNIGHT + h * 3600 + m * 60 + s + fraction


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 1. Midnight is exact
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("fraction", FRACTIONS)
def test_midnight_is_the_same_exact_whole_number_at_every_fraction_of_a_second(fraction):
    for h, m, s in [(0, 0, 0), (0, 0, 1), (9, 15, 0), (12, 10, 0), (13, 13, 22), (15, 29, 59), (23, 59, 59)]:
        d = day_start(at(h, m, s, fraction))
        assert d == MIDNIGHT and d == int(d), (h, m, s, fraction, d - MIDNIGHT)


def test_midnight_is_exact_at_a_million_random_moments_of_nine_months():
    rnd = random.Random(2026)
    for _ in range(100_000):
        ts = MIDNIGHT + rnd.uniform(-120 * 86400, 160 * 86400)
        d = day_start(ts)
        assert d == int(d) and (d + 19800) % 86400 == 0 and d <= ts < d + 86400, ts  # a whole second, an IST midnight, the one at or before ts


def test_the_boundaries_of_a_day():
    assert day_start(MIDNIGHT) == MIDNIGHT  # midnight itself belongs to the new day
    assert day_start(MIDNIGHT + 86400 - 1e-3) == MIDNIGHT and day_start(MIDNIGHT + 86400) == MIDNIGHT + 86400
    assert day_start(MIDNIGHT - 1e-3) == MIDNIGHT - 86400  # a moment before it is the day before
    assert day_start(MIDNIGHT + 1e-3) == MIDNIGHT


def test_it_is_the_value_every_whole_second_clock_always_gave():
    """The old formula and the exact one agree wherever the old one was right: no test, journal or candle of a whole-second time changes."""
    for h in range(24):
        for m in (0, 1, 15, 30, 59):
            ts = at(h, m, 7)
            assert day_start(ts) == ts - (h * 3600 + m * 60 + 7) and day_start(int(ts)) == MIDNIGHT


def test_it_does_not_depend_on_the_pcs_own_zone(monkeypatch):
    import time

    monkeypatch.setenv("TZ", "America/New_York")
    if hasattr(time, "tzset"):
        time.tzset()
    assert day_start(at(13, 13, 22, 0.03)) == MIDNIGHT


def test_in_session_and_bucket_still_say_the_same_things_and_buckets_start_on_exact_slots():
    assert in_session(at(9, 15)) and not in_session(at(9, 14, 59, 0.999)) and in_session(at(15, 29, 59, 0.999)) and not in_session(at(15, 30))
    assert not in_session(MIDNIGHT + 3 * 86400 + 12 * 3600)  # Sunday 15 Nov noon
    for secs in (60, 300, 900, 3600):
        for fraction in FRACTIONS:
            start, end = bucket(at(13, 13, 22, fraction), secs)  # a tick with milliseconds, as the live feed's exchange time may have
            assert start == int(start) and (start - MIDNIGHT - OPEN_S) % secs == 0 and start <= at(13, 13, 22, fraction) < end, (secs, fraction)
    assert bucket(at(15, 29, 59, 0.5), 3600) == (MIDNIGHT + 15 * 3600 + 15 * 60, MIDNIGHT + CLOSE_S)  # the last hour (15:15) is cut at the close, 15:30


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 2. A complete history is never missing
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def whole_session_so_far(now, secs):
    """The candle starts of today that are complete at `now`, as Angel One gives them: whole seconds."""
    return {s for s in slots(MIDNIGHT, secs) if min(s + secs, MIDNIGHT + CLOSE_S) + 10 <= now}


@pytest.mark.parametrize("secs", [60, 300, 900])
def test_a_history_with_every_complete_candle_is_not_missing_any_at_any_moment(secs):
    rnd = random.Random(secs)
    for _ in range(3000):
        now = at(9, 20) + rnd.uniform(0, 6 * 3600)
        assert missing_starts(whole_session_so_far(now, secs), secs, now, MIDNIGHT + OPEN_S) == [], now


@pytest.mark.parametrize("fraction", FRACTIONS)
def test_it_still_reports_what_is_really_missing_and_only_that(fraction):
    now = at(13, 13, 22, fraction)
    have = whole_session_so_far(now, 300) - {at(12, 40), at(12, 55)}
    assert missing_starts(have, 300, now, MIDNIGHT + OPEN_S) == [at(12, 40), at(12, 55)]


def hist_of_today(now, **drop):
    """Prism DB's previous day and Angel One's candles of today up to `now`, complete ones only."""
    hist = db_hist(WED)
    for tf, secs in SECS.items():
        hist[tf] += [c for c in session_candles(TODAY, secs, source="angel") if c.end + 10 <= now and c.start not in drop.get(tf, ())]
    return hist


def engine_at(now):
    clock = Clock(now)
    md = MarketData(CFG, clock)
    md.set_contracts(sample_contracts(), date(*TODAY), 24510.0)
    return md, clock


@pytest.mark.parametrize("fraction", FRACTIONS)
def test_the_decision_window_of_a_complete_history_has_no_gap_at_any_fraction(fraction):
    now = at(13, 13, 22, fraction)
    md, _ = engine_at(now)
    hist = hist_of_today(now)
    assert decision_window_gaps(md, hist, now) == {} and today_gaps(md, hist, now) == {}  # (the incident: 5M 12 missing, 15M 8 missing, with these very candles held)


def test_a_real_gap_in_the_decision_window_is_still_found_at_any_fraction():
    for fraction in FRACTIONS:
        now = at(13, 13, 22, fraction)
        md, _ = engine_at(now)
        hist = hist_of_today(now, **{"5m": {at(12, 40)}})
        assert decision_window_gaps(md, hist, now) == {"5m": [at(12, 40)]}, fraction


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 3. The incident, replayed: a restart at 13:13 in the session
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
class Counting(AngelHistory):
    def windows(self, interval):
        return [(r["fromdate"], r["todate"]) for r in self.requests if r["interval"] == interval]


def refresh(md, clock, sess):
    return history.refresh(PG, md, sess, now=clock, sleep=lambda s: None, loader=lambda cfg, now: db_hist(WED))


@pytest.mark.parametrize("fraction", FRACTIONS)
def test_a_restart_in_the_session_validates_at_the_first_try_whatever_the_fraction_of_the_second(fraction):
    clock_at = at(13, 13, 22, fraction)
    md, clock = engine_at(clock_at)
    sess = Counting()
    assert refresh(md, clock, sess) is True  # before the fix: True for only ~1 fraction in 4
    assert md.history_date == date(*TODAY) and md.history_status == {"state": "ready", "error": None} and md.history_failures == 0
    asked = {tf: sess.windows(name)[0][0] for tf, name in (("1m", "ONE_MINUTE"), ("5m", "FIVE_MINUTE"), ("15m", "FIFTEEN_MINUTE"))}
    assert asked == {tf: "2026-11-12 09:15" for tf in SECS}  # today was not in Prism DB: the first fetch is from the open, once each


@pytest.mark.parametrize("fraction", FRACTIONS)
def test_the_next_refresh_asks_only_for_what_is_really_missing_never_the_whole_day_again(fraction):
    md, clock = engine_at(at(13, 13, 22, fraction))
    assert refresh(md, clock, Counting()) is True
    clock.t = at(13, 14, 52, fraction)  # the loop's next refresh, 90 s later
    sess = Counting()
    assert refresh(md, clock, sess) is True
    firsts = {name: sess.windows(name)[0][0] for name in ("ONE_MINUTE", "FIVE_MINUTE", "FIFTEEN_MINUTE")}
    # from the interval after the last one held, not from 09:15: held 1m up to 13:12 (13:13 is the forming one at 13:13:22; at 13:14:52 it is complete), 5m up to 13:05, 15m up to 12:45
    assert firsts == {"ONE_MINUTE": "2026-11-12 13:13", "FIVE_MINUTE": "2026-11-12 13:10", "FIFTEEN_MINUTE": "2026-11-12 13:00"}


@pytest.mark.parametrize("fraction", FRACTIONS)
def test_fill_gap_sees_no_hole_in_a_complete_day_and_asks_from_the_next_interval(fraction):
    now = at(13, 13, 22, fraction)
    hist = hist_of_today(now)
    sess = Counting()
    history.fill_gap(sess, SPOT_TOKEN, hist, now, sleep=lambda s: None)
    assert sess.windows("FIVE_MINUTE")[0][0] == "2026-11-12 13:10" and sess.windows("ONE_MINUTE")[0][0] == "2026-11-12 13:13"
    assert not [w for name in ("ONE_MINUTE", "FIVE_MINUTE", "FIFTEEN_MINUTE") for w in sess.windows(name) if w[0].endswith("09:15")]


def test_a_hole_in_the_middle_of_the_day_is_still_fetched_from_the_hole():
    now = at(13, 13, 22, 0.817)
    hist = hist_of_today(now, **{"5m": {at(11, 5)}})
    sess = Counting()
    history.fill_gap(sess, SPOT_TOKEN, hist, now, sleep=lambda s: None)
    assert sess.windows("FIVE_MINUTE")[0][0] == "2026-11-12 11:05"  # exactly the absent interval, as before


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 4. Live candles built from ticks with milliseconds
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def test_live_candles_built_from_ticks_with_milliseconds_have_exact_starts_that_match_the_history():
    from helpers import SPOT_TOKEN as TOKEN
    from helpers import msg

    clock = Clock(at(10, 0, 30))
    md = MarketData(CFG, clock)
    md.set_contracts(sample_contracts(), date(*TODAY), 24510.0)
    rnd = random.Random(5)
    for minute in range(0, 12):
        for _ in range(3):
            ts = at(9, 20 + minute, rnd.randrange(0, 60)) + rnd.randrange(0, 1000) / 1000.0  # an exchange time with milliseconds
            clock.t = ts + 0.2
            md.on_message(msg(TOKEN, 24500.0 + minute, ts))
    clock.t = at(9, 40)
    md.on_message(msg(TOKEN, 24520.0, at(9, 39, 59) + 0.5))  # closes the earlier candles on the clock
    md.watchdog()
    closed = list(md.builder.closed.get((TOKEN, "1m"), ()))
    assert closed, "the ticks should have made 1m candles"
    for c in closed:
        assert c.start == int(c.start) and (c.start - MIDNIGHT - OPEN_S) % 60 == 0, c.start
    have = {c.start for c in closed}
    assert have <= set(slots(MIDNIGHT, 60))  # every live candle's start IS one of the day's slots: it can equal a history candle's


def test_a_candle_from_the_history_and_the_same_candle_from_live_ticks_are_one_candle():
    from app.series import completed_series

    start = at(10, 5)
    db = Candle(start, start + 60, 1, 2, 0.5, 1.5, 0, source="angel")
    live_start = bucket(start + 0.123, 60)[0]  # what a tick with milliseconds inside that minute is bucketed to
    live = Candle(live_start, live_start + 60, 9, 9, 9, 9, 0)
    out = completed_series({"1m": [db]}, type("B", (), {"closed": {("t", "1m"): [live]}})(), "t", "1m")
    assert len(out) == 1 and out[0] is db  # history wins the tie, and there IS a tie: before, the two starts differed by 2e-7 and both stayed
