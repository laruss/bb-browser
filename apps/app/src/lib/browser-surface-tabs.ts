import { useCallback, useMemo } from "react";
import { atom, useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createLocalStorageSyncStorage } from "./browser-storage";
import {
  createBrowserFixedPanelTab,
  type BrowserFixedPanelTab,
} from "./fixed-panel-tabs-state";

// Tab state for the top-level browser surface. The thread secondary panel keeps
// its browser tabs beside file previews and prunes them per thread; these tabs
// belong to no thread at all, because here the browser is the product rather
// than a panel inside a thread view.

const BROWSER_SURFACE_TABS_STORAGE_PREFIX = "bb.browserSurface.tabs";
const BROWSER_SURFACE_TABS_STORAGE_VERSION = "1";

/**
 * Opaque scope key passed to the browser components' `threadId` prop. That prop
 * keys the navigation-history atom family and the native-view identity record,
 * and neither parses the value — so the surface carries its own scope instead of
 * borrowing a thread's. Renaming the prop to `scopeId` across the thread code
 * paths is deliberate follow-up work, not part of this surface.
 */
export const BROWSER_SURFACE_SCOPE_ID = "browser-surface";

/**
 * An empty URL means "no page yet": the native view stays hidden and the tab
 * shows the new-tab screen. Same convention as the desktop browser IPC contract.
 */
export const BROWSER_SURFACE_NEW_TAB_URL = "";

/**
 * A bb screen carried in the strip beside web pages — Settings, Extensions, a
 * plugin's panel.
 *
 * The record is a **remembered route**, not a live view: the strip holds many
 * tabs while the window holds one URL, so an inactive app tab is a path waiting
 * to be visited and the active one is whatever the window's own router is
 * already rendering. That is what keeps a single navigation system here; see
 * `app-surface-tabs.ts` for the route ↔ strip rules built on it.
 */
export interface AppSurfaceTab {
  id: string;
  kind: "app";
  /** Window path, search string included. */
  path: string;
  /** The screen's document title; null until it reports one. */
  title: string | null;
}

/** Either kind of tab in the surface's one ordered strip. */
export type BrowserSurfaceTab = BrowserFixedPanelTab | AppSurfaceTab;

export function isAppSurfaceTab(tab: BrowserSurfaceTab): tab is AppSurfaceTab {
  return tab.kind === "app";
}

/** A tab showing a web page — the kind that owns a native `WebContentsView`. */
export function isWebSurfaceTab(
  tab: BrowserSurfaceTab,
): tab is BrowserFixedPanelTab {
  return tab.kind === "browser";
}

export interface BrowserSurfaceTabsState {
  activeTabId: string | null;
  tabs: readonly BrowserSurfaceTab[];
}

export const EMPTY_BROWSER_SURFACE_TABS_STATE: BrowserSurfaceTabsState = {
  activeTabId: null,
  tabs: [],
};

const webSurfaceTabSchema = z
  .object({
    environmentId: z.string().min(1).nullable(),
    id: z.string().min(1),
    kind: z.literal("browser"),
    title: z.string().min(1).nullable(),
    url: z.string(),
  })
  .strict();

const appSurfaceTabSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("app"),
    path: z.string().min(1),
    title: z.string().min(1).nullable(),
  })
  .strict();

/**
 * The storage version stays at 1 across the arrival of app tabs: every state an
 * older build wrote is a list of web tabs, which still parses. Only the reverse
 * — an older build reading a strip that now holds an app tab — fails, and it
 * fails into {@link EMPTY_BROWSER_SURFACE_TABS_STATE} and reopens a new tab
 * rather than into anything the user has to repair.
 */
const surfaceTabSchema = z.discriminatedUnion("kind", [
  webSurfaceTabSchema,
  appSurfaceTabSchema,
]);

const browserSurfaceTabsStateSchema = z
  .object({
    activeTabId: z.string().min(1).nullable(),
    tabs: z.array(surfaceTabSchema),
  })
  .strict();

/**
 * Drops an `activeTabId` that no longer names an open tab, so a hand-edited or
 * partially written store cannot leave the surface pointing at nothing while
 * tabs exist.
 */
function reconcileActiveTabId(
  state: BrowserSurfaceTabsState,
): BrowserSurfaceTabsState {
  if (state.activeTabId === null) {
    return state;
  }
  if (state.tabs.some((tab) => tab.id === state.activeTabId)) {
    return state;
  }
  return { ...state, activeTabId: state.tabs.at(-1)?.id ?? null };
}

