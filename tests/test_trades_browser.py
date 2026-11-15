"""The Trades tab in a REAL browser (headless Chrome or Edge, over its DevTools protocol; skipped, with the reason, when there is none): the built dashboard, served and drawn by the real application over a mocked
market (no broker, no database). The Trades tab is a NOTEBOOK of the reader's own trades and a size calculator: it is the only tab that WRITES (a trade you log, a trade you void), so these tests run against the
real routes and a real trade log in a temporary folder, and check what ends up in the file.

  * five notebooks (none, three trades, a day over its loss limit, a file that does not add up, no limits set) are read by the page and the whole Trades tab says what each calls for (the forms, with their
    fields, placeholders and values; the day's notebook; the calculator)
  * the WRITES: trades typed into the page, one sell, one void, leave exactly the lines they should in the file (a trade stamped with what Prism's decision said, a sell with none, a void that names its trade)
  * LOOKING WRITES NOTHING: opening the tab, the calculator and every other tab leave the notebook's file as it was (it is not even made)
  * the page asks for the trades ONCE as it starts, whichever tab it is on, and for the calculator only when asked
  * the calculator says the right thing for an answer, for a refusal and with no limit set
  * the same when the page has LOST ITS LINK (a real server stopped): the last snapshot and the trades it had read, dimmed
  * it fits: no sideways scroll at 1366x768, 1920x1080 and narrower widths

(Until the cutover the same notebooks and the same trades typed in were compared, element by element and line by line, with the page that the dashboard replaced. That proof is in the README, and the page is gone.)"""

import contextlib
import json

import pytest
from browser_support import BROWSER, browser, free_port, frozen, goto, keep, page, run_server  # noqa: F401
from dashboard_states import STATES
from test_journal_browser import settled

from app.main import create_app
from app.trades import TradeLog

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the React Trades tab was not run in a real browser")

LIMITS = {"RISK_CAPITAL": "100000", "RISK_PER_TRADE_PCT": "2", "RISK_MAX_DAILY_LOSS": "5000"}
READ = r"""(() => {
    const root = document.getElementById('tab-trades'); if (!root) return null;
    const fields = {}; for (const e of root.querySelectorAll('input, select')) fields[e.id] = {type: e.getAttribute('type') || e.tagName.toLowerCase(), placeholder: e.getAttribute('placeholder') || '', maxlength: e.getAttribute('maxlength') || '', value: e.value};
    // the text as the browser shows it: the spaces at the edges of a text in a flex or grid row or in a table, and spaces alone at the edge of a block or next to one, are not shown
    const quiet = e => /^(flex|grid|inline-flex|inline-grid|table|table-row|table-row-group|table-header-group)$/.test(getComputedStyle(e).display) || /^(TABLE|TBODY|THEAD|TR|SELECT)$/.test(e.tagName);
    const block = n => n.nodeType === 1 && !/^inline/.test(getComputedStyle(n).display);
    const shown = c => { const p = c.previousSibling, n = c.nextSibling; return !!p && !!n && !block(p) && !block(n); };
    const parts = []; const walk = e => { for (const c of e.childNodes) { if (c.nodeType === 1) walk(c); else if (c.nodeType === 3 && (quiet(e) || c.textContent.trim() || shown(c))) parts.push(quiet(e) ? c.textContent.trim() : c.textContent); } }; walk(root);
    const rows = [...root.querySelectorAll('#trades-body table.t tr')].slice(1).map(r => [...r.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
    return {text: parts.join('').replace(/\s+/g, ' ').trim(), fields, rows, voids: [...root.querySelectorAll('button.voidbtn')].map(b => b.getAttribute('data-void')),
            msg: (document.getElementById('t-msg') || {}).textContent, msgClass: (document.getElementById('t-msg') || {}).className};
})()"""
LIVE_TRADES = (
    "document.getElementById('t-log') !== null && document.getElementById('c-market').textContent !== 'CONNECTING' && document.getElementById('trades-body').textContent.length > 0"
    " && !document.getElementById('trades-body').textContent.includes('loading…') && document.getElementById('r-lot').value !== ''"
)
SET = r"""((id, value) => { const el = document.getElementById(id); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true})); })"""
ASKED = "performance.getEntriesByType('resource').filter(e => e.name.includes('%s')).length"
ROWS = "document.querySelectorAll('#trades-body button.voidbtn').length"


def open_trades(page, url):
    goto(page, url + "#trades")
    page.until(LIVE_TRADES, timeout=30)


