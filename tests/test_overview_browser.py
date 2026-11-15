"""The Overview in a REAL browser (headless Chrome or Edge, over its DevTools protocol; skipped, with the reason, when there is none): the built dashboard, served and drawn by the real application over a mocked
market (no broker, no database).

  * for each of the 14 pinned states the Overview draws what that state's own snapshot calls for: the decision (its word and its headline), the regime and the strategy monitor
  * the same when the page has LOST ITS LINK (a real server stopped): the last snapshot, dimmed, as history and never as a decision
  * it fits 1366x768 and 1920x1080 (scaled up by the large-screen zoom) with no scrollbar and no text under 10 px
  * its interactions work: the explanation opens over the page without moving it and stays open while the page updates, the links go to their tabs, the list of idle strategies opens and stays open

(Until the cutover the same states were compared, panel by panel, with the page that the dashboard replaced: the same elements, classes, tooltips and text. That proof is in the README, and the page is gone.)"""

import json

import pytest
from browser_support import BROWSER, WORD, browser, free_port, frozen, goto, keep, page, plain, run_server, served  # noqa: F401
from dashboard_harness import base_engine
from dashboard_states import STATES

from app.main import create_app

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the React Overview was not run in a real browser")

IDS = ["decision", "tfrow", "ctx", "setup-h", "setup", "strat", "rg", "dhs", "ev3"]
READ = (
    r"""(() => { const ids = __IDS__; const out = {};
    for (const id of ids) { const root = document.getElementById(id); out[id] = root ? {elements: root.querySelectorAll("*").length, text: root.textContent.replace(/\s+/g, " ").trim()} : null; }
    return out; })()"""
).replace("__IDS__", json.dumps(IDS))
LIVE_OVERVIEW = "document.getElementById('decision') && document.getElementById('decision').className.indexOf('loading') === -1 && document.getElementById('c-market').textContent !== 'CONNECTING'"


def open_overview(page, url):
    goto(page, url + "#overview")
    page.until(LIVE_OVERVIEW, timeout=30)


def test_the_overview_is_the_first_tab_and_is_drawn_from_the_real_engine(page, served):
    open_overview(page, served["url"])
    assert page.js("document.getElementById('decision').innerText.includes('CE SETUP')") and page.js("document.getElementById('decision').className") == "decision buy-ce"
    assert page.js("document.getElementById('rg').querySelectorAll('.rgc').length") == 6 and page.js("document.querySelectorAll('#tfrow .tf').length") == 4
    assert page.js("document.getElementById('tb-overview').getAttribute('aria-selected')") == "true"
    assert page.js("document.getElementById('jserr')") is None
    assert page.errors == [], page.errors


def test_the_overview_draws_what_each_states_snapshot_calls_for_in_every_state(page, served, tmp_path):
    md0 = served["app"].state.md
    seen = []
    try:
        for name, (build, action) in STATES.items():
            md = build(str(tmp_path))
            md.instance = {"pid": 0, "port": 0, "marker": name}
            md.on_change = md0.on_change
            snap = frozen(md)
            served["app"].state.md = md
            open_overview(page, served["url"])
            got = page.js(READ)
            decision = snap["trading"]["decision"]
            assert page.js("document.querySelector('#decision .dtxt').textContent.trim()") == WORD.get(action, action), name  # the word: CE SETUP, PE SETUP, WAIT, NO TRADE (the engine's value is BUY CE / BUY PE)
            assert " ".join(plain(decision["headline"]).split()) in got["decision"]["text"], f"{name}: the decision's headline is not on the page"
            assert all(got[i] is not None for i in IDS), (name, [i for i in IDS if got[i] is None])
            assert page.js("document.getElementById('rg').querySelectorAll('.rgc').length") == 6 and page.js("document.querySelectorAll('#tfrow .tf').length") == 4, name
            assert page.js("document.getElementById('jserr')") is None, name
            seen.append((name, got["decision"]["text"][:60], got["strat"]["elements"], got["ev3"]["elements"], got["rg"]["elements"]))
    finally:
        served["app"].state.md = md0
        md0.on_change()
    assert len(seen) == len(STATES) and len({s[1] for s in seen}) > 4, seen  # the states really differ (BUY, WAIT, NO TRADE, ...): the check looked at different things
    assert any(s[3] > 1 for s in seen) and any(s[2] > 8 for s in seen), seen  # some state had events in it, and some had a strategy monitor with rows
    assert page.errors == []


