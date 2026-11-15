# Is Prism's output correct? An audit against real data and professional practice

Prepared 15 Nov 2026. **Nothing here was taken from the README or from memory.** I read the code, recomputed its maths independently, replayed its real decision engine over your own 2.9 years of NIFTY candles, and compared its design with current outside sources. Where a source is a secondary report or a model summary, I say so.

---

## 1. The short answer

| Question | Answer | How sure |
|---|---|---|
| Is the **arithmetic** right (EMA, RSI, ATR, ADX)? | **Yes.** Exact to 6 decimals against an independent implementation. | High |
| Does the **engine do what it claims**? | **Yes.** An offline replay reproduced your one real live setup (11 Nov) to the cent. | High (one case) |
| Is the **logic** a reasonable, conventional trading template? | **Yes.** It is a textbook price-action design (trend, pullback to value, confirmation candle, structural stop, target at the next level, room >= 1x risk). | High |
| Does its **BUY output have an edge**? | **No detectable edge.** 643 BUY decisions over 700 days average about **0 R before costs** (95% CI roughly -0.09 to +0.08 R) and clearly negative after realistic costs. Its timing is statistically indistinguishable from random entries. | **High for "no edge large enough to pay costs"; it cannot prove that no profitable variant exists** |
| Is it "false output"? | **No.** The output is internally correct and consistent. It is simply **not predictive**. That is a different problem from a bug. | |

**What this means for you:** do not spend weeks paper-trading Prism's BUY signals hoping they make money. The 643-trade history already answers that more precisely than 30 to 50 paper trades ever could (30 to 50 trades have a margin of error of about +-0.3 R per trade).

---

## 2. What I did (so you can check it)

1. **Data.** Read the whole NIFTY table from your database (read-only SELECT): 1 Jan 2024 to 13 Nov 2026, **706 trading days**, 262,204 one-minute candles. 628 days are complete 375-minute sessions; 6 special short sessions were skipped. The database's own 5-minute candles equal 5-minute candles built from the 1-minute ones in **all 47,300** comparable cases.
2. **Indicators.** Recomputed EMA 20/50, RSI 14, ATR 14, ADX 14 and +-DI with pandas (separate code, textbook formulas) over 183 real 500-candle windows. **Maximum difference 0.000002.**
3. **Replay.** Fed Prism's real engine (`analysis.analyze`, `trading.build_context`, `SetupBook.update`, `trading.present`) one evaluation at a time, using **only candles that had completed by that moment** (no look-ahead). A fresh setup book each day, as live. 1-hour candles built from 15-minute ones exactly as live.
4. **Fidelity check against the live engine.** Your live journal of 11 Nov has one real setup. The replay found the same one:

   | | Live journal | Offline replay |
   |---|---|---|
   | Setup | CE Trend Pullback, ready 12:55 | same, 12:55 |
   | Invalidation | 25262.52 | 25262.53 |
   | Target 1 | 25397.80 | 25397.80 |
   | Entry | 25306.15 (a tick) | 25305.15 (last 1-minute close) |
   | Ended by Prism | 13:10 | 13:10 |
   | Result | -0.60 R | -0.62 R |

5. **Trades.** A "trade" is the first moment the decision says BUY for a setup. Entry = the price then; stop = the setup's invalidation; target = its first target; a candle touching both counts as the stop. Results are in **R** (risk = entry to invalidation), **index points**, not option premium.
6. **Three exit models**, because 86% of trades "ended" by Prism's own lifecycle rather than by stop or target, and I did not want to be unfair to the system.
7. **Baselines and confidence intervals**: bootstrap intervals, and matched random entries on the same days with the same stop and target.
8. **Cadence check**: the replay evaluates every 5 minutes; a second run evaluating **every minute (as live)** on Jan to Sep 2026 gave the same answer.

---

## 3. The numbers

**Activity.** 51,800 evaluations. Decisions: WAIT 79.9%, NO TRADE 17.5%, BUY CE 1.5%, BUY PE 1.1%. 407 of 700 days had at least one BUY (about 215 BUY decisions a year).

**Edge, index points, no costs, 643 trades:**

| Exit model | Win rate | Average | 95% interval | Profit factor |
|---|---|---|---|---|
| A. Prism's own (out when it ends the setup) | 49% | **-0.029 R** | -0.07 to +0.01 | 0.87 |
| C. Out only if the setup is *invalidated* | 42% | +0.023 R | -0.06 to +0.10 | 1.06 |
| B. Bracket (stop = invalidation, target 1, else the close) | 49% | **-0.003 R** | -0.09 to +0.08 | 0.99 |

