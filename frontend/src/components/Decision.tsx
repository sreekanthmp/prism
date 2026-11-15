import { Fragment, type ReactNode } from "react";
import { fmtT, n1, n2 } from "../format";
import { ACTION_CLS } from "../overviewModel";
import type { Explain, Plan, PlanTarget, Setup, Snapshot, Trading } from "../types";

/** The underlying plan from the levels that were actually detected, in index points from the trigger: never option premium. */
export function PlanBlock({ x }: { x: Setup }) {
  const p = x.plan as Plan | undefined;
  if (!p || !p.targets) return null;
  const targets: PlanTarget[] = p.targets;
  return (
    <div>
      Underlying plan, index points from the trigger {n2(p.entry_reference)}: risk <b>{n1(p.risk_points)}</b> pts
      {targets.length ? " · " : ""}
      {targets.map((g, i) => (
        <Fragment key={g.n}>
          {i ? " · " : ""}
          <b>
            T{g.n} {n2(g.price)}
          </b>{" "}
          ({g.label}) +{n1(g.distance)} pts = {g.reward_risk == null ? "–" : g.reward_risk.toFixed(2)}× the risk
        </Fragment>
      ))}
      {p.note ? <>{" "}<span className="mut">({p.note})</span></> : ""} <span className="mut">— index points, not option premium</span>
    </div>
  );
}

/** "In plain words": what happened, what is happening, what has to happen next, what ends it, what blocks entry, and which timeframes agree. */
export function ExplainBlock({ e }: { e: Explain | null | undefined }) {
  if (!e) return null;
  const line = (title: string, arr: string[] | undefined) =>
    arr && arr.length ? (
      <div>
        <b>{title}</b> {arr.join(" · ")}
      </div>
    ) : null;
  return (
    <div className="card">
      <div>
        <b>In plain words</b> <span className="mut">({e.setup ? "about the setup this decision refers to" : "no live setup"})</span>
      </div>
      {line("What happened:", e.happened)}
      {line("What is happening now:", e.now)}
      {line("What has to happen next:", e.next)}
      {e.invalidation ? (
        <div>
          <b>What ends it:</b> {e.invalidation}
        </div>
      ) : null}
      {line("What blocks entry:", e.blocking)}
      <div>
        <b>Timeframes:</b> <span className="up">{(e.supports ?? []).join(", ") || "none"} agree</span> · <span className="down">{(e.disagrees ?? []).join(", ") || "none"} disagree</span> ·{" "}
        <span className="mut">{(e.neutral ?? []).join(", ") || "none"} neutral</span> <span className="mut">({e.note ?? ""})</span>
      </div>
    </div>
  );
}

/** The floating panels of the banner ("Explain this decision", the checklist) share one name: the browser then keeps one of them open at a time, so two never lie over each other. */
export const POP_GROUP = { name: "pop" };

const did = (k: string, v: ReactNode) => (
  <span>
    <span className="k">{k}</span>
    {v}
  </span>
);
const idCode = (v: string | null | undefined) => (v ? <code title={v}>{v}</code> : <b>–</b>);

/**
 * The decision: the one block that says what to do, in the colour of the answer. On a stale page it says STALE and the last decision as history, never as a decision. The "Explain this decision" popup holds
 * the same facts in plain words (it opens over the page, and stays open while the page updates once a second).
 */
export function DecisionBanner({ s, t, liveSetup, stale, extra }: { s: Snapshot; t: Trading; liveSetup: Setup | null; stale: boolean; extra?: ReactNode }) {
  const d = t.decision;
  const ex = t.explain ?? null;
  const se = t.session;
  const x = liveSetup;
  const also = d.also ?? [];
  const dc = stale ? "stale" : (ACTION_CLS[d.action] ?? "no-trade");
  const blockers = (ex?.blocking ?? []).filter((b) => !d.headline.includes(b)).slice(0, 2);
  const sess = se ? `${se.phase.replace(/_/g, " ")} · ${se.entries_allowed ? "entries allowed" : "no new entries"}` : "–";
  const entry = stale ? (
    <b className="flat">not eligible: STALE</b>
  ) : (
    <b className={ex?.actionable ? "up" : "flat"}>{ex?.actionable ? "eligible (actionable now)" : "not eligible"}</b>
  );
  return (
    <div className={`decision ${dc}`} id="decision">
      <div className="dbadge">
        <div className="dtxt" title="A decision is what the rules say about the NIFTY index; it is not a recommendation to trade.">
          {stale ? "STALE" : d.action}
        </div>
        <div className="dsub">{stale ? "last decision: " + d.action : sess}</div>
      </div>
      <div>
        <div className="dhead">{stale ? `STALE since ${fmtT(s.server_time, false)} — NOT ACTIONABLE` : d.headline}</div>
        {stale ? (
          <div className="dblock">Last known, not current: {d.headline}</div>
        ) : blockers.length ? (
          <div className="dblock" title={blockers.join(" · ")}>
            ⏸ Blocks entry: {blockers.join(" · ")}
          </div>
        ) : null}
      </div>
      <div className="dexp">
        <div className="did">
          {did("Strategy", <b>{d.strategy_name || "none"}</b>)}
          {did("Strategy ID", idCode(d.strategy))}
          {did("Setup ID", idCode(d.setup_id))}
          {did("Agrees", also.length ? <b title={also.join(" · ")}>{also.join(", ")}</b> : <b>none</b>)}
        </div>
        <div className="go">
          <span>Entry {entry}</span>
          <details className="pop" {...POP_GROUP}>
            <summary>Explain this decision ▾</summary>
            <div className="popbody">
              {stale ? <div className="warnbox">The last snapshot (made {fmtT(s.server_time)} IST): not a current decision.</div> : null}
              <div className="mut" style={{ marginBottom: 6 }}>
                A decision is what the rules say about the NIFTY index; it is not a recommendation to trade. {t.available ? "It uses completed candles only; a forming candle never confirms a setup." : ""}
              </div>
              <ExplainBlock e={t.explain} />
              <div>
                <b>{d.headline}</b>
              </div>
              {d.reasons.map((r, i) => (
                <div key={i} className="why up" style={{ marginLeft: 12 }}>
                  + {r}
                </div>
              ))}
              {d.against.map((r, i) => (
                <div key={i} className="why flat" style={{ marginLeft: 12 }}>
                  − {r}
                </div>
              ))}
              {also.length ? (
                <div className="mut" style={{ marginLeft: 12 }}>
                  also matches: {also.join(", ")}
                </div>
              ) : null}
              {x ? (
                <>
                  <div style={{ marginTop: 6 }}>
                    <b>Setup expiry and invalidation</b>
                  </div>
                  <div className="mut">{x.stage_text || ""}</div>
                  <div className="mut">To confirm: {x.confirm_text}</div>
                  <div>
                    Invalidation <b>{n2(x.invalidation)}</b>
                    {ex?.invalidation ? " · " + ex.invalidation : ""}
                  </div>
                  <PlanBlock x={x} />
                </>
              ) : null}
            </div>
          </details>
          {extra}
        </div>
      </div>
    </div>
  );
}