def refusals(page):
    """The browser logs every answer that is not a success as a console error ('Failed to load resource ... 422'): a refusal the test PROVOKES is expected, and is not a fault of the page. Anything else in the console is."""
    expected = [e for e in page.errors if e.startswith("log: Failed to load resource") and "status of 422" in e]
    assert [e for e in page.errors if e not in expected] == [], page.errors
    return len(expected)


def forget(page):
    """A blank page: what the tab logged is not carried to the next test (the browser tells a page that is opened about the entries of the one before)."""
    page.call("Page.navigate", url="about:blank")
    page.pause(0.4)


def set_value(page, id, value):
    page.js(f"({SET})({json.dumps(id)}, {json.dumps(value)})")


def click(page, id):
    page.js(f"document.getElementById({json.dumps(id)}).click()")


def sure(page):
    """Both pages ask 'void this trade?' with the browser's own dialog: it is answered yes before the page's own scripts run (a dialog would stop the browser until it is answered)."""
    page.call("Page.addScriptToEvaluateOnNewDocument", source="window.confirm = () => true;")


def engine(tmp_path):
    md = STATES["buy_ce"][0](str(tmp_path / "journal"))
    md.instance = {"pid": 0, "port": 0, "marker": "buy_ce"}
    settled(md)
    frozen(md)
    return md


def seed(log, case):
    """The notebooks the tab is read against. A trade is added the way the route adds it: with what Prism's decision said when it was logged."""
    buy = {"action": "BUY CE", "setup_id": "trend_pullback:bull:1793940000", "strategy": "trend_pullback", "price": 24281.0}
    wait = {"action": "WAIT", "setup_id": None, "strategy": None, "price": 24262.5}
    if case in ("three", "no_limits"):
        log.add({"instrument": "NIFTY 24500 CE 17NOV", "side": "BUY", "qty": 150, "price": 100.5, "setup_id": buy["setup_id"], "note": "first lot"}, buy)
        log.add({"instrument": "NIFTY 24500 CE 17NOV", "side": "BUY", "qty": 75, "price": 95.0}, wait)
        log.add({"instrument": "NIFTY 24500 CE 17NOV", "side": "SELL", "qty": 100, "price": 120.0, "note": "took part off"})
    elif case == "loss":
        log.add({"instrument": "NIFTY 24500 CE 17NOV", "side": "BUY", "qty": 150, "price": 100.0}, buy)
        log.add({"instrument": "NIFTY 24500 CE 17NOV", "side": "SELL", "qty": 150, "price": 60.0, "note": "stopped out"})  # Rs 6,000 lost of a limit of Rs 5,000
    elif case == "broken":  # a file that was edited by hand: a sell with nothing to sell
        log.dir.mkdir(parents=True, exist_ok=True)
        log.path(log.clock()).write_text(json.dumps({"v": 1, "kind": "trade", "id": "t1-1", "t": log.clock(), "instrument": "X", "side": "SELL", "qty": 1, "price": 1.0}) + "\n", encoding="utf-8")


@contextlib.contextmanager
def serving(md, log):
    """The real application on a free port, with its trade log in a temporary folder (never the real one)."""
    app = create_app(md, feed=None)
    app.state.trades = log
    port = free_port()
    server, thread = run_server(app, port)
    try:
        yield {"app": app, "url": f"http://127.0.0.1:{port}/", "md": md}
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    """One application for the module, over the engine of the BUY CE state; each test gives it a notebook of its own."""
    folder = tmp_path_factory.mktemp("trades")
    md = engine(folder)
    with serving(md, TradeLog(folder / "start", clock=md.clock)) as w:
        yield w


@pytest.fixture
def limits(monkeypatch):
    for k, v in LIMITS.items():
        monkeypatch.setenv(k, v)


def notebook(world, tmp_path, name, case=None):
    log = TradeLog(tmp_path / name, clock=world["md"].clock)
    if case:
        seed(log, case)
    world["app"].state.trades = log
    return log


def files(log):
    return sorted(p.name for p in log.dir.glob("trades-*")) if log.dir.exists() else []


