// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { getBrowserSurfaceTabsStorageKey } from "@/lib/browser-surface-tabs";
import { BrowserSurfaceView } from "./BrowserSurfaceView";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function renderSurface(browserApi = createNoopDesktopBrowserApi()) {
  window.bbDesktop = createBbDesktopApi(desktopInfo, browserApi);
  // A fresh jotai store per test (the tab atom is module-scoped, so without one
  // the previous test's tabs leak into the next) plus a query client, which the
  // surface needs to read its plugin omnibox contributions.
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <BrowserSurfaceView />
    </Wrapper>,
  );
}

function tabButtons(): HTMLElement[] {
  return screen.getAllByRole("tab");
}

beforeEach(() => {
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
});

describe("BrowserSurfaceView", () => {
  // Page icons come from the shell on their own channel, one push per tab. The
  // surface holds them because the deck unmounts every tab but the active one, so
  // a tab's icon has to outlive its content.
  it("shows an icon the shell pushed for a tab", () => {
    const attachedTabIds: string[] = [];
    const faviconListeners: Array<
      (favicon: { tabId: string; dataUrl: string | null }) => void
    > = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      attach(request) {
        attachedTabIds.push(request.tabId);
      },
      onFavicon(listener) {
        faviconListeners.push(listener);
        return () => {};
      },
    });

    const tabId = attachedTabIds.at(-1);
    expect(tabId).toBeDefined();
    expect(tabButtons()[0]?.querySelector("img")).toBeNull();

    act(() => {
      for (const listener of faviconListeners) {
        listener({ dataUrl: "data:image/png;base64,aWNvbg==", tabId: tabId! });
      }
    });

    expect(tabButtons()[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,aWNvbg==",
    );
  });

  // The surface is the product here, so it must never present an empty frame.
  it("opens one tab on first mount", () => {
    renderSurface();

    expect(tabButtons()).toHaveLength(1);
    expect(tabButtons()[0]?.textContent).toBe("New tab");
    expect(tabButtons()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("adds and focuses a tab from the strip", () => {
    renderSurface();

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    const tabs = tabButtons();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("closes a tab and refocuses a survivor", () => {
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(tabButtons()).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: /^Close / })[1]);

    const tabs = tabButtons();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });

  // Closing the last tab must leave the new-tab screen, not an empty surface.
  it("reopens an empty tab after the last one closes", () => {
    renderSurface();

    fireEvent.click(screen.getByRole("button", { name: /^Close / }));

    expect(tabButtons()).toHaveLength(1);
    expect(tabButtons()[0]?.textContent).toBe("New tab");
  });

  // The surface owns the omnibox chrome, so the tab content must not render its
  // own address bar underneath it.
  it("renders exactly one address bar — the surface's own", () => {
    renderSurface();

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByTestId("browser-tab-nav-bar")).toBeNull();
  });

  it("navigates the active tab from the omnibox", () => {
    const attach = vi.fn();
    const navigate = vi.fn();
    renderSurface({ ...createNoopDesktopBrowserApi(), attach, navigate });
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(navigate).toHaveBeenCalledWith({
      // The tab the deck attached is the one the omnibox must drive.
      tabId: attach.mock.calls[0]?.[0].tabId as string,
      url: "https://example.com",
    });
  });

  // The point of the surface is that it drives the real Electron browser layer,
  // so assert the native view is attached for the focused tab — and for the
  // newly focused one after a switch, since only the active tab is mounted.
  it("attaches the active tab's native view, and the next one on switch", () => {
    const attach = vi.fn();
    renderSurface({ ...createNoopDesktopBrowserApi(), attach });

    expect(attach).toHaveBeenCalledTimes(1);
    const firstTabId = attach.mock.calls[0]?.[0].tabId as string;
    expect(tabButtons()[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[1]?.[0].tabId).not.toBe(firstTabId);
  });

  // A page's `target="_blank"` link never becomes a native popup: the shell
  // denies it and pushes the request back, so this surface is what has to turn
  // it into a tab. With no subscriber the link did nothing at all.
  it("opens a popup from one of its own tabs as a new tab", () => {
    const attach = vi.fn();
    const scopedListeners: Array<
      (request: { tabId: string; url: string }) => void
    > = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      attach,
      onScopedOpenTab(listener) {
        scopedListeners.push(listener);
        return () => {};
      },
    });
    const tabId = attach.mock.calls[0]?.[0].tabId as string;
    // The subscription is renewed as the tab list changes and this fake's
    // unsubscribe keeps the dead listeners, so the last one is the live one.
    const emit = (request: { tabId: string; url: string }) => {
      act(() => {
        scopedListeners.at(-1)?.(request);
      });
    };

    // A popup from a tab this surface does not own is another view's business.
    emit({ tabId: "not-a-surface-tab", url: "https://example.com/elsewhere" });
    expect(tabButtons()).toHaveLength(1);

    emit({ tabId, url: "https://example.com/popup" });

    expect(tabButtons()).toHaveLength(2);
    // Foreground, as every browser opens one: the popup's tab is the one the
    // deck then attaches, so its page is what loads.
    expect(attach.mock.calls.at(-1)?.[0].url).toBe("https://example.com/popup");
  });

  // Real popups: the shell created the window and chose the tab id, because the
  // page had its `window.open()` handle before this surface heard of the tab.
  it("adopts a popup the shell created, and drops it when it closes itself", () => {
    const attach = vi.fn();
    const setPopupTabs = vi.fn();
    const popupListeners: Array<
      (
        popup:
          | { kind: "opened"; openerTabId: string; tabId: string; url: string }
          | { kind: "closed"; tabId: string },
      ) => void
    > = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      attach,
      setPopupTabs,
      onPopup(listener) {
        popupListeners.push(listener);
        return () => {};
      },
    });
    const openerTabId = attach.mock.calls[0]?.[0].tabId as string;
    const emit = (popup: Parameters<(typeof popupListeners)[number]>[0]) => {
      act(() => {
        popupListeners.at(-1)?.(popup);
      });
    };

    // The surface claims its own tabs, which is what lets the shell host a real
    // popup for them at all.
    expect(setPopupTabs.mock.calls.at(-1)?.[0].tabIds).toEqual([openerTabId]);

    // A popup from a tab this surface does not own is another view's business.
    emit({
      kind: "opened",
      openerTabId: "not-a-surface-tab",
      tabId: "browser-popup:9",
      url: "https://accounts.example.com/oauth",
    });
    expect(tabButtons()).toHaveLength(1);

    emit({
      kind: "opened",
      openerTabId,
      tabId: "browser-popup:1",
      url: "https://accounts.example.com/oauth",
    });

    expect(tabButtons()).toHaveLength(2);
    // The shell's id, not one this surface invented: the view it already holds
    // is keyed by it.
    expect(attach.mock.calls.at(-1)?.[0].tabId).toBe("browser-popup:1");

    // How an OAuth flow ends.
    emit({ kind: "closed", tabId: "browser-popup:1" });

    expect(tabButtons()).toHaveLength(1);
  });

  // Version skew: a shell predating source-attributed popups offers only the
  // unscoped channel, and the link still has to open.
  it("opens a popup from a shell with no scoped channel", () => {
    const openTabListeners: Array<(request: { url: string }) => void> = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      onOpenTab(listener) {
        openTabListeners.push(listener);
        return () => {};
      },
    });

    act(() => {
      openTabListeners.at(-1)?.({ url: "https://example.com/popup" });
    });

    expect(tabButtons()).toHaveLength(2);
  });
});
