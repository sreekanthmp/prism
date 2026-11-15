# Research round 1: can any simple, well-evidenced NIFTY rule beat costs?

**Written BEFORE any result was looked at (15 Nov 2026).** The rules below are fixed. Nothing may be changed after seeing numbers, because that is how people fool themselves (data snooping).

## Why these four
They are the simplest forms of the ideas with the best published evidence (US index products; none was found tested on NIFTY after costs). Each has **no tunable parameter** beyond what is written here.

| # | Idea | Exact rule (one trade per day at most) |
|---|---|---|
| H1 | **Intraday momentum** (first half hour predicts the last) | Signal = direction of the move from the 09:15 open to the close of the 09:44 candle (flat = no trade). Enter at the close of the 14:59 candle in that direction; exit at the close of the last candle of the day. Only days whose last candle is at or after 15:28. |
| H2 | **Plain opening-range breakout** | Range = high/low of the 09:15 to 09:29 candles. The first completed 5-minute candle starting 09:30 to 12:55 that closes beyond the range is the signal: enter at its close in that direction. Stop = the opposite side of the range (a candle touching it stops the trade; stop counted at the level). Otherwise exit at the 15:14 close. |
| H3 | **Gap and go** (the gap fade is the same test with the sign flipped) | Gap = the 09:15 open minus the previous day's close (from the daily table). If the gap is at least 0.30% either way, enter at the close of the 09:19 candle in the gap's direction; exit at the 15:14 close. |
| H4 | **Previous-day-high / low breakout** | The first completed 5-minute candle starting 09:30 to 12:55 that closes above the previous day's high (long) or below its low (short) is the signal: enter at its close; exit at the 15:14 close. No stop. |

## How they will be judged
- **Data:** your NIFTY 1-minute candles, 1 Jan 2024 to 13 Nov 2026. Index points, one lot-independent number per trade.
- **Two periods, fixed now:** **development = 1 Jan 2024 to 30 Jun 2025**; **validation = 1 Jul 2025 to 13 Nov 2026**. I look at validation **once**, after development is final.
- **Costs:** a round trip is **5 index points** (about 2 points of statutory charges and brokerage plus about 3 of slippage; the 3 and 8 point cases are also shown).
- **To count as a candidate edge** a rule must have **all** of: (a) a net-of-cost average above zero in development with a t-statistic of at least **3.0** (the standard for four looks at one dataset); (b) a net-of-cost average above zero in validation too; (c) the same direction of effect in both. Anything else is reported as **no edge found**, and that is a perfectly good result.
- **Trials:** exactly these four rules, nothing else. If none passes, I will not invent a fifth.

## Results (run once, rules unchanged)

Average result per trade in **index points**; "net" = gross minus a 5-point round-trip cost; t = the t-statistic of the net average.

**Development, 1 Jan 2024 to 30 Jun 2025 (363 days):**

| Rule | Trades | Gross avg | Net avg | t (net) | Verdict (needs t >= 3.0) |
|---|---|---|---|---|---|
| H1 intraday momentum | 363 | +0.75 | -4.25 | -1.97 | fails |
| H2 opening-range breakout | 351 | +12.21 | +7.21 | +1.10 | fails (noise) |
| H3 gap and go | 146 | +6.99 | +1.99 | +0.13 | fails |
| H4 prior-day high/low breakout | 269 | +6.60 | +1.60 | +0.17 | fails |

**Validation, 1 Jul 2025 to 13 Nov 2026 (337 days), looked at once:**

| Rule | Trades | Gross avg | Net avg | t (net) |
|---|---|---|---|---|
| H1 intraday momentum | 337 | +1.00 | -4.00 | -1.59 |
| H2 opening-range breakout | 319 | **-0.89** | -5.89 | -0.96 |
| H3 gap and go | 125 | **-5.76** | -10.76 | -0.81 |
| H4 prior-day high/low breakout | 262 | +0.34 | -4.66 | -0.62 |

Context: buying NIFTY at 09:19 and selling at 15:14 every day averaged -1.6 points a day in the development period and -6.1 in validation, against a typical day's range of about 232 points.

## What this says
1. **No rule passes.** None reaches t = 3.0 in development, and none is positive net of cost in validation, at 3, 5 or 8 points of cost. **Round 1 found no edge.** That is a real result.
2. **The "winners" in development did not hold up.** The opening-range breakout (+12 points gross) and the gap rule (+7) changed sign in validation. This is what chance looks like, and it is exactly what happens when a rule is tuned on the period it is judged on. The pre-registration is what stopped a false edge from being declared.
3. **Intraday momentum (H1) is the only rule whose sign held**: about +0.75 and +1.00 points gross in the two periods, in the direction the published US evidence predicts. But it is about **1 point against a 5-point cost**. The effect may exist; it is far too small to trade as an index-options buyer.
4. **Prices of this index, on their own, seem to carry almost no tradable information at this horizon.** That agrees with the engine audit (docs/system-audit.md): Prism's BUY decisions behaved like random entries.

## Limits
Four rules, one instrument, 2.9 years, index points, default cost assumption. This does not prove that no profitable rule exists; it shows these four simple ones are not it.
