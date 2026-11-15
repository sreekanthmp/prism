"""The alerts in a REAL browser (headless Chrome or Edge, over its DevTools protocol; skipped, with the reason, when there is none): the sound, the popup, the count in the page's title, the one alert line and the
mode button in the header of the built dashboard, over a mocked market (no broker, no database).

A real browser plays no sound a test can hear, so before the page's own scripts run a stand-in for the sound device and for the popups is put in place (`AudioContext`, `Notification`): it RECORDS the tones that
were played and the popups that were shown. The page is then given snapshots, one after the other, by a real server, and what it did is checked.

  * a setup becomes READY, the reader is back (a click), the setup ends, the alerts are cleared: the one alert line, its list, the count in the title, the tones and the popups, in each of the three modes
  * the mode button goes round the three modes, saves the choice, asks for the popup permission once and plays a test tone; a saved mode is the one the page starts in, and a junk value is ignored
  * a system that stops being ready, and is ready again; a feed that is lost; a link that is lost (a real server stopped): the warnings, once
  * the daily loss limit: on the line from the start with no sound, and said once with a sound when a trade you log leaves it reached

(Until the cutover the same snapshots were given to this page and to the one it replaced, in each of the three modes, and the line, the list, the count, the tones and the popups were compared. That proof is in the
README, and the page is gone.)"""

import copy
import json

import pytest
from browser_support import BROWSER, browser, free_port, frozen, goto, page, run_server  # noqa: F401
from test_trades_browser import LIMITS, SET, TradeLog, engine, seed, serving

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the alerts were not run in a real browser")

ACT = [880, 1175, 880, 1175]
WARN = [520, 390]
INFO = [660]
STUB = r"""(() => {
  window.__tones = []; window.__notes = []; window.__asked = 0;
  class FakeAudio { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; } resume() { return Promise.resolve(); }
    createGain() { return {gain: {value: 0}, connect() {}}; }
    createOscillator() { const o = {type: '', frequency: {value: 0}, connect() {}, start() { window.__tones.push(o.frequency.value); }, stop() {}}; return o; } }
  window.AudioContext = FakeAudio; window.webkitAudioContext = FakeAudio;
  const N = function (title, opts) { window.__notes.push({title: title, body: opts.body, tag: opts.tag, sticky: opts.requireInteraction}); };
  N.permission = '__PERMISSION__'; N.requestPermission = () => { window.__asked++; return Promise.resolve(N.permission); };
  window.Notification = N;
  window.confirm = () => true;
  __MODE__
})();"""
WATCH = r"""(() => {
  const line = document.querySelector('#alerts details, [data-testid=alert-line]');
  const squeeze = s => s.replace(/\s+/g, ' ').trim();
  const button = document.getElementById('alert-mode');
  return {
    line: line ? {cls: squeeze(line.className.replace(/\bopen\b/, '')), summary: squeeze(line.querySelector('summary').textContent), rows: [...line.querySelectorAll('.alertlist .alert')].map(r => squeeze(r.className) + ' :: ' + squeeze(r.textContent)),
      clear: !!document.getElementById('alert-clear')} : null,
    count: (document.title.match(/^\((\d+)\)/) || [null, '0'])[1],
    tones: window.__tones.slice(), notes: window.__notes.map(n => JSON.stringify(n)), asked: window.__asked,
    mode: button.textContent, modeClass: button.className, modeTitle: button.title,
    stored: (() => { try { return localStorage.getItem('prism-alert-mode'); } catch (e) { return 'no storage'; } })(),
  };
})()"""
LIVE = "document.getElementById('c-market') !== null && document.getElementById('c-market').textContent !== 'CONNECTING' && !document.querySelector('.stalebar')"
STALE = "document.querySelector('.stalebar') !== null"
COUNT = lambda n: f"(document.title.match(/^\\((\\d+)\\)/) || [null, '0'])[1] === '{n}'"  # noqa: E731


def staged(snap, stage, **over):
    s = copy.deepcopy(snap)
    s["trading"]["setups"][0].update(stage=stage, **over)
    return s


def unready(snap):
    s = copy.deepcopy(snap)
    s["health"]["readiness"].update(ready=False, state="RECOVERING_GAPS", summary="recovering missing candles")
    return s


