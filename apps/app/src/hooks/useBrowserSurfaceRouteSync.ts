import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import {
  reconcileBrowserSurfaceTabsWithRoute,
  resolveSurfaceTabRoute,
  type SurfaceRouteTarget,
} from "@/lib/app-surface-tabs";
import {
  browserSurfaceTabsAtom,
  getActiveBrowserSurfaceTab,
  isAppSurfaceTab,
  updateAppSurfaceTab,
  type BrowserSurfaceTabsState,
} from "@/lib/browser-surface-tabs";

type TabsStore = ReturnType<typeof useStore>;

/**
 * Writes only when the reducer actually moved something. The strip is persisted
 * to localStorage on every write, and the title effect below re-runs whenever a
 * screen's title resolves — most of those runs change nothing.
 */
function applyTabsUpdate(
  store: TabsStore,
  update: (current: BrowserSurfaceTabsState) => BrowserSurfaceTabsState,
): void {
  const current = store.get(browserSurfaceTabsAtom);
  const next = update(current);
  if (next !== current) {
    store.set(browserSurfaceTabsAtom, next);
  }
}

export interface BrowserSurfaceRouteSyncArgs {
  /** False on the web build, which has no surface to keep in step. */
  enabled: boolean;
  /**
   * The destination the window is showing, or null on the routes that leave the
   * main area to the browser — see {@link classifySurfaceRoute}.
   */
  target: SurfaceRouteTarget | null;
}

/**
 * Keeps the tab strip and the window URL describing the same thing.
 *
 * Both can move, and **whichever one just moved is the one that wins**. The user
 * navigating (a sidebar link, a deep link, Back) moves the strip onto that
 * destination; something activating a tab from outside the router — an agent's
 * `browser_tabs_open`, a page's popup — moves the window onto the browser. A
 * fixed winner would break the other direction: route-always-wins would snap an
 * agent's new tab back out of view, and strip-always-wins would refuse to open
 * Settings at all.
 *
 * Reads go through the store rather than the render snapshot, because these
 * effects run in the same commit and the second has to see what the first wrote.
 */
export function useBrowserSurfaceRouteSync({
  enabled,
  target,
}: BrowserSurfaceRouteSyncArgs): void {
  const store = useStore();
  const navigate = useNavigate();
  const activeTabId = useAtomValue(browserSurfaceTabsAtom).activeTabId;
  const path = target?.path ?? null;
  const title = target?.title ?? null;
  // `undefined` until the first run, which is what makes a restored session go
  // through the same reconcile a navigation does instead of a boot-only path.
  const lastPathRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled || lastPathRef.current === path) {
      return;
    }
    lastPathRef.current = path;
    applyTabsUpdate(store, (current) =>
      reconcileBrowserSurfaceTabsWithRoute(
        current,
        path === null ? null : { path, title },
      ),
    );
  }, [enabled, path, store, title]);

  // Titles arrive after the route does — a thread's, a plugin panel's — so the
  // tab is named on a second pass rather than left holding the path.
  useEffect(() => {
    if (!enabled || path === null) {
      return;
    }
    applyTabsUpdate(store, (current) => {
      const active = getActiveBrowserSurfaceTab(current);
      return active !== null && isAppSurfaceTab(active)
        ? updateAppSurfaceTab(current, { tabId: active.id, title })
        : current;
    });
  }, [enabled, path, store, title]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const active = getActiveBrowserSurfaceTab(
      store.get(browserSurfaceTabsAtom),
    );
    const route = resolveSurfaceTabRoute({
      isOnAppTabRoute: path !== null,
      tab: active,
    });
    // Null is "already where it belongs"; equal is the effect above having just
    // put it there. Anything else is a tab that was selected without the router
    // hearing about it, and the window follows it.
    if (route === null || route === path) {
      return;
    }
    void navigate(route);
  }, [activeTabId, enabled, navigate, path, store]);
}
