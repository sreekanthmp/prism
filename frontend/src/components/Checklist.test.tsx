import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NO_TICKS, toggleTick, type Ticks } from "../checklistModel";
import { base, EVIL, variant } from "../test/helpers";
import type { Setup, Snapshot, Trading } from "../types";
import { Checklist } from "./Checklist";
import { Overview } from "./Overview";

// The checklist on the real snapshot of the engine (a BUY CE at 10:55 on 06 Nov 2026), drawn. What each answer says is held by checklistModel.test.ts; these hold what is drawn from it: the rows,
// the words that say a status, the boxes the reader ticks, the links, and what the page says when it has lost its link.
const T = (s: Snapshot): Trading => s.trading!;
const X = (s: Snapshot): Setup => T(s).setups[0]!;

function Host({ s, stale = false, onGoto }: { s: Snapshot; stale?: boolean; onGoto?: (to: string) => void }) {
  const [ticks, setTicks] = useState<Ticks>(NO_TICKS);
  return <Checklist s={s} t={T(s)} stale={stale} ticks={ticks} onTick={(k, i) => setTicks((p) => toggleTick(p, k, i))} onGoto={(onGoto ?? vi.fn()) as never} />;
}
const show = (s: Snapshot, stale = false, onGoto?: (to: string) => void) => {
  cleanup();
  return render(<Host s={s} stale={stale} onGoto={onGoto} />);
};
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-check]")];
const chipOf = (id: string) => document.querySelector(`[data-check=${id}] .ptchip`)?.textContent;
const box = (id: string) => document.getElementById(`pt-m-${id}`) as HTMLInputElement;
const summaryText = () => screen.getByTestId("pretrade-summary").textContent;
const noSetup = () => variant((s) => { T(s).setups = []; T(s).decision = { ...T(s).decision, action: "WAIT", headline: "WAIT: no setup yet", setup_id: null, strategy: null, strategy_name: null }; T(s).explain = null; });

describe("the rows", () => {
  it("are the thirteen questions, in three groups, each with its status", () => {
    show(base);
    expect(rows().map((r) => [r.dataset.check, r.dataset.status])).toEqual([
      ["session", "pass"], ["data", "pass"], ["volatility", "pass"], ["regime", "pass"],
      ["setup", "pass"], ["trend", "pass"], ["confirmed", "pass"], ["area", "pass"], ["clear", "pass"], ["cautions", "warn"], ["levels", "pass"], ["decision", "pass"],
      ["contract", "pass"],
    ]); // fmt: skip
    expect([...document.querySelectorAll("[data-group]")].map((g) => [g.getAttribute("data-group"), g.querySelector("h4")?.textContent])).toEqual([
      ["day", "The day and the data"],
      ["setup", "The setup"],
      ["option", "The option"],
      ["manual", "Yours to check: Prism cannot see these"],
    ]);
    expect([...document.querySelectorAll("[data-group=day] [data-check]")].map((r) => (r as HTMLElement).dataset.check)).toEqual(["session", "data", "volatility", "regime"]);
    expect([...document.querySelectorAll("[data-group=setup] [data-check]")]).toHaveLength(8);
    expect([...document.querySelectorAll("[data-group=option] [data-check]")]).toHaveLength(1);
  });

  it("say each status in a word as well as an icon: never by colour alone", () => {
    show(variant((s) => { X(s).blockers = ["the room rule"]; T(s).session!.entries_allowed = false; T(s).session!.phase = "late"; }));
    expect(chipOf("session")).toBe("✗ not met");
    expect(chipOf("cautions")).toBe("! caution");
    expect(chipOf("trend")).toBe("✓ met");
    show(noSetup());
    expect(chipOf("confirmed")).toBe("– not yet");
    show(base, true);
    expect(chipOf("data")).toBe("? unknown");
  });

  it("colour them as the rest of the page does: green met, amber a caution, red not met, grey the rest", () => {
    show(variant((s) => { X(s).blockers = ["x"]; }));
    expect(document.querySelector("[data-check=session] .ptchip")?.className).toBe("ptchip up");
    expect(document.querySelector("[data-check=cautions] .ptchip")?.className).toBe("ptchip flat");
    expect(document.querySelector("[data-check=clear] .ptchip")?.className).toBe("ptchip down");
    show(noSetup());
    expect(document.querySelector("[data-check=trend] .ptchip")?.className).toBe("ptchip mut");
  });

  it("show the label and what Prism says, and give the whole of what it says on hover", () => {
    show(base);
    const r = document.querySelector("[data-check=levels]")!;
    expect(r.querySelector(".ptlabel")?.textContent).toBe("The invalidation and a target are known");
    const t = r.querySelector(".pttext") as HTMLElement;
    expect(t.textContent).toBe("invalidation 24270.48 (10.5 pts of risk) · target 1 24308.00 (27.0 pts, 2.6R) · index points, not option premium");
    expect(t.title).toBe(t.textContent);
  });
});