@pytest.mark.parametrize("case", ["empty", "three", "loss", "broken", "no_limits"])
def test_the_trades_tab_says_what_each_notebook_calls_for(page, world, tmp_path, monkeypatch, case):
    for k, v in LIMITS.items():
        monkeypatch.setenv(k, v)
    if case == "no_limits":
        for k in LIMITS:
            monkeypatch.delenv(k)
    notebook(world, tmp_path, case, case)
    open_trades(page, world["url"])
    got = page.js(READ)
    text = got["text"]
    expected = {
        "empty": ["no trade logged today", "Loss limit for the day Rs 5,000 (0% used)", "Open nothing"],
        "three": ["Realised Rs 1,950", "Open NIFTY 24500 CE 17NOV 125 @ 97.20", "followed Prism: yes: the setup you named", "followed Prism: no", "(0% used)"],
        "loss": ["⛔ You have reached your own loss limit for the day (Rs 6,000 of Rs 5,000)", "(120% used)", "Realised Rs -6,000"],
        "broken": ["the trade file does not add up"],
        "no_limits": ["Loss limit for the day not set", "Realised Rs 1,950"],
    }[case]
    for want in expected:
        assert want in text, f"{case}: the tab does not say {want!r}: {text[:600]}"
    if case == "three":  # the table: a buy shows what its sold part made, a sell the result, and the three trades are in order
        assert [r[1] for r in got["rows"]] == ["BUY", "BUY", "SELL"] and [r[5] for r in got["rows"]] == ["100", "0", ""] and [r[6] for r in got["rows"]] == ["Rs 1,950", "", "Rs 1,950"]
        assert got["rows"][0][7] == "CE SETUP at 24281.00 · followed Prism: yes: the setup you named" and got["rows"][1][7] == "WAIT at 24262.50 · followed Prism: no" and got["rows"][2][7] == ""
        assert len(got["voids"]) == 3
    if case == "loss":
        assert page.js("document.querySelector('#trades-body .badbox') !== null")
        assert page.js("document.querySelector('[data-testid=alert-line] summary').textContent").startswith("⛔ 1 alert: Your daily loss limit is reached")  # (on the alert line: every tab shows it)
    if case in ("empty", "broken"):
        assert got["rows"] == [] and got["voids"] == []
    assert page.errors == []


def test_the_logging_form_and_the_calculator_have_the_fields_there_are(page, world, tmp_path, limits):
    notebook(world, tmp_path, "forms")
    open_trades(page, world["url"])
    got = page.js(READ)
    f = got["fields"]
    assert list(f) == ["t-instr", "t-side", "t-qty", "t-price", "t-setup", "t-note", "r-entry", "r-stop", "r-lot", "r-capital", "r-pct", "r-max"]  # (six to log a trade with, six to size one)
    assert f["t-instr"] == {"type": "text", "placeholder": "NIFTY 24500 CE 17NOV", "maxlength": "60", "value": ""} and f["t-side"]["value"] == "BUY" and f["t-qty"]["placeholder"] == "65"
    assert f["t-setup"]["maxlength"] == "120" and f["t-note"]["maxlength"] == "300" and f["r-capital"]["placeholder"] == "from RISK_CAPITAL" and f["r-max"]["placeholder"] == "from RISK_MAX_DAILY_LOSS"
    assert f["r-lot"]["value"] == "75"  # the lot size of the contracts being watched
    assert "Log a trade you made" in got["text"] and "Size a trade" in got["text"] and "Prism places no order and reads no account" in got["text"]


def logged_through(page, url, note):
    """Trades typed into the page: a BUY, a SELL of part of it, and the void of that SELL (the page asks 'void this trade?' and is answered yes)."""
    sure(page)
    open_trades(page, url)
    set_value(page, "t-instr", "NIFTY 24500 CE 17NOV")
    set_value(page, "t-qty", "65")
    set_value(page, "t-price", "101.50")
    set_value(page, "t-note", note)
    click(page, "t-use-setup")
    click(page, "t-log")
    page.until(f"{ROWS} === 1")
    set_value(page, "t-side", "SELL")
    set_value(page, "t-qty", "40")
    set_value(page, "t-price", "120")
    set_value(page, "t-note", "took some off")
    click(page, "t-log")
    page.until(f"{ROWS} === 2")
    page.js("[...document.querySelectorAll('#trades-body button.voidbtn')].pop().click()")
    page.until(f"{ROWS} === 1")
    page.until("document.getElementById('t-msg').textContent === 'voided'")
    page.pause(0.3)


def as_written(log):
    """What the file holds, as the page's two writes made it: the trades, in order, and the void as the number of the trade it cancels (the ids and the times are the moment's)."""
    records = log.load(log.clock())
    number = {r["id"]: i for i, r in enumerate(x for x in records if x["kind"] == "trade")}
    return [{k: v for k, v in r.items() if k not in ("id", "t", "time")} if r["kind"] == "trade" else {"kind": "void", "void_of": number[r["void_of"]]} for r in records]


