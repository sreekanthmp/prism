"""Stage 9.1: the React dashboard's foundation, from Prism's side (and, since 9.2, the chart library it brought). (Its own behaviour is tested by `npm test` in frontend/; this file is what only Python can see.)

  * Prism serves the BUILT dashboard at /app (a real server on a real port), the current dashboard still at /, and nothing outside the built folder
  * the committed bundle is the bundle of the committed source (a hash of the source, written by the build, is compared with one computed here), so nobody edits frontend/src and forgets to rebuild
  * the build is reproducible and safe: exact versions only, every package from the npm registry with an integrity hash, no install script allowed, nothing loaded from another site
  * the test fixture is the engine's real snapshot, and the part of it the dashboard reads still has the shape the dashboard's types say
  * the new route is a static one: it accepts only reads, and adds nothing that writes"""

import hashlib
import json
import re
import socket
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from dashboard_harness import base_engine

from app import main as app_main
from app.main import create_app

ROOT = Path(__file__).resolve().parent.parent
FRONT = ROOT / "frontend"
DIST = ROOT / "app" / "static" / "app"
FIXTURE = FRONT / "src" / "test" / "fixtures" / "snapshot.json"
CHART_FIXTURE = FRONT / "src" / "test" / "fixtures" / "chart.json"
JOURNAL_FIXTURE = FRONT / "src" / "test" / "fixtures" / "journal.json"


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 1. Served at / (since the cutover of Stage 9.8; its files are under /app/assets, and /app itself goes to /)
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def served():
    import uvicorn

    md, _clock = base_engine()
    app = create_app(md, feed=None)
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    end = time.time() + 15
    while not server.started and time.time() < end:
        time.sleep(0.05)
    assert server.started, "the application did not start"
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=10)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def get(url, method="GET", follow=True):
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, method=method)
    try:
        with opener.open(req, timeout=10) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def assets_of(html: str) -> list:
    return re.findall(r"""(?:src|href)="(/app/assets/[^"]+)\"""", html)


def test_the_built_dashboard_is_served_at_the_root_and_revalidated_on_every_load(served):
    status, headers, body = get(served + "/")
    html = body.decode("utf-8")
    assert status == 200 and headers["content-type"].startswith("text/html") and headers["cache-control"] == "no-cache"
    assert '<div id="root"></div>' in html and "<title>Prism</title>" in html
    assert len(assets_of(html)) == 2  # one script and one stylesheet, both under /app/assets/


def test_every_file_the_page_loads_is_served_with_the_right_type(served):
    html = get(served + "/")[2].decode("utf-8")
    kinds = {}
    for path in assets_of(html):
        status, headers, body = get(served + path)
        assert status == 200 and body and headers["cache-control"] == "no-cache", path
        kinds[path.rsplit(".", 1)[-1]] = headers["content-type"].split(";")[0]
    assert kinds == {"js": "text/javascript", "css": "text/css"} or kinds == {"js": "application/javascript", "css": "text/css"}


@pytest.mark.parametrize("old", ["/app", "/app/"])
def test_the_old_address_of_the_dashboard_goes_to_the_root(served, old):
    """The dashboard was at /app while the page it replaced was at /: a bookmark of /app/#journal still lands on it (the browser keeps the #tab)."""
    status, headers, _ = get(served + old, follow=False)
    assert status == 307 and headers["location"] == "/"
    status, _, body = get(served + old)
    assert status == 200 and b'<div id="root"></div>' in body


def test_the_page_it_replaced_is_gone(served):
    assert not (ROOT / "app" / "static" / "index.html").exists()
    status, _, body = get(served + "/")
    assert b"Prism Market Data" not in body and b'id="decision"' not in body  # (the root is the React page: an empty #root that the script draws into)


@pytest.mark.parametrize("path", ["/app/nothing.js", "/app/assets/nothing.js", "/app/../.env", "/app/%2e%2e/.env", "/app/..%2f..%2f.env", "/app/assets/../../../../.env", "/app/%2e%2e%2fapp.log"])
def test_nothing_outside_the_built_folder_is_served(served, path):
    status, _, body = get(served + path)
    assert status == 404 or (status == 200 and b'<div id="root">' in body), path  # (an address with no file may only ever give the page itself, never a file)
    assert b"ANGEL" not in body and b"PG_PASSWORD" not in body


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE", "PATCH"])
def test_the_dashboard_files_accept_no_write(served, method):
    status, _, _ = get(served + "/app/", method=method)
    assert status in (404, 405)


def test_the_page_can_ask_a_server_for_its_snapshot_over_the_socket_that_already_exists(served):
    """The dashboard reads /ws, which serves the snapshot: one request to a real server proves the page's only data source is alive on the same port."""
    status, _, body = get(served + "/api/state")
    snap = json.loads(body)
    assert status == 200 and {"server_time", "connection", "health", "instruments"} <= set(snap)


