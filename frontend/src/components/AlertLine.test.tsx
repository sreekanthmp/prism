import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AlertItem } from "../alerts";
import { EVIL } from "../test/helpers";
import { AlertLine } from "./AlertLine";

const item = (sev: AlertItem["sev"], head: string, text: string): AlertItem => ({ sev, head, text });
const line = (items: AlertItem[]) => {
  const r = render(<AlertLine items={items} />);
  return { ...r, details: r.container.querySelector("details") as HTMLDetailsElement | null, summary: r.container.querySelector("summary")?.textContent ?? "" };
};

describe("the one alert line", () => {
  it("is nothing when there is nothing to say", () => {
    const { container } = line([]);
    expect(container.innerHTML).toBe("");
  });

  it("is ONE line: the count, the most serious alert, and the rest folded", () => {
    const l = line([item("warn", "NOT READY · DEGRADED", "a"), item("bad", "Data not trusted", "b"), item("warn", "", "c")]);
    expect(l.container.querySelectorAll("details")).toHaveLength(1);
    expect(l.details?.className).toBe("alerts bad");
    expect(l.summary).toBe("⛔ 3 alerts: Data not trusted (+2 more) ▾ details");
  });

  it("says '1 alert' for one, and nothing about more", () => {
    expect(line([item("warn", "", "the quote is old")]).summary).toBe("⚠ 1 alert: the quote is old ▾ details");
  });

  it("leads with the head when there is one and with the text when there is none", () => {
    expect(line([item("warn", "NOT READY", "t")]).summary).toContain("1 alert: NOT READY");
    expect(line([item("warn", "", "just text")]).summary).toContain("1 alert: just text");
  });

  it("lists every alert in full in the floating list, each in its own colour", () => {
    const l = line([item("bad", "Data not trusted", "x. No setup can be ready."), item("warn", "", "w"), item("act", "CE setup ready", "enter")]);
    const rows = [...l.container.querySelectorAll(".alertlist .alert")].map((r) => [r.className, r.textContent]);
    expect(rows).toEqual([["alert bad", "⛔ Data not trusted: x. No setup can be ready."], ["alert warn", "⚠ w"], ["alert act", "🔔 CE setup ready: enter"]]);
  });

  it("a ready setup colours the line green unless something is wrong", () => {
    expect(line([item("act", "CE setup ready", "x")]).details?.className).toBe("alerts act");
    expect(line([item("warn", "w", "x"), item("act", "a", "x")]).details?.className).toBe("alerts act");
    expect(line([item("act", "a", "x"), item("bad", "b", "x")]).details?.className).toBe("alerts bad");
  });

  it("stays open across a redraw, as the once-a-second snapshot redraws the page", () => {
    const l = line([item("warn", "", "a")]);
    fireEvent.click(l.container.querySelector("summary") as Element);
    (l.details as HTMLDetailsElement).open = true;
    l.rerender(<AlertLine items={[item("warn", "", "a"), item("bad", "", "b")]} />);
    expect((l.container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    expect(l.container.querySelector("summary")?.textContent).toContain("2 alerts");
  });

  it("goes away when the alerts do", () => {
    const l = line([item("warn", "", "a")]);
    l.rerender(<AlertLine items={[]} />);
    expect(l.container.innerHTML).toBe("");
  });

  it("shows what a server says as text, not as markup", () => {
    const l = line([item("bad", EVIL, EVIL), item("warn", "", EVIL)]);
    expect(l.container.querySelector("img")).toBeNull();
    expect(l.container.innerHTML).not.toContain("<img");
    expect(l.summary).toContain(EVIL);
  });
});

describe("clearing the setup alerts", () => {
  it("has no button unless it is given something to do", () => {
    expect(line([item("act", "CE setup ready", "x")]).container.querySelector("#alert-clear")).toBeNull();
  });

  it("has the button at the end of the floating list when it is given one, and a click does what it says", () => {
    let cleared = 0;
    const r = render(<AlertLine items={[item("act", "CE setup ready", "x"), item("warn", "", "w")]} onClear={() => { cleared++; }} />);
    const list = r.container.querySelector(".alertlist") as HTMLElement;
    const button = list.querySelector("button#alert-clear") as HTMLButtonElement;
    expect(button.textContent).toBe("clear the setup alerts");
    expect(button.className).toBe("linkbtn");
    expect(button.type).toBe("button");
    expect(list.lastElementChild).toBe(button);
    fireEvent.click(button);
    expect(cleared).toBe(1);
  });
});
