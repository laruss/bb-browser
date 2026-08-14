// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBrowserSurfaceTabsStorageKey,
  useBrowserSurfaceTabs,
} from "./browser-surface-tabs";

/**
 * The controller end to end: closing has to record enough for reopening to put
 * the tab back, and the two live in different atoms — one persisted, one not.
 */
function renderTabs() {
  return renderHook(() => useBrowserSurfaceTabs(), { wrapper: Provider });
}

beforeEach(() => {
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
});

describe("reopening closed tabs through the controller", () => {
  it("puts the tab back at its index, under its own id", () => {
    const { result } = renderTabs();
    act(() => {
      result.current.openTab("https://first.test/");
      result.current.openTab("https://second.test/");
      result.current.openTab("https://third.test/");
    });
    const middle = result.current.state.tabs[1];
    expect(middle?.url).toBe("https://second.test/");

    act(() => {
      result.current.closeTab(middle?.id as string);
    });
    expect(result.current.state.tabs.map((tab) => tab.url)).toEqual([
      "https://first.test/",
      "https://third.test/",
    ]);

    act(() => {
      result.current.reopenClosedTab();
    });

    expect(result.current.state.tabs.map((tab) => tab.url)).toEqual([
      "https://first.test/",
      "https://second.test/",
      "https://third.test/",
    ]);
    // The same id, which is what lets the shell recognise the tab and restore
    // its history and scroll.
    expect(result.current.state.tabs[1]?.id).toBe(middle?.id);
    expect(result.current.state.activeTabId).toBe(middle?.id);
  });

  it("walks back through several closes, newest first", () => {
    const { result } = renderTabs();
    act(() => {
      result.current.openTab("https://one.test/");
      result.current.openTab("https://two.test/");
    });
    const [first, second] = result.current.state.tabs;

    act(() => {
      result.current.closeTab(first?.id as string);
      result.current.closeTab(second?.id as string);
    });
    act(() => {
      result.current.reopenClosedTab();
    });
    expect(result.current.state.activeTabId).toBe(second?.id);

    act(() => {
      result.current.reopenClosedTab();
    });

    expect(result.current.state.activeTabId).toBe(first?.id);
  });

  it("does nothing when nothing has been closed", () => {
    const { result } = renderTabs();
    act(() => {
      result.current.openTab("https://only.test/");
    });
    const before = result.current.state;

    act(() => {
      result.current.reopenClosedTab();
    });

    expect(result.current.state.tabs).toEqual(before.tabs);
  });
});
