"""Stage 9.2 in a REAL browser (headless Chrome or Edge on this machine, over its DevTools protocol; skipped, with the reason, when there is none): the React Chart tab, drawn by the real chart library
from the real GET /api/chart of the real application, over a mocked market (no broker, no database).

  * the tab draws a canvas with candles in both candle colours, the two EMAs in their own colours, and the setup's trigger, entry area, invalidation and target: counted as pixels, not assumed
  * the legend and the setup list say the numbers of the candle and of the setup that the answer holds
  * every timeframe button draws its own chart without a console error
  * each box under "On the chart" takes its own colour off the canvas and gives it back
  * the page asks Prism for the chart again every few seconds, with reads only, and asks nothing of any other site
  * a poll does not undo what the viewer did: the chart panned to the left stays where it was put (the candles are updated, not set again)
  * no sideways scroll at 1366x768 and 1920x1080

Set PRISM_SHOTS=<folder> to keep a screenshot of each state."""

import json
import re

import pytest
from browser_support import BROWSER, browser, goto, keep, page, served  # noqa: F401
from dashboard_states import STATES
from test_journal_browser import settled

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the Chart tab was not run in a real browser")

COLOURS = {  # the dashboard's own (frontend/src/styles.css)
    "up": (0x3D, 0xDC, 0x84), "down": (0xFF, 0x6B, 0x6B), "trigger": (0x5A, 0xA9, 0xFF), "ema20": (0xC7, 0x92, 0xEA), "ema50": (0x4D, 0xD0, 0xE1), "level": (0xF5, 0xB9, 0x42),
}  # fmt: skip

# Counts, over every canvas of the chart, the pixels that are (within a few steps of) each colour: the only way to know the canvas really has them.
COUNT = (
    """(() => { const want = %s; const out = {}; for (const k in want) out[k] = 0;
    for (const cv of document.querySelectorAll('[data-testid=chart-box] canvas')) {
      let d; try { d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; } catch (e) { continue; }
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 250) continue;
        for (const k in want) { const w = want[k]; if (Math.abs(d[i] - w[0]) < 10 && Math.abs(d[i + 1] - w[1]) < 10 && Math.abs(d[i + 2] - w[2]) < 10) out[k]++; } } }
    return out; })()"""
    % json.dumps(COLOURS)
)

# A fingerprint of what the canvas shows (a sampled sum of its pixels): the same picture gives the same number.
FINGERPRINT = """(() => { let h = 0; for (const cv of document.querySelectorAll('[data-testid=chart-box] canvas')) { let d; try { d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; } catch (e) { continue; }
  for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i] + 7 * d[i + 1] + 13 * d[i + 2]) >>> 0; } return h; })()"""


def open_chart(page, served, width=1366, height=768):
    page.size(width, height)
    goto(page, served["url"] + "#chart")
    page.until("document.querySelector('[data-testid=chart-box] canvas') !== null && document.querySelector('[data-testid=chart-legend]').textContent.includes('O ')", timeout=30)
    page.pause(1.0)


def legend(page):
    return " ".join(page.js("document.querySelector('[data-testid=chart-legend]').textContent").split())


def click(page, selector_js):
    page.js(f"({selector_js}).click()")


def timeframe_button(label):
    return f"[...document.querySelectorAll('[role=group][aria-label=Timeframe] button')].find(b => b.textContent === '{label}')"


def toggle_box(label):
    return f"[...document.querySelectorAll('[role=group][aria-label=\"On the chart\"] label')].find(l => l.textContent.trim() === '{label}').querySelector('input')"


