import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { fmtT, n2 } from "../format";
import { checkMark, FACT_CLS, FACT_NAME, liveWords, PERMISSION_GROUPS, SIDE_LONG, structureLine } from "../analysisModel";
import { atrNote, stageWord, stateWord } from "../overviewModel";
import type { CounterTrend, RegimeCheck, RegimeFacts, Setup, StrategyMonitor, StrategySide, Trading } from "../types";
import { PlanBlock } from "./Decision";

export interface OpenState {
  isOpen(key: string): boolean;
  setOpen(key: string, open: boolean): void;
}

/** The checks a verdict was made from: ✓ holds, ✗ does not, ? could not be judged. */
export function CheckLines({ cs }: { cs: RegimeCheck[] | undefined }) {
  return (
    <>
      {(cs ?? []).map((c, i) => {
        const m = checkMark(c);
        return (
          <div key={i} className={`why ${m.klass}`}>
            {m.mark} {c.name}: <span className="mut">{c.text}</span>
            {c.info ? (
              <>
                {" "}
                <span className="mut">(reported, not a condition)</span>
              </>
            ) : (
              ""
            )}
          </div>
        );
      })}
    </>
  );
}

/** What kind of market this is, with the evidence. These sit beside the condition and never change it: none is a signal, and there is no score. */
export function RegimeFactsBlock({ rf }: { rf: RegimeFacts | null | undefined }) {
  if (!rf) return <div className="mut">The regime facts are not available yet.</div>;
  if (!rf.available) return <div className="warnbox">⚠ Regime facts unavailable: {rf.why}. Every fact is unknown, and nothing is assumed.</div>;
  return (
    <>
      <div className="mut" style={{ marginBottom: 4 }}>
        What kind of market this is, with the evidence. These sit beside the Condition above and never change it; none is a signal and there is no score. As of the 15M candle ending {fmtT(rf.as_of, false)}.
      </div>
      {Object.entries(rf.facts).map(([k, f]) => (
        <div key={k} className="card">
          <div>
            <b>{FACT_NAME[k] || k}</b> — <b className={FACT_CLS[f.state] || "mut"}>{f.state.replace(/_/g, " ")}</b> <span className="mut">{f.summary}</span>
          </div>
          <CheckLines cs={f.checks} />
        </div>
      ))}
    </>
  );
}

/** One counter-trend permission, granted or denied, with every check it was made from and the structure behind it. */
export function PermissionBlock({ c }: { c: CounterTrend }) {
  const checks = c.checks ?? [];
  return (
    <div className={`card ${c.side.toLowerCase()}`}>
      <div>
        <b>{c.side}</b> · {c.strategy_name} — counter-trend permission {c.granted ? <b className="up">GRANTED</b> : <b className="flat">DENIED</b>}{" "}
        <span className="mut">{c.needed ? "needed: the 1H or 15M trend runs against " + c.side : "not needed: neither the 1H nor the 15M trend runs against " + c.side}</span>
      </div>
      <div className="mut">{c.reason}</div>
      {PERMISSION_GROUPS.map(([g, title]) => {
        const cs = checks.filter((x) => x.group === g);
        return cs.length ? (
          <Fragment key={g}>
            <div style={{ marginTop: 3 }}>
              <b>{title}</b>
            </div>
            <CheckLines cs={cs} />
          </Fragment>
        ) : null;
      })}
      {c.structure ? (
        <>
          <div style={{ marginTop: 3 }}>
            <b>Structural evidence</b> <span className="mut">(real prices)</span>
          </div>
          <div className="why mut">{structureLine(c.structure, c.side)}</div>
        </>
      ) : (
        <div className="why mut">no confirmed 15M structural change yet</div>
      )}
      {c.setup_id ? <div className="why mut">the setup it permitted: {c.setup_id}</div> : null}
    </div>
  );
}

