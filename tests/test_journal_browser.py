"""The Journal tab in a REAL browser (headless Chrome or Edge, over its DevTools protocol; skipped, with the reason, when there is none): the built dashboard, served and drawn by the real application over a
mocked market (no broker, no database). The Journal is the tab that reads a route of its own (GET /api/journal, the journal file condensed), so these tests run against the real route of each state's engine.

  * for each of the 14 pinned states the tab is drawn from that state's snapshot and the journal the engine wrote: the bar, the decision history, the lifecycle of the setups, the ended setups, every event, the
    explanation, the trades note (or, for a state with no journal, the live events and the words that say so)
  * the same when the page has LOST ITS LINK (a real server stopped): the last snapshot and the journal it had read, dimmed
  * the page only READS, and rarely: one GET /api/journal when the tab is opened, none while snapshots arrive, none when the tab is left and entered again with nothing changed, one more for each click of Refresh
  * it fits: no sideways scroll at 1366x768, 1920x1080 and narrower widths, the tables scrolling inside their own box

(Until the cutover the same states were compared, element by element, with the page that the dashboard replaced. That proof is in the README, and the page is gone.)"""

import json

import pytest
from browser_support import BROWSER, browser, free_port, frozen, goto, keep, page, run_server, served  # noqa: F401
from dashboard_states import STATES

from app.main import create_app

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the React Journal tab was not run in a real browser")

READ = (
    r"""(() => { const root = document.getElementById("journal-body"); return root ? {elements: root.querySelectorAll("*").length + 1, text: root.textContent.replace(/\s+/g, " ").trim()} : null; })()"""
)
LIVE_JOURNAL = (
    "document.getElementById('journal-body') && document.querySelectorAll('#journal-body details.sec').length >= 3 && !document.getElementById('journal-body').textContent.includes('loading…')"
    " && document.getElementById('c-market').textContent !== 'CONNECTING'"
)
READS = "performance.getEntriesByType('resource').filter(e => e.name.includes('/api/journal')).length"


def open_journal(page, url):
    goto(page, url + "#journal")
    page.until(LIVE_JOURNAL, timeout=30)


def settled(md):
    """The engine, brought to where the application's ticker would bring it before any page reads its journal. The ticker runs the feed watchdog and evaluates the decision once a second on whatever engine the
    application serves, and either can APPEND a record to the journal the first time (a stale price opens a gap in the feed and the decision changes; a closed market or a lost feed likewise): two reads of the journal on
    either side of that write would differ, and a test that compares two dashboards must not depend on which side it was. Done here, in the ticker's own order, until the journal stops growing, the ticker has nothing
    left to add."""
    seen = -1
    for _ in range(6):
        md.watchdog()
        md.safe_trading()
        j = getattr(md, "journal", None)
        now = len(j.load_day(md.clock())) if j is not None else 0
        if now == seen:
            break
        seen = now
    return md


def test_the_journal_tab_is_drawn_from_each_states_journal_in_every_state(page, served, tmp_path):
    md0 = served["app"].state.md
    seen = []
    try:
        for name, (build, action) in STATES.items():
            md = build(str(tmp_path))
            md.instance = {"pid": 0, "port": 0, "marker": name}
            md.on_change = md0.on_change
            frozen(settled(md))
            served["app"].state.md = md
            open_journal(page, served["url"])
            body = page.js(READ)
            journal = md.journal.load_day(md.clock()) if getattr(md, "journal", None) is not None else None
            if journal is not None:  # the engine wrote a journal: the tab says how many records it has and shows what they hold
                assert f"{len(journal)} records)" in body["text"], (name, body["text"][:200])
            else:
                assert "showing the live events only" in body["text"], (name, body["text"][:200])
            assert page.js("document.getElementById('jserr')") is None, name
            seen.append((name, body["elements"], "records)" in body["text"], "showing the live events only" in body["text"], "no decision has been recorded" in body["text"]))
    finally:
        served["app"].state.md = md0
        md0.on_change()
    assert len(seen) == len(STATES) and any(s[2] for s in seen) and any(s[1] > 150 for s in seen), seen  # a journal that was read, and a whole tab of decisions and events
    assert any(s[3] for s in seen) or all(s[2] for s in seen), seen  # (a state with no journal says so: where the engine has none)
    assert page.errors == []


