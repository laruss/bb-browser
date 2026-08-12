// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import {
  createOmniboxHistoryProvider,
  createOmniboxNavigationProvider,
  createOmniboxOpenTabsProvider,
  createOmniboxSearchProvider,
  OMNIBOX_DEBOUNCE_MS,
  type OmniboxProvider,
} from "@/lib/omnibox";
import { BrowserSurfaceChrome } from "./BrowserSurfaceChrome";

const ACTIVE_TAB_ID = "tab-active";
const CURRENT_URL = "https://current.test/page";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

/**
 * The real built-in providers, so these tests cover the wiring the surface
 * actually uses rather than a stand-in provider.
 */
function builtInProviders(): readonly OmniboxProvider[] {
  return [
    createOmniboxNavigationProvider(),
    createOmniboxSearchProvider(),
    createOmniboxOpenTabsProvider({
      activeTabId: ACTIVE_TAB_ID,
      tabs: [
        { id: "tab-docs", title: "Docs — Example", url: "https://docs.test/" },
      ],
    }),
    createOmniboxHistoryProvider({
      entries: [
        {
          title: "Docs archive",
          url: "https://archive.test/docs",
          visitedAt: 0,
        },
      ],
    }),
  ];
}

interface RenderChromeResult {
  browser: BbDesktopBrowserApi;
  input: HTMLInputElement;
  navigate: ReturnType<typeof vi.fn>;
  onActivateTab: ReturnType<typeof vi.fn>;
}

function renderChrome(): RenderChromeResult {
  const navigate = vi.fn();
  const onActivateTab = vi.fn();
  const browser = { ...createNoopDesktopBrowserApi(), navigate };
  window.bbDesktop = createBbDesktopApi(desktopInfo, browser);

  render(
    <BrowserSurfaceChrome
      onActivateTab={onActivateTab}
      providers={builtInProviders()}
      tabId={ACTIVE_TAB_ID}
      url={CURRENT_URL}
    />,
  );

  return {
    browser,
    input: screen.getByRole("combobox") as HTMLInputElement,
    navigate,
    onActivateTab,
  };
}

/** Type into the omnibox and let the debounce elapse. */
async function typeQuery(input: HTMLInputElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(OMNIBOX_DEBOUNCE_MS);
  });
}

/** jsdom does not implicitly submit a form on Enter, so submit it directly. */
function pressEnter(input: HTMLInputElement) {
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

function optionLabels(): string[] {
  return screen
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BrowserSurfaceChrome", () => {
  it("shows the current URL and no suggestions at rest", () => {
    const { input } = renderChrome();

    expect(input.value).toBe(CURRENT_URL);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  // The mixed list is the milestone's point: several sources, one ranked list.
  it("mixes search, open-tab and history rows for a query", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");

    const labels = optionLabels();
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain("Search");
    expect(labels[0]).toContain("docs");
    expect(labels[1]).toContain("Tab");
    expect(labels[1]).toContain("Docs — Example");
    expect(labels[2]).toContain("History");
    expect(labels[2]).toContain("Docs archive");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("offers the address itself first for address-like input", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs.test");

    expect(optionLabels()[0]).toContain("https://docs.test");
  });

  it("waits for the debounce before running providers", async () => {
    const { input } = renderChrome();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "docs" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OMNIBOX_DEBOUNCE_MS - 1);
    });

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  // Enter must not depend on whether suggestions have arrived yet — that is why
  // the default action is resolved from the text, not from the list.
  it("searches the typed text on Enter before any suggestion arrives", () => {
    const { input, navigate } = renderChrome();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "best headphones" } });
    pressEnter(input);

    expect(navigate).toHaveBeenCalledWith({
      tabId: ACTIVE_TAB_ID,
      url: "https://www.google.com/search?q=best%20headphones",
    });
  });

  it("navigates to a typed address on Enter", () => {
    const { input, navigate } = renderChrome();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "example.com/x" } });
    pressEnter(input);

    expect(navigate).toHaveBeenCalledWith({
      tabId: ACTIVE_TAB_ID,
      url: "https://example.com/x",
    });
  });

  it("runs the highlighted row instead of the default action", async () => {
    const { input, navigate, onActivateTab } = renderChrome();

    await typeQuery(input, "docs");
    // Row 0 is the search default; row 1 is the open tab.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      "browser-omnibox-option-1",
    );

    pressEnter(input);

    expect(onActivateTab).toHaveBeenCalledWith("tab-docs");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates to a clicked history row", async () => {
    const { input, navigate } = renderChrome();

    await typeQuery(input, "docs");
    fireEvent.click(screen.getAllByRole("option")[2]);

    expect(navigate).toHaveBeenCalledWith({
      tabId: ACTIVE_TAB_ID,
      url: "https://archive.test/docs",
    });
  });

  it("closes the list and restores the URL on Escape", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");
    expect(screen.queryByRole("listbox")).not.toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe(CURRENT_URL);
  });

  it("closes the list on blur", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");
    fireEvent.blur(input);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("empties the list when the query is cleared", async () => {
    const { input } = renderChrome();

    await typeQuery(input, "docs");
    await typeQuery(input, "");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("enables back and forward from the native view's own state", () => {
    const listeners: ((state: unknown) => void)[] = [];
    const browser: BbDesktopBrowserApi = {
      ...createNoopDesktopBrowserApi(),
      onState(listener) {
        listeners.push(listener as (state: unknown) => void);
        return () => {};
      },
    };
    window.bbDesktop = createBbDesktopApi(desktopInfo, browser);
    render(
      <BrowserSurfaceChrome
        onActivateTab={() => {}}
        providers={builtInProviders()}
        tabId={ACTIVE_TAB_ID}
        url={CURRENT_URL}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Go back" }).hasAttribute("disabled"),
    ).toBe(true);

    act(() => {
      for (const listener of listeners) {
        listener({
          canGoBack: true,
          canGoForward: false,
          errorText: null,
          isLoading: true,
          tabId: ACTIVE_TAB_ID,
          title: null,
          url: CURRENT_URL,
        });
      }
    });

    expect(
      screen.getByRole("button", { name: "Go back" }).hasAttribute("disabled"),
    ).toBe(false);
    // Loading turns the reload control into a stop control.
    expect(screen.getByRole("button", { name: "Stop loading" })).toBeTruthy();
  });

  it("ignores state pushed for another tab", () => {
    const listeners: ((state: unknown) => void)[] = [];
    window.bbDesktop = createBbDesktopApi(desktopInfo, {
      ...createNoopDesktopBrowserApi(),
      onState(listener) {
        listeners.push(listener as (state: unknown) => void);
        return () => {};
      },
    });
    render(
      <BrowserSurfaceChrome
        onActivateTab={() => {}}
        providers={builtInProviders()}
        tabId={ACTIVE_TAB_ID}
        url={CURRENT_URL}
      />,
    );

    act(() => {
      for (const listener of listeners) {
        listener({
          canGoBack: true,
          canGoForward: true,
          errorText: null,
          isLoading: false,
          tabId: "some-other-tab",
          title: null,
          url: "https://other.test/",
        });
      }
    });

    expect(
      screen.getByRole("button", { name: "Go back" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