/** A live setup inside its strategy's own block (the strategy and the side are already said there): where it stands, its levels, its plan, the evidence for it and what blocks it. */
function SetupCard({ x, stale }: { x: Setup; stale: boolean }) {
  const ct = x.counter_trend;
  const lv = (x.support.length ? "support " + x.support.map(n2).join(", ") : "") + (x.resistance.length ? " · resistance " + x.resistance.map(n2).join(", ") : "");
  const live = liveWords(x, stale);
  const area = x.zone ? (x.status === "CONFIRMED" ? "Entry area " : "Watch area ") + (x.zone.length === 2 ? `${n2(x.zone[0])} – ${n2(x.zone[1])}` : "–") : "";
  return (
    <div>
      <div>
        <span className={`st st-${x.stage}`}>{stageWord(x.stage, stale)}</span>{" "}
        <span className="mut">
          detected {fmtT(x.detected_at, false)}
          {x.confirmed_at ? " · confirmed " + fmtT(x.confirmed_at, false) : ""} · this status since {fmtT(x.status_since, false)}
          {x.resumed ? " · resumed after a restart" : ""}
        </span>
        {live ? (
          <>
            {" — "}
            <b className={live.klass}>{live.text}</b>
          </>
        ) : (
          ""
        )}
      </div>
      <div>
        {area}
        {x.trigger != null ? (
          <>
            {" · trigger "}
            <b>{n2(x.trigger)}</b>
          </>
        ) : (
          ""
        )}{" "}
        · invalidation <b>{n2(x.invalidation)}</b>
        {x.level != null ? ` · ${x.level_label} ${n2(x.level)}` : ""}
        {lv ? (
          <>
            {" "}
            <span className="mut">({lv})</span>
          </>
        ) : (
          ""
        )}
      </div>
      <PlanBlock x={x} />
      <div className="mut">Expiry · status (Prism's wording): {x.stage_text || ""}</div>
      <div className="mut">To confirm: {x.confirm_text}</div>
      {x.reasons.map((r, i) => (
        <div key={"r" + i} className="why up">
          + {r}
        </div>
      ))}
      {(x.quality ?? []).map((q, i) => (
        <div key={"q" + i} className={`why ${q.ok ? "mut" : "flat"}`}>
          {q.ok ? "✓" : "⚠"} {q.name}: {q.text}
        </div>
      ))}
      {ct ? (
        <>
          <div className={`why ${ct.granted ? "up" : "flat"}`}>
            ⚑ Counter-trend permission {ct.granted ? "granted" : "denied"}: {ct.reason}
          </div>
          {ct.structure ? <div className="why mut">{structureLine(ct.structure, x.direction)}</div> : null}
        </>
      ) : null}
      {x.blockers.map((r, i) => (
        <div key={"b" + i} className="why flat">
          ⏸ {r}
        </div>
      ))}
      {x.against.map((r, i) => (
        <div key={"a" + i} className="why flat">
          − {r}
        </div>
      ))}
      {x.note ? <div className="why mut">{x.note}</div> : null}
    </div>
  );
}

/** The extra evidence of the one counter-trend strategy: the weakening trend, the 15M structural reversal, the 5M confirmation and the permission, granted or denied and why. */
function ReversalEvidence({ t }: { t: Trading }) {
  const rf = t.market?.regime_facts;
  const wk = rf && rf.facts ? rf.facts.weakening_trend : null;
  const cts = (t.counter_trend ?? []).filter((c) => c.strategy === "trend_exhaustion_reversal");
  const mine = t.setups.filter((x) => x.strategy === "trend_exhaustion_reversal");
  return (
    <div className="side">
      <b>Reversal evidence</b> <span className="mut">(Trend Exhaustion Reversal)</span>
      <div style={{ marginTop: 3 }}>
        <b>Weakening trend</b>{" "}
        <span className="mut">
          (regime fact: {wk ? wk.state : "unknown"}
          {wk ? " — " + wk.summary : ""})
        </span>
      </div>
      {wk ? <CheckLines cs={wk.checks} /> : <div className="why mut">not available</div>}
      <div style={{ marginTop: 3 }}>
        <b>15M structural reversal and the counter-trend permission</b> <span className="mut">(every check: Counter-trend permission section)</span>
      </div>
      {cts.length ? (
        cts.map((c, i) => (
          <Fragment key={i}>
            <div className={`why ${c.granted ? "up" : "flat"}`}>
              <b>{c.side}</b>: permission {c.granted ? "GRANTED" : "DENIED"} — {c.reason}
            </div>
            <CheckLines cs={(c.checks ?? []).filter((q) => q.ok !== true)} />
            {c.structure ? <div className="why mut">{structureLine(c.structure, c.side)}</div> : null}
          </Fragment>
        ))
      ) : (
        <div className="why mut">nothing to decide: there is no established trend or extension to reverse</div>
      )}
      <div style={{ marginTop: 3 }}>
        <b>5M confirmation</b>
      </div>
      {mine.length ? (
        mine.map((x) => (
          <div key={x.id} className={`why ${x.candle_confirmed ? "up" : "mut"}`}>
            {x.direction} · 5M confirmation: {x.candle_confirmed ? "a completed 5M candle has closed through the trigger" : "not yet: " + x.confirm_text}
          </div>
        ))
      ) : (
        <div className="why mut">5M confirmation: nothing to confirm yet: no setup exists until the 15M structural change has been confirmed</div>
      )}
    </div>
  );
}

/** One strategy, expandable: each side (CE call / PE put) on its own, the scanner's own note for it (never merged), the live setup and the last one that ended. */
function StrategyDetail({ z, t, stale, os }: { z: StrategyMonitor; t: Trading; stale: boolean; os: OpenState }) {
  const key = "sd-" + z.id;
  const sides: StrategySide[] = z.sides ?? [];
  const live = t.setups.filter((x) => x.strategy === z.id);
  const pill = (sd: StrategySide) => (
    <span className={`pillst ${sd.applicable || sd.setup_id ? "" : "mut"}`} title={sd.note || ""}>
      {sd.side} <span className={`st st-${sd.state}`}>{stateWord(sd.state, stale)}</span>
    </span>
  );
  return (
    <details className="sd" data-key={key} open={os.isOpen(key)} onToggle={(e) => os.setOpen(key, e.currentTarget.open)}>
      <summary>
        <span className="nm">{z.name}</span>
        <span>
          {sides.map((sd, i) => (
            <Fragment key={sd.side}>
              {i ? " " : ""}
              {pill(sd)}
            </Fragment>
          ))}
        </span>
        <span className="sn" title={z.why}>
          {z.why}
        </span>
      </summary>
      <div className="sdbody">
        <div className="mut">
          <b>Market conditions:</b> {z.why}{" "}
          <span className="mut">
            · id <code>{z.id}</code>
          </span>
        </div>
        {sides.map((sd) => {
          const x = live.find((l) => l.direction === sd.side);
          const ended = (t.recent ?? []).find((r) => r.strategy === z.id && r.direction === sd.side);
          return (
            <div key={sd.side} className={`side ${sd.side.toLowerCase()}`}>
              <b>{SIDE_LONG[sd.side] || sd.side}</b>{" "}
              <span className={`pillst ${sd.applicable || sd.setup_id ? "" : "mut"}`}>
                <span className={`st st-${sd.state}`}>{stateWord(sd.state, stale)}</span>
              </span>
              {x ? (
                <SetupCard x={x} stale={stale} />
              ) : sd.note ? (
                <div className="why flat">
                  {sd.applicable ? "no setup" : "not applicable"}: {sd.note}
                </div>
              ) : sd.scanned ? (
                <div className="mut">no setup</div>
              ) : (
                <div className="mut">not scanned: the market is closed or has not opened</div>
              )}
              {ended ? (
                <div className="why mut">
                  last ended today: <span className={`st st-${ended.status}`}>{ended.status.toLowerCase()}</span> — {ended.note}
                </div>
              ) : null}
            </div>
          );
        })}
        {z.id === "trend_exhaustion_reversal" ? <ReversalEvidence t={t} /> : null}
      </div>
    </details>
  );
}

/** A strategy that holds a live setup opens by itself, once: after that its open or closed state is the reader's. */
export function useAutoOpen(t: Trading | null, seen: Set<string>, os: OpenState): void {
  const ref = useRef(os);
  ref.current = os;
  useEffect(() => {
    if (!t) return;
    for (const z of t.strategies) {
      const key = "sd-" + z.id;
      if (t.setups.some((x) => x.strategy === z.id) && !seen.has(key)) {
        seen.add(key);
        ref.current.setOpen(key, true);
      }
    }
  });
}

/** All ten strategies, each side on its own, then the decision's reasons and the market in words. Nothing is calculated here: the setups and their states are the backend's. */
export function StrategyAnalysis({ t, stale, os }: { t: Trading; stale: boolean; os: OpenState }) {
  const d = t.decision;
  const m = t.market;
  const context: ReactNode[] = [];
  if (m && m.gap) context.push(`opened ${m.gap.points >= 0 ? "+" : ""}${m.gap.points.toFixed(0)} pts (${m.gap.percent.toFixed(2)}%) from the previous close`);
  if (m && m.atr) context.push(`candle size ATR5 ${atrNote(m.atr["5m"])}, ATR15 ${atrNote(m.atr["15m"])}`);
  if (t.data) {
    context.push(
      <>
        data {t.data.ok ? "complete" : <b className="flat">incomplete</b>} · price age {t.data.price_age == null ? "–" : t.data.price_age.toFixed(1) + " s"}
      </>,
    );
  }
  return (
    <>
      <div className="mut" style={{ marginBottom: 4 }}>
        Every strategy, each side on its own: a strategy that holds a live setup opens by itself. The CE and PE reasons are never merged.
      </div>
      {t.strategies.length ? t.strategies.map((z) => <StrategyDetail key={z.id} z={z} t={t} stale={stale} os={os} />) : <div className="mut">no strategy data</div>}
      <div style={{ marginTop: 6 }}>
        <b>{d.headline}</b>
      </div>
      {d.reasons.map((q, i) => (
        <div key={"r" + i} className="why up" style={{ marginLeft: 12 }}>
          + {q}
        </div>
      ))}
      {d.against.map((q, i) => (
        <div key={"a" + i} className="why flat" style={{ marginLeft: 12 }}>
          − {q}
        </div>
      ))}
      {(d.also ?? []).length ? (
        <div className="mut" style={{ marginLeft: 12 }}>
          also matches: {(d.also ?? []).join(", ")}
        </div>
      ) : null}
      {m ? (
        <div className="mut" style={{ marginLeft: 12 }}>
          {m.text}
        </div>
      ) : null}
      {context.length ? (
        <div className="mut" style={{ marginLeft: 12 }}>
          {context.map((c, i) => (
            <Fragment key={i}>
              {i ? " · " : ""}
              {c}
            </Fragment>
          ))}
        </div>
      ) : null}
    </>
  );
}
