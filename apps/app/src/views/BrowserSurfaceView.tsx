import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import type {
  BrowserTabFaviconArgs,
  BrowserTabLoadingArgs,
} from "@/components/secondary-panel/BrowserTabContent";
import type { UpdateBrowserTabArgs } from "@/components/secondary-panel/useThreadFileTabs";
import { BrowserFindBar } from "@/components/browser-surface/BrowserFindBar";
import { BrowserSurfaceChrome } from "@/components/browser-surface/BrowserSurfaceChrome";
import { BrowserSurfaceTabStrip } from "@/components/browser-surface/BrowserSurfaceTabStrip";
import { BrowserTabSwitcher } from "@/components/browser-surface/BrowserTabSwitcher";
import { BROWSER_SELECT_TAB_APP_COMMAND_IDS } from "@bb/domain";
import {
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import {
  runPluginContextMenuItem,
  runPluginFindAction,
  usePluginContributions,
} from "@/hooks/queries/plugin-contribution-queries";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { buildBrowserSearchUrl } from "@/lib/browser-url";
import { useBrowserFind } from "@/lib/browser-find";
import { useBrowserHistory } from "@/lib/browser-history";
import { useBrowserTabCycling } from "@/lib/browser-tab-mru";
import {
  BROWSER_SURFACE_SCOPE_ID,
  useBrowserSurfaceTabs,
} from "@/lib/browser-surface-tabs";
import { isRoutePath } from "@/lib/route-paths";
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
  const {
    activateTab,
    activeTab,
    adoptTab,
    closeTab,
    openTab,
    reopenClosedTab,
    state,
    updateTab,
  } = useBrowserSurfaceTabs();
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

  // Popups (`window.open`, `target="_blank"`) become a new surface tab. The
  // shell denies every native popup and pushes the request to the renderer
  // instead, so a route with no subscriber is a link that does nothing at all.
  //
  // The scoped channel names the tab that asked, which is what keeps a thread
  // panel's popups out of the surface; the unscoped one is the fallback for a
  // shell that predates attribution, where a route path belongs to
  // `RouteNavigationProvider` rather than here.
  const surfaceTabIds = useMemo(
    () => new Set(state.tabs.map((tab) => tab.id)),
    [state.tabs],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) {
      return;
    }
    if (browserApi.onScopedOpenTab) {
      return browserApi.onScopedOpenTab(({ tabId, url }) => {
        if (surfaceTabIds.has(tabId)) {
          openTab(url);
        }
      });
    }
    return browserApi.onOpenTab(({ url }) => {
      if (isRoutePath({ path: url })) {
        return;
      }
      openTab(url);
    });
  }, [openTab, surfaceTabIds]);

  // Real popups. This surface claims them for its own tabs: it owns them, so it
  // can host a window Chromium created — which is what gives a page back the
  // handle `window.open()` returns and the `window.opener` an OAuth flow talks
  // to. The thread panel deliberately claims nothing: there a link follows the
  // user's in-app-link preference and may leave for the system browser, where
  // an opener means nothing.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.setPopupTabs === undefined) {
      return;
    }
    browserApi.setPopupTabs({ tabIds: [...surfaceTabIds] });
  }, [surfaceTabIds]);

  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onPopup === undefined) {
      return;
    }
    return browserApi.onPopup((popup) => {
      if (popup.kind === "closed") {
        // The page closed its own popup, which is how every OAuth flow ends.
        closeTab(popup.tabId);
        return;
      }
      if (surfaceTabIds.has(popup.openerTabId)) {
        adoptTab({ tabId: popup.tabId, url: popup.url });
      }
    });
  }, [adoptTab, closeTab, surfaceTabIds]);

  // "Search for <selection>" from a page's context menu. The shell sends the
  // query rather than a URL, because the search engine is the omnibox's and
  // only the renderer knows it.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onSearchSelection === undefined) {
      return;
    }
    return browserApi.onSearchSelection(({ query, tabId }) => {
      if (surfaceTabIds.has(tabId)) {
        openTab(buildBrowserSearchUrl(query));
      }
    });
  }, [openTab, surfaceTabIds]);

  // Plugin context-menu entries. Declared up front and handed to the shell, so
  // a right-click composes its menu without waiting on the server; the click is
  // what travels back.
  const contributedMenuItems =
    usePluginContributions().data?.browserContextMenuItems;
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.setContextMenuItems === undefined) {
      return;
    }
    browserApi.setContextMenuItems({
      items: (contributedMenuItems ?? []).map((item) => ({
        pluginId: item.pluginId,
        itemId: item.itemId,
        title: item.title,
        when: item.when,
      })),
    });
  }, [contributedMenuItems]);

  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onContextMenuInvoke === undefined) {
      return;
    }
    return browserApi.onContextMenuInvoke((invoke) => {
      if (!surfaceTabIds.has(invoke.tabId)) {
        return;
      }
      void runPluginContextMenuItem(invoke);
    });
  }, [surfaceTabIds]);

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

  // Browser tab commands. Registered here because this is what owns the tabs;
  // the chrome owns only the address bar and its reload.
  const tabIds = useMemo(() => state.tabs.map((tab) => tab.id), [state.tabs]);
  const { cycleRecentTab, selectSwitcherTab, switcher } = useBrowserTabCycling({
    activateTab,
    activeTabId: state.activeTabId,
    tabIds,
  });
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);

  const isSwitcherOpen = switcher !== null;
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.setOverlay === undefined || state.activeTabId === null) {
      return;
    }
    const tabId = state.activeTabId;
    browserApi.setOverlay({ tabId, active: isSwitcherOpen });
    return () => {
      browserApi.setOverlay?.({ tabId, active: false });
    };
  }, [isSwitcherOpen, state.activeTabId]);

  // Find in page. Owned here rather than by the chrome because the bar takes a
  // strip of layout of its own — the page below it shrinks while it is open.
  const find = useBrowserFind({
    tabId: activeTab?.id ?? null,
    url: activeTab?.url ?? "",
  });
  const contributedFindActions =
    usePluginContributions().data?.browserFindActions;
  const runFindAction = useCallback(
    (action: { itemId: string; pluginId: string }) => {
      if (activeTab === null) {
        return;
      }
      void runPluginFindAction({
        itemId: action.itemId,
        pageUrl: activeTab.url,
        pluginId: action.pluginId,
        query: find.query,
        tabId: activeTab.id,
      });
    },
    [activeTab, find.query],
  );
  useAppCommandHandler("browser.find", () => find.open());

  // Give the page the whole window. Offered only while the app window is
  // already full screen: covering the tab strip and the omnibox in an ordinary
  // window would leave the user with a page and no browser around it, and no
  // obvious way back. In an ordinary window the chord does nothing, which is
  // what a browser does with a shortcut that does not apply.
  const windowState = useDesktopWindowState();
  const [isPageFullscreen, setIsPageFullscreen] = useState(false);
  const setTabFullscreen = useCallback(
    (fullscreen: boolean) => {
      const browserApi = getDesktopBrowserApi();
      if (browserApi?.setFullscreen === undefined || activeTab === null) {
        return false;
      }
      browserApi.setFullscreen({ tabId: activeTab.id, fullscreen });
      setIsPageFullscreen(fullscreen);
      return true;
    },
    [activeTab],
  );
  useAppCommandHandler("browser.fullscreen.toggle", () => {
    if (!windowState.isFullScreen) {
      return false;
    }
    return setTabFullscreen(!isPageFullscreen);
  });
  // Leaving the window's own full screen takes the page's with it — otherwise a
  // view sized to the whole window would stay over the chrome of a normal one.
  useEffect(() => {
    if (!windowState.isFullScreen && isPageFullscreen) {
      setTabFullscreen(false);
    }
  }, [isPageFullscreen, setTabFullscreen, windowState.isFullScreen]);

  // ...and so does switching tabs: the expansion belongs to the tab it was
  // asked for, and a tab left expanded would come back that way over a strip
  // the user can no longer see.
  const activeTabId = activeTab?.id ?? null;
  useEffect(() => {
    if (activeTabId === null) {
      return;
    }
    return () => {
      getDesktopBrowserApi()?.setFullscreen?.({
        tabId: activeTabId,
        fullscreen: false,
      });
      setIsPageFullscreen(false);
    };
  }, [activeTabId]);

  useAppCommandHandler("browser.newTab", () => {
    openTab();
    return true;
  });
  useAppCommandHandler("browser.closeTab", () => {
    if (state.activeTabId === null) {
      return false;
    }
    closeTab(state.activeTabId);
    return true;
  });
  useAppCommandHandler("browser.reopenClosedTab", () => {
    reopenClosedTab();
    return true;
  });
  useAppCommandHandler("browser.selectLastTab", () => {
    const last = state.tabs.at(-1);
    if (last === undefined) {
      return false;
    }
    activateTab(last.id);
    return true;
  });
  useAppCommandHandler("browser.recentTab.next", () => {
    cycleRecentTab(1);
    return true;
  });
  useAppCommandHandler("browser.recentTab.previous", () => {
    cycleRecentTab(-1);
    return true;
  });
  useAppCommandHandler("browser.goBack", () => {
    if (state.activeTabId === null || desktopBrowser === null) {
      return false;
    }
    desktopBrowser.goBack(state.activeTabId);
    return true;
  });
  useAppCommandHandler("browser.goForward", () => {
    if (state.activeTabId === null || desktopBrowser === null) {
      return false;
    }
    desktopBrowser.goForward(state.activeTabId);
    return true;
  });
  // Cmd+1..8 by position. A number past the last tab does nothing rather than
  // clamping, which is Chromium's behaviour and the one that never surprises.
  useIndexedAppCommandHandlers(BROWSER_SELECT_TAB_APP_COMMAND_IDS, (index) => {
    const tab = state.tabs[index];
    if (tab === undefined) {
      return false;
    }
    activateTab(tab.id);
    return true;
  });

  return (
    // `data-app-browser` puts the whole surface in the browser command context,
    // so Cmd+L and Cmd+R work from the tab strip and chrome, not just from
    // inside the page.
    <div data-app-browser className="relative flex h-full min-h-0 flex-col">
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
      {find.isOpen ? (
        <BrowserFindBar
          actions={contributedFindActions}
          focusToken={find.focusToken}
          matches={find.matches}
          onClose={find.close}
          onRunAction={runFindAction}
          onSearch={find.search}
          onStep={find.step}
          query={find.query}
        />
      ) : null}
      {switcher === null ? null : (
        <BrowserTabSwitcher
          favicons={favicons}
          onSelect={selectSwitcherTab}
          switcher={switcher}
          tabs={state.tabs}
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
