"""The Options tab in a REAL browser (headless Chrome or Edge, over its DevTools protocol; skipped, with the reason, when there is none): the built dashboard, served and drawn by the real application over a
mocked market (no broker, no database).

  * for each of the 14 pinned states the tab says what that state's own snapshot calls for: the selected contract (its symbol, its side) or "No contract selected", the header bar, the comparison table
  * the same when the page has LOST ITS LINK (a real server stopped): "Last selected contract ... STALE since ...", never a contract on offer
  * it fits the screen: no sideways scroll at 1366x768, 1920x1080 and narrower widths, the contract card inside the width and the tables scrolling inside their own box
  * its interactions work: the list of ruled-out contracts opens by click and stays open while the page updates, and is open from the start when no contract is selected for a BUY

(Until the cutover the same states were compared, part by part, with the page that the dashboard replaced. That proof is in the README, and the page is gone.)"""

import json

import pytest
from browser_support import BROWSER, browser, free_port, frozen, goto, keep, page, run_server, served  # noqa: F401
from dashboard_states import STATES

from app.main import create_app

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the React Options tab was not run in a real browser")

IDS = ["opt-head", "opt-sel", "opt-info", "opt-exp", "opt-table", "opt-win"]
READ = (
    r"""(() => { const ids = __IDS__; const out = {};
    for (const id of ids) { const root = document.getElementById(id); out[id] = root ? {elements: root.querySelectorAll("*").length, text: root.textContent.replace(/\s+/g, " ").trim()} : null; }
    return out; })()"""
).replace("__IDS__", json.dumps(IDS))
LIVE_OPTIONS = "document.getElementById('opt-head') && document.getElementById('opt-head').textContent.trim() !== '–' && document.getElementById('c-market').textContent !== 'CONNECTING'"


def open_options(page, url):
    goto(page, url + "#options")
    page.until(LIVE_OPTIONS, timeout=30)


def test_the_options_tab_says_what_each_states_snapshot_calls_for_in_every_state(page, served, tmp_path):
    md0 = served["app"].state.md
    seen = []
    try:
        for name, (build, action) in STATES.items():
            md = build(str(tmp_path))
            md.instance = {"pid": 0, "port": 0, "marker": name}
            md.on_change = md0.on_change
            snap = frozen(md)
            served["app"].state.md = md
            open_options(page, served["url"])
            got = page.js(READ)
            chosen = ((snap.get("options") or {}).get("selection") or {}).get("contract")
            sel = got["opt-sel"]["text"]
            if chosen:  # a BUY with a contract: the card names it, and its side
                assert sel.startswith("Selected contract") and chosen["symbol"] in sel, (name, sel[:120])
            else:
                assert "Selected contract" not in sel and sel != "", (name, sel[:120])
            assert got["opt-head"]["text"] not in ("", "–") and got["opt-table"] is not None and page.js("document.getElementById('jserr')") is None, name
            seen.append((name, sel[:40], got["opt-sel"]["elements"], got["opt-table"]["elements"], got["opt-info"]["text"] != ""))
    finally:
        served["app"].state.md = md0
        md0.on_change()
    assert len(seen) == len(STATES) and len({s[1] for s in seen}) >= 3, seen  # a selected contract, "No contract selected" and an unavailable analysis: the states really differ
    assert any(s[2] > 80 for s in seen) and any(s[3] > 400 for s in seen), seen  # one state had a whole selected-contract card with its alternatives, and some listed both sides of the chain
    assert any(s[4] for s in seen) and any(not s[4] for s in seen), seen  # some were informational and some were not
    assert page.errors == []


