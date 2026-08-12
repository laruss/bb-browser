import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import type {
  BrowserTabFaviconArgs,
  BrowserTabLoadingArgs,
} from "@/components/secondary-panel/BrowserTabContent";
import type { UpdateBrowserTabArgs } from "@/components/secondary-panel/useThreadFileTabs";
import { BrowserSurfaceChrome } from "@/components/browser-surface/BrowserSurfaceChrome";
import { BrowserSurfaceTabStrip } from "@/components/browser-surface/BrowserSurfaceTabStrip";
import { usePluginContributions } from "@/hooks/queries/plugin-contribution-queries";
import { useBrowserHistory } from "@/lib/browser-history";
import {
  BROWSER_SURFACE_SCOPE_ID,
  useBrowserSurfaceTabs,
} from "@/lib/browser-surface-tabs";
import {
  createOmniboxHistoryProvider,
  createOmniboxNavigationProvider,
  createOmniboxOpenTabsProvider,
  createOmniboxPluginProviders,
  createOmniboxSearchProvider,
  createPluginOmniboxSuggestionSource,
} from "@/lib/omnibox";

/**
 * The browser as a top-level surface rather than a panel inside a thread.
 *
 * The Electron layer is reused unchanged: `BrowserTabDeck` mounts only the
 * active tab's `BrowserTabContent`, which owns the native `WebContentsView`
 * bounds sync, the resize snapshot and the load-error screens. What this view
 * adds is thread-independent tab ownership, a tab strip, and the omnibox chrome
 * — so the deck's own address bar is turned off (`showChrome={false}`).
 *
 * `threadId` here is the deck's opaque scope key, not a thread — see
 * `BROWSER_SURFACE_SCOPE_ID`. `environmentId` is null because a surface tab
 * belongs to no workspace.
 */
export function BrowserSurfaceView() {
  const { activateTab, activeTab, closeTab, openTab, state, updateTab } =
    useBrowserSurfaceTabs();
  const { entries: history } = useBrowserHistory(BROWSER_SURFACE_SCOPE_ID);
  const tabCount = state.tabs.length;

  useEffect(() => {
    // The surface is never empty: an empty-URL tab shows the new-tab screen,
    // which is also what the user gets after closing the last tab.
    if (tabCount === 0) {
      openTab();
    }
  }, [openTab, tabCount]);

  const handleUpdate = useCallback(
    ({ tabId, title, url }: UpdateBrowserTabArgs) => {
      updateTab({ tabId, title, url });
    },
    [updateTab],
  );

  const handleOpen = useCallback(() => {
    openTab();
  }, [openTab]);

  // Page icons live for the session only, deliberately: they are bytes a page
  // supplied, the persisted tab state is localStorage (a 5MB budget the tab list
  // must not spend on icons), and the deck mounts only the active tab — so the
  // strip shows an icon for every tab visited since launch and its generic mark
  // for the rest.
  const [favicons, setFavicons] = useState<Record<string, string>>({});
  // Which tabs are loading, so the strip can spin in place of the icon. Only the
  // mounted (active) tab reports, and it reports "not loading" on unmount.
  const [loadingTabIds, setLoadingTabIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handleLoadingChange = useCallback(
    ({ isLoading, tabId }: BrowserTabLoadingArgs) => {
      setLoadingTabIds((current) => {
        if (current.has(tabId) === isLoading) {
          return current;
        }
        const next = new Set(current);
        if (isLoading) {
          next.add(tabId);
        } else {
          next.delete(tabId);
        }
        return next;
      });
    },
    [],
  );
  const handleFavicon = useCallback(
    ({ dataUrl, tabId }: BrowserTabFaviconArgs) => {
      setFavicons((current) => {
        if (dataUrl === null) {
          if (current[tabId] === undefined) {
            return current;
          }
          const { [tabId]: _removed, ...rest } = current;
          return rest;
        }
        return current[tabId] === dataUrl
          ? current
          : { ...current, [tabId]: dataUrl };
      });
    },
    [],
  );

  // One shared request per query across every plugin provider; stable for the
  // life of the surface so it can dedupe consecutive runs.
  const pluginSuggestionSource = useRef(
    createPluginOmniboxSuggestionSource(),
  ).current;
  const contributedOmniboxProviders =
    usePluginContributions().data?.omniboxProviders;

  // Registration order is the tie-break for equal scores, so the two providers
  // that own the default action come first and plugins come last — a plugin
  // cannot outrank the browser's own default action. Rebuilding this list as
  // tabs, history or installed plugins change does not disturb a query in
  // flight — see `useOmnibox`.
  const omniboxProviders = useMemo(
    () => [
      createOmniboxNavigationProvider(),
      createOmniboxSearchProvider(),
      createOmniboxOpenTabsProvider({
        activeTabId: state.activeTabId,
        tabs: state.tabs,
      }),
      createOmniboxHistoryProvider({ entries: history }),
      ...createOmniboxPluginProviders({
        contributions: contributedOmniboxProviders ?? [],
        source: pluginSuggestionSource,
      }),
    ],
    [
      contributedOmniboxProviders,
      history,
      pluginSuggestionSource,
      state.activeTabId,
      state.tabs,
    ],
  );

  return (
    // `data-app-browser` puts the whole surface in the browser command context,
    // so Cmd+L and Cmd+R work from the tab strip and chrome, not just from
    // inside the page.
    <div data-app-browser className="flex h-full min-h-0 flex-col">
      <BrowserSurfaceTabStrip
        activeTabId={state.activeTabId}
        favicons={favicons}
        loadingTabIds={loadingTabIds}
        onActivate={activateTab}
        onClose={closeTab}
        onOpen={handleOpen}
        tabs={state.tabs}
      />
      {activeTab === null ? null : (
        <BrowserSurfaceChrome
          key={activeTab.id}
          onActivateTab={activateTab}
          providers={omniboxProviders}
          tabId={activeTab.id}
          url={activeTab.url}
        />
      )}
      <BrowserTabDeck
        browserTabs={state.tabs}
        activeBrowserTabId={state.activeTabId}
        environmentId={null}
        // The route owns the whole viewport, so the native view may show as soon
        // as it attaches — there is no drawer animation to wait out.
        canShowNativeBrowserView
        showChrome={false}
        threadId={BROWSER_SURFACE_SCOPE_ID}
        onUpdate={handleUpdate}
        onFavicon={handleFavicon}
        onLoadingChange={handleLoadingChange}
      />
    </div>
  );
}

export default BrowserSurfaceView;