def test_the_route_it_adds_is_a_static_mount_that_only_reads():
    md, _ = base_engine()
    app = create_app(md, feed=None)
    mounts = [r for r in app.routes if getattr(r, "path", "") == "/app" and type(r).__name__ == "Mount"]
    assert len(mounts) == 1 and isinstance(mounts[0].app, app_main.AppFiles)
    writes = {(m, r.path) for r in app.routes for m in (getattr(r, "methods", None) or set()) if m not in ("GET", "HEAD")}
    assert writes == {("POST", "/api/trades"), ("POST", "/api/trades/{trade_id}/void")}  # nothing new can write


def test_without_a_build_prism_says_so_and_still_serves_the_rest(tmp_path, monkeypatch, caplog):
    """With no build there is no dashboard at all now (the page it replaced is gone): / says what to do, as a 503 with the commands, the log says it, and the data is served all the same."""
    monkeypatch.setattr(app_main, "APP_DIST", tmp_path / "missing")
    md, _ = base_engine()
    with caplog.at_level("WARNING"):
        app = create_app(md, feed=None)
    assert not any(getattr(r, "path", "") == "/app" and type(r).__name__ == "Mount" for r in app.routes)
    assert any("not built" in r.getMessage() and "npm ci" in r.getMessage() for r in caplog.records)
    assert any(getattr(r, "path", "") == "/api/state" for r in app.routes)
    page = next(r for r in app.routes if getattr(r, "path", "") == "/").endpoint()  # (what a request for / is answered with)
    text = page.body.decode("utf-8")
    assert page.status_code == 503 and "npm ci" in text and "npm run build" in text and "/api/state" in text


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 2. The committed bundle is the bundle of the committed source
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def source_hash() -> str:
    """The same rule as frontend/scripts/stamp.mjs: index.html, package.json, package-lock.json, vite.config.ts, tsconfig.json and every file of src/ except tests (*.test.ts[x], src/test/),
    in path order, each as  path NUL content (CRLF -> LF) NUL."""
    files = [FRONT / n for n in ("index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json")]
    files += [p for p in (FRONT / "src").rglob("*") if p.is_file() and not re.search(r"\.test\.tsx?$", p.name) and not p.relative_to(FRONT).as_posix().startswith("src/test/")]
    h = hashlib.sha256()
    for p in sorted(files, key=lambda p: p.relative_to(FRONT).as_posix()):
        h.update(p.relative_to(FRONT).as_posix().encode() + b"\0" + p.read_bytes().replace(b"\r\n", b"\n") + b"\0")
    return h.hexdigest()


def test_the_committed_bundle_was_built_from_the_committed_source():
    stamp = (DIST / "source.sha256").read_text(encoding="utf-8").strip()
    assert stamp == source_hash(), "frontend/ changed since app/static/app was built: run `npm run build` in frontend/ and commit the result"


def test_the_bundle_is_whole_and_loads_nothing_from_another_site():
    html = (DIST / "index.html").read_text(encoding="utf-8")
    refs = assets_of(html)
    assert len(refs) == 2
    for ref in refs:
        assert (DIST / ref.removeprefix("/app/")).is_file(), ref
    assert not re.search(r"""(?:src|href)=["']https?://""", html)  # no script, stylesheet or font from anywhere else
    css = next((DIST / r.removeprefix("/app/")).read_text(encoding="utf-8") for r in refs if r.endswith(".css"))
    assert not re.search(r"url\(\s*[\"']?https?:|@import", css)
    assert sorted(p.name for p in DIST.iterdir()) == ["assets", "index.html", "source.sha256"]  # no source map, no stray file


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 3. A build that can be trusted
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def test_every_dependency_is_pinned_to_an_exact_version():
    pkg = json.loads((FRONT / "package.json").read_text(encoding="utf-8"))
    deps = {**pkg["dependencies"], **pkg["devDependencies"]}
    assert deps and all(re.fullmatch(r"\d+\.\d+\.\d+", v) for v in deps.values()), {k: v for k, v in deps.items() if not re.fullmatch(r"\d+\.\d+\.\d+", v)}
    assert pkg["dependencies"] == {"react": "18.3.1", "react-dom": "18.3.1", "lightweight-charts": "5.2.1"}  # the only code that ships in the page: nothing else gets into the bundle