def test_the_chart_is_drawn_with_candles_the_emas_and_the_setups_lines(page, served, tmp_path):
    open_chart(page, served)
    keep(page, tmp_path, "chart_5m_1366x768")
    n = page.js(COUNT)
    assert n["up"] > 1000 and n["down"] > 1000, n  # candles of both colours (and, in green, the entry area and target lines)
    assert n["ema20"] > 40 and n["ema50"] > 40, n  # the two averages, each a thin line in its own colour
    assert n["trigger"] > 400 and n["level"] > 400, n  # the setup's trigger (dashed blue) and the previous day's levels (dotted amber)
    assert page.js("document.querySelector('[data-testid=chart-box] canvas').width") > 600
    assert page.errors == [], page.errors


def test_the_legend_and_the_setup_list_say_what_the_chart_draws(page, served):
    open_chart(page, served)
    md = served["md"]
    text = legend(page)
    assert text.startswith("NIFTY 50 · 5M · 06/11 10:55 O 24287.00 H 24287.00 L 24287.00 C 24287.00") and text.endswith("forming")  # the candle still forming: one tick, at 24287
    setups = page.js("document.querySelector('[data-testid=chart-setups]').innerText")
    s = md.safe_trading()["setups"][0]
    assert "CE · Trend Pullback" in setups and f"Trigger {s['trigger']:.2f}" in setups and f"Invalidation {s['invalidation']:.2f}" in setups and "the decision's setup" in setups
    assert "decision: ce setup" in setups.lower()  # (the heading is drawn in capitals)
    assert page.js("document.querySelector('[data-testid=chart-facts]').innerText").startswith("Trend bullish")


@pytest.mark.parametrize("label,shown", [("1M", "· 1M ·"), ("15M", "· 15M ·"), ("1H", "· 1H ·"), ("1D", "· 1D ·"), ("5M", "· 5M ·")])
def test_every_timeframe_button_draws_its_own_chart(page, served, label, shown):
    open_chart(page, served)
    click(page, timeframe_button(label))
    page.until(f"document.querySelector('[data-testid=chart-legend]').textContent.includes('{shown}') && document.querySelector('[data-testid=chart-box] canvas') !== null && document.querySelector('[data-testid=chart-legend]').textContent.includes('O ')")
    page.pause(0.6)
    assert page.js(f"{timeframe_button(label)}.getAttribute('aria-pressed')") == "true"
    n = page.js(COUNT)
    assert n["up"] + n["down"] > 100, (label, n)  # candles were drawn
    assert page.errors == [], (label, page.errors)


def test_the_daily_chart_has_no_time_of_day_and_says_why_it_has_no_indicators(page, served, tmp_path):
    open_chart(page, served)
    click(page, timeframe_button("1D"))
    page.until("document.querySelector('[data-testid=chart-legend]').textContent.includes('· 1D ·') && document.querySelector('[data-testid=chart-box] canvas') !== null && document.querySelector('[data-testid=chart-legend]').textContent.includes('O ')")
    page.pause(0.6)
    assert " ".join(page.js("document.querySelector('.chart-facts').textContent").split()).startswith("Prism reads no trend from daily candles")
    assert "/2026" in legend(page) and ":" not in legend(page).split("· 1D ·")[1].split(" O ")[0]  # the day (05/11/2026), not a time
    keep(page, tmp_path, "chart_1d")


def test_each_box_under_on_the_chart_takes_its_own_colour_off_the_canvas_and_gives_it_back(page, served):
    open_chart(page, served)
    before = page.js(COUNT)
    for box, key in (("EMA 20", "ema20"), ("EMA 50", "ema50"), ("Setup lines", "trigger")):
        click(page, toggle_box(box))
        page.pause(0.5)
        gone = page.js(COUNT)
        assert gone[key] == 0, (box, gone)  # none of it left
        others = {k: v for k, v in gone.items() if k != key}
        assert all(others[k] > 0 for k in ("up", "down", "level")), (box, gone)  # and the rest is still drawn
        click(page, toggle_box(box))
        page.pause(0.5)
        back = page.js(COUNT)
        assert back[key] > 0.8 * before[key], (box, before, back)
    click(page, toggle_box("Key levels"))
    page.pause(0.5)
    assert page.js(COUNT)["level"] == 0
    assert page.errors == [], page.errors


