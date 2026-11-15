import { fmtT } from "../format";

/** The page-wide notice when the link is not live: the last snapshot is still shown (dimmed), for inspection only. */
export function StaleBar({ serverTime }: { serverTime: number }) {
  return (
    <div className="stalebar" role="alert">
      ⛔ STALE since {fmtT(serverTime, false)} — NOT ACTIONABLE{" "}
      <span>
        the page has lost its link to Prism and is showing the last snapshot (made {fmtT(serverTime)} IST), for inspection only. It is not a current decision, price or status. Reconnecting…
      </span>
    </div>
  );
}