class Drive:
    """One dashboard, with the stand-ins in place, over a server that pushes whatever `serve` was last given."""

    def __init__(self, page, url, current):
        self.page, self.url, self.current = page, url, current

    def open(self, tab="overview"):
        goto(self.page, self.url + "#" + tab)
        self.page.until(LIVE, timeout=30)
        self.page.pause(0.5)

    def serve(self, snap):
        self.current[0] = snap

    def watch(self):
        return self.page.js(WATCH)

    def until(self, js, timeout=20):
        self.page.until(js, timeout=timeout)

    def js(self, js):
        return self.page.js(js)


def both(page, url, current, script, mode=None, permission="granted", tab="overview"):
    """`script(drive)` run against the page, with the stand-ins in place; what it returns, as {"new": ...}."""
    source = STUB.replace("__PERMISSION__", permission).replace("__MODE__", f"try {{ localStorage.setItem('prism-alert-mode', {json.dumps(mode)}); }} catch (e) {{}}" if mode is not None else "try { localStorage.removeItem('prism-alert-mode'); } catch (e) {}")
    ident = page.call("Page.addScriptToEvaluateOnNewDocument", source=source)["identifier"]
    try:
        d = Drive(page, url, current)
        d.open(tab)
        return {"new": script(d)}
    finally:
        page.call("Page.removeScriptToEvaluateOnNewDocument", identifier=ident)


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    """One application over the engine of the BUY CE state, whose snapshot is whatever the test last gave it (the engine itself is not touched)."""
    folder = tmp_path_factory.mktemp("alerts")
    md = engine(folder)
    base = md.snapshot()
    current = [base]
    md.snapshot = lambda: current[0]
    with serving(md, TradeLog(folder / "start", clock=md.clock)) as w:
        yield {**w, "base": base, "current": current}


@pytest.fixture
def limits(monkeypatch):
    for k, v in LIMITS.items():
        monkeypatch.setenv(k, v)


def forget(page):
    page.call("Page.navigate", url="about:blank")
    page.pause(0.4)


MODES = [("sound", "sound"), ("off", "off"), ("sound + popup", "sound + popup")]


@pytest.mark.parametrize("mode", [m for m, _ in MODES])
def test_a_setup_that_becomes_ready_and_then_ends_is_told_by_the_line_the_count_the_sound_and_the_popup(page, world, mode):
    base, current = world["base"], world["current"]
    assert base["trading"]["setups"][0]["stage"] == "READY_TO_ACT"

    def script(d):
        d.serve(staged(base, "CONFIRMED"))
        d.open()
        seen = {"baseline": d.watch()}  # the first snapshot is a baseline: nothing is raised for it
        d.page.pause(1.5)
        d.serve(base)  # the setup enters its entry area
        d.until(COUNT(1))
        seen["ready"] = d.watch()
        d.js("document.body.click()")  # the reader is back
        d.until(COUNT(0))
        seen["back"] = d.watch()
        d.serve(staged(base, "INVALIDATED"))  # the setup ends
        d.until(COUNT(1))
        seen["ended"] = d.watch()
        d.js("document.getElementById('alert-clear').click()")
        d.until("document.querySelector('#alerts details, [data-testid=alert-line]') === null")
        seen["cleared"] = d.watch()
        return seen

    out = both(page, world["url"], current, script, mode=mode, permission="granted")
    seen = out["new"]
    assert seen["baseline"]["line"] is None and seen["baseline"]["tones"] == [] and seen["baseline"]["count"] == "0"
    assert seen["ready"]["line"]["cls"] == "alerts act" and seen["ready"]["line"]["summary"] == "🔔 1 alert: CE setup ready: Trend Pullback ▾ details" and seen["ready"]["line"]["clear"]
    assert "You decide and place any order yourself." in seen["ready"]["line"]["rows"][0]
    assert seen["back"]["line"] is not None and seen["back"]["count"] == "0"  # (the line stays ten minutes; the count is what the reader has not seen)
    assert seen["ended"]["line"]["summary"] == "🔔 2 alerts: CE setup ready: Trend Pullback (+1 more) ▾ details" and any("it is now invalidated" in r for r in seen["ended"]["line"]["rows"])  # (the ready one leads: green outranks a warning)
    assert seen["cleared"]["line"] is None and seen["cleared"]["count"] == "0"
    sound = {"sound": ACT + WARN, "off": [], "sound + popup": ACT + WARN}[mode]
    assert seen["cleared"]["tones"] == sound, mode
    notes = [json.loads(n) for n in seen["cleared"]["notes"]]
    if mode == "sound + popup":
        assert [(n["title"], n["sticky"]) for n in notes] == [("CE setup ready: Trend Pullback", True), ("CE setup no longer ready: Trend Pullback", False)]
    else:
        assert notes == []
    assert page.errors == []


