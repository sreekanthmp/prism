import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChartFetcher } from "../chartApi";
import { allOn, candleBars, decisionMarkers, detailFor, FACT_HELP, legendFor, sameToggles, setupLine, simpleOn, TOGGLES, type Detail, type Role, type Toggles } from "../chartModel";
import { CHART_TIMEFRAMES, type ChartData, type ChartFacts, type ChartTimeframe } from "../chartTypes";
import { CHART_RETRY_MS, useChart } from "../useChart";
import { fmtT, n1, n2 } from "../format";
import { actionWord } from "../labels";
import type { JournalRow } from "../types";
import { lookOf, PriceChart, type ChartHandle } from "./PriceChart";

/** What the viewer chose: kept by the page, so leaving the tab and coming back finds the chart as it was left. */
export interface ChartPrefs {
  timeframe: ChartTimeframe;
  on: Toggles;
}
export const defaultPrefs: ChartPrefs = { timeframe: "5m", on: simpleOn }; // the simple view to begin with: the swings and the other levels are one click away

/** A sample of how a kind of line looks on the chart (its colour, its dashes, its fade): drawn next to the name of the box that switches it, so the controls are also the key to the lines. */
const Seg = ({ role }: { role: Role }) => {
  const l = lookOf(role);
  return <i className="ksw" style={{ borderTopColor: l.css, borderTopStyle: l.border, opacity: l.opacity }} aria-hidden="true" />;
};
const KEY: Record<keyof Toggles, ReactNode> = {
  ema20: <i className="ksw" style={{ borderTopColor: "var(--ema20)" }} aria-hidden="true" />,
  ema50: <i className="ksw" style={{ borderTopColor: "var(--ema50)" }} aria-hidden="true" />,
  levels: <><Seg role="previous" /><Seg role="open" /><Seg role="support" /><Seg role="resistance" /></>,
  moreLevels: <><Seg role="support" /><Seg role="resistance" /></>,
  setups: <><Seg role="trigger" /><Seg role="invalidation" /><Seg role="target" /></>,
  swings: <><i className="kmk dn" aria-hidden="true" /><i className="kmk up" aria-hidden="true" /></>,
  decisions: <i className="kmk dot" aria-hidden="true" />,
};

function Facts({ f, daily }: { f: ChartFacts | null | undefined; daily: boolean }) {
  if (!f) return <p className="mut chart-facts">{daily ? "Prism reads no trend from daily candles: this chart shows them as they are." : "No indicators yet."}</p>;
  return (
    <p className="chart-facts" data-testid="chart-facts">
      <span title={FACT_HELP.trend}>Trend <b className={f.trend === "bullish" ? "up" : f.trend === "bearish" ? "down" : "flat"}>{f.trend}</b></span>
      <span title={FACT_HELP.adx}>ADX {n1(f.adx)}</span>
      <span title={FACT_HELP.rsi}>RSI {n1(f.rsi14)}</span>
      <span title={FACT_HELP.atr}>ATR(14) {n1(f.atr14_intraday)}</span>
      <span title={FACT_HELP.ema20}>EMA 20 {n2(f.ema20)}</span>
      <span title={FACT_HELP.ema50}>EMA 50 {n2(f.ema50)}</span>
      {f.warm ? null : <span className="mut">still warming up ({f.bars} bars)</span>}
    </p>
  );
}

/** What the candle under the mouse (or the latest one) says beyond its four prices: its size, how it closed, where it closed against the EMAs, the nearest level under and over it, and what Prism's decision said on it. */
function DetailLine({ d }: { d: Detail }) {
  return (
    <div className="chart-detail" data-testid="chart-detail">
      <span>Size <b>{d.range}</b>{d.atr ? ` (${d.atr})` : ""}</span>{" "}
      <span>It {d.body}</span>{" "}
      {d.ema20 ? <span>EMA 20 {d.ema20}</span> : null}{" "}
      {d.ema50 ? <span>EMA 50 {d.ema50}</span> : null}{" "}
      {d.below ? <span>Nearest level under: <b>{d.below.label} {d.below.price}</b> ({d.below.where})</span> : null}{" "}
      {d.above ? <span>over: <b>{d.above.label} {d.above.price}</b> ({d.above.where})</span> : null}{" "}
      {d.decisions.map((x) => <span key={x} className="said">Prism said {x}</span>)}
    </div>
  );
}

