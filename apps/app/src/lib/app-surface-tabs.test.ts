import { describe, expect, it } from "vitest";
import {
  classifySurfaceRoute,
  reconcileBrowserSurfaceTabsWithRoute,
  resolveAppTabDestinationKey,
  resolveSurfaceTabRoute,
} from "./app-surface-tabs";
import {
  createAppSurfaceTab,
  createBrowserSurfaceTab,
  isAppSurfaceTab,
  type BrowserSurfaceTabsState,
} from "./browser-surface-tabs";

function webTabState(...urls: readonly string[]): BrowserSurfaceTabsState {
  const tabs = urls.map((url) => createBrowserSurfaceTab(url));
  return { activeTabId: tabs.at(-1)?.id ?? null, tabs };
}

describe("classifySurfaceRoute", () => {
  it("keeps the surface's own route on the browser", () => {
    expect(classifySurfaceRoute("/browser")).toBe("browser");
  });

  it("sends the agent screens to the side panel", () => {
    expect(classifySurfaceRoute("/")).toBe("agent-panel");
    expect(classifySurfaceRoute("/threads/t1")).toBe("agent-panel");
    expect(classifySurfaceRoute("/projects/p1/threads/t1")).toBe("agent-panel");
    // A project's compose screen is the same New-thread screen, scoped.
    expect(classifySurfaceRoute("/projects/p1")).toBe("agent-panel");
  });

  it("sends every remaining destination to a tab", () => {
    expect(classifySurfaceRoute("/settings")).toBe("app-tab");
    expect(classifySurfaceRoute("/settings/servers")).toBe("app-tab");
    expect(classifySurfaceRoute("/tools/plugins")).toBe("app-tab");
    expect(classifySurfaceRoute("/plugins/automations/automations")).toBe(
      "app-tab",
    );
    // A project's settings are a destination even though its compose screen is
    // not; the two live under the same prefix, so this is the pair that catches
    // a prefix match written too greedily.
    expect(classifySurfaceRoute("/projects/p1/settings")).toBe("app-tab");
  });
});