def test_the_page_asks_for_the_chart_again_and_again_with_reads_only_and_asks_nothing_of_another_site(page, served):
    open_chart(page, served)
    page.pause(7.5)  # two more polls at 3 s
    entries = page.js("performance.getEntriesByType('resource').map(e => e.name)")
    origin = served["url"].rstrip("/")
    assert all(name.startswith(origin) for name in entries), [e for e in entries if not e.startswith(origin)]
    api = [e for e in entries if "/api/" in e]
    chart = [e for e in api if "/api/chart" in e]
    assert len(chart) >= 3 and all(e.startswith(origin + "/api/chart?timeframe=5m&limit=300") for e in chart), chart
    # No other API route is polled by this tab (the snapshot comes over the socket). Two reads are made once, and never again here: the PAGE reads the reader's own trades as it starts, whichever tab is open (so a
    # loss limit already reached is on every tab), and the Chart tab reads today's journal when it is opened, to mark on the candles where Prism's decision changed.
    assert sorted(e for e in api if "/api/chart" not in e) == [origin + "/api/journal", origin + "/api/trades"], api  # (and the Chart tab reads today's journal once, to mark where the decision changed)


def test_a_poll_does_not_undo_what_the_viewer_did(page, served):
    open_chart(page, served)
    page.call("Input.dispatchMouseEvent", type="mouseMoved", x=2, y=2)  # no pointer on the chart: no crosshair on the picture
    page.pause(0.8)
    fresh = page.js(FINGERPRINT)
    box = page.js("(() => { const r = document.querySelector('[data-testid=chart-box]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    x, y = box[0] + box[2] / 2, box[1] + box[3] / 2
    for _ in range(5):  # the viewer zooms in on the right-hand end of the chart with the mouse wheel
        page.call("Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=-240)
        page.pause(0.15)
    page.call("Input.dispatchMouseEvent", type="mouseMoved", x=2, y=2)
    page.pause(0.8)
    zoomed = page.js(FINGERPRINT)
    assert zoomed != fresh, "the zoom changed nothing on the canvas: this test would prove nothing"
    page.pause(7.5)  # two polls
    assert page.js(FINGERPRINT) == zoomed, "the chart went back to where it started when the next answer came in"
    goto(page, served["url"] + "#chart")  # a fresh page starts from the latest bars again
    page.until("document.querySelector('[data-testid=chart-box] canvas') !== null && document.querySelector('[data-testid=chart-legend]').textContent.includes('O ')", timeout=30)
    page.call("Input.dispatchMouseEvent", type="mouseMoved", x=2, y=2)
    page.pause(0.8)
    assert page.js(FINGERPRINT) != zoomed


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080)])
def test_it_fits_the_screen_with_no_sideways_scroll_and_no_text_too_small_to_read(page, served, tmp_path, width, height):
    open_chart(page, served, width, height)
    m = page.js("""(() => { const d = document.documentElement; const r = document.querySelector('[data-testid=chart-box]').getBoundingClientRect();
        const small = [...document.querySelectorAll('main *')].filter(e => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 10).map(e => e.textContent.trim().slice(0, 30));
        return {vw: innerWidth, scrollW: d.scrollWidth, left: r.left, right: r.right, height: r.height, small}; })()""")
    assert m["scrollW"] <= m["vw"] and m["right"] <= m["vw"] and m["left"] >= 0, m
    z = page.js("parseFloat(getComputedStyle(document.body).zoom)")  # (the large-screen zoom: 1 at 1366x768, 1.3 at 1920x1080)
    assert 340 * z - 1 <= m["height"] <= 560 * z + 1 and not m["small"], (z, m)
    assert page.errors == [], page.errors
    keep(page, tmp_path, f"chart_{width}x{height}")