/** What every line, arrow and label on the chart is, in words. Static: it says what the chart draws, and promises nothing about what price will do. */
function Guide() {
  const sw = (css: string, kind: "line" | "dot" = "line") => <i className={`sw ${kind}`} style={{ background: css }} aria-hidden="true" />;
  return (
    <details className="sec chart-guide" data-testid="chart-guide">
      <summary>How to read this chart <span className="mut">what every line, arrow and number is</span></summary>
      <div className="secbody">
        <div><b>Candles.</b> Green: the candle closed above where it opened. Red: it closed below. While the market is open the last one is still forming.</div>
        <div>{sw("var(--ema20)")} <b>EMA 20</b> and {sw("var(--ema50)")} <b>EMA 50</b>: moving averages of the close, the fast one and the slow one. They smooth the candles so the direction is easier to see.</div>
        <div><b>Swings</b> (off to begin with). An <b>H</b> (a red arrow over a candle) at every confirmed swing high and an <b>L</b> (a green arrow under one) at every swing low: turning points that Prism has confirmed and uses for its structure. There are a lot of them, which is why they are off to begin with.</div>
        <div><b>Decisions.</b> Where Prism's decision <i>changed</i> today: a green <b>CE setup</b> arrow under a candle, a red <b>PE setup</b> arrow over it, an {sw("var(--warn)", "dot")} amber dot for WAIT and a {sw("var(--mut)", "dot")} grey dot for NO TRADE. They come from today's journal (it is kept for one day at a time), so an earlier day has none, and neither has the daily chart.</div>
        <div>
          <b>Key levels.</b> <Seg role="previous" /> <b>Prev day high, low and close</b> (amber, dotted), <Seg role="open" /> <b>Today's open</b> (grey, dotted), <Seg role="support" /> <b>Support</b> (a floor: green, dashed, the nearest one at or under the price) and <Seg role="resistance" />{" "}
          <b>Resistance</b> (a ceiling: red, dashed, the nearest one over it). "3 touches" is how many times price turned there: more is stronger. Levels that sit within about three quarters of a candle of one another are drawn once, under both names ("Prev day close + Support").
        </div>
        <div><b>More levels</b> (off to begin with). Every other support and resistance Prism found. Press <b>Everything</b> to see all of it, <b>Simple</b> to go back.</div>
        <div><b>Setups.</b> Only while one is live: a {sw("var(--acc)")} dashed <b>trigger</b>, a {sw("var(--ok)")} dotted <b>entry area</b>, a {sw("var(--bad)")} solid <b>invalidation</b> (the setup is over beyond it) and {sw("var(--ok)")} dashed <b>targets</b>. They are written out under the chart too.</div>
        <div><b>The line under the legend.</b> For the candle under the mouse (the latest one when the mouse is away): how big it was, how it closed, where it closed against the two EMAs, the nearest level under it and over it, and what Prism's decision said on it.</div>
        <div><b>The numbers under the chart.</b> Hover each one for what it means. They are computed on this timeframe's candles.</div>
        <div className="mut">Prism draws only what it computes: it finds no candlestick or chart patterns here, and none of this tells you to buy or sell. You decide.</div>
      </div>
    </details>
  );
}

/**
 * The Chart tab (Stage 9.2): NIFTY's candles from Prism's own data and, on them, only what Prism itself computes: the EMAs, the confirmed swings, the previous day's levels, the nearest support and
 * resistance and the live setups (trigger, entry area, invalidation, targets). No candlestick pattern or chart pattern is detected here. Under the chart the same setups are written out in words and
 * numbers, so nothing has to be read off the lines.
 */
