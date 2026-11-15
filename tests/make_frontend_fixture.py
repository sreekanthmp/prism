"""Write the real payloads the React dashboard's tests run on, from the engine itself, served the way the routes serve them.

    python tests/make_frontend_fixture.py            # rewrites frontend/src/test/fixtures/snapshot.json, chart.json, journal.json, trades.json and risk.json
    python tests/make_frontend_fixture.py trades     # rewrites only trades.json and risk.json

  * snapshot.json: the Phase 3 test world's engine (a real BUY CE, a NIFTY tick, option quotes), as /api/state serves it
  * chart.json: the same world's GET /api/chart?timeframe=5m at that moment (the last 60 5M candles, the BUY CE setup with its trigger, entry area, invalidation and targets)
  * journal.json: GET /api/journal of the same world after its pullback (three decisions, three setup events: the journal the engine really wrote, in a temporary folder)
  * trades.json: GET /api/trades of a trade log with three trades (two buys, one of them against Prism's decision, and a sell that closes part of them), written by the real TradeLog in a temporary folder
  * risk.json: GET /api/risk?entry=100&stop=80&lot=75 against limits of 1,00,000 capital, 2 % a trade and 5,000 a day

The fixtures are the engine's own output, not hand-written imitations: when a backend payload changes, `tests/test_frontend_foundation.py` says so (its key shape is compared with the engine's), and
this script is run again so the dashboard's tests read what the server really sends. Nothing here touches a broker, a database or the network."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]

from dashboard_harness import base_snapshot  # noqa: E402

FIXTURES = ROOT / "frontend" / "src" / "test" / "fixtures"
TARGET = FIXTURES / "snapshot.json"
CHART = FIXTURES / "chart.json"
JOURNAL = FIXTURES / "journal.json"
TRADES = FIXTURES / "trades.json"
RISK = FIXTURES / "risk.json"
CHART_LIMIT = 60


def chart_payload() -> dict:
    """GET /api/chart?timeframe=5m as the engine of the Phase 3 test world answers it at the BUY CE (06 Nov 2026, 10:55)."""
    from test_phase3_integration import World

    from app import chart

    w = World()
    md, clock = w.engine()
    out = w.step(md, clock, 19)
    assert out["decision"]["action"] == "BUY CE", out["decision"]["action"]
    return json.loads(json.dumps(chart.view(md, "5m", CHART_LIMIT), allow_nan=False))


def journal_payload() -> dict:
    """GET /api/journal as the route answers it for the BUY CE state of the test world (its journal is written to a temporary folder, and the folder's name, which is this PC's, is not kept)."""
    import tempfile

    from dashboard_states import STATES

    from app.main import create_app

    with tempfile.TemporaryDirectory() as folder:
        md = STATES["buy_ce"][0](folder)
        app = create_app(md, feed=None)
        app.state.md = md
        answer = next(r for r in app.routes if getattr(r, "path", "") == "/api/journal").endpoint()
    answer = json.loads(json.dumps(answer, allow_nan=False))
    answer["status"]["directory"] = "logs"
    return answer


def trades_payload() -> dict:
    """GET /api/trades as the real TradeLog answers it: a BUY of 150 that followed Prism's BUY CE, a BUY of 75 made while Prism said WAIT, and a SELL of 100 that closes the first lot and part of the second."""
    import tempfile
    from datetime import datetime

    from app import risk
    from app.candles import IST
    from app.trades import TradeLog

    day = datetime(2026, 11, 6, tzinfo=IST).timestamp()
    times = iter([day + 10 * 3600 + 40 * 60, day + 10 * 3600 + 50 * 60, day + 10 * 3600 + 55 * 60])
    now = [day + 11 * 3600]
    setup = base_snapshot()["trading"]["decision"]["setup_id"]
    with tempfile.TemporaryDirectory() as folder:
        log = TradeLog(folder, clock=lambda: now[0])
        for when, trade, prism in (
            (next(times), {"instrument": "NIFTY 24500 CE 17NOV", "side": "BUY", "qty": 150, "price": 100.5, "setup_id": setup, "note": "first lot"}, {"action": "BUY CE", "setup_id": setup, "strategy": "trend_pullback", "price": 24281.0}),
            (next(times), {"instrument": "NIFTY 24500 CE 17NOV", "side": "BUY", "qty": 75, "price": 95.0, "setup_id": None, "note": None}, {"action": "WAIT", "setup_id": None, "strategy": None, "price": 24262.5}),
            (next(times), {"instrument": "NIFTY 24500 CE 17NOV", "side": "SELL", "qty": 100, "price": 120.0, "setup_id": None, "note": "took part off"}, None),
        ):
            now[0] = when
            log.add(trade, prism)
        now[0] = day + 11 * 3600
        out = log.summary(risk.Limits(capital=100000.0, per_trade_pct=2.0, max_daily_loss=5000.0))
    out["file"] = "trades-2026-11-06.jsonl"
    return json.loads(json.dumps(out, allow_nan=False))


def risk_payload() -> dict:
    """GET /api/risk?entry=100&stop=80&lot=75 against 1,00,000 capital, 2 % a trade and 5,000 a day (nothing lost yet)."""
    from app import risk

    return json.loads(json.dumps(risk.size(100.0, 80.0, 75, risk.Limits(capital=100000.0, per_trade_pct=2.0, max_daily_loss=5000.0), 0.0), allow_nan=False))


def main(only_trades: bool = False) -> None:
    if only_trades:
        write_trades()
        return
    snap = base_snapshot()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(snap, indent=1, allow_nan=False, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size:,} bytes, {len(snap)} top-level keys)")
    payload = chart_payload()
    CHART.write_text(json.dumps(payload, indent=1, allow_nan=False, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {CHART.relative_to(ROOT)} ({CHART.stat().st_size:,} bytes, {len(payload['candles'])} candles, {len(payload['setups'])} setup(s))")
    answer = journal_payload()
    JOURNAL.write_text(json.dumps(answer, indent=1, allow_nan=False, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {JOURNAL.relative_to(ROOT)} ({JOURNAL.stat().st_size:,} bytes, {len(answer['decisions'])} decision(s), {len(answer['events'])} event(s))")
    write_trades()


def write_trades() -> None:
    summary = trades_payload()
    TRADES.write_text(json.dumps(summary, indent=1, allow_nan=False, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {TRADES.relative_to(ROOT)} ({TRADES.stat().st_size:,} bytes, {len(summary['trades'])} trade(s), realised {summary['realised']:.2f})")
    answer = risk_payload()
    RISK.write_text(json.dumps(answer, indent=1, allow_nan=False, sort_keys=False) + "\n", encoding="utf-8")
    print(f"wrote {RISK.relative_to(ROOT)} ({RISK.stat().st_size:,} bytes, {answer['lots']} lot(s))")


if __name__ == "__main__":
    main(only_trades=sys.argv[1:] == ["trades"])
