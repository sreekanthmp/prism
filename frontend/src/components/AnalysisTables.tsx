import { fmtD, fmtDT, fmtT, n1, n2, DASH } from "../format";
import { lastSwing, PATTERN, TFS, TF_ORDER } from "../analysisModel";
import { arrow, cls, LABEL } from "../overviewModel";
import type { Analysis, Candle, Snapshot, Trading } from "../types";

const px = n2; // prices are written as the header writes them

/** The indicators of each timeframe, from completed candles only. */
export function TechTable({ a }: { a: Analysis }) {
  return (
    <div className="scroll">
      <table className="t">
        <tbody>
          <tr>
            <th>TF</th>
            <th className="l">Trend</th>
            <th>EMA20</th>
            <th>EMA50</th>
            <th>RSI</th>
            <th>ADX</th>
            <th>+DI</th>
            <th>-DI</th>
            <th>ATR</th>
            <th className="l">Break</th>
          </tr>
          {TF_ORDER.map((tf) => {
            const t = a.timeframes![tf]!;
            return (
              <tr key={tf}>
                <td>{LABEL[tf]}</td>
                <td className={`l ${cls(t.trend)}`}>
                  {arrow(t.trend)} {t.trend}
                  {t.warm ? "" : " (warming up)"}
                </td>
                <td>{n2(t.ema20)}</td>
                <td>{n2(t.ema50)}</td>
                <td>{n1(t.rsi14)}</td>
                <td>{n1(t.adx)}</td>
                <td>{n1(t.plus_di)}</td>
                <td>{n1(t.minus_di)}</td>
                <td>{n2(t.atr14)}</td>
                <td className="l">{t.breakout ?? "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Swing highs and lows, and whether the market makes higher highs or lower lows; a consolidation range where there is one. */
export function StructureBlock({ a }: { a: Analysis }) {
  const f = (x: { price: number; start: number } | undefined) =>
    x ? (
      <>
        {n2(x.price)} <span className="mut">({fmtDT(x.start)})</span>
      </>
    ) : (
      "–"
    );
  return (
    <>
      <div className="scroll">
        <table className="t">
          <tbody>
            <tr>
              <th>TF</th>
              <th className="l">Pattern</th>
              <th className="l">Last swing high</th>
              <th className="l">Last swing low</th>
              <th className="l">Consolidation</th>
            </tr>
            {TF_ORDER.map((tf) => {
              const t = a.timeframes![tf]!;
              const st = t.structure ?? { pattern: "", recent_swings: [] };
              const sw = st.recent_swings ?? [];
              return (
                <tr key={tf}>
                  <td>{LABEL[tf]}</td>
                  <td className="l">
                    {PATTERN[st.pattern] || st.pattern || "–"}
                    {t.consolidation ? " · range" : ""}
                  </td>
                  <td className="l">{f(lastSwing(sw, "H"))}</td>
                  <td className="l">{f(lastSwing(sw, "L"))}</td>
                  <td className="l">{t.consolidation ? n2(t.consolidation.low) + " – " + n2(t.consolidation.high) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(["1h", "15m", "5m"] as const).map((tf) => {
        const sw = a.timeframes![tf]!.structure?.recent_swings ?? [];
        return (
          <div key={tf} className="mut">
            {LABEL[tf]} recent swings: {sw.map((x) => (x.kind === "H" ? "high " : "low ") + n2(x.price)).join(" · ") || "–"}
          </div>
        );
      })}
    </>
  );
}

/** The previous day, the opening range, the session and the nearest support and resistance. */
export function LevelsBlock({ a, t }: { a: Analysis; t: Trading | null }) {
  const ref = a.reference!;
  const pd = ref.previous_day;
  const lv = a.levels!;
  const fmtL = (l: { price: number; touches: number }[]) => l.map((x) => n2(x.price) + " (x" + x.touches + ")").join(", ") || "–";
  const orr = t?.session?.opening_range;
  return (
    <div className="lv">
      <div>
        Previous day
        {pd ? (
          <>
            {" "}
            ({pd.date}
            {pd.stale ? (
              <>
                , <span className="flat">stale</span>
              </>
            ) : (
              ""
            )}
            )
          </>
        ) : (
          ""
        )}
        :{" "}
        {pd ? (
          <>
            PDH <b>{n2(pd.pdh)}</b> · PDL <b>{n2(pd.pdl)}</b> · PDC <b>{n2(pd.pdc)}</b>
          </>
        ) : (
          <span className="mut">not available</span>
        )}
      </div>
      <div>
        Opening range:{" "}
        {orr ? (
          <>
            <b>
              {n2(orr.low)} – {n2(orr.high)}
            </b>
            {orr.complete ? "" : " (forming)"}
          </>
        ) : (
          <span className="mut">not available</span>
        )}
      </div>
      <div>
        Session {ref.session_date ?? "–"}: open <b>{n2(ref.session_open)}</b> ·{" "}
        {ref.vwap != null ? (
          <>
            VWAP <b>{n2(ref.vwap)}</b>
          </>
        ) : (
          <>
            VWAP not available <span className="mut">({ref.vwap_note || "no volume"})</span> · session average price (not a VWAP) <b>{n2(ref.session_avg_price)}</b>
          </>
        )}
      </div>
      <div>
        <span className="down">Resistance</span> {fmtL(lv.resistance)} {" · "} <span className="up">Support</span> {fmtL(lv.support)}
      </div>
    </div>
  );
}

const partial = <span className="partial" title="partial: data gap or app started mid-candle">partial</span>;

/** The last completed and the forming candle of each timeframe, what is missing, the live candles of the charted instruments, and what history Prism holds. */
export function CandleBlock({ s, a }: { s: Snapshot; a: Analysis }) {
  const h = a.history ?? {};
  const cov = Object.entries(h.coverage ?? {}).map(([tf, x]) => `${tf.toUpperCase()} ${x.bars} candles (${fmtDT(x.first)} → ${fmtDT(x.last)})`).join(" · ");
  const closed = (k: Candle | null | undefined) => (k ? fmtDT(k.start) + " C " + n2(k.close) : "–");
  return (
    <>
      <div className="scroll">
        <table className="t">
          <tbody>
            <tr>
              <th>TF</th>
              <th className="l">Trend</th>
              <th title="missing intervals: latest session / whole window">Missing</th>
              <th className="l">Last completed</th>
              <th className="l">Forming</th>
            </tr>
            {TF_ORDER.map((tf) => {
              const t = a.timeframes![tf]!;
              const f = a.forming?.[tf];
              const m = t.missing ?? { latest_session_missing: 0, missing: 0 };
              return (
                <tr key={tf}>
                  <td>{LABEL[tf]}</td>
                  <td className="l">{t.trend}</td>
                  <td className={m.latest_session_missing ? "partial" : "mut"}>
                    {m.latest_session_missing} / {m.missing}
                  </td>
                  <td className="l">{closed(t.last_completed)}</td>
                  <td className="l">{f ? fmtDT(f.start) + " C " + n2(f.close) + (f.partial ? " (partial)" : "") : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mut" style={{ margin: "6px 0" }}>
        Live candles (current forming / last closed)
      </div>
      <div className="scroll">
        <table className="t">
          <tbody>
            <tr>
              <th>Role</th>
              <th>TF</th>
              <th>Start</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Close</th>
              <th>Vol</th>
              <th>Ticks</th>
              <th className="l">Last closed</th>
            </tr>
            {s.instruments.flatMap((i) =>
              TFS.filter((tf) => i.candles?.[tf]).map((tf) => {
                const { current: k, last_closed: l } = i.candles![tf]!;
                return (
                  <tr key={i.token + tf}>
                    <td>{i.role}</td>
                    <td>{tf}</td>
                    {k ? (
                      <>
                        <td>
                          {fmtT(k.start, false)}
                          {k.partial ? <> {partial}</> : ""}
                        </td>
                        <td>{px(k.open)}</td>
                        <td>{px(k.high)}</td>
                        <td>{px(k.low)}</td>
                        <td>{px(k.close)}</td>
                        <td>{k.volume ?? "–"}</td>
                        <td>{k.ticks}</td>
                      </>
                    ) : (
                      <td className="mut" colSpan={7}>
                        no candle yet
                      </td>
                    )}
                    {l ? (
                      <td className="l">
                        {fmtT(l.start, false)} C {px(l.close)}
                        {l.partial ? (
                          <>
                            {" "}
                            <span className="partial">partial</span>
                          </>
                        ) : (
                          ""
                        )}
                        {l.source === "history" ? " (hist)" : ""}
                      </td>
                    ) : (
                      <td className="mut l">–</td>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      <div className="lv mut" style={{ marginTop: 6 }}>
        <div>
          Historical data: <b>{h.state}</b>
          {h.error ? (
            <>
              {" — "}
              <span className="flat">{h.error}</span>
            </>
          ) : (
            ""
          )}
        </div>
        <div>
          Last successful refresh: {h.loaded_at ? fmtD(h.loaded_at) + " IST (for session " + h.as_of_date + ")" : "none yet"}
          {h.stale ? (
            <>
              {" — "}
              <span className="flat">not refreshed for today's session</span>
            </>
          ) : (
            ""
          )}
        </div>
        <div>Coverage: {cov || DASH}</div>
      </div>
    </>
  );
}
