# Paper trading with Prism: a guide for Monday 16 Nov 2026 and after

Prism describes the NIFTY index and **places no orders**. A "paper trade" here means: you decide, you write the pretend trade into the **Trades** tab at the prices you see, and you review it afterwards. Nothing is sent to your broker.

> **Read this first (added after the audit of 15 Nov 2026).** This guide was written before the system was tested on history. The test ([system-audit.md](system-audit.md)) found **no measurable edge** in Prism's BUY decisions: about 0 R before costs, negative after, no better than random entries. So use this guide to practise **process** (reading context, sizing risk, keeping a journal), **not** to expect the signals to make money.
>
> **Wording:** the dashboard no longer calls those decisions "BUY CE / BUY PE". It says **CE SETUP / PE SETUP** ("rules met, not a recommendation, no measured edge"). The engine, the journal files and the review commands still use the old values `BUY CE` / `BUY PE`; wherever this guide says "BUY" about Prism's decision, read "a ready setup". (The Trades tab's own BUY and SELL are your order sides and are unchanged.)

How to read this guide: **[V]** = I checked it in the code, the README, your real journals or your database. **[S]** = my own suggestion (a habit, not a Prism feature). **[?]** = Prism has never been seen doing this live.

---

## 0. What I found, and what it means for tomorrow

1. **[V] Prism has never been run through a market opening.** Every recorded session was started late: 10:42 (6 Nov), 11:47 (10 Nov), 11:09 (11 Nov), 13:13 (12 Nov), 13:29 (13 Nov). The 09:15–09:30 behaviour (it must say WAIT, never BUY) has not been seen live. Tomorrow is the first full day.
2. **[V] Angel One refused Prism's history requests on almost every recorded day.** The journals of the five sessions hold 78, 57, **577**, 91 and 16 records that mention the refusal ("Access denied because of exceeding access rate"). Candles were missing, so Prism correctly said **NO TRADE** ("the market data is not reliable enough"): on four of the five days the data was trusted for only 2% to 66% of the session records (6, 10, 12 and 13 Nov; 11 Nov was fine).
3. **[V] Your database is two trading days behind.** Its latest day is **Wed 11 Nov**; **Thu 12 and Fri 13 Nov are missing**. (10 Nov was an exchange holiday per the sources below, so that gap is expected.) Prism fills holes from Angel One at start-up, which is exactly what got refused on the late-start days. With a current database, today's start-up took **9 seconds** (15:28:48 to READY at 15:28:57 in `logs/app.log`).
4. **[V] Signals are rare.** In 8 journals only **one** setup ever reached READY_TO_ACT (a Trend Pullback CE on 11 Nov; it ended at -0.60 R in index points). Expect long stretches of WAIT and NO TRADE. That is normal, and it is what a strict rule set does.
5. **[?] Alerts, the Trades tab, the size calculator, the checklist and the simplified chart were tested with fakes and a mocked market only.** Tomorrow is their first live day. If something looks wrong, trust your broker's chart and tell me.

**The goal of the first sessions is to learn whether Prism is right, not to make money.** Prism's own README says to judge it on whether each decision was *explainable and matched the chart*, not on profit.

---

## 1. Tonight (Sunday), about 15 minutes

