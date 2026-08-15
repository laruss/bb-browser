import { useState } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useOptionalIsSidebarShowing } from "@/components/ui/sidebar.js";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
  SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
} from "@/lib/bb-desktop";
import { resolveAppTabIconName } from "@/lib/app-surface-tabs";
import {
  isAppSurfaceTab,
  type BrowserSurfaceTab,
} from "@/lib/browser-surface-tabs";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { useIsLeadingPanelShowing } from "@/components/layout/PluginLeadingPanel";

export interface BrowserSurfaceTabStripProps {
  activeTabId: string | null;
  /**
   * Page icons by tab id, as `data:` URIs the desktop shell built (see
   * `desktop-browser-favicon.ts`). Missing means "not known this session", not
   * "no icon" — the deck mounts one tab at a time, so a tab contributes its icon
   * the first time it is visited.
   */
  favicons?: Readonly<Record<string, string>>;
  /** Tabs currently loading a page; they spin in place of their icon. */
  loadingTabIds?: ReadonlySet<string>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOpen: () => void;
  tabs: readonly BrowserSurfaceTab[];
}

interface TabStripChromeReserveArgs {
  /** Null outside a `SidebarProvider`, where nothing is pinned over the strip. */
  isSidebarShowing: boolean | null;
  isCompactViewport: boolean;
  reserveMacosTrafficLights: boolean;
}

/**
 * Padding classes that clear the window's pinned title-bar chrome. The surface
 * draws no page header, so this strip *is* the title-bar row and inherits its
 * obligations — the same two, reserved by the same rule, as AppPageHeader: the
 * macOS traffic lights at the leading end while they are visible, and the pinned
 * sidebar trigger at the trailing end while the sidebar is collapsed (an open
 * sidebar covers the trigger and reserves it in its own top row).
 *
 * Both tokens are sized against a 16px base inset, which is why the strip is
 * `px-4` rather than the tighter inset a tab row would otherwise use — see
 * {@link MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS} for that geometry.
 */
export function resolveTabStripChromeReserveClassName({
  isSidebarShowing,
  isCompactViewport,
  reserveMacosTrafficLights,
}: TabStripChromeReserveArgs): string {
  return cn(
    reserveMacosTrafficLights && MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS,
    (isCompactViewport || isSidebarShowing === false) &&
      SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
  );
}

/**
 * Tab sizing, Chromium's rule: every tab is the same width whatever its title
 * says, that width is Chromium's own 240px until the tabs stop fitting, and from
 * there they shrink together down to a floor.
 *
 * An identical fixed width — not `flex-1`, which would divide the strip and
 * stretch two tabs across it — is what makes the widths equal and content-
 * independent: a title cannot widen its own tab, and a half-empty strip leaves
 * the space after the last tab rather than inflating tabs into it. Shrinking is
 * `shrink` against that shared width: equal bases shrink by equal amounts, so the
 * tabs stay identical the whole way down. No measuring, no resize observer.
 *
 * A definite `w-60` rather than `basis-60`, and the difference is the whole of a
 * bug that outlived two attempts to fix it. Both give the same flex base size,
 * but they give the tab list around the tabs different **max-content** sizes, and
 * that size is what the list is sized by (it is `flex: 0 1 auto`). Flexbox
 * computes it from the items' content, not their bases: each item offers
 * `(max-content contribution − flex base size)`, and when *every* tab's content
 * is narrower than 240 — a fresh tab reading "New tab", a host name, a page that
 * has not reported a title yet — that difference is negative for all of them, the
 * list shrinks below 240 × N, and the tabs shrink with it. One long title arrives
 * and they all snap back out. A definite width makes the contribution definite
 * too, so it equals the base, the difference is zero, and the list is 240 × N
 * whatever the pages say.
 *
 * The floor is what a tab still needs when its title has been squeezed out
 * entirely: the page icon and the close control, nothing else. It is the sum of
 * the tab's own geometry (`pl-2` + a `size-4` icon + `gap-1.5` + the `pr-7`
 * reserved for the close control = 58px, rounded to 60), so changing any of those
 * paddings means recomputing it. Below the floor the strip clips instead of
 * scrolling (see the list container).
 */
const TAB_WIDTH_CLASS = "min-w-15 w-60 shrink";

/**
 * A tab's visible name. Titles arrive asynchronously — from the native view for
 * a web tab, from the screen's own document title for an app tab — so the host
 * (or the path) is the interim label, and "New tab" covers a tab with no page
 * yet (empty URL — see the desktop browser IPC contract).
 */
export function browserSurfaceTabLabel(tab: BrowserSurfaceTab): string {
  if (tab.title !== null && tab.title.trim().length > 0) {
    return tab.title;
  }
  if (isAppSurfaceTab(tab)) {
    return tab.path;
  }
  if (tab.url.length === 0) {
    return "New tab";
  }
  const host = getBrowserUrlHost(tab.url);
  return host.length > 0 ? host : tab.url;
}

/**
 * A tab's page icon: a spinner while it loads (Chromium's own trade — progress is
 * worth more than identity on a tab you are waiting for), then the page's icon, or
 * the generic mark for a tab whose icon this session has not seen.
 *
 * The image is decorative: the tab's title names it, and `alt` text from a page
 * would be a second attacker-controlled string in the strip.
 */
