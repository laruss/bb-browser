// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginBrowserFindActionContribution } from "@/hooks/queries/plugin-contribution-queries";
import { BrowserFindBar, type BrowserFindBarProps } from "./BrowserFindBar";

function renderBar(overrides: Partial<BrowserFindBarProps> = {}) {
  const props: BrowserFindBarProps = {
    focusToken: 1,
    matches: { activeMatchOrdinal: 2, matches: 7 },
    onClose: vi.fn(),
    onSearch: vi.fn(),
    onStep: vi.fn(),
    query: "needle",
    ...overrides,
  };
  const view = render(<BrowserFindBar {...props} />);
  return {
    ...props,
    input: screen.getByRole("textbox", { name: "Find in page" }),
    rerender: (next: Partial<BrowserFindBarProps>) => {
      view.rerender(<BrowserFindBar {...props} {...next} />);
    },
  };
}

const ACTION: PluginBrowserFindActionContribution = {
  pluginId: "notes",
  itemId: "save-search",
  title: "Save this search",
};

afterEach(cleanup);

describe("BrowserFindBar", () => {
  it("searches on every keystroke rather than on submit", () => {
    const bar = renderBar({ query: "" });

    fireEvent.change(bar.input, { target: { value: "n" } });
    fireEvent.change(bar.input, { target: { value: "ne" } });

    expect(bar.onSearch).toHaveBeenNthCalledWith(1, "n");
    expect(bar.onSearch).toHaveBeenNthCalledWith(2, "ne");
  });

  it("steps with Enter, and back with Shift+Enter", () => {
    const bar = renderBar();

    fireEvent.keyDown(bar.input, { key: "Enter" });
    fireEvent.keyDown(bar.input, { key: "Enter", shiftKey: true });

    expect(bar.onStep).toHaveBeenNthCalledWith(1, 1);
    expect(bar.onStep).toHaveBeenNthCalledWith(2, -1);
  });

  it("closes on Escape", () => {
    const bar = renderBar();

    fireEvent.keyDown(bar.input, { key: "Escape" });

    expect(bar.onClose).toHaveBeenCalled();
  });

  it("shows where in the matches the page is", () => {
    renderBar();

    expect(screen.getByText("2/7")).toBeDefined();
  });

  // Nothing to step through, so the arrows say so rather than doing nothing.
  it("disables the arrows with no matches", () => {
    renderBar({ matches: { activeMatchOrdinal: 0, matches: 0 } });

    expect(
      (screen.getByRole("button", { name: "Next match" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("No results")).toBeDefined();
  });

  // Focus follows the token, not the mount: pressing the shortcut again while
  // the bar is open has to select what is in it.
  it("takes focus and selects on every open", () => {
    const bar = renderBar();
    (bar.input as HTMLInputElement).setSelectionRange(6, 6);

    bar.rerender({ focusToken: 2 });

    expect(document.activeElement).toBe(bar.input);
    expect((bar.input as HTMLInputElement).selectionStart).toBe(0);
    expect((bar.input as HTMLInputElement).selectionEnd).toBe(6);
  });

  it("offers a contributed action with the query behind it", () => {
    const onRunAction = vi.fn();
    renderBar({ actions: [ACTION], onRunAction });

    fireEvent.click(screen.getByRole("button", { name: "Save this search" }));

    expect(onRunAction).toHaveBeenCalledWith(ACTION);
  });

  // Every action is about the query, so there is nothing to run without one.
  it("disables contributed actions with an empty bar", () => {
    renderBar({ actions: [ACTION], query: "", matches: null });

    expect(
      (
        screen.getByRole("button", {
          name: "Save this search",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
