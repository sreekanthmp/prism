import type { ReactNode } from "react";
import { MODE_TITLE, type AlertMode } from "../alertEvents";
import type { Conn } from "../connection";
import { age, fmtD, fmtT, n2, words } from "../format";
import type { Health, HealthInstrument, InstrumentRow, MarketChange, Snapshot } from "../types";

type Kind = "ok" | "bad" | "warn" | "neu";
const Chip = ({ id, kind, title, children }: { id: string; kind: Kind; title?: string; children: ReactNode }) => (
  <span id={id} className={`chip ${kind}`} title={title ?? ""}>
    {children}
  </span>
);

/** The move from the previous close: worked out by the backend (market.change); this only formats it. Unknown is said, never drawn as a zero. */
function Change({ change, spot, stale }: { change: MarketChange | null | undefined; spot: InstrumentRow | undefined; stale: boolean }) {
  if (!spot || spot.ltp == null) return null;
  if (!change) return <span className="mut" title="no market data from Prism yet">– vs prev close</span>;
  if (!change.available) return <span className="mut" title={change.why ?? ""}>change unknown</span>;
  const points = change.points ?? null;
  const up = points != null && points > 0;
  const down = points != null && points < 0;
  const title = `against ${change.basis ?? "the previous close"}: ${n2(change.previous_close)}${change.previous_close_date ? ` (${change.previous_close_date})` : ""}${stale ? " — as of the last snapshot" : ""}`;
  const pct = change.percent == null ? "–" : `${change.percent > 0 ? "+" : ""}${change.percent.toFixed(2)}%`;
  return (
    <span className={stale ? "mut" : up ? "up" : down ? "down" : "neu"} title={title}>
      {up ? "▲ +" : down ? "▼ " : "◆ "}
      {n2(points)} ({pct})
    </span>
  );
}

/** Two different clocks, never mixed: when Prism RECEIVED the NIFTY tick, and the EXCHANGE's own time for it. */
function SpotAge({ h, spot, hs }: { h: Health; spot: InstrumentRow | undefined; hs: HealthInstrument | undefined }) {
  if (!h.live) return <>market closed: the last price received, not live</>;
  if (!spot || spot.age == null) return <b className="stale">no NIFTY tick yet</b>;
  const x =
    hs?.exchange_status === "unknown" ? <b className="flat" title={hs.exchange_reason ?? ""}>unknown</b>
    : hs?.exchange_age == null ? <>–</>
    : hs.exchange_status === "stale" ? <b className="stale" title={hs.exchange_reason ?? ""}>{age(hs.exchange_age)} old: STALE</b>
    : <>{age(hs.exchange_age)} old</>;
  return (
    <>
      {spot.status === "fresh" ? <>NIFTY tick received {age(spot.age)} ago</> : <><b className="stale">STALE: last NIFTY tick {age(spot.age)} ago</b> (received)</>} · exchange time {x}
    </>
  );
}

function liveChips(s: Snapshot) {
  const h = s.health;
  const c = s.connection;
  const rd = h.readiness;
  const feedKind: Kind = c.state === "connected" ? "ok" : c.state === "connecting" || c.state === "starting" ? "warn" : "bad";
  return (
    <>
      <Chip id="c-market" kind={h.live ? "ok" : "neu"}>{h.live ? "MARKET OPEN" : "MARKET CLOSED"}</Chip>
      <Chip id="c-feed" kind={feedKind} title={h.feed?.reason ?? ""}>FEED {words(c.state).toUpperCase()}</Chip>
      <Chip id="c-data" kind={h.live ? (h.trusted ? "ok" : "bad") : "neu"}>{h.live ? (h.trusted ? "DATA TRUSTED" : "DATA NOT TRUSTED") : "DATA NOT LIVE"}</Chip>
      {rd ? (
        <Chip id="c-ready" kind={rd.ready ? "ok" : rd.state === "FAILED" ? "bad" : "warn"} title={rd.summary}>
          {rd.ready ? (rd.pre_market ? "READY FOR OPEN" : "SYSTEM READY") : `NOT READY: ${words(rd.state)}`}
        </Chip>
      ) : (
        <Chip id="c-ready" kind="neu">WAITING</Chip>
      )}
    </>
  );
}

/** What tells you when something needs you: sound + popup, sound, or off. Click to change; the choice is remembered. */
function ModeButton({ mode, onMode }: { mode: AlertMode; onMode: () => void }) {
  return (
    <button className={`alertmode${mode === "off" ? " off" : ""}`} id="alert-mode" type="button" title={MODE_TITLE} onClick={onMode}>
      🔔 {mode}
    </button>
  );
}

