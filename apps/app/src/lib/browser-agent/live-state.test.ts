import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
  BbDesktopBrowserStateHandler,
} from "@patcher/desktop-contract";
import {
  getBrowserLiveState,
  resetBrowserLiveState,
  subscribeBrowserLiveState,
  waitForBrowserTabSettled,
} from "./live-state";

function createDesktopBrowser(): {
  api: BbDesktopBrowserApi;
  push: (state: BbDesktopBrowserState) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<BbDesktopBrowserStateHandler>();
  return {
    api: {
      onState(listener: BbDesktopBrowserStateHandler) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } as unknown as BbDesktopBrowserApi,
    push(state) {
      for (const listener of listeners) {
        listener(state);
      }
    },
    listenerCount: () => listeners.size,
  };
}

function state(
  tabId: string,
  overrides: Partial<BbDesktopBrowserState> = {},
): BbDesktopBrowserState {
  return {
    tabId,
    url: "https://example.com/",
    title: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

afterEach(() => {
  resetBrowserLiveState();
  vi.useRealTimers();
});

describe("browser live state", () => {
  it("records pushes for every tab, not just the mounted one", () => {
    const desktop = createDesktopBrowser();
    const unsubscribe = subscribeBrowserLiveState(desktop.api);

    expect(getBrowserLiveState("a")).toBeNull();
    desktop.push(state("a", { canGoBack: true }));
    desktop.push(state("b"));

    // This is what lets browser tools work from a thread route: the shell pushes
    // for every view, not only the one BrowserTabContent is mounted for.
    expect(getBrowserLiveState("a")?.canGoBack).toBe(true);
    expect(getBrowserLiveState("b")?.tabId).toBe("b");

    unsubscribe();
    expect(desktop.listenerCount()).toBe(0);
  });

  it("does nothing at all without a desktop bridge", () => {
    const unsubscribe = subscribeBrowserLiveState(null);

    expect(() => {
      unsubscribe();
    }).not.toThrow();
    expect(getBrowserLiveState("a")).toBeNull();
  });

  it("settles on the tab's own finished load", async () => {
    const desktop = createDesktopBrowser();
    subscribeBrowserLiveState(desktop.api);

    const pending = waitForBrowserTabSettled("a", 1_000);
    // Another tab finishing, and this tab still loading, are both irrelevant.
    desktop.push(state("b"));
    desktop.push(state("a", { isLoading: true }));
    desktop.push(state("a", { isLoading: false }));

    await expect(pending).resolves.toEqual({ timedOut: false });
  });

  it("gives up rather than hanging when a page never finishes", async () => {
    vi.useFakeTimers();
    const desktop = createDesktopBrowser();
    subscribeBrowserLiveState(desktop.api);

    const pending = waitForBrowserTabSettled("a", 1_000);
    desktop.push(state("a", { isLoading: true }));
    await vi.advanceTimersByTimeAsync(1_001);

    // A slow page is not a failed command: the caller reports what it knows.
    await expect(pending).resolves.toEqual({ timedOut: true });
  });
});
