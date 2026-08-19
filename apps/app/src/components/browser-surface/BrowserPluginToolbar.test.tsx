// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowserPluginToolbar } from "./BrowserPluginToolbar";

const TAB_ID = "tab-active";
const PAGE_URL = "https://current.test/page";

interface ToolbarItemFixture {
  pluginId: string;
  itemId: string;
  title: string;
  icon: string | null;
  hasState: boolean;
}

const STAR: ToolbarItemFixture = {
  pluginId: "bookmarks",
  itemId: "star",
  title: "Save this page",
  icon: "Star",
  hasState: true,
};

/**
 * Serves the two endpoints the toolbar reads and records every call, because
 * *which* calls happen is half of what is under test: a control that declared no
 * state must not put a request on every navigation.
 */
function stubEndpoints(args: {
  items: ToolbarItemFixture[];
  states?: unknown[];
}): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.startsWith("/api/v1/plugins/browser/toolbar-state")) {
        return {
          json: async () => ({ ok: true, states: args.states ?? [] }),
          ok: true,
        };
      }
      if (url.startsWith("/api/v1/plugins/contributions")) {
        return {
          json: async () => ({ browserToolbarItems: args.items, ok: true }),
          ok: true,
        };
      }
      return { json: async () => ({ ok: true }), ok: true };
    }),
  );
  return urls;
}

function renderToolbar() {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <BrowserPluginToolbar tabId={TAB_ID} title="A page" url={PAGE_URL} />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BrowserPluginToolbar", () => {
  // The declaration is enough to draw the control: it carries the title, so the
  // button is complete and correct before any per-page answer arrives.
  it("draws a declared control before any state is known", async () => {
    stubEndpoints({ items: [STAR], states: [] });

    renderToolbar();

    const button = await screen.findByRole("button", {
      name: "Save this page",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the state a plugin answered with, title and all", async () => {
    stubEndpoints({
      items: [STAR],
      states: [
        {
          pluginId: "bookmarks",
          itemId: "star",
          active: true,
          title: "Saved — remove",
        },
      ],
    });

    renderToolbar();

    const button = await screen.findByRole("button", {
      name: "Saved — remove",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  // The claim in the contract: a control that looks the same everywhere costs
  // nothing as the user browses. `hasState` is what buys that, so nothing may ask
  // for states when no control declared one.
  it("asks for no states when no control declared one", async () => {
    const urls = stubEndpoints({
      items: [{ ...STAR, hasState: false }],
    });

    renderToolbar();
    await screen.findByRole("button", { name: "Save this page" });

    expect(urls.some((url) => url.includes("toolbar-state"))).toBe(false);
  });

  it("asks again once a press resolves, so a toggle stops looking stale", async () => {
    let states: unknown[] = [];
    const urls = stubEndpoints({ items: [STAR], states: [] });
    // The plugin's answer changes because the press changed it, which is what the
    // invalidation exists to pick up.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        urls.push(url);
        if (url.startsWith("/api/v1/plugins/browser/toolbar-item")) {
          states = [
            {
              pluginId: "bookmarks",
              itemId: "star",
              active: true,
              title: "Saved",
            },
          ];
          expect(init?.method).toBe("POST");
          return { json: async () => ({ ok: true }), ok: true };
        }
        if (url.startsWith("/api/v1/plugins/browser/toolbar-state")) {
          return { json: async () => ({ ok: true, states }), ok: true };
        }
        return {
          json: async () => ({ browserToolbarItems: [STAR], ok: true }),
          ok: true,
        };
      }),
    );

    renderToolbar();
    const button = await screen.findByRole("button", {
      name: "Save this page",
    });
    button.click();

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Saved" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
    });
  });

  // A new tab has no page, and `PluginBrowserToolbarContext.url` promises a control
  // is never asked about one — a button there would post an empty url, be refused
  // by the route, and look like a star that does nothing.
  //
  // Rendered with a page first, deliberately: "no button yet" is also what a
  // pending query looks like, so the button has to be seen before its absence
  // means anything.
  it("takes the control away when the tab has no page", async () => {
    stubEndpoints({ items: [STAR], states: [] });
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const view = render(
      <Wrapper>
        <BrowserPluginToolbar tabId={TAB_ID} title="A page" url={PAGE_URL} />
      </Wrapper>,
    );
    await screen.findByRole("button", { name: "Save this page" });

    view.rerender(
      <Wrapper>
        <BrowserPluginToolbar tabId={TAB_ID} title={null} url="" />
      </Wrapper>,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("draws nothing when no plugin contributed a control", async () => {
    stubEndpoints({ items: [] });

    renderToolbar();

    await waitFor(() => {
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });
  });
});
