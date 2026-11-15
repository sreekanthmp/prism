"""What the tests that drive a REAL browser share (they are the dashboard's own tests: headless Chrome or Edge is started on the machine and driven over its DevTools websocket, pointed at the real application
served on a free local port: the real FastAPI app and the real WebSocket push, over a mocked market with no broker and no database).

    BROWSER   the browser that was found (None when there is none: every browser test module then SKIPS, and says why)
    Page      one tab of it, over the DevTools protocol: js(), until(), pause(), size(), shot(), and the console errors it collected
    served    a fixture: the real application on a free port (the dashboard is at its root)
    browser, page   fixtures: the browser, and a tab of it
    goto, keep, free_port   helpers

It needs a browser and the `websockets` package. If either is missing the browser tests are SKIPPED, with the reason (see the pytest report). Set PRISM_SHOTS=<directory> to also keep a screenshot of each
measured state."""

import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

import pytest

pytest.importorskip("websockets", reason="the `websockets` package is not installed: the dashboard was not run in a real browser")
from dashboard_harness import base_engine  # noqa: E402
from websockets.sync.client import connect  # noqa: E402

from app.main import create_app  # noqa: E402

# How the page SAYS the engine's two BUY values. The values (BUY CE / BUY PE) are unchanged in the engine, the journal and the tools; the words on the screen are the dashboard's own
# (frontend/src/labels.ts): a tab that is asked what the page says uses these, so there is one definition on each side.
WORD = {"BUY CE": "CE SETUP", "BUY PE": "PE SETUP"}


def plain(text):
    """A sentence of the engine as the page says it: "BUY CE: Trend Pullback setup confirmed" is "CE setup ready: Trend Pullback setup confirmed"."""
    return re.sub(r"\bBUY (CE|PE)\b", r"\1 setup ready", text)


CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]  # fmt: skip


def find_browser():
    for name in ("chrome", "google-chrome", "chromium", "msedge"):
        if shutil.which(name):
            return shutil.which(name)
    return next((p for p in CANDIDATES if os.path.exists(p)), None)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


BROWSER = find_browser()
SIZES = [(1366, 768), (1920, 1080)]  # the two screens the dashboard is made for (the second one is scaled up by the page's large-screen zoom)


class Page:
    """One tab of the browser, over the DevTools protocol."""

    def __init__(self, ws_url):
        self._ctx = connect(ws_url, max_size=None)  # (entered by hand: the library wants a context manager, and a fixture owns the page's life)
        self.ws, self.n, self.errors = self._ctx.__enter__(), 0, []
        for method in ("Page.enable", "Runtime.enable", "Log.enable"):
            self.call(method)

    def call(self, method, **params):
        self.n += 1
        mid = self.n
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv(timeout=30))
            self.note(msg)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def note(self, msg):
        m, p = msg.get("method"), msg.get("params", {})
        if m == "Runtime.exceptionThrown":
            self.errors.append("exception: " + (p["exceptionDetails"].get("exception", {}).get("description") or p["exceptionDetails"]["text"]))
        elif m == "Runtime.consoleAPICalled" and p.get("type") == "error":
            self.errors.append("console.error: " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", [])))
        elif m == "Log.entryAdded" and p["entry"]["level"] == "error" and "favicon" not in p["entry"].get("url", "") and "favicon" not in p["entry"]["text"]:
            self.errors.append("log: " + p["entry"]["text"])

    def js(self, expression):
        r = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"])
        return r["result"].get("value")

    def size(self, width, height):
        self.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)

    def until(self, expression, timeout=20.0):
        end = time.time() + timeout
        while time.time() < end:
            if self.js(expression):
                return True
            time.sleep(0.15)
        raise AssertionError(f"timed out waiting for: {expression}")

    def pause(self, seconds):  # (events keep arriving while the test waits)
        end = time.time() + seconds
        while time.time() < end:
            try:
                self.note(json.loads(self.ws.recv(timeout=0.2)))
            except TimeoutError:
                pass

    def shot(self, path):
        import base64

        Path(path).write_bytes(base64.b64decode(self.call("Page.captureScreenshot", format="png")["data"]))


@pytest.fixture(scope="module")
def served():
    import uvicorn

    md, clock = base_engine()
    app = create_app(md, feed=None)
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    end = time.time() + 15
    while not server.started and time.time() < end:
        time.sleep(0.05)
    assert server.started, "the application did not start"
    yield {"url": f"http://127.0.0.1:{port}/", "md": md, "clock": clock, "app": app}
    server.should_exit = True
    thread.join(timeout=10)


@pytest.fixture(scope="module")
def browser(tmp_path_factory):
    profile, port = tmp_path_factory.mktemp("profile"), free_port()
    proc = subprocess.Popen([BROWSER, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
                             "--disable-extensions", "--hide-scrollbars=false", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip
    try:
        end, targets = time.time() + 20, None
        while time.time() < end:
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2))
                if any(t["type"] == "page" for t in targets):
                    break
            except OSError:
                time.sleep(0.2)
        assert targets and any(t["type"] == "page" for t in targets), "the browser did not start"
        yield next(t for t in targets if t["type"] == "page")["webSocketDebuggerUrl"]
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture
def page(browser):
    p = Page(browser)
    yield p
    p._ctx.__exit__(None, None, None)


def goto(page, url):
    """A real load of the page, whatever the tab was showing before: going through a blank page means a change of #hash alone is never mistaken for a navigation."""
    page.call("Page.navigate", url="about:blank")
    page.pause(0.3)
    page.call("Page.navigate", url=url)


def keep(page, tmp_path, name):
    out = os.environ.get("PRISM_SHOTS")
    if out:
        Path(out).mkdir(parents=True, exist_ok=True)
        page.shot(Path(out) / f"{name}.png")


# The page is drawn once its header has left "CONNECTING" and it is not stale: the first snapshot has come and been drawn.
LIVE = "document.getElementById('c-market') !== null && document.getElementById('c-market').textContent !== 'CONNECTING' && document.querySelector('.stalebar') === null"


def open_dashboard(page, url, tab="overview", width=None, height=None, timeout=30):
    """The dashboard (at the root of the server) on that tab, drawn from a first snapshot."""
    if width:
        page.size(width, height)
    goto(page, url + "#" + tab)
    page.until(LIVE, timeout=timeout)


def run_server(app, port):
    """An application served on that port in a thread (a test that stops it, to see the page lose its link, owns it: `server.should_exit = True`, then `thread.join()`)."""
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    end = time.time() + 15
    while not server.started and time.time() < end:
        time.sleep(0.05)
    assert server.started, "the application did not start"
    return server, thread


def frozen(md):
    """The engine's snapshot, taken once and held: from now on every push and every read says exactly that (an engine's readiness and clock move on as it runs, and a test wants the page and itself to read the same one)."""
    snap = json.loads(json.dumps(md.snapshot(), allow_nan=False))  # the first snapshot of an engine computes its whole analysis: done here, not while a page waits
    md.snapshot = lambda: snap
    return snap
