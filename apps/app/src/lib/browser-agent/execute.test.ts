import { describe, expect, it, vi } from "vitest";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserInteractResult,
  BbDesktopBrowserPageReadResult,
  BbDesktopBrowserSnapshotResult,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import type { BrowserCommandOutcome } from "@bb/domain";
import { createBrowserFixedPanelTab } from "../fixed-panel-tabs-state";
import {
  EMPTY_BROWSER_SURFACE_TABS_STATE,
  type BrowserSurfaceTabsState,
} from "../browser-surface-tabs";
import { executeBrowserCommand, type BrowserCommandDeps } from "./execute";

/**
 * The executor is the whole of the agent-facing browser behaviour, so these
 * cases are mostly about what an agent is told when it cannot have what it
 * asked for — a wrong answer here reads to the model as a broken browser.
 */

function tab(id: string, url = "", title: string | null = null) {
  return { ...createBrowserFixedPanelTab({ environmentId: null, url }), id, title };
}

function liveState(
  tabId: string,
  overrides: Partial<BbDesktopBrowserState> = {},
): BbDesktopBrowserState {
  return {
    tabId,
    url: "https://example.com/",
    title: "Example",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

interface HarnessArgs {
  state?: BrowserSurfaceTabsState;
  live?: Record<string, BbDesktopBrowserState>;
  readPage?: BbDesktopBrowserPageReadResult;
  omitReadPage?: boolean;
  snapshot?: BbDesktopBrowserSnapshotResult;
  omitSnapshot?: boolean;
  interact?: BbDesktopBrowserInteractResult;
  omitInteract?: boolean;
  noDesktop?: boolean;
}

function createHarness(args: HarnessArgs = {}) {
  let state = args.state ?? EMPTY_BROWSER_SURFACE_TABS_STATE;
  const live = new Map(Object.entries(args.live ?? {}));
  const calls = {
    navigate: [] as Array<{ tabId: string; url: string }>,
    goBack: [] as string[],
    goForward: [] as string[],
    reload: [] as string[],
    destroyed: [] as string[],
    settled: [] as string[],
    interactions: [] as unknown[],
  };
  let nextTabId = 0;

  const desktopBrowser = {
    attach: vi.fn(),
    detach: vi.fn(),
    navigate: (request: { tabId: string; url: string }) => {
      calls.navigate.push(request);
    },
    goBack: (tabId: string) => {
      calls.goBack.push(tabId);
    },
    goForward: (tabId: string) => {
      calls.goForward.push(tabId);
    },
    reload: (tabId: string) => {
      calls.reload.push(tabId);
    },
    stop: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    onState: () => () => undefined,
    onOpenTab: () => () => undefined,
    ...(args.omitSnapshot === true
      ? {}
      : {
          snapshot: () =>
            Promise.resolve(
              args.snapshot ?? {
                ok: false as const,
                reason: "failed" as const,
              },
            ),
        }),
    ...(args.omitInteract === true
      ? {}
      : {
          interact: (request: unknown) => {
            calls.interactions.push(request);
            return Promise.resolve(
              args.interact ?? {
                ok: true as const,
                tabId: "t",
                url: "https://example.com/next",
                title: "Next",
              },
            );
          },
        }),
    ...(args.omitReadPage === true
      ? {}
      : {
          readPage: () =>
            Promise.resolve(
              args.readPage ?? {
                ok: true as const,
                tabId: "t",
                url: "https://example.com/",
                title: "Example",
                isLoading: false,
                text: "page text",
                textTruncated: false,
                selection: "selected",
                selectionTruncated: false,
              },
            ),
        }),
  } as unknown as BbDesktopBrowserApi;

  const deps: BrowserCommandDeps = {
    getState: () => state,
    applyState: (update) => {
      state = update(state);
    },
    desktopBrowser: args.noDesktop === true ? null : desktopBrowser,
    getLiveState: (tabId) => live.get(tabId) ?? null,
    waitForSettled: (tabId) => {
      calls.settled.push(tabId);
      return Promise.resolve({ timedOut: false });
    },
    createTab: (url) => {
      nextTabId += 1;
      return tab(`new-${nextTabId}`, url);
    },
    destroyView: ({ tabId }) => {
      calls.destroyed.push(tabId);
    },
  };

  return {
    calls,
    deps,
    live,
    get state() {
      return state;
    },
  };
}

function expectFailure(outcome: BrowserCommandOutcome, code: string): void {
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe(code);
  }
}

describe("executeBrowserCommand — tabs", () => {
  it("lists tabs with liveness, activity and navigation flags", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("b", "https://b.test/")] },
      live: { a: liveState("a", { canGoBack: true, title: "Live title" }) },
    });

    const outcome = await executeBrowserCommand({ type: "tabs.list" }, harness.deps);

    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "tabs",
        tabs: [
          {
            tabId: "a",
            url: "https://example.com/",
            title: "Live title",
            active: true,
            live: true,
            loading: false,
            canGoBack: true,
            canGoForward: false,
          },
          {
            // No live view: the persisted tab is all there is, and the history
            // flags are false because they are unknown, not because they are no.
            tabId: "b",
            url: "https://b.test/",
            title: null,
            active: false,
            live: false,
            loading: false,
            canGoBack: false,
            canGoForward: false,
          },
        ],
      },
    });
  });

  it("opens a tab, honouring a request to leave focus alone", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    await executeBrowserCommand(
      { type: "tabs.open", url: "https://example.com", activate: false },
      harness.deps,
    );

    expect(harness.state.activeTabId).toBe("a");
    expect(harness.state.tabs.map((each) => each.url)).toEqual([
      "",
      "https://example.com",
    ]);

    await executeBrowserCommand(
      { type: "tabs.open", url: null, activate: true },
      harness.deps,
    );
    expect(harness.state.activeTabId).toBe("new-2");
  });

  it("refuses to open anything that is not an http(s) address", async () => {
    const harness = createHarness();

    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      expectFailure(
        await executeBrowserCommand(
          { type: "tabs.open", url, activate: true },
          harness.deps,
        ),
        "blocked_url",
      );
    }
    expect(harness.state.tabs).toHaveLength(0);
  });

  it("tears down the native view when it closes a tab", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("b")] },
    });

    const outcome = await executeBrowserCommand(
      { type: "tabs.close", tabId: "a" },
      harness.deps,
    );

    // Without this the WebContentsView leaks: the deck only reaps vanished tabs
    // while it is mounted, and an agent can close a tab from any route.
    expect(harness.calls.destroyed).toEqual(["a"]);
    expect(harness.state.tabs.map((each) => each.id)).toEqual(["b"]);
    expect(harness.state.activeTabId).toBe("b");
    expect(outcome.ok && outcome.value.type === "closed").toBe(true);
  });

  it("reports an unknown tab id rather than doing nothing", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    expectFailure(
      await executeBrowserCommand(
        { type: "tabs.close", tabId: "nope" },
        harness.deps,
      ),
      "unknown_tab",
    );
    expectFailure(
      await executeBrowserCommand(
        { type: "tabs.activate", tabId: "nope" },
        harness.deps,
      ),
      "unknown_tab",
    );
  });

  it("says so when there is no active tab to default to", async () => {
    const harness = createHarness();

    expectFailure(
      await executeBrowserCommand(
        { type: "page.get_url", tabId: null },
        harness.deps,
      ),
      "no_active_tab",
    );
  });
});

