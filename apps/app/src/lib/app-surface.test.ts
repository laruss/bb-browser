import { APP_SURFACE_HEADER_NAME } from "@patcher/config/app-surface";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPatcherDesktopApi } from "@/test/patcher-desktop-test-utils";
import { appSurfaceRequestInit, getAppSurface } from "./app-surface";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
} as const;

describe("app surface request metadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults browser requests to the web app surface", () => {
    const init = appSurfaceRequestInit({
      headers: { "x-existing": "kept" },
    });

    const headers = new Headers(init.headers);
    expect(getAppSurface()).toBe("web");
    expect(headers.get(APP_SURFACE_HEADER_NAME)).toBe("web");
    expect(headers.get("x-existing")).toBe("kept");
  });

  // Both global names, because the shell exposes the same object under each and
  // the accessor prefers `patcherDesktop`. A test that only ever installs the
  // frozen `bbDesktop` passes even if the new name is read wrongly.
  it.each(["bbDesktop", "patcherDesktop"] as const)(
    "marks Electron preload requests as desktop via window.%s",
    (globalName) => {
      vi.stubGlobal("window", {
        [globalName]: createPatcherDesktopApi(desktopInfo),
      });

      const init = appSurfaceRequestInit();

      expect(getAppSurface()).toBe("desktop");
      expect(new Headers(init.headers).get(APP_SURFACE_HEADER_NAME)).toBe(
        "desktop",
      );
    },
  );
});
