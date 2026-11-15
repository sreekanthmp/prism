"""The dashboard's foundation in a REAL browser (headless Chrome or Edge on this machine, over its DevTools protocol; skipped, with the reason, when there is none), on the real application and the real
WebSocket, over a mocked market (no broker, no database): the built dashboard, served at the root and drawn.

  * it connects to /ws by itself and draws the live header of the real engine
  * its header says what each one of the pinned states' own snapshot says (market open / closed, feed down, a stale spot, not ready, BUY, WAIT, ...): the four chips, the price and the one alert line
  * it fits 1366x768 and 1920x1080 (scaled up by the large-screen zoom) with no sideways scroll, no console error and no text under 10 px
  * the stale contract holds for real: stop the server and the page says STALE, goes UNKNOWN on every chip and keeps the last price dimmed; start it again and the page reconnects by itself and is live,
    drawn from the new snapshot alone"""

import json
import threading
import time

import pytest
from browser_support import BROWSER, browser, free_port, goto, page, served  # noqa: F401
from dashboard_harness import base_engine
from dashboard_states import STATES

from app.main import create_app

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the React dashboard was not run in a real browser")

HEADER_IDS = ["c-market", "c-feed", "c-data", "c-ready", "spot", "spot-chg", "spot-age", "hsum", "clock"]
READ_HEADER = (
    "(() => { const out = {}; for (const id of %s) { const e = document.getElementById(id); out[id] = e ? {text: e.textContent, cls: e.className, title: e.title} : null; } "
    "const a = document.querySelector('#alerts details, [data-testid=alert-line]'); out.alert = a ? {text: a.querySelector('summary').textContent.replace(/\\s+/g, ' ').trim(), cls: a.className.replace(/ ?(open)/, '').trim()} : null; "
    "return out; })()"
) % json.dumps(HEADER_IDS)


def expected_header(snap):
    """What the header and the one alert line must say for a snapshot, worked out from the snapshot alone (the rules of the page, stated again here so that a change to them is a change to this test)."""
    h, c = snap["health"], snap["connection"]
    rd = h.get("readiness")
    spot = next((i for i in snap["instruments"] if i["role"] == "SPOT"), None)
    ready = "WAITING" if rd is None else ("READY FOR OPEN" if rd["pre_market"] else "SYSTEM READY") if rd["ready"] else "NOT READY: " + rd["state"].replace("_", " ")
    return {
        "c-market": "MARKET OPEN" if h["live"] else "MARKET CLOSED",
        "c-feed": "FEED " + c["state"].replace("_", " ").upper(),
        "c-data": ("DATA TRUSTED" if h["trusted"] else "DATA NOT TRUSTED") if h["live"] else "DATA NOT LIVE",
        "c-ready": ready,
        "spot": f"{spot['ltp']:.2f}" if spot and spot["ltp"] is not None else "–",
        "alert": bool((rd and not rd["ready"]) or h.get("issues") or h.get("warnings")),
    }


def live_app(page, url):
    goto(page, url)
    page.until("(document.getElementById('c-market') || {}).textContent && document.getElementById('c-market').textContent !== 'CONNECTING'", timeout=30)


def test_the_react_dashboard_connects_by_itself_and_draws_the_live_header_of_the_real_engine(page, served):
    live_app(page, served["url"])
    h = page.js(READ_HEADER)
    assert [h[i]["text"] for i in ("c-market", "c-feed", "c-data")] == ["MARKET OPEN", "FEED CONNECTED", "DATA TRUSTED"]
    assert h["c-ready"]["text"] == "SYSTEM READY" and h["spot"]["text"] == "24287.00" and h["alert"] is None
    assert page.js("document.title") == "Prism" and page.js("document.querySelectorAll('[role=tab]').length") == 6
    assert page.js("document.querySelector('.stalebar')") is None
    assert page.errors == []


