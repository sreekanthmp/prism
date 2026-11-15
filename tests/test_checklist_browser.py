"""The pre-trade checklist in a REAL browser (headless Chrome or Edge, over its DevTools protocol; skipped, with the reason, when there is none): the built dashboard, served and drawn by the real application over
a mocked market (no broker, no database).

  * it is one line in the decision banner ("Checklist 12 of 13 met"), closed, and opens over the page without moving anything, stays open while the page updates, and closes the explanation (and is closed by it)
  * in each of the 14 pinned states every row says what that state's own snapshot calls for: the answers are worked out here a SECOND time, from the rules written out again in Python, and compared
  * what the reader ticks survives a visit to another tab, and is for the setup that is live (another setup starts clean)
  * it fits 1366x768 and 1920x1080 open (inside the width, no text under 10 px) and its closed line moves nothing
  * on a page that has lost its link it answers nothing (every row unknown), and says it is a checklist, not a signal

Mocked market only: nothing here has been looked at against a live session."""

import pytest
from browser_support import BROWSER, WORD, browser, free_port, frozen, goto, keep, page, run_server, served  # noqa: F401
from dashboard_harness import base_engine
from dashboard_states import STATES

from app.main import create_app

pytestmark = pytest.mark.skipif(BROWSER is None, reason="no Chrome, Chromium or Edge was found on this machine: the pre-trade checklist was not run in a real browser")

LIVE_OVERVIEW = "document.getElementById('decision') && document.getElementById('decision').className.indexOf('loading') === -1 && document.getElementById('c-market').textContent !== 'CONNECTING'"
ROWS = "Object.fromEntries([...document.querySelectorAll('#pretrade [data-check]')].map(r => [r.dataset.check, r.dataset.status]))"
BADGE = "(document.querySelector('[data-testid=pretrade-badge]') || {}).textContent"
BOXES = "[...document.querySelectorAll('#pretrade input[type=checkbox]')].map(b => b.checked)"
OPEN = "document.querySelector('#pretrade').open"
POP = "document.querySelector('#pretrade > .popbody')"
ORDER = ["session", "data", "volatility", "regime", "setup", "trend", "confirmed", "area", "clear", "cautions", "levels", "decision", "contract"]


def open_overview(page, url):
    goto(page, url + "#overview")
    page.until(LIVE_OVERVIEW, timeout=30)


def open_checklist(page):
    if not page.js(OPEN):
        page.js("document.querySelector('#pretrade > summary').click()")
        page.until(f"{POP}.getBoundingClientRect().height > 100")


# -- the answers, worked out a second time ------------------------------------------------------------------------------------------------------------------------------
def expected(snap):
    """What each row should say for this snapshot, from the rules written out again here (not from the page's own code)."""
    t, h = snap["trading"], snap["health"]
    d, se, m = t["decision"], t["session"], t["market"]
    x = next((s for s in t["setups"] if s["id"] == d["setup_id"]), None) or next((s for s in t["setups"] if s["id"] == (t.get("explain") or {}).get("setup")), None)
    permitted = bool(x) and any(c["granted"] and c.get("setup_id") == x["id"] for c in t["counter_trend"])
    out = {}
    out["session"] = "unknown" if not se else "fail" if not se["entries_allowed"] else "warn" if se.get("strict") else "pass"
    spot = next((i for i in snap["instruments"] if i["role"] == "SPOT"), None)
    if not h["live"] or snap["connection"]["state"] != "connected" or not h["trusted"] or (t["data"] and not t["data"]["ok"]) or (h.get("time") and not h["time"]["trusted"]) or spot is None or spot["status"] != "fresh":
        out["data"] = "fail"
    else:
        out["data"] = "warn" if h["warnings"] else "pass"
    if not m:
        out["volatility"] = out["regime"] = "unknown"
    else:
        out["volatility"] = "fail" if d["headline"].upper().startswith("NO TRADE: VOLATILITY") else {"normal": "pass", "low": "pass", "high": "warn"}.get(m["volatility"], "unknown")
        out["regime"] = ("warn" if permitted else "fail") if m["regime"] in ("conflicting", "unclear") else "pass"
    if x is None:
        out["setup"], out["decision"] = "fail", "fail"
        for k in ("trend", "confirmed", "area", "clear", "cautions", "levels"):
            out[k] = "na"
    else:
        out["setup"] = "pass"
        out["decision"] = "pass" if d["action"] == "BUY " + x["direction"] and d["setup_id"] == x["id"] else "fail"
        tf = (snap.get("analysis") or {}).get("timeframes") or {}
        trends = [(tf.get(k) or {}).get("trend") for k in ("1h", "15m")]
        against = "bearish" if x["direction"] == "CE" else "bullish"
        out["trend"] = "unknown" if not (snap.get("analysis") or {}).get("available") or None in trends or "unknown" in trends else ("warn" if permitted else "fail") if against in trends else "pass"
        confirmed = bool(x.get("candle_confirmed")) or x.get("confirmed_at") is not None
        out["confirmed"] = "pass" if confirmed else "fail"
        ps = x.get("price_state")
        out["area"] = "na" if not confirmed else "pass" if ps == "in_entry_area" else "unknown" if ps is None else "fail"
        out["clear"] = "fail" if x["blockers"] else "pass"
        out["cautions"] = "warn" if x["against"] else "pass"
        plan = x.get("plan") or {}
        out["levels"] = "fail" if x.get("invalidation") is None else "pass" if plan.get("targets") else "warn"
    opt, buy = snap.get("options"), d["action"] in ("BUY CE", "BUY PE")
    if not buy:
        out["contract"] = "na"
    elif not opt or not opt.get("available"):
        out["contract"] = "unknown"
    else:
        sel, side = opt.get("selection") or {}, d["action"][-2:]
        c = sel.get("contract")
        ok = bool(sel.get("actionable") and c and sel.get("kind") == side and c["kind"] == side and (opt.get("decision") or {}).get("action") == d["action"])
        out["contract"] = "fail" if not ok or c["freshness"] != "fresh" or c["blocking"] else "warn" if any(f["severity"] == "warn" for f in c["flags"]) or c["expiry_day"] else "pass"
    return out