def test_logging_and_voiding_in_the_page_leave_exactly_the_lines_they_should_in_the_file(page, world, tmp_path, limits):
    log = notebook(world, tmp_path, "writes")
    logged_through(page, world["url"], "first")
    written, after = as_written(log), page.js(READ)
    assert files(log) == ["trades-2026-11-06.jsonl"]  # (one file, the day's: and the lines are only ever added)
    assert [r["kind"] for r in written] == ["trade", "trade", "void"] and written[2]["void_of"] == 1
    buy, sell = written[0], written[1]
    assert (buy["instrument"], buy["side"], buy["qty"], buy["price"], buy["note"]) == ("NIFTY 24500 CE 17NOV", "BUY", 65, 101.5, "first")
    assert buy["prism"]["action"] == "BUY CE" and buy["setup_id"] == buy["prism"]["setup_id"]  # (stamped with what Prism said; "Use Prism's setup" filled the setup in)
    assert (sell["side"], sell["qty"], sell["price"], sell["note"], sell["prism"], sell["setup_id"]) == ("SELL", 40, 120.0, "took some off", None, None)
    assert after["msg"] == "voided" and after["msgClass"] == "" and len(after["voids"]) == 1 and "Realised" in after["text"]
    assert after["fields"]["t-instr"]["value"] == "NIFTY 24500 CE 17NOV" and after["fields"]["t-side"]["value"] == "SELL"  # (the instrument and the side stay for the next one)
    assert [after["fields"][k]["value"] for k in ("t-qty", "t-price", "t-note", "t-setup")] == ["", "", "", ""]  # (the numbers, the note and the setup, which belongs to that one trade, do not)
    assert page.errors == []


def test_a_refused_trade_is_said_in_the_page_and_writes_nothing(page, world, tmp_path, limits):
    log = notebook(world, tmp_path, "refused")
    open_trades(page, world["url"])
    set_value(page, "t-side", "SELL")
    set_value(page, "t-instr", "NIFTY 24500 CE 17NOV")
    set_value(page, "t-qty", "65")
    set_value(page, "t-price", "90")
    click(page, "t-log")
    page.until("document.getElementById('t-msg').textContent.startsWith('not logged')")
    assert page.js("document.getElementById('t-msg').textContent") == "not logged: nothing to sell: NIFTY 24500 CE 17NOV has 0 unit(s) open and the sell is for 65"
    assert page.js("document.getElementById('t-msg').className") == "err"
    assert files(log) == []
    assert refusals(page) == 1  # (the one refusal, and nothing else in the console)
    forget(page)


def test_looking_writes_nothing_and_the_page_asks_once_for_the_trades_and_for_the_calculator_only_when_asked(page, world, tmp_path, limits):
    log = notebook(world, tmp_path, "looking", "three")
    before = log.path(log.clock()).read_bytes()
    open_trades(page, world["url"])
    assert page.js(ASKED % "/api/trades") == 1 and page.js(ASKED % "/api/risk") == 0
    for tab in ("overview", "chart", "options", "analysis", "journal", "trades", "overview"):
        page.js(f"document.getElementById('tb-{tab}').click()")
        page.pause(0.35)
    page.pause(2.2)  # (snapshots keep arriving: none of them is a reason to ask again)
    assert page.js(ASKED % "/api/trades") == 1 and page.js(ASKED % "/api/risk") == 0
    page.js("document.getElementById('tb-trades').click()")
    set_value(page, "r-entry", "100")
    set_value(page, "r-stop", "80")
    click(page, "t-calc")
    page.until(ASKED % "/api/risk" + " === 1")
    assert page.js(ASKED % "/api/trades") == 1
    assert log.path(log.clock()).read_bytes() == before, "looking at the tab changed the notebook"
    origin = world["url"].rstrip("/")
    names = page.js("performance.getEntriesByType('resource').map(e => e.name)")
    assert all(n.startswith(origin) for n in names), [n for n in names if not n.startswith(origin)]  # nothing of another site
    assert page.errors == []


def test_a_page_that_looks_makes_no_notebook_at_all(page, world, tmp_path, limits):
    log = notebook(world, tmp_path, "untouched")
    open_trades(page, world["url"])
    set_value(page, "r-entry", "100")
    set_value(page, "r-stop", "80")
    click(page, "t-calc")
    page.until("document.getElementById('risk-out').textContent.length > 0")
    assert files(log) == [] and not log.dir.exists()


