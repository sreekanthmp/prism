"""The real engine the dashboard's tests are run on (the page they once ran the dashboard's script on is gone; the engine is what they all need).

    base_engine()    (md, clock): the Phase 3 test world after its pullback has confirmed (a real BUY CE), with a NIFTY spot tick and 28 option contracts with quotes: the engine itself, so it can be served
    base_snapshot()  what /api/state returns on that world: real analysis, real decision, real health
    variant(base, **sections)   a deep copy of that snapshot with whole sections replaced by what a scenario says

The dashboard is the React one (frontend/); its tests run it under jsdom on the engine's own snapshot (frontend/src/test/fixtures, written by tests/make_frontend_fixture.py) and in a real browser against the
real application (tests/browser_support.py)."""

import copy
import json
from datetime import date, datetime
from pathlib import Path

from helpers import SPOT_TOKEN, master_rows
from test_options import snap as option_snap
from test_phase3_integration import World

from app.candles import IST
from app.instruments import Chain

ROOT = Path(__file__).resolve().parent.parent


def dashboard_source() -> str:
    """The text of the dashboard's own source (frontend/src, without its tests): what a test that holds the wording of the page reads."""
    src = ROOT / "frontend" / "src"
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted(src.rglob("*")) if p.suffix in (".ts", ".tsx") and ".test." not in p.name and "test" not in p.relative_to(src).parts)


# ---- a real snapshot: the engine's own, with a NIFTY spot tick, an option window with quotes, a real analysis and a real BUY CE (the Phase 3 test world) -----------------------------
def base_engine():
    """(md, clock): the Phase 3 test world after its pullback has confirmed (a real BUY CE), with a NIFTY spot tick and 28 option contracts with quotes. The engine itself, so it can be served."""
    w = World()
    md, clock = w.engine()
    for slot in (16, 17, 18, 19):
        w.step(md, clock, slot)
        md.safe_trading()
    now, spot = clock.t, w.at(37)
    chain = Chain(master_rows(lo=24000, hi=26000), datetime.fromtimestamp(now, IST))
    window = chain.window(spot)
    md.set_contracts(window.contracts, date(2026, 11, 6), spot)
    md.set_chain(chain, spot, window.contracts)
    md.set_state("connected")
    md.on_message({"subscription_mode": 2, "exchange_type": 1, "token": SPOT_TOKEN, "last_traded_price": int(spot * 100), "exchange_timestamp": int((now - 1) * 1000)})
    for c in md.contracts:
        if not c.kind:
            continue
        intrinsic = max(spot - c.strike, 0) if c.kind == "CE" else max(c.strike - spot, 0)
        price = round(intrinsic + 45.0 - abs(spot - c.strike) / 20, 2)
        md.on_message(option_snap(c.token, price, now - 2, bid=(price - 0.15, 600), ask=(price + 0.15, 600), volume=2_000_000, oi=3_000_000, ltt=now - 20))
    clock.t = now + 1
    return md, clock


def base_snapshot() -> dict:
    """What /api/state returns on that world: real analysis, real decision, real health."""
    md, _ = base_engine()
    return json.loads(json.dumps(md.snapshot(), allow_nan=False))


def variant(base: dict, **sections) -> dict:
    """A deep copy of the snapshot with whole sections (trading, health, options, ...) replaced by what a scenario says."""
    out = copy.deepcopy(base)
    for k, v in sections.items():
        out[k] = json.loads(json.dumps(v, allow_nan=False))
    return out
