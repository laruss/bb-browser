import { contextBridge, ipcRenderer, webFrame } from "electron";
import { appCommandIdSchema } from "@bb/domain";
import {
  bbDesktopBrowserCaptureFullPageResultSchema,
  bbDesktopBrowserDownloadActionResultSchema,
  bbDesktopBrowserContextMenuInvokeSchema,
  bbDesktopBrowserSearchSelectionSchema,
  bbDesktopBrowserDownloadSchema,
  bbDesktopBrowserFaviconSchema,
  bbDesktopBrowserFindResultSchema,
  bbDesktopBrowserInteractResultSchema,
  bbDesktopBrowserControlResultSchema,
  bbDesktopBrowserRecordResultSchema,
  bbDesktopBrowserObserveResultSchema,
  bbDesktopBrowserOpenTabRequestSchema,
  bbDesktopBrowserPageReadResultSchema,
  bbDesktopBrowserScopedOpenTabRequestSchema,
  bbDesktopBrowserDialogSchema,
  bbDesktopBrowserPagePromptSchema,
  bbDesktopBrowserPopupSchema,
  bbDesktopBrowserDevToolsStateSchema,
  bbDesktopBrowserSnapshotResultSchema,
  bbDesktopBrowserSnapshotSchema,
  bbDesktopBrowserStateSchema,
  bbDesktopBrowserStorageResultSchema,
  bbDesktopInfoSchema,
  bbDesktopWindowStateSchema,
  type BbDesktopApi,
  type BbDesktopAppCommandHandler,
  type BbDesktopBrowserApi,
  type BbDesktopBrowserDownloadActionRequest,
  type BbDesktopBrowserSetOverlayRequest,
  type BbDesktopBrowserSetFullscreenRequest,
  type BbDesktopBrowserDownloadActionResult,
  type BbDesktopBrowserDownloadHandler,
  type BbDesktopBrowserContextMenuInvokeHandler,
  type BbDesktopBrowserContextMenuItems,
  type BbDesktopBrowserSearchSelectionHandler,
  type BbDesktopBrowserFaviconHandler,
  type BbDesktopBrowserFindRequest,
  type BbDesktopBrowserFindResultHandler,
  type BbDesktopBrowserCaptureFullPageResult,
  type BbDesktopBrowserInteractResult,
  type BbDesktopBrowserControlResult,
  type BbDesktopBrowserRecordResult,
  type BbDesktopBrowserObserveResult,
  type BbDesktopBrowserOpenTabHandler,
  type BbDesktopBrowserPageReadResult,
  type BbDesktopBrowserScopedOpenTabHandler,
  type BbDesktopBrowserDialogHandler,
  type BbDesktopBrowserPagePromptHandler,
  type BbDesktopBrowserPopupHandler,
  type BbDesktopBrowserPopupTabs,
  type BbDesktopBrowserDevToolsRequest,
  type BbDesktopBrowserDevToolsStateHandler,
  type BbDesktopBrowserSnapshotResult,
  type BbDesktopBrowserSnapshotHandler,
  type BbDesktopBrowserStateHandler,
  type BbDesktopBrowserStorageResult,
  type BbDesktopBrowserUnsubscribe,
  type BbDesktopBrowserViewBounds,
  type BbDesktopCloseWindowRequestHandler,
  type BbDesktopInfo,
  type BbDesktopInfoChangeHandler,
  type BbDesktopInfoUnsubscribe,
  type BbDesktopOpenNewTabHandler,
  type BbDesktopTheme,
  type BbDesktopWindowState,
  type BbDesktopWindowStateChangeHandler,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  BB_DESKTOP_GET_INFO_CHANNEL,
  BB_DESKTOP_INFO_CHANGED_CHANNEL,
  BB_DESKTOP_INSTALL_UPDATE_CHANNEL,
  BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
  BB_DESKTOP_SET_THEME_CHANNEL,
} from "./desktop-update-ipc.js";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
  BB_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL,
  BB_DESKTOP_BROWSER_CONTEXT_MENU_INVOKE_CHANNEL,
  BB_DESKTOP_BROWSER_SEARCH_SELECTION_CHANNEL,
  BB_DESKTOP_BROWSER_SET_CONTEXT_MENU_ITEMS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL,
  BB_DESKTOP_BROWSER_SET_FULLSCREEN_CHANNEL,
  BB_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
  BB_DESKTOP_BROWSER_FAVICON_CHANNEL,
  BB_DESKTOP_BROWSER_FIND_CHANNEL,
  BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  BB_DESKTOP_BROWSER_CONTROL_CHANNEL,
  BB_DESKTOP_BROWSER_RECORD_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
  BB_DESKTOP_BROWSER_OBSERVE_CHANNEL,
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
  BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_STORAGE_CHANNEL,
  BB_DESKTOP_BROWSER_DIALOG_CHANNEL,
  BB_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
  BB_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  BB_DESKTOP_BROWSER_PAGE_PROMPT_RESPOND_CHANNEL,
  BB_DESKTOP_BROWSER_POPUP_CHANNEL,
  BB_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_DEV_TOOLS_CHANNEL,
  BB_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
  BB_DESKTOP_BROWSER_INTERACT_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  BB_DESKTOP_BROWSER_STATE_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  BB_DESKTOP_APP_COMMAND_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  BB_DESKTOP_GET_WINDOW_STATE_CHANNEL,
  BB_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
} from "./desktop-window-command-ipc.js";
import {
  BB_DESKTOP_SPELLCHECK_GLOBAL_NAME,
  type BbDesktopSpellcheckApi,
} from "./desktop-spellcheck-contract.js";

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

