import { Component, type ErrorInfo, type ReactNode } from "react";
import { liveSetup } from "../overviewModel";
import type { Analysis, Snapshot } from "../types";
import { DecisionBanner } from "./Decision";
import { CurrentSetup, CurrentSetupTitle, DataHealth, MarketContext, Panel, RecentEvents, RegimeBody, StrategyMonitorBody, Timeframes, type Goto } from "./OverviewPanels";

const WAITING = <span className="mut">waiting for data</span>;

/** Before the first snapshot there is no decision: the page says so, and every panel says it is waiting. Nothing on it is a decision. */
function Loading({ tries }: { tries: number }) {
  const why = tries > 1 ? `Prism cannot be reached (attempt ${tries}): retrying every 2 s.` : "Connecting to Prism and waiting for the first snapshot.";
  return (
    <>
      <div className="decision loading" id="decision">
        <div className="loadbox">
          <b>LOADING</b> — {why} No decision is available yet; nothing on this page is a decision.
        </div>
      </div>
      <div className="tfrow" id="tfrow">{WAITING}</div>
      <div className="cols">
        <div className="col">
          <Panel title="Market context"><div className="kv" id="ctx">{WAITING}</div></Panel>
          <Panel title="Current setup"><div className="kv" id="setup">{WAITING}</div></Panel>
        </div>
        <div className="col">
          <Panel title="Strategy monitor"><div id="strat">{WAITING}</div></Panel>
          <Panel title="Market regime"><div className="kv" id="rg">{WAITING}</div></Panel>
          <Panel title="Data health"><div className="kv" id="dhs">{WAITING}</div></Panel>
        </div>
      </div>
      <Panel title="Recent events"><div id="ev3">{WAITING}</div></Panel>
    </>
  );
}

const HowTo = () => (
  <details className="sec" id="howto" style={{ margin: "6px 0 0" }}>
    <summary>
      How to use this page <span className="mut">before a manual trade: read top to bottom, it takes a few seconds</span>
    </summary>
    <div className="secbody howto">
      <div>
        <b>1. Is the data safe?</b> The header must say <b className="up">MARKET OPEN</b>, <b className="up">FEED CONNECTED</b> and <b className="up">DATA TRUSTED</b>. A red or grey chip (<b>UNKNOWN</b> means the page lost its link), or a red alert line under the tabs (click it for every alert), means do not trade on this screen.
      </div>
      <div>
        <b>2. What is the decision?</b> Only <b className="up">BUY CE</b> or <b className="down">BUY PE</b> means a setup passed the rules. <b className="flat">WAIT</b> and <b className="neu">NO TRADE</b> mean stay out; the line beside it says why.
      </div>
      <div>
        <b>3. Can I enter now?</b> The <b>Entry</b> line must say the setup is eligible right now. "Not eligible" means the setup is confirmed but price is not in the entry area, or something blocks it. If the page says <b className="down">STALE</b>, it has lost its link to Prism: nothing on it is current, whatever it shows.
      </div>
      <div>
        <b>4. Do the timeframes agree?</b> <b>1H and 15M</b> must point the same way as the side. 5M and 1M are information only.
      </div>
      <div>
        <b>5. Where is the idea wrong?</b> <b>Current setup</b> shows the trigger, the entry zone and the invalidation level. If price closes beyond the invalidation, the setup is over. You choose your own stop and size.
      </div>
      <div>
        <b>6. Which option?</b> Only for a BUY: open the <b>Options</b> tab. The contract must be <b className="up">FRESH</b> with a tight spread and no blocking findings. "No suitable contract" means no option trade.
      </div>
      <div>
        <b>Alerts.</b> The <b>🔔</b> button in the header chooses what tells you when a setup becomes ready, stops being ready, or the data stops being trustworthy: <b>sound + popup</b>, <b>sound</b> or <b>off</b>. A sound needs one click on this page first (a browser rule); a popup needs your browser's permission. The log under the tabs keeps the last few.
      </div>
      <div>
        <b>Your own trades.</b> The <b>Trades</b> tab is a notebook: log what you bought and sold (Prism places nothing and reads no account) and it keeps what Prism said at that moment, shows the day's realised result against a loss limit you set (<code>RISK_MAX_DAILY_LOSS</code>), and sizes a trade to your stop.
      </div>
      <div>
        <b>7. Then you decide.</b> Prism describes the NIFTY index and places no orders. Enter, size and exit yourself in Angel One. Use <b>Journal</b> afterwards to review what Prism said and why. <b>Analysis</b> holds the detail behind the decision.
      </div>
    </div>
  </details>
);

/**
 * The Overview (Stage 9.3): what a trader reads before a manual trade, top to bottom. It is the current dashboard's Overview, port for port: the decision with its explanation, the four
 * timeframes, market context, the current setup, the strategy monitor, the regime, data health and the latest events. `stale` is the page's link state: the last snapshot is shown, and
 * never as a current decision.
 */
export function Overview({ snapshot, tries, stale, onGoto }: { snapshot: Snapshot | null; tries: number; stale: boolean; onGoto: Goto }) {
  if (!snapshot) return <Loading tries={tries} />;
  const t = snapshot.trading;
  if (!t) {
    return (
      <>
        <div className="decision loading" id="decision">
          <div className="dhead">Trading decision not available yet.</div>
        </div>
        <HowTo />
      </>
    );
  }
  const a: Analysis = snapshot.analysis ?? { available: false };
  const x = liveSetup(t);
  return (
    <>
      <DecisionBanner s={snapshot} t={t} liveSetup={x} stale={stale} />
      <Timeframes a={a} note={t.explain?.note ?? ""} />
      <div className="cols">
        <div className="col">
          <Panel title="Market context"><MarketContext t={t} a={a} /></Panel>
          <div className="panel">
            <CurrentSetupTitle x={x} t={t} />
            <CurrentSetup t={t} x={x} stale={stale} />
          </div>
        </div>
        <div className="col">
          <Panel
            title={
              <>
                Strategy monitor{" "}
                <button className="linkbtn" type="button" onClick={() => onGoto("analysis", "")}>
                  All ten strategies →
                </button>
              </>
            }
          >
            <div id="strat">
              <StrategyMonitorBody t={t} stale={stale} onGoto={onGoto} />
            </div>
          </Panel>
          <Panel title="Market regime"><RegimeBody t={t} /></Panel>
          <Panel title="Data health"><DataHealth s={snapshot} t={t} stale={stale} /></Panel>
        </div>
      </div>
      <RecentEvents t={t} onGoto={onGoto} />
      <HowTo />
    </>
  );
}

/**
 * A tab that fails to draw must not take the page with it: the header, the tabs and the stale notice stay, and the error is said in words (the current dashboard says it the same way). The
 * next snapshot is drawn afresh: an error does not outlive the data that caused it.
 */
export class DrawGuard extends Component<{ name: string; resetKey?: unknown; children: ReactNode }, { error: Error | null; key: unknown }> {
  override state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { error: Error | null; key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.name, error, info.componentStack);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div id="jserr" role="alert">
        Dashboard display error in {this.props.name}: {this.state.error.message}
      </div>
    );
  }
}