describe("the summary", () => {
  it("counts what is met, what is a caution, and what is ticked: never 'go'", () => {
    show(base);
    expect(summaryText()).toBe("12 of 13 met · 1 caution — yours: 0 of 5 ticked");
    show(variant((s) => { X(s).against = []; }));
    expect(summaryText()).toBe("13 of 13 met — yours: 0 of 5 ticked");
    expect(document.getElementById("pretrade")?.textContent).not.toMatch(/\b(go ahead|safe to|take the trade|enter now|buy now)\b/i);
  });

  it("counts not met and not checked as they are", () => {
    show(variant((s) => { X(s).blockers = ["a"]; }));
    expect(summaryText()).toBe("11 of 13 met · 1 caution · 1 not met — yours: 0 of 5 ticked");
    show(noSetup());
    expect(summaryText()).toBe("4 of 13 met · 2 not met · 7 not checked — yours: 0 of 5 ticked"); // (the four day-level answers are met; no setup, and no BUY: 2 not met, and 6 setup questions + the contract not yet)
    show(variant((s) => { X(s).against = ["a", "b"]; T(s).session!.phase = "midday"; T(s).session!.strict = true; }));
    expect(summaryText()).toBe("11 of 13 met · 2 cautions — yours: 0 of 5 ticked");
  });

  it("says nothing is current when the page has lost its link, and counts no check as met", () => {
    show(base, true);
    expect(summaryText()).toBe("not current: the page lost its link to Prism");
    expect(rows().every((r) => r.dataset.status === "unknown")).toBe(true);
  });

  it("says in the banner's line how many are met, in a count and never a verdict, and that it is not current on a page that lost its link", () => {
    show(base);
    expect(document.querySelector("#pretrade .ptsum")?.textContent).toBe("Before you trade 12 of 13 met · 1 caution — yours: 0 of 5 ticked");
    expect(screen.getByTestId("pretrade-badge").textContent).toBe("12 of 13 met");
    expect(document.querySelector("#pretrade > summary")?.textContent).toBe("Checklist 12 of 13 met ▾");
    show(noSetup());
    expect(screen.getByTestId("pretrade-badge").textContent).toBe("4 of 13 met");
    show(variant((s) => { X(s).blockers = ["a"]; }));
    expect(screen.getByTestId("pretrade-badge").textContent).toBe("11 of 13 met");
    show(base, true);
    expect(screen.getByTestId("pretrade-badge").textContent).toBe("not current");
  });

  it("is closed to begin with, and floats like the explanation: a panel of its own, in the same group so the browser keeps one open at a time", () => {
    show(base);
    const d = document.getElementById("pretrade") as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(d.className).toBe("pop pretrade");
    expect(d.getAttribute("name")).toBe("pop");
    expect(d.querySelector(":scope > .popbody")).toBeTruthy();
  });

  it("says in a note that it is a checklist, not a signal", () => {
    show(base);
    expect(screen.getByTestId("pretrade-note").textContent).toBe("A checklist, not a signal: it reads what Prism knows, and cannot see your broker, your account, the option chain or the Greeks. Prism places no orders; the decision is yours.");
  });
});

