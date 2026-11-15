import { Fragment, type ReactNode } from "react";
import { fmtT, n1, n2, DASH } from "../format";
import {
  AGE, arrow, atrNote, cls, eventConcise, factCell, FACT_ORDER, FRESH_CLS, LABEL, monitor, optionHealth, STRUCT, stageWord, stateWord, whyOf, zone,
  type FactCell,
} from "../overviewModel"; // fmt: skip
import type { Analysis, Options, Setup, SetupEvent, Snapshot, StrategyMonitor, TfAnalysis, Trading } from "../types";
import type { TabId } from "./Tabs";

export type Goto = (tab: TabId, strategy?: string) => void;

/** A label with its value, in the grid the panels share. An empty title is no title. */
export function Kv({ label, c, title, children }: { label: string; c?: string; title?: string; children: ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <b className={c || ""} title={title || undefined}>
        {children}
      </b>
    </div>
  );
}
const Panel = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <div className="panel">
    <h3>{title}</h3>
    {children}
  </div>
);

// -- the timeframes: only the 1H and 15M decide the allowed side -------------------------------------------------------------------------------------------
function Tf({ tf, v }: { tf: string; v: TfAnalysis | null }) {
  return (
    <div className="tf">
      <span className="tfl">{LABEL[tf]}</span>
      {v ? (
        <>
          <b className={cls(v.trend)}>
            {arrow(v.trend)} {v.trend}
          </b>
          <small>
            ADX {n1(v.adx)} · RSI {n1(v.rsi14)} · {STRUCT[v.structure?.pattern ?? ""] || "–"}
            {v.warm ? "" : " · warming up"}
          </small>
        </>
      ) : (
        <>
          <b className="neu">–</b>
          <small>not available</small>
        </>
      )}
    </div>
  );
}
export function Timeframes({ a, note }: { a: Analysis; note: string }) {
  const tf = (k: string) => <Tf tf={k} v={a.available ? (a.timeframes?.[k] ?? null) : null} />;
  const al = a.available ? (a.condition?.alignment ?? null) : null;
  return (
    <div className="tfrow" id="tfrow">
      <div className="tfgrp gate" title={note}>
        <div className="tfcap">Decides the allowed side</div>
        {tf("1h")}
        {tf("15m")}
      </div>
      <div className="tfgrp info">
        <div className="tfcap">Information only</div>
        {tf("5m")}
        {tf("1m")}
      </div>
      <div className="tfal">
        <span className="mut" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>
          1H + 15M alignment
        </span>
        <b className={al ? (al.label.startsWith("aligned") ? "up" : al.label === "conflicting" ? "flat" : "neu") : "neu"}>{al ? al.label.replace(/_/g, " ") : "–"}</b>
        <small title={al ? al.text : ""}>{al ? al.text : "only the 1H and 15M decide which side is allowed; 5M and 1M are information"}</small>
      </div>
    </div>
  );
}

// -- market context ----------------------------------------------------------------------------------------------------------------------------------------
export function MarketContext({ t, a }: { t: Trading; a: Analysis }) {
  const m = t.market;
  const se = t.session;
  const lv = a.available ? (a.levels ?? null) : null;
  const pd = a.available ? (a.reference?.previous_day ?? null) : null;
  const near = (arr: { price: number }[] | undefined, c: string) => (arr && arr.length ? <span className={c}>{arr.slice(0, 2).map((l) => n2(l.price)).join(" / ")}</span> : DASH);
  const or = se?.opening_range;
  const orr = or ? `${n2(or.low)}–${n2(or.high)}${or.complete ? "" : " (forming)"}` : "–";
  return (
    <div className="kv" id="ctx">
      <Kv label="Market direction" c={m ? cls(m.direction) : ""} title="the direction of the market as a whole, from the 1H and 15M">
        {m ? arrow(m.direction) + " " + m.direction : "–"}
      </Kv>
      <Kv label="Condition" title={m ? m.text : ""}>
        {m ? m.regime.replace(/_/g, " ") : "–"}
      </Kv>
      <Kv label="Volatility">{m ? m.volatility : "–"}</Kv>
      <Kv label="ATR 5M · 15M" title="ATR: the candle size the rules use (5M intraday and 15M)">
        {m && m.atr ? `${atrNote(m.atr["5m"])} · ${atrNote(m.atr["15m"])}` : "–"}
      </Kv>
      <Kv label="Opening range">{orr}</Kv>
      <Kv label="Open vs prev close" title="the opening gap: today's open against the previous close (the header shows where the price is now)">
        {m && m.gap ? `${m.gap.points >= 0 ? "+" : ""}${m.gap.points.toFixed(0)} pts (${m.gap.percent.toFixed(2)}%)` : "–"}
      </Kv>
      <Kv label="Support">{near(lv?.support, "up")}</Kv>
      <Kv label="Resistance">{near(lv?.resistance, "down")}</Kv>
      <Kv label="Prev day H / L / C" c={pd && pd.stale ? "flat" : ""} title={pd ? `previous day high / low / close${pd.stale ? " (stale: not refreshed for today)" : ""}` : ""}>
        {pd ? `${n2(pd.pdh)} / ${n2(pd.pdl)} / ${n2(pd.pdc)}${pd.stale ? " (stale)" : ""}` : "–"}
      </Kv>
    </div>
  );
}

