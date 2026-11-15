import { ICON, worstOf, type AlertItem } from "../alerts";

/** The one alert line: the count, the most serious alert, "(+N more)"; the whole list opens on a click and floats over the page. Nothing when there is nothing to say. `onClear` (given while the line
 *  lists setup alerts) empties them. */
export function AlertLine({ items, onClear }: { items: AlertItem[]; onClear?: () => void }) {
  const w = worstOf(items);
  if (!w) return null;
  const { worst, lead } = w;
  return (
    <details className={`alerts ${worst}`} data-testid="alert-line">
      <summary title="click for every alert">
        {ICON[worst]} <b>{items.length} alert{items.length === 1 ? "" : "s"}</b>: {lead.head || lead.text}
        {items.length > 1 ? ` (+${items.length - 1} more)` : ""} <span className="mut">▾ details</span>
      </summary>
      <div className="alertlist">
        {items.map((i, n) => (
          <div key={n} className={`alert ${i.sev}`}>
            {ICON[i.sev]} {i.head ? <b>{i.head}: </b> : null}
            {i.text}
          </div>
        ))}
        {onClear ? (
          <button className="linkbtn" id="alert-clear" type="button" onClick={onClear}>
            clear the setup alerts
          </button>
        ) : null}
      </div>
    </details>
  );
}