@pytest.mark.parametrize("state", ["buy_ce", "wait"])
def test_a_page_that_lost_its_link_says_so_and_keeps_the_last_snapshot_as_history(page, tmp_path, state):
    """The server is stopped under the page: it keeps the last snapshot, dimmed, and says it is not current."""
    build, action = STATES[state]
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": state}
    frozen(md)
    port = free_port()
    server, thread = run_server(create_app(md, feed=None), port)
    url = f"http://127.0.0.1:{port}/"
    try:
        open_overview(page, url)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    page.pause(0.4)
    got = page.js(READ)
    assert "STALE since" in got["decision"]["text"] and "NOT ACTIONABLE" in got["decision"]["text"] and "actionable now" not in got["decision"]["text"]
    assert "unknown: the page lost its link" in got["dhs"]["text"]
    assert float(page.js("getComputedStyle(document.querySelector('#tab-overview')).opacity")) < 1  # dimmed
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors  # (a page whose server is gone says so in the console)


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080)])
def test_it_fits_the_screen_with_no_scrollbar_and_no_text_under_10_px(page, served, tmp_path, width, height):
    served["md"].set_state("connected")
    page.size(width, height)
    open_overview(page, served["url"])
    page.pause(1.2)
    m = page.js(
        """(() => { const d = document.documentElement; let smallest = 99; const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode, p = n.parentElement; if (!n.textContent.trim() || !p) continue; const r = p.getBoundingClientRect(); if (!r.width || !r.height) continue; smallest = Math.min(smallest, parseFloat(getComputedStyle(p).fontSize)); }
        return {vw: innerWidth, vh: innerHeight, scrollW: d.scrollWidth, scrollH: d.scrollHeight, smallest}; })()"""
    )
    assert m["scrollH"] <= m["vh"], f"the Overview needs {m['scrollH']} px of a {m['vh']} px screen"
    assert m["scrollW"] <= m["vw"], f"the Overview is {m['scrollW']} px wide on a {m['vw']} px screen"
    assert m["smallest"] >= 10, m
    keep(page, tmp_path, f"react-overview-{width}x{height}")
    assert page.errors == []


def test_the_explanation_opens_over_the_page_without_moving_it_and_stays_open_while_the_page_updates(page, served):
    open_overview(page, served["url"])
    before = page.js("(() => { const r = document.getElementById('tfrow').getBoundingClientRect(); return [r.top, r.height]; })()")
    page.js("document.querySelector('details.pop > summary').click()")
    page.until("document.querySelector('details.pop .popbody').getBoundingClientRect().height > 100")
    assert page.js("(() => { const r = document.getElementById('tfrow').getBoundingClientRect(); return [r.top, r.height]; })()") == before  # it floats over the page: nothing moves
    text = page.js("document.querySelector('details.pop .popbody').innerText")
    assert "In plain words" in text and "What happened:" in text and "Setup expiry and invalidation" in text and "Underlying plan, index points from the trigger" in text
    page.pause(2.5)  # two more snapshots arrive
    assert page.js("document.querySelector('details.pop').open") is True
    assert page.errors == []


