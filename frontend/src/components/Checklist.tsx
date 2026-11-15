import { autoChecks, doneFor, GROUPS, MANUAL, STATUS_CLS, STATUS_ICON, STATUS_WORD, tally, type Check, type Ticks } from "../checklistModel";
import { liveSetup } from "../overviewModel";
import type { Snapshot, Trading } from "../types";
import { POP_GROUP } from "./Decision";
import type { Goto } from "./OverviewPanels";
import { TABS, type TabId } from "./Tabs";

const tabName = (id: TabId): string => TABS.find((t) => t.id === id)?.label ?? id;

function Go({ to, onGoto }: { to: TabId | undefined; onGoto: Goto }) {
  if (!to) return null;
  return (
    <button className="linkbtn" type="button" onClick={() => onGoto(to)}>
      {tabName(to)} →
    </button>
  );
}

function Row({ c, onGoto }: { c: Check; onGoto: Goto }) {
  return (
    <li className={`ptrow pt-${c.status}`} data-check={c.id} data-status={c.status}>
      <span className={`ptchip ${STATUS_CLS[c.status]}`}>
        <span aria-hidden="true">{STATUS_ICON[c.status]}</span> {STATUS_WORD[c.status]}
      </span>
      <span className="ptmain">
        <span className="ptlabel">{c.label}</span>
        <span className="pttext mut" title={c.text}>
          {c.text}
        </span>
      </span>
      <Go to={c.goto} onGoto={onGoto} />
    </li>
  );
}

/** The line in the banner: how many of Prism's answers are met. A count, never a verdict; on a page that has lost its link it says so. */
const badge = (checks: Check[], stale: boolean): string => {
  if (stale) return "not current";
  const n = tally(checks);
  return `${n.met} of ${n.total} met`;
};

/** The line inside the panel: the count in full, and how many of the reader's own boxes are ticked. It never says "go". */
function summary(checks: Check[], stale: boolean, ticked: number): string {
  if (stale) return "not current: the page lost its link to Prism";
  const n = tally(checks);
  const parts = [`${n.met} of ${n.total} met`];
  if (n.caution) parts.push(`${n.caution} caution${n.caution > 1 ? "s" : ""}`);
  if (n.notMet) parts.push(`${n.notMet} not met`);
  if (n.open) parts.push(`${n.open} not checked`);
  return `${parts.join(" · ")} — yours: ${ticked} of ${MANUAL.length} ticked`;
}

/**
 * The pre-trade checklist: the questions a manual trader asks before a trade. It is one line in the decision banner ("Checklist 12 of 13 met"), and opens over the page like "Explain this decision" (so
 * the Overview keeps fitting its screen, and nothing moves). The first column is what Prism can answer, from its own fields, one question at a time (met, a caution, not met, not yet, unknown); the
 * second is what only the reader can know, ticked by hand and kept for the setup that is live. It is a checklist, not a signal, and says so: it places no order and decides nothing. On a page that has
 * lost its link nothing is answered.
 */
export function Checklist({ s, t, stale, ticks, onTick, onGoto }: { s: Snapshot; t: Trading; stale: boolean; ticks: Ticks; onTick: (key: string, item: string) => void; onGoto: Goto }) {
  const checks = autoChecks(s, t, stale);
  const x = liveSetup(t);
  const key = x?.id ?? "";
  const done = doneFor(ticks, key);
  return (
    <details className="pop pretrade" id="pretrade" data-testid="pretrade" {...POP_GROUP}>
      <summary>
        Checklist <b data-testid="pretrade-badge">{badge(checks, stale)}</b> ▾
      </summary>
      <div className="popbody">
        <div className="ptsum">
          <b>Before you trade</b> <span className="mut" data-testid="pretrade-summary">{summary(checks, stale, done.length)}</span>
        </div>
        <div className="ptgrid">
          <div>
            {GROUPS.map((g) => (
              <div key={g.id} data-group={g.id}>
                <h4>{g.title}</h4>
                <ul className="ptlist">
                  {checks.filter((c) => c.group === g.id).map((c) => (
                    <Row key={c.id} c={c} onGoto={onGoto} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div data-group="manual">
            <h4>Yours to check: Prism cannot see these</h4>
            <ul className="ptlist">
              {MANUAL.map((m) => (
                <li key={m.id} className="ptman" data-manual={m.id}>
                  <label className="ptmanual">
                    <input type="checkbox" id={`pt-m-${m.id}`} checked={done.includes(m.id)} disabled={key === ""} onChange={() => onTick(key, m.id)} />
                    <span>
                      <b>{m.label}</b>
                      <small className="mut">{m.hint}</small>
                    </span>
                  </label>
                  <Go to={m.goto} onGoto={onGoto} />
                </li>
              ))}
            </ul>
            <p className="mut ptnote" data-testid="pretrade-tickhelp">
              {key === "" ? "These are about a setup: there is none live, so there is nothing to tick yet." : "Your ticks are for this setup: a different setup starts clean."}
            </p>
            <p className="mut ptnote" data-testid="pretrade-note">
              A checklist, not a signal: it reads what Prism knows, and cannot see your broker, your account, the option chain or the Greeks. Prism places no orders; the decision is yours.
            </p>
          </div>
        </div>
      </div>
    </details>
  );
}
