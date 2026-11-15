# Prism — NIFTY live market data and analysis

Single Python app: Angel One login → instrument master → WebSocket V2 → validated ticks → 1m/5m/15m/1h
candles (in memory) → FastAPI + a local dashboard. Prism is a **decision-support tool for manual NIFTY trading**: it analyses the
live market and says what it sees and why, and it never places, modifies or cancels an order. Every trade decision is yours.

Phase 2 adds market analysis (indicators, structure, support/resistance, market condition) from Prism DB history
plus the live candles. Prism DB is only ever read.

Phase 3 adds a trading **decision engine** on top of that analysis: strategies (three original ones, and the ones added since: see the
sections below), a setup lifecycle and an overall decision (BUY CE / BUY PE / WAIT / NO TRADE) with the reasons. It judges the NIFTY
*underlying* only.

Phase 4 adds an **options analysis** layer beside it: it watches a window of real NIFTY option contracts around the money, checks each
contract's own quote (freshness, bid / ask, spread, volume, open interest, strike distance, expiry) and, only when Phase 3 says BUY CE /
BUY PE, names a contract of that side that the data does not rule out. It does not size positions and never places an order.

## Run

Set `ANGEL_API_KEY`, `ANGEL_CLIENT_ID`, `ANGEL_PASSWORD` (PIN), `ANGEL_TOTP` (base32 secret) in the
environment, or in a git-ignored `.env` file (see `.env.example`). For the analysis also set `PG_PASSWORD`
(`PG_HOST`, `PG_PORT`, `PG_USER`, `PG_DBNAME` default to localhost / 5432 / postgres / prism). Without it the
live pipeline still runs and the dashboard says why the analysis is unavailable.

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Python 3.11 or later (developed and tested on 3.12; the packages in `requirements.txt` are pinned to the versions the test suite was verified with, and it names `websockets`, the library uvicorn needs to
serve the dashboard's live updates: without it the page never goes live, and the start-up log says so). Dashboard: http://127.0.0.1:8000/ · snapshot: `/api/state` · analysis: `/api/analysis` · decision: `/api/trading` · readiness: `/api/readiness` ·
closed candles: `/api/candles/{token}/{1m|5m|15m|1h}` · the React dashboard's chart data: `/api/chart?timeframe=5m` · today's decision journal (read-only): `/api/journal` · push: `/ws`

**Served to this computer only, Stage 7.2.** Prism's API has no login: anyone who can reach it sees the decisions, the state of the feed and the journal. Start it with `--host 127.0.0.1`, as above. A launch from the
uvicorn command line whose `--host` is not this computer (`0.0.0.0`, `::`, a LAN address or any other name; `localhost`, `127.x.x.x` and `::1` are this computer) is refused before anything is started, and
not even the one-copy lock is taken; the message says why and what to do. `PRISM_ALLOW_REMOTE=1` (also `true`, `yes`, `on`) is the owner's yes, for sharing it on a network they trust, and the log then says so. The host is read
from the uvicorn command line, or from `UVICORN_HOST` when the command line is silent (uvicorn does the same, and the command line wins), so a launch that is not uvicorn's (a script, a test) is not checked. Nothing else about start-up changes: the port, the one-copy lock and the port-in-use check are as before.

**The dashboard** is one page with four tabs; the data is the same snapshot pushed over a single WebSocket, so switching tabs never reconnects
the feed or resets anything:

| Tab | What is on it |
|---|---|
| **Overview** (default) | The first screen, built to fit one desktop viewport without scrolling: NIFTY price, market / feed / data status, the decision (`BUY CE`, `BUY PE`, `WAIT`, `NO TRADE`) with its one-line reason, the 1H / 15M / 5M / 1M direction (only 1H and 15M decide the allowed side), market context, the current setup, the strategy monitor, data health and the latest three events. "Explain this decision" opens the detailed explanation over the page. |
| **Options** | The Phase 4 selected contract (quote, spread, volume and open interest in units, receipt / exchange-time / last-trade ages, freshness, findings), the alternatives and the nearby-strike comparison. |
| **Analysis** | Expandable sections: indicators per timeframe, market structure, levels, candles, strategy diagnostics, setup lifecycle, confirmation and invalidation, data health detail, instruments, gaps and errors. |
| **Journal** | Today's decision history with the reasons for and against, the setup lifecycle, expired and invalidated setups and the full strategy events. Prism records no trades, so there is no trade log. |

The Journal tab reads `/api/journal` when it is opened and when the decision or an event changes (no polling). The endpoint only reads the
journal file that the engine already writes.

**What the page prints, Stage 7.2.** Every string the backend sends that the page draws into the document, in text or inside an attribute (a setup's stage, the side of a strategy, a status, dates, ATM / ITM / OTM, a
contract's expiry ...), is escaped, not only the free text. All of those values are made by Prism itself, so none was reachable from outside; escaping them keeps the page safe for as long as every producer stays that way.
`tests/test_page_escaping.py` adds markup to every string of nine different states and of a real journal answer, runs the page's own script under node on every tab (and the lost-link page), and fails if any of it reaches an
element as markup or if the page logs an error.

**When the page loses its link (Stage 5.1).** The page is *loading* until the first snapshot, *live* while snapshots keep arriving (the server pushes at least one a second), and *stale* when
the WebSocket closes or goes silent for 5 s. A stale page keeps the last snapshot for inspection but never presents it as current: the decision is dimmed and says **"STALE since HH:MM —
NOT ACTIONABLE"**, the market / feed / data / system chips read **UNKNOWN**, no "eligible" or "actionable now" wording and no frozen tick age is shown, and the hidden tabs are cleared. The
next valid snapshot restores the live page, drawn from that snapshot alone.

**Options tab, Stage 5.2 (presentation only: contract selection and the suitability thresholds are Phase 4's and are unchanged).** A BUY's contract card shows the contract, its side, strike and expiry,
the strategy that made the decision (name and ID), the setup ID, the strategies that agree, LTP, bid and ask, spread, volume, open interest, **two quote ages (received, and the exchange's own
time)**, every finding (a Warn in full; the Avoid findings of the contracts that were ruled out are listed beneath), and the alternatives with their own price, book, liquidity, ages and warnings.
WAIT and NO TRADE say **"No contract selected"** and nothing in the tab is then selected or actionable. A contract is shown as selected **only** when the final decision (the trading payload's)
is the BUY it was selected for, the options payload carries the same decision, and its selection is of that side: an options payload that says otherwise, alone, shows nothing as selected.
Unknown values are shown as unknown, never as zero, and a stale page marks the contract as "the last selected contract: not current, not actionable".

**REST and WebSocket, Stage 5.3 (a check, plus one additive field set).** There is one snapshot, `MarketData.snapshot()`: `GET /api/state`, the first WebSocket message and every push are that
snapshot, and `/api/trading`, `/api/options`, `/api/analysis`, `/api/health` and `/api/readiness` return exactly their section of it. So the final decision, the originating strategy and setup
ID, the agreeing strategies, the strategy states, the regime facts, the counter-trend permission and the options selection are the same whichever way they are read, and inside a snapshot the
`options.decision` is the trading decision it was chosen for (a contract is selected only for the matching BUY). `tests/test_rest_websocket_consistency.py` proves it on the wire (the real
ASGI app, a GET of each route and a WebSocket client, standard JSON only) for every state it builds. Two differences are by design: the ticker runs the watchdog before each push, so a candle
that is due to close may close between a client connecting and the next push; and the WebSocket escapes non-ASCII text where REST does not (both parse to the same data). Where something is
unavailable every route says `available: false` and why, in the place that route has always used: `warnings` (analysis), `decision.reasons` and `data.issues` (trading), `reason` (options and
journal). `/api/journal` decision rows now also carry `strategy`, `setup_id` and `also` (older records show null and an empty list), so a journal row can be tied to the setup events and
to the live decision; the journal file itself is unchanged and the route only reads it. Since Stage 6.1 a read of `/api/trading`, `/api/state`, `/api/options` or the WebSocket never evaluates the decision (see "Reading the decision never writes" under the decision journal).

**Dashboard quality, Stage 5.4 (measured in a real browser).** At 1366x768 and 1920x1080, in every state the tests build (BUY CE, BUY PE, WAIT, NO TRADE, market closed, feed down, a stale
spot, an option window with no quotes or no suitable contract, and the counter-trend reversal's decisions), on every tab: there is no horizontal scrollbar, the Overview needs no vertical one,
there is no console error, no text is smaller than 10 px (as the eye gets it, zoom included), every cell that is cut off with an ellipsis can be read in full on hover (the header's summary line
now can too), each strategy is shown once, and the text colours are at least 4.5 : 1 on every background they are used on. WAIT (amber), NO TRADE (neutral grey), BUY CE (green) and BUY PE (red)
differ in word, lettering, frame and fill. The four tabs open by click, by the left and right arrow keys and by address (`#options`; an unknown address opens the Overview). A lost link marks
**every** tab stale (a banner, a dimmed page, UNKNOWN chips, "last selected contract" on Options). A cold start says what it is waiting for and shows `–` or "no data", never a zero, for
anything not measured. When a BUY has no suitable contract the Options tab lists the contracts ruled out once, nearest the money first. **Narrower than the two required sizes** the page does not
overflow sideways (checked down to 900 px), but the Overview then scrolls vertically (about 15-45 px more than a 1280x720 screen holds; stacked under 900 px wide). The Journal tab lists every decision
change with its reasons, so a long day is a long page. `tests/test_dashboard_stage54_browser.py` needs Chrome, Chromium or Edge and the `websockets` package, and is skipped (with the reason) without them;
`tests/test_dashboard_stage54.py` runs the page's script under node.

**Overview, Stage 5.1.** The header shows the price and its move from the previous close (worked out by the backend as `market.change`; the page only formats it, and says "change unknown"
when the previous close is missing or stale) and the NIFTY tick's **receipt age and exchange-time age** side by side (`health.instruments[].exchange_age / exchange_status`, named like the
option rows' fields; they are information only and change no verdict). The decision names the strategy, its ID, the setup ID and the strategies that agree. All six regime facts are shown;
**unknown** is drawn as unknown (with its reason), never as "none". The strategy monitor lists each live setup with its side, state, first blocker and a link to its Analysis detail, and says
conflicts once. Alerts are one line with the count; the full list opens on a click and floats over the page. The Analysis tab leads with the regime facts, the counter-trend permission and all
ten strategies, each expandable and each side (CE and PE) on its own (`strategies[].sides` in the trading payload), with the indicator tables after them.

## Start-up, readiness and recovery

**Start Prism once, before 09:15 IST, and leave it running.** A restart costs a start-up and some recovery; it is never needed to "fix" a
loading message.

- **One copy at a time.** Before anything else, Prism takes an operating-system lock (`logs/prism.lock`, released by the system when the
  process ends, however it ends) and checks that the port is free. A second launch stops at once with a message naming the running process,
  and a port held by another program (a Django server, say) is explained too. Nothing is written to the journal and no login is attempted by
  a copy that is refused. Background tasks (history refresh, validation) are started at most once.
- **Readiness.** The dashboard header says `SYSTEM READY` (or `READY FOR OPEN` before 09:15) or `NOT READY: <state>`, with a banner that
  says why. The states are `INITIALIZING`, `HISTORICAL_LOADING`, `RECOVERING_GAPS`, `READY`, `DEGRADED` and `FAILED`. Analysis, Data health detail
  lists the start-up stages (configuration, clock, Angel One login, contracts, Prism DB history, today's candles, candle continuity, live
  feed), the refresh attempts, the next retry and the candles still missing. `GET /api/readiness` and `/api/health` (`readiness`, `diagnostics`)
  carry the same.
- **READY means the decision's own data checks have nothing to object to:** today's history refreshed *and validated* (no 5M or 15M candle
  missing inside the window Phase 3 needs complete), the feed connected, a fresh NIFTY price, a trusted clock. Anything else is NOT READY and the
  decision stays `NO TRADE` with its reason. Readiness only reads; it changes no rule, threshold or decision, and a slow load never turns into a BUY.
- **Missing candles are fetched, not hidden.** After a restart the candle that was half-built, any candle the history never returned, and any hole inside
  today's session are requested from Angel One (only those, one request per timeframe), merged by start time (history wins, partial live candles never
  used) and checked again. A request that Angel One *refused* or could not answer does not use up the candle's few tries; a candle it answers *without* is
  tried three times and then reported as unavailable. Nothing is ever invented to fill a gap. Sweeps run every 15 s while candles are missing and every
  minute otherwise, all through the one shared limiter (spaced requests, growing cool-down after a refusal).
- **A new trading day on a connection that stays up (Stage 7.3).** The contracts are chosen when a connection is made, and Angel One does not always close one at midnight, so a Prism left
  running used to keep an expired expiry's options for ever. The once-a-second watchdog now notices that the IST date has moved past the day the contracts were chosen and makes the feed
  reconnect; the reconnect chooses the new day's contracts (the existing path, with a fresh instrument master) and subscribes them from scratch. It is on record (`rollover` in the feed
  events and a log line), asked again only after a minute if the old connection did not close, and a failed selection is retried by the feed's own back-off while the old contracts stay on
  record until the new ones are chosen. A feed that is down chooses afresh on its own reconnect. The instrument master of the new day is downloaded at that moment and cached for the day, so a master that
  Angel One only refreshes in the morning is not read again until the next midnight (the contract set rarely changes overnight). Verified with fake sockets and a fake clock only.
- **Candle times are exact (fix of 2026-11-12).** A restart in the session (13:13) stayed NOT READY with "5M 12 missing, 15M 8 missing" while the log said the history held every one of those candles. The cause was in `day_start()`:
  it computed midnight as the time minus the seconds into the day, which with a real clock's fraction of a second is about 2e-7 s off in three moments out of four, so a candle that started at exactly 12:10:00 never equalled
  its slot 12:10:00. A complete history was then "missing" every slot (only the decision window was reported), the start-up validation passed one try in four whatever the data held, and each retry fetched the whole day
  again, which fed Angel One's rate limit. Midnight is now computed in whole seconds (IST has no daylight saving). It changes nothing for a whole-second clock, which is why no earlier test saw it: `tests/test_exact_day_start.py`
  runs a restart at 13:13 with fractions of a second that broke the old formula (90 of its 120 tests fail on the old code). Verified with fakes; the live Prism needs a restart to get it.
- **Failures are told apart.** A rejected login is not retried in a burst (15 minutes) and ends in `FAILED` with the reason; a network failure or a rate
  limit is temporary and retried soon; a database failure keeps the old history, marked stale.
- **Logs** (`logs/app.log`): `startup 1/4 .. 4/4`, `history refresh started`, `history ready ... candles validated`, `history not complete (<kind>) ...
  trying again in N s`, `recovery sweep: asking for ...`, `recovery: N candle(s) still missing`, and `readiness: A -> B: why`, once per change.
- **Not verified against the real broker:** all of this was exercised with mocked Angel One responses and real processes of a stand-in app; see
  `logs/operational-reliability-audit.md` for what needs a live trading session.

## Test

```bash
python -m pytest
```

The default run uses fakes only (Phase 1, 2 and 3). `pandas` is optional: with it installed the indicator tests also cross-check
against an independent pandas implementation (without it they are skipped, and say so).

Opt-in checks against the real services (read-only, no market hours needed) live in `tests/test_real_services.py`:

```bash
PRISM_INTEGRATION=1 PG_PASSWORD=...  python -m pytest tests/test_real_services.py   # Prism DB
ANGEL_INTEGRATION=1                  python -m pytest tests/test_real_services.py   # Angel One (needs the ANGEL_* variables)
```

## Phase 1: how the live feed behaves

- Contracts are derived from the instrument master and the current spot price: the spot, and a window of strikes around ATM
  (calls and puts, 3 strikes each side by default) for the first 2 expiries (see Phase 4). The master is parsed once a day; the window then
  follows the spot (re-centred in memory, no new lookup).
- One supervisor thread owns the WebSocket (never two). On a drop it reconnects with a bounded back-off (1, 2, 4, 8, 16, 30,
  then every 60 s) and resubscribes. A **network** failure (no network, DNS, a timeout, a gateway answer, the API's rate limit)
  is never counted as a rejected login: it is retried for as long as it lasts and the session is kept. Only credentials that Angel
  One *rejected* stop the feed, after 5 tries, with the state `auth_failed` and the reason (restart Prism after fixing them). Every
  disconnect, its reason and the attempt number are recorded (`/api/health`, the dashboard's Data health panel and the journal).
  An expired session (401/403/token) is re-authenticated. After 60 s without a live connection during the session the feed is
  *unhealthy*: no decision is made from the data until it is back.
- **Each instrument is judged by its own ticks.** The NIFTY spot's age (last receipt and exchange time) decides the price age, the
  "no recent price" wait, the gap detection and the reconnect watchdog (no spot tick for 45 s during the session). Option ticks
  never make a silent spot look fresh. Each option quote has its own age and is flagged when old (shown only: no decision uses
  option prices yet). A rejected tick (duplicate, out of order) does not refresh any age.
- **The PC clock is checked** (`app/health.py`): a stall of more than 10 s between two one-second checks (the PC slept, or the
  application was suspended), the wall clock moving against the monotonic timer or backwards, or the spot's exchange time
  repeatedly far from the local time. Then the data is *not trusted*: the candles that may span the unseen period are flagged
  `partial` (the analysis ignores them), the period is recorded as a gap so the spot candles are re-fetched from the official
  history, every setup is held back, the decision is `NO TRADE` with the reason, and the feed reconnects. Trust returns only after
  60 s of normal time **and** a spot tick that arrived after the event. Nothing is created for the period that was not seen.
- A *gap* is 15s without a **spot** tick during market hours (or a disconnect). Candles overlapping a gap are flagged
  `partial`; once they close, they are re-fetched from Angel One's candle API (`source: "history"`). Only the **NIFTY spot**
  is recovered: the analysis and the decision read the spot's candles and nothing consumes the option candles, so asking for them
  only spent the request allowance the history refresh needs. The recovery stands aside while the history refresh runs, asks
  for a damaged candle at most 3 times, and stops its sweep as soon as the API refuses a request for its rate. Every
  `getCandleData` request (refresh, recovery, validation) goes through one shared limiter: spaced 0.4 s apart, and after a
  refusal ("exceeding access rate") everything waits 5, 15, 30 then 60 s. Candles are never invented for periods with no data.
  What each candle request answered is in the log (`app.history` and `app.gaps`, INFO): `backfill 5m 2026-11-11 09:15..2026-11-11 11:20: answered on try 1 with
  75 candle(s) (11-11 09:15..11-11 11:20), 75 inside the session, 12 new kept`. An answer with no candles is a WARNING (from the outside it looks like success), a
  request that was refused is the `failed (rate_limit)` warning as before, and a refresh that fails validation adds `history holds for today: 1m ..., 5m ..., 15m ...`
  so the hole can be placed. This is logging only: nothing is fetched, kept or decided differently (Stage 7.2b).
- Candle volume for options is the change in the feed's running day volume; the index has no volume (`null`).
- Ticks outside 09:15–15:30 IST update the latest price but create no candles. Weekend special sessions are ignored.

## Phase 2: analysis

### Data

- **Prism DB** (`ohlcv`, symbol `NIFTY`) is read through a read-only session (`default_transaction_read_only=on` plus
  the session flag), SELECT only, with a date bound and a row cap per query: 1m 5 days, 5m 14 days, 15m 70 days,
  daily 45 days. Credentials come from the environment. Nothing is ever written to it.
- **What Prism DB lacks** (for example the days since the last daily update) is fetched from Angel One's candle API
  into memory only, starting at the very next interval after what is already held. Fetched candles are carried over
  across refreshes, so they are not downloaded again.
- **Refresh:** the history is loaded at startup and again when a new trading session starts (first poll at or after
  09:15 IST on a weekday whose session it has not been refreshed for). The loop only reads the clock; the database is
  queried once per refresh. A refresh that fails for a *temporary* reason (Angel One refused the candle requests for their rate,
  could not be reached, or a window came back incomplete) is retried after 20, 40, 80 and 160 s and then every 5 minutes, up to 28
  attempts a day; a database failure is retried every 5 minutes. If it cannot be refreshed the old history stays in use but the
  dashboard and API say so (`history.stale`, a warning, and `previous_day.stale`); previous-day levels are never presented as
  current in that case. See "Start-up, readiness and recovery" below.
- **Completed candles only:** history and live candles are merged by start time (one candle per start, history wins a
  tie, partial live candles are never used). The forming candle is shown separately and never enters an indicator.
- **1H candles** are built from the merged 15M series (09:15, 10:15 … 15:15; the last one is 15 minutes long) and only
  when all four 15M constituents exist. A missing 15M candle is therefore a missing 1H candle, never a wrong one.
  Verified against Angel One's own `ONE_HOUR` candles.

### Missing candles

For each timeframe the analysis reports which intervals of the trading session (09:15–15:30 IST) have no candle
(`timeframes.<tf>.missing`: expected, missing, the latest gaps). Trading days are inferred from the data: a day without
any candle (weekend, market holiday) is never examined and nothing outside the session is ever expected, so the
overnight break is not a gap. A candle is only expected 10 seconds after its interval ended. The start of the window
(the first candle held) is not a gap.

- Nothing is filled in. Indicators run over the candles that exist; smoothing treats the next candle as following the
  previous one (as charting software does), and the missing intervals are reported next to the result.
- Swing points, breakouts and consolidation are never inferred across a hole.
- A **warning** (dashboard banner, `warnings`, `reliable: false`) is raised for gaps in the *latest session* of a
  timeframe. Gaps in earlier sessions that are still in the warm-up window are counted in `missing` but do not warn.
  Observed on the real data: Prism DB and Angel One have 361 of 375 one-minute candles every session (15:15–15:28 is
  absent) and 73–74 of 75 five-minute candles; 15M and daily are complete.

### Indicators and levels

EMA 20/50 (seeded with the simple average of the first n values; pandas' `ewm(adjust=False)` seeds with the first
value and converges to the same numbers once warm), RSI 14, ATR 14 (two forms, see "ATR and the overnight gap"), ADX 14 with +DI/−DI (Wilder smoothing), previous
day high/low/close (the last daily candle before today; flagged if the latest intraday session has no daily candle),
session open, and — **VWAP only when every candle has traded volume**. NIFTY is an index with no volume, so `vwap` is
`null`, and the plain average of typical prices is reported separately as `session_avg_price`; the dashboard says
"VWAP not available" next to it. Indicators need 150 completed candles (3 × the slowest period) before a timeframe's
trend is classified.

### Structure and condition

- Swings are confirmed pivots (2 candles each side), reported only once the later candles have completed. Higher
  highs / higher lows, lower highs / lower lows, breakouts and breakdowns (a fresh close beyond the latest swing),
  and consolidation (last 12 candles within 3 × ATR) are derived from them.
- Support and resistance: swing prices from the 1H and 15M charts merged into levels (0.5 × the intraday ATR apart); a level needs
  two touches or to come from the 1H chart; at most the three nearest on each side of the live price.
- **Trend** (bullish / bearish / sideways): each timeframe votes with EMA alignment, ±DI and swing structure, and needs
  ADX ≥ 20. Direction comes from the 1H and must not be contradicted by the 15M. The 1H/15M `alignment` is spelled out
  (aligned, conflicting with a pullback-or-reversal note, pausing, developing, range-bound). 5M and 1M are shown and
  related to the direction. **Volatility** (high / normal / low) is the 15M intraday ATR against its recent average
  (≥ 1.3 / ≤ 0.7) and is independent of the trend. RSI appears as context (above 70 / below 30), not as a vote.
- Every classification comes with its reasons on the dashboard. All thresholds are initial assumptions, defined at
  the top of `app/analysis.py`, and have not been optimised against any data.

### ATR and the overnight gap

`atr14` is the textbook Wilder ATR: the true range of a candle is measured against the *previous candle's close*, so
the first candle of a session carries the whole overnight gap, and Wilder smoothing keeps it for hours. For the size
of a *candle* that is wrong, and `atr14_intraday` measures the first candle of each session by its own range instead
(a hole inside a session is not a gap and still counts). Measured on the real NIFTY history (694 sessions, Jan 2024 –
Nov 2026, 5M and 15M candles built from the stored 1M candles; 123 sessions opened 0.5% or more away from the
previous close, the largest +1,228 / −1,154 points):

| 5M ATR, plain ÷ intraday, sessions with a ≥ 0.5% gap | 09:30 | 10:00 | 11:00 | 12:00 | 14:00 |
|---|---|---|---|---|---|
| median | 1.34 | 1.20 | 1.09 | 1.04 | 1.01 |
| 90th percentile | 1.65 | 1.41 | 1.19 | 1.09 | 1.02 |
| worst session | 2.01 | 1.67 | 1.32 | 1.17 | 1.04 |

The 15M ATR never fully recovers within a session (median 1.24 at 09:30, 1.12 at 12:00, still 1.07 at 14:00). Against
the realised mean true range of the following hour (gap excluded), the mean absolute log error on those sessions is
0.21 (intraday) versus 0.35 (plain) for 5M at 09:30, 0.27 versus 0.44 at 10:00, 0.30 versus 0.38 at 11:00 (15M:
0.25/0.28, 0.27/0.38, 0.34/0.46). On sessions with a gap under 0.25% the two are practically the same (median ratio 1.00). Counted by what they do
to the volatility flag at 10:00 on the ≥ 0.5% gap sessions: "high" 41.5% of sessions with the plain ATR against 22.0%
without the gap, and "unusually high" (NO TRADE) 6.5% against 1.6%.

Trade-offs, honestly: the plain ATR is the right measure of *gap exposure* (an overnight position, Phase 4 sizing); the
intraday ATR is the right measure of *how far a candle moves*, which is what every threshold here is expressed in. The
intraday form can lag when the first hour after a gap is far more violent than the previous session (the 10th
percentile of ATR ÷ realised range is 0.73 at 09:30 against 0.98 for the plain ATR; no entry is allowed before 09:30,
and it is 0.93 at 10:00). Both forms overstate the following hour by 20–30% around 10:00–12:00 on every kind of day,
because the morning is more volatile than the lunch hours; that is seasonality, not the gap.

| Used for | ATR |
|---|---|
| Entry area, invalidation buffer, risk bounds, confirmation-candle size, level tolerance, pullback depth, breakout margin and body, range width (Phase 3); consolidation, breakout buffer and level clustering (Phase 2); the volatility label | `atr14_intraday` (and `atr_ratio_intraday`) |
| Display, and any measure of overnight exposure | `atr14`, `atr_ratio` (unchanged) |
| The size of the gap itself | its own line: "opened +465 pts (+2.0%) from the previous close" |

### Not included

No trading signals, option selection, position sizing, stop-loss or target, ML, backtesting or order placement.

## Phase 3: trading setups and the decision

Phase 3 reads the Phase 2 analysis (trends, ADX/ATR/EMAs, swings, levels, condition, missing-candle information)
and the completed candles; it does not recompute indicators or structure. `app/strategy.py` holds the rules (pure
functions), `app/trading.py` the lifecycle, session logic and decision. Every threshold is a field of `Params`
(`app/strategy.py`) and can be overridden with an environment variable `STRATEGY_<NAME>`, for example
`STRATEGY_LAST_ENTRY=14:30` or `STRATEGY_MIN_ROOM_RISK=0.8`. They are initial assumptions, not tuned values.

**One rule set, both directions.** Each strategy is written once for the bullish case and run on a price-negated
view for the bearish case, so CE and PE rules are symmetrical. Entry/trigger/invalidation prices are derived from
price structure (a base high, a structural low, a broken level) and ATR multiples, never fixed percentages.

### Which strategy may run (market condition -> strategy)

| Phase 2 condition | Trend Pullback | Breakout and Retest | Range Reversal |
|---|---|---|---|
| 1H bullish, 15M bullish or sideways (1H ADX >= 20, 15M structure not LH/LL) | CE side | CE side | off |
| 1H bearish, 15M bearish or sideways | PE side | PE side | off |
| 1H and 15M both sideways (range-bound), ADX < 25, no Phase 2 breakout flag | off | both sides | both sides |
| 1H sideways, 15M directional (developing) | off | that direction only | off |
| 1H and 15M conflict, or not enough data | off | off | off |

Unusually volatile (15M ATR >= 2x its average) = no trade; merely high volatility, and the midday window, apply
stricter confirmation. Strategies that are off say why on the dashboard (Strategy monitor).

**The strategy registry (`app/registry.py`).** Every strategy is registered once, with an id, a title, its scanner, a family (`with_trend`, `range`, `session`,
`reversal`), a tie-break priority and the data it needs. The scanners run from it, the lifecycle and the decision rank from it, the strategy monitor lists
it and a journal is restored against it, so a strategy that is registered is scanned *and* ranked: it cannot be one without the other. Strategies beyond the
three below live in `app/strategies/` and register themselves; all of them are built through `strategy.build`, which is where the data, session, volatility,
risk-distance and room checks are applied, so none can skip them (a test loops over every registered scanner to prove it). A strategy can also read the live
setups of the others (`View.live`). The facts the later strategies
read (the opening range, EMA slopes and how long the EMA stack has held, the 5M ATR ratio) are in `strategy.Context`; the three original strategies do not read them. Strategies register when `app.strategy` is imported; an empty registry is an error, not a silent NO TRADE (Stage 7.2): asking it for the scanners, or creating an engine
with none registered, raises `no strategy is registered: import app.strategy ...`.

### The three strategies

- **Trend Pullback.** With the 1H trend, the latest leg's high is found, then a pullback of at least 0.5x ATR15 that
  comes down to a value zone (15M or 5M EMA20/EMA50, the band between them, a Phase 2 level, previous-day or
  opening-range extreme) without a close below the leg's origin. It is confirmed by a *completed* 5M bullish candle
  that closes above the highest high of the base since the pullback low (body >= 0.4x ATR5, closing in its upper 40%),
  with evidence that buyers stepped in (a rejection candle at the low, or a candle of body >= 0.7x ATR5 itself).
- **Breakout and Retest.** A 15M candle closes beyond the first meaningful level above the previous close (Phase 2
  swing levels, previous-day high/low, 15M range, opening range) by at least 0.15x ATR15, with body >= 0.5x ATR15,
  closing in its strong 40% and no smaller than the recent candles; otherwise it is rejected as weak. The breakout
  alone is only *detected* (unconfirmed). It needs a retest of the level that holds (no 5M close more than 0.25x ATR15
  back through it), then a completed 5M candle closing above the retest high. A close back through the level is a
  false breakout (invalidated); price running more than 1x ATR15 past the breakout candle without a retest is
  *missed* (expired); no retest within 24 candles expires too.
- **Range Reversal.** Only in a range-bound market, at the edge of a range whose boundaries are Phase 2 levels at
  least 1.5x and at most 6x ATR15 apart. Price must have come back to the edge (a low within 0.25x ATR15 of it) and
  show a rejection candle there or a failed breakdown (a 5M close beyond the edge that is reclaimed), then the same
  completed-5M confirmation. The location is judged where price touched the edge, not where it is after the bounce
  (in a narrow range the confirming candle closes well away from the edge; the room gate checks what is left). With
  no recent visit to the edge, the middle of the range never qualifies; a 15M close beyond the edge, or a push 1x
  ATR15 beyond it, is a genuine break (invalidated).

### The trend-continuation strategies

All three are registered and active, run through the same lifecycle, the same confirmation, location and data gates (`strategy.build`) and the same decision as
the three above, and are written in `app/strategies/trend_family.py`. Their thresholds are initial assumptions like every other (`Params`, `STRATEGY_MC_*`,
`STRATEGY_ETC_*`, `STRATEGY_VE_*`); none was tuned on data.

- **How one dip is kept to one strategy.** Measured from the leg's high down to the lowest low since, in ATR15: deeper than 0.5 (and at a value zone) is Trend
  Pullback's; shallower and touching the 5M EMA20 zone is EMA Trend Continuation's; shallower and staying above that zone is Momentum Continuation's. The three
  cannot all describe the same dip (a test sweeps the whole grid), and the two continuation strategies carry one `group` per leg, so the setup book keeps only one
  live setup of a group whichever of them saw it first. A pause that deepens past the line ends, and says that it moved to Trend Pullback.
- **Momentum Continuation.** A strong trend (1H and 15M both with the side, 15M ADX of at least 25, the 15M and 5M EMA20 moving with it, 15M structure not
  against it) whose leg is at least 1x ATR15 and that has paused for at least two completed 5M candles under its high without reaching the 5M EMA20 zone. Confirmed
  by a strong completed 5M candle (body of at least 0.7x ATR5, closing near its extreme) that closes through the prior high; the trigger is the higher of the pause
  high and the prior high, because a trigger under the prior high would sit under resistance the room rule counts. Invalidation is the pause low less a quarter of
  ATR5.
- **EMA Trend Continuation.** The same trend with the 15M EMA20 above the EMA50 (below it, for puts) for at least 8 candles and the 5M EMA20 rising, and a dip
  shallower than a Trend Pullback whose low reached the 5M EMA20 zone and stayed above the EMA50. Confirmed through the prior high by a rejection candle at the low
  or a strong candle; same trigger and invalidation rules.
- **Volatility Expansion.** Twelve completed 5M candles inside a box of at most 3.5x ATR5, then a wide completed 5M candle (range of at least 1.5x ATR5, body of at
  least 0.7x ATR5, closing near its extreme) that closes out of the box in a direction 1H and 15M do not oppose. The trigger is the box edge and the invalidation the
  middle of the box, which keeps the risk inside the usual limits; the usual "do not chase" limit applies, so an expansion candle that has already closed more than 1x
  ATR5 beyond the edge is not an entry. In stricter confirmation (high volatility, the midday window) the next completed candle must also hold the break. It overlaps
  Breakout and Retest where a 15M range edge is the box edge: the decision then lists the second one as "also matches".
- **Limits worth knowing.** A setup is announced from the candle after the pause begins, so a move whose first evaluation is the confirming candle itself is not
  caught. The Overview lists only the strategies that hold a setup and folds the rest into one line.

### The opening range and failed breakout strategies

Both are registered and active, run through the same lifecycle, the same confirmation, location and data gates (`strategy.build`) and the same decision as the
others, and are written in `app/strategies/opening_range.py` and `app/strategies/failed_breakout.py`. Their four thresholds (`orb_end`, `orb_probe_atr5`,
`fbtr_window_bars`, `fbtr_max_bars`; `STRATEGY_ORB_*`, `STRATEGY_FBTR_*`) are initial assumptions like every other; everything else they use is an existing one.

- **Opening Range Breakout.** The 09:15-09:30 range is observed, not traded. After it, a completed 5M candle closing out of it (body of at least 0.4x ATR5, closing in
  the top 40% of its range, a rising candle for calls and a falling one for puts) is the breakout; the trigger is the range edge, and in stricter confirmation (high
  volatility) the next completed candle must also close beyond it. The initial invalidation is the **middle of the range** less a quarter of ATR5. A new setup whose
  trigger-to-invalidation distance breaks the existing risk limits (under 0.75x ATR5, or over 1.5x ATR15) is not started: the notes say why. A candle that completes
  after 11:00 cannot confirm it, and one still unconfirmed then ends. Before the confirmation a close beyond the *opposite* edge ends it (the range broke the other way
  first); wandering to the middle does not, because nothing has been entered. After the confirmation a close through the invalidation, or back more than a quarter of
  ATR5 under the trigger, ends it, and a candle that closes more than 1x ATR5 beyond the edge is "missed", not an entry. It needs 1H and 15M not against the side,
  like Breakout and Retest. There is at most one opening range breakout per side per day.
- **Failed Breakout (Trap Reversal).** A completed 5M candle closes beyond a level the engine already knows (a swing level, the previous day's high or low, a 15M range
  edge, an opening range edge) by at least 0.15x ATR15, and a later candle closes back through it within 6 candles; the push beyond the level never exceeds 1x ATR15
  (further is a genuine break, the line Range Reversal draws). The trigger is the highest high of the base since the low and never below the reclaimed level; the
  confirming candle and the stricter mode are the usual ones, and the invalidation is the low of the failed break less a quarter of ATR5. A level only counts as broken
  if today's trading has been on the other side of it first, and only today's candles are used. **There is no counter-trend exception:** the side must be one that 1H and
  15M already allow, so a failed breakdown is only a call where the higher timeframes are not bearish (and a failed breakout only a put where they are not bullish).
- **How one movement is kept to one strategy.** Failed Breakout stands aside in a range-bound market (Range Reversal's own definition: 1H and 15M both sideways,
  alignment range-bound), where the failed breaks of a range's edges are Range Reversal's, so the two never describe the same candles (a test sweeps the regimes). Where
  Opening Range Breakout and Breakout and Retest both involve the opening range edge they are different entries into one move (the immediate break, then the retest);
  where two of any strategies are ready at once at the same place the decision lists the second as "also matches". The ordering for a tie stays the registry's: the three
  originals first.
- **Limits worth knowing.** There is no volume in the spot index, so neither strategy can use volume as evidence. An opening range breakout that is first seen after it
  has already been confirmed is announced as CONFIRMED (not DETECTED first), and one first seen past its entry window is not announced at all.

### Range Bounce

Registered and active like the rest, in `app/strategies/range_bounce.py`; it adds **no thresholds** (it reuses Range Reversal's approach, minimum box height and push
depth, and Failed Breakout's break margin). A bounce off the edge of the 15M compression box (the last 12 completed 15M candles inside 3x ATR15) while the 1H trend is
pausing (alignment `pausing`: 1H trending, 15M sideways), in the trend's direction only: the box low in an uptrend (calls), the box high in a downtrend (puts). Price must
have come within 1x ATR15 of the edge recently with a low no more than 0.25x ATR15 above it; it may pierce the edge with a wick, never by more than 1x ATR15 (further is a
genuine break), and no completed 5M candle may close beyond the edge by 0.15x ATR15. Confirmation, trigger, invalidation (the low of the bounce) and the stricter mode are the
usual ones, and the first level the room rule counts is the far edge of the box. A tracked bounce keeps the edge it was found at even if the box has since moved.

- **Correction to the audit that proposed it.** The audit said this case "does not exist today". It mostly does: Trend Pullback allows a sideways 15M, counts the box low as a
  level and takes a pullback to it (a test scenario shows it WAITING at the hammer and CONFIRMED at the next candle). Trend Pullback is not changed, so Range Bounce **defers
  to it**: it starts nothing while Trend Pullback holds the dip (any setup of its own except one that failed), and ends a tracked bounce if Trend Pullback takes the same low
  (a strategy can read the live setups of the others through `View.live`, which `scan_all` sets). What is left is what Trend Pullback cannot see.
- **Who announces a dip to the box low** (box low 24,560, ATR15 25, a dip candle that closes 8 above its low; pinned by a test): in a box the last 15M swing low is usually
  *higher* than the box low, so a dip to the box low closes under Trend Pullback's leg origin and it calls the structure broken while the box holds.

  | the dip's low | leg origin above the box low | leg origin far below it |
  |---|---|---|
  | 14 above the edge | nobody (not at the edge) | nobody |
  | 6 above | Trend Pullback | Trend Pullback |
  | 2 above .. 4 under | **Range Bounce** | Trend Pullback |
  | a wick 8 under, no close beyond | **Range Bounce** | **Range Bounce** |
  | a candle closes beyond the edge, then retakes it | Failed Breakout | Failed Breakout |

- **Regimes.** Range Reversal needs 1H and 15M both sideways, Range Bounce a trending 1H and a sideways 15M, so they never overlap (swept in a test).
- **Limits worth knowing.** Range Bounce is narrow by construction and will fire rarely: where a leg exists and the dip is at the edge, Trend Pullback has it. Volatility
  Expansion can describe the same candle when a 5M compression forms at the box low; if both are ready the decision lists the second as "also matches".

### Market regime facts (Stage 3)

`app/regime.py` says what kind of market this is, with the evidence, **beside** the existing classification. It never changes a trend, the alignment, the Phase 2 condition or the
decision's market regime (a test pins that), and it adds nothing to what the nine earlier strategies read. It is also not a signal: only Trend Exhaustion Reversal reads it, and only as one of
the requirements of its permission (below).

Six facts. Each is a list of **named checks** with the numbers behind them, and a state that follows from them by a stated rule. A check is true, false, or *unknown*. There is no score, no
weight and no composite confidence anywhere.

| fact | states | rule (thresholds are `rg_*` fields of `Params`: initial assumptions, not tuned) |
|---|---|---|
| strong trend | bullish / bearish / none | **all** of: 1H and 15M agree; 15M ADX >= 25 and not down by 2 or more over 5 candles; 15M EMA20 on the trend side of the EMA50 for 8+ candles and sloping with it; 15M structure with the trend; 75% of the last 12 closes on the trend side of the EMA20 |
| weakening trend | bullish / bearish / none | the established trend's direction, when at least 2 of 6 checks hold: ADX falling; directional bodies fading (last 6 vs the 6 before, <= 0.5x); no new extreme; stretching from the EMA20 while ADX is flat or falling; the candle of the latest extreme gave back half its range as a wick; 15M structure no longer confirming the trend |
| compression | yes / no | at least 3 of 4: 15M ATR <= 0.8x its average; ranges narrowing (<= 0.75x); a 15M consolidation box; ADX under 20 or falling |
| volatility expansion | up / down / none | ATR >= 1.3x its average, **and** a strong directional candle (body >= 1x ATR15, closing in its outer 30%), **and** a close beyond a compression box that ended at most 4 candles ago (follow-through is reported, not required) |
| extended market | bullish / bearish / none | at least 2x ATR15 from the EMA20 **and** 3x from the EMA50, and either 5+ consecutive closes one way or no retracement over 1x ATR15 in the last 12 closes |
| range / pause / pullback / breakout | one of the four, or none | told apart in this order: a breakout (a Phase 2 flag or an expansion); a genuine range (1H and 15M both sideways, ADX < 25); a trend pause (1H trending, 15M sideways); a pullback inside the 1H trend |

**Missing or stale data is never a market condition.** A check whose input is missing, whose candles have a hole, or whose indicator is not warm is *unknown*; a fact that an unknown check
could still decide is `unknown`, never "none". When the data cannot be trusted (`data.ok` false, or not enough completed 1H / 15M candles) every fact is `unknown`, `available` is false and `why`
says why. They are computed once per completed candle from the Phase 2 analysis and the completed 15M candles, and are in `market.regime_facts` of the trading payload (REST `/api/trading`
and `/api/state`, the WebSocket snapshot) and of every journal record. The dashboard shows the active ones in one line on the Overview and every check in the Analysis tab.

### Trend Exhaustion Reversal and the counter-trend permission (Stage 3)

The tenth strategy (`app/strategies/exhaustion.py`, family `reversal`, tie-break priority 16): a possible reversal after an established trend loses structural control. A bullish exhaustion
gives a **BUY PE** setup, a bearish one a **BUY CE** setup, written once for the bullish trade and run on the negated view like every other strategy. It is the **only** strategy that may
trade against the 1H or 15M direction, and never on RSI alone: an overbought or oversold RSI, an extended price, or a falling ADX is not part of any rule that grants anything on its own.

**The permission** (the exception to the direction gate) is granted only when all three hold, and it is recorded whether it is granted or denied, with every check and the structure behind it:

1. *an established trend or extension to reverse*: the 1H trend is the exhausted one, **or** the regime fact says the market is extended that way, **or** the 15M EMAs have been stacked that way for 8+
   candles after a leg of at least 2x ATR15;
2. *weakening continuation*: the regime fact `weakening_trend` names that trend;
3. *a confirmed 15M structural change*, from confirmed swings only (it needs three swing highs and three swing lows): lower highs and lower lows, then a higher low and a higher high, confirmed at
   most 12 15M candles ago, with the exhaustion low (the lowest low of the exhausted leg) still intact. The two structure checks say what they **need and what they found**, in real prices with the way each step moved
   (`down structure before: needs a lower high and a lower low; found 15M highs 24,760.00 → 24,650.00 (lower) and lows 24,600.00 → 24,520.00 (lower)`), so a denial such as `denied: up structure before (needs a higher low and a
   higher high; found 15M lows 25,162.70 → 25,095.35 (lower) and highs 25,424.35 → 25,397.80 (lower))` reads as the failure it is. (Until 2026-11-12 the text was the requirement with the real numbers, which read as a fact; wording only, nothing about when a
   permission is granted changed. Journal records written before keep the old wording.)

**The setup**, after the permission: `DETECTED` (permission granted, no confirmed 5M swing high yet), `WAITING_FOR_CONFIRMATION` (the latest confirmed 5M swing high formed after the 15M higher low is
the trigger), `CONFIRMED` (a completed 5M candle with the usual body and close location closes through the trigger, and completed after the 15M change was confirmed; in stricter mode the next
candle must also close beyond it), then `READY_TO_ACT` / `BLOCKED` through `strategy.build` like every strategy. *Entry zone*: the trigger up to 1x ATR5 beyond it. *Invalidation*: the 5M pullback low
before the break less the usual buffer; a 5M close under the 15M higher low or the exhaustion low ends it at any stage. *Expiry*: the usual entry window and do-not-chase limit, and no 5M confirmation
within 24 candles of the 15M change (in the afternoon the 14:45 no-new-entries rule normally fires first). *Duplicates*: the setup key is anchored to the exhaustion low, so one structural break
produces one setup and an ended one is never revived. A tracked setup keeps the permission it was detected with (it is stored on the setup and in the journal): later changes of the facts neither
revoke nor invent it. Completed candles only.

*Both directions, in real words.* For a **put** (a bullish exhaustion) the same rules read: the 1H is bullish and its weakening is named; the 15M went from higher highs and higher lows to a **lower
high and a lower low**; the trigger is the latest confirmed 5M swing **low**; a completed 5M candle must close **below** it; the entry zone is below the trigger and the invalidation (the 5M pullback
**high** plus the buffer) above it; a close above the 15M lower high, or above the exhaustion high, ends it; the targets are the swing lows below. The evidence, the messages and the target labels are
written in those real terms for each side (`tests/test_exhaustion_directions.py` holds both directions on hand-worked candles in real prices, not a reflection of one another).

*The stored permission is a record, not a licence.* It lets one setup past the direction gate and nothing else, and it is only trusted if it is granted, for the right direction, complete and the right
way round (otherwise the permission is decided afresh from the facts of now; the decision engine also refuses a record made for the other direction). Every other requirement is decided from the data of
now on every look: untrusted data blocks the setup and the decision; a trend that cannot be judged ends it for good (it does not come back when the data does); a confirmed setup's entry window is also
kept by the clock from its confirming candle, so a restart or a hole in the data cannot stretch it; a missing 5M candle between the 15M swing and now blocks a confirmation until the data is whole.
Only the registered counter-trend strategy carries, restores or shows a permission (`tests/test_exhaustion_permission_lifecycle.py`).

**How the decision uses it.** `trading.decide` applies one rule to every strategy: a setup that opposes the 1H or 15M trend is eligible only if its strategy is registered counter-trend **and** its
setup holds a granted permission. Every other opposing setup is ignored and the decision says so ("ignored X (CE): it runs against the 1H trend and holds no counter-trend permission"). A
`conflicting` market (1H and 15M disagree) stays NO TRADE unless such a permitted setup exists; an `unclear` market never has an exception. Everything else is unchanged: data, session, extreme
volatility, risk distance, room, confirmation, CE/PE disagreement (WAIT) and the priority tie-break, with "also matches" for strategies that agree. `register()` refuses to mark any strategy outside
the reversal family counter-trend, and a strategy that claims a permission without being registered for it gets nothing from it (both are tested).

**How the nine earlier strategies stay protected.** The modules of the six later ones (`trend_family`, `opening_range`, `failed_breakout`, `range_bounce`) are byte-for-byte what they were (a test
hashes them); the three originals' scanners in `strategy.py` are unchanged too (the file only gained additive fields: the regime facts, the permission record on a setup). `tests/golden/stage2_strategies.json` was recorded from the code as
it stood *before* Stage 3: every scanner result and every decision of the nine on every fixture used by their own tests, in both orientations, step by step through the real setup book; the tests
recompute all of it with Stage 3 in place and require it to be identical, beside the golden recording of the three originals. The permission can only matter to a setup that opposes the 1H or 15M
trend, which the earlier scanners never produce.

**Where it shows.** `trading.counter_trend` (REST, WebSocket, journal) lists every permission decision, granted or denied, with its checks and the structure in real prices; each setup carries the
record it was permitted by. The Overview has one line (the active regime facts and, only when a side was opposed, the permission); the Analysis tab has *Market regime facts* with every check,
*Counter-trend permission* with the structure, and the setup card shows the permission. The Journal tab and `/api/journal` carry the permission and the active facts per decision; older records
without these keys read as before.

**Limits.** The permission relies on confirmed swings, which lag the 15M higher high by about 30-45 minutes, so an early reversal is seen late. The trigger is the latest confirmed 5M swing high, so it
can move down while lower highs form before the break. The `rg_*` and `ter_*` thresholds are initial assumptions and have not been calibrated on data; nothing here measures an edge. Regime facts become
unavailable while data issues exist, so no *new* reversal is detected then (a setup already tracked continues from its stored record). Verified with mocked and hand-built candles only, never in a
live session.

### Confirmation, location and data gates

Confirmation is always a completed 5M candle; the forming candle and the live price never confirm anything. A candle
that completed inside the opening range (before 09:30) cannot confirm either: the opening range is observed, not
traded, so the break must be a candle completed after it. In high
volatility or the midday window the break candle also needs a follow-through: the next completed candle must also
close beyond the trigger. A setup that would otherwise confirm stays *waiting* (with the reasons) while any gate is
closed: the invalidation is under 0.75x ATR5 or over 1.5x ATR15 from the trigger, the next level is closer than 1x
the risk, today's 5M/15M candles are missing inside the last hour/two hours (Phase 2 missing intervals), the history
is stale, a timeframe is not warmed up, volatility is extreme, or the session does not allow entries.

### Lifecycle

The lifecycle states are `DETECTED` (at the zone/level, no evidence yet), `WAITING_FOR_CONFIRMATION` (evidence, trigger defined),
`CONFIRMED`, `INVALIDATED` (the premise failed: structure broken, false breakout, close below the invalidation level,
failed follow-through, or the market stopped suiting the strategy) and `EXPIRED` (the opportunity passed: price more
than 1x ATR5 beyond the trigger, four completed candles after the confirmation, no confirmation in time, late
session, session end). A setup only moves forward and is announced once (see `events`); the first confirmation that
ever happened fixes its trigger and invalidation, and a tracked setup keeps the facts it was judged on (the level
that broke, the edge of the range, the low it rests on), so a confirmed entry does not disappear because the EMAs or
levels moved afterwards. Everything else is re-derived from the candles each time. A restart picks the day up from the
decision journal (below): setups that had ended stay ended, live ones keep their original detection and confirmation
times, are marked `resumed` and are not announced again. A new swing high, breakout candle or approach to the edge is
a new setup.

**Stage (what to call it right now).** The lifecycle states above are unchanged. Each setup also carries a derived `stage` that says
precisely what holds it: `DETECTED`, `WAITING_FOR_CONFIRMATION` (a completed 5M candle still has to close beyond the trigger),
`BLOCKED` (the confirming candle *has* completed, but something else holds entry: not enough room to the next level, a data or
session gate, a stale price; internally the state stays `WAITING_FOR_CONFIRMATION`, `candle_confirmed` is true), `CONFIRMED`
(confirmed, price not in the entry area), `READY_TO_ACT` (confirmed, in the entry area, nothing blocking), `INVALIDATED`, `EXPIRED`
and `MISSED` (it was confirmed and price ran away before an entry). There is no separate `DEVELOPING`: a setup still forming is
`DETECTED` or `WAITING_FOR_CONFIRMATION`.

**Targets (underlying index points, not option premium).** Target 1 is the nearest detected level beyond the trigger (the very
level the room rule measures), target 2 the next distinct level, only if one exists; no level means no target is named. Each shows
its distance from the trigger and the reward/risk in index points (risk = trigger to invalidation). For a pullback the origin of the
pullback (its prior high) is named as such: it counts as a level for the room rule, exactly as before. How an option moves with the
index (delta, time decay, spread) is a separate question that this does not answer.

**Explanation.** Every decision carries `explain`: what happened, what is happening now, what has to happen next, what ends the
setup, what blocks entry, and which timeframes agree, disagree or are neutral. Only the 1H and 15M decide whether a side is allowed;
5M and 1M are shown as information. `BUY CE` / `BUY PE` mean "the rules say this setup is confirmed and its entry area is live", not
a recommendation or a guarantee.

### Decision and session

`BUY CE` / `BUY PE`: a confirmed setup whose price is currently inside its entry area (trigger to trigger + 1x ATR5)
and nothing blocks it. `WAIT`: the market is tradable but nothing is actionable (developing setup, confirmed but price
extended or back through the trigger, opening range forming, or setups pointing in opposite directions, which are
explained rather than resolved). `NO TRADE`: market closed, unreliable data, extreme volatility, conflicting or unclear
timeframes (a conflicting market is still NO TRADE unless a Trend Exhaustion Reversal setup holds a granted counter-trend permission), or no strategy suits the market. Two strategies on the same opportunity give one decision that lists the
other (`also`). Session (IST, all configurable): no entries before 09:30 (opening range forms), stricter confirmation
12:00-13:30, no new entries from 14:45, closed from 15:30.

## Phase 4: options analysis

**Which contracts are watched.** `app/instruments.py` parses the NIFTY option rows of the instrument master once a day into a chain
(expiry -> strike -> call and put), dropping expired contracts (an expiry that is today stays until the close, flagged as expiry day).
`OPTIONS_STRIKES_EACH_SIDE` strikes either side of ATM, by **position in the real strike list** (no strike interval is assumed), are watched
for the first `OPTIONS_EXPIRIES` expiries that have a strike on both sides of the money (no expiry date is assumed either). The strikes
follow the spot: once the spot is more than `OPTIONS_RECENTRE_HYSTERESIS` (0.75) of a step from the centre strike, in the direction it moved
(the step is the real gap to the next strike), the window is re-centred from the chain in memory and the feed subscribes the new contracts and
unsubscribes the old ones on the live connection. Only the option contracts change: the spot's ticks and candles are untouched. A stale spot
or an untrusted clock never moves the window; if the subscription change fails the connection is reset and the reconnect subscribes the whole
current window. The first expiry keeps the roles Phases 1-3 use (`ATM_CE`, `ATM_PE`, `ITM_CE`, `ITM_PE`).

**Live option data.** The spot stays in the quote mode; the options use Angel One's snap-quote mode (3), which adds what the quote mode does
not carry. Captured per contract, when provided: last price, best bid and ask with their quantities, day volume, open interest, previous
close, and the last trade time; the receipt time gives each contract its own quote age. A field the broker does not send (or that fails
validation: a non-positive price, an empty level, a negative open interest, a last-trade time in the future) is `None` and shown as "-":
nothing is filled in. The best bid is the highest bid level and the best ask the lowest ask level, whatever the order of the levels. A change
of the book alone (a new bid with the same last price) is a new quote, not a duplicate. **The SDK labels the two depth lists with swapped
names internally; Prism takes its final labels (buy = bids, sell = asks) and refuses any book whose bid is above its ask (`crossed_book`),
so a reversed list can never be used silently.** Volume, open interest and every quantity are in **units**, not lots (observed on the real feed on 2026-11-06: each is a whole multiple of the lot size, 65 in the real master, and equals the broker's own quote API; the day volume is the day's running total).

**Three clocks per option quote: a message that has just arrived is not necessarily fresh data.** A snapshot sent the moment a contract is
subscribed, or the first message after a reconnect, arrives *now* but can describe a book that last changed hours ago. Prism therefore keeps
three separate times for every contract and never lets one stand in for another:

| Clock | Where it comes from | Used for |
|---|---|---|
| **Receipt age** | the PC's clock when the last accepted message arrived | the existing `OPTIONS_QUOTE_STALE_SECONDS` (30 s) check; unchanged |
| **Exchange-time age** | Angel One's `exchange_timestamp` (milliseconds; the broker's quote API calls the same time `exchFeedTime`), compared with the PC clock | the new `OPTIONS_EXCHANGE_STALE_SECONDS` check |
| **Last-trade age** | Angel One's `last_traded_timestamp` (seconds; `exchTradeTime` in the quote API) | **shown only**: a last trade says nothing about the order book, so an old last trade never makes a quote stale and a recent one never makes it fresh |

A quote is **stale** if its receipt age *or* its exchange-time age is over its limit, and **unknown** if the exchange time is missing, not a
number, zero or negative, or more than 5 s in the future of the PC clock (the PC clock is behind, or the timestamp is wrong). An option message
with such a time is still kept (its price and book are shown), but the exchange time stays unknown: **it is never replaced by the receipt time**,
which would be exactly the mistake this guards against. Both a stale and an unknown exchange time are *avoid* flags (`exchange_time_stale`,
`exchange_time_unknown`, with the reason in words): the contract cannot be selected, and the dashboard says why. A message whose exchange time
is older than one already accepted is dropped as out of order, so newer data is never overwritten by older. The NIFTY spot is unchanged (its
missing or bad exchange time is still a rejected message, and its age is judged as before). `OPTIONS_EXCHANGE_STALE_SECONDS` (default 30,
equal to the receipt limit) is, like every `OPTIONS_*` limit, an **operational placeholder**, not a measured value: it is deliberately not
tighter than the receipt limit, so a quiet strike is not judged harder than before, and it closes the case the receipt age cannot see.
Outside the session the ages are still shown but the *market closed* flag is the reason.

**What the exchange time is and is not.** It is the exchange's own time for the quote record, a different clock from the last trade (observed
on the real feed after the close on 2026-11-06: the feed time 15:40:01 and the last-trade time 15:39:59, each equal to the broker's own quote API).
Angel One does not document it as a "quote-update time", and **it has not been verified that it advances on a book-only update (a new bid or
ask without a trade) during a live session**. If it does not, a contract with no trades would age out and be avoided even though its book is
live: that failure is on the safe side, but it must be checked on a trading day (see the live validation status below).

**What is checked for each contract** (`app/options.py`; every finding is a flag, *avoid* or *warn*):

| Area | avoid (the contract is never selected) | warn |
|---|---|---|
| Freshness | no quote, a quote received more than `OPTIONS_QUOTE_STALE_SECONDS` (30) ago, an exchange time more than `OPTIONS_EXCHANGE_STALE_SECONDS` (30) old or unknown (see the three clocks above), the market closed, the NIFTY spot stale | |
| Spread | no bid or no ask, a crossed book, spread wider than `OPTIONS_MAX_SPREAD_PCT` (3% of the mid) | wider than `OPTIONS_WARN_SPREAD_PCT` (1%) |
| Premium | a price below the intrinsic value by more than `OPTIONS_INTRINSIC_TOLERANCE` (1 point) | a premium out of order with its neighbours (a call cheaper than the call one strike higher, a put dearer than the put one strike lower) |
| Liquidity | no volume, open interest or quote quantity at all; day volume under `OPTIONS_MIN_VOLUME` (100,000) | volume or open interest missing; open interest under `OPTIONS_MIN_OPEN_INTEREST` (100,000); the best bid or ask under `OPTIONS_MIN_TOP_QUANTITY_LOTS` (1) lot; volume under `OPTIONS_MIN_RELATIVE_VOLUME` (10%) of the busiest contract of the same side and expiry |
| Strike | | more than `OPTIONS_FAR_FROM_ATM_STEPS` (2) strikes from ATM |
| Expiry | | expires today (expiry day: fastest time decay); `OPTIONS_DECAY_WARNING_DAYS` (1) days or fewer to expiry |

Each row also shows ATM / ITM / OTM against the live spot, the strike distance in points and in strikes, the expiry and the days to it, the
spread in rupees and as a percentage of the mid, the change from the previous close, and the quote's three ages (receipt, exchange time, last
trade) with one freshness status. **All of these limits are initial
assumptions about what is wide or thin**: they are placeholders, configurable through the `OPTIONS_*` environment variables (a value of 0
switches a minimum off), meant to be tuned to what you see on your own screen. None of them was derived from data.

**The selection.** Only when Phase 3's decision is `BUY CE` or `BUY PE`: among the contracts of that side with no *avoid* flag, in the
watched expiries, the order is fewest warnings, then the tightest spread, then the nearest the money. It is a documented convention, not a
score, and says nothing about profit. A contract expiring today therefore does not win just because its expiry is the nearest: its expiry
warning counts. The first few alternatives are listed. If every contract of that side has a blocking problem, the dashboard says no suitable
contract is available and why for each. For `WAIT` / `NO TRADE` (and before any decision) there is **no selection at all**; the comparison table
is still shown (both sides, or the one side of the BUY) for information. A bullish setup does not mean "buy a call": the contract has to
pass its own checks first.

`GET /api/options` (also `options` in `/api/state` and over `/ws`) returns the table, the expiries, the window, the thresholds and the
selection. The decision journal records the selected contract (its quote, flags and why) with a BUY decision. Nothing in Phase 4 sends
anything to the broker except market-data subscriptions: there is no order call anywhere in the application, and a test checks that.

**From the ten strategies to a contract (Stage 4 verification).** One path serves every strategy: the strategies feed the decision engine, `trading.decide` makes the *final* decision, and
`MarketData.options_view` hands the decision's **action** (and nothing else) to `options.select`. So `BUY CE` chooses among calls and `BUY PE` among puts whichever of the ten strategies made it;
there is no per-strategy options code, and `options.py` does not know a strategy exists. The decision is carried beside the selection as it is (`options.decision`: `action`, `headline`,
`strategy`, `strategy_name`, `setup_id`, and `also`, the strategies whose setups describe the same opportunity), so the Options tab says which strategy and which setup the decision came from and
which others agree. Only one selection is ever made: the strategy `trading.decide` picked by its unchanged tie-break order, never one per agreeing strategy. Everything that stops a BUY stops
the contract with it (untrusted data, a stale price tick, unusual volatility, a closed or late session, a conflict between a call and a put, an invalidated or expired setup, a counter-trend
setup without its permission), because those make the decision `WAIT` or `NO TRADE`, and a `WAIT` / `NO TRADE` selects nothing: the Options tab then says "No contract selected" and that the table
is for information only (a `WAIT` that is about a setup names it as a "setup in view", never as the source of a contract). `tests/test_options_integration.py` runs all ten strategies, both
sides, through this path against a live mocked option window, with every Avoid and Warn finding and the pinned default thresholds. Setups of the same direction whose entry areas do not
overlap are not listed as "also matches" (that is the decision engine's long-standing rule); they remain in the setups list.

**Live validation status** (`logs/phase4-live-validation.md` has the evidence). Checked on 2026-11-06 **after the close** against the real Angel One
feed and its read-only quote API: the snap-quote subscription is accepted for 28 option tokens; every decoded field (price, previous close,
volume, open interest, best bid / ask and their quantities, feed time, last-trade time) equals the broker's own quote for all 28 contracts; the
SDK's `best_5_buy_data` are the bids and `best_5_sell_data` the asks; subscribe / unsubscribe / forced reconnect / a failed subscribe all behave as
designed. **Not yet seen, because it needs a trading session:** streaming updates (book-only versus trade updates, cumulative volume over time),
a crossed book, the quote ages of inactive strikes, the re-centring trigger and hysteresis in motion, the spread and liquidity distributions
against which the placeholder thresholds should be judged, and the dashboard while the market is moving. `python logs/phase4-live-observe.py
<minutes>` records all of these during a live session without placing any order. The exchange-time freshness check (the three clocks) was
exercised with mocked messages and a replay of the real captured message only; whether `exchange_timestamp` advances on book-only updates, and
how old it is on a quiet strike, is likewise for a trading session to show.

### Reliability, validation and where each limit lives

- `GET /api/health` (also `health` in `/api/state` and over `/ws`): whether the data is trustworthy right now: each instrument's
  status and age, the feed state and the recent disconnect events, the clock check, the candle recovery and rate-limit state, and
  the last official-candle check. The dashboard shows an old spot price as **STALE**, never as live.
- **Official-candle check** (`app/validation.py`): about 15:40 on a trading day, the completed NIFTY 1M, 5M and 15M candles built
  from ticks are compared, open/high/low/close separately, with Angel One's official candles of the day, and the result is written to
  `logs/candle-validation-<date>.json` and shown on the dashboard. A candle is `match`, `sampling` (it differs but every live price
  lies inside the official candle's range: what sampled ticks cause), `material` (a live price outside the official range), or missing
  on one side; partial candles and candles that came from the official history are listed as unverified. How large a sampling
  difference may be is **not decided**: no tolerance is invented, the daily reports are for calibrating one. Nothing is ever
  overwritten, and the official candles come from the same Angel One API Prism already uses, so this checks the tick-building and the
  candle timing, not Angel One itself.
- **Trend extension** (`extension` per timeframe, and a line in the market analysis): the last close's distance from the EMA20 and
  EMA50 in ATRs, the number of consecutive same-direction closes, how the ADX moved over 5 candles, and a break against the trend.
  They are facts: no rule, veto or warning level uses them, because no threshold for "extended" has been calibrated. A proposal for
  one would need these numbers from many sessions first (the journal records them).
- Where each limit lives: the strategy's thresholds are `Params` (`strategy.py`, overridable with `STRATEGY_*`), the analysis
  constants are at the top of `analysis.py`, the session the candles are anchored to is `candles.py` (09:15 / 15:30, which `Params`
  must match: a test guards it), and the staleness and clock limits are: spot price age `Params.max_price_age` (20 s), option quote age
  30 s (`engine.py`, shown only), gap 15 s and spot watchdog 45 s (`Config`), a stall of 10 s, a clock jump of 5 s and 60 s of calm
  (`health.py`), unhealthy connection after 60 s (`engine.py`). The RSI caution is `Params.rsi_caution` (70, equal to the analysis
  text's `RSI_STRETCHED`).

### Reviewing decisions: the decision journal

Every evaluation (once a second, whether or not a dashboard is open) goes through `app/journal.py`. One JSON line is
appended to `logs/decisions-<date>.jsonl` when the decision, a setup, the session phase or the data state changes,
when a lifecycle event happens, and once per completed 5M candle ("nothing changed" is on record too). Each line has the
decision with its reasons for and against, the market condition (including the open's gap and the ATR in use), every
timeframe's trend, every strategy's state and why, every live setup (detection and confirmation time, trigger, entry
area, invalidation, the confirming candle's time and prices, blockers, reasons) and the lifecycle events since the
previous line with the reason each setup ended. It also records the feed: connection state and since when, reconnects,
the data gap that is open or the last one, the history refresh state and the latest errors, and a change in any of them
writes a line at once, so a disconnect is on record when it happens and not only through its consequences. Each record also has the
NIFTY spot price with its age and exchange / receipt times, the levels the decision was made against (nearest supports and resistances,
previous-day high / low / close, the session open; the opening range is in `session`), every setup's stage, trigger, invalidation,
targets and blockers, each timeframe's trend, ADX, RSI, EMAs, ATR and extension facts, and whether a stale spot or an untrusted clock
started or ended.

Since Stage 3 every record also carries the regime facts (`market.regime_facts`, each with its checks), the 1H and 15M trends the direction rule used (`market.trends`), and
`counter_trend`: the permission decision of every counter-trend strategy at that moment, granted or denied, with its checks and the structure in real prices; each setup carries the record
it was permitted by. A change of permission is a line of its own, and `python -m app.journal ... --detail` prints it. Records written before Stage 3 have none of these keys and read as before.

**Records, version 2 (Stage 6.2).** A record now has `v: 2`; a record with no `v` is version 1 (everything written before) and reads exactly as it always did, in the same file, the API and
the review. Version 2 only *adds*, and what makes a line get written is unchanged:
- `decision_setup`: the setup the decision is about (the one `decision.setup_id` names, also for a WAIT about a setup), with its status and stage, trigger, entry zone, invalidation, extreme,
  targets and risk (`plan`), blockers and detection / confirmation times, next to the decision, so it no longer has to be looked up in `setups`. `null` when the decision names no live setup.
- `decision.also_setups`: the strategies that agree, as `{strategy, strategy_name, setup_id, direction}`, in the order of the words in `decision.also` (which are unchanged).
- On every lifecycle event, `code`, `superseded_by` and `final` (`null` on the events that do not end a setup). An event that ends one says **why as a code**: `session_ended`, `market_closed`,
  `late_session`, `unconfirmed_timeout` (not confirmed in time), `no_longer_suits` (the market no longer suits the strategy), `no_longer_present` (the conditions are gone), `superseded` (a newer
  structure replaced it; `superseded_by` is that structure's id), `invalidated`, `expired` and `missed` (the entry opportunity passed), and the words stay in `text`. `final` is what the setup
  held when it ended: the status it ended from, trigger, entry zone, invalidation, extreme, level, targets, detection and confirmation times, how long it lived and whether it was carried over
  from an earlier run, so the story of a setup no longer depends on finding the last record that still showed it.
`GET /api/journal` rows carry `v`, `also_setups` and `decision_setup`; `python -m app.journal FILE --detail` prints how each setup ended and who agreed. There is still no "actionable" lifecycle
event: READY_TO_ACT is the derived stage a record shows in `setups` and `decision_setup`.

A restart is on record too. On start the app reads today's journal: setups that had ended stay ended (never revived),
setups that were live carry on with their original detection and confirmation times (`resumed` in the journal and on the
dashboard), the event numbering continues, and nothing is announced a second time; the first line of the new run says
`restart`. The reader skips a line cut short by a crash and says so, and the next run starts on a fresh line, so a crash
costs one line. `JOURNAL_DIR` changes the folder (see "Keeping the journal safe" below). A journal that cannot be written never disturbs trading. Read a session back:

```bash
python -m app.journal logs/decisions-2026-11-06.jsonl             # what changed, in time order
python -m app.journal logs/decisions-2026-11-06.jsonl --detail    # with the reasons for and against
python -m app.journal logs/decisions-2026-11-06.jsonl --all       # including the once-per-candle lines
```

**Reading the decision never writes (Stage 6.1).** Only the ticker (once a second, from the moment the app starts, with or without a dashboard open) *evaluates* the decision: it advances the
setup lifecycle and writes the journal. Every request that reads it (`GET /api/state`, `/api/trading`, `/api/options`, the WebSocket's first message and its pushes) runs inside
`app.engine.reading()`, where `trading()` only presents what the last evaluation settled, with the live price and ages of the moment: it advances nothing and writes nothing, so a script or a
page polling the API can no longer add a lifecycle event or a journal line stamped with the moment of the request (before, the first reader to see a new candle did). Two edges follow: a read made
while a newer candle has not been evaluated yet returns the last evaluation's answer unchanged (the ticker catches up within about a second), and a read before the very first evaluation says
`NO TRADE: no decision has been evaluated yet` (the ticker evaluates first thing, so this lasts a moment). A direct call of `trading()` outside `reading()` still evaluates, which is what the tests
and any script that steps an engine use. `tests/test_reads_do_not_write.py` holds all of this, including that the journal has one writer and that a new route cannot read the decision outside `reading()`.

**Keeping the journal safe (Stage 6.3).**
- *Where it is.* The folder is always absolute: `logs` beside the app (not beside wherever Prism was started: a copy started from another folder used to write, and restore from, a different journal), or
  `JOURNAL_DIR` (a relative one means relative to where Prism was started, made absolute at once). The one-copy lock lives in the same folder. The log line `decision journal: <folder>` says which at
  start-up, and `GET /api/health` (`journal`) and `GET /api/journal` (`status`) say where it is, whether records are waiting, how many were lost, the last error and when it last wrote.
- *Synced to disk.* Every record but the once-per-candle heartbeat is flushed and fsynced when it is written, so a power cut costs at most heartbeats. `JOURNAL_FSYNC=0` turns that off. A sync that fails
  is counted (`fsync_errors`) and logged once; the line is never written twice.
- *A storage that is gone for a while.* A full disk, a locked file or a missing folder no longer costs the decisions of that time. Each record is made as usual and kept in memory (at most 1000), then
  written in order and with the time it was made, as soon as the storage works again; the first record after says what the outage cost (`outage`: from, to, records written late, records lost). The
  health page shows a **warning** (never an issue: trading is not stopped) while records wait. If the queue fills, a heartbeat is dropped first, then the oldest record, and the loss is counted. This
  protects against a storage that comes back; a process that ends during the outage loses what was waiting.
- *A write that fails halfway* leaves a cut line: the next write starts on a fresh line and the record is written again whole, so a reader sees one bad line and no missing record.
- *Event numbers.* A run whose restore failed numbers its events after those already in the file, and `/api/journal` identifies an event by its number, its setup and its status together, so two runs
  that both numbered from 0 (older files) no longer hide each other's events.
- *A number that is not finite* (NaN, infinity) is written as `null`; it no longer costs the record.

**Checking a journal, and reading one that is not perfect (Stage 6.4).**
```bash
python -m app.journal logs/decisions-2026-11-06.jsonl --verify          # what is wrong with the file, and what is in it (read-only)
python -m app.journal logs/decisions-2026-11-06.jsonl --verify --json   # the same, for a program
```
`--verify` opens the file for reading only: it repairs, rewrites, truncates and deletes nothing. It lists each problem with its kind, how serious it is and its line numbers. An **error** means the file cannot
be trusted for that (a time that goes backwards, a decision that is not BUY CE / BUY PE / WAIT / NO TRADE, an event after its setup ended, a status that goes backwards, a record with no time); a **warning**
means something was lost or is odd and the journal is still usable (a line that could not be read, a write cut short, an event number missing or used by two events, an event written twice, a record of another
day, a time that disagrees with itself, an ending with no code in a version-2 record, an outage that cost records). The exit status is 1 when there is an error, 0 otherwise, 2 when the file cannot be opened.
It also says what the file holds: records and bytes by kind, the share of the bytes that are once-per-candle heartbeats and how many of those were written while the market was closed, record sizes, lifecycle
events and the setups that had not ended in the file, and every start / restart. (The two journals of 6 and 7 November: heartbeats were 55% and 75% of the bytes; on the Saturday all 253 were written on a closed
market, 1.2 of the file's 1.6 MB. Heartbeats are unchanged: one per 5 minutes, always. Thinning them, or compressing or removing old files, is a decision for you, and nothing does it.)
The review command (`python -m app.journal FILE [--all] [--detail]`) prints exactly what it printed before for a good record and copes with an older or odd one: a dash for what a record lacks, and one line
("record N could not be shown") for one it cannot show at all, never an abort. A line that is JSON but whose `decision` is not an object is not a record (it is a skipped line, like a cut one).
`GET /api/journal` now says what it could not read: `bad_lines` and `bad_line_numbers` (lines of the file that are not records) and `unreadable_records` (records it had to skip), and the Journal tab shows a
warning line when either is not zero.

**After a restart (Stage 6.5).** The first record of a run that took over an earlier run's journal is written while the history is still loading, so it has no setups of its own. It now carries a
`restart` block that says what the restart did: `restored` (the ids of the live setups carried over), `ended` (the setups that ended and were announced earlier today and stay ended), `events_carried`,
`next_event` (where the numbering goes on) and `records_read`; or, when the restore failed, `ok: false` with the error, the events of the run still numbered after those on record, and a record whose reason is
`restart` (it used to say `start`). The review prints it ("carried over 1 live setup(s): ...", "could NOT be restored ..."), `GET /api/journal` serves it on the row, and `--verify` lists every restart with how
many setups it restored and warns about a restore that failed. A run that finds no journal for the day (a new day, another `JOURNAL_DIR`, a new file) writes `start` and no block, and touches nothing of the old file.
What a restart restores is exactly what the journal recorded: every field of each live setup (the counter-trend permission record included), its original detection and confirmation times, `resumed`, the event
numbering, and which setups had ended. One thing it does not, and need not: a structure that ended without ever being announced is not in the journal (it was never an event); the next scan finds it again and sets
it aside silently, so nothing is announced twice or missed. `tests/test_journal_recovery.py` plays all ten strategies on both sides through real journal files, restarts at every point of a setup's life
(detected, waiting, confirmed, ended) and checks that the restarted engine and the one that never stopped decide and announce the same, restarts twice in a row and again later, cuts a record in the middle of an
event, changes day and folder, and restores real version-1 records.

### Validating during market hours

1. Before 09:15: start the app, check the log shows the Angel One login, the contracts, "Websocket connected" and
   "history refreshed"; the dashboard says `NO TRADE: before the market opens`, analysis is available and not stale,
   and `logs/decisions-<date>.jsonl` appears.
2. 09:15–09:30: the decision must be `WAIT: opening range forming`, never a BUY. Compare the "opened +x pts" line, the
   last completed 5M/15M candles (Candles table) and the price with your broker's chart; the price age stays a few seconds.
3. 09:30–14:45: for every setup event and every BUY, check against the chart that the trigger is the highest high of the
   base, the invalidation is below the pullback low / broken level, the "Trigger candle" row names the candle (time and
   prices) that closed beyond the trigger, and that the BUY appeared only after that candle *completed* (a few seconds
   after :00 or :05), never mid-candle. The BUY must turn into `WAIT … do not chase` once price leaves the entry area.
4. Check nothing is announced twice (Recent events), nothing ended is revived, CE and PE setups together give WAIT, and
   12:00–13:30 shows the stricter-confirmation note; after 14:45 the decision is `NO TRADE: late session`. If the app
   was restarted, the journal has a `restart` line and the setups it carried over say `resumed`; they must not appear
   as new events. A feed drop shows as a `feed:` line when it happens (state, reconnects, the gap).
5. After 15:30: `python -m app.session_check logs/decisions-<date>.jsonl` (the automatic half of this list: every BUY against the rules, and the manual items it cannot do),
   `python -m app.journal logs/decisions-<date>.jsonl --detail`, and note for each decision whether you agree. After the daily candle update, `python -m app.outcomes logs/decisions-<date>.jsonl`
   shows how each ready setup went (index points, not profit).
6. Repeat on different kinds of sessions (trending, range-bound, gap up/down, volatile, an expiry day) before trusting
   anything (`python -m app.session_check logs/decisions-*.jsonl --coverage` shows which kinds have a clean check so far). Judge it on whether each decision was *explainable and matched the chart*, not on profit.

### Helping a manual trader (Stage 8)

Prism decides nothing and places nothing. These additions make the decisions easier to *use* by hand, and make it possible to find out afterwards which of them deserve trust. **All of it was
verified with fakes and hand-made records (and the page's own script under node), never in a live session**; where it was run on the real journals of 6-11 November that is said.

**Alerts: be told, instead of having to watch.** The 🔔 button in the header chooses `sound + popup`, `sound` or `off` (remembered in the browser; the default is `sound`). One alert is raised when
a setup becomes `READY_TO_ACT` (the urgent one: four tones, a popup that stays until you dismiss it, and a line in the log under the tabs saying the setup, the entry area, the trigger and the
invalidation), and a warning when a setup that was ready ends or is blocked, when Prism turns NOT READY, when the live feed is lost while the market is open, and when the dashboard loses its
link to Prism. Being ready again is only noted. Rules worth knowing: the first snapshot is a baseline (opening the page while a setup is ready announces nothing); **a flickering entry area is
one piece of news, not twenty** (the real journal of 2026-11-11 holds one setup that went `READY_TO_ACT` and back about twenty times in seven minutes as price crossed its trigger: a setup
that comes back within 5 minutes of having been ready is not announced again, a setup merely leaving the entry area is not an alert, and a repeated block, NOT READY or feed loss is said once per 5
minutes); one sound per snapshot however many things changed in it; a sound needs one click on the page first and a popup needs the browser's permission (both browser rules); `off` still keeps the
log and the count in the tab title. Alerts live in the page: a closed page raises none. The daily-loss line below is one of them.

**Your own trades, and sizing them (the Trades tab).** Prism reads no account, so this is a notebook you fill in: instrument, BUY / SELL, quantity in units, price, an optional setup id (a button
fills in the setup the decision is about) and a note. Each trade is one line of `trades-<date>.jsonl` beside the journal, **appended and never edited**: a mistake is *voided* by a line that names it, and
a void that would leave a later sell with nothing to sell is refused. A BUY keeps what Prism's decision said at that moment (the action, the setup, the spot price) and the tab says whether you
followed it. The result is arithmetic on the prices you typed, first in first out per instrument (instruments match ignoring case and spacing), for long option trades: a SELL needs an open
quantity; there is no brokerage, tax or slippage, and it is not an account statement. The Result column adds up to the realised figure: a sell carries what it closed, a buy shows in grey what its sold
part made. API: `GET /api/trades`, `POST /api/trades`, `POST /api/trades/{id}/void` and `GET /api/risk?entry=&stop=&lot=` (optionally `capital`, `risk_pct`, `max_loss`). The two writes are
refused when the request says it comes from another site (`Origin` that is not this page's own, or `Sec-Fetch-Site: cross-site`) or was addressed to a name that is not this computer (the defence
against a web page that resolves its own name to 127.0.0.1), unless `PRISM_ALLOW_REMOTE` opened Prism to the network; a script with no `Origin` is accepted. The size calculator needs **your** stop
premium (Prism knows an index invalidation, not an option's stop) and your limits, `RISK_CAPITAL`, `RISK_PER_TRADE_PCT` and `RISK_MAX_DAILY_LOSS` (rupees; see `.env.example`; none has a default,
and with none set it gives the loss per lot and says how to set one). It answers how many lots keep the loss at that stop inside the per-trade limit and what is left of the day's (the day's realised
loss from the trade log is taken off), says which limit decides, and warns when not even one lot fits. Reaching the day's loss limit shows as a red alert on every tab and raises one warning. It does
not say whether to trade, and the loss at the stop ignores slippage, a gap through the stop, brokerage and tax.

**Which strategies work: `python -m app.outcomes`.** `python -m app.outcomes logs/decisions-2026-11-11.jsonl [--candles day.json] [--json]` replays every setup that reached `READY_TO_ACT` against the
day's 1-minute candles (from Prism DB through the app's own read-only loader, or from a file). The entry is the spot price on the journal record of the **first** moment the setup was ready, with the
levels it showed then, and the replay starts at the next whole minute. It stops at the first of: the invalidation level touched (`invalidation`), the first target beyond the entry touched
(`target1`), Prism ending the setup (`setup_ended`, at the price of that journal record) or the close (`unresolved`, marked at the last close); a candle that touches both is counted as the
invalidation and says so. Results are in R (the risk is the entry minus the invalidation: target 1 is its distance over that, the invalidation is -1), with the best and worst the trade showed, whether target 2
was reached after target 1, and a tally per strategy. **It is index points, not option premium or profit**: no slippage, cost or tax, and a few sessions are a small sample: it says which strategy to look at
again, not what to trust. Setups that were never ready are listed with the reason they ended. Run on the real journal of 2026-11-11 it listed its one ready setup and said the 1-minute candles of that day were
not yet in Prism DB (run the daily update after the close, then the review); the replay itself has only been checked on hand-made candles.

**Are the rules too strict? `python -m app.outcomes FILE... --blocked`.** Prism says WAIT most of the time (in the four recorded sessions: BUY 2%, WAIT 60%, NO TRADE 38%, and 214 of the NO TRADE minutes were the start-up bug of
2026-11-12). `--blocked` replays the **near misses**: a setup whose confirming candle had closed, with the price inside its entry area, but which something held back (the room rule, the size of the risk, the data, the session,
the volatility, told from the words of its blockers) and which never became ready. The entry is the first moment it would have been ready but for that, with the price and levels shown then; it is replayed like a ready one,
and `run` is the best the price did before the invalidation. The tallies are by what held them back, next to the ones called ready, so the room rule's cost (or protection) is a number; several journals are reviewed day by day and then
together (`python -m app.outcomes logs/decisions-2026-11-1*.jsonl --blocked`; `outcomes` and `session_check` expand a `*` or `?` themselves, so the same line works in PowerShell and cmd, which do not expand it for a program, as
in a Unix shell). It changes no rule or setting. On the real journals it found one near miss (2026-11-12 13:50, Trend Pullback CE, the room rule), not yet replayed because the
day's candles were not in Prism DB; a handful of sessions says little, and an entry that was never offered is not a trade you could have had.

**Checking a day: `python -m app.session_check`.** The automatic half of "Validating during market hours". `python -m app.session_check logs/decisions-2026-11-11.jsonl` tests every BUY in the journal
against the rules (inside the session, not from 09:15 to 09:30, not from 14:45, on trusted data and a connected feed, after its confirming 5M candle completed, with the price in the entry area and nothing blocking, the
invalidation on the right side of the price, the 1H / 15M trend rule with the granted counter-trend permission as its one exception, never a BUY while a CE and a PE setup are both ready), that nothing that ended is live again and
nothing is announced twice, that the file itself passes `--verify`, and that the journal covers the session (a late start, an early end or a silent stretch is a warning, not a failure). It says what kind of day it was
(opening gap, the regime for most of the time, volatile or not) and prints the **manual list** it cannot do (the chart comparison, whether the trigger is where you would put it, whether you agree). The exit status is 1 when a check fails.
`--coverage` over many files shows which kinds of day (gap up, gap down, flat open, trending, range-bound, volatile) have a clean check with a BUY in it, which is what the runbook's "repeat on different kinds of sessions" asks
for; an expiry day cannot be told from the journal. A PASS is the absence of a counter-example, not a judgement of the decisions. On the real journals it found no counter-example in the 505 BUY records of 2026-11-11 (a
session Prism joined at 11:09:45, so the open is a warning), and the days of 6 and 10 November, with no BUY, have nothing to test the BUY rules on.

**The daily candle update no longer holds a password.** `angelone/daily_update.py` (the script you run to add a day's candles to Prism DB) used to carry the database password in the file. It now reads
`PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DBNAME` (the names Prism uses) from the environment or from the git-ignored `.env`, and stops saying what to set when there is no password. It writes to the database, so its
role needs insert rights, which Prism's read-only role should not have.

### The dashboard (React, Stage 9)

The dashboard was rewritten in React in stages, in a chart-centred terminal style. **Since stage 9.8 it is THE dashboard: it is served at `/`** (`/app` goes there), and the page it replaced is gone. In the stage descriptions below, "the current dashboard" means that page, as it was until the cutover.
Stage 9.1 is the foundation, 9.2 the Chart tab, 9.3 the Overview, 9.4 the Options tab, 9.5 the Analysis tab, 9.6 the Journal tab and 9.7 the Trades tab with the alerts (the sound, the popup, the count in the title) and **9.8 the cutover**: `/` serves it and `app/static/index.html` is gone.

- **Where things are.** The source is `frontend/` (React 18, TypeScript, Vite). It is built into `app/static/app/`, **which is committed**, so Prism still starts with Python only: node is needed to *rebuild*, never to run.
  `cd frontend && npm ci && npm run build` rebuilds it; `npm test` runs the component tests, `npm run typecheck` the types. A test compares a hash of the source with the one the build wrote, so editing `frontend/src` and
  forgetting to rebuild fails the Python suite. Without a build `/` says so (a 503 page with the commands) and the log says why.
- **What 9.1 has.** The connection with the current dashboard's contract exactly: `loading` until the first snapshot (with "cannot be reached (attempt N)"), `live` while snapshots arrive, `stale` after 5 s of silence or a closed
  socket (the last snapshot kept, dimmed, never a current decision), reconnecting every 2 s, a message that is not a snapshot ignored, one socket for the life of the page. The header (price, move from the previous close, tick age on the
  receipt clock and the exchange clock, the four chips, the summary line, the clock), the one alert line (what is wrong right now: not ready, data issues, warnings), the stale notice, and the six tabs (Overview, Chart, Options,
  Analysis, Journal, Trades: hash addresses, arrow keys), each a placeholder pointing at the current dashboard until its own stage built it.
- **One difference on purpose.** A stale page shows no alert about the system: the current page keeps showing the last snapshot's alerts dimmed, but an alert is a verdict on the present, and the stale notice is the alert.
- **Safe by construction.** Every string from the server is drawn as text (React escapes it; a test forbids `dangerouslySetInnerHTML`, `innerHTML` and `eval` in the source); the page's only request besides the WebSocket is the chart's read, `GET /api/chart` (a
  test pins it as the one `fetch` in the source, with no method and no body) and it loads nothing from another site; no order word anywhere. The packages are pinned to exact versions, the lockfile has an integrity hash for every one and only registry addresses, `npm` may run no install script here
  (`frontend/.npmrc`), and `npm audit` reports no vulnerability (a first install pulled a vitest with two, and a deprecated jest-dom: both replaced by versions that are clean). React and the chart library ship in the page (113 kB gzipped, 348 kB raw).
- **How it was checked.** 109 component tests (`npm test`) on the real snapshot of the engine (`tests/make_frontend_fixture.py` writes it; a Python test says when the backend's payload no longer has its shape), 25 Python tests of the
  serving, the bundle and the supply chain, and 6 in real Chrome: the React header says exactly what the current dashboard's says (text, colours and tooltips of nine elements and the alert line) in each of the 14 pinned states,
  it fits 1366x768 and 1920x1080, the tabs work by click, keyboard and address, and with a real server stopped the page goes STALE and UNKNOWN, then reconnects by itself and draws the new snapshot alone. About 70 deliberate rule-breaks were
  run against the new code. **Mocked market only: nothing was run against a live session.**

**Stage 9.2: the Chart tab (`/app/#chart`).** NIFTY's candles in 1M, 5M, 15M, 1H and 1D, drawn with TradingView's Lightweight Charts, and on them **only what Prism itself already computes**:

- the 20 and 50 EMA (the last point of each is the one the Analysis tab shows), the confirmed swing highs and lows (red arrow above a high, green below a low), the previous day's high, low and close, the session open, the nearest support and resistance, and
  each live setup's trigger, entry area (two lines), invalidation and target, the decision's own setup thicker. Under the chart the same setups are written out in words and numbers, with the trend, ADX, RSI and ATR Prism holds for that timeframe.
  Each group has a box to switch it off (EMA 20, EMA 50, Swings, Levels, Setups). The legend follows the cursor (open, high, low, close and the move from the candle before).
- **What it does not do (on purpose).** No candlestick-pattern or chart-pattern detection, no scorecard or backtest: those were not part of this stage, and a pattern drawn from no rule Prism has tested would be an opinion on the screen that looks like a signal.
- **Where the data comes from.** `GET /api/chart?timeframe=1m|5m|15m|1h|1d&limit=10..2000` (`app/chart.py`) answers from memory only: the candles the analysis already reads (history plus the live builder, merged), the candle still forming, and the last
  settled decision, read inside `reading()`. No database or broker call, nothing evaluated, nothing journalled (the route is in the test that proves no GET writes a byte). So the window is what Prism holds: about 5 sessions of 1M, 14 days of
  5M, 70 days of 15M and 45 days of daily candles; the answer says when it holds fewer than were asked for, and a candle that is missing is not drawn. Scrolling further back than that would need a database read: not built.
- **Live.** The page asks again every 3 s while the tab is open (one request at a time, 5 s after a failure with the last candles kept and the failure said), and not at all while the link to Prism is lost or another tab is open. A poll only moves the
  last bar and adds new ones, so the zoom and scroll the viewer chose are kept. Times are drawn in IST on any PC (the chart library draws UTC, so every time is moved on by 5 h 30 min). The viewer's choices are kept while another tab is open, and not
  after a reload.
- **Library.** `lightweight-charts` 5.2.1 (Apache-2.0), pinned exactly; it brings one package, `fancy-canvas` 2.1.0; neither runs an install script; `npm audit` finds nothing. The newest release (5.3.0) was two days old when this was chosen, so
  it was not. The library draws its small TradingView logo, a link to tradingview.com that loads nothing by itself, as its licence asks; the tab says so under the chart.
- **How it was checked.** 41 Python tests of the endpoint (the candles are the market's own, the swings are exactly the confirmed pivots of the drawn candles, the previous-day levels are the previous session's own high, low and close,
  the setups are the decision's own, a read changes nothing), 231 component tests in all (`npm test`), 13 in real Chrome (candles of both colours, both EMAs, the trigger and level lines counted as pixels on the canvas; each box takes its own colour off and
  gives it back; every timeframe; a zoom survives the next poll; no sideways scroll at 1366x768 and 1920x1080), and 125 deliberate rule-breaks against the new code. **Mocked market only: it was not looked at against a live session, and Prism has to be restarted
  to serve the new route.**

**Stage 9.3: the Overview (`/app/#overview`, the first tab).** What a trader reads before a manual trade, top to bottom: the decision (BUY CE / BUY PE / WAIT / NO TRADE in the colour of the answer, who made it, whether the entry is eligible, and an "Explain this
decision" popup in plain words with the plan in index points), the four timeframes (the 1H and 15M decide the side; the 5M and 1M are information), market context, the current setup (trigger, entry zone, invalidation, what ends it), the strategy monitor
(one row for each strategy that holds a setup, and one closed line for the rest), the six regime facts with the counter-trend permission, data health (the NIFTY tick on its two clocks, candles, clock, option feed) and the latest three setup events, then the how-to.

- **A port, not a redesign: this stage changes no rule and no word.** The markup, classes and the current dashboard's own CSS rules were carried over, and the claim is tested, not assumed: in real Chrome both dashboards are given the SAME snapshot in each of the 14 pinned states
  (BUY CE, BUY PE, WAIT, NO TRADE, market closed, feed disconnected, a stale NIFTY tick, no option quotes, no suitable contract, and the five Trend Exhaustion Reversal states: waiting, denied, BUY CE, BUY PE, regime unavailable) and every one of the nine Overview panels is compared: the same elements in the same order with the same classes and
  tooltips, and exactly the same text. The same comparison is made after a real server is stopped under each page (the last snapshot, dimmed, as history: "STALE since ... NOT ACTIONABLE", nothing eligible, every health line unknown).
- **What is different, on purpose or for now.** (1) A tab that fails to draw says so in words and keeps the header, the tabs and the stale notice (the current page does the same with its "Dashboard display error" line), and draws again with the next good snapshot. (2) The open or closed
  state of the explanation and of the idle-strategies line is kept while the page updates once a second, but not while another tab is open. (3) The links to the Analysis tab and the Journal tab work (stages 9.5 and 9.6). (4) The how-to describes the 🔔 button and the Trades
  notebook: they were built in 9.7. (5) The current page enlarges its text 1.1x and 1.3x on screens of 1500 and 1700 px or more; this one does not yet (a CSS zoom and the chart's mouse handling have to be settled together before the cutover).
- **How it was checked.** 325 component tests in all (`npm test`; 94 of them for the Overview: every branch of the rules, the stale page, the regime layer unavailable, the option feed in each state, conflicts, long events, escaping of what a server says, a draw error), 9 in real Chrome
  (the parity above, the fit at 1366x768 and 1920x1080 with no scrollbar and no text under 10 px, the explanation opening over the page without moving it, the links, the stale-and-back cycle with a real server), and 129 deliberate rule-breaks against the new code (the first pass left 4 untested
  and 1 mis-aimed: all fixed, none survives). **Mocked market only: it has not been looked at against a live session.**

**Stage 9.4: the Options tab (`/app/#options`).** The watched option contracts checked against their own quotes: a header bar (the NIFTY spot and its age, the decision, the option side, who made it), the **selected contract** with its quote in twelve labelled numbers, its findings, the reasons it was
chosen, the alternatives and the contracts of its side that were ruled out, or **"No contract selected"** (with the reason: not a BUY, a decision that conflicts with the options data, or no suitable contract), the comparison table of the chain, the expiries (with the expiry-day warning) and the watched window with the
thresholds. A contract is shown as selected ONLY when the final decision calls for one; a stale page shows the last selection as history ("Last selected contract ... STALE since ..."). It places no order and predicts nothing.

- **A port, not a redesign: no rule and no word changes.** Same method as the Overview, same proof: in real Chrome both dashboards are given the SAME snapshot in each of the 14 pinned states (a selected CE and PE, WAIT, NO TRADE, market closed, feed disconnected, a stale NIFTY tick, no option quotes,
  no suitable contract, the five Trend Exhaustion Reversal states) and the six parts of the tab are compared: the same elements in the same order with the same classes and tooltips, and exactly the same text; and again after a real server is stopped under each page. The rule that decides whether a contract is on offer
  (`contractOffer`) is now one function (`frontend/src/optionsModel.ts`) shared by the Overview's option-feed line and this tab.
- **What is different, on purpose or for now.** (1) A payload it cannot draw is said in words ("Dashboard display error in options: ...") and the header and tabs stay; an analysis with no selection is shown as "options analysis not available yet" rather than as an error. (2) The list of ruled-out contracts starts open for a BUY that has no
  suitable contract (as before) and stays as the viewer leaves it while the page updates, but is not remembered across a tab switch. (3) Quantities use the Indian grouping the exchange does (20,00,000), as before.
- **How it was checked.** 383 component tests in all (`npm test`; 58 of them for the tab and its rules: every branch of the selected card, the conflicts, the ruled-out list, the table in each state, the expiries, the window, the stale page, escaping of what a server says, a payload it cannot draw), 10 in real Chrome (the parity above, the fit at
  1366x768, 1920x1080, 1280x720, 1100x700 and 900x700 with the tables scrolling inside their own box, "No contract selected" when the decision is not a BUY, the ruled-out list), and 90 deliberate rule-breaks against the new code (the first pass left 8 untested: all fixed, none survives). **Mocked market only: it has not been looked at against a live session.**

**Stage 9.5: the Analysis tab (`/app/#analysis`).** Everything behind the decision, in eleven collapsible sections: the **regime facts** with the checks each was made from, the **counter-trend permission** (granted or denied, with the structure behind it), **all ten strategies**, each side (CE call / PE put) on its own with
its state, the scanner's own note, the live setup's card (trigger, entry area, invalidation, the plan in index points, the evidence for it and what blocks it) and the last setup that ended, plus the extra **reversal evidence** of the one counter-trend strategy; the **ended setups**; the **indicator tables** (trend, EMAs, RSI, ADX/DI, ATR, breakout), the
**market structure**, the **levels** (previous day, opening range, session, nearest support and resistance) and the **candles** (last completed, forming, missing, the live candles and what history Prism holds); and the **health detail** (the start-up stages and numbers, each instrument by its own ticks, the feed, the clock, the candle recovery, the Angel One limiter, the
official-candle check), the instruments and contracts, and the gaps and errors. Nothing on it is calculated: every number and verdict is the backend's.

- **A port, not a redesign: no rule and no word changes.** Same method and same proof as the Overview and the Options tab: in real Chrome both dashboards are given the SAME snapshot in each of the 14 pinned states and the whole tab, over six hundred elements each time, is compared: the same elements in the same order with the same classes and tooltips, and exactly the same
  text; and again after a real server is stopped under each page (a ready setup is then said to have been in the entry area, and nothing is called actionable).
- **Open and closed.** Which sections are open is the reader's, and the page keeps it (as the current dashboard does): while snapshots arrive once a second and while another tab is open. At the start the sections that are open are the current dashboard's (strategy analysis, ended setups, the technical, structure and levels tables, the health detail), and a strategy that holds a
  live setup opens by itself, once; after that it is the reader's. A link from the Overview's strategy monitor ("detail →") opens this tab with that strategy and its section open and brings the strategy into view, below the header; "All ten strategies →" opens only the section.
- **A quirk of the current dashboard, carried over on purpose.** It builds a "Confirmation, invalidation and blockers" section and then throws it away (a comma where a plus was meant), so that section has never been shown, and neither is it here, so that the two pages say the same thing; a test pins it. The same account is under "Explain this decision" on the Overview. Showing it is a one-line change if you want it.
- **What is different, on purpose or for now.** A payload it cannot draw is said in words ("Dashboard display error in analysis: ...") and the header and tabs stay; what the Overview's explanation and the Options tab's ruled-out list had remembered only while the page updates is, for this tab's sections, remembered across tab switches too.
- **How it was checked.** 488 component tests in all (`npm test`; 105 of them for this tab and its rules: every branch of every section, the stale page, the escaping of what a server says, the open state and the link from the Overview), 12 in real Chrome (the parity above in the 14 states and after a stopped server in three, the sections open at the start, what the reader opens or closes being kept,
  the link from the Overview, and the fit at five widths with the tables scrolling inside their own box), and 171 deliberate rule-breaks against the new code (the first pass left 14 untested and 2 mis-aimed: all fixed; one remaining mutant is equivalent, a link to "all ten" that asks to scroll to an element that does not exist). **Mocked market only: it has not been looked at against a live session.**

**Stage 9.6: the Journal tab (`/app/#journal`).** What Prism said today and why, from the decision journal the engine writes: a bar with the file and its record count, the **decision history** (each change of decision with its time, price, market, strategy and the reasons for and against, the option contract chosen for a BUY, the counter-trend permission that was needed and the
regime facts), the **lifecycle of the setups** (one line for each setup: every status it went through with its time, where it stands now, its latest note), the **expired and invalidated setups**, **every strategy event**, the **explanation of the decision as it stands**, and a note that Prism records no trades. It lays out what the journal recorded: nothing is decided here.

- **The one tab that reads a route of its own.** It asks `GET /api/journal` (the file the journal already writes, condensed: read-only, the route writes nothing). The page reads it **when the tab is first opened, again when the decision's headline changes or a setup event is added (no timer), and when you click Refresh**; one read at a time, and a change that comes while a read is out is read as soon as that one
  is done (the current page loses it). A failed read keeps the last journal and says so; an older server that has no journal route is told to restart (not shown as an empty journal); an answer that claims to be a journal and is not shaped like one is an error, never drawn. The journal the page has is the page's: leaving the tab and coming back shows it at once, and reads nothing if nothing changed.
  The source guard now allows exactly two requests of the page's own, the chart's and this one, both plain GETs with no method and no body.
- **A port, not a redesign: no rule and no word changes.** Same method and same proof as the other tabs: in real Chrome both dashboards are given the SAME snapshot in each of the 14 pinned states and read the SAME real `/api/journal` of that state's engine (some states have no journal: the tab then says so and shows the live events), and the whole tab is compared: the same elements in the same order with
  the same classes and tooltips, and exactly the same text; and again after a real server is stopped under each page (the journal it had read stays, dimmed).
- **What is different, on purpose.** (1) The reload that is not lost, above. (2) A tab that fails to draw says so in words and keeps the header and tabs, and it draws again as soon as a new snapshot **or a new answer of the journal's own** arrives (the journal arrives after its read, not with the snapshot). (3) The page works out its reload key safely: a snapshot it cannot read is for the tab's guard to say, and does not stop the page.
- **How it was checked.** 552 component tests in all (`npm test`; 64 of them for this tab, its rules, its read and its hook: every branch, the 150-decision limit, the lifecycle order, the reload rules, the failed and the late read, the escaping of what a server says, a journal or a snapshot it cannot draw), 10 in real Chrome (the parity above in the 14 states and after a stopped server in two, exactly which requests the page makes: one when opened, none for
  the snapshots that arrive, none on leaving and entering again, one for each click of Refresh; the sections open at the start; the fit at five widths), a Python test that the fixture is still the shape of the route's real answer, and 100 deliberate rule-breaks against the new code (the first pass left 9 untested: seven were test gaps, two were guards React 18 makes unnecessary and were removed; none survives). **Mocked market only: it has not been looked at against a live session.**

**Stage 9.7: the Trades tab (`/app/#trades`) and the alerts.** The last two things the current dashboard does that the React one did not.

*The Trades tab* is a notebook of the trades **you** made and a size calculator. Prism places no order and reads no account, here or anywhere: you type what you bought or sold, and Prism keeps it beside the journal together with what its own decision said at that moment. It has the form to log a trade (instrument, side, quantity, price, an optional setup and note; **Use Prism's setup** fills in the one the decision is about), today's trades (time, side, instrument, quantity, price, how much of a buy has been sold, the result, what Prism said and whether the buy followed it, the note, and **void**), what is open, the realised result, your own loss limit for the day and how much of it is used (red, with a box, when it is reached), and the calculator (how many lots keep the loss at YOUR stop inside YOUR limits, `RISK_*` in the environment).

- **The one place the React page writes.** Logging and voiding send `POST /api/trades` and `POST /api/trades/<id>/void` (the server accepts them from its own page on this computer and from nowhere else; the file is only ever added to: a mistake is a line that cancels it). The page's source guard now allows exactly three places that ask the server for anything: the chart's read, the journal's read, and one file with four requests (read the trades, log one, void one, size one) to `/api/trades` and `/api/risk`: no other method, no other address, and a test says so.
- **Asked for once.** The trades are read once as the page starts, whichever tab it is on (so a loss limit you have already reached is on every tab from the start), and again only when you log or void; a server that cannot answer is not asked in a loop, Retry asks again. What you typed in the two forms, what was said under them and what the calculator answered belong to the page, so leaving the tab and coming back finds them as they were.
- **The alerts.** The **🔔 button** in the header chooses what tells you when a setup becomes ready, stops being ready, when Prism is not ready, the feed is lost, the link is lost or your loss limit is reached: **sound + popup**, **sound** (the default) or **off**. The choice is remembered under the same name the current dashboard uses, so it carries from one to the other. The sound is the current dashboard's tones (four for a setup that is ready, two for a warning, one when you change the mode); a popup needs the browser's permission, asked when you choose popups; the count of what you have not seen is in the page's title, `(2) Prism`, until you are back (the window, the tab or any click). The setups that became ready or ended in the last ten minutes join the **one alert line**, with **clear the setup alerts**; the rest stay in the log. A setup whose entry area flickers is one alert, not twenty (five minutes). **Every snapshot is compared with the one before it as it arrives** (the connection tells the alerts, so none is skipped however busy the page is).
- **A port, not a redesign: no rule and no word changes.** Same method and same proof as the other tabs, in real Chrome against the real routes and a real trade log in a temporary folder: five notebooks (none, three trades, a day over its loss limit, a file that does not add up, no limits set) are read by both dashboards and the whole Trades tab is compared (the forms with their fields, placeholders and values; the notebook; the calculator), and the same trades typed into each dashboard leave the same lines in the file. The alerts are compared with a stand-in for the sound device and the popups that records what was played and shown: the same snapshots given to both, in each of the three modes, give the same line, the same list, the same count in the title, the same tones and the same popups.
- **What is different, on purpose.** (1) A second click on **Log trade** while the first is still out is ignored (it would have logged the trade twice). (2) Any click on the React page counts as you being back and clears the count in the title; the current page's script returns early for the buttons of the trades and of the alert mode, so a click on them does not. (3) A page that has lost its link shows no setup alert and no system alert on its line (as since 9.1: the stale notice is the alert), but still shows **your own loss limit** (a fact about your trades, not the market). (4) A write whose answer cannot be read is said, and the trades are read again. (5) A tab that fails to draw says so and keeps the header and the tabs, as for the others. (6) The page's title is `Prism`, not `Prism Market Data`. The how-to under the Overview, which described the 🔔 button and the notebook, is now true of this page.
- **How it was checked.** 783 component tests in all (`npm test`; about 230 of them for this stage: every alert rule and its flicker rule, the sound, the popup, the remembered mode, the connection telling the alerts, the notebook, the forms, the writes and their refusals, the calculator, the loss limit said once and again only after it was left), 39 in real Chrome (24 for the tab, 15 for the alerts), 2 Python tests that the fixtures are still the shape of what `/api/trades` and `/api/risk` send, and 276 deliberate rule-breaks against the new code: the first pass left 24 untested, 17 of them test gaps (now covered), 3 in code that proved redundant and was removed, and 4 that no test can reach (a pattern that can never match, a check the types already guarantee, and the reset key of the Trades tab's draw guard, which nothing outside the failed tab can change); one of the survivors led to a real fault, found and fixed: under React's strict mode (the development server only, never the built page) the first ask for the trades was aborted and the tab would have said it could not load them. **Mocked market only: it has not been looked at against a live session.**

**Stage 9.8: the cutover.** The React dashboard is now THE dashboard. It is served at **`/`**; `/app` and `/app/` go to `/` (a redirect, so a bookmark of `/app/#journal` still lands on it); its files are under `/app/assets`. The page it replaced, `app/static/index.html` (1,270 lines of HTML, CSS and script), is gone: it was unchanged from the last commit, so `git checkout HEAD -- app/static/index.html` brings it back. **Without a build there is no dashboard at all now**, so `/` says so: a 503 page with the commands (`cd frontend && npm ci && npm run build`) and where the data still is (`/api/state`), and the log says it too. The built dashboard is committed, so Prism starts with Python only, as before.

- **The large-screen zoom, and the fault it would have caused.** The page it replaced enlarged everything 1.1x from 1500x800 and 1.3x from 1700x940 (a CSS `zoom` on the page), so that a big screen has larger text and not empty space; the dashboard does the same now. A chart library does not expect a zoomed page, and this was measured, not assumed: in real Chrome, on the screen's own pixels, the crosshair was drawn at the zoom times the mouse's place (the mouse at x = 484 gave a crosshair at 627 at 1.3x; 403 gave 439 at 1.1x). The chart box therefore takes the page's zoom off itself (`zoom: calc(1 / var(--zoom))`) and is given it back in its height, and the crosshair is then where the mouse is, at 1.0x, 1.1x and 1.3x (a test; it fails with the fix taken out, which was tried).
- **What was retired, and what took its place.** 212 tests were about the page that is gone, and are gone with it: 187 in nine files (the node harness that ran its script: `test_alerts`, `test_trades_tab`, `test_dashboard_stage5`, `test_dashboard_stage54`, `test_dashboard_layout`, `test_options_tab_stage52`, `test_page_escaping`; and two real-browser files, `test_dashboard_stage54_browser` and `test_dashboard_layout_browser`), 24 that drew the Options tab from it under node, and the syntax check of its inline script (the dashboard is type-checked and built instead). What they held was carried over tab by tab as each stage was built, and each port was proven against that page while it existed (the alerts, the notebook and the rules of every tab are in the 787 component tests, which say so in their comments); it was not checked again test by test now that the page is gone, so this is the claim to doubt if something is found missing, and `git show HEAD:tests/<file>` has every retired test; the escaping of every string a server can send is now `escaping.test.tsx` (markup is put at the end of every string of every answer the page is given, and the page must hold no element, attribute or handler from it; it fails when a string is drawn as markup, which was tried); the readability checks of every state on every tab at both sizes, the degraded Overview with alerts, the stale page on every tab, the cold start and the colour contrast are `test_dashboard_browser.py` (17); the 24 Options tab cases of the real engine (every strategy on both sides, WAIT and NO TRADE, no suitable contract) are `test_options_tab_states_browser.py`, now on the dashboard that is served. The five tests that held a wording of the page (`not a recommendation`, the three clocks, the readiness stages, the units) now read the dashboard's own source.
- **The proof of parity is history.** Stages 9.2 to 9.7 each proved in real Chrome that the React tab says exactly what the page it replaced said (the same elements, classes, tooltips and text, in 14 pinned states, and after a real server was stopped). That was how the port was shown to lose nothing, and it is recorded in those sections; with the page gone there is nothing to compare with, so those tests now hold what the tabs must say (each state's decision, its contract, its journal, the header from the snapshot, the notebook, the calculator, the tones and the popups) and stay as the regression tests of the dashboard. The shared browser helpers are `tests/browser_support.py`.
- **How it was checked.** The whole suite: 2858 Python tests passed (6 skipped, as before), 144 of them in real Chrome, and 787 component tests (`npm test`) with the type-check and the build. Mocked market only: **the dashboard has not been looked at against a live session**.

**The chart in more detail (after the cutover).** Asked for: "more details from the graph". The Chart tab now says more about each candle, marks where Prism's decision changed, and explains what it draws. Everything is read-only and worked out from what Prism already sends; none of it is a signal.

- **The line under the legend** says what the candle under the mouse (the latest one when the mouse is away) says beyond its four prices: its **size** in points and in ATRs (`Size 8.00 pts (1.3x the ATR(14) of 6.1)`), how it **closed** (up or down, by how much), where it closed against **EMA 20 and EMA 50**, the **nearest level under it and over it** (the previous day's high, low and close, the session open, the support and the resistance, with how far each is), and what **Prism's decision said** on it.
- **Decisions on the chart.** A new box, **Decisions** (on by default), marks the candle where Prism's decision CHANGED: a green **BUY CE** arrow under it, a red **BUY PE** arrow over it, an amber dot for WAIT, a grey dot for NO TRADE. They come from today's journal, so the Chart tab now reads `GET /api/journal` once when it is opened (and again only when the decision or a setup event changes, like the Journal tab; the page still has exactly the same three places that ask the server for anything). Limits, said in the guide: **today only** (the journal is kept for one day at a time, so an earlier day, and the daily chart, have none), and a decision is marked only on a candle that is drawn (one that came in a candle that has not begun yet is marked once it has).
- **A guide, and tooltips.** "How to read this chart" (closed until opened) says what every line, arrow and number is, and that none of it tells you to buy or sell. Each number under the chart (Trend, ADX, RSI, ATR(14), EMA 20, EMA 50) says in plain words what it is when you hover it.
- **How it was checked.** 828 component tests in all (about 40 of them new: which candle a decision falls on, down to the second at a candle's edges and for an hour candle that begins at 09:15; the markers' colour, side, shape and order among the swings; every number of the line against the real chart answer; the guide; the tooltips; the journal read once and only when the Chart tab is open), 147 tests in real Chrome (3 new: the line follows the mouse across the real chart, the guide opens within the width, the decision markers appear on the canvas and go with their box), the whole suite (2861 passed, 6 skipped), and 74 deliberate rule-breaks against the new code: 6 were not caught at first and now are, 4 cannot differ in any state (a guard that the lookup already makes, a decision with no time, an unavailable journal's empty list). A small fault was found in passing: the heavy escaping test timed out when the whole suite ran at once, and now has the longer limit its siblings have. **Mocked market only: not looked at against a live session.**

**The pre-trade checklist (after the cutover).** Asked for: "build the checklist in the Overview tab" (after "for manual trading, what do we need to look at before taking a trade"). It is one line in the decision banner, beside *Explain this decision*: **Checklist 12 of 13 met ▾**. It opens over the page the same way (so it moves nothing, and the Overview still fits 1366x768 and 1920x1080), and only one of the two is open at a time. **It is a checklist, not a signal:** it never says "go", it counts and does not judge, and it says so in a note; Prism places no orders.

- **Left: thirteen questions Prism can answer, from its own fields (nothing is worked out from the market).** *The day and the data:* entries are allowed now (the session; a caution in the stricter midday window), the data is current and trusted (market open, feed connected, data and candles and clock trusted, NIFTY price fresh), volatility is not extreme, the market is not conflicting or unclear. *The setup:* a setup is live, the 1H and 15M do not run against its side, a completed 5M candle closed beyond the trigger, price is in the entry area and not past it ("do not chase"), nothing blocks entry, no caution argues against it (a caution, not a failure), the invalidation and a target are known (with the reward-to-risk **in index points, not premium**, and no threshold chosen for you), and Prism's own decision is a BUY for this setup. *The option:* a suitable contract is offered (only once Prism says BUY; a caution for a warning or an expiry day). Each answer is **met / caution / not met / not yet / unknown**, said as a word *and* an icon *and* a colour, with Prism's own words under it (the whole of it on hover). A question that needs a setup says "not yet" when there is none, never "met".
- **Right: five boxes only you can tick** (the option chain on your broker, delta / theta / IV of the contract, your stop premium and lot size, your daily loss limit and trade count, "planned, not FOMO or revenge"), with the Trades tab one click away for the last three. Ticks are kept **in the page, for the setup that is live**: another setup (or none) starts clean, a visit to the Options or Trades tab and back keeps them, and a reload clears them (nothing is stored in the browser: the one thing the page keeps there is still the alert mode).
- **A page that has lost its link answers nothing:** every row is *unknown*, the line says "not current", and nothing counts as met (your own ticks still work).
- **What it does not do:** it cannot see your broker, your account, the option chain or the Greeks (it says so), it does not know your stop, and it is not a measure of whether a trade will work: a page of green rows is not an instruction. Nothing was added that asks the server for anything.

**The how-to, in plain words.** "How to use this page" was nine dense blocks in two columns (1,969 characters, read across the columns in a confusing order, with terms like "eligible right now" and "blocking findings"). It is now seven numbered steps in one column and three short notes (1,177 characters, no step over 180), and a test holds that budget. Step 7 points at the checklist.

How it was checked: 914 component tests in all (86 new: every question of the checklist on the real snapshot and on a variant for each branch, down to which rule says first when several fail; the rows, the words, the boxes, the links and the stale page drawn; the boxes kept across tabs at the App; the how-to's words and length), 157 tests in real Chrome (10 new: **in each of the 14 pinned states every row is compared with the answer worked out a second time in Python from the rules written out again**, so the page is not checked against itself; it opens over the page without moving it and stays open as the page updates, closes the explanation and is closed by it, keeps the ticks across a visit to another tab and starts clean for another setup, fits 1366x768 and 1920x1080 with every row in view and no text under 10 px, and answers nothing on a page that lost its link), and 109 deliberate rule-breaks against the new code in two runs: three were not caught at first (a 15M trend that is unknown was only tested for the 1H and now both; the panel's heading was never asserted and now is; and a redundant condition on the option offer, which could not differ and was removed), and one pattern that missed its target was re-run and caught. Found along the way: the first floating version cut the panel off at 11 of its 13 rows on a 1366x768 screen (the decision and the option are the rows read last), because an older rule capped its height: it now shows all of them. **Mocked market only: it has not been looked at against a live session.**

**The chart, made easy to read (after the cutover).** Asked for: "from the chart the marking, I can't read it or it's not helpful ... so many lines and I can't track which line it denotes ... make it more user-friendly and easy to understand". What was wrong, on the real chart of 13 November: about 40 H / L swing arrows on by default, up to 12 horizontal lines that were nearly all dotted grey and named in codes (`R3 ×2`, `S1 ×7`), price-axis labels lying on top of one another (`PDH`, `R2` and `Open` sit within 40 points), and nothing that tied a colour to a meaning.

- **It begins simple.** The candles, the two averages, the **key levels** (yesterday's high, low and close, today's open, the nearest support at or under the price and the nearest resistance over it: six lines on that day instead of twelve), the setup's own lines while one is live, and where the decision changed. The swing arrows and every other support and resistance are **off to begin with** and one click away: **Simple** and **Everything** buttons switch the whole view, and each box can still be switched alone (then neither button is pressed).
- **Every line is named in words:** *Prev day high*, *Prev day low*, *Prev day close*, *Today's open*, *Support · 7 touches*, *Resistance · 2 touches* (the setup's lines are as before: *CE trigger*, *CE entry area*, *CE invalidation*, *CE target 1*). The line under the legend ("Nearest level under / over") uses the same names, and goes by every level, whatever the chart merges.
- **The colours mean something.** A support is a fainter green dashed line (a floor), a resistance a fainter red one (a ceiling), the previous day amber dotted, the open grey dotted. The line fades; **its label on the price axis does not**, so it can be read.
- **Levels that sit close together are drawn once**, within three quarters of a candle (the ATR; a twentieth of a per cent of the price when there is no ATR): the most important keeps the line (the previous high and low, then the close, then the open, then the key support and resistance, then the rest) and the others are named after it ("Prev day close + Today's open": the real session of 6 November opened exactly at the previous close). A setup's lines are never merged.
- **The boxes under the chart are the key.** Each has a small sample of its line's colour, dashes and fade next to its name, and says on hover, in plain words, what it puts on the chart. The chart keeps 14 bars of empty room on the right, so the labels never cover the latest candles. The guide ("How to read this chart") says all of it.
- **How it was checked.** 943 component tests in all (29 new: which levels are the key ones by the price, not by where the server listed them, down to a support exactly at the price and a gap exactly as wide as the rule; the names; the merge and its priority; the look of each line and its label; the boxes, the buttons and the samples), 159 tests in real Chrome (2 new: the simple view is the picture it is, **Everything** changes it and **Simple** brings the same picture back; and the sample next to each box is the colour, dash and fade the page's own CSS says), and 67 deliberate rule-breaks against the new code: three were not caught at first (a gap exactly as wide as the rule, an ATR of zero, and the **Simple** button's effect on the timeframe) and now are. Found along the way: the first opacity helper put a fully-opaque suffix on every line colour (`#5aa9ff` became `#5aa9ffff`: invisible, wrong, and caught by the tests). Looked at on the real chart of 13 November through the running application: the 40 arrows and six of the twelve lines are gone, and every label that is left says what it is. **Mocked market only for the tests; the real recorded data was looked at, a live session was not.**

**BUY CE / BUY PE are now said as setups (after the audit of 15 Nov 2026).** The replay in `docs/system-audit.md` found no measurable edge in those decisions, and "BUY CE" reads as an instruction. So the dashboard no longer says it. This is a
**display-layer change only**: the engine's values (`BUY CE`, `BUY PE`, `WAIT`, `NO TRADE`), the journal files already written, `session_check`, `outcomes`, the option selection and the trade log's "followed Prism" all still use them. The
words on the screen come from one place, `frontend/src/labels.ts`.

- **The badge** says **CE SETUP** / **PE SETUP** (WAIT and NO TRADE are as before), and the headline says "CE setup ready: Trend Pullback setup confirmed". The same words are used on every tab: the Options tab, the Journal, the Analysis tab, the chart's
  markers and its heading ("CE setup" / "PE setup" arrows), the alerts ("CE setup ready: ..."), the checklist ("Prism says this setup is ready") and the how-to.
- **A note beside the headline** of a ready setup (and only then; never on WAIT / NO TRADE, never on a stale page): **"rules met · not a recommendation · no measured edge"**. Its hover text says what it stands on: the 643 setups of the replay, about zero
  before costs and negative after, no better than random entries (audit of 15 Nov 2026).
- **What is not changed:** the Trades tab's own **BUY** and **SELL** are *your* order sides, not Prism's decision. The command-line reports (`python -m app.journal`, `session_check`, `outcomes`) still print `BUY CE` / `BUY PE`, because they read the journal's values.
- **How it was checked.** 962 component tests in all (19 new: the label layer, the banner's note in every state, a sweep of **all six tabs** for a CE and a PE setup that fails on any leftover "BUY CE" / "BUY PE", a source guard that forbids the
  words in any component), 162 tests in real Chrome (3 new: the note is drawn on the headline's own line; and no tab of the real page, for a CE and a PE setup, says BUY CE or BUY PE), and 33 deliberate rule-breaks against the change, all caught.
  **Mocked market only; not looked at against a live session.**

### The NIFTY futures probe (groundwork for VWAP strategies; Stage 2.4)

NIFTY spot has no volume, so a VWAP can only come from the futures contract. Before any futures feed, history, recovery or freshness path is built, `app/futures_probe.py` checks
the futures data that path would depend on, read-only (`getCandleData`, `getMarketData` and a WebSocket subscription to the one futures token and the spot index; no order,
position or account call, and it never prints or writes a credential). The criteria are written in the module before any data was looked at (14 requirements, R1-R14); each
comes out PASS, FAIL or NOT VERIFIED, and nothing is guessed.

```bash
python -m app.futures_probe                  # the last 3 finished sessions; with the exchange OPEN also a ~3 minute live listen, a reconnect and a comparison with the finished candles
python -m app.futures_probe --no-live        # history and quotes only
python -m app.futures_probe --merge logs/a.json logs/b.json   # no broker call: the verdict of an after-close run and an in-session run together
```

One run cannot verify everything: while the exchange is open its quote describes a running session (so R6 and R7 need a finished one), and while it is closed there is nothing live
to listen to (R10-R14). `--merge` combines the two: any FAIL wins, otherwise any PASS. The overall verdict is CONFIRMED only when every requirement passes. Merge runs of the
same version of the probe only: the superseded first run's file (below) still carries its measurement-error failures of R6-R8, and a FAIL always wins.

**What the first real runs found (Saturday 2026-11-07, the exchange closed; sessions 4, 5 and 6 November; contract NIFTY23NOV26FUT, token 61471, lot size 65):**

- **Historical futures candles are reliable.** 375 of 375 minutes with volume on every session, no invalid candles, the 1M candles equal the exchange's own 5M candles in all 75
  buckets (volume and price), and a second fetch of a finished session is identical. A VWAP from the 1M candles (typical price x volume) is within 0.009% of the exchange's own
  average traded price, and the candle volumes add up to the exchange's day volume within 0.27%.
- **Three units and windows that must be right.** The candle volume is in **lots**; the exchange's day volume, and the live feed's, are in **units** (lots x 65). The futures trade in a
  **closing session to about 15:40** that the candle API only returns if asked for (`todate` 15:45), and the exchange's totals include it (about 1.5-5% of a day's volume): the first run
  asked only to 15:30, and wrongly failed R6 and R7 because of it (and because it compared lots with units). Those two measurement errors, and R8's definition, were corrected in the probe
  and recorded in its docstring; the first run's findings file is kept as written (`logs/futures-probe-closed-2026-11-07.first-run.json`).
- **The spot history has a hole.** The spot index's 1M history lacks 15:15-15:28 on every day checked (361 of 375 minutes), even when asked until 16:30. It is outside the strategies'
  decision window (entries end at 14:45) but it is a property of the data source.
- **The basis is NOT stable at candle resolution (R9 FAILS, a real finding).** futures minus spot drifted from about 0 at 09:30 to about 72 at 15:00 on 6 November (a strong rally),
  ranged between 6 and 63 points on the other two days, and its minute-to-minute change has a 99th percentile of 11-15 points (limit 5). Translating a futures VWAP onto the spot price
  scale with a 10-minute median basis would be off by a median of 2.6-4.0 and a 99th percentile of 10.8-13.9 points, against the strategies' 6.25 point touch tolerance. Candle closes
  sample the two instruments at different instants, so this may overstate the tick-level noise: R14 measures that, live.
- **On a closed market the broker pushes one snapshot when the futures token is subscribed** (the closing price, the last exchange time, and the exchange's own day volume in units).
- **Not verified yet:** everything live, R10-R14 (volume that never goes down, exchange-timestamp freshness, per-minute volume against the finished candles, recovery after a
  disconnect, the tick-level basis). They need an exchange session. **Overall: NOT RELIABLE on the criteria as written (R9), and NOT CONFIRMED for the live part. No futures pipeline has been built.**

### Known limits

- **No profitability is claimed, and none was found.** The rules are initial assumptions that were never tuned. On 15 Nov 2026 the engine was replayed over 700 days of NIFTY candles (2024-01-01 to 2026-11-13): its 643 ready
  setups averaged about 0 R before costs and clearly less after them, no better than random entries with the same stop and target (details, method and limits in `docs/system-audit.md`; a second round of four simple
  rules also found no edge: `docs/research-round-1.md`). This is a decision-support tool for manual trading, and every decision is yours.
- **The reliability features are verified with fakes only.** The connection recovery, the per-instrument freshness, the clock and
  suspend guard, the rate-limit allowance, the spot-only recovery and the official-candle check have been exercised with mocks and a
  fake clock, never in a live market session. The numbers they use (a 10 s stall, 5 s clock jump, 60 s of calm, 60 s unhealthy,
  30 s option quote age) are initial assumptions, and the official-candle check's `sampling` differences are not yet calibrated.
  The Phase 4 option quotes (bid / ask / open interest, the SNAP_QUOTE subscription, the live re-centring of the strikes) were exercised with
  mocked Angel One messages only, never against the real feed: see the Phase 4 section for what has to be checked on a live day.
- **Stage 3 (regime facts, Trend Exhaustion Reversal) has been verified with hand-built candles and mocked data only.** Its thresholds (`rg_*`, `ter_*`) are initial assumptions;
  its permission waits for confirmed swings, so an early reversal is seen late; and VWAP strategies are still not implemented (see the futures probe).
- The 1H trend label comes from Phase 2 and turns slowly: after a decline the 1H can stay "bearish" (ADX high) for hours
  into a recovery, so the engine reads a V-shaped day as bearish, or as conflicting timeframes, until the 1H catches up.
- Thresholds are hard lines. A setup whose room to the next level is 1.00x the risk passes and one at 0.99x waits, and
  the ATR in them moves slightly from candle to candle, so a marginal setup can become CONFIRMED a few candles after its
  confirming candle completed (the event says when that candle completed). Once confirmed, a setup is frozen.
- Pullback zones are judged against the latest EMA values (Phase 2 keeps no EMA history), so a low that sat on an EMA
  when it printed can be a few points off it by the time the confirming candle closes; the 0.25x ATR15 tolerance and
  the EMA band absorb most of that, and a tracked setup keeps its low. A range edge is taken from the price for a
  setup that is not tracked yet, and kept for one that is.
- The lifecycle lives in memory and a restart resumes it from today's journal. Without that journal (the first start of
  the day, another `JOURNAL_DIR`, a lost file) setups are re-derived from the candles, and one that is still inside its
  four-candle entry window is announced as new; the same happens to a setup whose only announcement was in a record cut
  short by a crash. A structure that formed while the app was down is announced when it is next seen. One setup per
  strategy and side at a time.
- **Stage 8 was verified with fakes only.** The alerts, the Trades tab and the size calculator were exercised with the page's own script under node and with fake servers, never in a browser during a session; the rollover with fake sockets and a fake clock; the
  outcome review and the session check with hand-made records and candles. The real journals of 6, 10 and 11 November went through the session check; no real candles were available for the outcome replay.
- Weekend special sessions and exchange holidays are not known. A holiday has no candles and no ticks, and without a
  fresh tick nothing is ever actionable (the decision says there is no recent price tick).
