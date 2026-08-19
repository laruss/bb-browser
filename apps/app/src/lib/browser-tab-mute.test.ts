import { describe, expect, it } from "vitest";
import {
  EMPTY_BROWSER_MUTED_TABS,
  parseBrowserMutedTabs,
  withBrowserTabMuted,
} from "./browser-tab-mute";

describe("browser tab mute", () => {
  it("mutes and unmutes a tab", () => {
    const muted = withBrowserTabMuted(EMPTY_BROWSER_MUTED_TABS, {
      muted: true,
      tabId: "a",
    });

    expect([...muted]).toEqual(["a"]);
    expect([
      ...withBrowserTabMuted(muted, { muted: false, tabId: "a" }),
    ]).toEqual([]);
  });

  it("returns the same set when nothing changes", () => {
    const muted = withBrowserTabMuted(EMPTY_BROWSER_MUTED_TABS, {
      muted: true,
      tabId: "a",
    });

    expect(withBrowserTabMuted(muted, { muted: true, tabId: "a" })).toBe(muted);
    expect(withBrowserTabMuted(muted, { muted: false, tabId: "b" })).toBe(
      muted,
    );
  });

  // The round trip a renderer reload makes: the views stay muted, so the strip
  // has to come back knowing which ones.
  it("restores a stored set, and falls back for anything unreadable", () => {
    expect([
      ...parseBrowserMutedTabs('["a","b"]', EMPTY_BROWSER_MUTED_TABS),
    ]).toEqual(["a", "b"]);
    expect(parseBrowserMutedTabs(null, EMPTY_BROWSER_MUTED_TABS)).toBe(
      EMPTY_BROWSER_MUTED_TABS,
    );
    expect(parseBrowserMutedTabs("{not json", EMPTY_BROWSER_MUTED_TABS)).toBe(
      EMPTY_BROWSER_MUTED_TABS,
    );
    expect(parseBrowserMutedTabs('[""]', EMPTY_BROWSER_MUTED_TABS)).toBe(
      EMPTY_BROWSER_MUTED_TABS,
    );
  });
});
