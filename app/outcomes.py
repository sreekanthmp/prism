"""What would have happened to the setups Prism called ready: a journal replayed against the day's 1-minute candles. READ-ONLY.

    python -m app.outcomes logs/decisions-2026-11-11.jsonl                    # the candles come from Prism DB (read-only)
    python -m app.outcomes logs/decisions-2026-11-11.jsonl --candles day.json # or from a file: [[start_epoch, open, high, low, close], ...] (or objects with those keys)
    python -m app.outcomes logs/decisions-2026-11-11.jsonl --json
    python -m app.outcomes logs/decisions-2026-11-1*.jsonl --blocked          # several days, and the NEAR MISSES: see below

For every setup that reached READY_TO_ACT it takes what the page showed at that moment (the spot price on the journal record, the invalidation level, the targets of the plan), starts at the
NEXT whole minute (never inside the minute the alert came in: that candle's later prices were not known yet) and walks the candles forward until the first of

  * the invalidation level is touched (against a long: the low reaches it; against a short: the high does)      -> `invalidation`
  * the first target that is beyond the entry is touched                                                          -> `target1`
  * Prism ended the setup (its journal event: invalidated, expired, ...), at the price of that journal record     -> `setup_ended`
  * the session closes                                                                                              -> `unresolved` (marked at the last close)

A candle that touches both the invalidation and the target is counted as the invalidation, the pessimistic reading (`ambiguous`). R is the move measured in units of the risk taken at the
entry (entry minus invalidation): target 1 is +distance/risk, the invalidation is -1, the others are marked at their exit price. `mfe_r` / `mae_r` are the best and worst the trade showed on
the way, in R.

THE NEAR MISSES (`--blocked`). Most of the time Prism says WAIT, and the question a trader asks is whether the rules are too strict. A setup whose confirming candle had closed, with the price inside its entry area, but
which something held back (the room rule, the size of the risk, the data, the session, the volatility) was never called ready. For each such setup that never became ready, this takes the first moment it WOULD have been
ready but for that, with the price and levels shown then, and replays it exactly like a ready one, so the two can be compared: by what held them back, how many reached target 1 or the invalidation, the average R, and the
best run the price made before the invalidation ("run"). It changes no rule and no setting. The answer it gives is about the sessions in the journals you name, which is a small sample, and an entry that was never offered.

WHAT THIS IS NOT. It is not profit and loss: the unit is INDEX POINTS, not option premium (an option moves with the index through delta, time decay and spread); there is no slippage, cost or
tax; the entry is the price on the journal record, which a person acting on an alert would not match exactly; a setup is taken once, at the first moment it was ready (it flickers in and out of the
entry area: later returns are not new trades); and a few sessions are a small sample. It tells you which strategies tended to work and which to distrust. It places nothing and touches no order."""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, time as dtime
from pathlib import Path
from types import SimpleNamespace

from .candles import CLOSE_S, IST, OPEN_S
from .journal import expand_paths, read

MINUTE = 60
SIGN = {"CE": 1, "PE": -1}  # CE: the index is expected to rise (a long); PE: to fall (a short)
OUTCOMES = ("target1", "invalidation", "setup_ended", "unresolved")


