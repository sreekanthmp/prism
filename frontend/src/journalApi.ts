import type { JournalAnswer } from "./types";

/** What reads today's decision journal (a test hands in its own). */
export type JournalFetcher = (signal: AbortSignal) => Promise<JournalAnswer>;

const NO_ENDPOINT: JournalAnswer = {
  available: false,
  reason: "this Prism server has no journal endpoint yet (restart Prism to load the current version)",
  decisions: [],
  events: [],
  file: null,
  records: 0,
};

const isRow = (x: unknown): boolean => typeof x === "object" && x !== null && Array.isArray((x as { reasons?: unknown }).reasons) && Array.isArray((x as { against?: unknown }).against);

/**
 * The page's second request of its own, and it only READS: GET /api/journal, the file the journal already writes, condensed (it writes nothing). An older server that was started before the endpoint
 * existed answers {"detail": "Not Found"}: that is said, not shown as an empty journal. An answer that says it has a journal but is not shaped like one is an error: it is never drawn.
 */
export const fetchJournal: JournalFetcher = async (signal) => {
  const r = await fetch("/api/journal", { signal, cache: "no-store" });
  const answer: unknown = await r.json();
  const o = (typeof answer === "object" && answer !== null ? answer : {}) as Record<string, unknown>;
  if (!r.ok || typeof o.available !== "boolean") return NO_ENDPOINT;
  if (o.available && (!Array.isArray(o.decisions) || !o.decisions.every(isRow) || !Array.isArray(o.events))) throw new Error("Prism's journal answer is not what this page expects");
  return o as unknown as JournalAnswer;
};
