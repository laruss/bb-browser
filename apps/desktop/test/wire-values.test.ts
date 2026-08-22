import { describe, expect, it, vi } from "vitest";
import * as browserIpc from "../src/desktop-browser-ipc.js";
import * as defaultBrowser from "../src/desktop-default-browser.js";
import * as existingServerDialogIpc from "../src/existing-server-dialog-ipc.js";
import * as serverUrlDialogIpc from "../src/server-url-dialog-ipc.js";
import * as updateIpc from "../src/desktop-update-ipc.js";
import * as windowCommandIpc from "../src/desktop-window-command-ipc.js";
import { PATCHER_BROWSER_PARTITION } from "../src/desktop-browser-view.js";

/**
 * The values in this file are read by name at a boundary no type checker
 * crosses: an IPC channel is a string agreed between the main process and a
 * preload, the partition is a directory name under `userData`, and the
 * page-script global is what plugin-authored code types. Rename one and every
 * build still passes — the failure arrives as a channel nobody answers, a
 * profile that lost its cookies, or `patcher is not defined` inside a website.
 *
 * The rename audit cannot see it either: replacing `bb` with `patcher` in a
 * value removes the token the forward scan looks for and adds one the reverse
 * scan ignores. So the guard is here, stated as the value rather than as a
 * shape, and a diff that changes one of these has to change this file too.
 */
describe("desktop wire values", () => {
  const channelModules = {
    "desktop-browser-ipc": browserIpc,
    "desktop-default-browser": defaultBrowser,
    "desktop-update-ipc": updateIpc,
    "desktop-window-command-ipc": windowCommandIpc,
    "existing-server-dialog-ipc": existingServerDialogIpc,
    "server-url-dialog-ipc": serverUrlDialogIpc,
  };

  it.each(Object.entries(channelModules))(
    "names every %s channel under the patcher-desktop prefix",
    (_moduleName, module) => {
      const channels = Object.entries(module).filter(
        ([name, value]) =>
          name.endsWith("_CHANNEL") && typeof value === "string",
      ) as [string, string][];

      expect(channels.length).toBeGreaterThan(0);
      for (const [name, value] of channels) {
        expect(value, `${name} = ${value}`).toMatch(/^patcher-desktop:/u);
      }
    },
  );

  it("keeps the browsed-page partition on its own name", () => {
    expect(PATCHER_BROWSER_PARTITION).toBe("persist:patcher-browser");
  });

  it("exposes the page-script API to a plugin world as `patcher`", async () => {
    const exposed: { worldId: number; name: string }[] = [];
    vi.doMock("electron", () => ({
      contextBridge: {
        exposeInIsolatedWorld(worldId: number, name: string): void {
          exposed.push({ worldId, name });
        },
      },
      ipcRenderer: {
        // The synchronous bootstrap the preload asks for at document start.
        sendSync: () => ({
          worlds: [{ pluginId: "plugin_a", worldId: 17, scripts: [] }],
        }),
      },
      webFrame: {
        executeJavaScriptInIsolatedWorld: async () => undefined,
      },
    }));

    vi.resetModules();
    await import("../src/page-script-preload.js");

    expect(exposed).toEqual([{ worldId: 17, name: "patcher" }]);
    vi.doUnmock("electron");
  });
});
