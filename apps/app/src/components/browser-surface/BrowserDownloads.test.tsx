// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopBrowserDownload,
  BbDesktopBrowserDownloadActionRequest,
} from "@bb/desktop-contract";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { useBrowserDownloadNotifications } from "@/lib/browser-downloads";
import { BrowserSurfaceChrome } from "./BrowserSurfaceChrome";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function completedDownload(
  overrides: Partial<BbDesktopBrowserDownload> = {},
): BbDesktopBrowserDownload {
  return {
    id: "download-1",
    tabId: "tab-active",
    filename: "report.pdf",
    savePath: "/Users/someone/Downloads/report.pdf",
    url: "https://example.test/report.pdf",
    mimeType: "application/pdf",
    state: "completed",
    ...overrides,
  };
}

/**
 * The chrome plus the reporter that feeds it, which is how these two meet in
 * the running app — the reporter is mounted above the router so downloads keep
 * arriving after the user leaves `/browser`.
 */
function DownloadsHarness() {
  useBrowserDownloadNotifications();
  return (
    <BrowserSurfaceChrome
      onActivateTab={() => undefined}
      onOpenAppRoute={() => {}}
      providers={[]}
      tabId="tab-active"
      url="https://current.test/page"
    />
  );
}

function renderChrome() {
  const downloadAction = vi.fn(async () => ({ ok: true }) as const);
  const setOverlay = vi.fn();
  const listeners: Array<(download: BbDesktopBrowserDownload) => void> = [];
  window.bbDesktop = createBbDesktopApi(desktopInfo, {
    ...createNoopDesktopBrowserApi(),
    downloadAction,
    setOverlay,
    onDownload(listener) {
      listeners.push(listener);
      return () => {};
    },
  });

  // A fresh jotai store per test: the downloads atom is module-scoped, so
  // without one the previous test's downloads leak into the next.
  const view = render(
    <Provider>
      <DownloadsHarness />
    </Provider>,
  );

  return {
    downloadAction,
    setOverlay,
    unmount: view.unmount,
    emit(download: BbDesktopBrowserDownload) {
      act(() => {
        // The subscription is renewed as state changes, and this fake's
        // unsubscribe keeps the dead listeners, so only the last one is live.
        listeners.at(-1)?.(download);
      });
    },
  };
}

function downloadsButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^Downloads/ });
}

