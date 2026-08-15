// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getBrowserSurfaceTabsStorageKey,
  useBrowserSurfaceTabs,
  useOpenBrowserSurfaceTab,
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
    const middle = result.current.webTabs[1];
    expect(middle?.url).toBe("https://second.test/");

    act(() => {
      result.current.closeTab(middle?.id as string);
    });
    expect(result.current.webTabs.map((tab) => tab.url)).toEqual([
      "https://first.test/",
      "https://third.test/",
    ]);

    act(() => {
      result.current.reopenClosedTab();
    });

    expect(result.current.webTabs.map((tab) => tab.url)).toEqual([
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

// The surface makes sure a page always exists to come back to, and does it
// while the user may be reading Settings. Stealing focus there would throw them
// out of the screen they are on to show them a blank tab they never asked for.
describe("opening a tab in the background", () => {
  it("leaves the strip pointing where it was", () => {
    const { result } = renderTabs();
    act(() => {
      result.current.openTab("https://first.test/");
    });
    const first = result.current.state.activeTabId;

    act(() => {
      result.current.openTab("https://second.test/", { activate: false });
    });

    expect(result.current.webTabs).toHaveLength(2);
    expect(result.current.state.activeTabId).toBe(first);
  });

  it("focuses it anyway when there was nothing to keep", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.openTab("https://only.test/", { activate: false });
    });

    expect(result.current.state.activeTabId).toBe(
      result.current.webTabs[0]?.id,
    );
  });
});

// One browser. A thread that wants to show a page hands it to the surface
// instead of hosting a browser of its own beside the conversation — and since
// the surface already owns the main area on an agent route, the page lands
// beside the thread rather than instead of it.
describe("opening a page from elsewhere in the app", () => {
  function renderBoth() {
    return renderHook(
      () => ({
        open: useOpenBrowserSurfaceTab(),
        tabs: useBrowserSurfaceTabs(),
      }),
      { wrapper: Provider },
    );
  }

  it("puts the page in the surface's strip, focused", () => {
    const { result } = renderBoth();

    act(() => {
      result.current.open("https://example.test/page");
    });

    const opened = result.current.tabs.webTabs.at(-1);
    expect(opened?.url).toBe("https://example.test/page");
    expect(result.current.tabs.state.activeTabId).toBe(opened?.id);
  });
});