def test_the_popup_needs_the_browsers_permission_and_the_sound_does_not(page, world):
    base, current = world["base"], world["current"]

    def script(d):
        d.serve(staged(base, "CONFIRMED"))
        d.open()
        d.page.pause(1.2)
        d.serve(base)
        d.until(COUNT(1))
        return d.watch()

    out = both(page, world["url"], current, script, mode="sound + popup", permission="denied")
    assert out["new"]["tones"] == ACT and out["new"]["notes"] == []  # (still a sound and a line)


def test_the_mode_button_goes_round_the_three_modes_saves_the_choice_asks_once_and_plays_a_test_tone(page, world):
    base, current = world["base"], world["current"]

    def script(d):
        d.serve(base)
        d.open()
        seen = [d.watch()]
        for _ in range(4):
            before = len(d.watch()["tones"]) + d.watch()["asked"]
            d.js("document.getElementById('alert-mode').click()")
            d.page.pause(0.4)
            seen.append(d.watch())
            assert before is not None
        return seen

    out = both(page, world["url"], current, script, permission="default")
    steps = out["new"]
    assert [(s["mode"], s["stored"]) for s in steps] == [("🔔 sound", None), ("🔔 off", "off"), ("🔔 sound + popup", "sound + popup"), ("🔔 sound", "sound"), ("🔔 off", "off")]
    assert [s["tones"] for s in steps] == [[], [], INFO, INFO * 2, INFO * 2]  # a tone so you hear that it works, but not when it is turned off
    assert [s["asked"] for s in steps] == [0, 0, 1, 1, 1]  # (the permission is asked when popups are chosen, and only the once)
    assert steps[1]["modeClass"] == "alertmode off" and steps[0]["modeClass"] == "alertmode" and steps[2]["modeClass"] == "alertmode"
    assert steps[0]["modeTitle"].startswith("Alerts: a sound (and a popup) when a setup becomes ready")
    assert page.errors == []


@pytest.mark.parametrize("saved,shown", [("off", "🔔 off"), ("sound + popup", "🔔 sound + popup"), ("sound", "🔔 sound"), ("loud", "🔔 sound"), ("", "🔔 sound")])
def test_a_saved_mode_is_the_one_the_page_starts_in_and_a_junk_value_is_ignored(page, world, saved, shown):
    out = both(page, world["url"], world["current"], lambda d: d.watch(), mode=saved)["new"]
    assert out["mode"] == shown
    assert out["modeClass"] == ("alertmode off" if shown == "🔔 off" else "alertmode")
    assert out["modeTitle"].startswith("Alerts: a sound (and a popup) when a setup becomes ready")


def test_the_choice_of_mode_is_remembered_across_a_reload(page, world):
    """The mode is kept in the browser's storage under one name (`prism-alert-mode`), and a reload starts in it."""
    world["current"][0] = world["base"]
    ident = page.call("Page.addScriptToEvaluateOnNewDocument", source=STUB.replace("__PERMISSION__", "granted").replace("__MODE__", ""))["identifier"]
    try:
        goto(page, world["url"] + "#overview")
        page.until(LIVE, timeout=30)
        for _ in range(2):  # sound -> off -> sound + popup
            page.js("document.getElementById('alert-mode').click()")
        assert page.js("localStorage.getItem('prism-alert-mode')") == "sound + popup"
        goto(page, world["url"] + "#overview")
        page.until(LIVE, timeout=30)
        assert page.js("document.getElementById('alert-mode').textContent") == "🔔 sound + popup"
        page.js("localStorage.removeItem('prism-alert-mode')")
    finally:
        page.call("Page.removeScriptToEvaluateOnNewDocument", identifier=ident)
    forget(page)


def test_a_system_that_stops_being_ready_is_a_warning_once_and_ready_again_is_only_noted(page, world):
    base, current = world["base"], world["current"]

    def script(d):
        d.serve(base)
        d.open()
        d.serve(unready(base))
        d.until(COUNT(1))
        seen = {"unready": d.watch()}
        d.serve(base)
        d.until(COUNT(2))
        seen["ready again"] = d.watch()
        return seen

    out = both(page, world["url"], current, script)
    seen = out["new"]
    assert seen["unready"]["tones"] == WARN and seen["ready again"]["tones"] == WARN  # (ready again makes no sound)
    assert seen["unready"]["line"]["summary"].startswith("⚠ 1 alert: NOT READY · RECOVERING GAPS")
    assert seen["ready again"]["line"] is None  # (ready again: nothing is wrong now)
    assert page.errors == []


