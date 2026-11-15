import { Fragment } from "react";
import { fmtD, fmtT, n2 } from "../format";
import { dur, STAGE_MARK, STATUS_CLS } from "../analysisModel";
import { AGE } from "../optionsModel";
import type { Health, HealthEvent, Snapshot } from "../types";
import { Kv } from "./OverviewPanels";

const miss = (o: Record<string, number> | undefined): string =>
  Object.entries(o ?? {})
    .map(([tf, n]) => `${tf.toUpperCase()} ${n}`)
    .join(", ") || "none";

/** The start-up as stages, and the numbers an operator needs when something is slow: what is done, what is running, what is being retried and when. */
function ReadinessBlock({ h }: { h: Health }) {
  const rd = h.readiness;
  const dg = h.diagnostics;
  if (!rd) return null;
  const hs = rd.history ?? { attempts: 0, max_attempts: 0, error: null, last_success: null, next_try_in: null, error_kind: null };
  const cd = rd.candles ?? { missing_today: {}, missing_in_decision_window: {}, unavailable_after_retries: 0 };
  return (
    <>
      <div className="bar" style={{ marginBottom: 6 }}>
        <span>
          <b className={rd.ready ? "up" : rd.state === "FAILED" ? "down" : "flat"}>{rd.state.replace(/_/g, " ")}</b>
        </span>
        <span>{rd.summary}</span>
        <span>
          Decisions permitted <b className={rd.decisions_permitted ? "up" : "flat"}>{rd.decisions_permitted ? "yes" : "no"}</b>
        </span>
      </div>
      <div className="scroll">
        <table className="t">
          <tbody>
            <tr>
              <th className="l">Start-up stage</th>
              <th className="l">Status</th>
              <th className="l wrap">Detail</th>
            </tr>
            {(rd.stages ?? []).map((g, i) => {
              const m = STAGE_MARK[g.status] ?? ["?", ""];
              return (
                <tr key={i}>
                  <td className="l">{g.label}</td>
                  <td className={`l ${m[1]}`}>
                    {m[0]} {g.status}
                  </td>
                  <td className="l wrap">{g.detail || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="kv four" style={{ margin: "8px 0" }}>
        <Kv label="Uptime">{dg ? dur(dg.uptime_seconds) : "–"}</Kv>
        <Kv label="Process" title="the one Prism running on this PC">
          {dg && dg.instance ? String(dg.instance.pid) : "–"}
        </Kv>
        <Kv label="History refresh" title={hs.error || ""}>
          {`${hs.attempts || 0} / ${hs.max_attempts || "–"} attempts`}
        </Kv>
        <Kv label="Last successful refresh">{hs.last_success ? fmtD(hs.last_success) : "none yet"}</Kv>
        <Kv label="Next retry" title={hs.error_kind ? "last failure: " + hs.error_kind : ""}>
          {dur(hs.next_try_in)}
        </Kv>
        <Kv label="Missing today" c={Object.keys(cd.missing_today ?? {}).length ? "flat" : "up"}>
          {miss(cd.missing_today)}
        </Kv>
        <Kv label="In decision window" c={Object.keys(cd.missing_in_decision_window ?? {}).length ? "down" : "up"} title="5M and 15M candles Phase 3 needs complete">
          {miss(cd.missing_in_decision_window)}
        </Kv>
        <Kv label="Last recovery attempt">{dg && dg.last_recovery_attempt ? fmtT(dg.last_recovery_attempt) : "none"}</Kv>
        <Kv label="Unavailable after retries" c={cd.unavailable_after_retries ? "down" : ""}>
          {String(cd.unavailable_after_retries || 0)}
        </Kv>
        <Kv label="Background tasks">{dg ? (dg.background_tasks ?? []).join(", ") || "none" : "–"}</Kv>
        <Kv label="Reconnects">{dg ? String(dg.reconnects) : "–"}</Kv>
        <Kv label="Last NIFTY tick">{dg && dg.last_spot_tick_age != null ? dur(dg.last_spot_tick_age) + " ago" : "none"}</Kv>
      </div>
    </>
  );
}

const EventLines = ({ events }: { events: HealthEvent[] }) => (
  <div className="mut">
    {events.map((e, i) => (
      <Fragment key={i}>
        {i ? <br /> : null}
        {fmtT(e.time)} {e.kind}: {e.message || e.reason}
        {e.attempt ? " (attempt " + e.attempt + ")" : ""}
      </Fragment>
    ))}
  </div>
);

/** Feed, clock, candle recovery and the official-candle check, in the operator's words. Each instrument is judged by its own ticks: option quotes never make the NIFTY spot look fresh. */
export function HealthDetail({ s, h }: { s: Snapshot; h: Health }) {
  const f = h.feed ?? { state: "", reason: null };
  const r = h.recovery ?? {};
  const tm = h.time;
  const v = h.validation;
  const c = s.connection;
  const rej = Object.entries(c.ticks_rejected)
    .map(([k, n]) => k + ":" + n)
    .join(" ") || "0";
  return (
    <div className="lv" id="dh">
      <ReadinessBlock h={h} />
      <div className="scroll">
        <table className="t">
          <tbody>
            <tr>
              <th>Instrument</th>
              <th className="l">Symbol</th>
              <th className="l">Status</th>
              <th>Age</th>
              <th>Limit</th>
              <th>Exchange time</th>
              <th>Received</th>
            </tr>
            {(h.instruments ?? []).map((i, n) => (
              <tr key={n}>
                <td>{i.role}</td>
                <td className="l">{i.symbol}</td>
                <td className={`l ${STATUS_CLS[i.status] || ""}`}>{i.status}</td>
                <td>{AGE(i.age)}</td>
                <td>{i.limit} s</td>
                <td>{fmtT(i.exchange_time)}</td>
                <td>{fmtT(i.received_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>Each instrument is judged by its own ticks: option quotes never make the NIFTY spot look fresh. Spot limit is the strategy's price age; option quotes are shown only (no decision uses them yet).</div>
      <div>
        Feed: <b>{f.state}</b>
        {f.state !== "connected" && f.reason ? ` — ${f.reason}` : ""}
        {f.state !== "connected" && f.attempt ? ` (attempt ${f.attempt})` : ""} · ticks ok {c.ticks_accepted} · rejected {rej} · reconnects {c.reconnects} · last tick (any instrument) {fmtT(c.last_tick_received)}
      </div>
      {(f.events ?? []).length ? <EventLines events={f.events ?? []} /> : null}
      <div>
        Clock: {tm ? tm.trusted ? <span className="up">trusted</span> : <b className="stale">NOT trusted: {tm.reason}</b> : <span className="mut">not checked</span>}
      </div>
      {tm && (tm.events ?? []).length ? <EventLines events={tm.events ?? []} /> : null}
      <div>
        Candle recovery (NIFTY spot only): {r.recovered || 0} candle(s) recovered in {r.requests || 0} request(s), {r.failures || 0} failed, {r.pending_candles || 0} still pending
        {r.history_refreshing ? " · history refresh running" : ""}
        {r.deferred ? ` · stood aside ${r.deferred}×` : ""}
        {r.last_error ? ` · last failure: ${r.last_error}` : ""}
      </div>
      <div>
        Angel One candle API: {r.api_requests || 0} request(s) through the shared limiter, {r.refusals || 0} refused for rate
        {r.cooling_down ? (
          <>
            {" — "}
            <b className="flat">cooling down {(r.cooldown_seconds ?? 0).toFixed(0)} s</b>
          </>
        ) : (
          ""
        )}
        {r.refusal_error ? ` · last refusal: ${r.refusal_error}` : ""}
      </div>
      <div>
        Official-candle check:{" "}
        {v ? (
          <>
            {v.date} {v.status}
            {v.file ? (
              <>
                {" "}
                <span className="mut">({v.file})</span>
              </>
            ) : (
              ""
            )}
            <br />
            {(v.lines ?? []).map((l, i) => (
              <Fragment key={i}>
                {i ? <br /> : null}
                {l}
              </Fragment>
            ))}
          </>
        ) : (
          <span className="mut">runs once after the close (about 15:40) when live candles exist</span>
        )}
      </div>
    </div>
  );
}

/** Each instrument's own quote, exchange time and receipt time. */
export function ContractsTable({ s }: { s: Snapshot }) {
  return (
    <div className="scroll">
      <table className="t">
        <tbody>
          <tr>
            <th>Role</th>
            <th className="l">Symbol</th>
            <th>Expiry</th>
            <th>Strike</th>
            <th>LTP</th>
            <th>Quote (receipt)</th>
            <th>Receipt age</th>
            <th>Day volume (units)</th>
            <th>Exchange time</th>
            <th>Received</th>
          </tr>
          {s.instruments.map((i, n) => (
            <tr key={n}>
              <td>{i.role}</td>
              <td className="l">{i.symbol}</td>
              <td>{i.expiry ?? "–"}</td>
              <td>{i.strike ?? "–"}</td>
              <td>{n2(i.ltp)}</td>
              <td className={STATUS_CLS[i.status] || ""}>{i.status || "–"}</td>
              <td>{AGE(i.age)}</td>
              <td>{i.volume ?? "–"}</td>
              <td>{fmtT(i.exchange_time)}</td>
              <td>{fmtT(i.received_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The gaps the feed had and the errors Prism logged, newest error first. */
export function GapsAndErrors({ s }: { s: Snapshot }) {
  const gaps = s.gaps ?? [];
  const errors = s.errors ?? [];
  return (
    <>
      <div className="mut">
        <b>Gaps</b>
        <br />
        {gaps.length
          ? gaps.map((g, i) => (
              <Fragment key={i}>
                {i ? <br /> : null}
                {fmtT(g.start)} → {g.end ? fmtT(g.end) + " (" + Math.round(g.end - g.start) + "s)" : g.ended_by ? g.ended_by : "ongoing"} · {g.reason}
              </Fragment>
            ))
          : "none"}
      </div>
      <div className="mut" style={{ marginTop: 6 }}>
        <b>Errors</b>
        <br />
        {errors.length
          ? errors
              .slice()
              .reverse()
              .map((e, i) => (
                <Fragment key={i}>
                  {i ? <br /> : null}
                  <span className="err">{fmtT(e.time)}</span> {e.message}
                </Fragment>
              ))
          : "none"}
      </div>
    </>
  );
}
