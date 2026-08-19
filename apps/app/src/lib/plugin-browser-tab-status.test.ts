import { afterEach, describe, expect, it } from "vitest";
import {
  clearPluginBrowserTabStatuses,
  clearPluginBrowserTabStatusesByOwner,
  forgetPluginBrowserTabStatuses,
  getPluginBrowserTabStatuses,
  resetPluginBrowserTabStatusesForTest,
  setPluginBrowserTabStatus,
} from "./plugin-browser-tab-status";

const SYNCING = { icon: "Zap", label: "Syncing" } as const;

afterEach(() => {
  resetPluginBrowserTabStatusesForTest();
});

describe("plugin browser tab status", () => {
  it("marks a tab and clears the mark", () => {
    setPluginBrowserTabStatus("browser:a", "notes", SYNCING);

    expect(getPluginBrowserTabStatuses().get("browser:a")).toEqual(SYNCING);

    setPluginBrowserTabStatus("browser:a", "notes", null);
    expect(getPluginBrowserTabStatuses().has("browser:a")).toBe(false);
  });

  // The strip reads the whole map through `useSyncExternalStore`, which compares
  // snapshots by identity: a fresh map per read would re-render forever, and a
  // stale one after a write would never re-render at all.
  it("hands out one snapshot until something changes", () => {
    const first = getPluginBrowserTabStatuses();
    expect(getPluginBrowserTabStatuses()).toBe(first);

    setPluginBrowserTabStatus("browser:a", "notes", SYNCING);
    const second = getPluginBrowserTabStatuses();
    expect(second).not.toBe(first);
    expect(getPluginBrowserTabStatuses()).toBe(second);

    // Clearing a mark nobody set changes nothing, so neither does the snapshot.
    setPluginBrowserTabStatus("browser:b", "notes", null);
    expect(getPluginBrowserTabStatuses()).toBe(second);
  });

  it("clears one plugin's marks without touching another's", () => {
    setPluginBrowserTabStatus("browser:a", "notes", SYNCING);
    setPluginBrowserTabStatus("browser:b", "notes", SYNCING);
    setPluginBrowserTabStatus("browser:c", "other", {
      icon: "Clock",
      label: "Waiting",
    });

    clearPluginBrowserTabStatuses("notes");

    expect([...getPluginBrowserTabStatuses().keys()]).toEqual(["browser:c"]);
  });

  it("clears one generation's marks without touching its replacement's", () => {
    const oldGeneration = Symbol("old");
    const newGeneration = Symbol("new");
    setPluginBrowserTabStatus("browser:a", "notes", SYNCING, oldGeneration);
    setPluginBrowserTabStatus(
      "browser:b",
      "notes",
      { icon: "Clock", label: "Fresh" },
      newGeneration,
    );

    clearPluginBrowserTabStatusesByOwner(oldGeneration);

    expect([...getPluginBrowserTabStatuses().keys()]).toEqual(["browser:b"]);
  });

  // Tab ids are never reused, so a closed tab's mark is dead weight.
  it("forgets every mark on a closed tab", () => {
    setPluginBrowserTabStatus("browser:a", "notes", SYNCING);
    setPluginBrowserTabStatus("browser:a", "other", SYNCING);

    forgetPluginBrowserTabStatuses("browser:a");

    expect(getPluginBrowserTabStatuses().size).toBe(0);
  });
});