def test_losing_the_feed_while_the_market_is_open_is_a_warning(page, world):
    base, current = world["base"], world["current"]
    lost = copy.deepcopy(base)
    lost["connection"]["state"] = "disconnected"
    assert base["connection"]["state"] == "connected" and base["health"]["live"]

    def script(d):
        d.serve(base)
        d.open()
        d.serve(lost)
        d.until(COUNT(1))
        return d.watch()

    out = both(page, world["url"], current, script)
    assert out["new"]["tones"] == WARN and out["new"]["count"] == "1"


def test_a_link_that_is_lost_is_one_warning(page, tmp_path, limits):
    """The server is stopped under the page. (A page that is stale says nothing about the present on its line: the stale notice is the alert. The sound and the count are the warning.)"""
    md = engine(tmp_path)
    log = TradeLog(tmp_path / "trades", clock=md.clock)
    with serving(md, log) as w:
        ident = page.call("Page.addScriptToEvaluateOnNewDocument", source=STUB.replace("__PERMISSION__", "granted").replace("__MODE__", ""))["identifier"]
        try:
            Drive(page, w["url"], [None]).open()
        finally:
            page.call("Page.removeScriptToEvaluateOnNewDocument", identifier=ident)
    page.until(STALE, timeout=15)
    page.pause(0.5)
    got = page.js(WATCH)
    page.pause(6)  # (the page goes on trying to reach a server that is not there: no second warning)
    later = page.js(WATCH)
    assert got["tones"] == WARN and got["count"] == "1" and later["tones"] == WARN and later["count"] == "1"
    assert got["line"] is None
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors  # (a page whose server is gone says so in the console)
    forget(page)  # ... and what it logged is not carried to the next test


def test_the_daily_loss_limit_is_on_the_line_from_the_start_and_said_once_with_a_sound_when_a_trade_leaves_it_reached(page, world, tmp_path, limits):
    base = world["base"]
    log = TradeLog(tmp_path / "trades", clock=world["md"].clock)
    seed(log, "loss")  # Rs 6,000 lost of a limit of Rs 5,000
    world["app"].state.trades = log
    world["current"][0] = base
    ident = page.call("Page.addScriptToEvaluateOnNewDocument", source=STUB.replace("__PERMISSION__", "granted").replace("__MODE__", ""))["identifier"]
    try:
        d = Drive(page, world["url"], world["current"])
        d.open("overview")
        seen = {"start": d.watch()}
        d.js("document.getElementById('tb-trades').click()")
        d.until("document.getElementById('t-log') !== null && document.getElementById('r-lot').value !== ''")
        for id, value in (("t-instr", "NIFTY 24500 CE 17NOV"), ("t-qty", "65"), ("t-price", "100")):
            d.js(f"({SET})({json.dumps(id)}, {json.dumps(value)})")
        d.js("document.getElementById('t-log').click()")
        d.until("document.querySelectorAll('#trades-body button.voidbtn').length === 3")
        d.page.pause(0.5)
        seen["logged"] = d.watch()
        d.js("document.getElementById('t-log').click()")  # (nothing typed any more: refused, and it says nothing more of the limit)
        d.page.pause(0.5)
        d.js(f"({SET})('t-qty', '65')")
        d.js(f"({SET})('t-price', '100')")
        d.js("document.getElementById('t-log').click()")
        d.until("document.querySelectorAll('#trades-body button.voidbtn').length === 4")
        d.page.pause(0.5)
        seen["again"] = d.watch()
    finally:
        page.call("Page.removeScriptToEvaluateOnNewDocument", identifier=ident)
    assert seen["start"]["line"]["cls"] == "alerts bad" and seen["start"]["line"]["summary"] == "⛔ 1 alert: Your daily loss limit is reached ▾ details"
    assert "Rs 6,000 lost of Rs 5,000. Prism's decisions are unchanged: this limit is yours, and it says stop for the day" in seen["start"]["line"]["rows"][0]
    assert seen["start"]["tones"] == [] and seen["start"]["count"] == "0"  # (already reached when the page opened: it is shown, not announced)
    assert seen["logged"]["tones"] == WARN  # (the trade that leaves it reached says so, once)
    assert seen["again"]["tones"] == WARN  # (and not a second time while it is still reached)
    assert seen["again"]["count"] == "0"  # (any click on the page is the reader being back: the count in the title is not left standing)
    assert page.errors == [] or all("status of 422" in e for e in page.errors), page.errors
    forget(page)
