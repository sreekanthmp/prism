"""The Analysis tab in a REAL browser (headless Chrome or Edge, over its DevTools protocol; skipped, with the reason, when there is none): the built dashboard, served and drawn by the real application over a
mocked market (no broker, no database).

  * for each of the 14 pinned states the whole Analysis tab is drawn from that state's own snapshot: some six hundred elements and more (the warnings, the direction bar, the regime facts, the counter-trend
    permission, all ten strategies with each side and the reversal evidence, the ended setups, the explanation, the indicator tables, the structure, the levels, the candles, the health detail, the instruments, the
    gaps and errors)
  * the same when the page has LOST ITS LINK (a real server stopped): the last snapshot, with a ready setup said to have been ready
  * the sections that are open at the start are these, a strategy that holds a live setup opens by itself once, and what the reader opens or closes is kept while the page updates and while another tab is open
  * the link from the Overview's strategy monitor opens the Analysis tab with that strategy open and in view
  * it fits: no sideways scroll at 1366x768, 1920x1080 and narrower widths

(Until the cutover the same states were compared, element by element, with the page that the dashboard replaced. That proof is in the README, and the page is gone.)"""

import json

import pytest
from browser_support import BROWSER, browser, free_port, frozen, goto, keep, page, run_server, served  # noqa: F401
from dashboard_states import STATES

from app.main import create_app

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the React Analysis tab was not run in a real browser")

READ = (
    r"""(() => { const root = document.getElementById("analysis-body"); return root ? {elements: root.querySelectorAll("*").length + 1, strategies: root.querySelectorAll("details.sd").length,
      text: root.textContent.replace(/\s+/g, " ").trim()} : null; })()"""
)
LIVE_ANALYSIS = "document.getElementById('analysis-body') && document.getElementById('analysis-body').querySelectorAll('details.sec').length >= 3 && document.getElementById('c-market').textContent !== 'CONNECTING'"
OPEN_KEYS = "[...document.querySelectorAll('#analysis-body details[data-key], #analysis-body details.sec')].filter(d => d.open).map(d => d.dataset.key)"


def open_analysis(page, url):
    goto(page, url + "#analysis")
    page.until(LIVE_ANALYSIS, timeout=30)


def test_the_analysis_tab_is_drawn_whole_from_each_states_snapshot_in_every_state(page, served, tmp_path):
    md0 = served["app"].state.md
    seen = []
    try:
        for name, (build, action) in STATES.items():
            md = build(str(tmp_path))
            md.instance = {"pid": 0, "port": 0, "marker": name}
            md.on_change = md0.on_change
            frozen(md)
            served["app"].state.md = md
            open_analysis(page, served["url"])
            body = page.js(READ)
            assert body["strategies"] in (0, 10), (name, body["strategies"])  # all ten strategies, once each (none where there is no analysis yet)
            assert page.js("document.getElementById('jserr')") is None, name
            seen.append((name, body["elements"], "GRANTED" in body["text"], "Reversal evidence" in body["text"], "not available" in body["text"].lower()))
    finally:
        served["app"].state.md = md0
        md0.on_change()
    assert len(seen) == len(STATES) and all(s[1] > 600 for s in seen), seen  # a whole tab each time: some six hundred elements and more
    assert any(s[3] for s in seen) and any(s[2] for s in seen), seen  # a state that has the reversal evidence, and one with a counter-trend permission GRANTED
    assert page.errors == []


@pytest.mark.parametrize("state", ["buy_ce", "wait", "ter_buy_ce"])
def test_a_page_that_lost_its_link_says_a_ready_setup_was_ready_not_that_it_is(page, tmp_path, state):
    """The server is stopped under the page: it keeps the last snapshot, dimmed, and says a ready setup was ready, not that it is."""
    build, _ = STATES[state]
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": state}
    frozen(md)
    port = free_port()
    server, thread = run_server(create_app(md, feed=None), port)
    try:
        open_analysis(page, f"http://127.0.0.1:{port}/")
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    page.pause(0.4)
    got = page.js(READ)
    assert got["strategies"] == 10
    if state == "buy_ce":
        assert "was in the entry area (not current)" in got["text"] or "was ready" in got["text"]
        assert "last known (STALE): not actionable" in got["text"]
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors  # (a page whose server is gone says so in the console)


