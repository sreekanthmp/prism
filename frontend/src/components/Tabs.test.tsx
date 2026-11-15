import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs, TABS, useTab } from "./Tabs";

function Shell() {
  const [tab, setTab] = useTab();
  return (
    <>
      <Tabs tab={tab} onChange={setTab} />
      <output data-testid="open">{tab}</output>
    </>
  );
}
const open = () => screen.getByTestId("open").textContent;
const selected = () => screen.getAllByRole("tab").filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.textContent);

describe("the tabs", () => {
  it("are Overview, Chart, Options, Analysis, Journal and Trades, with the Overview open", () => {
    render(<Shell />);
    expect(screen.getAllByRole("tab").map((b) => b.textContent)).toEqual(["Overview", "Chart", "Options", "Analysis", "Journal", "Trades"]);
    expect(TABS).toHaveLength(6);
    expect(selected()).toEqual(["Overview"]);
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Prism sections");
  });

  it("each tab names the panel it controls", () => {
    render(<Shell />);
    for (const b of screen.getAllByRole("tab")) expect(b.getAttribute("aria-controls")).toBe(`tab-${b.id.replace("tb-", "")}`);
  });

  it("a click opens that tab and puts it in the address", async () => {
    render(<Shell />);
    await userEvent.click(screen.getByRole("tab", { name: "Chart" }));
    expect(open()).toBe("chart");
    expect(selected()).toEqual(["Chart"]);
    expect(location.hash).toBe("#chart");
  });

  it.each(TABS.map((t) => t.id))("an address of #%s opens that tab", (id) => {
    location.hash = `#${id}`;
    render(<Shell />);
    expect(open()).toBe(id);
  });

  it("an address that names no tab opens the Overview", () => {
    location.hash = "#nonsense";
    render(<Shell />);
    expect(open()).toBe("overview");
  });

  it("follows the address when it changes", () => {
    render(<Shell />);
    act(() => {
      location.hash = "#journal";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(open()).toBe("journal");
  });

  it("right and left move between the tabs, wrapping round, and the focus goes with them", () => {
    render(<Shell />);
    const tab = (name: string) => screen.getByRole("tab", { name });
    const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });
    tab("Overview").focus();
    const walk = ["Chart", "Options", "Analysis", "Journal", "Trades", "Overview"];
    for (const name of walk) {
      press("ArrowRight");
      expect(selected()).toEqual([name]);
      expect(document.activeElement).toBe(tab(name));
    }
    press("ArrowLeft");
    expect(selected()).toEqual(["Trades"]);
    expect(document.activeElement).toBe(tab("Trades"));
  });

  it("only the open tab is in the tab order", () => {
    render(<Shell />);
    expect(screen.getAllByRole("tab").map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
  });

  it("ignores any other key", () => {
    render(<Shell />);
    screen.getByRole("tab", { name: "Overview" }).focus();
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "a", "Home"]) fireEvent.keyDown(document.activeElement ?? document.body, { key });
    expect(open()).toBe("overview");
  });
});
