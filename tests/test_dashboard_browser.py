"""The dashboard's quality, measured in a REAL browser (headless Chrome or Edge on this machine, driven over its DevTools websocket; skipped, with the reason, when there is none), on the real application and the
real WebSocket push, over a mocked market (no broker, no database). The states are the real engines of `dashboard_states.py`: BUY CE, BUY PE, WAIT, NO TRADE, market closed, feed down, a stale spot, an option window
with no quotes or no suitable contract, and the counter-trend reversal's decisions.

At 1366x768 and 1920x1080 (the second one is scaled up 1.3x by the page's large-screen zoom), in every state, on every tab:
  * no horizontal scrollbar; the Overview needs no vertical one; no console error and no error line of the page's own
  * no text smaller than 10 px (as the eye gets it, zoom included); whatever a one-line cell cuts off with an ellipsis can be read in full on hover
  * each strategy is shown once: the Overview's live row and its folded list make the ten, and the Analysis tab has ten sections
also: a degraded Overview with alerts still fits one screen, and its list of alerts opens over the page without moving it; every tab opens without a console error and does not overflow at narrower widths;
WAIT, NO TRADE and BUY look different (a word and a colour); a lost link marks every tab as stale and not actionable; a cold start says what it is waiting for and shows no number that was not measured; and the
text colours are readable on every background they are used on."""

import re
from pathlib import Path

import pytest
from browser_support import BROWSER, SIZES, browser, free_port, frozen, goto, keep, page, run_server, served  # noqa: F401
from dashboard_harness import base_engine
from dashboard_states import STATES

from app.main import create_app
from app.trades import TradeLog

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the dashboard was not measured in a real browser")

ROOT = Path(__file__).resolve().parent.parent
TABS = ["overview", "chart", "options", "analysis", "journal", "trades"]
MIN_FONT_PX = 10
LIVE = "document.getElementById('c-market') !== null && document.getElementById('c-market').textContent !== 'CONNECTING' && document.querySelector('.stalebar') === null"

MEASURE = r"""(() => {
  const d = document.documentElement, zoom = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  let smallest = 99, smallestText = "";
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode, t = n.textContent.trim(), p = n.parentElement;
    if (!t || !p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName) || !vis(p)) continue;
    const fs = parseFloat(getComputedStyle(p).fontSize) * zoom;
    if (fs < smallest) { smallest = fs; smallestText = t.slice(0, 40); }
  }
  const noTip = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e)) continue;
    const cs = getComputedStyle(e);
    if ((cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') && e.scrollWidth > e.clientWidth + 1 && (e.innerText || '').trim() && !(e.title || (e.closest('[title]') || {}).title))
      noTip.push((e.id || (typeof e.className === 'string' ? e.className : '') || e.tagName) + ': ' + e.innerText.trim().slice(0, 40));
  }
  const names = sel => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
  const overview = document.getElementById('tab-overview');
  return {vw: innerWidth, vh: innerHeight, scrollH: d.scrollHeight, scrollW: d.scrollWidth, bottom: Math.round(overview.getBoundingClientRect().bottom), tab: location.hash.slice(1) || 'overview',
          stale: document.querySelector('.stalebar') !== null, jserr: (document.getElementById('jserr') || {}).textContent || '',
          smallest: +smallest.toFixed(1), smallestText, noTip, overviewStrategies: names('#strat td:first-child'), analysisStrategies: names('#analysis-body details.sd > summary .nm'),
          action: ((document.querySelector('#decision .dtxt') || {}).textContent || '').trim()};
})()"""


def engine_of(served, name, build, tmp_path):
    """Serve the engine of a pinned state (one snapshot of it, held), with the reader's trade log in a temporary folder (never the real one)."""
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": name}
    md.on_change = served["md"].on_change
    frozen(md)
    served["app"].state.md = md
    served["app"].state.trades = TradeLog(tmp_path / "trades", clock=md.clock)
    return md


def show(page, tab):
    page.js(f"document.getElementById('tb-{tab}').click()")
    page.until(f"location.hash === '#{tab}'")
    page.pause(0.4)