function createInitialDesktopInfo(): BbDesktopInfo {
  return {
    downloadState: "idle",
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: getDesktopVersion(process.env.BB_DESKTOP_VERSION),
  };
}

function createInitialDesktopWindowState(): BbDesktopWindowState {
  return {
    isFullScreen: false,
  };
}

const listeners = new Set<BbDesktopInfoChangeHandler>();
const appCommandListeners = new Set<BbDesktopAppCommandHandler>();
const windowStateListeners = new Set<BbDesktopWindowStateChangeHandler>();
let currentInfo = createInitialDesktopInfo();
let currentWindowState = createInitialDesktopWindowState();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(currentInfo);
  }
}

function notifyWindowStateListeners(): void {
  for (const listener of windowStateListeners) {
    listener(currentWindowState);
  }
}

function applyDesktopInfoPayload(payload: unknown): BbDesktopInfo | null {
  const parsed = bbDesktopInfoSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  currentInfo = parsed.data;
  notifyListeners();
  return currentInfo;
}

function applyDesktopWindowStatePayload(
  payload: unknown,
): BbDesktopWindowState | null {
  const parsed = bbDesktopWindowStateSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  currentWindowState = parsed.data;
  notifyWindowStateListeners();
  return currentWindowState;
}

async function invokeDesktopInfo(channel: string): Promise<BbDesktopInfo> {
  try {
    const payload: unknown = await ipcRenderer.invoke(channel);
    return applyDesktopInfoPayload(payload) ?? currentInfo;
  } catch {
    return currentInfo;
  }
}

async function invokeDesktopWindowState(): Promise<BbDesktopWindowState> {
  try {
    const payload: unknown = await ipcRenderer.invoke(
      BB_DESKTOP_GET_WINDOW_STATE_CHANNEL,
    );
    return applyDesktopWindowStatePayload(payload) ?? currentWindowState;
  } catch {
    return currentWindowState;
  }
}

async function invokeInstallUpdate(): Promise<void> {
  try {
    await ipcRenderer.invoke(BB_DESKTOP_INSTALL_UPDATE_CHANNEL);
  } catch {
    return;
  }
}

const browserStateListeners = new Set<BbDesktopBrowserStateHandler>();
const browserOpenTabListeners = new Set<BbDesktopBrowserOpenTabHandler>();
const browserScopedOpenTabListeners =
  new Set<BbDesktopBrowserScopedOpenTabHandler>();
const browserSnapshotListeners = new Set<BbDesktopBrowserSnapshotHandler>();
const browserFaviconListeners = new Set<BbDesktopBrowserFaviconHandler>();
const browserDownloadListeners = new Set<BbDesktopBrowserDownloadHandler>();
const browserFindResultListeners = new Set<BbDesktopBrowserFindResultHandler>();
const browserSearchSelectionListeners =
  new Set<BbDesktopBrowserSearchSelectionHandler>();
const browserContextMenuInvokeListeners =
  new Set<BbDesktopBrowserContextMenuInvokeHandler>();
