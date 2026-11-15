import type { TradeInput } from "./types";

/** What Prism answered: whether it was a success, the HTTP status, and the JSON body (null when it had none: the status says it). */
export interface Answer {
  ok: boolean;
  status: number;
  body: unknown;
}

/** What talks to the server about the trades you log (a test hands in its own). */
export interface TradesApi {
  summary: () => Promise<Answer>; // GET  /api/trades: today's trades, what is open, the result, the loss limit
  log: (trade: TradeInput) => Promise<Answer>; // POST /api/trades: a trade you made
  voidTrade: (id: string) => Promise<Answer>; // POST /api/trades/<id>/void: cancel one you logged by mistake
  risk: (query: string) => Promise<Answer>; // GET  /api/risk?...: how many lots keep the loss at your stop inside your limits
}

/**
 * The page's third place that makes requests, and the only one that writes. It writes a NOTEBOOK: the trades you typed in (and the voiding of one), kept in a file beside the journal. Prism places no
 * order and reads no account, here or anywhere. Only these four requests exist, to these four addresses; the server accepts the two writes from its own page on this computer and from nowhere else.
 */
async function send(method: "GET" | "POST", url: string, body?: unknown): Promise<Answer> {
  const r = await fetch(url, {
    method,
    ...(method === "GET" ? { cache: "no-store" as const } : {}),
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  let answer: unknown = null;
  try {
    answer = await r.json();
  } catch {
    /* no JSON: the status says it */
  }
  return { ok: r.ok, status: r.status, body: answer };
}

export const tradesApi: TradesApi = {
  summary: () => send("GET", "/api/trades"),
  log: (trade) => send("POST", "/api/trades", trade),
  voidTrade: (id) => send("POST", `/api/trades/${encodeURIComponent(id)}/void`),
  risk: (query) => send("GET", `/api/risk?${query}`),
};
