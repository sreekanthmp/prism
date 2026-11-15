import { lineItems } from "./alerts";
import { recentAlerts } from "./alertEvents";
import { AlertLine } from "./components/AlertLine";
import { Header } from "./components/Header";
import { StaleBar } from "./components/StaleBar";
import { Tabs, TABS, useTab } from "./components/Tabs";
import { useCallback, useMemo, useRef, useState } from "react";
import { DEFAULT_OPEN } from "./analysisModel";
import { JOURNAL_OPEN } from "./journalModel";
import { useAlerts } from "./useAlerts";
import { useJournal } from "./useJournal";
import { useRisk } from "./useRisk";
import { useTrades } from "./useTrades";
import type { JournalFetcher } from "./journalApi";
import type { TradesApi } from "./tradesApi";
import type { ChartFetcher } from "./chartApi";
import { ChartTab, defaultPrefs, type ChartPrefs } from "./components/ChartTab";
import { AnalysisTab, type Focus } from "./components/Analysis";
import type { OpenState } from "./components/AnalysisStrategies";
import { JournalTab } from "./components/Journal";
import { TradesTab } from "./components/Trades";
import { OptionsTab } from "./components/Options";
import { DrawGuard, Overview } from "./components/Overview";
import type { Goto } from "./components/OverviewPanels";
import { useConnection, type SocketFactory } from "./useConnection";

/** The dashboard. Stage 9.1 is the foundation: the connection with its loading / live / stale contract, the header, the one alert line and the tab shell. The tabs' own content was built stage by
 *  stage (9.2: the Chart tab, 9.3: the Overview, 9.4: the Options tab, 9.5: the Analysis tab, 9.6: the Journal tab, 9.7: the Trades tab and the alerts: the sound, the popup, the count in the title);
 *  the current dashboard stays at / until the cutover. */
export function App({ url, createSocket, fetchChart, fetchJournal, api }: { url?: string; createSocket?: SocketFactory; fetchChart?: ChartFetcher; fetchJournal?: JournalFetcher; api?: TradesApi }) {
  const alerts = useAlerts(); // told of every snapshot by the connection, as it arrives
  const { conn, snapshot, tries } = useConnection(url, createSocket, alerts.listeners);
  const latest = useRef<number | null>(null); // the server time of the last snapshot: what an alert that is not about a snapshot is stamped with
  latest.current = snapshot?.server_time ?? null;
  const trades = useTrades(api, alerts.raise, () => latest.current); // asked for once, as the page starts: a loss limit already reached is on every tab
  const risk = useRisk(api);
  const [tab, setTab] = useTab();
  const [chartPrefs, setChartPrefs] = useState<ChartPrefs>(defaultPrefs); // kept here: leaving the Chart tab and coming back finds it as it was left
  // Which sections of the Analysis tab are open is the reader's, and is kept here for the same reason (the current dashboard keeps it too). A strategy that holds a live setup opens by itself once.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set([...DEFAULT_OPEN, ...JOURNAL_OPEN]));
  const autoOpened = useRef(new Set<string>());
  const os = useMemo<OpenState>(
    () => ({
      isOpen: (k) => openKeys.has(k),
      setOpen: (k, open) =>
        setOpenKeys((prev) => {
          if (prev.has(k) === open) return prev;
          const next = new Set(prev);
          if (open) next.add(k);
          else next.delete(k);
          return next;
        }),
    }),
    [openKeys],
  );
  const journal = useJournal(snapshot, tab === "journal" || tab === "chart", fetchJournal); // read when the Journal tab or the Chart tab (which marks where the decision changed) is opened, and again when the decision or a setup event changes
  const journalDraw = useMemo(() => ({}), [snapshot, journal.state]); // what the journal tab is drawn from: a new snapshot, or a new answer of the journal's own, is a new draw
  const tradesDraw = useMemo(() => ({}), [snapshot, trades.data, trades.error, trades.message, trades.form, risk.form, risk.out]); // ...and the Trades tab from its own answers and from what is typed
  const [focus, setFocus] = useState<Focus | null>(null);
  const focusCount = useRef(0);
  const noFocus = useCallback(() => setFocus(null), []);
  // A link to a strategy opens the Analysis tab with the strategy's section and the strategy itself open, and scrolls to it; the link to "all ten" opens only the section.
  const goto: Goto = (to, strategy) => {
    if (to === "analysis" && strategy !== undefined) {
      setOpenKeys((prev) => new Set(prev).add("a-strat").add(strategy ? "sd-" + strategy : "a-strat"));
      if (strategy) setFocus({ key: "sd-" + strategy, n: ++focusCount.current });
    }
    setTab(to);
  };
  const stale = conn === "stale";
  // while stale, the alerts say nothing about the market: what is on screen is the last snapshot, not the present (your own loss limit stays: it is a fact about your trades)
  const events = stale ? [] : recentAlerts(alerts.state.log, snapshot?.server_time);
  const items = lineItems({ health: snapshot?.health ?? null, stale, trades: trades.data, events });
  return (
    <>
      <Header conn={conn} snapshot={snapshot} tries={tries} mode={alerts.mode} onMode={alerts.cycleMode} />
      <Tabs tab={tab} onChange={setTab} />
      <main id="main" className={stale ? "staled" : ""}>
        {stale && snapshot ? <StaleBar serverTime={snapshot.server_time} /> : null}
        <AlertLine items={items} onClear={events.length ? alerts.clear : undefined} />
        {TABS.map((t) => (
          <section key={t.id} className="tab" id={`tab-${t.id}`} role="tabpanel" aria-labelledby={`tb-${t.id}`} hidden={tab !== t.id}>
            {tab !== t.id ? null : t.id === "overview" ? (
              <DrawGuard name="overview" resetKey={snapshot}>
                <Overview snapshot={snapshot} tries={tries} stale={stale} onGoto={goto} />
              </DrawGuard>
            ) : t.id === "journal" ? (
              <DrawGuard name="journal" resetKey={journalDraw}>
                <JournalTab snapshot={snapshot} journal={journal.state.data} error={journal.state.error} onRefresh={journal.refresh} os={os} />
              </DrawGuard>
            ) : t.id === "analysis" ? (
              <DrawGuard name="analysis" resetKey={snapshot}>
                <AnalysisTab snapshot={snapshot} stale={stale} os={os} seen={autoOpened.current} focus={focus} onFocused={noFocus} />
              </DrawGuard>
            ) : t.id === "options" ? (
              <DrawGuard name="options" resetKey={snapshot}>
                <OptionsTab snapshot={snapshot} stale={stale} />
              </DrawGuard>
            ) : t.id === "chart" ? (
              <DrawGuard name="chart">
                <ChartTab prefs={chartPrefs} onPrefs={setChartPrefs} paused={stale} fetcher={fetchChart} decisions={journal.state.data?.available ? journal.state.data.decisions : null} />
              </DrawGuard>
            ) : (
              <DrawGuard name="trades" resetKey={tradesDraw}>
                <TradesTab snapshot={snapshot} trades={trades} risk={risk} />
              </DrawGuard>
            )}
          </section>
        ))}
      </main>
    </>
  );
}
