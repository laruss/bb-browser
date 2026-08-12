// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
} from "@/lib/bb-desktop";
import {
  BrowserSurfaceTabStrip,
  resolveTabStripTopLeftReserveClassName,
} from "./BrowserSurfaceTabStrip";

function browserTab(
  id: string,
  title: string | null,
  url = "https://example.test/",
): BrowserFixedPanelTab {
  return { environmentId: null, id, kind: "browser", title, url };
}

function renderStrip(
  tabs: readonly BrowserFixedPanelTab[],
  favicons: Readonly<Record<string, string>> = {},
  loadingTabIds: ReadonlySet<string> = new Set(),
) {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  render(
    <BrowserSurfaceTabStrip
      activeTabId={tabs[0]?.id ?? null}
      favicons={favicons}
      loadingTabIds={loadingTabIds}
      onActivate={onActivate}
      onClose={onClose}
      onOpen={() => {}}
      tabs={tabs}
    />,
  );
  return { onActivate, onClose };
}

const MACOS_DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
});

// The surface draws no page header, so this strip owns the window's title-bar
// row. Getting the reserve wrong is BB-46 again — the pinned sidebar trigger and
// the macOS traffic lights land on top of the first tab.
describe("browser surface tab strip top-left reserve", () => {
  it("reserves the pinned trigger footprint while the sidebar is collapsed", () => {
    expect(
      resolveTabStripTopLeftReserveClassName({
        isCompactViewport: false,
        isSidebarShowing: false,
        reserveMacosTrafficLights: false,
      }),
    ).toBe(BROWSER_COLLAPSED_HEADER_RESERVE_CLASS);
  });

  it("reserves the wider traffic-light footprint when the lights are visible", () => {
    expect(
      resolveTabStripTopLeftReserveClassName({
        isCompactViewport: false,
        isSidebarShowing: false,
        reserveMacosTrafficLights: true,
      }),
    ).toBe(MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS);
  });

  // An expanded sidebar hosts the trigger and the lights itself, so the strip
  // starts at its own inset instead of leaving a gap nothing sits in.
  it("reserves nothing while the sidebar shows", () => {
    expect(
      resolveTabStripTopLeftReserveClassName({
        isCompactViewport: false,
        isSidebarShowing: true,
        reserveMacosTrafficLights: true,
      }),
    ).toBe(false);
  });

  // On compact viewports the sidebar opens as an overlay above the strip, so the
  // reserve has to hold across drawer state rather than shifting tabs behind it.
  it("keeps the reserve on compact viewports whatever the drawer does", () => {
    expect(
      resolveTabStripTopLeftReserveClassName({
        isCompactViewport: true,
        isSidebarShowing: true,
        reserveMacosTrafficLights: false,
      }),
    ).toBe(BROWSER_COLLAPSED_HEADER_RESERVE_CLASS);
  });

  // Rendered outside a SidebarProvider (isolation tests, Ladle) there is no
  // pinned trigger to clear.
  it("reserves nothing with no sidebar context", () => {
    expect(
      resolveTabStripTopLeftReserveClassName({
        isCompactViewport: false,
        isSidebarShowing: null,
        reserveMacosTrafficLights: true,
      }),
    ).toBe(false);
  });
});

// jsdom computes no layout, so the sizing rules are asserted where they live: the
// classes. What matters is that a tab's width cannot depend on its title.
describe("browser surface tab strip sizing", () => {
  it("sizes every tab identically whatever its title says", () => {
    renderStrip([
      browserTab("tab-1", "A"),
      browserTab(
        "tab-2",
        "An extremely long page title that would otherwise stretch its tab",
      ),
      browserTab("tab-3", null, ""),
    ]);

    // Selection colours differ per tab; the sizing must not. Compare only the
    // classes that can decide a width.
    const sizing = screen.getAllByRole("tab").map((tab) =>
      (tab.parentElement?.className ?? "")
        .split(" ")
        .filter((token) =>
          /^(?:min-w-|max-w-|w-|flex-|basis-|shrink|grow)/u.test(token),
        )
        .sort()
        .join(" "),
    );
    expect(new Set(sizing).size).toBe(1);
    // One shared basis rather than a share of the strip, so tabs neither stretch
    // to fill it nor follow their titles; they shrink from there to a floor that
    // holds the page icon and the close control. See TAB_WIDTH_CLASS.
    expect(sizing[0]).toBe("basis-60 min-w-15 shrink");
  });

  it("clips instead of scrolling once tabs reach the floor", () => {
    renderStrip([browserTab("tab-1", "One"), browserTab("tab-2", "Two")]);

    const list = screen.getByRole("tablist");
    expect(list.className).toContain("overflow-hidden");
    expect(list.className).not.toContain("overflow-x-auto");
    expect(list.className).not.toContain("overflow-x-scroll");
  });

  // The new-tab button lives outside the clipped list, so a crowded strip never
  // takes away the way to open another tab.
  it("keeps the new-tab button out of the clipped list", () => {
    renderStrip([browserTab("tab-1", "One")]);

    const list = screen.getByRole("tablist");
    expect(list.contains(screen.getByRole("button", { name: "New tab" }))).toBe(
      false,
    );
  });

  // Chromium puts the button right after the last tab, not at the far edge. That
  // is a layout fact: the tab list must be sized by its tabs, so it must not take
  // the strip's leftover space.
  it("lets the tab list end where its tabs end", () => {
    renderStrip([browserTab("tab-1", "One")]);

    const list = screen.getByRole("tablist");
    expect(list.className).not.toContain("flex-1");
    expect(list.className).not.toContain("w-full");
    // The next sibling is the button, so nothing sits between them but the strip's
    // own gap.
    expect(list.nextElementSibling).toBe(
      screen.getByRole("button", { name: "New tab" }),
    );
  });
});