const browserDialogListeners = new Set<BbDesktopBrowserDialogHandler>();
const browserPagePromptListeners = new Set<BbDesktopBrowserPagePromptHandler>();
const browserPopupListeners = new Set<BbDesktopBrowserPopupHandler>();
const browserDevToolsListeners =
  new Set<BbDesktopBrowserDevToolsStateHandler>();
const closeWindowRequestListeners =
  new Set<BbDesktopCloseWindowRequestHandler>();
const openNewTabListeners = new Set<BbDesktopOpenNewTabHandler>();

function normalizeSpellcheckWord(word: string): string | null {
  const normalized = word.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    /\s/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

const bbSpellcheckApi: BbDesktopSpellcheckApi = {
  getCorrectionContext(word) {
    const normalized = normalizeSpellcheckWord(word);
    if (normalized === null || !webFrame.isWordMisspelled(normalized)) {
      return null;
    }
    return {
      dictionarySuggestions: webFrame.getWordSuggestions(normalized),
      misspelledWord: normalized,
    };
  },
};

function browserViewBoundsAtWindowScale(
  bounds: BbDesktopBrowserViewBounds,
): BbDesktopBrowserViewBounds {
  const zoomFactor = webFrame.getZoomFactor();
  if (zoomFactor === 1) {
    return bounds;
  }
  const x = Math.round(bounds.x * zoomFactor);
  const y = Math.round(bounds.y * zoomFactor);
  return {
    x,
    y,
    width: Math.max(0, Math.round((bounds.x + bounds.width) * zoomFactor) - x),
    height: Math.max(
      0,
      Math.round((bounds.y + bounds.height) * zoomFactor) - y,
    ),
  };
}

const bbBrowserApi: BbDesktopBrowserApi = {
  attach(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_ATTACH_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  detach(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_DETACH_CHANNEL, { tabId });
  },
  navigate(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL, request);
  },
  goBack(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_GO_BACK_CHANNEL, { tabId });
  },
  goForward(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL, { tabId });
  },
  reload(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_RELOAD_CHANNEL, { tabId });
  },
  stop(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_STOP_CHANNEL, { tabId });
  },
  setBounds(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  setVisible(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL, request);
  },
  onState(listener): BbDesktopBrowserUnsubscribe {
    browserStateListeners.add(listener);
    return () => {
      browserStateListeners.delete(listener);
    };
  },
  onOpenTab(listener): BbDesktopBrowserUnsubscribe {
    browserOpenTabListeners.add(listener);
    return () => {
      browserOpenTabListeners.delete(listener);
    };
  },
  onScopedOpenTab(listener): BbDesktopBrowserUnsubscribe {
    browserScopedOpenTabListeners.add(listener);
    return () => {
      browserScopedOpenTabListeners.delete(listener);
    };
  },
  onSnapshot(listener): BbDesktopBrowserUnsubscribe {
    browserSnapshotListeners.add(listener);
    return () => {
      browserSnapshotListeners.delete(listener);
    };
  },
  onFavicon(listener): BbDesktopBrowserUnsubscribe {
    browserFaviconListeners.add(listener);
    return () => {
      browserFaviconListeners.delete(listener);
    };
  },
  onDownload(listener): BbDesktopBrowserUnsubscribe {
    browserDownloadListeners.add(listener);
    return () => {
      browserDownloadListeners.delete(listener);
    };
  },
  setContextMenuItems(request: BbDesktopBrowserContextMenuItems): void {
    ipcRenderer.send(
      BB_DESKTOP_BROWSER_SET_CONTEXT_MENU_ITEMS_CHANNEL,
      request,
    );
  },
  onContextMenuInvoke(listener): BbDesktopBrowserUnsubscribe {
    browserContextMenuInvokeListeners.add(listener);
    return () => {
      browserContextMenuInvokeListeners.delete(listener);
    };
  },
  onSearchSelection(listener): BbDesktopBrowserUnsubscribe {
    browserSearchSelectionListeners.add(listener);
    return () => {
      browserSearchSelectionListeners.delete(listener);
    };
  },
  setOverlay(request: BbDesktopBrowserSetOverlayRequest): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL, request);
  },
  setFullscreen(request: BbDesktopBrowserSetFullscreenRequest): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_FULLSCREEN_CHANNEL, request);
  },
  find(request: BbDesktopBrowserFindRequest): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_FIND_CHANNEL, request);
  },
  onFindResult(listener): BbDesktopBrowserUnsubscribe {
    browserFindResultListeners.add(listener);
    return () => {
      browserFindResultListeners.delete(listener);
    };
  },
  async downloadAction(
    request: BbDesktopBrowserDownloadActionRequest,
  ): Promise<BbDesktopBrowserDownloadActionResult> {
    // Same discipline as `readPage`: parse here and swallow rejections, so the
    // SPA always gets a value it can branch on.
    const failed = {
      ok: false,
      reason: "failed",
      message: "The file could not be opened.",
    } as const;
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL,
        request,
      );
      const parsed =
        bbDesktopBrowserDownloadActionResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : failed;
    } catch {
      return failed;
    }
  },
  async readPage(tabId): Promise<BbDesktopBrowserPageReadResult> {
    // Parse here and swallow rejections, the same way `invokeDesktopInfo` does:
    // the SPA gets a value it can branch on, never a transport error.
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
        { tabId },
      );
      const parsed = bbDesktopBrowserPageReadResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "unreadable" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  },
  onDialog(listener): BbDesktopBrowserUnsubscribe {
    browserDialogListeners.add(listener);
    return () => {
      browserDialogListeners.delete(listener);
    };
  },
  setPopupTabs(request: BbDesktopBrowserPopupTabs): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL, request);
  },
  setDevTools(request: BbDesktopBrowserDevToolsRequest): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_DEV_TOOLS_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  onDevToolsState(listener): BbDesktopBrowserUnsubscribe {
    browserDevToolsListeners.add(listener);
    return () => {
      browserDevToolsListeners.delete(listener);
    };
  },
  onPopup(listener): BbDesktopBrowserUnsubscribe {
    browserPopupListeners.add(listener);
    return () => {
      browserPopupListeners.delete(listener);
    };
  },
  onPagePrompt(listener): BbDesktopBrowserUnsubscribe {
    browserPagePromptListeners.add(listener);
    return () => {
      browserPagePromptListeners.delete(listener);
    };
  },
  async respondToPagePrompt(answer): Promise<boolean> {
    try {
      const answered: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_PAGE_PROMPT_RESPOND_CHANNEL,
        answer,
      );
      return answered === true;
    } catch {
      return false;
    }
  },
  async respondToDialog(request): Promise<boolean> {
    try {
      const answered: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
        request,
      );
      return answered === true;
    } catch {
      return false;
    }
  },
  async snapshot(request): Promise<BbDesktopBrowserSnapshotResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
        request,
      );
      const parsed = bbDesktopBrowserSnapshotResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async snapshotIn(request): Promise<BbDesktopBrowserSnapshotResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
        request,
      );
      const parsed = bbDesktopBrowserSnapshotResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async interact(request): Promise<BbDesktopBrowserInteractResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_INTERACT_CHANNEL,
        request,
      );
      const parsed = bbDesktopBrowserInteractResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async observe(request): Promise<BbDesktopBrowserObserveResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_OBSERVE_CHANNEL,
        request,
      );
      const parsed = bbDesktopBrowserObserveResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async captureFullPage(
    request,
  ): Promise<BbDesktopBrowserCaptureFullPageResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
        request,
      );
      const parsed =
        bbDesktopBrowserCaptureFullPageResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async storage(request): Promise<BbDesktopBrowserStorageResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_STORAGE_CHANNEL,
        request,
      );
      const parsed = bbDesktopBrowserStorageResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async control(request): Promise<BbDesktopBrowserControlResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_CONTROL_CHANNEL,
        request,
      );
      const parsed = bbDesktopBrowserControlResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async record(request): Promise<BbDesktopBrowserRecordResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_BROWSER_RECORD_CHANNEL,
        request,
      );
      const parsed = bbDesktopBrowserRecordResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
};

