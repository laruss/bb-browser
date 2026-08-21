// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("sidebar section preference migration", () => {
  it("preserves manual order and collapsed groups from folder-era storage", async () => {
    window.localStorage.setItem(
      "patcher.sidebar.folderSectionOrder",
      JSON.stringify(["threads", "folder:release", "folders", "pinned"]),
    );
    window.localStorage.setItem(
      "patcher.sidebar.collapsedFolders",
      JSON.stringify(["project-a::fld_release"]),
    );

    const {
      sidebarCollapsedThreadSectionsAtom,
      sidebarManualSectionOrderAtom,
    } = await import("./sidebarCollapsedAtoms");
    const store = createStore();

    expect(store.get(sidebarManualSectionOrderAtom)).toEqual([
      "threads",
      "section:release",
      "sections",
      "pinned",
    ]);
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "project-a::fld_release",
    ]);
    expect(
      window.localStorage.getItem("patcher.sidebar.manualSectionOrder"),
    ).toBe(
      JSON.stringify(["threads", "section:release", "sections", "pinned"]),
    );
    expect(
      window.localStorage.getItem("patcher.sidebar.collapsedThreadSections"),
    ).toBe(JSON.stringify(["project-a::fld_release"]));
    expect(
      window.localStorage.getItem("patcher.sidebar.folderSectionOrder"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("patcher.sidebar.collapsedFolders"),
    ).toBeNull();
  });
});