def test_it_is_one_closed_line_in_the_decision_banner_that_says_how_many_are_met(page, served):
    open_overview(page, served["url"])
    assert page.js("!!document.querySelector('#decision #pretrade')") is True  # in the banner, beside "Explain this decision"
    assert page.js(OPEN) is False
    assert page.js(BADGE) == "12 of 13 met"
    assert page.js("document.querySelector('#pretrade > summary').textContent.replace(/\\s+/g, ' ').trim()") == "Checklist 12 of 13 met ▾"
    assert page.js("Object.keys(" + ROWS + ")") == ORDER
    assert page.errors == [], page.errors


def test_it_opens_over_the_page_without_moving_it_and_stays_open_while_the_page_updates(page, served, tmp_path):
    open_overview(page, served["url"])
    before = page.js("(() => { const r = document.getElementById('tfrow').getBoundingClientRect(); const d = document.getElementById('decision').getBoundingClientRect(); return [r.top, r.height, d.height]; })()")
    open_checklist(page)
    assert page.js("(() => { const r = document.getElementById('tfrow').getBoundingClientRect(); const d = document.getElementById('decision').getBoundingClientRect(); return [r.top, r.height, d.height]; })()") == before  # it floats: nothing moves
    text = " ".join(page.js(f"{POP}.textContent").split())
    for said in ("Before you trade", "The day and the data", "The setup", "The option", "Yours to check: Prism cannot see these", "12 of 13 met · 1 caution — yours: 0 of 5 ticked", "Prism says CE setup ready", "A checklist, not a signal"):
        assert said in text, said
    keep(page, tmp_path, "checklist-open")
    page.pause(2.5)  # two more snapshots arrive
    assert page.js(OPEN) is True
    assert page.errors == [], page.errors


def test_opening_it_closes_the_explanation_and_the_other_way_round(page, served):
    open_overview(page, served["url"])
    page.js("document.querySelector('details.pop:not(#pretrade) > summary').click()")
    page.until("document.querySelector('details.pop:not(#pretrade)').open")
    open_checklist(page)
    assert page.js("document.querySelector('details.pop:not(#pretrade)').open") is False  # only one floats over the page at a time
    page.js("document.querySelector('details.pop:not(#pretrade) > summary').click()")
    page.until("document.querySelector('details.pop:not(#pretrade)').open")
    assert page.js(OPEN) is False
    assert page.errors == [], page.errors


def test_in_every_pinned_state_each_row_says_what_that_states_own_snapshot_calls_for(page, served, tmp_path):
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
            assert page.js("document.querySelector('#decision .dtxt').textContent.trim()") == WORD.get(action, action), name
            got = page.js(ROWS)
            assert got == expected(snap), (name, {k: (got.get(k), v) for k, v in expected(snap).items() if got.get(k) != v})
            seen.append((name, tuple(got[k] for k in ORDER)))
            assert page.js("document.getElementById('jserr')") is None, name
    finally:
        served["app"].state.md = md0
        md0.on_change()
    assert len(seen) == len(STATES) and len({s[1] for s in seen}) >= 7, [s[1] for s in seen]  # the states really differ: the check looked at different answers
    kinds = {v for _, row in seen for v in row}
    assert {"pass", "warn", "fail", "na"} <= kinds, kinds  # ... and between them they show met, a caution, not met and not yet
    assert page.errors == [], page.errors