export function Header({ conn, snapshot, tries, mode, onMode }: { conn: Conn; snapshot: Snapshot | null; tries: number; mode: AlertMode; onMode: () => void }) {
  // before the first snapshot: the page says it is waiting, and says so again if the server cannot be reached; it never shows a placeholder as if it were data
  if (conn === "loading" || !snapshot) {
    const why = tries > 1 ? `Prism cannot be reached (attempt ${tries}): retrying every 2 s.` : "Connecting to Prism and waiting for the first snapshot.";
    return (
      <header id="top">
        <Brand />
        <div className="spotbox">
          <div className="spotline"><span className="spot dim" id="spot">–</span></div>
          <span id="spot-age"><span className="mut">{why}</span></span>
        </div>
        <div className="chips">
          <Chip id="c-market" kind="neu" title={why}>CONNECTING</Chip>
          <Chip id="c-feed" kind="neu" title={why}>FEED …</Chip>
          <Chip id="c-data" kind="neu" title={why}>DATA …</Chip>
          <Chip id="c-ready" kind="neu" title={why}>WAITING</Chip>
          {tries >= 2 ? <Chip id="c-link" kind="bad">DASHBOARD LINK LOST: reconnecting</Chip> : null}
        </div>
        <div id="hsum" />
        <ModeButton mode={mode} onMode={onMode} />
        <div id="clock" />
      </header>
    );
  }

  const stale = conn === "stale";
  const spot = snapshot.instruments.find((i) => i.role === "SPOT");
  const hs = snapshot.health.instruments.find((i) => i.role === "SPOT");
  const fresh = spot?.status === "fresh";
  const c = snapshot.connection;
  const rejected = Object.values(c.ticks_rejected ?? {}).reduce((a, b) => a + b, 0);
  const issues = snapshot.health.issues?.length ?? 0;
  const spotClass = `spot${stale ? " dim" : snapshot.health.live && !fresh ? " stale" : ""}`; // an old price must never look live

  if (stale) {
    // the last snapshot is all there is: no frozen tick age, no verdict on the market, the feed, the data or the system
    const why = `the dashboard has lost its link to Prism; the last snapshot was made at ${fmtT(snapshot.server_time)} IST`;
    return (
      <header id="top">
        <Brand />
        <div className="spotbox">
          <div className="spotline">
            <span className={spotClass} id="spot">{n2(spot?.ltp)}</span>
            <span id="spot-chg"><Change change={snapshot.trading?.market?.change} spot={spot} stale /></span>
          </div>
          <span id="spot-age"><b className="stale">STALE since {fmtT(snapshot.server_time, false)}: not current</b></span>
        </div>
        <div className="chips">
          <Chip id="c-market" kind="neu" title={why}>MARKET UNKNOWN</Chip>
          <Chip id="c-feed" kind="neu" title={why}>FEED UNKNOWN</Chip>
          <Chip id="c-data" kind="neu" title={why}>DATA UNKNOWN</Chip>
          <Chip id="c-ready" kind="neu" title={why}>SYSTEM UNKNOWN</Chip>
          <Chip id="c-link" kind="bad">DASHBOARD LINK LOST: reconnecting</Chip>
        </div>
        <div id="hsum" title={`last snapshot ${fmtT(snapshot.server_time)} IST · not current`}>last snapshot {fmtT(snapshot.server_time)} IST · not current</div>
        <ModeButton mode={mode} onMode={onMode} />
        <div id="clock">last snapshot {fmtD(snapshot.server_time)} IST</div>
      </header>
    );
  }

  const summary = `last tick ${fmtT(c.last_tick_received)} · ticks ${c.ticks_accepted} ok / ${rejected} rejected · reconnects ${c.reconnects}${issues ? ` · ${issues} data issue(s)` : ""}`;
  return (
    <header id="top">
      <Brand />
      <div className="spotbox">
        <div className="spotline">
          <span className={spotClass} id="spot">{n2(spot?.ltp)}</span>
          <span id="spot-chg"><Change change={snapshot.trading?.market?.change} spot={spot} stale={false} /></span>
        </div>
        <span id="spot-age"><SpotAge h={snapshot.health} spot={spot} hs={hs} /></span>
      </div>
      <div className="chips">{liveChips(snapshot)}</div>
      <div id="hsum" title={summary}>{summary}</div>
      <ModeButton mode={mode} onMode={onMode} />
      <div id="clock">{fmtD(snapshot.server_time)} IST</div>
    </header>
  );
}

function Brand() {
  return (
    <div className="brand">
      PRISM<small>NIFTY terminal</small>
    </div>
  );
}