const bbDesktopApi: BbDesktopApi = {
  browser: bbBrowserApi,
  get lastCheckedAt() {
    return currentInfo.lastCheckedAt;
  },
  get latestVersion() {
    return currentInfo.latestVersion;
  },
  get pendingVersion() {
    return currentInfo.pendingVersion;
  },
  platform: "macos",
  get updateAvailable() {
    return currentInfo.updateAvailable;
  },
  get updateDownloaded() {
    return currentInfo.updateDownloaded;
  },
  version: currentInfo.version,
  checkForUpdates() {
    return invokeDesktopInfo(BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL);
  },
  getInfo() {
    return invokeDesktopInfo(BB_DESKTOP_GET_INFO_CHANNEL);
  },
  getWindowState() {
    return invokeDesktopWindowState();
  },
  installUpdate() {
    return invokeInstallUpdate();
  },
  onChange(listener: BbDesktopInfoChangeHandler): BbDesktopInfoUnsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onWindowStateChange(
    listener: BbDesktopWindowStateChangeHandler,
  ): BbDesktopInfoUnsubscribe {
    windowStateListeners.add(listener);
    return () => {
      windowStateListeners.delete(listener);
    };
  },
  onOpenNewTab(listener): BbDesktopInfoUnsubscribe {
    openNewTabListeners.add(listener);
    return () => {
      openNewTabListeners.delete(listener);
    };
  },
  onAppCommand(listener): BbDesktopInfoUnsubscribe {
    appCommandListeners.add(listener);
    return () => {
      appCommandListeners.delete(listener);
    };
  },
  onCloseWindowRequest(listener): BbDesktopInfoUnsubscribe {
    closeWindowRequestListeners.add(listener);
    return () => {
      closeWindowRequestListeners.delete(listener);
    };
  },
  openExternalUrl(url: string): void {
    ipcRenderer.send(BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL, url);
  },
  setTheme(theme: BbDesktopTheme): void {
    ipcRenderer.send(BB_DESKTOP_SET_THEME_CHANNEL, theme);
  },
};