export function addBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
  tab: BrowserSurfaceTab,
): BrowserSurfaceTabsState {
  if (state.tabs.some((existing) => existing.id === tab.id)) {
    return activateBrowserSurfaceTab(state, tab.id);
  }
  return { activeTabId: tab.id, tabs: [...state.tabs, tab] };
}

/**
 * Closes a tab and hands focus to its right-hand neighbour, falling back to the
 * left one — what every tab strip does, and what keeps the surface from
 * flashing an unrelated page when a middle tab closes.
 */
export function closeBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
  tabId: string,
): BrowserSurfaceTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return state;
  }
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (state.activeTabId !== tabId) {
    return { ...state, tabs };
  }
  const successor = tabs[index] ?? tabs[index - 1] ?? null;
  return { activeTabId: successor?.id ?? null, tabs };
}

export interface ClosedBrowserSurfaceTab {
  /** Where it was in the strip, so reopening puts it back rather than at the end. */
  index: number;
  tab: BrowserSurfaceTab;
}

/** How many closed tabs can be reopened, matching the shell's session store. */
export const MAX_CLOSED_BROWSER_SURFACE_TABS = 10;

/**
 * Push a just-closed tab onto the reopen stack, newest first.
 *
 * Deliberately **not** persisted, unlike the open tabs. What makes a reopened
 * tab land where it left off is the navigation history the shell captured as
 * the view was destroyed, and that dies with the app — so a stack that survived
 * a restart would promise a restore it could no longer perform.
 */
export function pushClosedBrowserSurfaceTab(
  stack: readonly ClosedBrowserSurfaceTab[],
  closed: ClosedBrowserSurfaceTab,
): readonly ClosedBrowserSurfaceTab[] {
  return [closed, ...stack].slice(0, MAX_CLOSED_BROWSER_SURFACE_TABS);
}

/**
 * Put a closed tab back where it was and focus it.
 *
 * The tab keeps its **id**, which is what lets the shell recognise it and
 * restore the page's history and scroll: the id is the key its session was
 * stored under.
 */
export function reopenBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
  closed: ClosedBrowserSurfaceTab,
): BrowserSurfaceTabsState {
  if (state.tabs.some((tab) => tab.id === closed.tab.id)) {
    return activateBrowserSurfaceTab(state, closed.tab.id);
  }
  const index = Math.min(Math.max(closed.index, 0), state.tabs.length);
  const tabs = [
    ...state.tabs.slice(0, index),
    closed.tab,
    ...state.tabs.slice(index),
  ];
  return { activeTabId: closed.tab.id, tabs };
}

export function activateBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
  tabId: string,
): BrowserSurfaceTabsState {
  // Same state object back when nothing moves: the route sync re-runs this on
  // every navigation, and a fresh object each time would republish the strip to
  // every subscriber for a tab switch that did not happen.
  if (state.activeTabId === tabId) {
    return state;
  }
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    return state;
  }
  return { ...state, activeTabId: tabId };
}

export interface UpdateBrowserSurfaceTabArgs {
  tabId: string;
  title?: string | null;
  url?: string;
}

export function updateBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
  args: UpdateBrowserSurfaceTabArgs,
): BrowserSurfaceTabsState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    // Page title and URL come from a native view, so an app tab under the same
    // id is not a stale record to refresh — it is the wrong tab.
    if (tab.id !== args.tabId || !isWebSurfaceTab(tab)) {
      return tab;
    }
    const title = args.title === undefined ? tab.title : args.title;
    const url = args.url === undefined ? tab.url : args.url;
    if (title === tab.title && url === tab.url) {
      return tab;
    }
    changed = true;
    return { ...tab, title, url };
  });
  return changed ? { ...state, tabs } : state;
}

/** Moves an app tab to another screen, and records the title that screen reports. */
export interface UpdateAppSurfaceTabArgs {
  path?: string;
  tabId: string;
  title?: string | null;
}