def open_dashboard(page, url, tab="overview", width=None, height=None):
    if width:
        page.size(width, height)
    goto(page, url + "#" + tab)
    page.until(LIVE, timeout=30)
    page.pause(0.6)


@pytest.fixture
def restore(served):
    yield
    served["app"].state.md = served["md"]
    served["app"].state.trades = None
    served["md"].on_change()


@pytest.mark.parametrize("width,height", SIZES)
def test_every_state_on_every_tab_is_within_the_screen_readable_and_free_of_errors(page, served, restore, tmp_path, width, height):
    for state, (build, action) in STATES.items():
        engine_of(served, state, build, tmp_path)
        open_dashboard(page, served["url"], "overview", width, height)
        for tab in TABS:
            show(page, tab)
            if tab == "chart":
                page.until("document.querySelector('[data-testid=chart-box] canvas') !== null || document.getElementById('tab-chart').textContent.length > 20", timeout=20)
            m = page.js(MEASURE)
            where = f"{state} / {tab} at {width}x{height}"
            assert m["tab"] == tab and not m["stale"] and m["jserr"] == "", f"{where}: {m['jserr']}"
            assert m["scrollW"] <= m["vw"], f"{where}: {m['scrollW']} px wide on a {m['vw']} px screen"
            if tab == "overview":
                assert m["scrollH"] <= m["vh"] and m["bottom"] <= m["vh"], f"{where}: needs {max(m['scrollH'], m['bottom'])} px of {m['vh']}"
                assert m["action"] == action, f"{where}: shows {m['action']!r}, not {action!r}"
                every = m["overviewStrategies"]  # the live rows and the folded list together
                assert len(every) == len(set(every)) and len(every) in (0, 10), f"{where}: the monitor lists {len(every)} strategies, with duplicates: {every}"
            if tab == "analysis":
                assert len(m["analysisStrategies"]) == len(set(m["analysisStrategies"])) and len(m["analysisStrategies"]) in (0, 10), f"{where}: {m['analysisStrategies']}"
            assert m["smallest"] >= MIN_FONT_PX, f"{where}: text of {m['smallest']} px: {m['smallestText']!r}"
            assert m["noTip"] == [], f"{where}: cut off with no way to read it: {m['noTip']}"
        if width == 1366:
            show(page, "overview")
            keep(page, tmp_path, f"state-{state}-{width}x{height}")
    assert page.errors == [], page.errors


@pytest.mark.parametrize("width,height", SIZES)
def test_a_degraded_overview_with_alerts_still_fits_one_screen(page, served, restore, tmp_path, width, height):
    md, clock = served["md"], served["clock"]
    md.set_state("disconnected", "the broker closed the connection (test)")
    md.down_since = clock.t - 6001  # the feed has been down for a long time: no live connection, no decision, and alerts
    try:
        open_dashboard(page, served["url"], "overview", width, height)
        page.until("document.querySelector('[data-testid=alert-line]') !== null && document.querySelector('[data-testid=alert-line] summary').innerText.includes('alerts')")
        z = page.js("parseFloat(getComputedStyle(document.body).zoom)")
        m = page.js("(() => { const d = document.documentElement; return {vw: innerWidth, vh: innerHeight, scrollH: d.scrollHeight, scrollW: d.scrollWidth, lines: document.querySelectorAll('[data-testid=alert-line]').length}; })()")
        assert m["lines"] == 1  # one summary line, however many alerts
        assert page.js("document.querySelector('[data-testid=alert-line] summary').getBoundingClientRect().height") < 40 * z  # one line
        assert m["scrollH"] <= m["vh"] and m["scrollW"] <= m["vw"], f"degraded: {m['scrollH']} px of {m['vh']}, {m['scrollW']} wide of {m['vw']}"
        keep(page, tmp_path, f"overview-degraded-{width}x{height}")
        assert page.js("document.getElementById('decision').innerText.includes('NO TRADE')")
        page.js("document.querySelector('[data-testid=alert-line] summary').click()")  # the full list opens, over the page, and the layout does not move
        before = page.js("document.getElementById('decision').getBoundingClientRect().top")
        page.until("document.querySelector('[data-testid=alert-line] .alertlist').getBoundingClientRect().height > 40")
        assert page.js("document.getElementById('decision').getBoundingClientRect().top") == before
        assert page.js("document.querySelectorAll('[data-testid=alert-line] .alertlist .alert').length") >= 2
        assert page.errors == []
    finally:
        md.set_state("connected")
        md.down_since = None