def test_the_links_go_to_their_tabs_and_the_idle_strategies_open_and_stay_open(page, served):
    open_overview(page, served["url"])
    page.js("document.querySelector('details.more > summary').click()")
    page.until("document.querySelector('details.more').open")
    page.pause(2.5)
    assert page.js("document.querySelector('details.more').open") is True and page.js("document.querySelectorAll('details.more tr').length") >= 5
    page.js("[...document.querySelectorAll('.linkbtn')].find(b => b.textContent.startsWith('Full journal')).click()")
    page.until("location.hash === '#journal'")
    assert page.js("[...document.querySelectorAll('section.tab')].filter(s => !s.hidden).map(s => s.id)") == ["tab-journal"]
    page.js("document.getElementById('tb-overview').click()")
    page.until("location.hash === '#overview'")
    page.js("[...document.querySelectorAll('.linkbtn')].find(b => b.textContent.startsWith('All ten strategies')).click()")
    page.until("location.hash === '#analysis'")
    assert page.errors == []


def test_a_server_that_stops_makes_the_overview_stale_and_a_new_one_brings_it_back(page):
    port = free_port()
    md, _ = base_engine()
    server, thread = run_server(create_app(md, feed=None), port)
    url = f"http://127.0.0.1:{port}/"
    try:
        open_overview(page, url)
        assert "eligible (actionable now)" in page.js("document.getElementById('decision').innerText")
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    head = page.js("document.getElementById('decision').innerText")
    assert "STALE since" in head and "NOT ACTIONABLE" in head and "actionable now" not in page.js("document.getElementById('main').innerText").lower()
    assert float(page.js("getComputedStyle(document.querySelector('#tab-overview')).opacity")) < 1  # dimmed
    md2, _ = base_engine()
    server2, thread2 = run_server(create_app(md2, feed=None), port)
    try:
        page.until("document.querySelector('.stalebar') === null && document.getElementById('decision').innerText.includes('CE SETUP')", timeout=30)
        assert float(page.js("getComputedStyle(document.querySelector('#tab-overview')).opacity")) == 1.0
    finally:
        server2.should_exit = True
        thread2.join(timeout=10)


# -- the engine's BUY wording is never on the page ----------------------------------------------------------------------------------------------------------------
def test_a_ready_setup_says_the_rules_were_met_and_that_it_is_not_a_recommendation_beside_its_headline(page, served):
    open_overview(page, served["url"])
    got = page.js(
        """(() => { const n = document.querySelector('#decision [data-testid=decision-note]'), h = document.querySelector('#decision .dhead'); const rn = n.getBoundingClientRect(), rh = h.getBoundingClientRect();
        return {note: n.textContent, title: n.title, visible: rn.width > 40 && rn.height > 8, beside: Math.abs((rn.top + rn.bottom) / 2 - (rh.top + rh.bottom) / 2) < 14 && rn.left > rh.left, head: h.textContent, word: document.querySelector('#decision .dtxt').textContent.trim()}; })()"""
    )
    assert got["word"] == "CE SETUP" and got["head"] == "CE setup ready: Trend Pullback setup confirmed", got
    assert got["note"] == "rules met · not a recommendation · no measured edge" and got["visible"] and got["beside"], got  # (drawn, and on the headline's own line)
    assert "no better than random entries" in got["title"] and "700 days" in got["title"], got["title"]
    assert page.errors == [], page.errors


@pytest.mark.parametrize("state", ["buy_ce", "buy_pe"])
def test_no_tab_of_the_real_page_says_buy_ce_or_buy_pe(page, tmp_path, state):
    """Every tab, in a real browser, for the engine's BUY CE and BUY PE: the words on the page (as the eye reads them) never say BUY CE or BUY PE."""
    import re

    from browser_support import LIVE

    build, _ = STATES[state]
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": state}
    frozen(md)
    port = free_port()
    server, thread = run_server(create_app(md, feed=None), port)
    url = f"http://127.0.0.1:{port}/"
    try:
        for tab in ("overview", "chart", "options", "analysis", "journal", "trades"):
            goto(page, url + "#" + tab)
            page.until(LIVE, timeout=30)
            page.pause(1.2)
            text = page.js("document.body.innerText")
            assert not re.search(r"BUY (CE|PE)", text, re.I), (state, tab, [m.group(0) for m in re.finditer(r".{0,40}BUY (CE|PE).{0,40}", text, re.I)][:3])
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors
