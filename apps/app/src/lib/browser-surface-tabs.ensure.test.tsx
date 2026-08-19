// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBrowserSurfaceTabsStorageKey,
  useBrowserSurfaceTabs,
} from "./browser-surface-tabs";

/**
 * The surface must never be without a page, and must never gain two of them
 * asking for one. The second half only became visible once each window got its
 * own store: a fresh window starts empty, and the effect that guarantees a page
 * runs twice in development — each run reading the same "no tabs" from a render
 * it had already left.
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

describe("ensuring the surface has a page", () => {
  it("opens one tab however many callers ask at once", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.ensureWebTab();
      result.current.ensureWebTab();
    });

    expect(result.current.webTabs).toHaveLength(1);
  });

  it("leaves an existing page alone", () => {
    const { result } = renderTabs();
    act(() => {
      result.current.openTab("https://first.test/");
    });

    act(() => {
      result.current.ensureWebTab();
    });

    expect(result.current.webTabs.map((tab) => tab.url)).toEqual([
      "https://first.test/",
    ]);
  });

  // The replacement is a page to come back to, not one being asked for: a user
  // reading Settings must not be thrown out of it.
  it("does not steal focus from whatever is active", () => {
    const { result } = renderTabs();
    act(() => {
      result.current.openTab("https://first.test/");
    });
    const first = result.current.webTabs[0];
    act(() => {
      result.current.closeTab(first?.id ?? "");
    });

    act(() => {
      result.current.ensureWebTab();
    });

    expect(result.current.webTabs).toHaveLength(1);
    expect(result.current.state.activeTabId).toBe(
      result.current.webTabs[0]?.id,
    );
  });
});
