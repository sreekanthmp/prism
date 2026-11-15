import { Fragment } from "react";
import { fmtT, n2 } from "../format";
import { actionClass, endedEvents, lifecycles, neededPermissions, SHOWN_DECISIONS } from "../journalModel";
import { cls } from "../overviewModel";
import type { JournalAnswer, JournalRow, SetupEvent, Snapshot } from "../types";
import { Sec } from "./Analysis";
import type { OpenState } from "./AnalysisStrategies";
import { ExplainBlock } from "./Decision";

const status = (s: string) => <span className={`st st-${s}`}>{s.toLowerCase()}</span>;
const side = (d: string) => (d === "CE" ? "up" : "down");

function DecisionRow({ x }: { x: JournalRow }) {
  return (
    <tr>
      <td>{fmtT(x.time)}</td>
      <td className="l">
        <b className={actionClass(x.action)}>{x.action || "–"}</b> <span className="mut">{x.reason || ""}</span>
      </td>
      <td>{n2(x.price)}</td>
      <td className={`l ${cls(x.direction)}`}>
        {x.direction || "–"}
        <span className="mut"> {(x.regime || "").replace(/_/g, " ")}</span>
      </td>
      <td className="l">{x.strategy_name || "–"}</td>
      <td className="wrap">
        <b>{x.headline || ""}</b>
        {x.options ? (
          <>
            {" "}
            <span className="mut">· option {x.options}</span>
          </>
        ) : (
          ""
        )}
        {x.reasons.map((q, i) => (
          <div key={"r" + i} className="up" style={{ marginLeft: 10 }}>
            + {q}
          </div>
        ))}
        {x.against.map((q, i) => (
          <div key={"a" + i} className="flat" style={{ marginLeft: 10 }}>
            − {q}
          </div>
        ))}
        {neededPermissions(x).map((c, i) => (
          <div key={"c" + i} className="mut" style={{ marginLeft: 10 }}>
            ⚑ counter-trend {c.side} {c.granted ? "granted" : "denied"}: {c.reason}
          </div>
        ))}
        {(x.regime_active ?? []).length ? (
          <div className="mut" style={{ marginLeft: 10 }}>
            regime: {x.regime_active.join(" · ")}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function DecisionHistory({ d }: { d: JournalAnswer }) {
  return (
    <>
      <div className="scroll">
        <table className="t">
          <tbody>
            <tr>
              <th>Time</th>
              <th className="l">Decision</th>
              <th>NIFTY</th>
              <th className="l">Market</th>
              <th className="l">Strategy</th>
              <th className="wrap">Why</th>
            </tr>
            {d.decisions.slice(0, SHOWN_DECISIONS).map((x, i) => (
              <DecisionRow key={i} x={x} />
            ))}
          </tbody>
        </table>
      </div>
      {d.decisions.length > SHOWN_DECISIONS ? (
        <div className="mut">
          showing the latest {SHOWN_DECISIONS} of {d.decisions.length}
        </div>
      ) : (
        ""
      )}
      {d.decisions.length ? "" : <div className="mut">no decision has been recorded today</div>}
    </>
  );
}

function LifecycleTable({ events }: { events: SetupEvent[] }) {
  const rows = lifecycles(events);
  if (!rows.length) return <div className="mut">no setup has been announced today</div>;
  return (
    <div className="scroll">
      <table className="t">
        <tbody>
          <tr>
            <th className="l">Setup</th>
            <th className="l">Strategy</th>
            <th className="l">Lifecycle</th>
            <th className="l">Now</th>
            <th className="wrap">Latest note</th>
          </tr>
          {rows.map(({ id, list, last }) => (
            <tr key={id}>
              <td className={`l ${side(last.direction)}`}>{last.direction}</td>
              <td className="l">{last.strategy_name}</td>
              <td className="l">
                {list.map((e, i) => (
                  <Fragment key={i}>
                    {i ? " → " : ""}
                    {status(e.status)} {fmtT(e.time, false)}
                  </Fragment>
                ))}
              </td>
              <td className="l">{status(last.status)}</td>
              <td className="wrap">{last.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What Prism said today and why: the decision history, the life of each setup, the setups that ended, every strategy event, and the decision as it stands. */
export function JournalTab({ snapshot, journal, error, onRefresh, os }: { snapshot: Snapshot | null; journal: JournalAnswer | null; error: string | null; onRefresh: () => void; os: OpenState }) {
  if (!snapshot) return <div id="journal-body" />;
  const t = snapshot.trading;
  const d = journal;
  const live = t ? t.events : [];
  const events = d && d.available ? d.events : live;
  const ended = endedEvents(events);
  return (
    <div id="journal-body">
      <div className="bar">
        <span>
          Today's decision journal
          {d && d.file ? (
            <>
              {" "}
              <span className="mut">
                ({d.file}, {d.records} records)
              </span>
            </>
          ) : (
            ""
          )}
        </span>
        <span className="mut">{!d ? (error ? "could not load: " + error : "loading…") : d.available ? "decision changes, setup lifecycle and explanations, newest first" : d.reason + ": showing the live events only"}</span>
        {d && d.available && (d.bad_lines || d.unreadable_records) ? (
          <span className="flat" title="the file holds lines that are not records (a write cut short by a crash?): the review command says which, with --verify">
            ⚠ {(d.bad_lines || 0) + (d.unreadable_records || 0)} line(s) of the file could not be read and are not shown
          </span>
        ) : (
          ""
        )}
        <button className="linkbtn" id="j-refresh" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {d && d.available ? (
        <Sec k="j-decisions" title="Decision history" hint="each change of decision, with the reasons for and against" os={os}>
          <DecisionHistory d={d} />
        </Sec>
      ) : null}
      <Sec k="j-lifecycle" title="Setup lifecycle history" hint="from detection to confirmation, expiry or invalidation" os={os}>
        <LifecycleTable events={events} />
      </Sec>
      <Sec k="j-ended" title="Expired and invalidated setups" hint={`${ended.length} today`} os={os}>
        {ended.length ? (
          ended.map((e, i) => (
            <div key={i}>
              {fmtT(e.time, false)} <b className={side(e.direction)}>{e.direction}</b> {e.strategy_name} {status(e.status)} — <span className="mut">{e.text}</span>
            </div>
          ))
        ) : (
          <div className="mut">none today</div>
        )}
      </Sec>
      <Sec k="j-events" title="Full strategy events" hint={`${events.length} events`} os={os}>
        {events.length ? (
          <div className="scroll">
            <table className="t">
              <tbody>
                <tr>
                  <th>Time</th>
                  <th className="l">Setup</th>
                  <th className="l">Strategy</th>
                  <th className="l">Status</th>
                  <th className="wrap">What happened</th>
                </tr>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td>{fmtT(e.time)}</td>
                    <td className={`l ${side(e.direction)}`}>{e.direction}</td>
                    <td className="l">{e.strategy_name}</td>
                    <td className="l">{status(e.status)}</td>
                    <td className="wrap">{e.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mut">no events today</div>
        )}
      </Sec>
      {t ? (
        <Sec k="j-explain" title="Decision explanation (now)" hint="the plain-words explanation of the current decision" os={os}>
          <ExplainBlock e={t.explain} />
          <div>
            <b>{t.decision.headline}</b>
          </div>
          {t.decision.reasons.map((q, i) => (
            <div key={"r" + i} className="why up" style={{ marginLeft: 12 }}>
              + {q}
            </div>
          ))}
          {t.decision.against.map((q, i) => (
            <div key={"a" + i} className="why flat" style={{ marginLeft: 12 }}>
              − {q}
            </div>
          ))}
        </Sec>
      ) : null}
      <Sec k="j-trades" title="Manually recorded trades" hint="none" os={os}>
        <div className="mut">Prism does not record trades: it places no orders and has no trade log, so there is nothing to show here. The journal above is the record of what Prism said and why.</div>
      </Sec>
    </div>
  );
}