def test_every_tab_opens_without_a_console_error(page, served, restore, tmp_path):
    engine_of(served, "buy_ce", STATES["buy_ce"][0], tmp_path)
    open_dashboard(page, served["url"], "overview", 1366, 768)
    for tab in TABS + ["overview"]:
        show(page, tab)
        page.pause(0.9)
        assert page.js("document.getElementById('jserr')") is None, tab
        assert page.js(f"document.getElementById('tab-{tab}').hidden") is False and page.js(f"document.getElementById('tab-{tab}').textContent.trim().length") > 10, tab
    show(page, "analysis")
    assert page.js("[...document.querySelectorAll('#analysis-body details.sd')].length") == 10  # all ten strategies, in a real browser
    assert page.errors == [], page.errors


@pytest.mark.parametrize("width,height", [(1280, 720), (1100, 700), (900, 700)])
def test_narrower_desktop_widths_do_not_overflow_sideways_on_any_tab(page, served, restore, tmp_path, width, height):
    engine_of(served, "buy_ce", STATES["buy_ce"][0], tmp_path)
    open_dashboard(page, served["url"], "overview", width, height)
    for tab in TABS:
        show(page, tab)
        page.pause(0.5)
        m = page.js("(() => { const d = document.documentElement; return {vw: innerWidth, scrollW: d.scrollWidth}; })()")
        assert m["scrollW"] <= m["vw"], f"{tab} at {width}: {m['scrollW']} px wide"
    assert page.errors == []


def test_wait_no_trade_and_buy_are_told_apart_by_the_word_and_by_the_colour(page, served, restore, tmp_path):
    seen = {}
    for state in ("buy_ce", "buy_pe", "wait", "no_trade", "ter_denied"):
        engine_of(served, state, STATES[state][0], tmp_path)
        open_dashboard(page, served["url"], "overview", 1366, 768)
        seen[state] = page.js("""(() => { const d = document.getElementById('decision'), t = d.querySelector('.dtxt'), cs = getComputedStyle(d);
            return {word: t.textContent.trim(), ink: getComputedStyle(t).color, border: cs.borderTopColor, fill: cs.backgroundColor, cls: d.className}; })()""")
    assert [seen[k]["word"] for k in ("buy_ce", "buy_pe", "wait", "no_trade")] == ["BUY CE", "BUY PE", "WAIT", "NO TRADE"]
    for a in ("wait", "no_trade"):  # WAIT is amber and NO TRADE is neutral grey: in the word, the lettering, the frame and the fill
        for b in ("buy_ce", "buy_pe"):
            assert (seen[a]["ink"], seen[a]["border"]) != (seen[b]["ink"], seen[b]["border"]), (a, b)
    assert seen["wait"]["ink"] != seen["no_trade"]["ink"] and seen["wait"]["border"] != seen["no_trade"]["border"] and seen["wait"]["fill"] != seen["no_trade"]["fill"]
    assert seen["buy_ce"]["ink"] != seen["buy_pe"]["ink"] and seen["buy_ce"]["fill"] != seen["buy_pe"]["fill"]
    assert "wait" in seen["wait"]["cls"].split() and "no-trade" in seen["no_trade"]["cls"].split() and seen["ter_denied"]["word"] == STATES["ter_denied"][1]
    assert page.errors == []