// -- the current setup --------------------------------------------------------------------------------------------------------------------------------------
export function CurrentSetupTitle({ x, t }: { x: Setup | null; t: Trading }) {
  return (
    <h3 id="setup-h">
      Current setup
      {x && x.strategy !== t.decision.strategy ? (
        <>
          {" "}
          <span className="mut" style={{ textTransform: "none", letterSpacing: 0 }} title={x.id}>
            {x.strategy_name} (the decision names no strategy)
          </span>
        </>
      ) : null}
    </h3>
  );
}
export function CurrentSetup({ t, x, stale }: { t: Trading; x: Setup | null; stale: boolean }) {
  const ex = t.explain ?? null;
  if (!x) {
    return (
      <div className="kv" id="setup">
        <div className="wide mut">
          <b>No live setup.</b> {t.events.length || t.recent.length ? "Setup events earlier today: see Recent events and the Journal." : "None has been announced today."}
        </div>
      </div>
    );
  }
  const expiry = [x.stage_text, ex?.setup === x.id ? (ex?.next ?? [])[0] : null, ex?.setup === x.id ? ex?.invalidation : null].filter(Boolean).join(" · ");
  const ce = x.direction === "CE";
  return (
    <div className="kv" id="setup">
      <Kv label="Setup side" c={ce ? "up" : "down"}>
        {arrow(ce ? "bullish" : "bearish")} {x.direction} ({ce ? "call" : "put"})
      </Kv>
      <Kv label="Stage" title={x.stage_text}>
        <span className={`st st-${x.stage}`}>{stageWord(x.stage, stale)}</span>
      </Kv>
      <Kv label="Detected · confirmed" c={x.confirmed_at ? "up" : "flat"} title={x.confirm_text}>
        {fmtT(x.detected_at, false)} · {x.confirmed_at ? fmtT(x.confirmed_at, false) : "not yet"}
      </Kv>
      <Kv label="Trigger">{n2(x.trigger)}</Kv>
      <Kv label="Entry zone">{zone(x.zone)}</Kv>
      <Kv label="Invalidation">{n2(x.invalidation)}</Kv>
      <div className="wide">
        <span>
          Expiry · what ends it{" "}
          <span className="mut" style={{ textTransform: "none", letterSpacing: 0 }}>
            (Prism's own wording)
          </span>
        </span>
        <b title={expiry} style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {stale ? "last known: " : ""}
          {expiry}
        </b>
      </div>
    </div>
  );
}

// -- the strategy monitor: only the strategies that hold a live setup get a row; the rest are one line that opens into a small table ---------------------------------
function DetailLink({ id, onGoto, text }: { id: string; onGoto: Goto; text?: string }) {
  return (
    <button className="linkbtn" type="button" onClick={() => onGoto("analysis", id)}>
      {text || "detail →"}
    </button>
  );
}
export function StrategyMonitorBody({ t, stale, onGoto }: { t: Trading; stale: boolean; onGoto: Goto }) {
  if (!t.strategies.length) return <span className="mut">no strategy data</span>;
  const { live, conflicts, idle, watching } = monitor(t);
  const sideChip = (z: StrategyMonitor, i: number) => {
    const sd = (z.sides ?? [])[i];
    return sd ? (
      <span className={`pillst ${sd.applicable ? "" : "mut"}`} title={sd.note || ""}>
        {sd.side} {stateWord(sd.state, stale)}
      </span>
    ) : null;
  };
  return (
    <>
      {live.length ? (
        <table className="strat">
          <tbody>
            {live.map((x) => (
              <tr key={x.id}>
                <td style={{ whiteSpace: "nowrap" }} title={`${x.strategy} · ${x.id}`}>
                  {x.strategy_name}
                </td>
                <td className={`dir ${x.direction === "CE" ? "up" : "down"}`} title={x.direction === "CE" ? "call" : "put"}>
                  {x.direction}
                </td>
                <td>
                  <span className="pillst">
                    <span className={`st st-${x.stage}`}>{stateWord(x.stage, stale)}</span>
                  </span>
                </td>
                <td className="why" title={whyOf(x)}>
                  {whyOf(x)}
                </td>
                <td className="go">
                  <DetailLink id={x.strategy} onGoto={onGoto} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mut">No strategy has a live setup.</div>
      )}
      {conflicts.slice(0, 2).map((c) => (
        <div key={c} className="conf" title={c}>
          ⚠ {c}
        </div>
      ))}
      {conflicts.length > 2 ? <div className="conf">⚠ +{conflicts.length - 2} more: see the decision's reasons</div> : null}
      {idle.length ? (
        <details className="more">
          <summary>
            {idle.length} without a setup: {watching} watching, {idle.length - watching} not suited to the market
          </summary>
          <table className="strat">
            <tbody>
              {idle.map((z) => (
                <tr key={z.id}>
                  <td style={{ whiteSpace: "nowrap" }} title={z.id}>
                    {z.name}
                  </td>
                  <td>
                    {sideChip(z, 0)} {sideChip(z, 1)}
                  </td>
                  <td className="go">
                    <DetailLink id={z.id} onGoto={onGoto} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </>
  );
}

// -- the regime: all six facts, each as it is, and the counter-trend permission when the 1H or 15M runs against a side a strategy considered ----------------------
function Fact({ c, quiet }: { c: FactCell; quiet: boolean }) {
  return (
    <div className={`rgc ${c.klass}`} title={c.title}>
      <span>{c.name}</span>
      <b>{c.word}</b>
      {c.unknown && !quiet ? <small>{c.why}</small> : null}
    </div>
  );
}
export function RegimeBody({ t }: { t: Trading }) {
  const rf = t.market?.regime_facts ?? null;
  const need = (t.counter_trend ?? []).filter((c) => c.needed);
  const usable = !!(rf && rf.available && rf.facts);
  return (
    <div className="kv" id="rg">
      <div className="wide">
        <div className="rg">
          {FACT_ORDER.map((k) => (
            <Fact key={k} c={factCell(k, usable ? rf?.facts[k] : null)} quiet={!usable} />
          ))}
        </div>
        {!rf ? (
          <div className="rgnote flat">Regime facts: not received yet. Every fact is unknown.</div>
        ) : !rf.available ? (
          <div className="rgnote flat" title={rf.why ?? ""}>
            ⚠ Regime facts unavailable: {rf.why}. Every fact is unknown; nothing is assumed.
          </div>
        ) : null}
        {need.length ? (
          <div className="rgnote" title={need.map((c) => c.side + ": " + c.reason).join(" | ")}>
            Counter-trend permission:{" "}
            {need.map((c, i) => (
              <Fragment key={c.side}>
                {i ? " · " : ""}
                <b>{c.side}</b> {c.granted ? <b className="up">granted</b> : <b className="flat">denied</b>} <span className="mut">{c.reason}</span>
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// -- data health: the NIFTY spot's receipt time and its exchange time are two different things and are shown as two ----------------------------------------------
function OptionFeed({ o, t }: { o: Options | undefined; t: Trading | null }) {
  const h = optionHealth(o, t);
  if (h.kind === "none") return <span className="mut">no option quotes yet</span>;
  if (h.kind === "closed") {
    return (
      <>
        <b className="neu">market closed</b>
        <span className="mut" style={{ display: "inline", textTransform: "none", letterSpacing: 0 }}> · {h.total} contracts, quotes are not live</span>
      </>
    );
  }
  return (
    <>
      <b className={h.freshClass}>
        {h.fresh} / {h.total} fresh
      </b>
      <span className="mut" style={{ display: "inline", textTransform: "none", letterSpacing: 0 }}>
        {" "}
        · {h.stale} stale · {h.unknown} unknown · {h.noData} no data
      </span>
      {h.selected ? (
        <>
          {" "}
          · selected {h.selected.kind} {h.selected.strike}: <b className={FRESH_CLS[h.selected.freshness] || ""}>{String(h.selected.freshness).toUpperCase()}</b>
        </>
      ) : null}
    </>
  );
}
export function DataHealth({ s, t, stale }: { s: Snapshot; t: Trading; stale: boolean }) {
  const h = s.health;
  const c = s.connection;
  const spot = s.instruments.find((i) => i.role === "SPOT");
  const hs = (h.instruments ?? []).find((i) => i.role === "SPOT");
  const f = h.feed;
  const tm = h.time;
  if (stale) {
    return (
      <div className="kv" id="dhs">
        <div className="wide">
          <span>Data health</span>
          <b className="flat">unknown: the page lost its link to Prism (last snapshot {fmtT(s.server_time)} IST); nothing here is current</b>
        </div>
        {["Feed", "NIFTY spot", "Candles", "Clock"].map((k) => (
          <Kv key={k} label={k} c="flat">
            unknown
          </Kv>
        ))}
      </div>
    );
  }
  const xt = hs?.exchange_status === "unknown" ? "unknown" : hs?.exchange_age == null ? "–" : AGE(hs.exchange_age) + (hs.exchange_status === "stale" ? " STALE" : "");
  return (
    <div className="kv" id="dhs">
      <Kv label="Feed" c={c.state === "connected" ? "up" : c.state === "connecting" || c.state === "starting" ? "flat" : "down"} title={f?.reason || ""}>
        {c.state}
        {c.reconnects ? ` · ${c.reconnects} reconnect(s)` : ""}
      </Kv>
      <Kv label="NIFTY spot" c={!h.live ? "mut" : spot && spot.status === "fresh" && hs?.exchange_status !== "stale" ? "up" : "down"} title="receipt age and exchange-time age are different clocks">
        {!spot || spot.age == null ? "no tick yet" : `${spot.status} · received ${AGE(spot.age)} · exchange ${xt}`}
      </Kv>
      <Kv label="Candles" c={t.data && t.data.ok ? "up" : "flat"} title={t.data && !t.data.ok ? (t.data.issues ?? []).join("; ") : ""}>
        {t.data ? (t.data.ok ? "complete" : "incomplete") : "–"}
      </Kv>
      <Kv label="Clock" c={tm ? (tm.trusted ? "up" : "down") : "mut"} title={tm && !tm.trusted ? (tm.reason ?? "") : ""}>
        {tm ? (tm.trusted ? "trusted" : "NOT trusted") : "not checked"}
      </Kv>
      <div className="span2">
        <span>Option feed</span>
        <b>
          <OptionFeed o={s.options} t={t} />
        </b>
      </div>
    </div>
  );
}

// -- the latest three events -----------------------------------------------------------------------------------------------------------------------------------
function EventRow({ e }: { e: SetupEvent }) {
  const [short, more] = eventConcise(e.text);
  const cells = (
    <>
      <span className="mut">{fmtT(e.time, false)}</span>
      <b className={e.direction === "CE" ? "up" : "down"}>{e.direction}</b>
      <span>{e.strategy_name}</span>
      <span className={`st st-${e.status}`}>{e.status.replace(/_/g, " ").toLowerCase()}</span>
      <span className="mut">
        {short}
        {more ? (
          <>
            {" "}
            <span className="evmore">▸ full description</span>
          </>
        ) : null}
      </span>
    </>
  );
  return more ? (
    <details className="evd">
      <summary className="evrow">{cells}</summary>
      <div className="evfull">{e.text}</div>
    </details>
  ) : (
    <div className="evrow">{cells}</div>
  );
}
export function RecentEvents({ t, onGoto }: { t: Trading; onGoto: Goto }) {
  return (
    <div className="panel" style={{ marginTop: 6 }}>
      <h3>
        Recent events{" "}
        <button className="linkbtn" type="button" onClick={() => onGoto("journal")}>
          Full journal →
        </button>
      </h3>
      <div id="ev3">{t.events.length ? t.events.slice(0, 3).map((e) => <EventRow key={e.seq} e={e} />) : <span className="mut">no setup events today</span>}</div>
    </div>
  );
}

export { Panel };