describe("what the reader ticks", () => {
  it("is five boxes, none ticked, each with its words and a hint of why Prism cannot answer it", () => {
    show(base);
    const items = [...document.querySelectorAll("[data-manual]")];
    expect(items.map((i) => [i.getAttribute("data-manual"), i.querySelector("b")?.textContent])).toEqual([
      ["chain", "I looked at the option chain on my broker"],
      ["greeks", "I checked delta, theta and IV of the contract I will buy"],
      ["stop", "I chose my stop premium and my lot size"],
      ["limit", "I am inside my daily loss limit and my trade count"],
      ["plan", "This is a setup I planned for, not FOMO or revenge"],
    ]);
    expect(items.map((i) => i.querySelector("small")?.textContent)).toEqual([
      "open interest, the change in it, and where call and put OI pile up: Prism does not show the chain",
      "Prism does not compute the Greeks; near expiry, time decay is fast",
      "the Trades tab sizes a trade from your own stop and your own limits",
      "the Trades tab shows today's result against your limit",
      "a rule you set before the session, not a mood",
    ]);
    for (const id of ["chain", "greeks", "stop", "limit", "plan"]) {
      expect(box(id).checked, id).toBe(false);
      expect(box(id).disabled, id).toBe(false);
    }
  });

  it("is ticked and unticked by a click, and the summary counts them", () => {
    show(base);
    fireEvent.click(box("chain"));
    fireEvent.click(box("plan"));
    expect(box("chain").checked).toBe(true);
    expect(box("plan").checked).toBe(true);
    expect(box("greeks").checked).toBe(false);
    expect(summaryText()).toBe("12 of 13 met · 1 caution — yours: 2 of 5 ticked");
    fireEvent.click(box("chain"));
    expect(box("chain").checked).toBe(false);
    expect(summaryText()).toBe("12 of 13 met · 1 caution — yours: 1 of 5 ticked");
  });

  it("is for the setup that is live: a different setup starts clean, and the same one finds them as they were", () => {
    const { rerender } = render(<Host s={base} />);
    fireEvent.click(box("stop"));
    expect(box("stop").checked).toBe(true);
    const other = variant((s) => { X(s).id = "ema_trend_continuation:bull:1"; T(s).decision.setup_id = X(s).id; });
    rerender(<Host s={other} />);
    expect(box("stop").checked).toBe(false);
    expect(summaryText()).toBe("12 of 13 met · 1 caution — yours: 0 of 5 ticked");
    rerender(<Host s={base} />);
    expect(box("stop").checked).toBe(true);
  });

  it("cannot be ticked when there is no setup, and says why", () => {
    show(noSetup());
    for (const id of ["chain", "greeks", "stop", "limit", "plan"]) expect(box(id).disabled, id).toBe(true);
    expect(screen.getByTestId("pretrade-tickhelp").textContent).toBe("These are about a setup: there is none live, so there is nothing to tick yet.");
    fireEvent.click(box("chain"));
    expect(box("chain").checked).toBe(false);
    show(base);
    expect(screen.getByTestId("pretrade-tickhelp").textContent).toBe("Your ticks are for this setup: a different setup starts clean.");
  });

  it("can still be ticked on a page that has lost its link: they are the reader's own", () => {
    show(base, true);
    fireEvent.click(box("limit"));
    expect(box("limit").checked).toBe(true);
  });
});

describe("the links", () => {
  it("take the reader to the Options tab for the contract, and to the Trades tab for sizing and the day's limit", () => {
    const go = vi.fn();
    show(base, false, go);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#pretrade button.linkbtn")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Options →", "Trades →", "Trades →"]);
    buttons.forEach((b) => fireEvent.click(b));
    expect(go.mock.calls.map((c) => c[0])).toEqual(["options", "trades", "trades"]);
  });

  it("are buttons that submit nothing", () => {
    show(base);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#pretrade button")) expect(b.type).toBe("button");
  });
});

describe("what the server says is text", () => {
  it("in every row, whatever it says", () => {
    show(variant((s) => {
      X(s).strategy_name = EVIL; X(s).blockers = [EVIL]; X(s).against = [EVIL]; X(s).confirm_text = EVIL; T(s).market!.text = EVIL; T(s).market!.regime = "conflicting"; T(s).decision.headline = EVIL;
      s.health.issues = [EVIL]; s.health.trusted = false; s.options!.selection!.notice = EVIL; s.options!.selection!.actionable = false;
    }));
    expect(document.querySelector("#pretrade img, #pretrade script, #pretrade [onerror]")).toBeNull();
    expect(document.getElementById("pretrade")?.textContent).toContain(EVIL);
  });
});

describe("in the Overview", () => {
  const mounted = (s: Snapshot | null, over: { stale?: boolean } = {}) => {
    cleanup();
    render(<Overview snapshot={s} tries={0} stale={over.stale ?? false} onGoto={vi.fn() as never} />);
  };
  it("is one line in the decision banner, beside 'Explain this decision', and takes no room of its own", () => {
    mounted(base);
    const go = document.querySelector("#decision .go")!;
    expect([...go.querySelectorAll(":scope > details")].map((d) => [d.id || "explain", d.getAttribute("name")])).toEqual([["explain", "pop"], ["pretrade", "pop"]]);
    expect(document.querySelectorAll("#pretrade")).toHaveLength(1);
    expect(document.getElementById("decision")!.nextElementSibling?.id).toBe("tfrow"); // (nothing sits between the banner and the timeframes: the Overview still fits its screen)
  });
  it("is not there before there is a decision to check", () => {
    mounted(null);
    expect(document.getElementById("pretrade")).toBeNull();
    mounted(variant((s) => { s.trading = null; }));
    expect(document.getElementById("pretrade")).toBeNull();
  });
  it("answers nothing on a stale page", () => {
    mounted(base, { stale: true });
    expect(summaryText()).toBe("not current: the page lost its link to Prism");
  });
  it("with nothing above it holding the ticks, ticks nothing (and does not fail)", () => {
    mounted(base);
    fireEvent.click(box("chain"));
    expect(box("chain").checked).toBe(false);
  });
});