describe("browser surface tab strip hit target", () => {
  it("activates from the tab's whole box rather than its text", () => {
    const { onActivate } = renderStrip([
      browserTab("tab-1", "One"),
      browserTab("tab-2", "Two"),
    ]);

    const tab = screen.getByRole("tab", { name: "Two" });
    // The tab itself is the control and fills its box, so the padding above and
    // below the title activates it too; the title is only a child span.
    expect(tab.tagName).toBe("BUTTON");
    expect(tab.className).toContain("flex-1");
    expect(tab.querySelector("span")?.textContent).toBe("Two");
    fireEvent.click(tab);
    expect(onActivate).toHaveBeenCalledWith("tab-2");
  });

  // Nesting the close control inside the tab control would be invalid markup and
  // would fire both actions, so it is a sibling laid over the tab's tail.
  it("keeps the close control out of the tab control", () => {
    const { onActivate, onClose } = renderStrip([browserTab("tab-1", "One")]);

    const tab = screen.getByRole("tab", { name: "One" });
    expect(tab.querySelector("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close One" }));
    expect(onClose).toHaveBeenCalledWith("tab-1");
    expect(onActivate).not.toHaveBeenCalled();
  });

  // In desktop chrome the strip is the window's drag region and each tab carves
  // itself out of it. That carve-out class carries `relative`, which
  // tailwind-merge applied over the close control's `absolute` and dropped the
  // control into the strip's flow, outside the tab it belongs to.
  it("keeps the close control positioned inside its tab in desktop chrome", () => {
    window.bbDesktop = createBbDesktopApi(MACOS_DESKTOP_INFO);
    renderStrip([browserTab("tab-1", "One")]);

    const close = screen.getByRole("button", { name: "Close One" });
    expect(close.className).toContain("absolute");
    expect(close.className).not.toContain("relative");
    // The carve-out belongs to the tab box, which covers both controls.
    expect(close.parentElement?.className).toContain("no-drag");
  });
});

// Unselected tabs sit flush against each other, so what tells them apart is a
// hairline on the edge they share — not a gap, which would put space between the
// separator and the tabs it separates.
describe("browser surface tab strip separators", () => {
  function tabBox(name: string): HTMLElement {
    const box = screen.getByRole("tab", { name }).parentElement;
    if (box === null) {
      throw new Error(`tab "${name}" has no box`);
    }
    return box;
  }

  function divider(name: string): Element | null {
    return tabBox(name).querySelector("span.w-px");
  }

  it("draws a hairline between plain tabs and none touching the active tab", () => {
    renderStrip([
      browserTab("tab-1", "One"),
      browserTab("tab-2", "Two"),
      browserTab("tab-3", "Three"),
      browserTab("tab-4", "Four"),
    ]);

    // Tab 1 is active: nothing leads the strip, and nothing abuts the active
    // tab's own fill.
    expect(divider("One")).toBeNull();
    expect(divider("Two")).toBeNull();
    expect(divider("Three")).not.toBeNull();
    expect(divider("Four")).not.toBeNull();
  });

  it("puts the hairline exactly on the shared edge", () => {
    renderStrip([
      browserTab("tab-1", "One"),
      browserTab("tab-2", "Two"),
      browserTab("tab-3", "Three"),
    ]);

    // Flush tabs (no gap utility on the list), so a hairline pinned to the left
    // edge of one tab is the right edge of the one before it — no space between
    // the separator and either tab.
    expect(screen.getByRole("tablist").className).not.toContain("gap-");
    expect(divider("Three")?.className).toContain("left-0");
  });
});

// Chromium shows the page's own icon; bb's shell fetches it and hands over a
// data URI, so the strip renders bytes rather than a page-supplied URL.
describe("browser surface tab strip icons", () => {
  const ICON_DATA_URL = "data:image/png;base64,aWNvbg==";

  function iconOf(name: string): Element | null | undefined {
    return screen.getByRole("tab", { name }).querySelector("img, [data-icon]");
  }

  it("shows the page icon for a tab whose icon is known", () => {
    renderStrip([browserTab("tab-1", "One"), browserTab("tab-2", "Two")], {
      "tab-1": ICON_DATA_URL,
    });

    const icon = iconOf("One");
    expect(icon?.tagName).toBe("IMG");
    expect(icon?.getAttribute("src")).toBe(ICON_DATA_URL);
    // Decorative: the tab's title already names it.
    expect(icon?.getAttribute("alt")).toBe("");
  });

  // Missing means "not seen this session" — the deck mounts one tab at a time —
  // so the generic mark holds the same space the real icon will take.
  // Chromium's trade: on a tab you are waiting for, progress is worth more than
  // identity, and the spinner takes exactly the icon's place so nothing shifts.
  it("spins in place of the icon while a tab loads", () => {
    renderStrip(
      [browserTab("tab-1", "One"), browserTab("tab-2", "Two")],
      { "tab-1": ICON_DATA_URL, "tab-2": ICON_DATA_URL },
      new Set(["tab-1"]),
    );

    const loading = iconOf("One");
    expect(loading?.getAttribute("data-icon")).toBe("Spinner");
    expect(loading?.getAttribute("class")).toContain("animate-spin");
    // The tab that is not loading keeps showing what it is.
    expect(iconOf("Two")?.tagName).toBe("IMG");
  });

  it("falls back to a generic mark for a tab with no icon yet", () => {
    renderStrip([browserTab("tab-1", "One"), browserTab("tab-2", "Two")], {
      "tab-1": ICON_DATA_URL,
    });

    const icon = iconOf("Two");
    expect(icon?.tagName).not.toBe("IMG");
    expect(icon?.getAttribute("data-icon")).toBe("Globe");
  });
});
