import { Fragment, useEffect, type ReactNode } from "react";
import { arrow, cls } from "../overviewModel";
import type { Analysis as AnalysisData, Snapshot } from "../types";
import { ContractsTable, GapsAndErrors, HealthDetail } from "./AnalysisHealth";
import { PermissionBlock, RegimeFactsBlock, StrategyAnalysis, useAutoOpen, type OpenState } from "./AnalysisStrategies";
import { CandleBlock, LevelsBlock, StructureBlock, TechTable } from "./AnalysisTables";

/** A section that opens and closes. Whether it is open is the page's to keep (it survives the once-a-second redraw and a visit to another tab), so it is passed in. */
export function Sec({ k, title, hint, os, children }: { k: string; title: string; hint?: string; os: OpenState; children: ReactNode }) {
  return (
    <details className="sec" data-key={k} open={os.isOpen(k)} onToggle={(e) => os.setOpen(k, e.currentTarget.open)}>
      <summary>
        {title}
        {hint ? (
          <>
            {" "}
            <span className="mut">{hint}</span>
          </>
        ) : null}
      </summary>
      <div className="secbody">{children}</div>
    </details>
  );
}

export interface Focus {
  key: string; // the details to scroll to once the tab is drawn
  n: number; // a new number for every ask, so the same strategy can be asked for twice
}

/**
 * The Analysis tab (Stage 9.5): everything behind the decision. What it is made of comes first (the regime facts, the counter-trend permission, every strategy, each side on its own), then the indicator
 * tables, which are read less often, then the health of the data. It is the current dashboard's Analysis tab, port for port; nothing on it is calculated here.
 */
export function AnalysisTab({ snapshot, stale, os, seen, focus, onFocused }: { snapshot: Snapshot | null; stale: boolean; os: OpenState; seen: Set<string>; focus: Focus | null; onFocused: () => void }) {
  const t = snapshot?.trading ?? null;
  useAutoOpen(t, seen, os);
  useEffect(() => {
    if (!focus) return;
    const el = document.querySelector(`[data-key="${focus.key.replace(/["\\]/g, "\\$&")}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "start" });
    onFocused();
  }, [focus, onFocused]);
  if (!snapshot) return <div id="analysis-body" />;
  const s = snapshot;
  const a: AnalysisData = s.analysis ?? { available: false };
  const c = a.available ? a.condition : undefined;
  return (
    <div id="analysis-body">
      {(a.warnings ?? []).map((w, i) => (
        <div key={i} className="warnbox">
          ⚠ {w}
        </div>
      ))}
      {!a.available || !c ? (
        <div className="panel mut" style={{ marginBottom: 6 }}>
          Analysis not available yet ({(a.history ?? {}).state || "loading"}).
        </div>
      ) : (
        <div className="bar">
          <span>
            Direction{" "}
            <b className={cls(c.trend)}>
              {arrow(c.trend)} {c.trend.toUpperCase()}
            </b>
          </span>
          <span>
            Volatility <b>{c.volatility}</b>
          </span>
          <span title={c.alignment.text}>
            Timeframes <b>{c.alignment.label.replace(/_/g, " ")}</b>
          </span>
          <span className="mut">completed candles only; the forming candle is shown separately</span>
          {a.reliable ? <span className="up">data complete</span> : <span className="flat">⚠ incomplete data — see warnings</span>}
        </div>
      )}
      {t ? (
        <>
          <Sec k="a-regime" title="Market regime facts" hint="strong or weakening trend, compression, expansion, extension, range / pause / pullback / breakout" os={os}>
            <RegimeFactsBlock rf={t.market?.regime_facts} />
          </Sec>
          <Sec k="a-ct" title="Counter-trend permission" hint="granted or denied, and the structure behind it" os={os}>
            <div className="mut" style={{ marginBottom: 4 }}>
              Only Trend Exhaustion Reversal may trade against the 1H or 15M trend, and only after a confirmed 15M structural reversal; a 5M break is still required, and every other check still applies. Granted or denied, it is recorded here and in the journal.
            </div>
            {(t.counter_trend ?? []).length ? (t.counter_trend ?? []).map((ct, i) => <PermissionBlock key={i} c={ct} />) : <div className="mut">Nothing to decide: there is no established trend or extension to reverse.</div>}
          </Sec>
          <Sec k="a-strat" title="Strategy analysis: all ten strategies" hint="each side on its own: state, trigger, entry zone, invalidation, expiry, evidence, blockers" os={os}>
            <StrategyAnalysis t={t} stale={stale} os={os} />
          </Sec>
          <Sec k="a-setups" title="Ended setups" hint="live setups are under their strategy above" os={os}>
            {t.recent.length ? (
              t.recent.map((x, i) => (
                <div key={i}>
                  {x.direction} {x.strategy_name}: <span className={`st st-${x.status}`}>{x.status.toLowerCase()}</span> — <span className="mut">{x.note}</span>
                </div>
              ))
            ) : (
              <div className="mut">none today</div>
            )}
          </Sec>
          {/* The current dashboard builds a "Confirmation, invalidation and blockers" section here and then discards it (a comma where a plus was meant), so it has never been shown: neither is it here, so that the two
              say the same thing. The same account is under "Explain this decision" on the Overview. */}
        </>
      ) : null}
      {a.available && c ? (
        <>
          <Sec k="a-tech" title="Technical analysis: 1H · 15M · 5M · 1M" hint="trend, EMA20 / EMA50, RSI, ADX / DI, ATR, breakout" os={os}>
            <div className="mut" style={{ marginBottom: 4 }}>
              {c.reasons.map((r, i) => (
                <Fragment key={i}>
                  {i ? <br /> : null}
                  {r}
                </Fragment>
              ))}
            </div>
            <TechTable a={a} />
          </Sec>
          <Sec k="a-struct" title="Market structure" hint="swing highs and lows, higher highs / lower lows, consolidation" os={os}>
            <StructureBlock a={a} />
          </Sec>
          <Sec k="a-levels" title="Support, resistance and reference levels" hint="previous day, opening range, session" os={os}>
            <LevelsBlock a={a} t={t} />
          </Sec>
          <Sec k="a-candles" title="Candle information" hint="last completed, forming, missing, coverage" os={os}>
            <CandleBlock s={s} a={a} />
          </Sec>
        </>
      ) : null}
      <Sec k="a-health" title="Data health detail" hint="feed, clock, candle recovery, official-candle check" os={os}>
        <HealthDetail s={s} h={s.health} />
      </Sec>
      <Sec k="a-contracts" title="Instruments and contracts" hint="each instrument's own quote, exchange time and receipt time" os={os}>
        <ContractsTable s={s} />
      </Sec>
      <Sec k="a-gaps" title="Data gaps and errors" os={os}>
        <GapsAndErrors s={s} />
      </Sec>
    </div>
  );
}
