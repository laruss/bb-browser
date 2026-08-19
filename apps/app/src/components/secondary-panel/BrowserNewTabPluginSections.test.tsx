// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowserNewTabPluginSections } from "./BrowserNewTabPluginSections";

const TAB_ID = "browser:a";

const SECTION = {
  pluginId: "bookmarks",
  widgetId: "saved",
  label: "Bookmarks",
  rows: [
    {
      title: "The docs",
      subtitle: "read later",
      url: "https://example.test/docs",
    },
    { title: "A page", subtitle: null, url: "https://example.test/page" },
  ],
};

/**
 * Serves the two endpoints and records every call: *which* calls happen is half
 * of what is under test, since an install with no widget must ask nothing when a
 * tab opens.
 */
function stubEndpoints(args: {
  widgets: { pluginId: string; widgetId: string }[];
  sections?: unknown[];
}): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.startsWith("/api/v1/plugins/browser/new-tab")) {
        return {
          json: async () => ({ ok: true, sections: args.sections ?? [] }),
          ok: true,
        };
      }
      return {
        json: async () => ({ browserNewTabWidgets: args.widgets, ok: true }),
        ok: true,
      };
    }),
  );
  return urls;
}

function renderSections(onNavigate = vi.fn()) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <BrowserNewTabPluginSections onNavigate={onNavigate} tabId={TAB_ID} />
    </Wrapper>,
  );
  return onNavigate;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BrowserNewTabPluginSections", () => {
  it("renders a plugin's section under its own heading", async () => {
    stubEndpoints({
      widgets: [{ pluginId: "bookmarks", widgetId: "saved" }],
      sections: [SECTION],
    });

    renderSections();

    expect(await screen.findByText("Bookmarks")).toBeDefined();
    expect(screen.getByText("The docs")).toBeDefined();
    // The plugin's own second line where it gave one, the host where it did not.
    expect(screen.getByText("read later")).toBeDefined();
    expect(screen.getByText("example.test")).toBeDefined();
  });

  // A row is a link the plugin already resolved, so opening it is navigation
  // rather than a call back into the plugin.
  it("navigates to a row's url without calling the plugin back", async () => {
    const urls = stubEndpoints({
      widgets: [{ pluginId: "bookmarks", widgetId: "saved" }],
      sections: [SECTION],
    });
    const onNavigate = renderSections();

    (await screen.findByText("The docs")).click();

    expect(onNavigate).toHaveBeenCalledWith("https://example.test/docs");
    expect(urls.filter((url) => url.includes("new-tab"))).toHaveLength(1);
  });

  // The declaration is what buys this: with nobody registered, opening a tab
  // costs no request at all.
  it("asks for nothing when no plugin declared a widget", async () => {
    const urls = stubEndpoints({ widgets: [] });

    renderSections();

    await waitFor(() => {
      expect(urls.some((url) => url.includes("contributions"))).toBe(true);
    });
    expect(urls.some((url) => url.includes("new-tab"))).toBe(false);
  });

  it("draws nothing when the widget had nothing to list", async () => {
    stubEndpoints({
      widgets: [{ pluginId: "bookmarks", widgetId: "saved" }],
      sections: [],
    });

    renderSections();

    await waitFor(() => {
      expect(screen.queryByRole("list")).toBeNull();
    });
  });
});