# Where the picture says the mouse is: the chart is made of canvases, and the crosshair is the one vertical line that appears on them when the pointer comes over. The canvases before and after are compared, and the column
# that changed most is the line (in the page's own pixels: a canvas of the chart box is drawn at the size of the screen, whatever the page's zoom).
GRAB = "window.__before = [...document.querySelectorAll('[data-testid=chart-box] canvas')].map(cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data); true"
LINE = """(() => { let best = {x: -1, n: 0};
    [...document.querySelectorAll('[data-testid=chart-box] canvas')].forEach((cv, k) => { const now = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, was = window.__before[k]; const r = cv.getBoundingClientRect();
      const cols = new Array(cv.width).fill(0);
      for (let i = 0; i < now.length; i += 4) { if (Math.abs(now[i] - was[i]) + Math.abs(now[i + 1] - was[i + 1]) + Math.abs(now[i + 2] - was[i + 2]) + Math.abs(now[i + 3] - was[i + 3]) > 30) cols[(i / 4) % cv.width]++; }
      cols.forEach((n, c) => { if (n > best.n) best = {x: r.left + c * r.width / cv.width, n}; }); });
    return best; })()"""


@pytest.mark.parametrize("width,height,zoom", [(1366, 768, 1.0), (1600, 900, 1.1), (1920, 1080, 1.3)])
def test_the_crosshair_is_where_the_mouse_is_at_every_zoom_of_the_page(page, served, width, height, zoom):
    """The page is scaled up on large screens (1.1x from 1500x800, 1.3x from 1700x940, as the current dashboard is). A chart library does not expect that: under a plain CSS zoom its crosshair was drawn at the zoom times the
    mouse's place (measured in Chrome: at 1.3 the mouse at x = 484 gave a crosshair at 627). The chart box therefore takes the zoom off itself. The crosshair is looked for on the picture itself."""
    open_chart(page, served, width, height)
    assert abs(page.js("parseFloat(getComputedStyle(document.body).zoom)") - zoom) < 0.001, "the page is not at the zoom this test is about"
    page.call("Input.dispatchMouseEvent", type="mouseMoved", x=2, y=2)
    page.pause(0.4)
    box = page.js("(() => { const r = document.querySelector('[data-testid=chart-box]').getBoundingClientRect(); return {l: r.left, t: r.top, w: r.width, h: r.height}; })()")
    seen = []
    for fraction in (0.25, 0.5, 0.75):
        page.js(GRAB)
        x, y = int(box["l"] + box["w"] * fraction), int(box["t"] + box["h"] * 0.4)
        page.call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        page.pause(0.4)
        line = page.js(LINE)
        seen.append((x, round(line["x"]), line["n"]))
        assert line["n"] > box["h"] * 0.3, ("no crosshair was drawn", seen)
        assert abs(line["x"] - x) <= 14, f"at zoom {zoom} the mouse is at x = {x} and the crosshair is drawn at {line['x']:.0f}: {seen}"  # (the crosshair snaps to a candle: half a candle's width, never a zoom's worth)
        page.call("Input.dispatchMouseEvent", type="mouseMoved", x=2, y=2)
        page.pause(0.3)
    assert page.errors == [], page.errors


# -- what the chart says beyond its candles: the line under the legend, where the decision changed, the guide ---------------------------------------------------------------------
DETAIL = r"""(() => document.querySelector('[data-testid=chart-detail]').textContent.replace(/\s+/g, ' ').trim())()"""
BOX = "(() => { const r = document.querySelector('[data-testid=chart-box]').getBoundingClientRect(); return {l: r.left, t: r.top, w: r.width, h: r.height}; })()"


def sweep(page, step=22):
    """The line under the legend, with the mouse at positions across the chart (the mouse parked off the chart afterwards)."""
    box = page.js(BOX)
    seen = []
    for x in range(int(box["l"]) + 30, int(box["l"] + box["w"]) - 130, step):
        page.call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=int(box["t"] + box["h"] * 0.4))
        page.pause(0.05)
        seen.append(page.js(DETAIL))
    page.call("Input.dispatchMouseEvent", type="mouseMoved", x=2, y=2)
    page.pause(0.3)
    return seen