describe("resolveAppTabDestinationKey", () => {
  it("collapses one destination's pages onto a single tab", () => {
    expect(resolveAppTabDestinationKey("/settings/servers")).toBe(
      resolveAppTabDestinationKey("/settings"),
    );
    expect(resolveAppTabDestinationKey("/tools/skills/library/s1")).toBe(
      resolveAppTabDestinationKey("/tools/plugins"),
    );
  });

  it("keeps separate destinations apart", () => {
    const keys = [
      resolveAppTabDestinationKey("/settings"),
      resolveAppTabDestinationKey("/tools/plugins"),
      resolveAppTabDestinationKey("/plugins/automations/automations"),
      resolveAppTabDestinationKey("/plugins/automations/runs"),
      resolveAppTabDestinationKey("/projects/p1/settings"),
      resolveAppTabDestinationKey("/projects/p2/settings"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("reconcileBrowserSurfaceTabsWithRoute", () => {
  it("opens a tab for a destination the strip does not have yet", () => {
    const state = webTabState("https://example.com");
    const next = reconcileBrowserSurfaceTabsWithRoute(state, {
      path: "/settings",
      title: "Settings",
    });

    expect(next.tabs).toHaveLength(2);
    const opened = next.tabs.at(-1);
    expect(opened && isAppSurfaceTab(opened) && opened.path).toBe("/settings");
    expect(next.activeTabId).toBe(opened?.id);
  });

  it("moves the destination's existing tab instead of opening a second one", () => {
    const settings = createAppSurfaceTab({ path: "/settings", title: null });
    const web = createBrowserSurfaceTab("https://example.com");
    const state: BrowserSurfaceTabsState = {
      activeTabId: web.id,
      tabs: [settings, web],
    };

    const next = reconcileBrowserSurfaceTabsWithRoute(state, {
      path: "/settings/servers",
      title: "Servers",
    });

    expect(next.tabs).toHaveLength(2);
    expect(next.activeTabId).toBe(settings.id);
    const moved = next.tabs.find((tab) => tab.id === settings.id);
    expect(moved && isAppSurfaceTab(moved) && moved.path).toBe(
      "/settings/servers",
    );
    expect(moved && isAppSurfaceTab(moved) && moved.title).toBe("Servers");
  });

  it("keeps a query string in the tab without letting it split the destination", () => {
    const settings = createAppSurfaceTab({
      path: "/settings?section=archived",
      title: null,
    });
    const state: BrowserSurfaceTabsState = {
      activeTabId: settings.id,
      tabs: [settings],
    };

    const next = reconcileBrowserSurfaceTabsWithRoute(state, {
      path: "/settings?section=inbox",
      title: null,
    });

    expect(next.tabs).toHaveLength(1);
    const moved = next.tabs[0];
    expect(moved && isAppSurfaceTab(moved) && moved.path).toBe(
      "/settings?section=inbox",
    );
  });

  it("hands the main area back to the last web tab off a destination route", () => {
    const first = createBrowserSurfaceTab("https://first.example");
    const second = createBrowserSurfaceTab("https://second.example");
    const settings = createAppSurfaceTab({ path: "/settings", title: null });
    const state: BrowserSurfaceTabsState = {
      activeTabId: settings.id,
      tabs: [first, second, settings],
    };

    expect(reconcileBrowserSurfaceTabsWithRoute(state, null).activeTabId).toBe(
      second.id,
    );
  });

  it("leaves a web tab alone off a destination route", () => {
    const state = webTabState("https://example.com");
    expect(reconcileBrowserSurfaceTabsWithRoute(state, null)).toBe(state);
  });

  // The surface opens a web tab when it has none; until it does, moving the
  // pointer off the app tab would leave the strip pointing at nothing.
  it("keeps the app tab active when there is no web tab to fall back to", () => {
    const settings = createAppSurfaceTab({ path: "/settings", title: null });
    const state: BrowserSurfaceTabsState = {
      activeTabId: settings.id,
      tabs: [settings],
    };
    expect(reconcileBrowserSurfaceTabsWithRoute(state, null)).toBe(state);
  });

  // Restoring a session runs the same reconcile a navigation does: the window
  // wins, and a persisted pointer at an app tab does not survive a start on the
  // browser route.
  it("corrects a restored pointer to match the route the app opened on", () => {
    const web = createBrowserSurfaceTab("https://example.com");
    const settings = createAppSurfaceTab({ path: "/settings", title: null });
    const restored: BrowserSurfaceTabsState = {
      activeTabId: settings.id,
      tabs: [web, settings],
    };

    expect(
      reconcileBrowserSurfaceTabsWithRoute(restored, null).activeTabId,
    ).toBe(web.id);
  });

  it("is idempotent, so the sync effect cannot drive itself", () => {
    const state = webTabState("https://example.com");
    const once = reconcileBrowserSurfaceTabsWithRoute(state, {
      path: "/settings",
      title: "Settings",
    });
    expect(
      reconcileBrowserSurfaceTabsWithRoute(once, {
        path: "/settings",
        title: "Settings",
      }),
    ).toBe(once);
  });
});

describe("resolveSurfaceTabRoute", () => {
  it("navigates to an app tab's own screen", () => {
    const tab = createAppSurfaceTab({ path: "/settings/servers", title: null });
    expect(resolveSurfaceTabRoute({ isOnAppTabRoute: false, tab })).toBe(
      "/settings/servers",
    );
  });

  it("leaves a destination route for the browser when a web tab is picked", () => {
    const tab = createBrowserSurfaceTab("https://example.com");
    expect(resolveSurfaceTabRoute({ isOnAppTabRoute: true, tab })).toBe(
      "/browser",
    );
  });

  // The thread in the side panel and the page in the main area share one URL, so
  // switching pages must not navigate.
  it("stays put when a web tab is picked from an agent route", () => {
    const tab = createBrowserSurfaceTab("https://example.com");
    expect(resolveSurfaceTabRoute({ isOnAppTabRoute: false, tab })).toBeNull();
  });

  it("leaves a destination route when the last tab closes", () => {
    expect(resolveSurfaceTabRoute({ isOnAppTabRoute: true, tab: null })).toBe(
      "/browser",
    );
  });
});
