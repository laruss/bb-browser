import { useCallback, useEffect, useRef, useState } from "react";

// Recently-used order for browser tabs, and the Ctrl+Tab switcher over it.
//
// Chromium's Ctrl+Tab walks tabs by position. This walks them by *use*, and
// shows the list while you walk it, the way an IDE does: hold Ctrl, press Tab
// to move down the list, release Ctrl to land. One press and release is the
// common case and lands on the tab you were in before this one.

/**
 * Backstop only. The switcher normally closes when Ctrl is released; this
 * exists because a missed release would otherwise strand the overlay with the
 * page frozen behind it. It is deliberately long — a user reading the list is
 * not a user who wants it closed.
 */
export const MRU_SWITCHER_BACKSTOP_MS = 5_000;

/** Most recently used first. */
export function promoteTabInMru(
  order: readonly string[],
  tabId: string,
): readonly string[] {
  if (order[0] === tabId) {
    return order;
  }
  return [tabId, ...order.filter((candidate) => candidate !== tabId)];
}

/**
 * Drop ids that are no longer tabs, and append tabs the order has never seen
 * (restored from storage, opened by an agent) so every tab is reachable.
 *
 * A tab nobody has switched to yet has no use to be ordered by, so a fresh
 * session starts in tab order and only diverges from it as the user works.
 */
export function reconcileMru(
  order: readonly string[],
  tabIds: readonly string[],
): readonly string[] {
  const live = new Set(tabIds);
  const known = order.filter((tabId) => live.has(tabId));
  const seen = new Set(known);
  const missing = tabIds.filter((tabId) => !seen.has(tabId));
  return missing.length === 0 && known.length === order.length
    ? order
    : [...known, ...missing];
}

export interface BrowserTabSwitcherState {
  /**
   * The order as it was when the switcher opened, most recently used first.
   * Frozen for its life: a list that re-sorted while being read would move the
   * row under the user's finger.
   */
  order: readonly string[];
  index: number;
}

export interface AdvanceMruCycleArgs {
  cycle: BrowserTabSwitcherState | null;
  order: readonly string[];
  /** +1 walks towards older tabs (Ctrl+Tab), -1 back towards newer. */
  step: number;
}

/** The next position in the cycle, or null when there is nothing to cycle to. */
export function advanceMruCycle({
  cycle,
  order,
  step,
}: AdvanceMruCycleArgs): BrowserTabSwitcherState | null {
  const source = cycle?.order ?? order;
  if (source.length < 2) {
    return null;
  }
  const from = cycle?.index ?? 0;
  const length = source.length;
  return { order: source, index: (((from + step) % length) + length) % length };
}

export function mruCycleTabId(
  cycle: BrowserTabSwitcherState,
): string | null {
  return cycle.order[cycle.index] ?? null;
}

export interface UseBrowserTabCyclingArgs {
  activateTab: (tabId: string) => void;
  activeTabId: string | null;
  tabIds: readonly string[];
}

export interface BrowserTabCycling {
  /** Null when the switcher is closed. */
  switcher: BrowserTabSwitcherState | null;
  /** `+1` for Ctrl+Tab, `-1` for Ctrl+Shift+Tab. */
  cycleRecentTab: (step: number) => void;
  /** Land on the highlighted tab — what releasing Ctrl does. */
  commitSwitcher: () => void;
  /** Close without switching. */
  cancelSwitcher: () => void;
  /** Land on a tab the user picked from the list directly. */
  selectSwitcherTab: (tabId: string) => void;
}

/**
 * Ctrl+Tab over recently used tabs, with the switcher the walking happens in.
 *
 * The order updates from `activeTabId` rather than from the call sites that
 * change it, so a click, the omnibox, a shortcut and an agent all count the
 * same — one place to be right instead of five.
 *
 * Nothing is activated while stepping: the tab changes when the user lands,
 * which is what an IDE does and what keeps a five-tab walk from loading five
 * pages.
 */
export function useBrowserTabCycling({
  activateTab,
  activeTabId,
  tabIds,
}: UseBrowserTabCyclingArgs): BrowserTabCycling {
  const orderRef = useRef<readonly string[]>([]);
  const [switcher, setSwitcher] = useState<BrowserTabSwitcherState | null>(
    null,
  );
  const backstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    orderRef.current = reconcileMru(orderRef.current, tabIds);
  }, [tabIds]);

  useEffect(() => {
    // While the switcher is open nothing has been activated yet, so there is
    // nothing to promote; landing is what promotes.
    if (activeTabId !== null && switcher === null) {
      orderRef.current = promoteTabInMru(orderRef.current, activeTabId);
    }
  }, [activeTabId, switcher]);

  const clearBackstop = useCallback(() => {
    if (backstopRef.current !== null) {
      clearTimeout(backstopRef.current);
      backstopRef.current = null;
    }
  }, []);

  const closeSwitcher = useCallback(
    (tabId: string | null) => {
      clearBackstop();
      setSwitcher(null);
      if (tabId !== null && tabId !== activeTabId) {
        activateTab(tabId);
      }
    },
    [activateTab, activeTabId, clearBackstop],
  );

  const cycleRecentTab = useCallback(
    (step: number) => {
      setSwitcher((current) => {
        const next = advanceMruCycle({
          cycle: current,
          order: orderRef.current,
          step,
        });
        return next ?? current;
      });
      clearBackstop();
      backstopRef.current = setTimeout(() => {
        setSwitcher((current) => {
          if (current !== null) {
            const tabId = mruCycleTabId(current);
            if (tabId !== null && tabId !== activeTabId) {
              activateTab(tabId);
            }
          }
          return null;
        });
      }, MRU_SWITCHER_BACKSTOP_MS);
    },
    [activateTab, activeTabId, clearBackstop],
  );

  const commitSwitcher = useCallback(() => {
    closeSwitcher(switcher === null ? null : mruCycleTabId(switcher));
  }, [closeSwitcher, switcher]);

  const cancelSwitcher = useCallback(() => {
    closeSwitcher(null);
  }, [closeSwitcher]);

  const selectSwitcherTab = useCallback(
    (tabId: string) => {
      closeSwitcher(tabId);
    },
    [closeSwitcher],
  );

  // Releasing Ctrl is what lands the walk. The renderer only sees it because
  // the shell focuses the host window when the cycle starts — a key released
  // inside a browsed page never reaches the DOM.
  useEffect(() => {
    if (switcher === null) {
      return;
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        commitSwitcher();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelSwitcher();
      }
    };
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelSwitcher, commitSwitcher, switcher]);

  useEffect(() => clearBackstop, [clearBackstop]);

  return {
    switcher,
    cycleRecentTab,
    commitSwitcher,
    cancelSwitcher,
    selectSwitcherTab,
  };
}