beforeEach(() => {
  // The reporter hands finished downloads to plugins over HTTP; nothing here
  // asserts on that, but an unstubbed fetch rejects into an unhandled promise.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("browser downloads chrome", () => {
  // Requirement one: a browser that has downloaded nothing shows no button.
  it("shows no button before anything is downloaded", () => {
    renderChrome();

    expect(downloadsButton()).toBeNull();
    expect(screen.queryByRole("menu", { name: "Downloads" })).toBeNull();
  });

  it("appears once a download finishes, coloured until it is opened", () => {
    const { emit } = renderChrome();

    emit(completedDownload());

    expect(downloadsButton()?.getAttribute("aria-label")).toBe(
      "Downloads — finished",
    );

    fireEvent.click(downloadsButton() as HTMLElement);

    // Opening the list is the acknowledgement, so the colour goes.
    expect(downloadsButton()?.getAttribute("aria-label")).toBe("Downloads");
  });

  it("reports a download in flight while it runs", () => {
    const { emit } = renderChrome();

    emit(completedDownload({ savePath: null, state: "started" }));

    expect(downloadsButton()?.getAttribute("aria-label")).toBe(
      "Downloads — in progress",
    );
  });

  it("reports a failure distinctly from a success", () => {
    const { emit } = renderChrome();

    emit(completedDownload({ savePath: null, state: "interrupted" }));

    expect(downloadsButton()?.getAttribute("aria-label")).toBe(
      "Downloads — failed",
    );
  });

  it("lists the downloads behind the button, newest first", () => {
    const { emit } = renderChrome();
    emit(completedDownload({ filename: "first.pdf", id: "download-1" }));
    emit(completedDownload({ filename: "second.pdf", id: "download-2" }));

    fireEvent.click(downloadsButton() as HTMLElement);

    const rows = screen.getAllByRole("menuitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("second.pdf");
    expect(rows[1]?.textContent).toContain("first.pdf");
    // Each row states its outcome as an icon rather than as words.
    expect(screen.getAllByLabelText("Downloaded")).toHaveLength(2);
  });

  it("opens a download, and shows it in the file manager", () => {
    const { downloadAction, emit } = renderChrome();
    emit(completedDownload());
    fireEvent.click(downloadsButton() as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: "Open report.pdf" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Show report.pdf in folder" }),
    );

    const requests = downloadAction.mock.calls as unknown as Array<
      [BbDesktopBrowserDownloadActionRequest]
    >;
    expect(requests.map((call) => call[0])).toEqual([
      { action: "open", savePath: "/Users/someone/Downloads/report.pdf" },
      { action: "reveal", savePath: "/Users/someone/Downloads/report.pdf" },
    ]);
  });

  // A refused download never wrote a file, so neither action has a target.
  it("disables both actions for a download with no file", () => {
    const { emit } = renderChrome();
    emit(completedDownload({ savePath: null, state: "refused" }));

    fireEvent.click(downloadsButton() as HTMLElement);

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Open report.pdf" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Show report.pdf in folder",
      }).disabled,
    ).toBe(true);
  });

  it("closes the list on Escape", () => {
    const { emit } = renderChrome();
    emit(completedDownload());
    fireEvent.click(downloadsButton() as HTMLElement);
    expect(screen.getByRole("menu", { name: "Downloads" })).toBeTruthy();

    fireEvent.keyDown(downloadsButton() as HTMLElement, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "Downloads" })).toBeNull();
  });

  // The dropdown floats over the page, which React cannot do while a native
  // view is composited above the DOM — so the shell freezes the page to a
  // bitmap and hides it for as long as the list is open.
  it("freezes the page while the list is open, and reveals it after", () => {
    const { emit, setOverlay } = renderChrome();
    emit(completedDownload());
    setOverlay.mockClear();

    fireEvent.click(downloadsButton() as HTMLElement);
    expect(setOverlay).toHaveBeenCalledWith({
      tabId: "tab-active",
      active: true,
    });

    fireEvent.click(downloadsButton() as HTMLElement);
    expect(setOverlay).toHaveBeenLastCalledWith({
      tabId: "tab-active",
      active: false,
    });
  });

  // Leaving a tab frozen behind a panel that no longer exists would look like
  // a hung page.
  it("reveals the page if the chrome goes away while the list is open", () => {
    const { emit, setOverlay, unmount } = renderChrome();
    emit(completedDownload());
    fireEvent.click(downloadsButton() as HTMLElement);
    setOverlay.mockClear();

    unmount();

    expect(setOverlay).toHaveBeenCalledWith({
      tabId: "tab-active",
      active: false,
    });
  });

  // The page area is DOM while the list is open (that is what the freeze buys),
  // so a click on the page closes the list like any other outside click.
  it("closes on a click outside, and stays open on one inside", () => {
    const { emit } = renderChrome();
    emit(completedDownload());
    fireEvent.click(downloadsButton() as HTMLElement);

    fireEvent.mouseDown(
      screen.getByRole("menu", { name: "Downloads" }).firstChild as HTMLElement,
    );
    expect(screen.queryByRole("menu", { name: "Downloads" })).not.toBeNull();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu", { name: "Downloads" })).toBeNull();
  });

  // Both take the same strip of layout under the toolbar, so reaching for the
  // address bar has to put the list away.
  it("closes the list when the address bar takes focus", () => {
    const { emit } = renderChrome();
    emit(completedDownload());
    fireEvent.click(downloadsButton() as HTMLElement);

    fireEvent.focus(screen.getByRole("combobox"));

    expect(screen.queryByRole("menu", { name: "Downloads" })).toBeNull();
  });
});