### 1.1 Fill the two missing days in the database
Run this yourself from `C:\sreekanth\Prism` (it **writes** to the database, so it needs a role that can insert; Prism's own role is read-only, on purpose):

```
python angelone\daily_update.py --start 2026-11-12 --end 2026-11-13
```

- **[V]** It downloads 1-minute, 5-minute, 15-minute and daily NIFTY candles for that range and inserts them. It is safe to run again (`ON CONFLICT DO NOTHING`).
- **[V]** It reads the Angel One login from `config.json` and the database login from `.env` (`PG_PASSWORD`). I did not open either file.
- **[V]** With no dates it fetches **yesterday**. Remember that when you run it later: after Monday's close, use `--start 2026-11-16 --end 2026-11-16` (or run it Tuesday morning with no dates).
- Tell me when it is done and I will count the candles per day again, read-only.

### 1.2 Set your paper-risk limits
In the git-ignored `.env` (names from `.env.example` **[V]**; the numbers below are only the template's examples, choose your own):

```
RISK_CAPITAL=200000
RISK_PER_TRADE_PCT=1
RISK_MAX_DAILY_LOSS=5000
```

Without them the size calculator only shows the loss per lot **[V]**. Restart Prism after changing `.env`.

### 1.3 Stop the copy that is running now, and start fresh tomorrow
**[S]** Prism chooses the day's option contracts when a connection is made, and the overnight roll-over has only been tested with fakes **[V]**. A clean start at about 08:45 is safer than leaving today's copy running. Stop it with Ctrl+C in its window.

### 1.4 Write your rules down before the market opens **[S]**
For example: only NIFTY option **buys** (CE or PE); only when Prism says BUY and the checklist has no "not met" you cannot explain; **1 lot** only; at most 2 trades a day; stop when the day's paper loss reaches your limit; exit rules (below); no trades you cannot explain in one sentence.

### 1.5 Check the date
**[V from web sources, verify on NSE]** Monday 16 Nov is not listed as an exchange holiday. The next listed one is **Tue 24 Nov** (Guru Nanak Jayanti). Prism itself does not know holidays (README "Known limits"). If there are no ticks, Prism says there is no recent price tick and nothing is ever actionable.

---

## 2. Monday, hour by hour (all times IST)

**[V] Session rules in Prism:** no entries before **09:30**; stricter confirmation **12:00 to 13:30**; no new entries from **14:45**; closed from **15:30**.

| Time | What to do | What you should see |
|---|---|---|
| **08:45** | Start Prism: `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`. Open http://127.0.0.1:8000/ . Open Angel One's own chart beside it. | In `logs/app.log`: `startup 1/4` to `4/4`, then `readiness: ... -> READY`. Header: **READY FOR OPEN**, **FEED CONNECTED**. Decision: `NO TRADE: before the market opens`. If you see `NOT READY`, read the banner; do not restart to "fix" it (README). |
| **Before 09:15** | Click once anywhere on the page (the browser needs it before it allows sound). Choose 🔔 `sound + popup` and allow notifications. | The 🔔 button shows your choice. |
| **09:15 to 09:30** | Watch only. Compare the price with your broker. | Decision `WAIT: opening range forming`, **never a BUY** (README runbook step 2). A BUY here would be a bug: tell me. |
| **09:30 to 14:45** | The loop in section 3. Keep the Overview open. | Mostly WAIT / NO TRADE, with the reason written beside it. |
| **12:00 to 13:30** | Be stricter yourself too. | A "stricter confirmation" note (README runbook step 4). |
| **14:45** | No new trades. Manage what is open. | `NO TRADE: late session`. |
| **By ~15:15** [S] | Have every paper position closed in the Trades tab. | Nothing open. |
| **After 15:30** | Section 5. | |

**Do not restart Prism during the day [V].** The README says a restart costs a start-up and some recovery and is never needed to "fix" a loading message; and a restart's recovery requests are the kind Angel One refused on the recorded days.

---

## 3. The loop when something appears

1. **Be told, do not stare.** A setup turning **READY_TO_ACT** raises the loud alert (four tones, a popup that stays, a line under the tabs) **[V]**. A flickering entry area is announced once, not twenty times.
2. **Open the Overview's Checklist** (next to "Explain this decision"). **[V]** It answers 13 questions from Prism's own data and has 5 boxes for what only you can check. It never says "go". Work through it:
   - **Not met / unknown** on the data, the session, "nothing blocks entry" or "price is in the entry area": **do not trade**.
   - **A caution** (for example "15M RSI 73.9: momentum is already stretched"): read it, decide, and write it in your note.
3. **Open the Chart tab.** Simple view: the candles, the averages, the key levels, the setup's lines (trigger, entry area, invalidation, target) and where Prism's decision changed. Hover the line under the legend for the nearest level above and below.
4. **Open the Options tab.** Only for a BUY **[V]**. The contract should be **FRESH** with a tight spread; "No suitable contract" means no option trade. The card shows the symbol, bid x quantity, ask x quantity and "1 lot = N units".
5. **Tick the 5 manual boxes** only when you really did them: the option chain on your broker, delta/theta/IV, your stop premium and lot size, your daily loss limit, "planned, not FOMO". Prism cannot see these **[V]**.
6. **Size it.** Trades tab, "Size a trade": entry premium, **your** stop premium, lot size. It tells you how many lots keep the loss at your stop inside your limits **[V]**. It ignores slippage, a gap through the stop, brokerage and tax, so the real loss is higher.
7. **Log it** (section 4).

**Exits [S]:** Prism does not manage a position. Decide before entering: (a) the **invalidation** (the setup is over if the index closes beyond it; Prism shows the level), (b) **target 1** (the index level Prism names, with its reward-to-risk in index points), (c) a **time exit** (for example by 15:15). Prism will also warn you when a setup that was ready ends or is blocked **[V]**.

---

## 4. How to log a paper trade (the Trades tab)

All of this is from the form and `app/trades.py` **[V]**.

| Field | What to type |
|---|---|
| Instrument | The **symbol exactly as the Options tab shows it** (free text up to 60 characters; the BUY and the SELL are matched ignoring case and spaces, so type the same thing both times). |
| Side | BUY (your entry) or SELL (your exit). Long option trades only: a SELL needs an open quantity. |
| Qty | **Units, a whole number** = lots x the lot size on the Options card. Not lots. |
| Price | The **option premium**. [S] For honest paper fills use the **ask** for a BUY and the **bid** for a SELL, because Prism adds no slippage. |
| Setup id | Press **Use Prism's setup** to fill it. A BUY also keeps what Prism's decision said at that moment, and the tab says whether you followed it. |
| Note | One line: why you took it. |

- A wrong entry is **voided**, never edited (the file is only added to). A void that would leave a later sell with nothing to sell is refused.
- The result is **first-in-first-out arithmetic on the prices you typed**, with no brokerage, tax or slippage; it is not an account statement.
- Reaching your day's loss limit shows a red alert on every tab **[V]**.
- Files: `logs/decisions-<date>.jsonl` (what Prism said) and `logs/trades-<date>.jsonl` (what you logged) **[V]**.

---

## 5. After the close: your review routine

Run these from `C:\sreekanth\Prism` (replace the date). I ran the first two on your real 13 Nov journal and they work **[V]**:

```
python -m app.session_check logs/decisions-2026-11-16.jsonl
python -m app.journal logs/decisions-2026-11-16.jsonl --detail
python angelone\daily_update.py --start 2026-11-16 --end 2026-11-16
python -m app.outcomes logs/decisions-2026-11-16.jsonl
python -m app.outcomes logs/decisions-2026-11-16.jsonl --blocked
```

1. `session_check` tests every BUY against the rules and prints the manual list it cannot do (chart comparison, "do you agree"). "PASS" means no counter-example, not that the decisions were good.
2. `journal --detail` is the day's decisions with reasons. For each, write whether you agree.
3. Update the database, then `outcomes` replays each ready setup on the 1-minute candles: **in index points (R), not option profit**. Without the day's candles in the database it says so.
4. `--blocked` shows near misses, the setups held back by a rule, so you can see whether the rules are too strict. A handful of days says little.
5. Weekly: `python -m app.session_check "logs/decisions-*.jsonl" --coverage` shows which kinds of day (gap up, gap down, trending, range-bound, volatile) have been checked **[documented, not run by me]**.

**After 30 to 50 paper trades** (and many days of kinds), look at: win rate, average reward-to-risk, expectancy, biggest losing streak, and how many trades you took that Prism did not say BUY for. Do not trust a few sessions.

---

## 6. If something looks wrong

| You see | Meaning and action |
|---|---|
| `NOT READY` banner / `DEGRADED` | Prism is recovering. The decision stays NO TRADE. Do not restart; read the banner for why, and the Analysis tab's data-health section for the missing candles and the next retry. |
| `NO TRADE: the market data is not reliable enough` for a long time | Candles are missing, often because Angel One refused history requests. Safe, but you get no signals. Tell me, with the time. |
| **STALE** banner, `UNKNOWN` chips | The page lost its link to Prism. Nothing on it is current. |
| A BUY before 09:30 or after 14:45, or a BUY while the header is not green | A bug. Do not trade; note the time; tell me. |
| A price that disagrees with your broker's chart by more than a few points | Trust the broker; tell me. |
| No sound | Click the page once; check the 🔔 mode and the browser's permission. |

---

## What I checked, and how

- **Rules and times:** `README.md` (Start-up; Decision and session; Validating during market hours; Stage 8; Known limits) and `app/strategy.py` (09:15 / 09:30 / 12:00 / 13:30 / 14:45 / 15:30).
- **The daily update:** read `angelone/daily_update.py` in full (it inserts four timeframes, skips duplicates, defaults to yesterday).
- **The Trades tab and the calculator:** `frontend/src/components/Trades.tsx`, `app/trades.py`, `app/risk.py`; the contract card in `Options.tsx`.
- **Your real data:** the `logs/decisions-*.jsonl` journals (start times, refusals, trusted-data share) and `logs/app.log` (today's start-up); the database, counted through Prism's own read-only loader.
- **The commands:** I ran `session_check`, `journal` and `outcomes` on your real journals.
- **Holidays:** web sources (not the project): [Choice India](https://choiceindia.com/nse-holidays), [Angel One](https://www.angelone.in/nse-holidays), [ClearTax](https://cleartax.in/s/nse-holidays-2026). Most agree on 10 Nov and 24 Nov; one lists a different date. Verify on NSE's own circular.

I am not a licensed adviser. Prism's decisions are what its rules say about the index, not a recommendation, and nothing here is personal financial advice.