@pytest.mark.parametrize("state", ["buy_ce", "wait"])
def test_a_page_that_lost_its_link_says_the_last_contract_is_not_current(page, tmp_path, state):
    """The server is stopped under the page: it keeps the last snapshot, dimmed, and says it is not current."""
    build, _ = STATES[state]
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": state}
    frozen(md)
    port = free_port()
    server, thread = run_server(create_app(md, feed=None), port)
    try:
        open_options(page, f"http://127.0.0.1:{port}/")
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    page.pause(0.4)
    got = page.js(READ)
    if state == "buy_ce":
        assert "Last selected contract" in got["opt-sel"]["text"] and "STALE since" in got["opt-sel"]["text"] and "not current, not actionable" in got["opt-sel"]["text"]
        assert "Last chosen for" in got["opt-sel"]["text"]
    else:
        assert "Selected contract" not in got["opt-sel"]["text"]  # (nothing was selected: nothing is on offer, stale or not)
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors  # (a page whose server is gone says so in the console)


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080), (1280, 720), (1100, 700), (900, 700)])
def test_it_fits_the_width_with_the_tables_scrolling_inside_their_own_box(page, served, tmp_path, width, height):
    served["md"].set_state("connected")
    page.size(width, height)
    open_options(page, served["url"])
    page.pause(1.0)
    m = page.js(
        """(() => { const d = document.documentElement, r = document.getElementById('opt-sel').getBoundingClientRect();
        return {vw: innerWidth, scrollW: d.scrollWidth, left: r.left, right: r.right, text: document.getElementById('opt-sel').innerText.toUpperCase(),
                selected: document.querySelectorAll('#opt-table tr.opt-sel').length}; })()"""
    )
    assert m["scrollW"] <= m["vw"], f"the Options tab is {m['scrollW']} px wide on a {m['vw']} px screen"
    assert 0 <= m["left"] and m["right"] <= width and m["text"].startswith("SELECTED CONTRACT")
    for needed in ("CHOSEN FOR CE SETUP FROM TREND PULLBACK", "ALSO MATCHES: NONE", "QUOTE AGE: RECEIVED", "QUOTE AGE: EXCHANGE TIME", "ALTERNATIVES", "BID × UNITS", "OPEN INTEREST (UNITS)"):
        assert needed in m["text"], needed
    assert m["selected"] == 1
    keep(page, tmp_path, f"react-options-{width}x{height}")
    assert page.errors == []


def test_it_says_no_contract_selected_when_the_decision_is_not_a_buy(page, served, tmp_path):
    md, clock = served["md"], served["clock"]
    md.set_state("disconnected", "the broker closed the connection (test)")
    md.down_since = clock.t - 6001  # no live connection: NO TRADE
    try:
        page.size(1366, 768)
        open_options(page, served["url"])
        page.until("document.getElementById('opt-sel').innerText.toUpperCase().includes('NO CONTRACT SELECTED')")
        text = page.js("document.getElementById('opt-sel').innerText").upper()
        assert text.startswith("NO CONTRACT SELECTED") and "FINAL DECISION: NO TRADE" in text and "CHOSEN FOR" not in text
        assert page.js("document.querySelectorAll('#opt-table tr.opt-sel').length") == 0 and page.js("document.querySelectorAll('#opt-table tr').length") > 20  # both sides listed, none picked
        assert page.js("document.documentElement.scrollWidth") <= 1366
        keep(page, tmp_path, "react-options-no-trade-1366x768")
        assert page.errors == []
    finally:
        md.set_state("connected")
        md.down_since = None


def test_the_ruled_out_list_is_open_from_the_start_for_a_buy_with_no_suitable_contract_and_stays_as_the_viewer_leaves_it(page, served, tmp_path):
    md0 = served["app"].state.md
    build, _ = STATES["no_suitable"]
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": "no_suitable"}
    md.on_change = md0.on_change
    frozen(md)
    served["app"].state.md = md
    try:
        open_options(page, served["url"])
        d = "document.querySelector('#opt-sel details.more')"
        assert page.js(f"{d} !== null") and page.js(f"{d}.open") is True  # a BUY with nothing suitable: the reasons are open, not hidden
        assert "ruled out (Avoid): why" in page.js(f"{d}.querySelector('summary').textContent")
        page.js(f"{d}.querySelector('summary').click()")  # the viewer closes it
        page.pause(2.5)  # two snapshots arrive
        assert page.js(f"{d}.open") is False  # ...and the page does not open it again
        assert page.errors == []
    finally:
        served["app"].state.md = md0
        md0.on_change()
