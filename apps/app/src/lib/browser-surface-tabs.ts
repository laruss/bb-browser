import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
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

export interface BrowserSurfaceTabsState {
  activeTabId: string | null;
  tabs: readonly BrowserFixedPanelTab[];
}

export const EMPTY_BROWSER_SURFACE_TABS_STATE: BrowserSurfaceTabsState = {
  activeTabId: null,
  tabs: [],
};

const browserSurfaceTabSchema = z
  .object({
    environmentId: z.string().min(1).nullable(),
    id: z.string().min(1),
    kind: z.literal("browser"),
    title: z.string().min(1).nullable(),
    url: z.string(),
  })
  .strict();

const browserSurfaceTabsStateSchema = z
  .object({
    activeTabId: z.string().min(1).nullable(),
    tabs: z.array(browserSurfaceTabSchema),
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
  tab: BrowserFixedPanelTab,
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

export function activateBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
  tabId: string,
): BrowserSurfaceTabsState {
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
    if (tab.id !== args.tabId) {
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

export function getActiveBrowserSurfaceTab(
  state: BrowserSurfaceTabsState,
): BrowserFixedPanelTab | null {
  if (state.activeTabId === null) {
    return null;
  }
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
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

const browserSurfaceTabsAtom = atomWithStorage<BrowserSurfaceTabsState>(
  getBrowserSurfaceTabsStorageKey(),
  EMPTY_BROWSER_SURFACE_TABS_STATE,
  browserSurfaceTabsStorage,
  { getOnInit: true },
);

export interface BrowserSurfaceTabsController {
  activeTab: BrowserFixedPanelTab | null;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  openTab: (url?: string) => BrowserFixedPanelTab;
  state: BrowserSurfaceTabsState;
  updateTab: (args: UpdateBrowserSurfaceTabArgs) => void;
}

export function useBrowserSurfaceTabs(): BrowserSurfaceTabsController {
  const [state, setState] = useAtom(browserSurfaceTabsAtom);

  const openTab = useCallback(
    (url: string = BROWSER_SURFACE_NEW_TAB_URL) => {
      // Built here rather than inside the reducer so the reducers stay pure and
      // directly testable; only this hook needs an id generator.
      const tab = createBrowserSurfaceTab(url);
      setState((current) => addBrowserSurfaceTab(current, tab));
      return tab;
    },
    [setState],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setState((current) => closeBrowserSurfaceTab(current, tabId));
    },
    [setState],
  );

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

  return {
    activeTab,
    activateTab,
    closeTab,
    openTab,
    state,
    updateTab,
  };
}
