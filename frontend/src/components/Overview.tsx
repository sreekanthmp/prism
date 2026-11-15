import { Component, type ErrorInfo, type ReactNode } from "react";
import { NO_TICKS, type Ticks } from "../checklistModel";
import { liveSetup } from "../overviewModel";
import type { Analysis, Snapshot } from "../types";
import { Checklist } from "./Checklist";
import { DecisionBanner } from "./Decision";
import { CurrentSetup, CurrentSetupTitle, DataHealth, MarketContext, Panel, RecentEvents, RegimeBody, StrategyMonitorBody, Timeframes, type Goto } from "./OverviewPanels";

const WAITING = <span className="mut">waiting for data</span>;
const noTick = () => undefined; // (the Overview on its own, with no state above it, ticks nothing)

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
      How to use this page <span className="mut">7 quick steps before a manual trade</span>
    </summary>
    <div className="secbody howto">
      <div className="hstep">
        <b>1. Check the data.</b> The top bar must be green: <b className="up">MARKET OPEN</b>, <b className="up">FEED CONNECTED</b>, <b className="up">DATA TRUSTED</b>. If anything is red, grey or <b className="down">STALE</b>, do not trade from this screen.
      </div>
      <div className="hstep">
        <b>2. Read the decision.</b> <b className="up">BUY CE</b> (a call) or <b className="down">BUY PE</b> (a put) means a setup passed Prism's rules. <b className="flat">WAIT</b> or <b className="neu">NO TRADE</b> means stay out; the line beside it says why.
      </div>
      <div className="hstep">
        <b>3. Check "Entry".</b> It must say "eligible". "Not eligible" means wait.
      </div>
      <div className="hstep">
        <b>4. Check the trend.</b> The <b>1H</b> and <b>15M</b> should agree with the trade: up for a call, down for a put.
      </div>
      <div className="hstep">
        <b>5. Know your exit.</b> <b>Current setup</b> shows the trigger, the entry zone and the invalidation. If price closes past the invalidation, the idea is wrong. Choose your own stop and size.
      </div>
      <div className="hstep">
        <b>6. Pick the option.</b> For a BUY only: open the <b>Options</b> tab. The contract should be <b className="up">FRESH</b> with a tight spread.
      </div>
      <div className="hstep">
        <b>7. Use the checklist.</b> The <b>Checklist</b> button beside "Explain this decision" gathers all this, plus five things only you can check.
      </div>
      <div className="hnote mut">
        <b>Then you decide.</b> Prism places no orders: trade in Angel One yourself, then review the day in the <b>Journal</b>.
      </div>
      <div className="hnote mut">
        <b>🔔</b> in the header plays a sound when a setup becomes ready (click the page once first: the browser needs it).
      </div>
      <div className="hnote mut">
        <b>Trades</b> tab: log your own trades and size them from your stop. Prism sees no account.
      </div>
    </div>
  </details>
);

/**
 * The Overview (Stage 9.3): what a trader reads before a manual trade, top to bottom. It is the current dashboard's Overview, port for port: the decision with its explanation, the four
 * timeframes, market context, the current setup, the strategy monitor, the regime, data health and the latest events. `stale` is the page's link state: the last snapshot is shown, and
 * never as a current decision.
 */
export function Overview({ snapshot, tries, stale, onGoto, ticks = NO_TICKS, onTick = noTick }: { snapshot: Snapshot | null; tries: number; stale: boolean; onGoto: Goto; ticks?: Ticks; onTick?: (key: string, item: string) => void }) {
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
      <DecisionBanner s={snapshot} t={t} liveSetup={x} stale={stale} extra={<Checklist s={snapshot} t={t} stale={stale} ticks={ticks} onTick={onTick} onGoto={onGoto} />} />
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