describe("executeBrowserCommand — page reads", () => {
  it("reads text and selection from the tab's live page", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 1000 },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "page text", truncated: false },
    });
    await expect(
      executeBrowserCommand(
        { type: "page.get_selection", tabId: null },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "selected", truncated: false },
    });
  });

  it("clamps to the caller's maxLength and reports the cut", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 4 },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "page", truncated: true },
    });
  });

  it("translates each shell refusal into an actionable code", async () => {
    const cases: Array<[BbDesktopBrowserPageReadResult, string]> = [
      [{ ok: false, reason: "no-view" }, "tab_not_live"],
      [{ ok: false, reason: "no-page" }, "tab_not_live"],
      [{ ok: false, reason: "timeout" }, "page_read_timeout"],
      [{ ok: false, reason: "unreadable" }, "page_read_failed"],
    ];

    for (const [readPage, code] of cases) {
      const harness = createHarness({
        state: { activeTabId: "a", tabs: [tab("a")] },
        readPage,
      });
      expectFailure(
        await executeBrowserCommand(
          { type: "page.get_text", tabId: null, maxLength: 100 },
          harness.deps,
        ),
        code,
      );
    }
  });

  it("reports an older desktop shell that has no read-page channel", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      omitReadPage: true,
    });

    // Feature detection is the version negotiation for the whole channel.
    expectFailure(
      await executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 100 },
        harness.deps,
      ),
      "unsupported_command",
    );
  });

  it("answers url and title from tab state, with no page involved", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [tab("a", "https://stored.test/", "Stored")],
      },
      noDesktop: true,
    });

    // These work on the web build and for tabs that were never opened, which is
    // why they are not gated behind the desktop shell.
    await expect(
      executeBrowserCommand({ type: "page.get_url", tabId: null }, harness.deps),
    ).resolves.toEqual({
      ok: true,
      value: { type: "url", url: "https://stored.test/" },
    });
    await expect(
      executeBrowserCommand(
        { type: "page.get_title", tabId: null },
        harness.deps,
      ),
    ).resolves.toEqual({ ok: true, value: { type: "title", title: "Stored" } });
  });
});

