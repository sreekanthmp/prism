import { useEffect, useRef } from "react";
import { fmtT, n2 } from "../format";
import { rs } from "../tradesModel";
import type { RiskAnswer, Snapshot, TradeRow, TradesAvailable } from "../types";
import type { RiskState } from "../useRisk";
import type { TradesState } from "../useTrades";

const quiet = { textTransform: "none", letterSpacing: 0 } as const;

function Tstat({ d }: { d: TradesAvailable }) {
  const lim = d.limits ?? { capital: null, per_trade_pct: null, per_trade_loss: null, max_daily_loss: null };
  const used = d.daily_loss_used_pct;
  return (
    <div className="tstat">
      <span>
        Realised <b className={d.realised > 0 ? "up" : d.realised < 0 ? "down" : ""}>{rs(d.realised)}</b>
      </span>
      <span>
        Loss limit for the day <b>{lim.max_daily_loss ? rs(lim.max_daily_loss) : "not set"}</b>
        {used != null ? (
          <>
            {" "}
            <span className={d.daily_loss_reached ? "down" : used >= 75 ? "flat" : "mut"}>({used.toFixed(0)}% used)</span>
          </>
        ) : null}
      </span>
      <span>
        Open <b>{d.open.length ? d.open.map((o) => `${o.instrument} ${o.qty} @ ${n2(o.average_price)}`).join("; ") : "nothing"}</b>
      </span>
    </div>
  );
}

function TradeLine({ x, onVoid }: { x: TradeRow; onVoid: (id: string) => void }) {
  const result = x.pnl || x.lot_pnl || 0;
  return (
    <tr>
      <td>{fmtT(x.t)}</td>
      <td className="l">
        <b className={x.side === "BUY" ? "up" : "down"}>{x.side}</b>
      </td>
      <td className="l">{x.instrument}</td>
      <td>{x.qty}</td>
      <td>{n2(x.price)}</td>
      <td>{x.side === "BUY" ? x.matched : ""}</td>
      <td className={result > 0 ? "up" : result < 0 ? "down" : ""}>
        {x.pnl != null ? (
          rs(x.pnl)
        ) : x.lot_pnl != null && x.matched ? (
          <span className="mut" title="what the part of this buy that has been sold made">
            {rs(x.lot_pnl)}
          </span>
        ) : (
          ""
        )}
      </td>
      <td className="l">
        {x.prism ? (
          <>
            {x.prism.action || "–"}
            {x.prism.price != null ? (
              <>
                {" "}
                <span className="mut">at {n2(x.prism.price)}</span>
              </>
            ) : null}
            {x.followed ? (
              <>
                {" "}
                <span className={x.followed === "no" ? "flat" : "up"}>· followed Prism: {x.followed}</span>
              </>
            ) : null}
          </>
        ) : (
          ""
        )}
      </td>
      <td className="l mut">
        {x.note || ""}
        {x.setup_id ? (
          <>
            {" "}
            <span title="the setup you named">{x.setup_id}</span>
          </>
        ) : null}
      </td>
      <td>
        <button className="voidbtn" data-void={x.id} title="cancel this trade (the file is only added to: a line that cancels it)" onClick={() => onVoid(x.id)}>
          void
        </button>
      </td>
    </tr>
  );
}