def test_the_sections_open_at_the_start_are_these_and_a_strategy_with_a_live_setup_opens_by_itself(page, served):
    open_analysis(page, served["url"])
    page.pause(0.8)
    new = page.js(OPEN_KEYS)
    assert {"a-strat", "a-tech", "a-struct", "a-levels", "a-setups", "a-health"} <= set(new) and "a-regime" not in new and "a-gaps" not in new
    assert "sd-trend_pullback" in new and "sd-breakout_retest" not in new  # the strategy that holds the BUY CE's setup is open, the others are not


def test_what_the_reader_opens_or_closes_is_kept_while_the_page_updates_and_while_another_tab_is_open(page, served):
    open_analysis(page, served["url"])
    page.js("document.querySelector('details[data-key=a-regime] > summary').click()")  # open one that is closed
    page.js("document.querySelector('details[data-key=a-tech] > summary').click()")  # close one that is open
    page.js("document.querySelector('details[data-key=sd-trend_pullback] > summary').click()")  # close the strategy that opened itself
    page.pause(2.5)  # two snapshots arrive
    assert page.js("document.querySelector('details[data-key=a-regime]').open") is True and page.js("document.querySelector('details[data-key=a-tech]').open") is False
    assert page.js("document.querySelector('details[data-key=sd-trend_pullback]').open") is False  # it opened by itself once: after that it is the reader's
    page.js("document.getElementById('tb-overview').click()")
    page.until("location.hash === '#overview'")
    page.js("document.getElementById('tb-analysis').click()")
    page.until("document.querySelectorAll('#analysis-body details.sec').length >= 3")
    assert page.js("document.querySelector('details[data-key=a-regime]').open") is True and page.js("document.querySelector('details[data-key=a-tech]').open") is False
    assert page.js("document.querySelector('details[data-key=sd-trend_pullback]').open") is False
    assert page.errors == []


def test_the_overviews_link_to_a_strategy_opens_it_and_brings_it_into_view(page, served):
    page.size(1366, 768)
    goto(page, served["url"] + "#overview")
    page.until("document.getElementById('decision') && document.getElementById('decision').className.indexOf('loading') === -1")
    page.js("document.querySelector('details.more > summary').click()")  # the strategies without a setup
    page.until("document.querySelector('details.more').open")
    page.js("[...document.querySelectorAll('details.more .linkbtn')].find(b => b.closest('tr').textContent.startsWith('Range Reversal')).click()")
    page.until("location.hash === '#analysis'")
    page.until("document.querySelector('details[data-key=sd-range_reversal]') && document.querySelector('details[data-key=sd-range_reversal]').open")
    page.pause(0.6)
    box = page.js("(() => { const r = document.querySelector('details[data-key=sd-range_reversal]').getBoundingClientRect(); return {top: r.top, bottom: r.bottom, vh: innerHeight}; })()")
    assert 88 <= box["top"] < box["vh"] and page.js("document.querySelector('details[data-key=a-strat]').open") is True  # the section and the strategy are open, and the strategy is on the screen below the header and the tab bar (88 px)
    page.js("document.getElementById('tb-overview').click()")
    page.until("location.hash === '#overview'")
    page.js("[...document.querySelectorAll('.linkbtn')].find(b => b.textContent.startsWith('All ten strategies')).click()")
    page.until("location.hash === '#analysis'")
    assert page.js("document.querySelector('details[data-key=a-strat]').open") is True
    assert page.errors == []


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080), (1280, 720), (1100, 700), (900, 700)])
def test_it_fits_the_width_with_the_tables_scrolling_inside_their_own_box(page, served, tmp_path, width, height):
    page.size(width, height)
    open_analysis(page, served["url"])
    for key in ("a-regime", "a-ct", "a-candles", "a-contracts", "a-gaps"):  # everything open: the widest content
        page.js(f"(() => {{ const d = document.querySelector('details[data-key={key}]'); if (!d.open) d.querySelector('summary').click(); }})()")
    page.pause(0.8)
    m = page.js("(() => { const d = document.documentElement; return {vw: innerWidth, scrollW: d.scrollWidth}; })()")
    assert m["scrollW"] <= m["vw"], f"the Analysis tab is {m['scrollW']} px wide on a {m['vw']} px screen"
    keep(page, tmp_path, f"react-analysis-{width}x{height}")
    assert page.errors == []