describe("executeBrowserCommand — navigation", () => {
  it("navigates a live tab and waits for the load to settle", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: null,
        url: "https://example.com/next",
        newTab: false,
      },
      harness.deps,
    );

    expect(harness.calls.navigate).toEqual([
      { tabId: "a", url: "https://example.com/next" },
    ]);
    // Without the wait, an agent that navigates then reads gets the old page.
    expect(harness.calls.settled).toEqual(["a"]);
    expect(outcome.ok).toBe(true);
  });

  it("stores the URL for a tab with no live view instead of failing", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: null,
        url: "https://example.com/later",
        newTab: false,
      },
      harness.deps,
    );

    // Nothing to drive yet, but the tab loads this when it is next opened.
    expect(harness.calls.navigate).toEqual([]);
    expect(harness.calls.settled).toEqual([]);
    expect(harness.state.tabs[0]?.url).toBe("https://example.com/later");
    expect(outcome.ok).toBe(true);
  });

  it("opens in a new tab when asked", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: null,
        url: "https://example.com/new",
        newTab: true,
      },
      harness.deps,
    );

    expect(harness.state.tabs).toHaveLength(2);
    expect(harness.state.tabs[1]?.url).toBe("https://example.com/new");
  });

  it("refuses a URL the browser would not open", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    expectFailure(
      await executeBrowserCommand(
        {
          type: "navigation.open",
          tabId: null,
          url: "javascript:alert(1)",
          newTab: false,
        },
        harness.deps,
      ),
      "blocked_url",
    );
    expect(harness.calls.navigate).toEqual([]);
  });

  it("replays history only where there is history to replay", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("dead")] },
      live: { a: liveState("a", { canGoBack: true, canGoForward: false }) },
    });

    expect(
      (
        await executeBrowserCommand(
          { type: "navigation.back", tabId: null },
          harness.deps,
        )
      ).ok,
    ).toBe(true);
    expect(harness.calls.goBack).toEqual(["a"]);

    // canGoForward is false, so there is nothing forward of here.
    expectFailure(
      await executeBrowserCommand(
        { type: "navigation.forward", tabId: null },
        harness.deps,
      ),
      "tab_not_live",
    );

    // And a tab with no live view has no history at all.
    expectFailure(
      await executeBrowserCommand(
        { type: "navigation.reload", tabId: "dead" },
        harness.deps,
      ),
      "tab_not_live",
    );
    expect(harness.calls.reload).toEqual([]);
  });

  it("reloads a live tab and waits for it", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    expect(
      (
        await executeBrowserCommand(
          { type: "navigation.reload", tabId: null },
          harness.deps,
        )
      ).ok,
    ).toBe(true);
    expect(harness.calls.reload).toEqual(["a"]);
    expect(harness.calls.settled).toEqual(["a"]);
  });
});

describe("executeBrowserCommand — guards", () => {
  it("rejects a command it does not recognize", async () => {
    const harness = createHarness();

    expectFailure(
      await executeBrowserCommand({ type: "page.eval" }, harness.deps),
      "invalid_command",
    );
    expectFailure(
      await executeBrowserCommand(
        { type: "tabs.close" },
        harness.deps,
      ),
      "invalid_command",
    );
    expectFailure(await executeBrowserCommand(null, harness.deps), "invalid_command");
  });

  it("explains that anything touching a page needs the desktop app", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      noDesktop: true,
    });

    for (const command of [
      { type: "tabs.open", url: null, activate: true },
      { type: "page.get_text", tabId: null, maxLength: 10 },
      { type: "navigation.reload", tabId: null },
    ]) {
      expectFailure(
        await executeBrowserCommand(command, harness.deps),
        "desktop_unavailable",
      );
    }

    // Listing still works: tabs are renderer state, not an Electron thing.
    expect((await executeBrowserCommand({ type: "tabs.list" }, harness.deps)).ok).toBe(
      true,
    );
  });

  it("sees its own writes within one turn", async () => {
    const harness = createHarness();

    await executeBrowserCommand(
      { type: "tabs.open", url: "https://first.test", activate: true },
      harness.deps,
    );
    const outcome = await executeBrowserCommand(
      { type: "page.get_url", tabId: null },
      harness.deps,
    );

    // Reading state through a getter rather than a render snapshot is what makes
    // an open-then-read sequence in one turn work.
    expect(outcome).toEqual({
      ok: true,
      value: { type: "url", url: "https://first.test" },
    });
  });
});