function BrowserSurfaceTabIcon({
  appIcon,
  dataUrl,
  isLoading,
}: {
  /** Set for an app tab, which has no page and so never has a page icon. */
  appIcon: IconName | null;
  dataUrl: string | null;
  isLoading: boolean;
}) {
  if (appIcon !== null) {
    return (
      <Icon name={appIcon} className="size-4 shrink-0 opacity-70" aria-hidden />
    );
  }
  if (isLoading) {
    return (
      <Icon
        name="Spinner"
        className="size-4 shrink-0 animate-spin opacity-70"
        aria-hidden="true"
      />
    );
  }
  if (dataUrl === null) {
    return (
      <Icon
        name="Globe"
        className="size-4 shrink-0 opacity-70"
        aria-hidden="true"
      />
    );
  }
  return <img src={dataUrl} alt="" className="size-4 shrink-0 rounded-sm" />;
}

const NO_LOADING_TAB_IDS: ReadonlySet<string> = new Set();

export function BrowserSurfaceTabStrip({
  activeTabId,
  favicons = {},
  loadingTabIds = NO_LOADING_TAB_IDS,
  onActivate,
  onClose,
  onOpen,
  tabs,
}: BrowserSurfaceTabStripProps) {
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const isCompactViewport = useIsCompactViewport();
  const isSidebarShowing = useOptionalIsSidebarShowing();
  const isLeadingPanelShowing = useIsLeadingPanelShowing();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const chromeReserveClassName = resolveTabStripChromeReserveClassName({
    isCompactViewport,
    isSidebarShowing,
    // Not while the plugin panel is there: it owns the window's leading edge
    // and holds the lights' strip open itself.
    reserveMacosTrafficLights:
      !isLeadingPanelShowing &&
      shouldReserveMacosTrafficLights({
        desktopInfo,
        windowState: desktopWindowState,
      }),
  });
  // In desktop chrome the strip is the window's drag handle, so every control on
  // it has to opt back out of dragging to stay clickable.
  const noDragClassName = usesDesktopChrome ? MACOS_WINDOW_NO_DRAG_CLASS : null;
  return (
    <div
      className={cn(
        "flex shrink-0 items-stretch gap-1 border-b border-border bg-sidebar px-4 py-1",
        // The shared title-bar row: the pinned trigger and the traffic lights are
        // centered on this height, so a shorter strip would let them spill onto
        // the omnibox row below.
        CHROME_ROW_HEIGHT_CLASS,
        usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
        "transition-[padding] duration-200 ease-linear",
        chromeReserveClassName,
      )}
    >
      {/* The tabs get their own box so the new-tab button, which never shrinks,
          stays outside what clipping can reach. The box is sized by its tabs
          rather than by the strip (no `flex-1`), which is what puts the new-tab
          button immediately after the last tab instead of against the right edge
          — and "by its tabs" holds only because each tab caps its own
          contribution (see TAB_WIDTH_CLASS); `min-w-0` still lets it be squeezed
          below its content, and then it clips. No scrolling: past the width floor
          the strip clips, which is the cost of the floor being a floor. */}
      <div
        className="flex min-w-0 items-stretch overflow-hidden"
        role="tablist"
        aria-label="Browser tabs"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const label = browserSurfaceTabLabel(tab);
          // Chromium's separator rule: a hairline on the edge two plain tabs
          // share, and none touching the selected tab, which is already bounded
          // by its own fill. Tabs sit flush, so "the edge they share" is one
          // edge — hence a divider drawn on it rather than a gap between them.
          const showsDivider =
            index > 0 && !isActive && tabs[index - 1]?.id !== activeTabId;
          return (
            // The tab's fill lives on this box, the same box the close control is
            // positioned inside, so the control cannot land off the tab. Painting
            // the inner button instead is what put it outside.
            <div
              key={tab.id}
              className={cn(
                "group relative flex items-stretch rounded-md transition-colors",
                isActive
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
                TAB_WIDTH_CLASS,
                noDragClassName,
              )}
            >
              {showsDivider ? (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-px bg-border"
                />
              ) : null}
              {/* The tab is one control filling the box: the padding above and
                  below the title activates it too. Room for the close control is
                  reserved rather than overlapped, at every width — the floor is
                  sized to hold it. */}
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  onActivate(tab.id);
                }}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 pr-7 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <BrowserSurfaceTabIcon
                  appIcon={
                    isAppSurfaceTab(tab)
                      ? resolveAppTabIconName(tab.path)
                      : null
                  }
                  dataUrl={favicons[tab.id] ?? null}
                  isLoading={loadingTabIds.has(tab.id)}
                />
                <span className="min-w-0 truncate">{label}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${label}`}
                onClick={() => {
                  onClose(tab.id);
                }}
                // No `noDragClassName` here: the whole tab is already carved out
                // of the drag region by its box, and that class carries
                // `relative`, which tailwind-merge would apply *over* the
                // `absolute` below — which is what threw this control out of the
                // tab in desktop chrome.
                className="absolute inset-y-1 right-1 flex items-center rounded px-0.5 opacity-0 transition-opacity hover:bg-state-active group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {/* Same size bb's other tab close affordance uses (see
                    TAB_PILL_AFFORDANCE_ICON_CLASS): the control reads as a
                    secondary mark on the tab rather than a second glyph
                    competing with the title. */}
                <Icon name="X" className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New tab"
        onClick={onOpen}
        className={cn(
          "flex shrink-0 items-center rounded-md px-2 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          noDragClassName,
        )}
      >
        <Icon name="Plus" aria-hidden />
      </button>
    </div>
  );
}
