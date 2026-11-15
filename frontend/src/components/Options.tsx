import { Fragment } from "react";
import { fmtT, n2 } from "../format";
import { AGE, contractOffer, flagIcon, FRESH_CLS, num0, quoteAges, ruledOut, type Offer } from "../optionsModel";
import type { OptionContract, OptionFlag, Options as OptionsData, OptionsDecision, Snapshot } from "../types";
import { actionWord, plain } from "../labels";
import { Kv } from "./OverviewPanels";

const SMALL = { textTransform: "none", letterSpacing: 0 } as const;

/** Suitability findings: in full, one line each (a Warn is shown and does not block; an Avoid keeps a contract from being selected), or briefly, one word each with the whole text in its tooltip. */
function Flags({ flags, full }: { flags: OptionFlag[]; full: boolean }) {
  if (full) {
    return (
      <>
        {flags.map((f, i) => (
          <div key={i} className={`why sev-${f.severity}`}>
            {flagIcon(f)} {f.text}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {flags.map((f, i) => (
        <Fragment key={i}>
          {i ? " · " : ""}
          <span className={`sev-${f.severity}`} title={f.text}>
            {flagIcon(f)} {f.code.replace(/_/g, " ")}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/** Three different clocks, never mixed: when Prism received the message, when the exchange says the quote was last updated, and when the last trade happened. */
function FreshnessWords({ c }: { c: OptionContract }) {
  const ex = c.exchange_status === "unknown" ? "unknown" + (c.exchange_reason ? " (" + c.exchange_reason + ")" : "") : AGE(c.exchange_age);
  return (
    <>
      <b className={FRESH_CLS[c.freshness] || ""}>{String(c.freshness).toUpperCase()}</b> · receipt age {AGE(c.receipt_age)} · exchange-time age {ex} · last-trade age {AGE(c.last_trade_age)}
    </>
  );
}

/** Who made the decision this contract serves, and who else agrees: the decision's own fields, as the backend carried them. */
function Origin({ d, stale }: { d: OptionsDecision; stale: boolean }) {
  const also = d.also ?? [];
  return (
    <div className="origin">
      {stale ? "Last chosen for" : "Chosen for"} <b>{actionWord(d.action)}</b> from <b>{d.strategy_name || "–"}</b>
      {d.strategy ? (
        <>
          {" "}
          <code>{d.strategy}</code>
        </>
      ) : null}{" "}
      · setup {d.setup_id ? <code>{d.setup_id}</code> : "–"} · also matches: {also.length ? <b>{also.join(", ")}</b> : "none"}
    </div>
  );
}

function Alternatives({ list }: { list: OptionContract[] }) {
  return (
    <>
      <div style={{ marginTop: 6 }}>
        <b>Alternatives</b> <span className="mut">next in the same order; each has no blocking finding</span>
      </div>
      <div className="scroll">
        <table className="t">
          <tbody>
            <tr>
              <th className="l">Contract</th>
              <th>Expiry</th>
              <th>LTP</th>
              <th>Bid × Ask</th>
              <th>Spread</th>
              <th>Volume (units)</th>
              <th>OI (units)</th>
              <th title="received by Prism / the exchange's own time for the quote">Quote age: received / exchange</th>
              <th className="l">Warnings</th>
            </tr>
            {list.map((a, i) => (
              <tr key={i}>
                <td className="l">
                  {a.kind} {a.strike}
                </td>
                <td>{a.expiry}</td>
                <td>{n2(a.ltp)}</td>
                <td>
                  {n2(a.bid)} × {n2(a.ask)}
                </td>
                <td>{a.spread_pct == null ? "–" : a.spread_pct.toFixed(2) + "%"}</td>
                <td>{num0(a.volume)}</td>
                <td>{num0(a.oi)}</td>
                <td>{quoteAges(a)}</td>
                <td className="wrap">{a.warnings ? <Flags flags={a.flags.filter((f) => f.severity === "warn")} full={false} /> : <span className="mut">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Why the contracts of this side that were NOT offered were ruled out: every Avoid finding, in the backend's words. */
function RuledOut({ o, side, open }: { o: OptionsData; side: string; open: boolean }) {
  const { mine, bad } = ruledOut(o, side);
  if (!bad.length) {
    return (
      <div className="mut" style={{ marginTop: 6 }}>
        No {side} contract is ruled out.
      </div>
    );
  }
  return (
    <details className="more" open={open}>
      <summary>
        {bad.length} of {mine.length} {side} contracts ruled out (Avoid): why
      </summary>
      {bad.map((c, i) => (
        <div key={i} className="why sev-avoid">
          ⛔ {c.symbol}{" "}
          <span className="mut">
            {c.expiry} · strike {c.strike}
          </span>
          : {c.flags.filter((f) => f.severity === "avoid").map((f) => f.text).join("; ")}
        </div>
      ))}
    </details>
  );
}

function SelectedContract({ o, offer, d, stale, hhmm }: { o: OptionsData; offer: Offer; d: OptionsDecision; stale: boolean; hhmm: string }) {
  const c = offer.contract as OptionContract;
  const s = o.selection!;
  const side = offer.side as string;
  return (
    <div className={`panel card ${side.toLowerCase()}`} style={{ marginBottom: 6 }}>
      <h3>
        {stale ? (
          <>
            Last selected contract{" "}
            <span className="stale" style={SMALL}>
              STALE since {hhmm}: not current, not actionable
            </span>
          </>
        ) : (
          <>
            Selected contract{" "}
            <span className="mut" style={SMALL}>
              the market data does not rule it out; this is not a recommendation or a prediction
            </span>
          </>
        )}
      </h3>
      <div className="selhead">
        <span className={`big ${side === "CE" ? "up" : "down"}`}>
          {c.kind} {c.strike}
        </span>
        <span>
          <b>{c.moneyness || "–"}</b>
          {c.steps_from_atm ? " · " + c.steps_from_atm + " strike(s) from ATM" : ""} · {c.distance_points == null ? "–" : (c.distance_points >= 0 ? "+" : "") + c.distance_points.toFixed(0) + " pts from the spot"}
        </span>
        <span>
          expiry <b>{c.expiry}</b> ({c.days_to_expiry} day(s)
          {c.expiry_day ? (
            <>
              , <b className="sev-warn">EXPIRES TODAY</b>
            </>
          ) : (
            ""
          )}
          )
        </span>
        <span className="mut">{c.symbol}</span>
      </div>
      <Origin d={d} stale={stale} />
      <div className="kv six">
        <Kv label="LTP">{n2(c.ltp)}</Kv>
        <Kv label="Bid × units">
          {n2(c.bid)} × {num0(c.bid_qty)}
        </Kv>
        <Kv label="Ask × units">
          {n2(c.ask)} × {num0(c.ask_qty)}
        </Kv>
        <Kv label="Spread">{c.spread == null ? "–" : `${n2(c.spread)} (${(c.spread_pct as number).toFixed(2)}% of mid)`}</Kv>
        <Kv label="Lot size">1 lot = {c.lot_size ?? "–"} units</Kv>
        <Kv label="Prev close">
          {n2(c.prev_close)}
          {c.change == null ? "" : " (" + (c.change >= 0 ? "+" : "") + c.change.toFixed(2) + ")"}
        </Kv>
        <Kv label="Day volume (units)">{num0(c.volume)}</Kv>
        <Kv label="Open interest (units)">{num0(c.oi)}</Kv>
        <Kv label="Freshness" c={FRESH_CLS[c.freshness] || ""}>
          {String(c.freshness).toUpperCase()}
        </Kv>
        <Kv label="Quote age: received" title="how long ago Prism received the last message for this contract">
          {AGE(c.receipt_age)}
        </Kv>
        <Kv label="Quote age: exchange time" c={c.exchange_status === "fresh" ? "" : "flat"} title="the exchange's own time for the quote: a message received a moment ago can carry an old one">
          {c.exchange_status === "unknown" ? "unknown" : AGE(c.exchange_age)}
        </Kv>
        <Kv label="Last-trade age" title="shown only: a last trade says nothing about the order book">
          {AGE(c.last_trade_age)}
        </Kv>
      </div>
      <div className="fresh-strip">
        quote <FreshnessWords c={c} />
      </div>
      {c.flags.length ? (
        <>
          <div style={{ marginTop: 6 }}>
            <b>Suitability findings</b> <span className="mut">(a Warn is shown and does not block; an Avoid would have kept this contract from being selected)</span>
          </div>
          <Flags flags={c.flags} full />
        </>
      ) : (
        <div className="mut" style={{ marginTop: 6 }}>
          No suitability warnings.
        </div>
      )}
      {s.why.map((w, i) => (
        <div key={i} className="why mut">
          {w}
        </div>
      ))}
      {s.alternatives.length ? (
        <Alternatives list={s.alternatives} />
      ) : (
        <div className="mut" style={{ marginTop: 6 }}>
          No alternative contracts.
        </div>
      )}
      <RuledOut o={o} side={side} open={false} />
    </div>
  );
}

function NoContract({ o, offer, d }: { o: OptionsData; offer: Offer; d: OptionsDecision }) {
  const s = o.selection!;
  return (
    <div className="panel card" style={{ marginBottom: 6 }}>
      <h3>
        No contract selected{" "}
        <span className="mut" style={SMALL}>
          {offer.side ? "" : "informational: only a ready setup (CE SETUP / PE SETUP) selects a contract"}
        </span>
      </h3>
      {offer.conflict ? (
        <div className="warnbox">
          ⚠ The options data offers a contract, but the final decision is <b>{offer.final ? actionWord(offer.final) : "not available"}</b>
          {offer.final && !offer.agree ? ` (the options payload says ${d.action ? actionWord(d.action) : "nothing"})` : ""}: no contract is shown as selected.
        </div>
      ) : null}
      <div>
        <b>{offer.conflict ? "no options selection: the final decision does not call for a contract" : s.notice}</b>
      </div>
      {offer.side ? null : (
        <div className="mut">
          Final decision: <b>{offer.final || d.action ? actionWord(offer.final || d.action) : "not available"}</b>
          {d.headline ? " — " + plain(d.headline) : ""}. Everything below is for information only: nothing in it is selected, and none of it is actionable.
        </div>
      )}
      {offer.side && offer.agree ? <RuledOut o={o} side={offer.side} open /> : null}
    </div>
  );
}

function Head({ o, offer, d }: { o: OptionsData; offer: Offer; d: OptionsDecision }) {
  const buy = /^BUY /.test(d.action || "");
  const setup = d.setup_id ? (
    <>
      {" "}
      <span className="mut" title="the setup the decision is about">
        setup {d.setup_id}
      </span>
    </>
  ) : null;
  return (
    <>
      <span>
        NIFTY spot <b className={o.spot_fresh ? "" : "stale"}>{n2(o.spot)}</b>{" "}
        <span className="mut">
          {o.spot_age == null ? "no tick" : AGE(o.spot_age) + " old"}
          {o.spot_fresh || !o.live ? "" : " — STALE"}
        </span>
      </span>
      <span>
        Phase 3 decision <b>{actionWord(d.action)}</b>
      </span>
      <span>
        Option side <b>{offer.side && offer.agree ? offer.side : "none"}</b>
      </span>
      <span className="mut">{plain(d.headline || "")}</span>
      {d.strategy_name ? (
        buy ? (
          <span>
            From <b>{d.strategy_name}</b>
            {setup}
          </span>
        ) : (
          <span className="mut">
            Setup in view (not ready, so no contract): <b>{d.strategy_name}</b>
            {setup}
          </span>
        )
      ) : null}
      {(d.also ?? []).length ? <span className="mut">also matches: {(d.also ?? []).join(", ")}</span> : null}
    </>
  );
}

function ComparisonRows({ o, offer }: { o: OptionsData; offer: Offer }) {
  const kinds = offer.side && offer.agree ? [offer.side as string] : ["CE", "PE"];
  const chosen = offer.contract ? offer.contract.token : null;
  return (
    <tbody>
      <tr>
          <th>Expiry</th>
          <th className="l">Side</th>
          <th>Strike</th>
          <th className="l">Class</th>
          <th>LTP</th>
          <th>Bid × units</th>
          <th>Ask × units</th>
          <th>Spread</th>
          <th title="the day total, in units: a multiple of the lot size">Volume (units)</th>
          <th title="in units: a multiple of the lot size">Open interest (units)</th>
          <th className="l" title="STATUS, then the receipt age (when Prism got the message), the exchange-time age (the exchange own time for the quote) and the last-trade age">
            Freshness: receipt / exchange / last trade
          </th>
          <th className="l">Findings</th>
        </tr>
        {(o.contracts ?? [])
          .filter((c) => kinds.includes(c.kind))
          .map((c) => (
            <tr key={c.token} className={c.token === chosen ? "opt-sel" : c.blocking ? "opt-avoid" : ""}>
              <td className="l">
                {c.expiry} ({c.days_to_expiry}d)
              </td>
              <td className="l">{c.kind}</td>
              <td>{c.strike}</td>
              <td className="l">
                {c.moneyness || "–"}
                {c.steps_from_atm ? " " + c.steps_from_atm : ""}
              </td>
              <td>{n2(c.ltp)}</td>
              <td>
                {n2(c.bid)} × {num0(c.bid_qty)}
              </td>
              <td>
                {n2(c.ask)} × {num0(c.ask_qty)}
              </td>
              <td>{c.spread == null ? "–" : n2(c.spread) + " (" + (c.spread_pct as number).toFixed(2) + "%)"}</td>
              <td>{num0(c.volume)}</td>
              <td>{num0(c.oi)}</td>
              <td className="wrap">
                <b className={FRESH_CLS[c.freshness] || ""}>{String(c.freshness).toUpperCase()}</b>
                <br />
                <span className="mut" style={{ whiteSpace: "nowrap" }}>
                  receipt {AGE(c.receipt_age)} · exchange {c.exchange_status === "unknown" ? "unknown" : AGE(c.exchange_age)} · trade {AGE(c.last_trade_age)}
                </span>
              </td>
              <td className="wrap">
                <Flags flags={c.flags} full={false} />
              </td>
            </tr>
          ))}
    </tbody>
  );
}

function Window({ o }: { o: OptionsData }) {
  const w = o.window;
  const st = o.settings;
  if (!w || !st) return null;
  return (
    <>
      Watching {w.contracts} option contracts around ATM {w.center} (first expiry {w.primary}); the strikes follow the spot.{" "}
      {w.events.length ? "Last re-centred: " + w.events.map((e) => `${fmtT(e.time)} ${e.reason}`).join(" · ") : "Not re-centred since selection."} Thresholds (OPTIONS_* variables): spread warn {st.warn_spread_pct}% /
      max {st.max_spread_pct}%, min volume {num0(st.min_volume)} units, a quote received more than {st.quote_stale_seconds} s ago, or whose exchange time is more than {st.exchange_stale_seconds} s old, is stale.
      They are placeholders to tune.
    </>
  );
}

function Expiries({ o }: { o: OptionsData }) {
  return (
    <>
      {(o.expiries ?? []).map((e, i) => (
        <div key={i} className="mut">
          Expiry <b>{e.expiry}</b>: {e.days_to_expiry} day(s)
          {e.expiry_day ? (
            <>
              {" "}
              — <b className="sev-warn">EXPIRY DAY: time decay is fastest; premiums can fall quickly even if NIFTY does not move</b>
            </>
          ) : e.decay_warning ? (
            <>
              {" "}
              — <span className="sev-warn">time decay accelerates close to expiry</span>
            </>
          ) : (
            ""
          )}
        </div>
      ))}
    </>
  );
}

/**
 * The Options tab (Stage 9.4): the watched option contracts checked against their own quotes. It is the current dashboard's Options tab, port for port. A contract is shown as selected ONLY when the final
 * decision calls for one; every other state says "No contract selected", and a stale page shows the last selection as history. It places no order and predicts nothing.
 */
export function OptionsTab({ snapshot, stale }: { snapshot: Snapshot | null; stale: boolean }) {
  const o = snapshot?.options;
  const ready = !!(snapshot && o && o.available && o.selection);
  const offer = ready && snapshot && o ? contractOffer(snapshot.trading, o) : null;
  const d: OptionsDecision = o?.decision ?? { action: null };
  return (
    <>
      <div className="bar" id="opt-head">
        {!snapshot ? "–" : ready && o && offer ? <Head o={o} offer={offer} d={d} /> : o && o.reason ? o.reason : "options analysis not available yet"}
      </div>
      <div id="opt-sel">
        {ready && snapshot && o && offer ? (
          offer.ok ? <SelectedContract o={o} offer={offer} d={d} stale={stale} hhmm={fmtT(snapshot.server_time, false)} /> : <NoContract o={o} offer={offer} d={d} />
        ) : null}
      </div>
      <div className="panel" style={{ marginBottom: 6 }}>
        <h3>
          Nearby-strike comparison{" "}
          <span className="mut" style={SMALL}>
            checks of each contract's own quote: not a recommendation, not a prediction, and no order is ever placed
          </span>
          <span className="stale" id="opt-info" style={SMALL}>
            {ready && offer && !offer.ok ? " — informational: no contract is selected" : ""}
          </span>
        </h3>
        <div className="scroll">
          <table className="t" id="opt-table">
            {ready && o && offer ? <ComparisonRows o={o} offer={offer} /> : null}
          </table>
        </div>
        <div id="opt-exp" style={{ marginTop: 6 }}>
          {ready && o ? <Expiries o={o} /> : null}
        </div>
        <div id="opt-win" className="mut" style={{ marginTop: 6 }}>
          {ready && o ? <Window o={o} /> : null}
        </div>
      </div>
    </>
  );
}