def test_the_line_under_the_legend_says_what_each_candle_says_as_the_mouse_moves(page, served):
    open_chart(page, served)
    latest = page.js(DETAIL)
    seen = sweep(page)
    assert len(set(seen)) >= 5, seen[:3]  # a different candle, a different line
    for line in seen:
        assert re.search(r"Size \d+\.\d\d pts", line) and (re.search(r"It closed (up|down) \d+\.\d\d", line) or "It had no body" in line), line
    assert sum("EMA 20" in line and "EMA 50" in line for line in seen) >= len(seen) // 2  # (the two EMAs, once they have started)
    assert any("Nearest level under:" in line or "over:" in line for line in seen)  # (the previous day's levels and the open are there to be near)
    assert page.js(DETAIL) == latest, "with the mouse off the chart the line is the latest candle's again"
    assert page.errors == []


def test_the_numbers_under_the_chart_say_what_they_are_on_hover_and_there_is_a_guide_to_the_chart(page, served):
    open_chart(page, served)
    titles = page.js("[...document.querySelectorAll('[data-testid=chart-facts] span[title]')].map(s => [s.textContent.trim().split(' ')[0], s.title])")
    assert [t[0] for t in titles] == ["Trend", "ADX", "RSI", "ATR(14)", "EMA", "EMA"] and all(len(t[1]) > 40 for t in titles), titles
    assert page.js("document.querySelector('[data-testid=chart-guide]').open") is False
    page.js("document.querySelector('[data-testid=chart-guide] > summary').click()")
    page.until("document.querySelector('[data-testid=chart-guide]').open")
    text = " ".join(page.js("document.querySelector('[data-testid=chart-guide]').innerText").split())
    for said in ("EMA 20", "Swings (off to begin with)", "CE setup", "Key levels", "Prev day high, low and close", "Support (a floor", "Resistance (a ceiling", "More levels (off to begin with)", "trigger", "invalidation", "none of this tells you to buy or sell"):
        assert said in text, said
    assert page.js("document.documentElement.scrollWidth") <= page.js("innerWidth")
    keep(page, None, "chart_guide")
    assert page.errors == []


def test_where_the_decision_changed_is_marked_on_the_candles_and_said_when_the_mouse_is_on_them(page, served, tmp_path):
    md0 = served["app"].state.md
    md = STATES["buy_ce"][0](str(tmp_path / "journal"))  # an engine that has written a journal: WAIT at 10:40, WAIT at 10:45, BUY CE at 10:55
    md.instance = {"pid": 0, "port": 0, "marker": "buy_ce"}
    md.on_change = md0.on_change
    settled(md)
    served["app"].state.md = md
    try:
        open_chart(page, served)
        page.pause(2.0)  # (the journal is read when the tab opens)
        seen = sweep(page, step=14)
        said = [line for line in seen if "Prism said" in line]
        assert any("Prism said WAIT at 10:40" in line for line in said) and any("Prism said WAIT at 10:45" in line for line in said), said  # (the BUY CE at 10:55 is on a candle that has not begun in this world: not drawn, so not marked)
        on = page.js(FINGERPRINT)
        click(page, toggle_box("Decisions"))
        page.pause(0.6)
        off = page.js(FINGERPRINT)
        assert off != on, "taking the Decisions box off changed nothing on the canvas: nothing was marked"
        click(page, toggle_box("Decisions"))
        page.pause(0.6)
        assert page.js(FINGERPRINT) == on, "putting it back did not bring the markers back as they were"
        assert page.errors == [], page.errors
    finally:
        served["app"].state.md = md0
        md0.on_change()


# -- the simple view, and the boxes as the key ---------------------------------------------------------------------------------------------------------------------
TICKED = "[...document.querySelectorAll('[role=group][aria-label=\"On the chart\"] input')].map(i => i.checked)"