@pytest.mark.parametrize("tab", TABS)
def test_a_lost_link_marks_every_tab_as_stale_and_not_actionable(page, tmp_path, tab):
    """The server is stopped under the page, on each tab in turn: the banner is on every tab, the page is dimmed, every chip is unknown and nothing says it can be acted on."""
    md, _ = base_engine()
    port = free_port()
    server, thread = run_server(create_app(md, feed=None), port)
    try:
        goto(page, f"http://127.0.0.1:{port}/#{tab}")
        page.until(LIVE, timeout=30)
        page.pause(1.2)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    page.pause(0.3)
    s = page.js("""({banner: document.querySelector('.stalebar').innerText, bannerShown: document.querySelector('.stalebar').getBoundingClientRect().height > 0,
        dim: getComputedStyle(document.querySelector('section.tab:not([hidden])')).opacity, chips: [...document.querySelectorAll('.chip')].map(c => c.innerText).slice(0, 4),
        text: document.getElementById('main').innerText.toLowerCase(), jserr: (document.getElementById('jserr') || {}).textContent || ''})""")
    assert "STALE since" in s["banner"] and s["bannerShown"] and float(s["dim"]) < 1, tab  # the banner is on every tab, and the page is dimmed
    assert s["chips"] == ["MARKET UNKNOWN", "FEED UNKNOWN", "DATA UNKNOWN", "SYSTEM UNKNOWN"] and s["jserr"] == ""
    assert "actionable now" not in s["text"] and "entry eligible" not in s["text"]  # nothing says it can be acted on
    if tab == "options":
        assert "not current, not actionable" in s["text"]  # (the contract card says it is the last one)
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors  # (a page whose server is gone says so in the console)
    page.call("Page.navigate", url="about:blank")
    page.pause(0.4)


def test_a_cold_start_says_what_it_is_waiting_for_and_shows_no_number_that_was_not_measured(page, served, restore, tmp_path):
    engine_of(served, "no_trade", STATES["no_trade"][0], tmp_path)  # history still loading, no NIFTY tick, no option quote
    open_dashboard(page, served["url"], "overview", 1366, 768)
    ov = page.js("document.body.innerText")  # (the header, with the price, is outside <main>)
    assert "NO TRADE" in ov and "Historical data is still loading" in ov  # the decision says why there is none
    assert page.js("document.getElementById('spot').textContent") == "–" and "no NIFTY tick yet" in ov and "unknown" in ov.lower()  # no price, no zero price
    assert "Regime facts: not received yet. Every fact is unknown" in ov and page.js("document.querySelectorAll('#rg .rgc').length") == 6
    assert re.search(r"28 no data", ov) and "0 / 28 fresh" in ov  # a real zero (none is fresh) next to the 28 that have no data
    show(page, "options")
    cells = page.js("[...document.querySelectorAll('#opt-table tr')].slice(1).map(r => [...r.children].slice(4, 10).map(c => c.textContent.trim()))")
    assert len(cells) == 28 and all(set(row) <= {"–", "– × –"} for row in cells), cells[:2]  # LTP, bid, ask, spread, volume, open interest: unknown, never 0
    assert "NO DATA" in page.js("document.getElementById('opt-table').innerText").upper()
    show(page, "analysis")
    assert "Analysis not available yet" in page.js("document.getElementById('analysis-body').innerText")  # a tab with nothing to show says why
    show(page, "journal")
    page.pause(0.8)
    assert page.js("document.getElementById('journal-body').innerText.trim().length") > 20
    assert page.errors == []


def hex_to_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(h):
    r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * hex_to_linear(r) + 0.7152 * hex_to_linear(g) + 0.0722 * hex_to_linear(b)


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def test_the_text_colours_are_readable_on_every_background_they_are_used_on():
    css = (ROOT / "frontend" / "src" / "styles.css").read_text(encoding="utf-8")
    v = dict(re.findall(r"--([a-z0-9]+):\s*(#[0-9a-fA-F]{6})", re.search(r":root\s*\{[^}]*\}", css).group(0)))
    grounds = ("bg", "panel", "panel2", "neubg")
    for ink in ("fg", "mut", "ok", "bad", "warn", "acc"):  # every text colour on the plain grounds: WCAG AA (4.5 : 1)
        for ground in grounds:
            assert contrast(v[ink], v[ground]) >= 4.5, (ink, ground, round(contrast(v[ink], v[ground]), 2))
    for ink, ground in (("ok", "okbg"), ("bad", "badbg"), ("warn", "warnbg"), ("mut", "neubg"), ("fg", "okbg"), ("fg", "badbg"), ("fg", "warnbg")):  # and on the tinted ones
        assert contrast(v[ink], v[ground]) >= 4.5, (ink, ground, round(contrast(v[ink], v[ground]), 2))
    assert contrast("#c3cad4", v["neubg"]) >= 4.5  # the NO TRADE lettering
