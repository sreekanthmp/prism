"""The Options tab, in a REAL browser, for every state the real engine can put a BUY in (every one of the ten strategies, on both sides) and for the decisions that are not a BUY: the engine of
tests/test_options_integration.py is asked for the decision (`flow`), its snapshot is served to the built dashboard, and the tab is read the way a trader reads it. What is held:

  * a BUY CE / BUY PE names its side, the strategy that made it and the setup, selects ONE contract of its own side (its symbol and strike, in the colour of its side), lists its alternatives, and highlights exactly
    that contract in a table that lists only the decision's side
  * the strategies that agree are listed as supporting information beside the one selection, and never make a second one
  * WAIT and NO TRADE are plainly informational: no contract is selected, both sides are listed to read, and the page says that only a BUY selects one
  * when no contract is fit, the tab says which findings ruled each one out

(These were the page's own script run under node, for the page the dashboard replaced; they are the same checks of the same engine states, now on the dashboard that is served.)"""

import json
from dataclasses import replace

import pytest
from browser_support import BROWSER, browser, free_port, goto, page, run_server  # noqa: F401
from test_options_integration import KIND, NAMES, NOW, SIDES, flow, live_engine, mutate

from app.main import create_app

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the Options tab was not run in a real browser")

READ = r"""(() => { const t = id => ((document.getElementById(id) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const big = document.querySelector('#opt-sel .big');
  const rows = [...document.querySelectorAll('#opt-table tr')].slice(1);  // (all but the header row)
  return {head: t('opt-head'), sel: t('opt-sel'), big: big ? big.className.trim().split(/\s+/) : null, rows: rows.length, selected: document.querySelectorAll('#opt-table tr.opt-sel').length,
          avoid: document.querySelectorAll('#opt-table tr.opt-avoid').length, kinds: [...document.querySelectorAll('#opt-table td.l')].map(c => c.textContent.trim()), jserr: document.getElementById('jserr') !== null}; })()"""
LIVE = "document.getElementById('opt-head') && document.getElementById('opt-head').textContent.trim() !== '–' && document.getElementById('c-market').textContent !== 'CONNECTING' && document.getElementById('opt-sel').textContent.length > 20"


@pytest.fixture(scope="module")
def world():
    """One application for the module; each case hands it the engine and the decision to serve."""
    md, _ = live_engine()
    app = create_app(md, feed=None)
    port = free_port()
    server, thread = run_server(app, port)
    yield {"app": app, "url": f"http://127.0.0.1:{port}/", "md": md}
    server.should_exit = True
    thread.join(timeout=10)


def rendered(page, world, md, payload):
    """The Options tab as the dashboard draws it from the snapshot the server pushes for this engine and this decision (held: one snapshot)."""
    md.safe_trading = lambda: payload
    snap = json.loads(json.dumps(md.snapshot(), allow_nan=False))
    md.snapshot = lambda: snap
    world["app"].state.md = md
    goto(page, world["url"] + "#options")
    page.until(LIVE, timeout=30)
    page.pause(0.4)
    got = page.js(READ)
    assert got["jserr"] is False, "the page's own error line is not empty: nothing may fail while drawing"
    return got


@pytest.mark.parametrize("name", NAMES)
@pytest.mark.parametrize("side", SIDES)
def test_the_options_tab_shows_the_side_the_originating_strategy_the_setup_and_a_consistent_contract(page, world, name, side):
    md, clock = live_engine()
    clock.t = NOW
    payload = flow(name, side)
    got = rendered(page, world, md, payload)
    d, kind = payload["decision"], KIND[side]
    sel = md.options_view(payload, NOW)["selection"]
    assert d["action"] in got["head"] and f"Option side {kind}" in got["head"]
    assert f"From {d['strategy_name']}" in got["head"] and f"setup {d['setup_id']}" in got["head"]  # who made the decision, and which setup
    chosen = sel["contract"]
    assert "Selected contract" in got["sel"] and f"{kind} {chosen['strike']:g}" in got["sel"] and chosen["symbol"] in got["sel"]
    assert got["big"] is not None and "big" in got["big"] and ("up" if kind == "CE" else "down") in got["big"]  # a call is green, a put red
    assert "No suitability warnings." in got["sel"] or "Suitability findings" in got["sel"]
    assert "Alternatives" in got["sel"] and all(f"{kind} {a['strike']:g}" in got["sel"] for a in sel["alternatives"]) and "No contract selected" not in got["sel"]
    other = "PE" if kind == "CE" else "CE"
    assert got["rows"] == 14 and got["kinds"].count(kind) == 14 and got["kinds"].count(other) == 0  # only the decision's side
    assert got["selected"] == 1  # the selected contract is the one highlighted in the table
    assert page.errors == []


def test_the_options_tab_lists_the_strategies_that_agree_as_supporting_information_beside_the_one_selection(page, world):
    md, clock = live_engine()
    clock.t = NOW
    payload = flow("trend_pullback", "bull")
    payload["decision"]["also"] = ["Range Bounce (same CE opportunity)", "Momentum Continuation (same CE opportunity)"]
    got = rendered(page, world, md, payload)
    assert "also matches: Range Bounce (same CE opportunity), Momentum Continuation (same CE opportunity)" in got["head"] and got["sel"].count("Selected contract") == 1
    assert got["head"].count("From ") == 1 and "From Trend Pullback" in got["head"]  # the one that was picked, once
    md2, clock2 = live_engine()
    clock2.t = NOW
    quiet = rendered(page, world, md2, flow("trend_pullback", "bull"))
    assert "also matches" not in quiet["head"]
    assert page.errors == []


@pytest.mark.parametrize("action,flags", [("WAIT", {"tick_age": 60.0}), ("NO TRADE", {"data_ok": False, "issues": ["historical data is stale: today's refresh has not completed"]})])
def test_wait_and_no_trade_are_plainly_informational_on_the_options_tab(page, world, action, flags):
    md, clock = live_engine()
    clock.t = NOW
    payload = flow("trend_pullback", "bull", **flags)
    got = rendered(page, world, md, payload)
    assert payload["decision"]["action"] == action and action in got["head"] and "Option side none" in got["head"] and "From " not in got["head"]
    if payload["decision"]["strategy_name"]:  # a WAIT about a setup (confirmed but not actionable) names it as a setup in view, never as the source of a contract
        assert "Setup in view (not a BUY, so no contract): Trend Pullback" in got["head"] and f"setup {payload['decision']['setup_id']}" in got["head"]
    assert "No contract selected" in got["sel"] and "informational: only a BUY CE / BUY PE decision selects a contract" in got["sel"]
    assert f"Phase 3 says {action}" in got["sel"] and "The table below is for information only" in got["sel"] and "Selected contract" not in got["sel"] and got["big"] is None
    assert got["rows"] == 28 and got["selected"] == 0  # both sides are listed to read, none is picked
    assert page.errors == []


def test_when_no_contract_is_fit_the_options_tab_says_which_findings_ruled_each_one_out(page, world):
    md, clock = live_engine()
    clock.t = NOW
    mutate(md, "CE", lambda t: replace(t, bid=None, bid_qty=None))
    got = rendered(page, world, md, flow("trend_pullback", "bull"))
    assert "From Trend Pullback" in got["head"] and "Setup in view" not in got["head"]  # it is still a BUY made by that strategy: only the contract is missing
    assert "No contract selected" in got["sel"] and "no suitable CE contract is available" in got["sel"] and got["sel"].count("the bid or the ask is not provided") >= 3
    assert got["selected"] == 0 and got["avoid"] == 14  # every call is marked as one that cannot be used
    assert page.errors == []