def test_the_chart_library_is_one_package_with_one_dependency_and_neither_runs_an_install_script():
    """Stage 9.2 added `lightweight-charts` (Apache-2.0, TradingView), pinned at 5.2.1 (published 2026-08-12: not the newest release, which was two days old when it was chosen). Its only dependency is
    `fancy-canvas`. A new version that brought more code with it, or an install script, would show up here before it is built into the page."""
    lock = json.loads((FRONT / "package-lock.json").read_text(encoding="utf-8"))["packages"]
    lib, dep = lock["node_modules/lightweight-charts"], lock["node_modules/fancy-canvas"]
    assert (lib["version"], dep["version"]) == ("5.2.1", "2.1.0") and lib["dependencies"] == {"fancy-canvas": "2.1.0"} and "dependencies" not in dep
    assert not lib.get("hasInstallScript") and not dep.get("hasInstallScript")
    assert lib["license"] == "Apache-2.0" and lib["integrity"].startswith("sha512-")
    shipped = {k.removeprefix("node_modules/") for k, v in lock.items() if k and not v.get("dev")}
    assert {"react", "react-dom", "scheduler", "loose-envify", "js-tokens", "lightweight-charts", "fancy-canvas"} >= shipped, shipped  # everything that can end up in the bundle: seven packages, none of them a surprise


def test_no_package_may_run_an_install_script_and_the_lockfile_is_from_the_registry_with_hashes():
    assert "ignore-scripts=true" in (FRONT / ".npmrc").read_text(encoding="utf-8") and "save-exact=true" in (FRONT / ".npmrc").read_text(encoding="utf-8")
    lock = json.loads((FRONT / "package-lock.json").read_text(encoding="utf-8"))
    pkgs = {k: v for k, v in lock["packages"].items() if k}
    assert len(pkgs) > 50
    not_registry = [k for k, v in pkgs.items() if not str(v.get("resolved", "")).startswith("https://registry.npmjs.org/")]
    no_hash = [k for k, v in pkgs.items() if not str(v.get("integrity", "")).startswith("sha512-")]
    assert not not_registry and not no_hash, (not_registry[:3], no_hash[:3])
    assert lock["lockfileVersion"] >= 3


def test_the_installed_packages_and_the_tool_chain_are_what_the_lockfile_says_and_are_not_committed():
    lock = json.loads((FRONT / "package-lock.json").read_text(encoding="utf-8"))
    assert lock["packages"][""]["devDependencies"]["vitest"] == "4.1.12" and lock["packages"]["node_modules/react"]["version"] == "18.3.1"
    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert re.search(r"(?m)^frontend/node_modules/?\s*$", ignore)  # 200 packages that `npm ci` recreates are not part of the repository


# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
# 4. The fixture is the engine's own snapshot
# ---------------------------------------------------------------------------------------------------------------------------------------------------------------
def keys(x):
    return set(x) if isinstance(x, dict) else set()


def test_the_fixture_has_the_shape_of_what_the_engine_sends_today():
    from dashboard_harness import base_snapshot

    fixture, engine = json.loads(FIXTURE.read_text(encoding="utf-8")), json.loads(json.dumps(base_snapshot(), allow_nan=False))
    # the parts the dashboard reads, level by level (a value may be None in one and a number in the other: only the keys are compared)
    for path in (
        (), ("connection",), ("health",), ("health", "readiness"), ("health", "feed"), ("trading",), ("trading", "market"), ("trading", "market", "change"),
    ):  # fmt: skip
        a, b = fixture, engine
        for k in path:
            a, b = a[k], b[k]
        assert keys(a) == keys(b), f"the engine's {'.'.join(path) or 'snapshot'} no longer has the keys the fixture has: run `python tests/make_frontend_fixture.py` (and `npm run typecheck`)"
    for section in ("instruments", "health.instruments"):
        a, b = fixture, engine
        for k in section.split("."):
            a, b = a[k], b[k]
        assert keys(a[0]) == keys(b[0]), section


def test_the_fixture_is_a_real_market_state_not_an_invention():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert fixture["health"]["live"] is True and fixture["health"]["readiness"]["ready"] is True and fixture["connection"]["state"] == "connected"
    assert fixture["trading"]["decision"]["action"] == "BUY CE"  # the Phase 3 test world's real decision
    spot = next(i for i in fixture["instruments"] if i["role"] == "SPOT")
    assert spot["ltp"] == 24287.0 and fixture["server_time"] == 1793942706.0


def test_the_script_that_writes_the_fixture_needs_no_broker_database_or_network():
    src = (ROOT / "tests" / "make_frontend_fixture.py").read_text(encoding="utf-8")
    assert not re.search(r"requests|socket|psycopg2|SmartConnect|generateSession|urllib", src)


