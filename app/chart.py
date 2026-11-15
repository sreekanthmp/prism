"""What the React dashboard's Chart tab draws (Stage 9.2): NIFTY's candles, and on them only what Prism itself has already computed.

Nothing here is new analysis, and nothing here writes. Every number is one the rest of Prism shows or journals:
  * candles: the same completed series the analysis reads (Prism DB / Angel One history and the live builder, merged), plus the candle still forming
  * the 20 and 50 EMA, the confirmed swing highs and lows (analysis.swings), the previous day's high, low and close, the session open, and the nearest support and resistance levels
  * the live setups the decision is made from: trigger, entry area, invalidation and the targets the plan names, as `/api/trading` gives them
There is no candlestick-pattern detection, no chart-pattern detection and no scorecard: this stage draws what Prism already says, it does not add opinions.

It reads memory only (the history and candles Prism already holds) and the last settled decision (`reading()`): no database or broker call, no lifecycle step, no journal line.
The window is therefore what Prism holds: about 5 sessions of 1M, 14 days of 5M, 70 days of 15M and 45 days of daily candles. A candle that does not exist is not drawn: nothing is invented."""

import math
from datetime import datetime

from . import analysis as an
from .candles import IST
from .engine import reading
from .series import completed_series, contiguity

SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400}
TIMEFRAMES = tuple(SECONDS)
DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT = 300, 10, 2000
MAX_SWINGS = 40  # the most recent confirmed pivots on the chart: older ones only crowd it
EMAS = (20, 50)
SETUP_KEYS = ("id", "strategy", "strategy_name", "direction", "side", "status", "stage", "stage_text", "actionable", "trigger", "zone", "invalidation", "detected_at", "confirmed_at")
FACT_KEYS = ("trend", "adx", "rsi14", "atr14_intraday", "ema20", "ema50", "bars", "warm")


def clean(x):
    """The same data with every number that is not a finite one (NaN, infinity) as None: JSON has no such number, and one of them must not turn the whole chart into an error."""
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    return x


def ist_date(ts: float) -> str:
    return datetime.fromtimestamp(ts, IST).date().isoformat()


def stamp(ts: float, daily: bool) -> dict:
    """A moment on the chart: epoch seconds, and for a daily candle also the IST calendar day (a daily candle sits on a day, not on a second)."""
    return {"time": ts, "date": ist_date(ts)} if daily else {"time": ts}


def ok(c) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in (c.open, c.high, c.low, c.close))


def candle_row(c, daily: bool) -> dict:
    return {**stamp(c.start, daily), "open": c.open, "high": c.high, "low": c.low, "close": c.close}


def view(md, timeframe: str, limit: int = DEFAULT_LIMIT) -> dict:
    """The chart's data for one timeframe. Raises ValueError for a timeframe that is not one of TIMEFRAMES. Read-only by construction: the decision is read inside `reading()`."""
    if timeframe not in SECONDS:
        raise ValueError(f"timeframe must be one of {list(TIMEFRAMES)}")
    limit = max(MIN_LIMIT, min(int(limit), MAX_LIMIT))
    secs, daily = SECONDS[timeframe], timeframe == "1d"
    with md.lock, reading():
        now = md.clock()
        a = md.safe_analysis()
        head = {"available": False, "timeframe": timeframe, "seconds": secs, "as_of": now}
        if not a.get("available") or md.history is None:
            return clean({**head, "reason": (a.get("warnings") or ["the market analysis is not available"])[0], "candles": [], "forming": None, "setups": []})
        spot = next((c.token for c in md.contracts if c.role == "SPOT"), None)
        closed = list(md.history.get("1d", ())) if daily else completed_series(md.history, md.builder, spot, timeframe)
        dropped = sum(1 for c in closed if not ok(c))
        closed = [c for c in closed if ok(c)]
        if daily:  # one bar per calendar day: two on the same day cannot be drawn (the last one wins)
            closed = list({ist_date(c.start): c for c in closed}.values())
        shown = closed[-limit:]
        first = shown[0].start if shown else None

        f = None if daily or md.builder is None or spot is None else md.builder.current.get((spot, timeframe))
        forming = None
        if f is not None and ok(f) and (not shown or f.start > shown[-1].start):  # a candle still forming is newer than every closed one, or it is not drawn
            forming = {**candle_row(f, False), "partial": bool(f.partial), "ticks": f.ticks}

        win = closed[-an.WINDOW:]  # the engine's own window: the last EMA point is the EMA the Analysis tab shows
        closes = [c.close for c in win]
        lines = {f"ema{n}": [{**stamp(c.start, daily), "value": v} for c, v in zip(win, an.ema(closes, n)) if v is not None and first is not None and c.start >= first] for n in EMAS}
        pivots = an.swings(shown, an.SWING_K, contiguity(shown, secs))
        swings = [{**stamp(shown[i].start, daily), "kind": kind, "price": p} for i, kind, p in pivots][-MAX_SWINGS:]

        tf = a["timeframes"].get(timeframe)
        facts = {k: tf.get(k) for k in FACT_KEYS} if tf else None  # (the daily candles are not analysed: the engine reads no daily trend)
        ref, lv = a.get("reference") or {}, a.get("levels") or {}
        levels = {"previous_day": ref.get("previous_day"), "session_open": ref.get("session_open"), "session_date": ref.get("session_date"),
                  "support": list(lv.get("support") or []), "resistance": list(lv.get("resistance") or [])}  # fmt: skip

        t = md.safe_trading() or {}
        d = t.get("decision") or {}
        setups = []
        for s in t.get("setups") or []:
            row = {k: s.get(k) for k in SETUP_KEYS}
            row["zone"] = list(s["zone"]) if s.get("zone") else None
            row["targets"] = [{"n": x.get("n"), "price": x.get("price"), "label": x.get("label")} for x in ((s.get("plan") or {}).get("targets") or []) if isinstance(x, dict)]
            row["focus"] = bool(d.get("setup_id")) and s.get("id") == d.get("setup_id")
            setups.append(row)

        notes = []
        if daily:
            notes.append("Daily candles come from Prism's history: today's bar appears once the history has it.")
        if len(closed) < limit:
            notes.append(f"Prism holds {len(closed)} {timeframe} candles, and that is all there is to draw.")
        if dropped:
            notes.append(f"{dropped} candle(s) with a price that is not a number were left out.")
        return clean({**head, "available": True, "session_date": ref.get("session_date"), "price": a.get("price"), "reliable": bool(a.get("reliable")), "warnings": list(a.get("warnings") or []),
                      "notes": notes, "candles": [candle_row(c, daily) for c in shown], "forming": forming, **lines, "swings": swings, "facts": facts, "levels": levels,
                      "setups": setups, "decision": {"action": d.get("action"), "setup_id": d.get("setup_id")},
                      "window": {"returned": len(shown), "held": len(closed), "limit": limit, "first": first, "last": shown[-1].start if shown else None}})  # fmt: skip
