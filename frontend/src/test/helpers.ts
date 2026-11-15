import chartFixture from "./fixtures/chart.json";
import journalFixture from "./fixtures/journal.json";
import riskFixture from "./fixtures/risk.json";
import fixture from "./fixtures/snapshot.json";
import tradesFixture from "./fixtures/trades.json";
import { vi, type Mock } from "vitest";
import type { ChartData } from "../chartTypes";
import type { Answer, TradesApi } from "../tradesApi";
import type { JournalAnswer, RiskAnswer, TradeRow, TradesAvailable } from "../types";
import type { SocketFactory, SocketLike } from "../useConnection";
import type { Snapshot } from "../types";

/** The engine's own snapshot (tests/make_frontend_fixture.py): a real BUY CE world, 06 Nov 2026 10:55:06 IST, market open, system ready. Assigning it to `Snapshot` is itself a check: the types match the real payload. */
export const base: Snapshot = fixture;

/** A copy of the real snapshot with some of it changed. */
export function variant(change: (s: Snapshot) => void): Snapshot {
  const s = structuredClone(base);
  change(s);
  return s;
}

/** A WebSocket that does what the test says. Every socket the page opens is kept in `FakeSocket.all`, newest last. */
export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  static reset() {
    FakeSocket.all = [];
  }
  static get last(): FakeSocket {
    const s = FakeSocket.all[FakeSocket.all.length - 1];
    if (!s) throw new Error("no socket has been opened");
    return s;
  }
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
  }
  /** The server sends a snapshot (or any text). */
  send(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  /** The server (or the network) closes the connection. */
  drop() {
    this.onclose?.({});
  }
}
export const fakeFactory: SocketFactory = (url) => new FakeSocket(url);

export const EVIL = '<img src=x onerror="alert(1)">';

/** The engine's own answer to GET /api/chart?timeframe=5m (tests/make_frontend_fixture.py): 60 5M candles up to 10:50 on 06 Nov 2026, the BUY CE setup live, nothing forming. */
export const chartBase: ChartData = chartFixture;

/** A copy of the real chart answer with some of it changed. */
export function chartVariant(change: (c: ChartData) => void): ChartData {
  const c = structuredClone(chartBase);
  change(c);
  return c;
}

/** The engine's own answer to GET /api/journal (tests/make_frontend_fixture.py): today's journal of the BUY CE world, 06 Nov 2026: three decisions (WAIT at 10:40, WAIT at 10:45, BUY CE at 10:55) and the three events of one Trend Pullback setup. */
export const journalBase: JournalAnswer = journalFixture;

/** A copy of the real journal answer with some of it changed. */
export function journalVariant(change: (j: JournalAnswer) => void): JournalAnswer {
  const j = structuredClone(journalBase);
  change(j);
  return j;
}

/** The engine's own answer to GET /api/trades (tests/make_frontend_fixture.py): three trades of 06 Nov 2026 (a BUY of 150 that followed Prism's BUY CE, a BUY of 75 made while Prism said WAIT, a SELL of 100 at 120), 125 units still open, Rs 1,950 realised, a loss limit of Rs 5,000 not yet near. */
export const tradesBase: TradesAvailable = { ...tradesFixture, available: true };

/** A copy of the real trades answer with some of it changed. */
export function tradesVariant(change: (t: TradesAvailable) => void): TradesAvailable {
  const t = structuredClone(tradesBase);
  change(t);
  return t;
}

/** One trade as the server sends it, with these fields changed. */
export const aTrade = (over: Partial<TradeRow> = {}): TradeRow => ({ ...structuredClone(tradesBase.trades[0] as TradeRow), ...over });

/** A day that has reached its loss limit: Rs 5,200 lost of Rs 5,000. */
export const limitReached = (): TradesAvailable => tradesVariant((t) => { t.realised = -5200; t.lost_today = 5200; t.daily_loss_reached = true; t.daily_loss_used_pct = 104; });

/** The engine's own answer to GET /api/risk?entry=100&stop=80&lot=75 against Rs 1,00,000 capital, 2 % a trade and Rs 5,000 a day. */
export const riskBase: RiskAnswer = riskFixture;

export const ok = (body: unknown): Answer => ({ ok: true, status: 200, body });
export const refused = (status: number, body: unknown): Answer => ({ ok: false, status, body });

type Mocked = { [K in keyof TradesApi]: Mock<TradesApi[K]> };

/** What talks to the server about the trades, as a test says it should: by default the real answers above. Every call is recorded (the mocks). */
export function fakeApi(over: { [K in keyof TradesApi]?: Mock<TradesApi[K]> | TradesApi[K] } = {}): Mocked {
  const mocks: Mocked = {
    summary: vi.fn<TradesApi["summary"]>(async () => ok(tradesBase)),
    log: vi.fn<TradesApi["log"]>(async () => ok({ ok: true, trade: aTrade(), summary: tradesBase })),
    voidTrade: vi.fn<TradesApi["voidTrade"]>(async () => ok({ ok: true, summary: tradesBase })),
    risk: vi.fn<TradesApi["risk"]>(async () => ok(riskBase)),
  };
  return { ...mocks, ...(over as Partial<Mocked>) };
}