export function updateAppSurfaceTab(
  state: BrowserSurfaceTabsState,
  args: UpdateAppSurfaceTabArgs,
): BrowserSurfaceTabsState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== args.tabId || !isAppSurfaceTab(tab)) {
      return tab;
    }
    const path = args.path ?? tab.path;
    const title = args.title === undefined ? tab.title : args.title;
    if (path === tab.path && title === tab.title) {
      return tab;
    }
    changed = true;
    return { ...tab, path, title };
  });
  return changed ? { ...state, tabs } : state;
}

export function getActiveBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
): BrowserSurfaceTab | null {
  if (state.activeTabId === null) {
    return null;
  }
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

/** The web tabs alone — what the deck mounts and what an agent's tools address. */
export function getBrowserSurfaceWebTabs(
  state: BrowserSurfaceTabsState,
): readonly BrowserFixedPanelTab[] {
  return state.tabs.filter(isWebSurfaceTab);
}

/**
 * The active tab when it is a web page, and null when an app screen holds the
 * strip. Null here reads as "no page to act on", which is what every caller that
 * drives a native view (find, reload, DevTools, the agent's tools) needs.
 */
export function getActiveBrowserSurfaceWebTab(
  state: BrowserSurfaceTabsState,
): BrowserFixedPanelTab | null {
  const active = getActiveBrowserSurfaceTab(state);
  return active !== null && isWebSurfaceTab(active) ? active : null;
}

export function createAppSurfaceTab({
  path,
  title = null,
}: {
  path: string;
  title?: string | null;
}): AppSurfaceTab {
  return { id: `app:${nanoid()}`, kind: "app", path, title };
}

export function createBrowserSurfaceTab(url: string): BrowserFixedPanelTab {
  // environmentId stays null: a surface tab is not scoped to a workspace, and
  // the id builder keys the native view off it.
  return createBrowserFixedPanelTab({ environmentId: null, url });
}

export function getBrowserSurfaceTabsStorageKey(): string {
  return `${BROWSER_SURFACE_TABS_STORAGE_PREFIX}-${BROWSER_SURFACE_TABS_STORAGE_VERSION}`;
}

/**
 * Restores persisted tab state, falling back to `initialValue` for anything
 * unreadable — a partially written or hand-edited store must not strand the
 * surface with no tabs and no way back.
 */
export function parseBrowserSurfaceTabsState(
  storedValue: string | null,
  initialValue: BrowserSurfaceTabsState,
): BrowserSurfaceTabsState {
  if (storedValue === null) {
    return initialValue;
  }
  try {
    const parsed = browserSurfaceTabsStateSchema.safeParse(
      JSON.parse(storedValue),
    );
    return parsed.success ? reconcileActiveTabId(parsed.data) : initialValue;
  } catch {
    return initialValue;
  }
}

const browserSurfaceTabsStorage =
  createLocalStorageSyncStorage<BrowserSurfaceTabsState>({
    parse: parseBrowserSurfaceTabsState,
    serialize: (value) => JSON.stringify(value),
  });

/**
 * Exported so the agent browser bridge can read and write tabs through the
 * jotai store from outside React's render cycle — it has to see its own writes
 * within one turn, which a render snapshot cannot promise. UI code should keep
 * using {@link useBrowserSurfaceTabs}.
 */
export const browserSurfaceTabsAtom = atomWithStorage<BrowserSurfaceTabsState>(
  getBrowserSurfaceTabsStorageKey(),
  EMPTY_BROWSER_SURFACE_TABS_STATE,
  browserSurfaceTabsStorage,
  { getOnInit: true },
);

/** Session-scoped; see {@link pushClosedBrowserSurfaceTab} for why. */
const closedBrowserSurfaceTabsAtom = atom<readonly ClosedBrowserSurfaceTab[]>(
  [],
);

export interface BrowserSurfaceTabsController {
  activeTab: BrowserSurfaceTab | null;
  /** {@link getActiveBrowserSurfaceWebTab} — null while an app screen is active. */
  activeWebTab: BrowserFixedPanelTab | null;
  /** {@link getBrowserSurfaceWebTabs}, memoised for the deck and the omnibox. */
  webTabs: readonly BrowserFixedPanelTab[];
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  /**
   * `activate: false` opens it in the background, leaving the strip pointing
   * where it was — what the surface needs when it is only making sure a page
   * exists to come back to, and what an agent's `browser_tabs_open` asks for.
   */
  openTab: (
    url?: string,
    options?: { activate?: boolean },
  ) => BrowserFixedPanelTab;
  /**
   * Adopt a tab the desktop shell already created — a popup, whose page exists
   * before this surface has heard of it, so the id is the shell's and this side
   * takes it rather than inventing one.
   */
  adoptTab: (args: { tabId: string; url: string }) => void;
  /** Reopen the most recently closed tab, where it left off. */
  reopenClosedTab: () => void;
  state: BrowserSurfaceTabsState;
  updateTab: (args: UpdateBrowserSurfaceTabArgs) => void;
}

/**
 * Open a page in the browser, from anywhere in the app.
 *
 * There is one browser and it is this surface. A thread that wants to show a
 * page hands it here rather than hosting a browser of its own beside the
 * conversation — which is what the thread's secondary panel used to do, and what
 * left the app with two browsers, one of them a panel inside the other.
 *
 * No navigation: on an agent route the surface already owns the main area, so
 * the page appears beside the thread the user is reading rather than instead of
 * it. On the web build there is no surface and no native view, so callers gate
 * on {@link isDesktopBrowserAvailable} and send links to the system browser as
 * they always have.
 */
export function useOpenBrowserSurfaceTab(): (url: string) => void {
  const setState = useSetAtom(browserSurfaceTabsAtom);
  return useCallback(
    (url: string) => {
      setState((current) =>
        addBrowserSurfaceTab(current, createBrowserSurfaceTab(url)),
      );
    },
    [setState],
  );
}

export function useBrowserSurfaceTabs(): BrowserSurfaceTabsController {
  const [state, setState] = useAtom(browserSurfaceTabsAtom);

  const openTab = useCallback(
    (
      url: string = BROWSER_SURFACE_NEW_TAB_URL,
      { activate = true }: { activate?: boolean } = {},
    ) => {
      // Built here rather than inside the reducer so the reducers stay pure and
      // directly testable; only this hook needs an id generator.
      const tab = createBrowserSurfaceTab(url);
      setState((current) => {
        const opened = addBrowserSurfaceTab(current, tab);
        // `addBrowserSurfaceTab` always focuses; put focus back for a background
        // tab, falling through to the new one when there was nothing to keep.
        return activate
          ? opened
          : { ...opened, activeTabId: current.activeTabId ?? tab.id };
      });
      return tab;
    },
    [setState],
  );

  const adoptTab = useCallback(
    ({ tabId, url }: { tabId: string; url: string }) => {
      setState((current) =>
        addBrowserSurfaceTab(current, {
          environmentId: null,
          id: tabId,
          kind: "browser",
          title: null,
          url,
        }),
      );
    },
    [setState],
  );

  const setClosedTabs = useSetAtom(closedBrowserSurfaceTabsAtom);

  const closeTab = useCallback(
    (tabId: string) => {
      setState((current) => {
        const index = current.tabs.findIndex((tab) => tab.id === tabId);
        const tab = current.tabs[index];
        if (tab !== undefined) {
          setClosedTabs((stack) =>
            pushClosedBrowserSurfaceTab(stack, { index, tab }),
          );
        }
        return closeBrowserSurfaceTab(current, tabId);
      });
    },
    [setClosedTabs, setState],
  );

  const reopenClosedTab = useCallback(() => {
    setClosedTabs((stack) => {
      const closed = stack[0];
      if (closed === undefined) {
        return stack;
      }
      setState((current) => reopenBrowserSurfaceTab(current, closed));
      return stack.slice(1);
    });
  }, [setClosedTabs, setState]);

  const activateTab = useCallback(
    (tabId: string) => {
      setState((current) => activateBrowserSurfaceTab(current, tabId));
    },
    [setState],
  );

  const updateTab = useCallback(
    (args: UpdateBrowserSurfaceTabArgs) => {
      setState((current) => updateBrowserSurfaceTab(current, args));
    },
    [setState],
  );

  const activeTab = useMemo(() => getActiveBrowserSurfaceTab(state), [state]);
  const activeWebTab = useMemo(
    () => (activeTab !== null && isWebSurfaceTab(activeTab) ? activeTab : null),
    [activeTab],
  );
  const webTabs = useMemo(() => getBrowserSurfaceWebTabs(state), [state]);

  return {
    activeTab,
    activeWebTab,
    activateTab,
    adoptTab,
    closeTab,
    openTab,
    reopenClosedTab,
    state,
    updateTab,
    webTabs,
  };
}
