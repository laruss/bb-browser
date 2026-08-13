import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import {
  bbDesktopBrowserAttachRequestSchema,
  bbDesktopBrowserNavigateRequestSchema,
  bbDesktopBrowserSetBoundsRequestSchema,
  bbDesktopBrowserSetVisibleRequestSchema,
  bbDesktopBrowserDialogRespondRequestSchema,
  bbDesktopBrowserControlRequestSchema,
  bbDesktopBrowserInteractRequestSchema,
  bbDesktopBrowserObserveRequestSchema,
  bbDesktopBrowserSnapshotRequestSchema,
  bbDesktopBrowserStorageRequestSchema,
  bbDesktopBrowserTabRefSchema,
  type BbDesktopBrowserControlResult,
  type BbDesktopBrowserInteractResult,
  type BbDesktopBrowserObserveResult,
  type BbDesktopBrowserPageReadResult,
  type BbDesktopBrowserSnapshotResult,
  type BbDesktopBrowserStorageResult,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
  BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  BB_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
  BB_DESKTOP_BROWSER_CONTROL_CHANNEL,
  BB_DESKTOP_BROWSER_INTERACT_CHANNEL,
  BB_DESKTOP_BROWSER_OBSERVE_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
  BB_DESKTOP_BROWSER_STORAGE_CHANNEL,
  BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_CHANNEL,
} from "./desktop-browser-ipc.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";

interface DesktopBrowserTabCommandArgs {
  hostWindow: BrowserWindow;
  tabId: string;
}

type DesktopBrowserTabCommand = (args: DesktopBrowserTabCommandArgs) => void;

interface RegisterDesktopBrowserTabCommandArgs {
  channel: string;
  run: DesktopBrowserTabCommand;
}

function hostWindowFromBrowserIpcEvent(
  event: IpcMainEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerTabCommand(args: RegisterDesktopBrowserTabCommandArgs): void {
  ipcMain.on(args.channel, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    args.run({ hostWindow, tabId: parsed.data.tabId });
  });
}

export function registerDesktopBrowserIpc(
  manager: DesktopBrowserViewManager,
): void {
  // Every browser command is renderer -> main fire-and-forget; navigation state
  // flows back over `BB_DESKTOP_BROWSER_STATE_CHANNEL`. Each handler resolves
  // its own host window from the sender, so multi-window is safe, and zod-parses
  // the untrusted-content-adjacent payload before touching the view.
  ipcMain.on(BB_DESKTOP_BROWSER_ATTACH_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserAttachRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.attach({ hostWindow, request: parsed.data });
  });

  ipcMain.on(BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = bbDesktopBrowserNavigateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.navigate({ hostWindow, request: parsed.data });
  });

  ipcMain.on(
    BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserSetBoundsRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setBounds({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = bbDesktopBrowserSetVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setVisible({ hostWindow, request: parsed.data });
    },
  );

  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_DETACH_CHANNEL,
    run: (args) => manager.detach(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
    run: (args) => manager.goBack(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
    run: (args) => manager.goForward(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
    run: (args) => manager.reload(args),
  });
  registerTabCommand({
    channel: BB_DESKTOP_BROWSER_STOP_CHANNEL,
    run: (args) => manager.stop(args),
  });

  // The browser channels that answer use `handle` rather than `on`, and must
  // never throw: a rejection crosses `invoke` as a mangled "Error invoking
  // remote method …" string carrying nothing the caller could branch on, so
  // every failure — including an unresolvable window and a malformed payload —
  // comes back as a typed `ok: false` instead.
  ipcMain.handle(
    BB_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<BbDesktopBrowserPageReadResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await manager.readPage({
          hostWindow,
          tabId: parsed.data.tabId,
        });
      } catch {
        return { ok: false, reason: "unreadable" };
      }
    },
  );

  // Same request/response discipline as the page read: a typed refusal, never a
  // rejection, so the renderer can tell "no view" from "DevTools has this tab".
  ipcMain.handle(
    BB_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<BbDesktopBrowserSnapshotResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed = bbDesktopBrowserSnapshotRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await manager.snapshot({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Acting on a page. A malformed payload answers `failed` rather than
  // `no-view`: the tab is not the problem, the request is, and telling the
  // caller to go activate a tab would send it after the wrong fix.
  ipcMain.handle(
    BB_DESKTOP_BROWSER_INTERACT_CHANNEL,
    async (event, payload: unknown): Promise<BbDesktopBrowserInteractResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed = bbDesktopBrowserInteractRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not an interaction this browser understands.",
        };
      }
      try {
        return await manager.interact({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Looking at a page. Same discipline as the interact channel: a malformed
  // payload is the request's fault, not the tab's.
  ipcMain.handle(
    BB_DESKTOP_BROWSER_OBSERVE_CHANNEL,
    async (event, payload: unknown): Promise<BbDesktopBrowserObserveResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed = bbDesktopBrowserObserveRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not an observation this browser understands.",
        };
      }
      try {
        return await manager.observe({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Cookies and web storage. Same discipline again, and the same reason a
  // malformed payload is not `no-view`.
  ipcMain.handle(
    BB_DESKTOP_BROWSER_STORAGE_CHANNEL,
    async (event, payload: unknown): Promise<BbDesktopBrowserStorageResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed = bbDesktopBrowserStorageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not a storage request this browser understands.",
        };
      }
      try {
        return await manager.storage({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Direct control of a tab. Same discipline once more; the refusals this one
  // can carry are wider, but a request that did not parse is still the
  // request's fault.
  ipcMain.handle(
    BB_DESKTOP_BROWSER_CONTROL_CHANNEL,
    async (event, payload: unknown): Promise<BbDesktopBrowserControlResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed = bbDesktopBrowserControlRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not a control request this browser understands.",
        };
      }
      try {
        return await manager.control({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Answering a dialog reports whether there was one to answer, so a caller can
  // tell "dismissed it" from "a human got there first".
  ipcMain.handle(
    BB_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
    async (event, payload: unknown): Promise<boolean> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return false;
      }
      const parsed =
        bbDesktopBrowserDialogRespondRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return false;
      }
      try {
        return await manager.respondToDialog({
          hostWindow,
          request: parsed.data,
        });
      } catch {
        return false;
      }
    },
  );
}