def test_the_chart_fixture_has_the_shape_of_what_the_engine_sends_today():
    """The chart tab's tests read `chart.json`, the engine's own answer to GET /api/chart (tests/make_frontend_fixture.py). When the endpoint's payload changes this says so."""
    from make_frontend_fixture import chart_payload

    fixture, engine = json.loads(CHART_FIXTURE.read_text(encoding="utf-8")), chart_payload()
    for path in ((), ("facts",), ("levels",), ("levels", "previous_day"), ("window",), ("decision",)):
        a, b = fixture, engine
        for k in path:
            a, b = a[k], b[k]
        assert keys(a) == keys(b), f"the engine's /api/chart {'.'.join(path) or 'answer'} no longer has the keys the fixture has: run `python tests/make_frontend_fixture.py` (and `npm run typecheck`)"
    for rows in (("candles",), ("setups",), ("ema20",), ("swings",)):
        a, b = fixture[rows[0]][0], engine[rows[0]][0]
        assert keys(a) == keys(b), rows
    assert keys(fixture["setups"][0]["targets"][0]) == keys(engine["setups"][0]["targets"][0])
    assert fixture["available"] is True and len(fixture["candles"]) == 60 and fixture["setups"][0]["focus"] is True and fixture["decision"]["action"] == "BUY CE"


def test_the_journal_fixture_has_the_shape_of_what_the_engine_sends_today():
    """The Journal tab's tests read `journal.json`, the engine's own answer to GET /api/journal (tests/make_frontend_fixture.py). When the route's payload changes this says so."""
    from make_frontend_fixture import journal_payload

    fixture, engine = json.loads(JOURNAL_FIXTURE.read_text(encoding="utf-8")), journal_payload()
    assert keys(fixture) == keys(engine), "the engine's /api/journal answer no longer has the keys the fixture has: run `python tests/make_frontend_fixture.py` (and `npm run typecheck`)"
    for part in ("decisions", "events"):
        assert keys(fixture[part][0]) == keys(engine[part][0]), part
    assert keys(fixture["status"]) == keys(engine["status"])
    assert fixture["available"] is True and len(fixture["decisions"]) == 3 and len(fixture["events"]) == 3 and fixture["status"]["directory"] == "logs"
    assert "Users" not in json.dumps(fixture) and "Temp" not in json.dumps(fixture)  # (no folder of this PC is kept in the fixture)


TRADES_FIXTURE = FRONT / "src" / "test" / "fixtures" / "trades.json"
RISK_FIXTURE = FRONT / "src" / "test" / "fixtures" / "risk.json"


def test_the_trades_and_risk_fixtures_have_the_shape_of_what_the_engine_sends_today():
    """The Trades tab's tests read `trades.json` and `risk.json`, the answers of GET /api/trades (from a real trade log) and GET /api/risk (tests/make_frontend_fixture.py). When either payload changes this says so."""
    from make_frontend_fixture import risk_payload, trades_payload

    fixture, engine = json.loads(TRADES_FIXTURE.read_text(encoding="utf-8")), trades_payload()
    assert keys(fixture) == keys(engine), "the engine's /api/trades answer no longer has the keys the fixture has: run `python tests/make_frontend_fixture.py trades` (and `npm run typecheck`)"
    for part in ("limits",):
        assert keys(fixture[part]) == keys(engine[part]), part
    assert keys(fixture["trades"][0]) == keys(engine["trades"][0]) and keys(fixture["trades"][0]["prism"]) == keys(engine["trades"][0]["prism"]) and keys(fixture["open"][0]) == keys(engine["open"][0])
    assert fixture["available"] is True and len(fixture["trades"]) == 3 and fixture["realised"] == 1950.0 and fixture["daily_loss_reached"] is False
    assert [t["followed"] for t in fixture["trades"]] == ["yes: the setup you named", "no", None]
    assert "Users" not in json.dumps(fixture) and "Temp" not in json.dumps(fixture)  # (no folder of this PC is kept in the fixture)

    fixture, engine = json.loads(RISK_FIXTURE.read_text(encoding="utf-8")), risk_payload()
    assert keys(fixture) == keys(engine), "the engine's /api/risk answer no longer has the keys the fixture has: run `python tests/make_frontend_fixture.py trades` (and `npm run typecheck`)"
    assert fixture["lots"] == 1 and fixture["binding"] == "lots_by_trade_limit" and fixture["warnings"] == []


def test_the_page_makes_exactly_the_requests_the_server_has_routes_for():
    """The React page asks for /api/chart, /api/journal, /api/trades (a read and a write), /api/trades/<id>/void and /api/risk; every one of them is a route of the real application, with the method the page uses."""
    md, _ = base_engine()
    app = create_app(md, feed=None)
    routes = {(m, r.path) for r in app.routes for m in (getattr(r, "methods", None) or set()) if m != "HEAD"}
    for want in (("GET", "/api/chart"), ("GET", "/api/journal"), ("GET", "/api/trades"), ("POST", "/api/trades"), ("POST", "/api/trades/{trade_id}/void"), ("GET", "/api/risk")):
        assert want in routes, want
    source = (FRONT / "src" / "tradesApi.ts").read_text(encoding="utf-8")
    assert '"/api/trades"' in source and "/api/trades/${encodeURIComponent(id)}/void" in source and "/api/risk?${query}" in source
