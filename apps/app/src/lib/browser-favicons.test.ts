// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  browserFaviconsStorage,
  EMPTY_BROWSER_FAVICONS,
  getBrowserFaviconsStorageKey,
  parseBrowserFavicons,
  setBrowserFavicon,
} from "./browser-favicons";

const ICON = "data:image/png;base64,aWNvbg==";

afterEach(() => {
  window.sessionStorage.removeItem(getBrowserFaviconsStorageKey());
});

describe("setBrowserFavicon", () => {
  it("records an icon and forgets one", () => {
    const withIcon = setBrowserFavicon(EMPTY_BROWSER_FAVICONS, {
      dataUrl: ICON,
      tabId: "tab-1",
    });
    expect(withIcon).toEqual({ "tab-1": ICON });
    expect(
      setBrowserFavicon(withIcon, { dataUrl: null, tabId: "tab-1" }),
    ).toEqual({});
  });

  // The shell pushes on every navigation, most of them to the same icon.
  it("returns the same map when nothing changed", () => {
    const withIcon = setBrowserFavicon(EMPTY_BROWSER_FAVICONS, {
      dataUrl: ICON,
      tabId: "tab-1",
    });
    expect(setBrowserFavicon(withIcon, { dataUrl: ICON, tabId: "tab-1" })).toBe(
      withIcon,
    );
    expect(setBrowserFavicon(withIcon, { dataUrl: null, tabId: "tab-2" })).toBe(
      withIcon,
    );
  });
});

describe("parseBrowserFavicons", () => {
  it("falls back rather than trusting a store it cannot read", () => {
    expect(parseBrowserFavicons(null, EMPTY_BROWSER_FAVICONS)).toEqual({});
    expect(parseBrowserFavicons("{", EMPTY_BROWSER_FAVICONS)).toEqual({});
    expect(parseBrowserFavicons("[]", EMPTY_BROWSER_FAVICONS)).toEqual({});
  });

  // What is stored here came from a page, so the cap the shell enforces on the
  // wire has to survive a round trip through storage — a hand-edited store must
  // not be able to smuggle in an `http:` URL the strip would then fetch.
  it("refuses a value that is not a bounded data URI", () => {
    expect(
      parseBrowserFavicons(
        JSON.stringify({ "tab-1": "https://example.com/icon.png" }),
        EMPTY_BROWSER_FAVICONS,
      ),
    ).toEqual({});
    expect(
      parseBrowserFavicons(
        JSON.stringify({
          "tab-1": `data:image/png;base64,${"A".repeat(2_000_000)}`,
        }),
        EMPTY_BROWSER_FAVICONS,
      ),
    ).toEqual({});
  });
});

// The bug this storage exists for: reloading the renderer (Cmd+R) throws away
// everything the app held while the shell keeps its tabs and their loaded pages,
// and nothing re-announces an icon for a page that is already loaded. Held in
// React, every tab came back blank and stayed blank until it was navigated
// again. A reload re-evaluates this module, and `getOnInit` reads the store
// right there — so what the reload path comes down to is this round trip.
describe("the icons across a reload", () => {
  const KEY = getBrowserFaviconsStorageKey();

  it("are still there for the renderer that starts over", () => {
    browserFaviconsStorage.setItem(KEY, { "tab-1": ICON });

    expect(browserFaviconsStorage.getItem(KEY, EMPTY_BROWSER_FAVICONS)).toEqual(
      {
        "tab-1": ICON,
      },
    );
  });

  it("do not outlive the window, which is what session-scoped means", () => {
    browserFaviconsStorage.setItem(KEY, { "tab-1": ICON });

    // What the browser itself does when the window goes away.
    window.sessionStorage.clear();

    expect(browserFaviconsStorage.getItem(KEY, EMPTY_BROWSER_FAVICONS)).toEqual(
      {},
    );
  });
});