def test_what_the_reader_ticks_survives_a_visit_to_another_tab_and_is_for_the_setup_that_is_live(page, served, tmp_path):
    md0 = served["app"].state.md
    other = STATES["buy_pe"][0](str(tmp_path))
    other.instance = {"pid": 0, "port": 0, "marker": "buy_pe"}
    other.on_change = md0.on_change
    frozen(other)
    open_overview(page, served["url"])
    open_checklist(page)
    assert page.js(BOXES) == [False] * 5
    page.js("document.getElementById('pt-m-chain').click(); document.getElementById('pt-m-stop').click()")
    page.until("document.querySelector('[data-testid=pretrade-summary]').textContent.includes('yours: 2 of 5 ticked')")
    page.js("document.getElementById('tb-options').click()")
    page.until("location.hash === '#options'")
    page.js("document.getElementById('tb-overview').click()")
    page.until("location.hash === '#overview' && !!document.getElementById('pretrade')")
    open_checklist(page)
    assert page.js(BOXES) == [True, False, True, False, False]  # (still ticked: the page was not reloaded)
    try:
        served["app"].state.md = other  # another setup is live (a put)
        page.until("document.querySelector('#decision .dtxt').textContent.trim() === 'PE SETUP'", timeout=20)
        assert page.js(BOXES) == [False] * 5
    finally:
        served["app"].state.md = md0
        md0.on_change()
    page.until("document.querySelector('#decision .dtxt').textContent.trim() === 'CE SETUP'", timeout=20)
    assert page.js(BOXES) == [True, False, True, False, False]  # the first setup is live again: its ticks are as they were
    assert page.errors == [], page.errors


def test_the_links_go_to_the_options_and_trades_tabs(page, served):
    open_overview(page, served["url"])
    open_checklist(page)
    page.js("document.querySelector('#pretrade [data-check=contract] button.linkbtn').click()")
    page.until("location.hash === '#options'")
    page.js("document.getElementById('tb-overview').click()")
    page.until("location.hash === '#overview' && !!document.getElementById('pretrade')")
    open_checklist(page)
    page.js("document.querySelector('#pretrade [data-manual=stop] button.linkbtn').click()")
    page.until("location.hash === '#trades'")
    assert page.errors == [], page.errors


@pytest.mark.parametrize("width,height", [(1366, 768), (1920, 1080)])
def test_it_fits_open_and_its_closed_line_moves_nothing(page, served, tmp_path, width, height):
    served["md"].set_state("connected")
    page.size(width, height)
    open_overview(page, served["url"])
    page.pause(1.0)
    closed = page.js("(() => { const d = document.documentElement; return [d.scrollWidth, d.scrollHeight, innerWidth, innerHeight]; })()")
    assert closed[1] <= closed[3] and closed[0] <= closed[2], f"closed, the Overview needs {closed[0]}x{closed[1]} of a {closed[2]}x{closed[3]} screen"
    open_checklist(page)
    page.pause(0.4)
    m = page.js(
        """(() => { const pop = document.querySelector('#pretrade > .popbody'), r = pop.getBoundingClientRect(), d = document.documentElement; let smallest = 99;
        const w = document.createTreeWalker(pop, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode, p = n.parentElement; if (!n.textContent.trim() || !p) continue; const q = p.getBoundingClientRect(); if (!q.width || !q.height) continue; smallest = Math.min(smallest, parseFloat(getComputedStyle(p).fontSize)); }
        return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, scrollW: d.scrollWidth, scrollH: d.scrollHeight, inner: pop.scrollHeight, clientH: pop.clientHeight, smallest}; })()"""
    )
    assert m["left"] >= 0 and m["right"] <= m["vw"] + 1, m  # inside the width
    assert m["bottom"] <= m["vh"] and m["inner"] <= m["clientH"] + 1, m  # every row in view, with no scrolling inside it: the decision and the option are the rows read last
    assert m["scrollW"] <= m["vw"] and m["scrollH"] <= m["vh"], m  # opening it makes the page no larger: it floats
    assert m["smallest"] >= 10, m
    keep(page, tmp_path, f"checklist-open-{width}x{height}")
    assert page.errors == [], page.errors


def test_on_a_page_that_lost_its_link_it_answers_nothing_but_still_takes_the_readers_ticks(page, tmp_path):
    build, _ = STATES["buy_ce"]
    md = build(str(tmp_path))
    md.instance = {"pid": 0, "port": 0, "marker": "buy_ce"}
    frozen(md)
    port = free_port()
    server, thread = run_server(create_app(md, feed=None), port)
    try:
        open_overview(page, f"http://127.0.0.1:{port}/")
        assert page.js(BADGE) == "12 of 13 met"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    page.until("document.querySelector('.stalebar') !== null", timeout=15)
    page.pause(0.4)
    assert page.js(BADGE) == "not current"
    open_checklist(page)
    assert set(page.js(ROWS).values()) == {"unknown"}
    assert " ".join(page.js("document.querySelector('[data-testid=pretrade-summary]').textContent").split()) == "not current: the page lost its link to Prism"
    page.js("document.getElementById('pt-m-limit').click()")
    page.until("document.getElementById('pt-m-limit').checked")
    assert page.errors == [] or all("ERR_CONNECTION" in e or "WebSocket" in e for e in page.errors), page.errors


def test_it_says_it_is_a_checklist_and_not_a_signal_and_never_a_green_light(page, served):
    open_overview(page, served["url"])
    open_checklist(page)
    text = " ".join(page.js(f"{POP}.textContent").split())
    assert "A checklist, not a signal" in text and "Prism places no orders; the decision is yours." in text
    for banned in ("go ahead", "safe to trade", "take the trade", "enter now", "buy now", "all clear"):
        assert banned not in text.lower(), banned
    assert page.js("document.querySelector('#pretrade').closest('#decision') !== null")
