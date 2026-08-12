import { describe, expect, it } from "vitest";
import type { BrowserHistoryEntry } from "@/lib/browser-history";
import { rankOmniboxSuggestions } from "../rank";
import type {
  OmniboxProvider,
  OmniboxProviderSuggestion,
  OmniboxSuggestion,
} from "../types";
import { createOmniboxHistoryProvider } from "./history";
import { createOmniboxNavigationProvider } from "./navigation";
import {
  createOmniboxOpenTabsProvider,
  type OmniboxOpenTab,
} from "./open-tabs";
import { createOmniboxSearchProvider } from "./search";

/** The built-in providers are synchronous, so tests can read results directly. */
function suggest(
  provider: OmniboxProvider,
  query: string,
): readonly OmniboxProviderSuggestion[] {
  const result = provider.suggest(query, {
    signal: new AbortController().signal,
  });
  if (result instanceof Promise) {
    throw new Error(`${provider.id} answered asynchronously`);
  }
  return result;
}

function tab(id: string, url: string, title: string | null): OmniboxOpenTab {
  return { id, title, url };
}

function visit(url: string, title: string | null): BrowserHistoryEntry {
  return { title, url, visitedAt: 0 };
}

/** Rank exactly as the controller does, to assert cross-provider ordering. */
function rankAcross(
  providers: readonly OmniboxProvider[],
  query: string,
): readonly OmniboxSuggestion[] {
  return rankOmniboxSuggestions({
    maxPerProvider: 4,
    maxSuggestions: 8,
    suggestions: providers.flatMap((provider) =>
      suggest(provider, query).map((suggestion) => ({
        ...suggestion,
        providerId: provider.id,
      })),
    ),
  });
}

describe("navigation provider", () => {
  const provider = createOmniboxNavigationProvider();

  it("offers a bare host as an https address", () => {
    expect(suggest(provider, "example.com")).toEqual([
      expect.objectContaining({
        action: { type: "navigate", url: "https://example.com" },
        kind: "navigate",
        score: 1,
        title: "https://example.com",
      }),
    ]);
  });

  it("keeps an explicit scheme as typed", () => {
    expect(suggest(provider, "http://localhost:5173/x")[0]?.action).toEqual({
      type: "navigate",
      url: "http://localhost:5173/x",
    });
  });

  it("offers nothing for text that is not an address", () => {
    expect(suggest(provider, "best headphones")).toEqual([]);
    expect(suggest(provider, "headphones")).toEqual([]);
  });
});

describe("search provider", () => {
  const provider = createOmniboxSearchProvider();

  it("searches the typed text", () => {
    expect(suggest(provider, "best headphones")).toEqual([
      expect.objectContaining({
        action: {
          type: "navigate",
          url: "https://www.google.com/search?q=best%20headphones",
        },
        kind: "search",
        score: 1,
        title: "best headphones",
      }),
    ]);
  });

  // Still offered — searching for a domain name is a real intent — but never
  // ahead of going there.
  it("demotes itself when the text is an address", () => {
    const [suggestion] = suggest(provider, "example.com");

    expect(suggestion?.score).toBeLessThan(1);
    expect(suggestion?.action).toEqual({
      type: "navigate",
      url: "https://www.google.com/search?q=example.com",
    });
  });
});

describe("open tabs provider", () => {
  const tabs = [
    tab("tab-active", "https://active.test/", "Active"),
    tab("tab-docs", "https://docs.example.com/guide", "Guide — Example Docs"),
    tab("tab-blank", "", null),
  ];
  const provider = createOmniboxOpenTabsProvider({
    activeTabId: "tab-active",
    tabs,
  });

  it("matches on title", () => {
    expect(suggest(provider, "guide")).toEqual([
      expect.objectContaining({
        action: { type: "activate-tab", tabId: "tab-docs" },
        kind: "tab",
        subtitle: "docs.example.com",
        title: "Guide — Example Docs",
      }),
    ]);
  });

  it("matches on host without the scheme the user never types", () => {
    expect(suggest(provider, "docs.example")).toHaveLength(1);
    expect(suggest(provider, "https://docs")).toEqual([]);
  });

  // Switching to the tab you are typing in is a no-op row, and a tab with no
  // page yet is nothing to switch to.
  it("skips the active tab and tabs with no page", () => {
    expect(suggest(provider, "active")).toEqual([]);
    expect(suggest(provider, "")).toEqual([]);
  });

  it("scores a prefix match above a substring match", () => {
    const prefix = suggest(provider, "guide")[0]?.score ?? 0;
    const substring = suggest(provider, "example docs")[0]?.score ?? 0;

    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });
});

describe("history provider", () => {
  const provider = createOmniboxHistoryProvider({
    entries: [
      visit("https://newer.test/page", "Newer"),
      visit("https://older.test/page", "Older"),
      visit("https://untitled.test/page", null),
    ],
  });

  it("offers a visited page as a navigation", () => {
    expect(suggest(provider, "newer")).toEqual([
      expect.objectContaining({
        action: { type: "navigate", url: "https://newer.test/page" },
        kind: "history",
        subtitle: "newer.test",
        title: "Newer",
      }),
    ]);
  });

  it("falls back to the URL when a visit has no title", () => {
    expect(suggest(provider, "untitled")[0]?.title).toBe(
      "https://untitled.test/page",
    );
  });

  // Recency is carried by input order, not by a score term: equal matches tie,
  // and the tie breaks towards the more recent visit.
  it("keeps equally matching visits in most-recent-first order", () => {
    const ranked = rankAcross([provider], "page");

    expect(ranked.map((row) => row.action)).toEqual([
      { type: "navigate", url: "https://newer.test/page" },
      { type: "navigate", url: "https://older.test/page" },
      { type: "navigate", url: "https://untitled.test/page" },
    ]);
  });
});

// The rule the whole ranking hangs on: whatever Enter would do with no row
// selected is the row shown first. Breaking it means the omnibox displays one
// thing and does another.
describe("built-in provider ordering", () => {
  const builtIns = [
    createOmniboxNavigationProvider(),
    createOmniboxSearchProvider(),
    createOmniboxOpenTabsProvider({
      activeTabId: null,
      tabs: [tab("tab-gh", "https://github.com/get-bb/bb", "get-bb/bb")],
    }),
    createOmniboxHistoryProvider({
      entries: [visit("https://github.com/get-bb/bb/issues", "Issues")],
    }),
  ];

  it("puts the address first for address-like input", () => {
    const ranked = rankAcross(builtIns, "github.com");

    expect(ranked[0]?.kind).toBe("navigate");
    expect(ranked[0]?.action).toEqual({
      type: "navigate",
      url: "https://github.com",
    });
  });

  it("puts the search first for a query, with the matches under it", () => {
    const ranked = rankAcross(builtIns, "github");

    expect(ranked.map((row) => row.kind)).toEqual(["search", "tab", "history"]);
  });

  // What the plan's vertical slice asks for: sources mixed in one list.
  it("mixes an open tab and a history entry under the default row", () => {
    const ranked = rankAcross(builtIns, "get-bb");

    expect(ranked.map((row) => row.providerId)).toEqual([
      "search",
      "open-tabs",
      "history",
    ]);
  });
});