@pytest.mark.parametrize("state", ["buy_ce", "wait"])
def test_a_page_that_lost_its_link_keeps_the_journal_it_had_read(page, tmp_path, state):
    """The server is stopped under the page: it keeps the last snapshot and the journal it had read, dimmed."""
    build, _ = STATES[state]
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": state}
    frozen(settled(md))
    port = free_port()
    server, thread = run_server(create_app(md, feed=None), port)
    try:
        open_journal(page, f"http://127.0.0.1:{port}/")
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    page.pause(0.4)
    got = page.js(READ)
    assert "records)" in got["text"] and page.js("document.querySelectorAll('#journal-body details.sec').length") >= 3
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors  # (a page whose server is gone says so in the console)


def test_the_page_only_reads_the_journal_when_it_is_opened_when_something_changed_and_when_asked(page, served):
    open_journal(page, served["url"])
    assert page.js(READS) == 1
    page.pause(3.5)  # snapshots arrive every second: none of them is a reason to read the journal again
    assert page.js(READS) == 1
    page.js("document.getElementById('tb-overview').click()")
    page.until("location.hash === '#overview'")
    page.js("document.getElementById('tb-journal').click()")
    page.until("document.querySelectorAll('#journal-body details.sec').length >= 3")
    page.pause(0.8)
    assert page.js(READS) == 1  # left and entered again with nothing changed: the journal the page has is the journal
    page.js("document.getElementById('j-refresh').click()")
    page.until(f"{READS} === 2")
    page.js("document.getElementById('j-refresh').click()")
    page.until(f"{READS} === 3")
    origin = served["url"].rstrip("/")
    entries = page.js("performance.getEntriesByType('resource').map(e => e.name)")
    assert all(e.startswith(origin) for e in entries), [e for e in entries if not e.startswith(origin)]  # nothing of another site
    assert page.errors == []


def with_a_journal(served, tmp_path, name="buy_ce"):
    """The served application, with the engine of a state that has written a journal (the default test engine has none): returns what puts the first one back."""
    md0 = served["app"].state.md
    md = STATES[name][0](str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": name}
    md.on_change = md0.on_change
    frozen(settled(md))
    served["app"].state.md = md

    def back():
        served["app"].state.md = md0
        md0.on_change()

    return back


def test_the_sections_open_at_the_start_are_the_decision_history_and_the_lifecycle_and_what_the_reader_opens_is_kept(page, served, tmp_path):
    back = with_a_journal(served, tmp_path)
    try:
        open_journal(page, served["url"])
        opened = "[...document.querySelectorAll('#journal-body > details.sec')].filter(d => d.open).map(d => d.dataset.key)"
        assert page.js(opened) == ["j-decisions", "j-lifecycle"]
        page.js("document.querySelector('details[data-key=j-events] > summary').click()")
        page.pause(0.4)
        page.js("document.getElementById('tb-overview').click()")
        page.until("location.hash === '#overview'")
        page.js("document.getElementById('tb-journal').click()")
        page.until("document.querySelectorAll('#journal-body details.sec').length >= 3")
        assert page.js(opened) == ["j-decisions", "j-lifecycle", "j-events"]
        assert page.errors == []
    finally:
        back()


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080), (1280, 720), (1100, 700), (900, 700)])
def test_it_fits_the_width_with_the_tables_scrolling_inside_their_own_box(page, served, tmp_path, width, height):
    back = with_a_journal(served, tmp_path)  # a journal with decisions and events: the widest content
    try:
        page.size(width, height)
        open_journal(page, served["url"])
        page.js("document.querySelector('details[data-key=j-events] > summary').click()")
        page.pause(0.8)
        m = page.js("(() => { const d = document.documentElement; return {vw: innerWidth, scrollW: d.scrollWidth, rows: document.querySelectorAll('details[data-key=j-decisions] tr').length}; })()")
        assert m["scrollW"] <= m["vw"], f"the Journal tab is {m['scrollW']} px wide on a {m['vw']} px screen"
        assert m["rows"] >= 4  # (the header and the three decisions: this really was the wide one)
        keep(page, tmp_path, f"react-journal-{width}x{height}")
        assert page.errors == []
    finally:
        back()
