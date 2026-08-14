// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserTabSwitcher } from "./BrowserTabSwitcher";

function tab(id: string, title: string): BrowserFixedPanelTab {
  return {
    environmentId: null,
    id,
    kind: "browser",
    title,
    url: `https://${id}.test/`,
  };
}

const TABS = [tab("a", "Alpha"), tab("b", "Bravo"), tab("c", "Charlie")];

afterEach(cleanup);

describe("BrowserTabSwitcher", () => {
  it("lists tabs in the walk's order, not the strip's", () => {
    render(
      <BrowserTabSwitcher
        onSelect={vi.fn()}
        switcher={{ order: ["c", "a", "b"], index: 1 }}
        tabs={TABS}
      />,
    );

    expect(
      screen.getAllByRole("option").map((row) => row.textContent),
    ).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("marks the row the walk is on", () => {
    render(
      <BrowserTabSwitcher
        onSelect={vi.fn()}
        switcher={{ order: ["c", "a", "b"], index: 1 }}
        tabs={TABS}
      />,
    );

    const selected = screen
      .getAllByRole("option")
      .filter((row) => row.getAttribute("aria-selected") === "true");
    expect(selected.map((row) => row.textContent)).toEqual(["Alpha"]);
  });

  // A mouse never releases Ctrl, so a click has to land on its own.
  it("lands on a row that is clicked", () => {
    const onSelect = vi.fn();
    render(
      <BrowserTabSwitcher
        onSelect={onSelect}
        switcher={{ order: ["c", "a", "b"], index: 0 }}
        tabs={TABS}
      />,
    );

    fireEvent.mouseDown(screen.getByText("Bravo"));

    expect(onSelect).toHaveBeenCalledWith("b");
  });

  // The panel takes focus so the next Ctrl+Tab resolves in the browser command
  // context and the Ctrl release is seen at all.
  it("takes focus when it opens", () => {
    render(
      <BrowserTabSwitcher
        onSelect={vi.fn()}
        switcher={{ order: ["a", "b"], index: 0 }}
        tabs={TABS}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("listbox", { name: "Recent tabs" }),
    );
  });

  it("skips ids that are no longer tabs", () => {
    render(
      <BrowserTabSwitcher
        onSelect={vi.fn()}
        switcher={{ order: ["a", "gone", "b"], index: 0 }}
        tabs={TABS}
      />,
    );

    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});