Bracket exits: stop 307 (48%), target 239 (37%), close 97 (15%). The biggest "ended" reasons were 193 failed follow-throughs and 129 entry windows that expired.

**After costs (bracket model):** 3 points -0.086 R; **5 points -0.141 R (interval -0.23 to -0.05)**; 8 points -0.224 R. The median trade risks 39 points, so 5 points is about 0.13 R.

**Where costs come from** (outside source, see section 6): about Rs 63 a round trip per lot at a Rs 100 premium, roughly 0.96 premium points per unit, which is about 2 index points at a delta of 0.5, **before** any slippage (not sourced; each Rs 1 per unit of adverse fill costs Rs 65 a side per lot). So 3 to 6 index points all-in is a fair range. Even the optimistic end of the interval (+0.08 R) does not cover the lower part of that range.

**Randomness test** (same day, same stop distance and target, a random 5-minute moment between 09:30 and 14:40):

| Baseline | Random | Prism | Difference | 95% interval |
|---|---|---|---|---|
| Random time, **random side** | +0.027 R | -0.003 R | -0.031 R | -0.11 to +0.05 |
| Same side, random moment **later** the same day | -0.037 R | -0.005 R | +0.031 R | -0.05 to +0.11 |

Prism's timing is statistically **indistinguishable from chance**. (I dropped a third baseline, "same side, random moment on the whole day", because the side Prism picks depends on how the day developed: entering earlier would get hindsight. It showed +0.16 R, which is that bias, not a real result.)

**Splits** (bracket model; none is significant except the call side being negative):

- **By side:** CE -0.114 R (n=348, interval -0.23 to -0.00); PE +0.127 R (n=295, interval -0.01 to +0.26). Probably the sample, not skill: NIFTY averaged **-5 points a day open to close** over these years, with 48% up days. The random-side baseline sits at +0.03 R.
- **By strategy** (n >= 20): breakout_retest -0.112 (120), failed_breakout +0.049 (280), opening_range_breakout -0.041 (59), trend_pullback -0.081 (100), volatility_expansion +0.108 (63). All intervals include zero.
- **By year:** 2024 -0.069, 2025 -0.032, 2026 +0.084; all intervals include zero.
- Longest losing streak (model A): 8 trades; maximum drawdown 28 R over 2.9 years.

---

## 4. Is the logic what professionals do?

I read `app/analysis.py`, `app/strategy.py`, `app/trading.py` (the actual rules). Professional-practice claims come from the research summary in section 6 and are weaker than the code reading.