describe("executeBrowserCommand — snapshot", () => {
  it("returns the tree, its refs and the generation they belong to", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      snapshot: {
        ok: true,
        tabId: "a",
        url: "https://example.com/",
        title: "Example",
        snapshot: '- button "Save" [ref=e1]',
        generation: 3,
        refCount: 1,
        truncated: false,
      },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.snapshot", tabId: null, maxDepth: null },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        type: "snapshot",
        tabId: "a",
        url: "https://example.com/",
        title: "Example",
        snapshot: '- button "Save" [ref=e1]',
        // Carried through so interaction commands can be refused when the page
        // has navigated since the refs were handed out.
        generation: 3,
        refCount: 1,
        truncated: false,
      },
    });
  });

  it("names DevTools as the reason the debugger could not attach", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      snapshot: {
        ok: false,
        reason: "debugger-unavailable",
        message: "Another debugger is already attached",
      },
    });

    const outcome = await executeBrowserCommand(
      { type: "page.snapshot", tabId: null, maxDepth: null },
      harness.deps,
    );

    expectFailure(outcome, "debugger_unavailable");
    if (!outcome.ok) {
      expect(outcome.message).toContain("Close DevTools");
    }
  });

  it("maps a cold tab and an outright failure to their own codes", async () => {
    for (const [snapshot, code] of [
      [{ ok: false as const, reason: "no-view" as const }, "tab_not_live"],
      [{ ok: false as const, reason: "no-page" as const }, "tab_not_live"],
      [{ ok: false as const, reason: "failed" as const }, "page_read_failed"],
    ] as const) {
      const harness = createHarness({
        state: { activeTabId: "a", tabs: [tab("a")] },
        snapshot,
      });
      expectFailure(
        await executeBrowserCommand(
          { type: "page.snapshot", tabId: null, maxDepth: null },
          harness.deps,
        ),
        code,
      );
    }
  });

  it("reports a desktop build with no snapshot channel", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      omitSnapshot: true,
    });

    expectFailure(
      await executeBrowserCommand(
        { type: "page.snapshot", tabId: null, maxDepth: null },
        harness.deps,
      ),
      "unsupported_command",
    );
  });
});

describe("executeBrowserCommand — interaction", () => {
  const CLICK = {
    action: "click" as const,
    ref: "e1",
    button: "left" as const,
    clickCount: 1 as const,
    modifiers: [],
  };

  it("forwards the action and reports where the tab ended up", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: 3,
        interaction: CLICK,
      },
      harness.deps,
    );

    expect(harness.calls.interactions).toEqual([
      { tabId: "t", generation: 3, interaction: CLICK },
    ]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "interacted",
        tabId: "t",
        url: "https://example.com/next",
        title: "Next",
      },
    });
  });

  it("omits the generation entirely when the caller passed none", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: CLICK,
      },
      harness.deps,
    );

    // A `generation: undefined` field would be a `.strict()` parse failure on
    // the shell side, so the key has to be absent rather than empty.
    expect(harness.calls.interactions).toEqual([
      { tabId: "t", interaction: CLICK },
    ]);
  });

  it("waits for a navigation the action started", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t", { isLoading: true }) },
    });

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: CLICK,
      },
      harness.deps,
    );

    // Otherwise the agent's next snapshot reads the page it just left.
    expect(harness.calls.settled).toEqual(["t"]);
  });

  it("does not wait when nothing navigated", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: CLICK,
      },
      harness.deps,
    );

    // Waiting unconditionally would cost the settle timeout on every click that
    // only opened a menu.
    expect(harness.calls.settled).toEqual([]);
  });

  it("gives each shell refusal its own code", async () => {
    for (const [reason, code] of [
      ["stale-refs", "stale_refs"],
      ["unknown-ref", "unknown_ref"],
      ["not-actionable", "not_actionable"],
      ["unsupported-key", "unsupported_key"],
      ["debugger-unavailable", "debugger_unavailable"],
      ["no-view", "tab_not_live"],
    ] as const) {
      const harness = createHarness({
        state: { tabs: [tab("t")], activeTabId: "t" },
        live: { t: liveState("t") },
        interact: { ok: false, reason, message: "because" },
      });

      expectFailure(
        await executeBrowserCommand(
          {
            type: "page.interact",
            tabId: null,
            generation: null,
            interaction: CLICK,
          },
          harness.deps,
        ),
        code,
      );
    }
  });

  it("reports a desktop build with no interact channel", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      omitInteract: true,
    });

    expectFailure(
      await executeBrowserCommand(
        {
          type: "page.interact",
          tabId: null,
          generation: null,
          interaction: CLICK,
        },
        harness.deps,
      ),
      "unsupported_command",
    );
  });

  it("rejects an action that is not one of the known shapes", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    // The command came from a model, so a malformed one must not reach the page.
    expectFailure(
      await executeBrowserCommand(
        {
          type: "page.interact",
          tabId: null,
          generation: null,
          interaction: { action: "click", ref: "not-a-ref" },
        },
        harness.deps,
      ),
      "invalid_command",
    );
    expect(harness.calls.interactions).toEqual([]);
  });
});
