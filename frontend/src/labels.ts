// How the dashboard SAYS what the engine's action values are: one place, so every tab says it the same way.
//
// The engine's VALUES (BUY CE, BUY PE, WAIT, NO TRADE) stay exactly as they are: the journal, the outcome and session-check tools, the options selection and the Trades tab all read them, and
// the journals already written hold them. Only the WORDS on the screen change. "BUY CE" reads as an instruction; what the engine actually means is "a setup was confirmed by a completed 5M
// candle, its price is in the entry area and nothing blocks it": the rules were met. And a replay of this engine over 700 days of NIFTY candles (docs/system-audit.md, 15 Nov 2026) found no
// edge in those setups, so the screen must not read as advice.
//
// (The Trades tab's own BUY and SELL are your order sides, not Prism's decision: they are never changed.)

const ACTION_WORD: Record<string, string> = { "BUY CE": "CE SETUP", "BUY PE": "PE SETUP" };

/** Does this action mean "the rules were met for a setup" (the engine's BUY CE / BUY PE)? */
export const isSetupAction = (action: string | null | undefined): boolean => /^BUY (CE|PE)$/.test(action ?? "");

/** The action as the badge, the journal and the tables say it: CE SETUP, PE SETUP, WAIT, NO TRADE (a dash for none). */
export const actionWord = (action: string | null | undefined): string => (action ? (ACTION_WORD[action] ?? action) : "–");

/** A sentence the engine wrote, with its "BUY CE" / "BUY PE" said the way the dashboard says it: "CE setup ready". */
export const plain = (text: string): string => text.replace(/\bBUY (CE|PE)\b/g, "$1 setup ready");

/** An action inside a sentence: "CE setup ready", "WAIT". */
export const actionSaid = (action: string | null | undefined): string => (action ? plain(action) : "–");

/** The line beside a ready setup's headline, and what it stands on (its hover text). */
export const NOTE = "rules met · not a recommendation · no measured edge";
export const NOTE_WHY =
  "Prism's rules were met for this setup. That is not a recommendation to trade. In a replay of this engine over 700 days of NIFTY candles (643 such setups; audit of 15 Nov 2026) the average result was about zero before costs and negative after them, no better than random entries (docs/system-audit.md).";