def _num(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and x == x else None


KIND_PATTERNS = (  # what can hold a confirmed setup back, from the words of its blockers (the strategies' location notes, the data checks, the session)
    ("room", re.compile(r"to the next level")),
    ("risk", re.compile(r"invalidation (only )?\d")),
    ("volatility", re.compile(r"volatility is unusually high")),
    ("session", re.compile(r"opening range forming|late session|before the market opens|market is closed|no new entries|no entries")),
    ("data", re.compile(r"stale|missing|not enough completed|live feed|no live connection|clock cannot|history|\btick\b|not trusted|\bdata\b|\bfeed\b")),
)
KIND_WORDS = {"room": "the room rule", "risk": "the size of the risk", "volatility": "volatility", "session": "the session (no entries now)", "data": "the data (not trusted)", "other": "something else"}


def blocker_kinds(blockers: list, entries_allowed=None) -> list:
    """The kinds of thing that held a setup back, sorted, from the words of its blockers. A confirmed setup with no blocker words is held back by the session when entries are not allowed, else by the data (no fresh tick)."""
    kinds = set()
    for b in blockers:
        hit = next((k for k, pat in KIND_PATTERNS if pat.search(b)), "other")
        kinds.add(hit)
    if not blockers:
        kinds.add("session" if entries_allowed is False else "data")
    return sorted(kinds)


def lifecycles(records: list) -> dict:
    """id -> what the journal says about each setup: its direction, the strategy, the highest stage it reached, when it was first ready (with the price and the levels as shown then), and how it ended."""
    out: dict = {}
    for r in records:
        t, price = _num(r.get("t")), _num(r.get("price"))
        if t is None:
            continue
        for s in r.get("setups") or []:
            if not isinstance(s, dict) or not s.get("id"):
                continue
            e = out.setdefault(s["id"], {"id": s["id"], "strategy": s.get("strategy"), "strategy_name": s.get("strategy_name") or s.get("strategy"), "direction": s.get("direction"),
                                         "first_seen": t, "stages": [], "ready": None, "ended": None, "blocked_seen": False, "near": None})
            if not e["stages"] or e["stages"][-1] != s.get("stage"):
                e["stages"].append(s.get("stage"))
            if s.get("stage") == "BLOCKED":
                e["blocked_seen"] = True
                if e["near"] is None and price is not None:  # the first moment it would have been ready but for what held it back: the confirming candle closed and the price is inside the entry area
                    zone = [_num(x) for x in (s.get("zone") or [])]
                    if len(zone) == 2 and None not in zone and min(zone) <= price <= max(zone):
                        targets = [_num(x.get("price")) for x in ((s.get("plan") or {}).get("targets") or []) if isinstance(x, dict)]
                        blockers = [str(b) for b in (s.get("blockers") or [])]
                        kinds = blocker_kinds(blockers, (r.get("session") or {}).get("entries_allowed"))
                        e["near"] = {"t": t, "price": price, "invalidation": _num(s.get("invalidation")), "trigger": _num(s.get("trigger")), "targets": [x for x in targets if x is not None],
                                     "blockers": blockers, "kinds": kinds, "kind": " + ".join(kinds)}  # fmt: skip
            if e["ready"] is None and s.get("stage") == "READY_TO_ACT" and price is not None:
                targets = [_num(x.get("price")) for x in ((s.get("plan") or {}).get("targets") or []) if isinstance(x, dict)]
                e["ready"] = {"t": t, "price": price, "invalidation": _num(s.get("invalidation")), "trigger": _num(s.get("trigger")), "targets": [x for x in targets if x is not None]}
        for ev in r.get("events") or []:
            if isinstance(ev, dict) and ev.get("id") in out and ev.get("code") is not None and out[ev["id"]]["ended"] is None:
                out[ev["id"]]["ended"] = {"t": _num(ev.get("time")) or t, "price": price, "code": ev.get("code"), "text": ev.get("text")}
    return out


def replay(setup: dict, candles: list) -> dict:
    """The outcome of one setup that was ready (see the module's docstring). `candles`: [(start, open, high, low, close), ...] of 1 minute, any order."""
    ready, sign = setup["ready"], SIGN.get(setup["direction"])
    entry, inv = ready["price"], ready["invalidation"]
    res = {"id": setup["id"], "strategy": setup["strategy"], "strategy_name": setup["strategy_name"], "direction": setup["direction"], "ready_at": ready["t"], "entry": entry,
           "invalidation": inv, "risk": None, "target1": None, "target2": None, "outcome": None, "exit_at": None, "exit_price": None, "r": None, "mfe_r": None, "mae_r": None,
           "ambiguous": False, "target2_reached": None, "end_code": (setup["ended"] or {}).get("code"), "run_r": None, "note": ""}  # fmt: skip
    if sign is None or inv is None:
        res["note"] = "no usable direction or invalidation level on the record"
        return res
    risk = (entry - inv) * sign
    if risk <= 0:
        res["note"] = "the price on the record was already through the invalidation level: there is no risk to measure"
        return res
    res["risk"] = risk
    beyond = sorted((x for x in ready["targets"] if (x - entry) * sign > 0), key=lambda x: (x - entry) * sign)  # a target the price was already past is not a target
    t1, t2 = (beyond + [None, None])[:2]
    res["target1"], res["target2"] = t1, t2
    start = (int(ready["t"]) // MINUTE + 1) * MINUTE  # the next whole minute
    walk = sorted(c for c in candles if c[0] >= start)
    if not walk:
        res["outcome"], res["note"] = None, "no candle after the entry to replay"
        return res
    ended = setup["ended"]
    best = worst = 0.0
    last = None
    stop_at = None
    for s, o, h, low, c in walk:
        if ended and ended["t"] <= s and ended["price"] is not None and res["outcome"] is None:
            res.update(outcome="setup_ended", exit_at=ended["t"], exit_price=ended["price"])
            break
        high_move, low_move = ((h - entry), (low - entry)) if sign > 0 else ((entry - low), (entry - h))  # (the most favourable, the most adverse) excursion of this candle
        stop_hit = (low <= inv) if sign > 0 else (h >= inv)
        t1_hit = t1 is not None and ((h >= t1) if sign > 0 else (low <= t1))
        best, worst = max(best, high_move), min(worst, low_move)
        last = (s, c)
        if stop_hit:
            res.update(outcome="invalidation", exit_at=s, exit_price=inv, ambiguous=t1_hit)
            break
        if t1_hit:
            res.update(outcome="target1", exit_at=s, exit_price=t1)
            break
    if res["outcome"] is None and ended and ended["price"] is not None:  # it ended after the last candle there is
        res.update(outcome="setup_ended", exit_at=ended["t"], exit_price=ended["price"])
    if res["outcome"] is None:
        res.update(outcome="unresolved", exit_at=last[0] if last else None, exit_price=last[1] if last else None)
    res["r"] = ((res["exit_price"] - entry) * sign) / risk if res["exit_price"] is not None else None
    res["mfe_r"], res["mae_r"] = best / risk, worst / risk
    run = 0.0  # the best the price did before the invalidation level was touched, whatever else happened (a target, Prism ending the setup): the room the trade really had
    for s, o, h, low, c in walk:
        if (low <= inv) if sign > 0 else (h >= inv):
            break
        run = max(run, (h - entry) if sign > 0 else (entry - low))
    res["run_r"] = run / risk
    if res["outcome"] == "target1" and t2 is not None:  # after target 1, did it get as far as target 2 before the invalidation level?
        res["target2_reached"] = False
        for s, o, h, low, c in walk:
            if s < res["exit_at"]:
                continue  # (the candle that reached target 1 counts too: it did not touch the invalidation, or this would not be a target-1 trade)
            if (low <= inv) if sign > 0 else (h >= inv):
                break
            if (h >= t2) if sign > 0 else (low <= t2):
                res["target2_reached"] = True
                break
    return res


def review(records: list, candles: list | None, blocked: bool = False) -> dict:
    """{"setups": [one result per setup that was ready], "never_ready": [...], "by_strategy": {...}, "total": {...}} for one day's journal records and 1-minute candles (None: not available).
    With `blocked`, also "blocked" (the setups that were held back but would have been ready: replayed like a ready one, with what held them back), "blocked_by_kind" and "blocked_not_in_area"."""
    lives = lifecycles(records)
    ready = [s for s in lives.values() if s["ready"] is not None]
    results = []
    for s in sorted(ready, key=lambda s: s["ready"]["t"]):
        if candles is None:
            res = {"id": s["id"], "strategy": s["strategy"], "strategy_name": s["strategy_name"], "direction": s["direction"], "ready_at": s["ready"]["t"], "entry": s["ready"]["price"],
                   "outcome": None, "r": None, "note": "no candles: not replayed", "end_code": (s["ended"] or {}).get("code")}  # fmt: skip
        else:
            res = replay(s, candles)
        results.append(res)
    never = [{"id": s["id"], "strategy": s["strategy"], "strategy_name": s["strategy_name"], "direction": s["direction"], "reached": s["stages"][-1] if s["stages"] else None,
              "end_code": (s["ended"] or {}).get("code") or "still live at the end"} for s in lives.values() if s["ready"] is None]  # fmt: skip
    by: dict = defaultdict(list)
    for r in results:
        by[r["strategy_name"] or r["strategy"] or "?"].append(r)
    out = {"setups": results, "never_ready": never, "by_strategy": {k: summarise(v) for k, v in sorted(by.items())}, "total": summarise(results)}
    if blocked:
        near = sorted((s for s in lives.values() if s["ready"] is None and s["near"] is not None), key=lambda s: s["near"]["t"])
        items = []
        for s in near:
            res = replay({**s, "ready": s["near"]}, candles) if candles is not None else {"id": s["id"], "strategy": s["strategy"], "strategy_name": s["strategy_name"], "direction": s["direction"],
                                                                                          "ready_at": s["near"]["t"], "entry": s["near"]["price"], "outcome": None, "r": None, "note": "no candles: not replayed"}  # fmt: skip
            items.append({**res, "blockers": s["near"]["blockers"], "kinds": s["near"]["kinds"], "kind": s["near"]["kind"]})
        out["blocked"] = items
        out["blocked_by_kind"] = group_by_kind(items)
        out["blocked_not_in_area"] = [{"id": s["id"], "strategy": s["strategy"], "strategy_name": s["strategy_name"], "direction": s["direction"]}
                                      for s in lives.values() if s["ready"] is None and s["near"] is None and s["blocked_seen"]]  # held back, and the price never in its entry area while it was
    return out


def group_by_kind(items: list) -> dict:
    by: dict = defaultdict(list)
    for r in items:
        by[r["kind"]].append(r)
    return {k: summarise(v) for k, v in sorted(by.items())}


def merge(days: list) -> dict:
    """Several days' reviews as one, from [(day, review)]: every result keeps its day, and the tallies are made again over all of them."""
    setups = [{**r, "day": str(d)} for d, rep in days for r in rep["setups"]]
    blocked = [{**r, "day": str(d)} for d, rep in days for r in rep.get("blocked", [])]
    by: dict = defaultdict(list)
    for r in setups:
        by[r["strategy_name"] or r["strategy"] or "?"].append(r)
    return {"setups": setups, "never_ready": [n for _, rep in days for n in rep["never_ready"]], "by_strategy": {k: summarise(v) for k, v in sorted(by.items())}, "total": summarise(setups),
            "blocked": blocked, "blocked_by_kind": group_by_kind(blocked), "blocked_not_in_area": [n for _, rep in days for n in rep.get("blocked_not_in_area", [])]}  # fmt: skip


def summarise(results: list) -> dict:
    """Counts by outcome, the hit rate among the resolved ones, and the average R, for a list of replay results."""
    counted = [r for r in results if r.get("outcome")]
    n = {o: sum(1 for r in counted if r["outcome"] == o) for o in OUTCOMES}
    rs = [r["r"] for r in counted if r.get("r") is not None]
    decided = n["target1"] + n["invalidation"]
    runs = [r["run_r"] for r in counted if r.get("run_r") is not None]
    return {"ready": len(results), "replayed": len(counted), **n, "ambiguous": sum(1 for r in counted if r.get("ambiguous")),
            "target1_share_of_decided": (n["target1"] / decided) if decided else None, "average_r": (sum(rs) / len(rs)) if rs else None,
            "average_mfe_r": _mean([r["mfe_r"] for r in counted if r.get("mfe_r") is not None]), "average_mae_r": _mean([r["mae_r"] for r in counted if r.get("mae_r") is not None]),
            "average_run_r": _mean(runs), "run_1r_share": (sum(1 for x in runs if x >= 1.0) / len(runs)) if runs else None}  # fmt: skip


def _mean(xs):
    return sum(xs) / len(xs) if xs else None


# -- candles ---------------------------------------------------------------------------------------------------------------------------------
def candles_from_file(path) -> list:
    """[(start, open, high, low, close)] from a JSON file of rows or of objects with start / open / high / low / close."""
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    out = []
    for r in rows:
        if isinstance(r, dict):
            r = [r["start"], r["open"], r["high"], r["low"], r["close"]]
        out.append(tuple(float(x) for x in r[:5]))
    return out


def candles_from_db(day: date, connect=None, settings=None) -> list:
    """That day's 1-minute candles from Prism DB through the app's own read-only loader (history.load_db: a read-only session, SELECT only, bounded)."""
    from . import history
    from .config import load_dotenv

    if settings is None:
        import os

        load_dotenv()
        settings = SimpleNamespace(pg_host=os.getenv("PG_HOST", "localhost"), pg_port=int(os.getenv("PG_PORT", "5432")), pg_user=os.getenv("PG_USER", "postgres"),
                                   pg_password=os.getenv("PG_PASSWORD", ""), pg_dbname=os.getenv("PG_DBNAME", "prism"))  # fmt: skip
    end_of_day = datetime.combine(day, dtime(23, 59), IST).timestamp()
    hist = history.load_db(settings, end_of_day, connect=connect)
    midnight = datetime.combine(day, dtime(0, 0), IST).timestamp()
    return [(c.start, c.open, c.high, c.low, c.close) for c in hist["1m"] if OPEN_S <= c.start - midnight < CLOSE_S]  # (inside that day's session: which also says it is that day)


def journal_day(path, records: list) -> date | None:
    name = Path(path).name
    if name.startswith("decisions-") and name.endswith(".jsonl"):
        try:
            return date.fromisoformat(name[len("decisions-"):-len(".jsonl")])
        except ValueError:
            pass
    t = next((_num(r.get("t")) for r in records if _num(r.get("t")) is not None), None)
    return datetime.fromtimestamp(t, IST).date() if t is not None else None


# -- the text ---------------------------------------------------------------------------------------------------------------------------------
def _hm(t) -> str:
    return "–" if t is None else datetime.fromtimestamp(t, IST).strftime("%H:%M")


def _f(x, nd=2, plus=False) -> str:
    return "–" if x is None else (f"{x:+.{nd}f}" if plus else f"{x:.{nd}f}")


def format_report(day, rep: dict, replayed: bool = True) -> list:
    out = [f"Outcomes of the setups Prism called ready, {day or 'unknown day'}  (index points, NOT option profit; no cost or slippage; entry = the price on the journal record)"]
    if not replayed:
        out.append("No 1-minute candles were available for this day, so nothing was replayed: only what the journal says is shown.")
    if not rep["setups"]:
        out.append("No setup reached READY_TO_ACT in this journal.")
    for r in rep["setups"]:
        head = f"{_hm(r['ready_at'])} {r['direction']} {r['strategy_name']} {r['id'].rsplit(':', 1)[-1]}: entry {_f(r['entry'])}"
        if r.get("outcome") is None:
            out.append(f"  {head}: {r.get('note') or 'not replayed'}")
            continue
        out.append(f"  {head} invalidation {_f(r['invalidation'])} risk {_f(r['risk'])} target1 {_f(r['target1'])}: {r['outcome']} at {_hm(r['exit_at'])} {_f(r['exit_price'])}"
                   f" = {_f(r['r'], plus=True)} R (best {_f(r['mfe_r'], plus=True)} R, worst {_f(r['mae_r'], plus=True)} R)"
                   + (" [the same candle touched both: counted as the invalidation]" if r["ambiguous"] else "")
                   + (f" [then target 2: {'reached' if r['target2_reached'] else 'not reached'}]" if r["outcome"] == "target1" and r.get("target2_reached") is not None else "")
                   + (f" [Prism: {r['end_code']}]" if r["outcome"] == "setup_ended" and r.get("end_code") else ""))  # fmt: skip
    if rep["by_strategy"]:
        out.append("By strategy (ready / target 1 / invalidation / ended by Prism / unresolved, target-1 share of the decided, average R):")
        for name, s in rep["by_strategy"].items():
            share = "–" if s["target1_share_of_decided"] is None else f"{100 * s['target1_share_of_decided']:.0f}%"
            out.append(f"  {name}: {s['ready']} / {s['target1']} / {s['invalidation']} / {s['setup_ended']} / {s['unresolved']}, {share}, {_f(s['average_r'], plus=True)} R")
        t = rep["total"]
        out.append(f"  all: {t['ready']} ready; {t['target1']} reached target 1, {t['invalidation']} hit the invalidation, {t['setup_ended']} ended by Prism, {t['unresolved']} unresolved; average {_f(t['average_r'], plus=True)} R")
    if rep["never_ready"]:
        by = defaultdict(int)
        for n in rep["never_ready"]:
            by[(n["strategy_name"] or n["strategy"], n["end_code"])] += 1
        out.append(f"{len(rep['never_ready'])} setup(s) never reached READY_TO_ACT: " + "; ".join(f"{k[0]} ({k[1]}) x{v}" for k, v in sorted(by.items(), key=lambda kv: str(kv[0]))))
    out.append("A few sessions are a small sample: read this as a reason to look at a strategy again, not as proof.")
    return out


def _tally(label: str, s: dict) -> str:
    share = "–" if s["target1_share_of_decided"] is None else f"{100 * s['target1_share_of_decided']:.0f}%"
    run1 = "–" if s["run_1r_share"] is None else f"{100 * s['run_1r_share']:.0f}%"
    return (f"  {label}: {s['ready']} / {s['target1']} / {s['invalidation']} / {s['setup_ended']} / {s['unresolved']}, target-1 share {share}, average {_f(s['average_r'], plus=True)} R, "
            f"average run {_f(s['average_run_r'], plus=True)} R, ran 1 R or more {run1}")  # fmt: skip


def format_blocked(rep: dict, with_day: bool = False) -> list:
    """The near-miss section: each setup that was held back and would have been ready, what held it back, what it would have done, and the tallies by what held them back next to the ones called ready."""
    out = ["Setups that were NOT called ready, replayed as if they had been (hypothetical: index points, no cost or slippage; the entry is the price at the first moment the confirming candle had closed, the price was "
           "inside the entry area and something held it back; it was never offered)"]
    items = rep.get("blocked", [])
    if not items:
        out.append("  none: no setup was held back while its price was in the entry area.")
    for r in items:
        held = "; ".join(r["blockers"]) or "no blocker named (" + ("entries were not allowed" if "session" in r["kinds"] else "no fresh tick") + ")"
        head = f"{r['day'] + ' ' if with_day else ''}{_hm(r['ready_at'])} {r['direction']} {r['strategy_name']} {r['id'].rsplit(':', 1)[-1]}: held back by {' and '.join(KIND_WORDS[k] for k in r['kinds'])} ({held})"
        if r.get("outcome") is None:
            out.append(f"  {head}: {r.get('note') or 'not replayed'}")
            continue
        out.append(f"  {head}: entry {_f(r['entry'])} invalidation {_f(r['invalidation'])} risk {_f(r['risk'])} target1 {_f(r['target1'])}: {r['outcome']} at {_hm(r['exit_at'])} {_f(r['exit_price'])}"
                   f" = {_f(r['r'], plus=True)} R (ran {_f(r['run_r'], plus=True)} R before the invalidation)"
                   + (" [the same candle touched both: counted as the invalidation]" if r["ambiguous"] else "")
                   + (f" [Prism: {r['end_code']}]" if r["outcome"] == "setup_ended" and r.get("end_code") else ""))  # fmt: skip
    if rep.get("blocked_not_in_area"):
        out.append(f"  {len(rep['blocked_not_in_area'])} more setup(s) were held back but the price was never inside their entry area while they were: not replayed (nothing could have been entered)")
    if rep.get("blocked_by_kind"):
        out.append("By what held them back (setups / target 1 / invalidation / ended by Prism / unresolved):")
        for kind, s in rep["blocked_by_kind"].items():
            out.append(_tally(" + ".join(k for k in kind.split(" + ")), s))
        if rep["total"]["ready"]:
            out.append(_tally("for comparison, the ones called READY", rep["total"]))
    out.append("This says what the rules left on the table in these sessions, not what they should be: a few sessions are a small sample, and an entry that was never offered is not a trade you could have had.")
    return out


def analyse_file(path, candles_path=None, blocked: bool = False) -> dict:
    """Everything for one journal: its day, the review, the journal lines that could not be read, and why the candles were or were not available. Raises OSError when the journal cannot be read."""
    records, bad = read(path)
    day = journal_day(path, records)
    candles, why = None, ""
    try:
        if candles_path:
            candles = candles_from_file(candles_path)
        elif day is not None:
            candles = candles_from_db(day)
    except Exception as e:  # a database that is down must not cost the review of what the journal says
        candles, why = None, f"{type(e).__name__}: {e}"
    if candles is not None and not candles:
        candles, why = None, "the source holds no 1-minute candle for that day"
    return {"path": str(path), "day": day, "replayed": candles is not None, "reason": why, "bad": len(bad), "rep": review(records, candles, blocked)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Replay a decision journal's READY_TO_ACT setups (and with --blocked, the near misses) against the day's 1-minute candles (read-only; index points, not profit).")
    ap.add_argument("files", nargs="+", help="logs/decisions-YYYY-MM-DD.jsonl (several are reviewed day by day and then together)")
    ap.add_argument("--candles", help="a JSON file of one day's 1-minute candles instead of Prism DB (with one journal only)")
    ap.add_argument("--blocked", action="store_true", help="also replay the setups that were held back but would have been ready (the near misses), by what held them back")
    ap.add_argument("--json", action="store_true", help="the result as JSON")
    args = ap.parse_args(argv)
    files, unmatched = expand_paths(args.files)  # (the star is expanded here: PowerShell does not do it for a program)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if unmatched:
        print(f"{unmatched[0]}: no journal matches", file=sys.stderr)
        return 2
    if args.candles and len(files) > 1:
        ap.error("--candles is one day's candles: give it with one journal")
    days = []
    for f in files:
        try:
            days.append(analyse_file(f, args.candles, args.blocked))
        except OSError as e:
            print(f"{f}: cannot be read ({e.strerror or e})", file=sys.stderr)
            return 2
    many = len(days) > 1
    combined = merge([(d["day"], d["rep"]) for d in days]) if many else None
    if args.json:
        per_day = [{"day": str(d["day"]), "replayed": d["replayed"], "reason": d["reason"], **d["rep"]} for d in days]
        print(json.dumps({"days": per_day, "combined": combined} if many else per_day[0], indent=1, allow_nan=False, default=str))
        return 0
    for d in days:
        print("\n".join(format_report(d["day"], d["rep"], d["replayed"])))
        if args.blocked:
            print("\n".join(format_blocked(d["rep"])))
        if d["reason"]:
            print(f"(candles: {d['reason']})")
        if d["bad"]:
            print(f"({d['bad']} journal line(s) could not be read and were skipped)")
        if many:
            print()
    if many:
        replayed = [d for d in days if d["replayed"]]
        print(f"ALL {len(days)} DAYS TOGETHER ({len(replayed)} with candles to replay; the others count only what the journal says)")
        print(f"{combined['total']['ready']} called ready")
        for name, s in combined["by_strategy"].items():
            print(_tally(name, s))
        if args.blocked:
            print("\n".join(format_blocked(combined, with_day=True)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
