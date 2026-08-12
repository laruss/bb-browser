import { describe, expect, it } from "vitest";
import type { BrowserFixedPanelTab } from "./fixed-panel-tabs-state";
import {
  activateBrowserSurfaceTab,
  addBrowserSurfaceTab,
  closeBrowserSurfaceTab,
  EMPTY_BROWSER_SURFACE_TABS_STATE,
  getActiveBrowserSurfaceTab,
  parseBrowserSurfaceTabsState,
  updateBrowserSurfaceTab,
  type BrowserSurfaceTabsState,
} from "./browser-surface-tabs";

function tab(id: string, url = ""): BrowserFixedPanelTab {
  return { environmentId: null, id, kind: "browser", title: null, url };
}

function stateWith(ids: readonly string[], activeTabId: string | null) {
  return { activeTabId, tabs: ids.map((id) => tab(id)) };
}

describe("browser surface tabs", () => {
  it("appends a new tab and focuses it", () => {
    const first = addBrowserSurfaceTab(
      EMPTY_BROWSER_SURFACE_TABS_STATE,
      tab("a"),
    );
    const second = addBrowserSurfaceTab(first, tab("b"));

    expect(second.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(second.activeTabId).toBe("b");
  });

  it("focuses an already-open tab instead of duplicating it", () => {
    const state = stateWith(["a", "b"], "b");

    const next = addBrowserSurfaceTab(state, tab("a"));

    expect(next.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(next.activeTabId).toBe("a");
  });

  // Closing the focused tab must land somewhere predictable, or the surface
  // shows an unrelated page.
  it("hands focus to the right-hand neighbour when closing the active tab", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a", "b", "c"], "b"), "b");

    expect(next.tabs.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(next.activeTabId).toBe("c");
  });

  it("falls back to the left-hand neighbour when closing the last tab", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a", "b"], "b"), "b");

    expect(next.activeTabId).toBe("a");
  });

  it("keeps focus when closing an inactive tab", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a", "b", "c"], "a"), "c");

    expect(next.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(next.activeTabId).toBe("a");
  });

  it("clears focus when the last tab closes", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a"], "a"), "a");

    expect(next.tabs).toEqual([]);
    expect(next.activeTabId).toBeNull();
  });

  it("ignores closing and activating unknown tabs", () => {
    const state = stateWith(["a"], "a");

    expect(closeBrowserSurfaceTab(state, "missing")).toBe(state);
    expect(activateBrowserSurfaceTab(state, "missing")).toBe(state);
  });

  it("records navigation results on the addressed tab only", () => {
    const next = updateBrowserSurfaceTab(stateWith(["a", "b"], "a"), {
      tabId: "a",
      title: "Example",
      url: "https://example.test/",
    });

    expect(next.tabs[0]).toMatchObject({
      title: "Example",
      url: "https://example.test/",
    });
    expect(next.tabs[1]).toMatchObject({ title: null, url: "" });
  });

  // The native view pushes navigation state on every event; identity-stable
  // no-ops keep React from re-rendering the whole strip on each one.
  it("returns the same state when an update changes nothing", () => {
    const state: BrowserSurfaceTabsState = {
      activeTabId: "a",
      tabs: [{ ...tab("a", "https://example.test/"), title: "Example" }],
    };

    expect(
      updateBrowserSurfaceTab(state, {
        tabId: "a",
        title: "Example",
        url: "https://example.test/",
      }),
    ).toBe(state);
  });

  it("leaves untouched fields alone when only one is supplied", () => {
    const state: BrowserSurfaceTabsState = {
      activeTabId: "a",
      tabs: [{ ...tab("a", "https://example.test/"), title: "Example" }],
    };

    const next = updateBrowserSurfaceTab(state, { tabId: "a", title: null });

    expect(next.tabs[0]).toMatchObject({
      title: null,
      url: "https://example.test/",
    });
  });

  it("resolves the active tab, or null when focus is empty", () => {
    expect(getActiveBrowserSurfaceTab(stateWith(["a", "b"], "b"))?.id).toBe(
      "b",
    );
    expect(
      getActiveBrowserSurfaceTab(EMPTY_BROWSER_SURFACE_TABS_STATE),
    ).toBeNull();
  });
});

describe("browser surface tab persistence", () => {
  const fallback = { activeTabId: "fallback", tabs: [tab("fallback")] };

  it("restores a stored surface", () => {
    const stored = JSON.stringify(stateWith(["a", "b"], "b"));

    const parsed = parseBrowserSurfaceTabsState(stored, fallback);

    expect(parsed.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(parsed.activeTabId).toBe("b");
  });

  it("falls back for missing, malformed and schema-invalid values", () => {
    expect(parseBrowserSurfaceTabsState(null, fallback)).toBe(fallback);
    expect(parseBrowserSurfaceTabsState("{not json", fallback)).toBe(fallback);
    expect(
      parseBrowserSurfaceTabsState(JSON.stringify({ tabs: "nope" }), fallback),
    ).toBe(fallback);
    expect(
      parseBrowserSurfaceTabsState(
        JSON.stringify({ activeTabId: null, tabs: [{ id: "a" }] }),
        fallback,
      ),
    ).toBe(fallback);
  });

  // A store naming a tab that is gone would otherwise render an empty surface
  // while the strip still shows tabs.
  it("repoints a stale active id at a surviving tab", () => {
    const parsed = parseBrowserSurfaceTabsState(
      JSON.stringify({ activeTabId: "gone", tabs: [tab("a"), tab("b")] }),
      fallback,
    );

    expect(parsed.activeTabId).toBe("b");
  });
});