export function ChartTab({ prefs, onPrefs, paused, fetcher, onReady, decisions }: { prefs: ChartPrefs; onPrefs: (p: ChartPrefs) => void; paused: boolean; fetcher?: ChartFetcher; onReady?: (h: ChartHandle) => void; decisions?: JournalRow[] | null }) {
  const tf = CHART_TIMEFRAMES.find((t) => t.id === prefs.timeframe) ?? CHART_TIMEFRAMES[1];
  const state = useChart(tf.id, tf.limit, paused, fetcher);
  const data: ChartData | null = state.data?.timeframe === tf.id ? state.data : null; // (the render before the reset has the old timeframe's answer: it is not shown under the new name)
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setHover(null), [tf.id]);
  const bars = useMemo(() => (data?.available ? candleBars(data) : null), [data]);
  const shown = bars ? (hover !== null && hover < bars.bars.length ? hover : bars.bars.length - 1) : -1;
  const legend = bars ? legendFor(bars.bars, shown) : null;
  const marks = useMemo(() => (data?.available && bars ? decisionMarkers(decisions, bars.bars, data.seconds) : []), [data, bars, decisions]);
  const detail = data?.available && bars ? detailFor(data, bars.bars, shown, decisions) : null;

  return (
    <div className="chart-tab" data-testid="chart-tab">
      <div className="chart-bar">
        <div role="group" aria-label="Timeframe" className="seg">
          {CHART_TIMEFRAMES.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === tf.id} onClick={() => onPrefs({ ...prefs, timeframe: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="View" className="seg" title="Simple: the candles, the two averages, the key levels, the setup's lines and where the decision changed. Everything: also the swing arrows and every other support and resistance.">
          <button type="button" aria-pressed={sameToggles(prefs.on, simpleOn)} onClick={() => onPrefs({ ...prefs, on: simpleOn })}>Simple</button>
          <button type="button" aria-pressed={sameToggles(prefs.on, allOn)} onClick={() => onPrefs({ ...prefs, on: allOn })}>Everything</button>
        </div>
        <div role="group" aria-label="On the chart" className="toggles">
          {TOGGLES.map((t) => (
            <label key={t.id} title={t.hint}>
              <input type="checkbox" checked={prefs.on[t.id]} onChange={(e) => onPrefs({ ...prefs, on: { ...prefs.on, [t.id]: e.target.checked } })} /> {KEY[t.id]}
              {t.label}
            </label>
          ))}
        </div>
      </div>

      <div className="panel chart-panel">
        <div className="chart-legend" data-testid="chart-legend">
          <b>NIFTY 50</b> · {tf.label}
          {legend ? (
            <>
              {" "}· {legend.when} <span>O {legend.open}</span> <span>H {legend.high}</span> <span>L {legend.low}</span> <span>C {legend.close}</span> <span className={legend.tone}>{legend.change}</span>
              {bars?.forming && (hover === null || hover >= (bars?.bars.length ?? 0) - 1) ? <span className="mut"> · forming</span> : null}
            </>
          ) : null}
        </div>

        {detail ? <DetailLine d={detail} /> : null}

        {state.error && data ? (
          <p className="chart-warn" role="status" data-testid="chart-error">
            The last update failed ({state.error}). Showing the candles as of {fmtT(data.as_of)}; trying again in {CHART_RETRY_MS / 1000} s.
          </p>
        ) : null}

        {!data ? (
          <p className={state.status === "error" ? "chart-status err" : "chart-status mut"} role="status" data-testid="chart-status">
            {state.status === "error"
              ? `Prism's chart data could not be read: ${state.error}. Trying again every ${CHART_RETRY_MS / 1000} s.`
              : paused
                ? "The link to Prism is down: there is nothing to draw until it is back."
                : `Loading the ${tf.label} candles from Prism…`}
          </p>
        ) : !data.available ? (
          <p className="chart-status mut" role="status" data-testid="chart-status">Nothing to draw yet: {data.reason ?? "Prism has no candles to show"}</p>
        ) : (
          <PriceChart data={data} on={prefs.on} decisions={marks} onHover={setHover} onReady={onReady} />
        )}
      </div>

      {data?.available ? (
        <>
          <Facts f={data.facts} daily={tf.id === "1d"} />
          <div className="panel" data-testid="chart-setups">
            <h3>Prism's setups on this chart{data.decision?.action ? ` · decision: ${actionWord(data.decision.action)}` : ""}</h3>
            {data.setups.length === 0 ? (
              <p className="mut">No setup is live. While one is, its trigger, entry area, invalidation and targets are drawn on the chart and written out here.</p>
            ) : (
              <ul className="setup-list">
                {data.setups.map((s) => {
                  const l = setupLine(s);
                  return (
                    <li key={l.id} className={`${s.direction === "CE" ? "ce" : "pe"}${l.focus ? " focus" : ""}`}>
                      <b>{l.head}</b>{l.focus ? <span className="mut"> · the decision's setup</span> : null}
                      <div>{l.stage}</div>
                      <div className="nums">{l.prices.map((p) => <span key={p}>{p}</span>)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {data.warnings?.length ? <ul className="chart-notes warn" data-testid="chart-warnings">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          {data.notes?.length ? <ul className="chart-notes mut" data-testid="chart-notes">{data.notes.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          <Guide />
          <p className="mut chart-credit">
            Candles and everything on them are Prism's own data, as of {fmtT(data.as_of)}. Chart by TradingView Lightweight Charts™.
          </p>
        </>
      ) : null}
    </div>
  );
}