def view_button(label):
    return f"[...document.querySelectorAll('[role=group][aria-label=View] button')].find(b => b.textContent === '{label}')"


def pressed(page, label):
    return page.js(f"{view_button(label)}.getAttribute('aria-pressed')")


def test_it_begins_simple_and_everything_is_one_click_away_and_simple_one_click_back(page, served, tmp_path):
    settled(served["md"])
    open_chart(page, served)
    assert page.js(TICKED) == [True, True, True, False, True, False, True]  # the averages, the key levels, the setup's lines, the decisions: not the other levels, not the swings
    assert [pressed(page, "Simple"), pressed(page, "Everything")] == ["true", "false"]
    simple = page.js(FINGERPRINT)
    assert page.js(COUNT)["level"] > 400  # (the key levels are drawn)
    keep(page, tmp_path, "chart_simple")
    click(page, view_button("Everything"))
    page.pause(0.8)
    assert page.js(TICKED) == [True] * 7 and [pressed(page, "Simple"), pressed(page, "Everything")] == ["false", "true"]
    everything = page.js(FINGERPRINT)
    assert everything != simple, "'Everything' changed nothing on the canvas: no swing arrow and no other level was drawn"
    keep(page, tmp_path, "chart_everything")
    click(page, view_button("Simple"))
    page.pause(0.8)
    assert page.js(FINGERPRINT) == simple, "'Simple' did not bring the simple picture back"
    assert [pressed(page, "Simple"), pressed(page, "Everything")] == ["true", "false"]
    click(page, toggle_box("Swings"))  # one box alone is neither view, and draws the arrows by itself
    page.pause(0.8)
    assert page.js(FINGERPRINT) != simple, "the Swings box alone changed nothing on the canvas"
    assert [pressed(page, "Simple"), pressed(page, "Everything")] == ["false", "false"]
    assert page.errors == [], page.errors


def test_the_boxes_under_the_chart_are_also_its_key_each_with_a_sample_of_its_line(page, served):
    open_chart(page, served)
    got = page.js(
        """(() => { const rgb = (v) => { const p = document.createElement('i'); p.style.color = 'var(' + v + ')'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
        const look = (label) => [...[...document.querySelectorAll('[role=group][aria-label="On the chart"] label')].find(l => l.textContent.trim() === label).querySelectorAll('.ksw')].map(e => { const s = getComputedStyle(e); return [s.borderTopColor, s.borderTopStyle, s.opacity]; });
        return {ema20: look('EMA 20'), ema50: look('EMA 50'), key: look('Key levels'), more: look('More levels'), setups: look('Setup lines'), warn: rgb('--warn'), mut: rgb('--mut'), ok: rgb('--ok'), bad: rgb('--bad'), acc: rgb('--acc'), e20: rgb('--ema20'), e50: rgb('--ema50')}; })()"""
    )
    assert got["ema20"] == [[got["e20"], "solid", "1"]] and got["ema50"] == [[got["e50"], "solid", "1"]]
    assert got["key"] == [[got["warn"], "dotted", "1"], [got["mut"], "dotted", "1"], [got["ok"], "dashed", "0.6"], [got["bad"], "dashed", "0.6"]]  # amber dotted, grey dotted, faded green dashed, faded red dashed
    assert got["more"] == [[got["ok"], "dashed", "0.6"], [got["bad"], "dashed", "0.6"]]
    assert got["setups"] == [[got["acc"], "dashed", "1"], [got["bad"], "solid", "1"], [got["ok"], "dashed", "1"]]  # the trigger, the invalidation, the target
    assert page.js("[...document.querySelectorAll('[role=group][aria-label=\"On the chart\"] label')].map(l => l.textContent.trim())") == ["EMA 20", "EMA 50", "Key levels", "More levels", "Setup lines", "Swings", "Decisions"]
    assert page.errors == [], page.errors
