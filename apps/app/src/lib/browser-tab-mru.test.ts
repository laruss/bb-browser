import { describe, expect, it } from "vitest";
import {
  advanceMruCycle,
  mruCycleTabId,
  promoteTabInMru,
  reconcileMru,
  type BrowserTabSwitcherState,
} from "./browser-tab-mru";

describe("promoteTabInMru", () => {
  it("moves a tab to the front without duplicating it", () => {
    expect(promoteTabInMru(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("returns the same array when the tab is already newest", () => {
    const order = ["a", "b"];
    expect(promoteTabInMru(order, "a")).toBe(order);
  });
});

describe("reconcileMru", () => {
  it("drops closed tabs and keeps the rest in order", () => {
    expect(reconcileMru(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });

  // Tabs restored from storage or opened by an agent were never activated, so
  // nothing has promoted them — they still have to be reachable.
  it("appends tabs the order has never seen", () => {
    expect(reconcileMru(["a"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns the same array when nothing changed", () => {
    const order = ["a", "b"];
    expect(reconcileMru(order, ["a", "b"])).toBe(order);
  });
});

describe("advanceMruCycle", () => {
  const order = ["a", "b", "c"];

  // The whole point of MRU over positional: one press lands on the tab you were
  // in before this one, wherever it sits in the strip.
  it("steps to the previously used tab first", () => {
    const cycle = advanceMruCycle({ cycle: null, order, step: 1 });

    expect(cycle).not.toBeNull();
    expect(mruCycleTabId(cycle as BrowserTabSwitcherState)).toBe("b");
  });

  it("keeps walking back on each press", () => {
    let cycle = advanceMruCycle({ cycle: null, order, step: 1 });
    cycle = advanceMruCycle({ cycle, order, step: 1 });

    expect(mruCycleTabId(cycle as BrowserTabSwitcherState)).toBe("c");
  });

  it("wraps around in both directions", () => {
    let cycle = advanceMruCycle({ cycle: null, order, step: -1 });
    expect(mruCycleTabId(cycle as BrowserTabSwitcherState)).toBe("c");

    cycle = advanceMruCycle({ cycle, order, step: 1 });
    expect(mruCycleTabId(cycle as BrowserTabSwitcherState)).toBe("a");
  });

  // The frozen snapshot is what makes a cycle a cycle. Re-reading a live order
  // that the walk itself is promoting would bounce between two tabs forever,
  // which is the classic broken MRU switcher.
  it("walks its own snapshot, not an order that moved underneath it", () => {
    const started = advanceMruCycle({ cycle: null, order, step: 1 });
    const moved = ["b", "a", "c"];

    const next = advanceMruCycle({ cycle: started, order: moved, step: 1 });

    expect(next?.order).toEqual(order);
    expect(mruCycleTabId(next as BrowserTabSwitcherState)).toBe("c");
  });

  it("does nothing with fewer than two tabs", () => {
    expect(advanceMruCycle({ cycle: null, order: ["a"], step: 1 })).toBeNull();
    expect(advanceMruCycle({ cycle: null, order: [], step: 1 })).toBeNull();
  });
});