function TradesBody({ trades }: { trades: TradesState }) {
  const d = trades.data;
  if (!d)
    return trades.error ? (
      <div className="warnbox">
        could not load the trades: {trades.error}{" "}
        <button className="linkbtn" id="t-refresh" type="button" onClick={trades.retry}>
          Retry
        </button>
      </div>
    ) : (
      <div className="mut">loading…</div>
    );
  if (!d.available) return <div className="warnbox">{d.reason || "the trade log is not available"}</div>;
  const lim = d.limits ?? { max_daily_loss: null };
  return (
    <div className="panel">
      <h3>
        Today's trades{" "}
        <span className="mut" style={quiet}>
          {d.file}
        </span>
      </h3>
      <Tstat d={d} />
      {d.daily_loss_reached ? (
        <div className="badbox">
          ⛔ You have reached your own loss limit for the day ({rs(d.lost_today)} of {rs(lim.max_daily_loss)}). Prism's decisions are unchanged: this limit is yours.
        </div>
      ) : null}
      {d.trades.length ? (
        <>
          <div className="scroll">
            <table className="t">
              <tbody>
                <tr>
                  <th>Time</th>
                  <th className="l">Side</th>
                  <th className="l">Instrument</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Sold</th>
                  <th>Result</th>
                  <th className="l">Prism said</th>
                  <th className="l">Note</th>
                  <th></th>
                </tr>
                {d.trades.map((x) => (
                  <TradeLine key={x.id} x={x} onVoid={(id) => void trades.voidTrade(id)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mut" style={{ marginTop: 4 }}>
            {d.basis}. The Result column adds up to the realised figure: a sell carries the result of what it closed, a buy shows (grey) what its sold part made.
          </div>
        </>
      ) : (
        <div className="mut">no trade logged today</div>
      )}
    </div>
  );
}

function RiskBody({ r }: { r: RiskAnswer }) {
  const warn = r.warnings.map((w, i) => (
    <div key={i} className="flat">
      ⚠ {w}
    </div>
  ));
  const per = `One lot (${r.lot_size} units) loses ${rs(r.loss_per_lot)} at your stop (${n2(r.entry)} to ${n2(r.stop)}) and costs ${rs(r.outlay_per_lot)} to buy.`;
  if (r.lots == null)
    return (
      <>
        <div>{per}</div>
        {warn}
      </>
    );
  const bound = r.binding === "lots_by_daily_limit" ? `what is left of today's loss limit (${rs(r.left_today)})` : `your per-trade limit (${rs(r.per_trade_loss)})`;
  return (
    <>
      <div>
        <b>
          {r.lots} lot{r.lots === 1 ? "" : "s"}
        </b>{" "}
        ({r.quantity} units): loss at the stop {rs(r.loss_at_stop)}, premium outlay {rs(r.outlay)}
        {r.outlay_pct_of_capital != null ? ` (${r.outlay_pct_of_capital.toFixed(1)}% of capital)` : ""}. Decided by {bound}.
      </div>
      <div className="mut">
        {per} By limit: per-trade {r.lots_by_trade_limit == null ? "not set" : r.lots_by_trade_limit + " lot(s)"}, today {r.lots_by_daily_limit == null ? "not set" : r.lots_by_daily_limit + " lot(s)"}. The loss at the stop
        ignores slippage, a gap through it, brokerage and tax. You decide.
      </div>
      {warn}
    </>
  );
}

/**
 * The Trades tab: a notebook of the trades you made yourself (Prism places no order and reads no account) and a size calculator. What is typed in the two forms, what was said under them and
 * what the calculator answered belong to the page (`trades`, `risk`), not to this tab, so leaving it and coming back finds them as they were.
 */
export function TradesTab({ snapshot, trades, risk }: { snapshot: Snapshot | null; trades: TradesState; risk: RiskState }) {
  const f = trades.form;
  const rf = risk.form;
  const lotSize = snapshot?.instruments.find((i) => i.lot_size)?.lot_size ?? null;
  const decisionSetup = snapshot?.trading?.decision?.setup_id ?? null;
  const lotNow = useRef(rf.lot);
  lotNow.current = rf.lot;
  const setLot = risk.setField;
  useEffect(() => {
    if (!lotNow.current && lotSize != null) setLot("lot", String(lotSize)); // the lot size of the contracts being watched, until you type another
  }, [snapshot, lotSize, setLot]);

  return (
    <>
      <div className="panel" style={{ marginBottom: 6 }}>
        <h3>
          Log a trade you made{" "}
          <span className="mut" style={quiet}>
            a notebook: Prism places no order and reads no account. What you type here, and what Prism said at that moment, are kept beside the journal
          </span>
        </h3>
        <div className="tform">
          <label>
            Instrument
            <input id="t-instr" className="wide" type="text" maxLength={60} placeholder="NIFTY 24500 CE 17NOV" autoComplete="off" value={f.instrument} onChange={(e) => trades.setField("instrument", e.target.value)} />
          </label>
          <label>
            Side
            <select id="t-side" value={f.side} onChange={(e) => trades.setField("side", e.target.value)}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </label>
          <label>
            Quantity (units)
            <input id="t-qty" type="text" inputMode="numeric" placeholder="65" autoComplete="off" value={f.qty} onChange={(e) => trades.setField("qty", e.target.value)} />
          </label>
          <label>
            Price (premium)
            <input id="t-price" type="text" inputMode="decimal" placeholder="101.50" autoComplete="off" value={f.price} onChange={(e) => trades.setField("price", e.target.value)} />
          </label>
          <label>
            Setup (optional)
            <input id="t-setup" className="wide" type="text" maxLength={120} placeholder="setup id Prism showed" autoComplete="off" value={f.setup_id} onChange={(e) => trades.setField("setup_id", e.target.value)} />
          </label>
          <label>
            Note (optional)
            <input id="t-note" className="wide" type="text" maxLength={300} autoComplete="off" value={f.note} onChange={(e) => trades.setField("note", e.target.value)} />
          </label>
          <button id="t-use-setup" type="button" title="fill the setup id with the one Prism's decision is about right now" onClick={() => decisionSetup && trades.setField("setup_id", decisionSetup)}>
            Use Prism's setup
          </button>
          <button id="t-log" type="button" onClick={() => void trades.log()}>
            Log trade
          </button>
        </div>
        <div id="t-msg" className={trades.message?.bad ? "err" : ""}>
          {trades.message?.text ?? ""}
        </div>
      </div>
      <div id="trades-body">{snapshot ? <TradesBody trades={trades} /> : null}</div>
      <div className="panel" style={{ margin: "6px 0" }}>
        <h3>
          Size a trade{" "}
          <span className="mut" style={quiet}>
            a calculator: how many lots keep the loss at YOUR stop inside YOUR limits. It does not say whether to trade
          </span>
        </h3>
        <div className="tform">
          <label>
            Entry premium
            <input id="r-entry" type="text" inputMode="decimal" placeholder="100" autoComplete="off" value={rf.entry} onChange={(e) => risk.setField("entry", e.target.value)} />
          </label>
          <label>
            Stop premium (yours)
            <input id="r-stop" type="text" inputMode="decimal" placeholder="80" autoComplete="off" value={rf.stop} onChange={(e) => risk.setField("stop", e.target.value)} />
          </label>
          <label>
            Lot size (units)
            <input id="r-lot" type="text" inputMode="numeric" autoComplete="off" value={rf.lot} onChange={(e) => risk.setField("lot", e.target.value)} />
          </label>
          <label>
            Capital (optional)
            <input id="r-capital" type="text" inputMode="decimal" placeholder="from RISK_CAPITAL" autoComplete="off" value={rf.capital} onChange={(e) => risk.setField("capital", e.target.value)} />
          </label>
          <label>
            Risk % (optional)
            <input id="r-pct" type="text" inputMode="decimal" placeholder="from RISK_PER_TRADE_PCT" autoComplete="off" value={rf.risk_pct} onChange={(e) => risk.setField("risk_pct", e.target.value)} />
          </label>
          <label>
            Day's max loss (optional)
            <input id="r-max" type="text" inputMode="decimal" placeholder="from RISK_MAX_DAILY_LOSS" autoComplete="off" value={rf.max_loss} onChange={(e) => risk.setField("max_loss", e.target.value)} />
          </label>
          <button id="t-calc" type="button" onClick={() => void risk.calc()}>
            Calculate
          </button>
        </div>
        <div id="risk-out" style={{ marginTop: 6 }}>
          {!risk.out ? null : "error" in risk.out ? <div className="err">{risk.out.error}</div> : <RiskBody r={risk.out.answer} />}
        </div>
      </div>
    </>
  );
}
