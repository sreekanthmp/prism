import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "chart", label: "Chart" },
  { id: "options", label: "Options" },
  { id: "analysis", label: "Analysis" },
  { id: "journal", label: "Journal" },
  { id: "trades", label: "Trades" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

const known = (s: string): TabId | null => TABS.find((t) => t.id === s)?.id ?? null;
const fromHash = (): TabId => known(location.hash.replace(/^#/, "")) ?? "overview"; // an address that names no tab opens the Overview

/** The open tab, kept in the address (#chart) so it can be linked and reloaded; the address follows a click, and a click follows the address. */
export function useTab(): [TabId, (t: TabId) => void] {
  const [tab, setTabState] = useState<TabId>(fromHash);
  useEffect(() => {
    const onHash = () => setTabState(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const setTab = (t: TabId) => {
    setTabState(t);
    try {
      history.replaceState(null, "", `#${t}`);
    } catch {
      /* a page that may not change its address still switches tabs */
    }
  };
  return [tab, setTab];
}

/** The tab bar. Left and right move between the tabs, wrapping round, and the focus goes with them. */
export function Tabs({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    onChange(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <nav id="tabs" role="tablist" aria-label="Prism sections" onKeyDown={onKey}>
      {TABS.map((t) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[t.id] = el; }}
          role="tab"
          id={`tb-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`tab-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