| Element | What Prism does (from the code) | What professionals do (per sources) | Gap |
|---|---|---|---|
| Higher-timeframe bias | 1H and 15M trend from a score: EMA 20 vs 50 and close vs EMA 20, +DI vs -DI, swing structure (HH/HL, LH/LL), with ADX >= 20 | Higher-timeframe context is near-universal; the *tools* vary (structure, levels, volume/value area) | Reasonable, but lagging; the 1H label turns slowly |
| Key levels | Previous day high/low/close, swing-level clusters, opening range, session open | Prior-day levels, opening range, VWAP, volume profile (POC/VAH/VAL), round numbers | **No VWAP and no volume profile**: NIFTY spot has no volume (a futures probe exists, not wired in) |
| Volume / order-flow confirmation | None | Common for index futures traders | **The biggest structural gap** |
| Entry types | Pullback, breakout-retest, ORB, failed breakout, range bounce, momentum, volatility expansion, exhaustion reversal | The same families | Good coverage |
| Stop | Beyond structure with an ATR buffer; risk bounded in ATRs | Defined before entry, size from stop distance (near-universal) | Matches |
| Target | Next detected level; requires room >= 1x risk | Varies | Reasonable |
| Position size and loss limits | Calculator from *your* stop and limits; daily loss alert | Fixed small risk per trade, hard daily limit (near-universal) | Matches |
| Costs and option reality | Decisions in index points; no costs, no Greeks, no IV, no option chain | Option buyers face theta, IV changes and about 1% of premium round trip | **Missing** |
| Validation | Thresholds are "initial assumptions ... none tuned on data" (the code's own words); 86 parameters | Out-of-sample testing, few trials, data-snooping corrections | Never validated until today |
| Journaling | Strong (decision journal, trade log, outcome tool) | Near-universal | Matches |

**In plain words:** the *structure* of the thinking is professional. What is missing are the **inputs that professionals actually pay for** (volume, value area, order flow) and any **model of option costs**. Rules built on price alone, on an index with no volume, have a well-known problem: there is little information in them that the market has not already priced.

---

## 5. What published evidence says (current outside sources)

Reliability: SEBI primary reports are the strongest; the rest are working papers, blogs or summaries, as flagged.

- **Retail F&O losses (SEBI, FY26):** about **87.7% of individual traders lost money** (82.1% before costs); aggregate loss about Rs 91,685 crore; options caused about 92% of losses. Corroborated by several press reports of the SEBI study.
- **Option buyers (SEBI sample study; read from the PDF by the research agent, **not** independently confirmed by me):** among "only options buyers" (93% of a 5,050-trader sample) about 90% lost money; median return on peak margin about -114%. Experience did not help: the share of losers rose from 91% in the first year to over 95% after four or more years.
- **Costs (SEBI):** 35% of loss-makers' gross losses and 21% of profit-makers' gross profits.
- **Opening-range breakout:** one working paper on US QQQ reports strong results with **zero slippage**; an independent 2026 practitioner replication on index CFDs found gross edge but, **after spreads and slippage, results from +0.002 R down to -0.081 R, "no market distinguishable from zero"**. No NIFTY test found.
- **Intraday momentum (first half hour predicts the last):** the best-evidenced pattern, on the S&P 500 and futures in peer-reviewed papers; one study finds the overnight version fails out of sample. No NIFTY study found.
- **EMA / moving-average rules:** peer-reviewed tests find most apparent profits disappear after data-snooping corrections or small costs. **RSI rules on the Sensex (2000 to 2018): unprofitable even before costs.** No rigorous test of intraday EMA-pullback rules found.
- **Support / resistance:** levels do coincide with order-book depth, which fits an efficient market better than a profit edge.
- **Validation standard:** with about 5 years of data, **no more than about 45 independent rule variants** should be tried, or a worthless rule can look good (Bailey et al., primary PDF verified by the agent). You have 2.9 years, so fewer. The research agent's own arithmetic (assuming about 1 R of spread per trade, not a sourced figure): to show a 0.1 R edge at "3 sigma" needs about 900 trades.
- **Do professionals buy options intraday?** Indirect evidence only: proprietary traders earned about 98% of their gross profit from options but are mainly liquidity providers; SEBI also reports 99% of proprietary and foreign-investor gross profit came from algorithm users. Delta-hedged option buying has negative average returns in US studies (a variance risk premium).

**Not found anywhere:** a Nifty-specific, after-cost, out-of-sample test of any of the chart-based methods. So Prism is not "wrong"; it is **unproven, and the usual evidence is against simple price-only rules**.

---

## 6. Honest limits of this audit

- **Index points, not option premium.** Real option P&L adds time decay, IV changes, bid-ask and charges. For a buyer these are generally adverse; gamma can help on big moves. Not modelled.
- **Default parameters only.** Other settings might perform better in-sample. That would need walk-forward testing, and with 86 parameters the risk of fooling yourself is high.
- **Entry timing.** The replay uses the last 1-minute close, not a tick. The 1-minute-cadence run (as live) gave the same answer.
- **One regime.** 2.9 years; NIFTY's average intraday drift was slightly negative.
- **Fidelity is proven for one setup** (the whole replay matches Prism's own logic, but I only have one real live setup to compare).
- **Research summaries** come from a research agent reading web sources; I checked the headline SEBI figure myself. Lot size 65 and Tuesday weekly expiry are from secondary reports; confirm on nseindia.com.
- **It cannot prove a negative.** The interval says any edge is probably smaller than about +0.08 R before costs.

---

## 7. What to do now

1. **Stop treating BUY CE / BUY PE as a trading signal.** The data do not support it. Treat the tool as a **context and discipline panel** (trend alignment, levels, volatility, risk size, journal).
2. **Before building or paper-trading anything new, test it on history first.** The replay harness above takes about 8 minutes for 700 days. A new idea should have a written rule, a small number of variants, an in-sample / out-of-sample split and a cost estimate *before* any screen is built. This is the step that would have saved your first four systems.
3. **If you still want to learn manual trading with Prism,** see the learning path in the chat answer. Practising on history is much faster than waiting for live days.
4. **Candidate ideas that are cheap to test** (hypotheses, not claims): the first-half-hour to last-half-hour momentum effect on NIFTY; a plain opening-range breakout with a sound exit; "stand aside" filters (when not to trade). Each needs the validation protocol above.

*I am not a licensed adviser. Nothing here is personal financial advice; the numbers describe a rule set's historical behaviour on index candles.*