ipcRenderer.on(BB_DESKTOP_INFO_CHANGED_CHANNEL, (_event, payload: unknown) => {
  applyDesktopInfoPayload(payload);
});

ipcRenderer.on(
  BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  (_event, payload: unknown) => {
    applyDesktopWindowStatePayload(payload);
  },
);

ipcRenderer.on(BB_DESKTOP_OPEN_NEW_TAB_CHANNEL, () => {
  for (const listener of openNewTabListeners) {
    listener();
  }
});

ipcRenderer.on(BB_DESKTOP_APP_COMMAND_CHANNEL, (_event, payload: unknown) => {
  const parsed = appCommandIdSchema.safeParse(payload);
  if (!parsed.success) return;
  for (const listener of appCommandListeners) {
    listener(parsed.data);
  }
});

ipcRenderer.on(BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL, () => {
  let handled = false;
  for (const listener of closeWindowRequestListeners) {
    handled = listener() || handled;
  }
  // Always answer: main closes the window on `false` and falls back to
  // closing it itself if no answer arrives in time.
  ipcRenderer.send(BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL, handled);
});

ipcRenderer.on(BB_DESKTOP_BROWSER_STATE_CHANNEL, (_event, payload: unknown) => {
  const parsed = bbDesktopBrowserStateSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }
  for (const listener of browserStateListeners) {
    listener(parsed.data);
  }
});

ipcRenderer.on(
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserOpenTabRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserOpenTabListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  (_event, payload: unknown) => {
    const parsed =
      bbDesktopBrowserScopedOpenTabRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserScopedOpenTabListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserSnapshotListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_FAVICON_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserFaviconSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserFaviconListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_CONTEXT_MENU_INVOKE_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserContextMenuInvokeSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserContextMenuInvokeListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_SEARCH_SELECTION_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserSearchSelectionSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserSearchSelectionListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserDownloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserDownloadListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserDevToolsStateSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserDevToolsListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(BB_DESKTOP_BROWSER_POPUP_CHANNEL, (_event, payload: unknown) => {
  const parsed = bbDesktopBrowserPopupSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }
  for (const listener of browserPopupListeners) {
    listener(parsed.data);
  }
});

ipcRenderer.on(
  BB_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserPagePromptSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserPagePromptListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserFindResultSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserFindResultListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_DIALOG_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserDialogSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserDialogListeners) {
      listener(parsed.data);
    }
  },
);

void invokeDesktopInfo(BB_DESKTOP_GET_INFO_CHANNEL);
void invokeDesktopWindowState();

contextBridge.exposeInMainWorld(
  BB_DESKTOP_SPELLCHECK_GLOBAL_NAME,
  bbSpellcheckApi,
);
contextBridge.exposeInMainWorld("bbDesktop", bbDesktopApi);