CALC = [
    ("an answer", {"r-entry": "100", "r-stop": "80"},
     ["1 lot (75 units): loss at the stop Rs 1,500, premium outlay Rs 7,500 (7.5% of capital). Decided by your per-trade limit (Rs 2,000).",
      "One lot (75 units) loses Rs 1,500 at your stop (100.00 to 80.00) and costs Rs 7,500 to buy. By limit: per-trade 1 lot(s), today 3 lot(s).", "You decide."]),
    ("an answer with its own limits", {"r-entry": "100", "r-stop": "80", "r-capital": "200000", "r-pct": "1.5", "r-max": "9000"},
     ["2 lots (150 units): loss at the stop Rs 3,000, premium outlay Rs 15,000 (7.5% of capital). Decided by your per-trade limit (Rs 3,000).", "By limit: per-trade 2 lot(s), today 6 lot(s)."]),
    ("not even one lot", {"r-entry": "100", "r-stop": "10", "r-lot": "75", "r-capital": "10000", "r-pct": "1"},
     ["0 lots (0 units)", "⚠ not even one lot fits: one lot loses Rs 6,750 at that stop, more than your per-trade limit allows"]),
    ("a stop that is not below the entry", {"r-entry": "80", "r-stop": "100"}, ["the stop premium must be below the entry premium: Prism's trades are buys of options"]),
    ("numbers that are not numbers", {"r-entry": "abc", "r-stop": "80"}, ["fill in the entry premium, the stop premium and the lot size (numbers)"]),
    ("nothing filled in", {}, ["fill in the entry premium, the stop premium and the lot size (numbers)"]),
]
REFUSED = ("a stop that is not below the entry", "numbers that are not numbers", "nothing filled in")


@pytest.mark.parametrize("name,fields,says", CALC, ids=[c[0] for c in CALC])
def test_the_calculator_says_what_the_numbers_call_for(page, world, tmp_path, limits, name, fields, says):
    notebook(world, tmp_path, "calc")
    open_trades(page, world["url"])
    for id, value in fields.items():
        set_value(page, id, value)
    click(page, "t-calc")
    page.until("document.getElementById('risk-out').textContent.length > 0")
    said = " ".join(page.js("document.getElementById('risk-out').textContent").split())
    for want in says:
        assert want in said, f"{name}: the calculator does not say {want!r}: {said}"
    assert (page.js("document.querySelector('#risk-out .err') !== null")) == (name in REFUSED), name  # a refusal is in red
    assert refusals(page) == (1 if name in REFUSED else 0), (name, said)  # (a refusal is logged by the browser once)
    forget(page)


def test_with_no_limit_set_the_calculator_gives_the_loss_for_one_lot_and_says_how_to_set_one(page, world, tmp_path, monkeypatch):
    for k in LIMITS:
        monkeypatch.delenv(k, raising=False)
    notebook(world, tmp_path, "nolimits")
    open_trades(page, world["url"])
    set_value(page, "r-entry", "100")
    set_value(page, "r-stop", "80")
    click(page, "t-calc")
    page.until("document.getElementById('risk-out').textContent.length > 0")
    said = " ".join(page.js("document.getElementById('risk-out').textContent").split())
    assert "no limit is set: set RISK_CAPITAL" in said and "One lot (75 units) loses Rs 1,500" in said and "lot(s)" not in said


@pytest.mark.parametrize("state", ["buy_ce", "wait"])
def test_a_page_that_lost_its_link_keeps_the_trades_it_had_read(page, tmp_path, limits, state):
    """The server is stopped under the page: it keeps the last snapshot and the trades it had read, dimmed."""
    md = STATES[state][0](str(tmp_path / "journal"))
    md.instance = {"pid": 0, "port": 0, "marker": state}
    frozen(settled(md))
    log = TradeLog(tmp_path / "trades", clock=md.clock)
    seed(log, "three")
    with serving(md, log) as w:
        open_trades(page, w["url"])
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    page.pause(0.4)
    got = page.js(READ)
    assert "Realised Rs 1,950" in got["text"] and len(got["voids"]) == 3
    assert float(page.js("getComputedStyle(document.querySelector('#tab-trades')).opacity")) < 1  # dimmed
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors  # (a page whose server is gone says so in the console)
    forget(page)


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080), (1280, 720), (1100, 700), (900, 700)])
def test_it_fits_the_width_with_the_table_scrolling_inside_its_own_box(page, world, tmp_path, limits, width, height):
    notebook(world, tmp_path, "fit", "three")  # three trades: the widest content
    page.size(width, height)
    open_trades(page, world["url"])
    page.pause(0.6)
    m = page.js("(() => { const d = document.documentElement; return {vw: innerWidth, scrollW: d.scrollWidth, rows: document.querySelectorAll('#trades-body tr').length}; })()")
    assert m["scrollW"] <= m["vw"], f"the Trades tab is {m['scrollW']} px wide on a {m['vw']} px screen"
    assert m["rows"] == 4  # (the header and the three trades: this really was the wide one)
    keep(page, tmp_path, f"react-trades-{width}x{height}")
    assert page.errors == []