def test_its_header_says_what_each_states_snapshot_says_in_every_state(page, served, tmp_path):
    """The engine of each pinned state is served in turn (one snapshot, held, so that the page and the test read the same one), and the page's four chips, its price and its one alert line are what that snapshot calls for."""
    md0 = served["app"].state.md
    seen = []
    try:
        for name, (build, _action) in STATES.items():
            md = build(str(tmp_path))
            md.instance = {"pid": 0, "port": 0, "marker": name}
            md.on_change = md0.on_change
            frozen = json.loads(json.dumps(md.snapshot(), allow_nan=False))  # the first snapshot of an engine computes its whole analysis: done here, not while a page waits
            md.snapshot = lambda frozen=frozen: frozen  # ... and every push and read now says exactly that (an engine's readiness moves on as it runs)
            served["app"].state.md = md
            live_app(page, served["url"])
            got = page.js(READ_HEADER)
            want = expected_header(frozen)
            assert {k: got[k]["text"] for k in ("c-market", "c-feed", "c-data", "c-ready", "spot")} == {k: want[k] for k in ("c-market", "c-feed", "c-data", "c-ready", "spot")}, name
            assert (got["alert"] is not None) == want["alert"], f"{name}: alert line {got['alert']} for readiness {frozen['health'].get('readiness')}"
            seen.append((name, got["c-ready"]["text"], got["alert"] is not None))
    finally:
        served["app"].state.md = md0
        md0.on_change()
    assert len(seen) == len(STATES) and len({s[1] for s in seen}) > 1, seen  # (the states really differ: not ready, ready, ... so the check looked at something)
    assert any(s[2] for s in seen), "no state had an alert line, so the alert line was never checked"
    assert page.errors == []


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080)])
def test_it_fits_the_screen_with_no_sideways_scroll_no_console_error_and_no_tiny_text(page, served, width, height):
    page.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)
    live_app(page, served["url"])
    m = page.js(
        """(() => { const d = document.documentElement; let smallest = 99;
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode, p = n.parentElement, t = n.textContent.trim();
          if (!t || !p || ['SCRIPT','STYLE'].includes(p.tagName)) continue; const r = p.getBoundingClientRect(); if (!r.width || !r.height) continue;
          smallest = Math.min(smallest, parseFloat(getComputedStyle(p).fontSize)); }
        const top = document.getElementById('top').getBoundingClientRect(), tabs = document.getElementById('tabs').getBoundingClientRect();
        return {scrollW: d.scrollWidth, vw: innerWidth, scrollH: d.scrollHeight, vh: innerHeight, smallest, topH: top.height, tabsTop: tabs.top, tabsBottom: tabs.bottom}; })()"""
    )
    assert m["scrollW"] <= m["vw"], m
    assert m["scrollH"] <= m["vh"], m  # the whole page, today a header, the tab bar and a note, is one screen
    assert m["smallest"] >= 10, m
    z = page.js("parseFloat(getComputedStyle(document.body).zoom)")  # (the large-screen zoom: the header is 56 px and the tab bar 32 px, times it)
    assert m["topH"] <= 60 * z and m["tabsTop"] >= m["topH"] - 1 and m["tabsBottom"] <= 100 * z, (z, m)
    assert page.errors == []
    page.call("Emulation.clearDeviceMetricsOverride")


def test_the_tabs_work_by_click_by_keyboard_and_by_address_in_a_real_browser(page, served):
    live_app(page, served["url"])
    visible = "[...document.querySelectorAll('section.tab')].filter(s => !s.hidden).map(s => s.id)"
    for tab in ("chart", "options", "analysis", "journal", "trades", "overview"):
        page.js(f"document.getElementById('tb-{tab}').click()")
        page.until(f"location.hash === '#{tab}'")
        assert page.js(visible) == [f"tab-{tab}"]
    page.js("document.getElementById('tb-overview').focus()")
    for key, want in (("ArrowRight", "chart"), ("ArrowLeft", "overview"), ("ArrowLeft", "trades")):
        page.call("Input.dispatchKeyEvent", type="keyDown", key=key, code=key, windowsVirtualKeyCode=39 if key == "ArrowRight" else 37)
        page.call("Input.dispatchKeyEvent", type="keyUp", key=key, code=key, windowsVirtualKeyCode=39 if key == "ArrowRight" else 37)
        page.until(f"location.hash === '#{want}'", timeout=5)
        assert page.js(visible) == [f"tab-{want}"] and page.js("document.activeElement.id") == f"tb-{want}"
    goto(page, served["url"] + "#journal")
    page.until("document.getElementById('tb-journal') && document.getElementById('tb-journal').getAttribute('aria-selected') === 'true'")
    goto(page, served["url"] + "#nonsense")
    page.until("document.getElementById('tb-overview') && document.getElementById('tb-overview').getAttribute('aria-selected') === 'true'")
    assert page.errors == []


def run_server(app, port):
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    end = time.time() + 15
    while not server.started and time.time() < end:
        time.sleep(0.05)
    assert server.started, "the application did not start"
    return server, thread


def test_stop_the_server_and_the_page_is_stale_start_it_and_the_page_comes_back_by_itself(page):
    port = free_port()
    md, _ = base_engine()
    server, thread = run_server(create_app(md, feed=None), port)
    url = f"http://127.0.0.1:{port}/"
    try:
        live_app(page, url)
        assert page.js("document.getElementById('c-ready').textContent") == "SYSTEM READY"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    # the server is gone: the page loses its link, and says so instead of showing the old state as current
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    h = page.js(READ_HEADER)
    assert [h[i]["text"] for i in ("c-market", "c-feed", "c-data", "c-ready")] == ["MARKET UNKNOWN", "FEED UNKNOWN", "DATA UNKNOWN", "SYSTEM UNKNOWN"]
    assert "STALE since" in page.js("document.querySelector('.stalebar').textContent") and "NOT ACTIONABLE" in page.js("document.querySelector('.stalebar').textContent")
    assert h["spot"]["text"] == "24287.00" and "dim" in h["spot"]["cls"]  # the last price stays, dimmed
    assert page.js("document.getElementById('main').className") == "staled" and page.js("document.querySelector('[data-testid=alert-line]')") is None
    # a new server, on the same address, with a different price: the page reconnects by itself within seconds and draws THAT snapshot alone
    md2, _ = base_engine()
    md2.on_message({"subscription_mode": 2, "exchange_type": 1, "token": md2.spot_token, "last_traded_price": 2431550, "exchange_timestamp": int((md2.clock() - 1) * 1000)})
    server2, thread2 = run_server(create_app(md2, feed=None), port)
    try:
        page.until("document.querySelector('.stalebar') === null && document.getElementById('c-market').textContent === 'MARKET OPEN'", timeout=30)
        assert page.js("document.getElementById('spot').textContent") == "24315.50" and page.js("document.getElementById('main').className") == ""
        assert page.js("document.getElementById('c-link')") is None
    finally:
        server2.should_exit = True
        thread2.join(timeout=10)
