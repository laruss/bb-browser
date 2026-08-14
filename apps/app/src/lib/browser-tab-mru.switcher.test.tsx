// @vitest-environment jsdom

import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useBrowserTabCycling,
  type BrowserTabCycling,
} from "./browser-tab-mru";

/**
 * The switcher as it is actually used: a walk driven by repeated Ctrl+Tab, and
 * landed by releasing Ctrl.
 *
 * `activeTabId` is fed back in, because that is how the hook learns the use
 * order — the same loop the surface closes.
 */
function renderCycling(tabIds: readonly string[], initial: string) {
  const activateTab = vi.fn();
  const view = renderHook(
    ({ activeTabId }: { activeTabId: string }) =>
      useBrowserTabCycling({ activateTab, activeTabId, tabIds }),
    { initialProps: { activeTabId: initial } },
  );
  return {
    activateTab,
    result: view.result,
    /** Switch tabs the way a click would, so the use order records it. */
    visit(tabId: string) {
      view.rerender({ activeTabId: tabId });
    },
    cycle(step: number) {
      act(() => {
        view.result.current.cycleRecentTab(step);
      });
    },
    releaseControl() {
      act(() => {
        fireEvent.keyUp(document, { key: "Control" });
      });
    },
  };
}

function highlighted(cycling: BrowserTabCycling): string | null {
  const { switcher } = cycling;
  return switcher === null ? null : (switcher.order[switcher.index] ?? null);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the Ctrl+Tab switcher", () => {
  // The complaint this design answers: one press must land on the tab you were
  // in before this one, not on the next one along the strip.
  it("highlights the previously used tab first, whatever its position", () => {
    // Visited a, then c, then b — so from b the previous tab is c, which sits
    // *after* b in the strip.
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("c");
    harness.visit("b");

    harness.cycle(1);

    expect(highlighted(harness.result.current)).toBe("c");
  });

  // Nothing is activated while walking: that happens on landing, so a walk
  // across five tabs does not load five pages.
  it("switches nothing until Ctrl is released", () => {
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("b");
    harness.visit("c");

    harness.cycle(1);
    expect(harness.activateTab).not.toHaveBeenCalled();

    harness.releaseControl();

    expect(harness.activateTab).toHaveBeenCalledWith("b");
    expect(harness.result.current.switcher).toBeNull();
  });

  it("walks further down the list on each press, and back on shift", () => {
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("b");
    harness.visit("c");

    harness.cycle(1);
    expect(highlighted(harness.result.current)).toBe("b");
    harness.cycle(1);
    expect(highlighted(harness.result.current)).toBe("a");
    harness.cycle(-1);
    expect(highlighted(harness.result.current)).toBe("b");
  });

  it("shows the list in most-recently-used order", () => {
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("b");
    harness.visit("c");

    harness.cycle(1);

    expect(harness.result.current.switcher?.order).toEqual(["c", "b", "a"]);
  });

  it("closes without switching on Escape", () => {
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("b");
    harness.cycle(1);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(harness.activateTab).not.toHaveBeenCalled();
    expect(harness.result.current.switcher).toBeNull();
  });

  it("lands on a tab picked from the list directly", () => {
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("b");
    harness.cycle(1);

    act(() => {
      harness.result.current.selectSwitcherTab("c");
    });

    expect(harness.activateTab).toHaveBeenCalledWith("c");
    expect(harness.result.current.switcher).toBeNull();
  });

  // Landing promotes, so the next Ctrl+Tab goes back where it came from —
  // which is what makes it a toggle between two tabs.
  it("toggles between the last two tabs on repeated presses", () => {
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("b");
    harness.visit("c");

    harness.cycle(1);
    harness.releaseControl();
    expect(harness.activateTab).toHaveBeenLastCalledWith("b");
    harness.visit("b");

    harness.cycle(1);
    harness.releaseControl();

    expect(harness.activateTab).toHaveBeenLastCalledWith("c");
  });

  it("does nothing with a single tab", () => {
    const harness = renderCycling(["a"], "a");

    harness.cycle(1);

    expect(harness.result.current.switcher).toBeNull();
    expect(harness.activateTab).not.toHaveBeenCalled();
  });

  // A missed Ctrl release must not strand the overlay with the page frozen
  // behind it.
  it("lands on its own if the release is never seen", () => {
    vi.useFakeTimers();
    const harness = renderCycling(["a", "b", "c"], "a");
    harness.visit("b");
    harness.cycle(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(harness.activateTab).toHaveBeenCalledWith("a");
    expect(harness.result.current.switcher).toBeNull();
  });
});
