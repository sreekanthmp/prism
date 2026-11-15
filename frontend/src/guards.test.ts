import { describe, expect, it } from "vitest";

// What the source of the dashboard must never contain. These hold the promises the current dashboard keeps and that a rewrite could quietly lose. The sources are read as text by the bundler
// (import.meta.glob), so no node types are needed.

const all = import.meta.glob<string>("./**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true });
const sources = Object.entries(all)
  .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.startsWith("./test/"))
  .map(([path, text]) => ({ path: path.replace(/^\.\//, ""), text }));

describe("the source of the dashboard", () => {
  it("has files to look at", () => {
    expect(sources.map((s) => s.path)).toEqual(
      expect.arrayContaining([
        "App.tsx", "alerts.ts", "connection.ts", "format.ts", "main.tsx", "types.ts", "useConnection.ts", "components/Header.tsx", "components/AlertLine.tsx", "components/Tabs.tsx", "components/StaleBar.tsx",
        "chartTypes.ts", "chartApi.ts", "chartModel.ts", "useChart.ts", "components/ChartTab.tsx", "components/PriceChart.tsx",
        "overviewModel.ts", "components/Overview.tsx", "components/OverviewPanels.tsx", "components/Decision.tsx", "optionsModel.ts", "components/Options.tsx", "journalModel.ts", "journalApi.ts", "useJournal.ts", "components/Journal.tsx",
        "alertEvents.ts", "alertEffects.ts", "useAlerts.ts", "tradesApi.ts", "tradesModel.ts", "useTrades.ts", "useRisk.ts", "components/Trades.tsx", "analysisModel.ts", "components/Analysis.tsx", "components/AnalysisStrategies.tsx", "components/AnalysisTables.tsx", "components/AnalysisHealth.tsx",
      ]),
    );
  });

  it("never turns a string from the server into markup", () => {
    const bad = /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|createContextualFragment|srcdoc/;
    for (const s of sources) expect(s.text, s.path).not.toMatch(bad);
  });

  it("asks the server in three places only: the chart and the journal only read, and the trades notebook has the two writes there are", () => {
    for (const s of sources) expect(s.text, s.path).not.toMatch(/XMLHttpRequest|sendBeacon|EventSource|axios/);
    const asking = sources.filter((s) => /\bfetch\(/.test(s.text));
    expect(asking.map((s) => s.path).sort()).toEqual(["chartApi.ts", "journalApi.ts", "tradesApi.ts"]); // the only places a request is made
    for (const [path, url] of [["chartApi.ts", /fetch\(`\/api\/chart\?/], ["journalApi.ts", /fetch\("\/api\/journal"/]] as const) {
      const api = asking.find((s) => s.path === path)?.text ?? "";
      expect(api.match(/\bfetch\(/g), path).toHaveLength(1);
      expect(api, path).toMatch(url); // GET /api/chart and GET /api/journal
      expect(api, path).not.toMatch(/method\s*:|body\s*:|POST|PUT|PATCH|DELETE/i); // a request with no method is a GET, and nothing is sent
    }
  });

  it("writes only a notebook: four requests to /api/trades and /api/risk, two of them reads and two of them POSTs, nothing else", () => {
    const api = sources.find((s) => s.path === "tradesApi.ts")?.text ?? "";
    expect(api.match(/\bfetch\(/g)).toHaveLength(1); // one place that sends, used by the four
    expect(api).not.toMatch(/PUT|PATCH|DELETE|\bHEAD\b/);
    expect([...api.matchAll(/send\("(GET|POST)",/g)].map((m) => m[1])).toEqual(["GET", "POST", "POST", "GET"]); // read the trades, log one, void one, size one
    expect([...new Set([...api.matchAll(/["`](\/api\/[a-z/]*)/g)].map((m) => m[1]))].sort()).toEqual(["/api/risk", "/api/trades", "/api/trades/"]);
    for (const s of sources.filter((x) => x.path !== "tradesApi.ts")) expect(s.text, s.path).not.toMatch(/["'`]\/api\/(trades|risk)/); // nothing else asks for those addresses (a comment may name them)
  });

  it("draws with the chart library in one place only", () => {
    expect(sources.filter((s) => /from\s+["']lightweight-charts["']/.test(s.text)).map((s) => s.path)).toEqual(["components/PriceChart.tsx"]);
  });

  it("places no order and names no order call", () => {
    for (const s of sources) expect(s.text, s.path).not.toMatch(/placeOrder|modifyOrder|cancelOrder|place_order|modify_order|cancel_order|\/order\/|orderbook|tradebook/i);
  });

  it("loads nothing from another site", () => {
    for (const s of sources) expect(s.text, s.path).not.toMatch(/https?:\/\//);
  });

  it("uses no library beyond React and the chart", () => {
    const imports = new Set<string>();
    for (const s of sources) for (const m of s.text.matchAll(/from\s+["']([^"'.][^"']*)["']/g)) imports.add(m[1] ?? "");
    expect([...imports].sort()).toEqual(["lightweight-charts", "react", "react-dom/client"]);
  });

  it("keeps one thing in the page's storage, the alert mode the reader chose, and sets no cookie", () => {
    for (const s of sources) expect(s.text, s.path).not.toMatch(/sessionStorage|document\.cookie|indexedDB/);
    const using = sources.filter((s) => /localStorage/.test(s.text));
    expect(using.map((s) => s.path)).toEqual(["alertEffects.ts"]);
    const effects = using[0]?.text ?? "";
    expect(effects.match(/localStorage\.setItem\(/g)).toHaveLength(1);
    expect(effects).toMatch(/localStorage\.setItem\(MODE_KEY, m\)/);
    expect(effects).not.toMatch(/localStorage\.(removeItem|clear)|localStorage\[/);
    expect(sources.find((s) => s.path === "alertEvents.ts")?.text).toMatch(/MODE_KEY = "prism-alert-mode"/); // the name the current dashboard uses: the choice carries over
  });

  it("makes sounds and popups in one place only, and plays no sound but the alert tones", () => {
    for (const path of sources.map((s) => s.path).filter((p) => p !== "alertEffects.ts")) {
      const text = sources.find((s) => s.path === path)?.text ?? "";
      expect(text, path).not.toMatch(/AudioContext|createOscillator|new Notification|Notification\./);
    }
    const effects = sources.find((s) => s.path === "alertEffects.ts")?.text ?? "";
    expect(effects.match(/createOscillator\(/g)).toHaveLength(1);
    expect(effects.match(/new Notification\(/g)).toHaveLength(1);
    expect(effects).not.toMatch(/\.src\s*=|new Audio\(|<audio/); // no sound file is loaded: the tones are made
  });
});
