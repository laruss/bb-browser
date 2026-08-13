import { Menu, WebContentsView, session, type Session } from "electron";
import {
  BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserAttachRequest,
  type BbDesktopBrowserNavigateRequest,
  type BbDesktopBrowserOpenTabRequest,
  type BbDesktopBrowserScopedOpenTabRequest,
  type BbDesktopBrowserSetBoundsRequest,
  type BbDesktopBrowserSetVisibleRequest,
  type BbDesktopBrowserFavicon,
  BB_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH,
  BB_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
  type BbDesktopBrowserDialog,
  type BbDesktopBrowserDialogRespondRequest,
  BB_DESKTOP_BROWSER_MAX_COOKIES,
  BB_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH,
  BB_DESKTOP_BROWSER_MAX_PDF_BASE64_LENGTH,
  BB_DESKTOP_BROWSER_MAX_ROUTES,
  BB_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH,
  type BbDesktopBrowserCaptureFullPageRequest,
  type BbDesktopBrowserCaptureFullPageResult,
  type BbDesktopBrowserConsoleEntry,
  type BbDesktopBrowserControlRequest,
  type BbDesktopBrowserControlResult,
  type BbDesktopBrowserRecordRequest,
  type BbDesktopBrowserSnapshotInRequest,
  type BbDesktopBrowserRecordResult,
  type BbDesktopBrowserRouteState,
  type BbDesktopBrowserInteraction,
  type BbDesktopBrowserInteractRequest,
  type BbDesktopBrowserInteractResult,
  type BbDesktopBrowserNetworkEntry,
  type BbDesktopBrowserObservation,
  type BbDesktopBrowserObserveRequest,
  type BbDesktopBrowserObserveResult,
  type BbDesktopBrowserPageReadResult,
  type BbDesktopBrowserSnapshot,
  type BbDesktopBrowserSnapshotRequest,
  type BbDesktopBrowserSnapshotResult,
  type BbDesktopBrowserStorageOperation,
  type BbDesktopBrowserStorageRequest,
  type BbDesktopBrowserStorageResult,
  type BbDesktopBrowserState,
  type BbDesktopBrowserViewportBounds,
  type BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import type { AppCommandId, AppShortcutInput } from "@bb/domain";
import {
  BB_DESKTOP_BROWSER_DIALOG_CHANNEL,
  BB_DESKTOP_BROWSER_FAVICON_CHANNEL,
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  BB_DESKTOP_BROWSER_STATE_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  resolveBrowserFaviconDataUrl,
  resolveBrowserFaviconPageKey,
  selectBrowserFaviconUrl,
} from "./desktop-browser-favicon.js";
import {
  createCdpSession,
  type CdpSession,
} from "./desktop-browser-cdp.js";
import {
  buildBrowserSnapshot,
  findBrowserSnapshotRoot,
  type AxNode,
} from "./desktop-browser-snapshot.js";
import {
  BB_BROWSER_ACTIONABILITY_SCRIPT,
  BB_BROWSER_ACTION_POLL_INTERVAL_MS,
  BB_BROWSER_ACTION_TIMEOUT_MS,
  BB_BROWSER_AUTOMATION_WORLD_NAME,
  BB_BROWSER_PREPARE_FILL_SCRIPT,
  BB_BROWSER_READ_CHECKED_SCRIPT,
  BB_BROWSER_SELECT_OPTION_SCRIPT,
  parseBrowserActionProbe,
  parseBrowserScriptOutcome,
  type BrowserActionBlockedReason,
} from "./desktop-browser-actions.js";
import {
  CDP_MODIFIER_ALT,
  CDP_MODIFIER_CONTROL,
  CDP_MODIFIER_META,
  CDP_MODIFIER_SHIFT,
  characterKeyEvent,
  parseBrowserKeyChord,
  type BrowserKeyEvent,
} from "./desktop-browser-keyboard.js";
import {
  BB_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT,
  parseBrowserCaptureRegion,
} from "./desktop-browser-capture.js";
import {
  BB_BROWSER_OBSERVATION_BUFFER_SIZE,
  BrowserObservationLog,
  toBrowserConsoleEntry,
  toBrowserNetworkEntry,
  type BrowserConsoleMessageDetails,
  type BrowserNetworkRequestDetails,
} from "./desktop-browser-observe.js";
import {
  BB_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
  BB_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
  BB_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
  parseBrowserPageReadContent,
} from "./desktop-browser-page-read.js";
import {
  formatBrowserEvalValue,
  matchBrowserRoute,
  toBrowserFulfillHeaders,
} from "./desktop-browser-control.js";
import {
  BB_BROWSER_SCREENCAST_MAX_HEIGHT,
  BB_BROWSER_SCREENCAST_MAX_WIDTH,
  BB_BROWSER_SCREENCAST_QUALITY,
  BrowserVideoRecording,
} from "./desktop-browser-video.js";
import {
  buildBrowserStorageScript,
  parseBrowserStorageCounts,
  parseBrowserStorageItems,
  readBrowserStorageScriptError,
  toBrowserCookie,
  toBrowserSessionCookieDetails,
} from "./desktop-browser-storage.js";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
  localRequestOriginKey,
  resolveRequestingFrameLocalOriginKey,
  resolveWindowOpenAction,
  shouldBlockBrowserRequest,
} from "./desktop-browser-policy.js";

// At most this many popup → in-panel tabs may be spawned per view in a sliding
// window, so a hostile page cannot flood the panel with tabs.
const POPUP_RATE_WINDOW_MS = 10_000;
const POPUP_RATE_MAX_IN_WINDOW = 3;

/**
 * At the start of a resize burst the view stays visible until its snapshot
 * capture resolves (capturing a hidden view is unreliable). This cap bounds
 * how long a stalled capture may leave the stale view on screen.
 */
const RESIZE_SNAPSHOT_HIDE_CAP_MS = 80;
/** Placeholder quality: transient, stretched during the drag — favor size. */
const RESIZE_SNAPSHOT_JPEG_QUALITY = 70;

// A page can rewrite its `<link rel=icon>` from script as often as it likes, and
// each distinct URL is a fetch. The same sliding-window shape the popup limiter
// uses caps that; a page that trips it keeps whichever icon it had.
const FAVICON_FETCH_WINDOW_MS = 10_000;
const FAVICON_FETCH_MAX_IN_WINDOW = 5;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Isolated, persistent partition for the in-app browser. Cookies/storage never
 * touch the bb app session (`defaultSession`) or the user's real browser.
 */
export const BB_BROWSER_PARTITION = "persist:bb-browser";

/**
 * `did-fail-load` reports aborted main-frame loads (a user navigating away, a
 * redirect) with this code; it is not a real error and must not surface one.
 */
const ERR_ABORTED = -3;

interface BrowserViewEntry {
  view: WebContentsView;
  lastErrorText: string | null;
  currentMainFrameLocalOriginKey: string | null;
  /**
   * The last renderer-measured panel rect. The renderer is the placement
   * authority — it re-measures and pushes whenever its layout actually moves
   * the panel. This cache exists only so native window resizes can re-clamp
   * the view to the live window (see
   * {@link DesktopBrowserViewManager.clampVisibleBoundsForWindow}) without
   * losing the renderer's intent.
   */
  desiredBounds: BbDesktopBrowserViewBounds;
  popupTimestamps: number[];
  /** URL of the icon currently pushed to the renderer, for change detection. */
  faviconUrl: string | null;
  /** Page the icon was resolved for (origin); a mismatch is what makes it stale. */
  faviconPageKey: string | null;
  /** Fetch stamps behind the same sliding-window limiter the popups use. */
  faviconFetchTimestamps: number[];
  visible: boolean;
  /**
   * CDP session, attached lazily on the first automation command. Null until
   * then, deliberately: a debugger on every tab is overhead and exposure, and
   * enabling the Page domain moves this tab's dialogs off Chromium's native
   * path, which would change what ordinary browsing looks like.
   */
  cdp: CdpSession | null;
  /**
   * The dialog this tab is blocked on, once the shell owns its dialogs. The
   * view stays hidden while one is open so the app can draw over the panel —
   * a WebContentsView composites above the DOM, so there is no other way to put
   * UI in front of the page.
   */
  pendingDialog: BbDesktopBrowserDialog["dialog"];
  /** Guards one-time dialog wiring per CDP session. */
  dialogsWired: boolean;
  /**
   * Execution context of the isolated world the interaction scripts run in.
   * Null until one is created, and again after any navigation — a document
   * swap destroys the world, and reusing its id would address nothing.
   */
  automationWorldId: number | null;
  /**
   * What the tab has logged and requested since it was created. Filled from
   * ordinary `webContents` and `webRequest` events rather than from CDP, so a
   * tab nobody has automated still has an answer — see
   * `desktop-browser-observe.ts` for why that decides the mechanism.
   */
  consoleLog: BrowserObservationLog<BbDesktopBrowserConsoleEntry>;
  networkLog: BrowserObservationLog<BbDesktopBrowserNetworkEntry>;
  /**
   * Requests this tab answers itself instead of fetching, newest first, and
   * whether it is pretending to be offline.
   *
   * Both live only as long as the CDP session does — Chromium drops the
   * interception and the emulation when the client detaches — so both are
   * cleared with it rather than left describing a tab that is no longer routed.
   */
  routes: BbDesktopBrowserRouteState[];
  /** Guards one-time `Fetch.requestPaused` wiring per CDP session. */
  routesWired: boolean;
  /** Whether the `Fetch` domain is currently on for this tab. */
  routesEnabled: boolean;
  offline: boolean;
  /**
   * The film being taken of this tab, or null when nothing is filming. Dies
   * with the CDP session for the same reason the routes do — Chromium stops the
   * screencast when its client detaches, so a recording left here would grow no
   * further and say nothing about it.
   */
  video: BrowserVideoRecording | null;
  /** Guards one-time `Page.screencastFrame` wiring per CDP session. */
  videoWired: boolean;
  /**
   * Where the vision-mode pointer is. Chromium wants a point on every mouse
   * event, while `mousedown`/`mouseup`/`mousewheel` name none — so the last
   * `mouse-move` is the point they act at, as it is in a real browser.
   */
  mousePoint: MousePoint;
  /** `ref` → backend DOM node id from the most recent snapshot of this tab. */
  snapshotRefs: Map<string, number>;
  /**
   * Bumped whenever refs are invalidated. A command carrying a ref from an older
   * generation is refused rather than resolved against whatever holds that node
   * id now — a silently wrong click is worse than a clear "re-snapshot".
   */
  snapshotGeneration: number;
}

export type DesktopBrowserHostWebContentsPayload =
  | BbDesktopBrowserState
  | BbDesktopBrowserOpenTabRequest
  | BbDesktopBrowserScopedOpenTabRequest
  | BbDesktopBrowserSnapshot
  | BbDesktopBrowserDialog
  | BbDesktopBrowserFavicon;

export interface DesktopBrowserHostContentBounds {
  height: number;
  width: number;
}

export interface DesktopBrowserHostContentView {
  addChildView(view: WebContentsView): void;
  removeChildView(view: WebContentsView): void;
}

export interface DesktopBrowserHostWebContents {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: DesktopBrowserHostWebContentsPayload): void;
}

export interface DesktopBrowserHostWindow {
  contentView: DesktopBrowserHostContentView;
  getContentBounds(): DesktopBrowserHostContentBounds;
  isDestroyed(): boolean;
  webContents: DesktopBrowserHostWebContents;
}

export interface DispatchDesktopBrowserAppCommandArgs {
  command: AppCommandId;
  hostWebContentsId: number;
}

export interface CreateDesktopBrowserViewManagerArgs {
  dispatchAppCommand: (args: DispatchDesktopBrowserAppCommandArgs) => void;
  focusHostWebContents: (hostWebContentsId: number) => void;
  partition?: string;
  resolveAppCommand: (input: AppShortcutInput) => AppCommandId | null;
}

interface HostScopedRequestArgs<TRequest> {
  hostWindow: DesktopBrowserHostWindow;
  request: TRequest;
}

interface HostScopedTabArgs {
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
}

interface CreateEntryArgs {
  desiredBounds: BbDesktopBrowserViewBounds;
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
}

interface HostWindowViewportBoundsArgs {
  hostWindow: DesktopBrowserHostWindow;
}

interface SetEntryDesiredBoundsArgs {
  bounds: BbDesktopBrowserViewBounds;
  entry: BrowserViewEntry;
  hostWindow: DesktopBrowserHostWindow;
}

export interface DesktopBrowserViewManager {
  attach(args: HostScopedRequestArgs<BbDesktopBrowserAttachRequest>): void;
  detach(args: HostScopedTabArgs): void;
  navigate(args: HostScopedRequestArgs<BbDesktopBrowserNavigateRequest>): void;
  goBack(args: HostScopedTabArgs): void;
  goForward(args: HostScopedTabArgs): void;
  reload(args: HostScopedTabArgs): void;
  stop(args: HostScopedTabArgs): void;
  /**
   * Read the tab's rendered text and selection out of the page. The one command
   * here that answers; it never rejects, reporting every failure as a typed
   * `ok: false` so the renderer can tell "no view" from "page would not talk".
   */
  readPage(
    args: HostScopedTabArgs,
  ): Promise<BbDesktopBrowserPageReadResult>;
  /**
   * Accessibility snapshot with a ref on every interactive element — the
   * primitive the interaction commands address elements through. Attaches the
   * tab's CDP session on first use. Never rejects.
   */
  snapshot(
    args: HostScopedRequestArgs<BbDesktopBrowserSnapshotRequest>,
  ): Promise<BbDesktopBrowserSnapshotResult>;
  /** The same snapshot, of what a CSS selector matches. Never rejects. */
  snapshotIn(
    args: HostScopedRequestArgs<BbDesktopBrowserSnapshotInRequest>,
  ): Promise<BbDesktopBrowserSnapshotResult>;
  /**
   * Answer the JavaScript dialog a tab is blocked on. False when there is none —
   * including when a human answered it first.
   */
  respondToDialog(
    args: HostScopedRequestArgs<BbDesktopBrowserDialogRespondRequest>,
  ): Promise<boolean>;
  /**
   * Act on the page through a ref from the last snapshot, waiting for the
   * element to be actionable first. Never rejects.
   */
  interact(
    args: HostScopedRequestArgs<BbDesktopBrowserInteractRequest>,
  ): Promise<BbDesktopBrowserInteractResult>;
  /**
   * Look at a tab — screenshot, PDF, console log, network log — without
   * attaching the browser debugger to it. Never rejects.
   */
  observe(
    args: HostScopedRequestArgs<BbDesktopBrowserObserveRequest>,
  ): Promise<BbDesktopBrowserObserveResult>;
  /**
   * Capture the whole document, however far it scrolls. The one capture that
   * does attach the debugger — see {@link captureFullPage}. Never rejects.
   */
  captureFullPage(
    args: HostScopedRequestArgs<BbDesktopBrowserCaptureFullPageRequest>,
  ): Promise<BbDesktopBrowserCaptureFullPageResult>;
  /**
   * Read or write a tab's cookies and web storage. Attaches no debugger either,
   * and never rejects.
   */
  storage(
    args: HostScopedRequestArgs<BbDesktopBrowserStorageRequest>,
  ): Promise<BbDesktopBrowserStorageResult>;
  /**
   * Drive a tab directly — evaluate the caller's JavaScript in it, act at raw
   * coordinates, mock its network, take it offline. Never rejects.
   */
  control(
    args: HostScopedRequestArgs<BbDesktopBrowserControlRequest>,
  ): Promise<BbDesktopBrowserControlResult>;
  /**
   * Film a tab and hand the frames back when it stops. Never rejects.
   */
  record(
    args: HostScopedRequestArgs<BbDesktopBrowserRecordRequest>,
  ): Promise<BbDesktopBrowserRecordResult>;
  setBounds(
    args: HostScopedRequestArgs<BbDesktopBrowserSetBoundsRequest>,
  ): void;
  setVisible(
    args: HostScopedRequestArgs<BbDesktopBrowserSetVisibleRequest>,
  ): void;
  /**
   * Hide every visible view owned by the window for the duration of a native
   * resize burst. During an interactive window resize the host chrome
   * repaints at its own (much slower) cadence while the native views
   * composite independently — no bounds protocol keeps the two visually
   * glued, so a tracked view bleeds over neighboring UI in one direction or
   * the other. Each visible view is first captured and the bitmap pushed to
   * the renderer, which paints it inside the panel as a stand-in that scales
   * with the chrome; the view hides once its capture resolves (or after
   * {@link RESIZE_SNAPSHOT_HIDE_CAP_MS}, whichever is first). Idempotent per
   * window; renderer visibility changes made while hidden are recorded and
   * take effect on {@link endWindowResize}.
   */
  beginWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  /**
   * End a resize burst: re-apply each view's renderer-desired bounds clamped
   * to the live content bounds (bounds land before the view is shown),
   * restore renderer-declared visibility, then push a null snapshot so the
   * renderer drops its placeholder (after the reveal, so the swap never
   * flashes an empty panel). The renderer's own post-resize re-measure
   * typically lands within the caller's settle delay; if it arrives later the
   * view nudges once, which is the acceptable residue.
   */
  endWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  /**
   * Drop every view owned by a closed host window. Keyed by the host
   * `webContents.id` because the host `BrowserWindow` (and its child views) are
   * already torn down by the time `closed` fires.
   */
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
}

function browserViewKey(
  hostWindow: DesktopBrowserHostWindow,
  tabId: string,
): string {
  return `${hostWindow.webContents.id}:${tabId}`;
}

function send(
  hostWindow: DesktopBrowserHostWindow,
  channel: string,
  payload: DesktopBrowserHostWebContentsPayload,
): void {
  if (hostWindow.isDestroyed() || hostWindow.webContents.isDestroyed()) {
    return;
  }
  hostWindow.webContents.send(channel, payload);
}

function hostWindowViewportBounds(
  args: HostWindowViewportBoundsArgs,
): BbDesktopBrowserViewportBounds {
  const contentBounds = args.hostWindow.getContentBounds();
  return {
    width: contentBounds.width,
    height: contentBounds.height,
  };
}

/**
 * Apply the entry's renderer-desired rect, intersected with the live window
 * content bounds. The clamp happens HERE, against the same
 * `getContentBounds()` space native resize events re-clamp in — the renderer
 * already clamped the rect to its own layout viewport, which diverges from
 * the window content area when DevTools is docked.
 */
function applyEntryDesiredBounds(
  entry: BrowserViewEntry,
  hostWindow: DesktopBrowserHostWindow,
): void {
  entry.view.setBounds(
    clampBbDesktopBrowserViewBounds({
      bounds: entry.desiredBounds,
      viewport: hostWindowViewportBounds({ hostWindow }),
    }),
  );
}

function setEntryDesiredBounds(args: SetEntryDesiredBoundsArgs): void {
  args.entry.desiredBounds = args.bounds;
  applyEntryDesiredBounds(args.entry, args.hostWindow);
}

function clearEntryLocalOriginState(entry: BrowserViewEntry): void {
  entry.currentMainFrameLocalOriginKey = null;
}

function commitEntryMainFrameUrl(entry: BrowserViewEntry, url: string): void {
  const committedOriginKey = localRequestOriginKey(url);
  if (committedOriginKey !== null) {
    entry.currentMainFrameLocalOriginKey = committedOriginKey;
    return;
  }
  clearEntryLocalOriginState(entry);
}

function shouldBlockEntryTopLevelRequest(
  entry: BrowserViewEntry,
  url: string,
): boolean {
  if (!isAllowedBrowserUrl(url)) {
    return true;
  }
  const webContentsId = entry.view.webContents.id;
  return shouldBlockBrowserRequest({
    url,
    method: "GET",
    resourceType: "mainFrame",
    isMainFrame: true,
    targetWebContentsId: webContentsId,
    entryWebContentsId: webContentsId,
    currentMainFrameLocalOriginKey: entry.currentMainFrameLocalOriginKey,
    requestingFrameOriginKey: null,
  });
}

/**
 * Drop the refs a previous snapshot handed out; see `snapshotGeneration`.
 *
 * The isolated world goes with them: both are addressed into a document that
 * has been replaced, and a stale world id fails far from its cause.
 */
function invalidateSnapshotRefs(entry: BrowserViewEntry): void {
  entry.automationWorldId = null;
  if (entry.snapshotRefs.size === 0) {
    return;
  }
  entry.snapshotRefs.clear();
  entry.snapshotGeneration += 1;
}

type InteractionRefusalReason = Extract<
  BbDesktopBrowserInteractResult,
  { ok: false }
>["reason"];

/**
 * A refusal an interaction can answer with, thrown so the many steps of an
 * action do not each have to thread a result type back out.
 */
class InteractionRefusal extends Error {
  readonly reason: InteractionRefusalReason;

  constructor(reason: InteractionRefusalReason, message: string) {
    super(message);
    this.name = "InteractionRefusal";
    this.reason = reason;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The isolated world the interaction scripts run in.
 *
 * Same reasoning as the page-read world: a page that can see our script can
 * shadow the globals it reads, and one that can shadow `getBoundingClientRect`
 * can make an actionability check pass on an element that is nowhere near where
 * we are about to click.
 */
async function ensureAutomationWorld(
  session: CdpSession,
  entry: BrowserViewEntry,
): Promise<number> {
  if (entry.automationWorldId !== null) {
    return entry.automationWorldId;
  }
  const tree = await session.send<{ frameTree?: { frame?: { id?: string } } }>(
    "Page.getFrameTree",
  );
  const frameId = tree.frameTree?.frame?.id;
  if (typeof frameId !== "string") {
    throw new InteractionRefusal("failed", "The tab has no main frame.");
  }
  const created = await session.send<{ executionContextId?: number }>(
    "Page.createIsolatedWorld",
    { frameId, worldName: BB_BROWSER_AUTOMATION_WORLD_NAME },
  );
  if (typeof created.executionContextId !== "number") {
    throw new InteractionRefusal(
      "failed",
      "The tab would not create an automation context.",
    );
  }
  entry.automationWorldId = created.executionContextId;
  return created.executionContextId;
}

interface InteractionTarget {
  backendNodeId: number;
  objectId: string;
}

/**
 * Turn a `[ref=eN]` back into the node the snapshot recorded.
 *
 * The generation check happens here rather than per action, because every
 * ref-carrying command needs it and forgetting it in one branch would be a
 * silently-wrong click rather than a visible failure.
 */
function lookupSnapshotNode(
  entry: BrowserViewEntry,
  ref: string,
  generation: number | undefined,
): number {
  if (generation !== undefined && generation !== entry.snapshotGeneration) {
    throw new InteractionRefusal(
      "stale-refs",
      "The page has changed since that snapshot. Snapshot it again.",
    );
  }
  const backendNodeId = entry.snapshotRefs.get(ref);
  if (backendNodeId === undefined) {
    throw new InteractionRefusal(
      "unknown-ref",
      `No element ${ref} in the current snapshot of this tab.`,
    );
  }
  return backendNodeId;
}

/** Resolve a ref into an object the interaction scripts can be called on. */
async function resolveInteractionTarget(
  session: CdpSession,
  entry: BrowserViewEntry,
  ref: string,
  generation: number | undefined,
): Promise<InteractionTarget> {
  const backendNodeId = lookupSnapshotNode(entry, ref, generation);
  const worldId = await ensureAutomationWorld(session, entry);
  const resolved = await session
    .send<{ object?: { objectId?: string } }>("DOM.resolveNode", {
      backendNodeId,
      executionContextId: worldId,
    })
    .catch(() => null);
  const objectId = resolved?.object?.objectId;
  if (typeof objectId !== "string") {
    throw new InteractionRefusal(
      "unknown-ref",
      `Element ${ref} is no longer on the page. Snapshot it again.`,
    );
  }
  return { backendNodeId, objectId };
}

/** Run one of the constant scripts against a resolved element. */
async function callOnElement(
  session: CdpSession,
  objectId: string,
  functionDeclaration: string,
  callArguments?: { value: unknown }[],
): Promise<unknown> {
  const response = await session.send<{
    result?: { value?: unknown };
    exceptionDetails?: { text?: string };
  }>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    returnByValue: true,
    awaitPromise: true,
    ...(callArguments === undefined ? {} : { arguments: callArguments }),
  });
  if (response.exceptionDetails !== undefined) {
    throw new InteractionRefusal(
      "failed",
      `The page threw while being inspected: ${
        response.exceptionDetails.text ?? "unknown error"
      }`,
    );
  }
  return response.result?.value;
}

const BLOCKED_REASON_TEXT: Record<BrowserActionBlockedReason, string> = {
  detached: "the element left the page",
  not_visible: "the element is hidden",
  unstable: "the element is still moving",
  disabled: "the element is disabled",
  offscreen: "the element is outside the viewport and would not scroll into it",
  covered: "something else is on top of the element",
};

/**
 * Wait until the element can actually be acted on, and answer with the point to
 * act at.
 *
 * This is the wait Playwright performs before every action and the reason its
 * actions are not races. Polling rather than observing: the conditions that
 * matter (an overlay's opacity, a layout settling) have no single event to
 * subscribe to, and the probe already spends two animation frames per attempt.
 */
async function waitForActionable(
  session: CdpSession,
  target: InteractionTarget,
): Promise<{ x: number; y: number }> {
  // Best-effort: an element with no layout box throws here, and the probe below
  // reports that in terms the caller can act on.
  await session
    .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendNodeId })
    .catch(() => undefined);

  const deadline = Date.now() + BB_BROWSER_ACTION_TIMEOUT_MS;
  let blocked: BrowserActionBlockedReason = "detached";
  for (;;) {
    const probe = parseBrowserActionProbe(
      await callOnElement(session, target.objectId, BB_BROWSER_ACTIONABILITY_SCRIPT),
    );
    if (probe === null) {
      throw new InteractionRefusal(
        "failed",
        "The page answered the actionability check with something unusable.",
      );
    }
    if (probe.ready) {
      return { x: probe.x, y: probe.y };
    }
    blocked = probe.reason;
    if (Date.now() >= deadline) {
      throw new InteractionRefusal(
        "not-actionable",
        `Gave up waiting for the element: ${BLOCKED_REASON_TEXT[blocked]}.`,
      );
    }
    await delay(BB_BROWSER_ACTION_POLL_INTERVAL_MS);
  }
}

const MOUSE_BUTTON_MASK: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 4,
};

function modifierMask(modifiers: readonly string[]): number {
  let mask = 0;
  for (const modifier of modifiers) {
    if (modifier === "Alt") mask |= CDP_MODIFIER_ALT;
    if (modifier === "Control") mask |= CDP_MODIFIER_CONTROL;
    if (modifier === "Meta") mask |= CDP_MODIFIER_META;
    if (modifier === "Shift") mask |= CDP_MODIFIER_SHIFT;
  }
  return mask;
}

interface MousePoint {
  x: number;
  y: number;
}

async function dispatchMouse(
  session: CdpSession,
  type: string,
  point: MousePoint,
  params: Record<string, unknown> = {},
): Promise<void> {
  await session.send("Input.dispatchMouseEvent", { type, ...point, ...params });
}

/**
 * Press and release a key.
 *
 * Modifiers ride the event's bitmask rather than being pressed as their own
 * events. Pages read `event.ctrlKey`, which the mask provides; the separate
 * keydown for the modifier itself only matters to a page watching for the
 * modifier alone, which no form does.
 */
async function dispatchKey(
  session: CdpSession,
  event: BrowserKeyEvent,
): Promise<void> {
  const base = {
    modifiers: event.modifiers,
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode: event.windowsVirtualKeyCode,
    nativeVirtualKeyCode: event.windowsVirtualKeyCode,
  };
  await session.send("Input.dispatchKeyEvent", {
    // `keyDown` carries text and inserts it; `rawKeyDown` is the right event for
    // a key that inserts nothing, and Chromium treats the two differently.
    type: event.text.length > 0 ? "keyDown" : "rawKeyDown",
    ...base,
    ...(event.text.length > 0
      ? { text: event.text, unmodifiedText: event.text }
      : {}),
  });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function readCheckedState(
  session: CdpSession,
  objectId: string,
): Promise<boolean> {
  const outcome = parseBrowserScriptOutcome(
    await callOnElement(session, objectId, BB_BROWSER_READ_CHECKED_SCRIPT),
  );
  if (outcome === null || !outcome.ok || outcome.checked === null) {
    throw new InteractionRefusal(
      "failed",
      "That element is not a checkbox, a radio button, or anything with a checked state.",
    );
  }
  return outcome.checked;
}

/** How long to keep re-reading a control's state after clicking it. */
const CHECKED_SETTLE_TIMEOUT_MS = 500;

async function performInteraction(
  session: CdpSession,
  entry: BrowserViewEntry,
  request: BbDesktopBrowserInteractRequest,
): Promise<void> {
  const interaction: BbDesktopBrowserInteraction = request.interaction;

  if (interaction.action === "resize") {
    // Device metrics rather than the view's bounds: the panel's size belongs to
    // the renderer's layout, and fighting it would leave the page and the panel
    // permanently out of step.
    if (interaction.width === 0 && interaction.height === 0) {
      await session.send("Emulation.clearDeviceMetricsOverride");
      return;
    }
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: interaction.width,
      height: interaction.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
    return;
  }

  if (interaction.action === "press" && interaction.ref === null) {
    const event = parseBrowserKeyChord(interaction.key);
    if (event === null) {
      throw new InteractionRefusal(
        "unsupported-key",
        `${JSON.stringify(interaction.key)} is not a key the browser can press.`,
      );
    }
    await dispatchKey(session, event);
    return;
  }

  // Every remaining action names an element; only `press` allows a null ref,
  // and that case returned above.
  const ref = interaction.ref;
  if (ref === null) {
    throw new InteractionRefusal("unknown-ref", "No element was named.");
  }
  const target = await resolveInteractionTarget(
    session,
    entry,
    ref,
    request.generation,
  );

  switch (interaction.action) {
    case "upload": {
      // No actionability wait: a styled upload control almost always hides the
      // real <input type=file>, so requiring it to be visible would refuse the
      // common case. CDP rejects a node that is not a file input.
      await session
        .send("DOM.setFileInputFiles", {
          files: [...interaction.paths],
          backendNodeId: target.backendNodeId,
        })
        .catch((error: unknown) => {
          throw new InteractionRefusal(
            "failed",
            `That element would not take files: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return;
    }

    case "select": {
      await waitForActionable(session, target);
      const outcome = parseBrowserScriptOutcome(
        await callOnElement(
          session,
          target.objectId,
          BB_BROWSER_SELECT_OPTION_SCRIPT,
          [{ value: [...interaction.values] }],
        ),
      );
      if (outcome === null || !outcome.ok) {
        throw new InteractionRefusal(
          "failed",
          outcome?.reason === "not_select"
            ? "That element is not a dropdown."
            : "None of those values match an option in that dropdown.",
        );
      }
      return;
    }

    case "fill": {
      await waitForActionable(session, target);
      const outcome = parseBrowserScriptOutcome(
        await callOnElement(
          session,
          target.objectId,
          BB_BROWSER_PREPARE_FILL_SCRIPT,
        ),
      );
      if (outcome === null || !outcome.ok) {
        throw new InteractionRefusal(
          "failed",
          "That element is not a text field.",
        );
      }
      if (interaction.text.length === 0) {
        // insertText("") inserts nothing rather than clearing the selection, so
        // an empty fill has to be a deletion.
        await dispatchKey(session, {
          key: "Delete",
          code: "Delete",
          windowsVirtualKeyCode: 46,
          text: "",
          modifiers: 0,
        });
        return;
      }
      await session.send("Input.insertText", { text: interaction.text });
      return;
    }

    case "type": {
      await waitForActionable(session, target);
      await session.send("DOM.focus", { backendNodeId: target.backendNodeId });
      // One event per character, because that is the whole difference from
      // fill: autocompletes and input masks react to keystrokes, not to a value
      // appearing.
      for (const character of Array.from(interaction.text)) {
        await dispatchKey(session, characterKeyEvent(character));
      }
      return;
    }

    case "press": {
      const event = parseBrowserKeyChord(interaction.key);
      if (event === null) {
        throw new InteractionRefusal(
          "unsupported-key",
          `${JSON.stringify(interaction.key)} is not a key the browser can press.`,
        );
      }
      await waitForActionable(session, target);
      await session.send("DOM.focus", { backendNodeId: target.backendNodeId });
      await dispatchKey(session, event);
      return;
    }

    case "hover": {
      const point = await waitForActionable(session, target);
      await dispatchMouse(session, "mouseMoved", point, { button: "none" });
      return;
    }

    case "drag": {
      const from = await waitForActionable(session, target);
      const to = await waitForActionable(
        session,
        await resolveInteractionTarget(
          session,
          entry,
          interaction.targetRef,
          request.generation,
        ),
      );
      await dispatchMouse(session, "mouseMoved", from, { button: "none" });
      await dispatchMouse(session, "mousePressed", from, {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      // An intermediate move, because a drag that teleports never fires the
      // `dragover`/`pointermove` a drop target listens for.
      await dispatchMouse(
        session,
        "mouseMoved",
        { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        { button: "left", buttons: 1 },
      );
      await dispatchMouse(session, "mouseMoved", to, {
        button: "left",
        buttons: 1,
      });
      await dispatchMouse(session, "mouseReleased", to, {
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      return;
    }

    case "check": {
      const point = await waitForActionable(session, target);
      if ((await readCheckedState(session, target.objectId)) === interaction.checked) {
        return;
      }
      await dispatchMouse(session, "mouseMoved", point, { button: "none" });
      await dispatchMouse(session, "mousePressed", point, {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await dispatchMouse(session, "mouseReleased", point, {
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      // Confirm rather than assume: a controlled component can refuse the
      // change, and reporting success on a checkbox that did not move would be
      // the worst kind of lie to an agent.
      const deadline = Date.now() + CHECKED_SETTLE_TIMEOUT_MS;
      for (;;) {
        if ((await readCheckedState(session, target.objectId)) === interaction.checked) {
          return;
        }
        if (Date.now() >= deadline) {
          throw new InteractionRefusal(
            "failed",
            `The control did not become ${interaction.checked ? "checked" : "unchecked"}.`,
          );
        }
        await delay(BB_BROWSER_ACTION_POLL_INTERVAL_MS);
      }
    }

    case "click": {
      const point = await waitForActionable(session, target);
      const modifiers = modifierMask(interaction.modifiers);
      const buttons = MOUSE_BUTTON_MASK[interaction.button] ?? 1;
      await dispatchMouse(session, "mouseMoved", point, {
        button: "none",
        modifiers,
      });
      // Chromium wants the running count on each event, so a double click is
      // press/release at 1 followed by press/release at 2 — not one event
      // claiming to be two clicks.
      for (let count = 1; count <= interaction.clickCount; count += 1) {
        await dispatchMouse(session, "mousePressed", point, {
          button: interaction.button,
          buttons,
          clickCount: count,
          modifiers,
        });
        await dispatchMouse(session, "mouseReleased", point, {
          button: interaction.button,
          buttons: 0,
          clickCount: count,
          modifiers,
        });
      }
      return;
    }

    default: {
      const exhaustive: never = interaction;
      throw new InteractionRefusal(
        "failed",
        `Unhandled interaction ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

type ControlRefusalReason = Extract<
  BbDesktopBrowserControlResult,
  { ok: false }
>["reason"];

const CONTROL_REFUSAL_REASONS = new Set<string>([
  "no-view",
  "no-page",
  "debugger-unavailable",
  "stale-refs",
  "unknown-ref",
  "evaluation-failed",
  "too-many-routes",
  "failed",
]);

/**
 * The interaction and control refusal vocabularies overlap but are not the
 * same — control cannot report `not-actionable`, having skipped the check that
 * produces it, and interaction has nothing to say about routes. So the shared
 * steps (resolving a ref) keep throwing {@link InteractionRefusal} and this
 * maps it, while the control-only refusals get their own class.
 */
function controlRefusalReason(reason: string): ControlRefusalReason {
  return (
    CONTROL_REFUSAL_REASONS.has(reason) ? reason : "failed"
  ) as ControlRefusalReason;
}

class ControlRefusal extends Error {
  readonly reason: ControlRefusalReason;

  constructor(reason: ControlRefusalReason, message: string) {
    super(message);
    this.name = "ControlRefusal";
    this.reason = reason;
  }
}

/**
 * Take over this tab's requests.
 *
 * `Fetch` is enabled only while the tab holds a route and disabled the moment
 * it holds none, because an enabled `Fetch` domain pauses **every** request
 * until something answers it: an interception left on with nothing driving it
 * is a page that never loads. For the same reason the handler answers on every
 * path, including its own failure — a request that is neither fulfilled nor
 * continued hangs until the page gives up.
 */
async function applyRouteInterception(
  session: CdpSession,
  entry: BrowserViewEntry,
): Promise<void> {
  const wanted = entry.routes.length > 0;
  // The listener is attached at most once per session and left in place, while
  // the domain goes on and off with the route table. Re-subscribing on every
  // pass would mean two handlers answering the same paused request, and the
  // second answer failing against a request the first already finished.
  if (wanted && !entry.routesWired) {
    entry.routesWired = true;
    wireRouteInterception(session, entry);
  }
  if (wanted === entry.routesEnabled) {
    return;
  }
  await session.send(wanted ? "Fetch.enable" : "Fetch.disable");
  entry.routesEnabled = wanted;
}

function wireRouteInterception(
  session: CdpSession,
  entry: BrowserViewEntry,
): void {
  session.on("Fetch.requestPaused", (params) => {
    const paused = params as { requestId?: string; request?: { url?: string } };
    const requestId = paused.requestId;
    if (typeof requestId !== "string") {
      return;
    }
    const url = paused.request?.url ?? "";
    const route = matchBrowserRoute(entry.routes, url);
    const answer =
      route === null
        ? session.send("Fetch.continueRequest", { requestId })
        : session.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: route.status,
            responseHeaders: toBrowserFulfillHeaders(route),
            body: Buffer.from(route.body, "utf8").toString("base64"),
          });
    if (route !== null) {
      route.matched += 1;
    }
    void answer.catch(() => {
      // The request may already be gone (the page navigated away from under
      // it), in which case continuing fails too and there is nothing left to
      // rescue.
      void session.send("Fetch.continueRequest", { requestId }).catch(() => {
        // Nothing to answer any more.
      });
    });
  });
}

/** The routes a tab holds, as the wire reports them. */
function entryRoutes(
  entry: BrowserViewEntry,
  tabId: string,
): Extract<BbDesktopBrowserControlResult, { kind: "routes" }> {
  return {
    ok: true,
    kind: "routes",
    tabId,
    ...entryPageIdentity(entry),
    routes: entry.routes.map((route) => ({ ...route })),
    offline: entry.offline,
  };
}

/**
 * Evaluate the caller's own JavaScript in the page.
 *
 * **In the page's world, not the isolated one** every other script here runs
 * in — which is the deliberate difference and the whole reason `eval` is worth
 * having: `window.__NEXT_DATA__`, a framework's state, a function the page
 * defined are all invisible from an isolated world, and reading them is what
 * people reach for `eval` to do. The isolated world protects our own fixed
 * scripts from a page that shadows globals; it cannot protect an expression
 * whose entire job is to touch the page.
 *
 * The expression is never spliced into a string. It crosses as CDP's
 * `functionDeclaration`, so the protocol parses it as one function and a page
 * cannot be reached through the way we sent it.
 */
async function evaluateInPage(
  session: CdpSession,
  entry: BrowserViewEntry,
  expression: string,
  ref: string | null,
  generation: number | undefined,
): Promise<{ value: string; truncated: boolean }> {
  let objectId: string;
  let callArguments: { objectId: string }[] = [];
  if (ref === null) {
    // `Runtime.evaluate` with no context id lands in the page's main world, so
    // its global object is the handle to call the caller's function on.
    const global = await session.send<{ result?: { objectId?: string } }>(
      "Runtime.evaluate",
      { expression: "globalThis" },
    );
    if (typeof global.result?.objectId !== "string") {
      throw new InteractionRefusal("failed", "The tab has no page to evaluate in.");
    }
    objectId = global.result.objectId;
  } else {
    const backendNodeId = lookupSnapshotNode(entry, ref, generation);
    // No `executionContextId`, so this resolves in the main world too — the
    // same element, addressed where the caller's code can see the page.
    const resolved = await session
      .send<{ object?: { objectId?: string } }>("DOM.resolveNode", {
        backendNodeId,
      })
      .catch(() => null);
    if (typeof resolved?.object?.objectId !== "string") {
      throw new InteractionRefusal(
        "unknown-ref",
        `Element ${ref} is no longer on the page. Snapshot it again.`,
      );
    }
    objectId = resolved.object.objectId;
    // Passed as the first argument, so `(el) => el.value` reads as it does in
    // Playwright; `this` is the element as well, for `function () { … }` form.
    callArguments = [{ objectId }];
  }

  const response = await session.send<{
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: expression,
    arguments: callArguments,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails !== undefined) {
    // The page ran it and it threw. That is the caller's to fix, and its own
    // message is the only useful thing to say about it.
    throw new ControlRefusal(
      "evaluation-failed",
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "The expression threw.",
    );
  }
  return formatBrowserEvalValue(
    response.result?.value,
    BB_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH,
  );
}

/**
 * Perform one direct-control operation on a tab whose session is attached.
 *
 * The mouse commands are the interaction module's dispatch with the ref lookup
 * and the actionability wait taken out — which is exactly what makes them vision
 * mode: they land on whatever is at the coordinate, and nothing here checks that
 * anything is.
 */
async function performControl(
  session: CdpSession,
  entry: BrowserViewEntry,
  tabId: string,
  request: BbDesktopBrowserControlRequest,
): Promise<BbDesktopBrowserControlResult> {
  const operation = request.operation;
  const acted = (): BbDesktopBrowserControlResult => ({
    ok: true,
    kind: "acted",
    tabId,
    ...entryPageIdentity(entry),
  });

  switch (operation.kind) {
    case "mouse-move": {
      entry.mousePoint = { x: operation.x, y: operation.y };
      await dispatchMouse(session, "mouseMoved", entry.mousePoint, {
        button: "none",
      });
      return acted();
    }

    case "mouse-button": {
      await dispatchMouse(
        session,
        operation.down ? "mousePressed" : "mouseReleased",
        entry.mousePoint,
        {
          button: operation.button,
          buttons: operation.down
            ? (MOUSE_BUTTON_MASK[operation.button] ?? 1)
            : 0,
          clickCount: 1,
        },
      );
      return acted();
    }

    case "mouse-wheel": {
      await dispatchMouse(session, "mouseWheel", entry.mousePoint, {
        button: "none",
        deltaX: operation.deltaX,
        deltaY: operation.deltaY,
      });
      return acted();
    }

    case "evaluate": {
      if (operation.ref !== null) {
        await session.enableDomain("DOM");
      }
      const evaluated = await evaluateInPage(
        session,
        entry,
        operation.expression,
        operation.ref,
        request.generation,
      );
      return {
        ok: true,
        kind: "evaluated",
        tabId,
        ...entryPageIdentity(entry),
        ...evaluated,
      };
    }

    case "route-set": {
      const existing = entry.routes.filter(
        (route) => route.pattern !== operation.route.pattern,
      );
      if (existing.length >= BB_DESKTOP_BROWSER_MAX_ROUTES) {
        throw new ControlRefusal(
          "too-many-routes",
          `This tab already holds ${BB_DESKTOP_BROWSER_MAX_ROUTES} routes. Remove one first.`,
        );
      }
      // Newest first, so the route just added is the one that answers — the
      // rule Playwright follows and the one a person debugging a mock expects.
      entry.routes = [{ ...operation.route, matched: 0 }, ...existing];
      await applyRouteInterception(session, entry);
      return entryRoutes(entry, tabId);
    }

    case "route-clear": {
      entry.routes =
        operation.pattern === null
          ? []
          : entry.routes.filter((route) => route.pattern !== operation.pattern);
      await applyRouteInterception(session, entry);
      return entryRoutes(entry, tabId);
    }

    case "route-list":
      return entryRoutes(entry, tabId);

    default: {
      // Per tab rather than per session: `Network.emulateNetworkConditions` is
      // scoped to the target, so one tab can be offline while the user keeps
      // browsing in the next one.
      await session.enableDomain("Network");
      await session.send("Network.emulateNetworkConditions", {
        offline: operation.offline,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      entry.offline = operation.offline;
      return acted();
    }
  }
}

/** The two ways a scoped snapshot refuses, thrown out of the selector lookup. */
class SnapshotRefusal extends Error {
  readonly reason: "invalid-selector" | "no-match";

  constructor(reason: "invalid-selector" | "no-match", message: string) {
    super(message);
    this.name = "SnapshotRefusal";
    this.reason = reason;
  }
}

/**
 * The backend node id of the element a CSS selector matches.
 *
 * Backend ids rather than the DOM agent's own: those are what the accessibility
 * tree carries, and matching them is how a selector reaches a snapshot at all.
 */
async function resolveSelectorNode(
  session: CdpSession,
  selector: string,
): Promise<number> {
  await session.enableDomain("DOM");
  // The DOM agent only knows nodes it has handed out, so the document has to be
  // fetched before anything can be queried against it. Depth 0: the only node
  // needed is the one the query starts from.
  const document = await session.send<{ root?: { nodeId?: number } }>(
    "DOM.getDocument",
    { depth: 0 },
  );
  const rootNodeId = document.root?.nodeId;
  if (typeof rootNodeId !== "number") {
    throw new Error("The tab would not describe its own document.");
  }

  const found = await session
    .send<{ nodeId?: number }>("DOM.querySelector", {
      nodeId: rootNodeId,
      selector,
    })
    .catch((error: unknown) => {
      // Only the browser can judge a selector, so its complaint is the answer —
      // and it is the caller's to fix rather than anything about the page.
      throw new SnapshotRefusal(
        "invalid-selector",
        error instanceof Error ? error.message : String(error),
      );
    });
  // Zero is how the protocol spells "matched nothing"; it is not a failure.
  if (typeof found.nodeId !== "number" || found.nodeId === 0) {
    throw new SnapshotRefusal(
      "no-match",
      `Nothing on the page matches ${JSON.stringify(selector)}.`,
    );
  }

  const described = await session.send<{
    node?: { backendNodeId?: number };
  }>("DOM.describeNode", { nodeId: found.nodeId });
  if (typeof described.node?.backendNodeId !== "number") {
    throw new Error("The tab would not describe that element.");
  }
  return described.node.backendNodeId;
}

/**
 * Take the frames Chromium sends while a tab is filmed.
 *
 * Every frame is acknowledged, whether or not it is kept, and that is the whole
 * subtlety of the screencast: Chromium sends the next frame only once the last
 * one has been answered, so a frame dropped for pacing that is also left
 * unacknowledged does not cost one frame — it ends the recording. Wired at most
 * once per session, like the request interception, so no frame is answered
 * twice.
 */
function wireScreencast(session: CdpSession, entry: BrowserViewEntry): void {
  session.on("Page.screencastFrame", (params) => {
    const frame = params as { data?: string; sessionId?: number };
    if (typeof frame.sessionId === "number") {
      void session
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {
          // The screencast is already over; there is nothing to keep alive.
        });
    }
    if (entry.video === null || typeof frame.data !== "string") {
      return;
    }
    entry.video.offerFrame(frame.data, Date.now());
  });
}

/** Start, mark or end the film of a tab whose session is attached. */
async function performRecord(
  session: CdpSession,
  entry: BrowserViewEntry,
  tabId: string,
  operation: BbDesktopBrowserRecordRequest["operation"],
): Promise<BbDesktopBrowserRecordResult> {
  const page = { tabId, ...entryPageIdentity(entry) };

  if (operation.kind === "video-start") {
    if (entry.video !== null) {
      return {
        ok: false,
        reason: "already-recording",
        message: "That tab is already being filmed. Stop it first.",
      };
    }
    if (!entry.videoWired) {
      entry.videoWired = true;
      wireScreencast(session, entry);
    }
    entry.video = new BrowserVideoRecording(Date.now(), operation.fps);
    try {
      await session.enableDomain("Page");
      await session.send("Page.startScreencast", {
        format: "jpeg",
        quality: BB_BROWSER_SCREENCAST_QUALITY,
        maxWidth: BB_BROWSER_SCREENCAST_MAX_WIDTH,
        maxHeight: BB_BROWSER_SCREENCAST_MAX_HEIGHT,
        everyNthFrame: 1,
      });
    } catch (error) {
      // A recording nothing is filling would answer `video-stop` with an empty
      // film and no explanation.
      entry.video = null;
      throw error;
    }
    return { ok: true, kind: "recording", ...page, active: true };
  }

  if (entry.video === null) {
    return {
      ok: false,
      reason: "not-recording",
      message: "That tab is not being filmed. Start with video-start.",
    };
  }

  if (operation.kind === "video-chapter") {
    entry.video.chapter(operation.title, Date.now());
    return { ok: true, kind: "recording", ...page, active: true };
  }

  const recording = entry.video;
  entry.video = null;
  await session.send("Page.stopScreencast").catch(() => {
    // Whatever went wrong, the frames already taken are still the answer —
    // losing a recording because the stop call failed is the worse trade.
  });
  return { ok: true, kind: "video", ...page, ...recording.finish(Date.now()) };
}

/**
 * What a tab is showing, resolved exactly as `buildBrowserState` does so a read,
 * a snapshot, an interaction and the tab strip can never disagree.
 */
function entryPageIdentity(entry: BrowserViewEntry): {
  url: string;
  title: string | null;
} {
  const url = entry.view.webContents.getURL();
  const rawTitle = entry.view.webContents.getTitle();
  const title = rawTitle.length > 0 && rawTitle !== url ? rawTitle : null;
  return {
    url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title:
      title === null
        ? null
        : truncate(title, BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
  };
}

/**
 * Answer one observation about a tab that is known to exist.
 *
 * Nothing here attaches the browser debugger — `capturePage` and `printToPDF`
 * are Electron's own, and the two logs were filled by events the shell was
 * already receiving. That is what makes this the one automation command safe to
 * run against a tab the user is merely browsing.
 */
async function captureObservation(
  entry: BrowserViewEntry,
  tabId: string,
  observation: BbDesktopBrowserObservation,
): Promise<BbDesktopBrowserObserveResult> {
  const page = { tabId, ...entryPageIdentity(entry) };

  // The two logs answer without touching the page at all: whatever the tab has
  // logged and requested is already recorded.
  if (observation.kind === "console") {
    return {
      ok: true,
      kind: "console",
      ...page,
      ...entry.consoleLog.read(observation.limit),
    };
  }
  if (observation.kind === "network") {
    return {
      ok: true,
      kind: "network",
      ...page,
      ...entry.networkLog.read(observation.limit),
    };
  }

  // A tab that has loaded nothing has nothing to render, and an empty capture
  // reported as a success is a blank image a caller would have to diagnose.
  if (entry.view.webContents.getURL().length === 0) {
    return { ok: false, reason: "no-page" };
  }

  if (observation.kind === "pdf") {
    const buffer = await entry.view.webContents.printToPDF({});
    const base64 = buffer.toString("base64");
    if (base64.length > BB_DESKTOP_BROWSER_MAX_PDF_BASE64_LENGTH) {
      return {
        ok: false,
        reason: "too-large",
        message: `That page's PDF is ${Math.round(buffer.byteLength / 1_048_576)}MB, past what the browser bridge will carry. Print a page range instead.`,
      };
    }
    return { ok: true, kind: "pdf", ...page, base64, byteLength: buffer.byteLength };
  }

  const image = await entry.view.webContents.capturePage();
  if (image.isEmpty()) {
    return {
      ok: false,
      reason: "failed",
      message: "The browser captured nothing — the tab may be hidden.",
    };
  }
  const buffer =
    observation.format === "png"
      ? image.toPNG()
      : image.toJPEG(observation.quality);
  const base64 = buffer.toString("base64");
  if (base64.length > BB_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH) {
    return {
      ok: false,
      reason: "too-large",
      message:
        "That screenshot is past what the browser bridge will carry. Ask for JPEG, or a lower quality.",
    };
  }
  const size = image.getSize();
  return {
    ok: true,
    kind: "screenshot",
    ...page,
    mimeType: observation.format === "png" ? "image/png" : "image/jpeg",
    base64,
    width: size.width,
    height: size.height,
  };
}

/**
 * Capture the whole document of a tab that is known to exist and to have loaded.
 *
 * The one capture that pays for the debugger, and it pays for exactly as much
 * of it as it needs: a session is attached, but the `Page` domain is never
 * enabled, so this tab's `alert()` still opens Chromium's own modal afterwards.
 * That distinction is the difference between a picture and taking a tab over.
 *
 * Two round trips rather than one, because the clip has to be measured first —
 * `captureBeyondViewport` on its own renders the viewport-sized surface and
 * would answer with the same picture `capturePage` already gives.
 */
async function captureFullPageImage(
  entry: BrowserViewEntry,
  session: CdpSession,
  request: BbDesktopBrowserCaptureFullPageRequest,
): Promise<BbDesktopBrowserCaptureFullPageResult> {
  const page = { tabId: request.tabId, ...entryPageIdentity(entry) };

  const measured = await runIsolatedScript(
    entry.view.webContents,
    BB_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT,
  );
  if (measured.kind === "timeout") {
    return {
      ok: false,
      reason: "failed",
      message: "The page did not answer how large it is in time.",
    };
  }
  const region =
    measured.kind === "value" ? parseBrowserCaptureRegion(measured.value) : null;
  if (region === null) {
    return {
      ok: false,
      reason: "failed",
      message: "The page reported no size to capture — it may not have laid out yet.",
    };
  }
  // The page can go while its own script is in flight, and a capture against a
  // dead target rejects rather than answering.
  if (entry.view.webContents.isDestroyed()) {
    return { ok: false, reason: "no-view" };
  }

  const captured = await session.send<{ data?: string }>(
    "Page.captureScreenshot",
    {
      format: request.format,
      // Chromium ignores quality for PNG; sending it anyway would only make the
      // request read as though lossless compression had a knob.
      ...(request.format === "jpeg" ? { quality: request.quality } : {}),
      // `scale: 1` is what makes the result CSS pixels rather than the display's
      // device pixels — on a retina screen the difference is four times the
      // bytes for a picture nobody asked to be that sharp.
      clip: { x: 0, y: 0, width: region.width, height: region.height, scale: 1 },
      captureBeyondViewport: true,
    },
  );
  const base64 = captured.data ?? "";
  if (base64.length === 0) {
    return {
      ok: false,
      reason: "failed",
      message: "The browser captured nothing.",
    };
  }
  if (base64.length > BB_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH) {
    return {
      ok: false,
      reason: "too-large",
      message:
        "That page is too long to return as one picture. Ask for JPEG, or a lower quality, or print it to a PDF.",
    };
  }
  return {
    ok: true,
    ...page,
    mimeType: request.format === "png" ? "image/png" : "image/jpeg",
    base64,
    width: region.width,
    height: region.height,
    truncated: region.truncated,
  };
}

type IsolatedScriptOutcome =
  | { kind: "value"; value: unknown }
  | { kind: "timeout" }
  | { kind: "failed" };

/**
 * Run one of our own scripts in the page-read isolated world, under a deadline.
 *
 * The deadline is mandatory rather than defensive: script execution is
 * suspended while a page loads, so a wedged subresource or a busy-looping main
 * thread reaches us as "no answer yet" and would otherwise hold a tool call
 * open forever. Whichever of the two loses the race is dropped — a late script
 * result must not resolve a call already reported as timed out, the same
 * discipline `startResizeSnapshot` applies to a late capture.
 */
async function runIsolatedScript(
  webContents: WebContentsView["webContents"],
  code: string,
): Promise<IsolatedScriptOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race<IsolatedScriptOutcome>([
    webContents
      .executeJavaScriptInIsolatedWorld(BB_DESKTOP_BROWSER_PAGE_READ_WORLD_ID, [
        { code },
      ])
      .then((value: unknown) => ({ kind: "value" as const, value }))
      .catch(() => ({ kind: "failed" as const })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: "timeout" }),
        BB_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Read or write one tab's stored state.
 *
 * Scoped to the tab throughout: cookies to the URL it is on, web storage to its
 * main frame. That is both the useful scope — the cookies a site actually sees —
 * and the bounded one, since the alternative hands over every site the user is
 * signed in to in a single call.
 *
 * Writes are the exception, and deliberately so: a cookie carrying its own
 * domain is written to that domain, because a `storageState` file whose cookies
 * were silently re-homed onto the current tab would restore a session that does
 * not work. What a caller can do with that is not narrowed here; the gate is
 * the plugin toggle, as it is for the rest of these tools.
 *
 * Like an observation and unlike an interaction, nothing here attaches the
 * browser debugger.
 */
async function captureStorage(args: {
  entry: BrowserViewEntry;
  tabId: string;
  operation: BbDesktopBrowserStorageOperation;
  cookies: Session["cookies"];
}): Promise<BbDesktopBrowserStorageResult> {
  const { cookies, entry, operation, tabId } = args;
  const webContents = entry.view.webContents;
  const url = webContents.getURL();
  // A tab showing nothing has no origin, so there is nothing for any of these
  // to be scoped to.
  if (url.length === 0) {
    return { ok: false, reason: "no-page" };
  }
  const page = { tabId, ...entryPageIdentity(entry) };

  if (operation.kind === "cookies-get") {
    const found = await cookies.get({ url });
    return {
      ok: true,
      kind: "cookies",
      ...page,
      cookies: found
        .slice(0, BB_DESKTOP_BROWSER_MAX_COOKIES)
        .map((cookie) => toBrowserCookie(cookie)),
    };
  }

  if (operation.kind === "cookies-set") {
    let applied = 0;
    let rejected = 0;
    for (const cookie of operation.cookies) {
      try {
        await cookies.set(toBrowserSessionCookieDetails(cookie, url));
        applied += 1;
      } catch {
        // Chromium refuses a cookie whose domain, scheme or flags disagree with
        // each other. One such cookie in a saved state must not abandon the
        // rest of it, so the count is the report rather than an exception.
        rejected += 1;
      }
    }
    return { ok: true, kind: "written", applied, rejected };
  }

  if (operation.kind === "cookies-clear") {
    const found = await cookies.get(
      operation.name === null ? { url } : { url, name: operation.name },
    );
    let removed = 0;
    for (const cookie of found) {
      try {
        await cookies.remove(url, cookie.name);
        removed += 1;
      } catch {
        // Same reasoning as a rejected write: keep going and report the count
        // rather than abandoning the cookies after this one.
      }
    }
    return { ok: true, kind: "removed", removed };
  }

  const outcome = await runIsolatedScript(
    webContents,
    buildBrowserStorageScript(operation),
  );
  if (outcome.kind === "timeout") {
    return { ok: false, reason: "timeout" };
  }
  if (outcome.kind === "failed") {
    return {
      ok: false,
      reason: "failed",
      message: "That page would not run the storage script.",
    };
  }
  // The page can be torn down while its own script is in flight.
  if (webContents.isDestroyed()) {
    return { ok: false, reason: "no-view" };
  }
  // An origin that blocks storage answers rather than throwing, and its reason
  // is worth passing on: "not accessible" and "we sent something broken" call
  // for different next moves.
  const refused = readBrowserStorageScriptError(outcome.value);
  if (refused !== null) {
    return { ok: false, reason: "failed", message: refused };
  }

  if (operation.kind === "items-get") {
    const parsed = parseBrowserStorageItems(outcome.value);
    if (parsed === null) {
      return {
        ok: false,
        reason: "failed",
        message: "That page's storage could not be read.",
      };
    }
    return { ok: true, kind: "items", ...page, area: operation.area, ...parsed };
  }

  const counts = parseBrowserStorageCounts(outcome.value);
  if (counts === null) {
    return {
      ok: false,
      reason: "failed",
      message: "That page's storage could not be written.",
    };
  }
  return operation.kind === "items-set"
    ? {
        ok: true,
        kind: "written",
        applied: counts.applied,
        rejected: counts.rejected,
      }
    : { ok: true, kind: "removed", removed: counts.removed };
}

function buildBrowserState(
  tabId: string,
  entry: BrowserViewEntry,
): BbDesktopBrowserState {
  const webContents = entry.view.webContents;
  const url = webContents.getURL();
  const rawTitle = webContents.getTitle();
  const title = rawTitle.length > 0 && rawTitle !== url ? rawTitle : null;
  // Truncate attacker-influenced strings to the contract caps so the push
  // always validates and oversized values never reach the renderer/localStorage.
  return {
    tabId,
    url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title:
      title === null
        ? null
        : truncate(title, BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
    isLoading: webContents.isLoadingMainFrame(),
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    errorText:
      entry.lastErrorText === null
        ? null
        : truncate(entry.lastErrorText, BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
  };
}

/**
 * The single browser-session permission we allow. `clipboard-sanitized-write`
 * is write-only: an in-page copy button calling `navigator.clipboard.writeText()`
 * can put sanitized text on the system clipboard, but the page can NOT read the
 * clipboard (`clipboard-read` stays denied). Every other device/capability
 * permission (camera, mic, geolocation, notifications, MIDI, …) stays denied.
 */
export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}

export function createDesktopBrowserViewManager(
  args: CreateDesktopBrowserViewManagerArgs,
): DesktopBrowserViewManager {
  const partition = args.partition ?? BB_BROWSER_PARTITION;
  const entries = new Map<string, BrowserViewEntry>();
  const entriesByWebContentsId = new Map<number, BrowserViewEntry>();
  // Host webContents ids with a native resize burst in flight: views of these
  // windows stay hidden regardless of renderer-declared visibility.
  const resizingHostIds = new Set<number>();
  let hardenedSession: Session | null = null;

  function isHostResizing(hostWindow: DesktopBrowserHostWindow): boolean {
    return resizingHostIds.has(hostWindow.webContents.id);
  }

  function applyEntryVisibility(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
  ): void {
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    entry.view.setVisible(
      entry.visible &&
        !isHostResizing(hostWindow) &&
        // A dialog means the app is drawing its own modal where the page was.
        entry.pendingDialog === null,
    );
  }

  /**
   * Capture the (still visible) view, push the bitmap to the renderer as its
   * resize placeholder, and only then hide the view. The capture result is
   * dropped if the burst already ended — the live view is back by then and a
   * late placeholder would linger under it into the next burst.
   */
  function startResizeSnapshot(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const hideCap = setTimeout(() => {
      applyEntryVisibility(entry, hostWindow);
    }, RESIZE_SNAPSHOT_HIDE_CAP_MS);
    entry.view.webContents
      .capturePage()
      .then((image) => {
        if (!isHostResizing(hostWindow) || image.isEmpty()) {
          return;
        }
        const dataUrl = `data:image/jpeg;base64,${image
          .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
          .toString("base64")}`;
        send(hostWindow, BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId,
          dataUrl,
        });
      })
      .catch(() => {
        // No placeholder; the renderer's bare panel background shows instead.
      })
      .finally(() => {
        clearTimeout(hideCap);
        applyEntryVisibility(entry, hostWindow);
      });
  }

  function ensureHardenedSession(): Session {
    if (hardenedSession !== null) {
      return hardenedSession;
    }
    const browserSession = session.fromPartition(partition);
    // Deny every device/capability permission by default in v1 (camera, mic,
    // geolocation, notifications, MIDI, …). The single exception is
    // `clipboard-sanitized-write`, allowed so in-page copy buttons (e.g.
    // GitHub) that call `navigator.clipboard.writeText()` work; this is
    // write-only, so `clipboard-read` stays denied. A prompt UI is a later
    // phase.
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(isAllowedBrowserPermission(permission));
    });
    browserSession.setPermissionCheckHandler((_wc, permission) =>
      isAllowedBrowserPermission(permission),
    );
    // Downloads are denied in v1 (lowest file-surface risk).
    browserSession.on("will-download", (event) => {
      event.preventDefault();
    });
    // Network firewall: untrusted pages must not invisibly reach bb's loopback
    // services or the user's LAN. Top-level http(s) navigation remains allowed;
    // subresources, fetch/XHR, iframes, and WebSockets are guarded here.
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const targetWebContentsId = details.webContentsId ?? null;
      const entry =
        targetWebContentsId === null
          ? null
          : (entriesByWebContentsId.get(targetWebContentsId) ?? null);
      const attributedEntry =
        entry === null || entry.view.webContents.isDestroyed() ? null : entry;
      const isMainFrameRequest = details.resourceType === "mainFrame";
      callback({
        cancel: shouldBlockBrowserRequest({
          url: details.url,
          method: details.method,
          resourceType: details.resourceType,
          isMainFrame: isMainFrameRequest,
          targetWebContentsId,
          entryWebContentsId: attributedEntry?.view.webContents.id ?? null,
          currentMainFrameLocalOriginKey:
            attributedEntry?.currentMainFrameLocalOriginKey ?? null,
          requestingFrameOriginKey: resolveRequestingFrameLocalOriginKey({
            origin: details.frame?.origin,
            url: details.frame?.url,
            // Electron blanks `frame.origin` for a document's initial
            // subresources; fall back to the top frame's URL so a same-origin
            // SPA dev server (Vite, etc.) is not blocked into a blank page.
            isTopFrame: details.frame?.parent === null,
          }),
        }),
      });
    });
    // Observation rides the same session-wide events and the same
    // `webContentsId` attribution the firewall above uses. Both ends of a
    // request are recorded because they answer different questions: `onCompleted`
    // carries the status, `onErrorOccurred` carries the reason there was none —
    // including `net::ERR_BLOCKED_BY_CLIENT` for a request the firewall refused,
    // which is exactly the case a caller would otherwise spend a long time
    // failing to explain.
    browserSession.webRequest.onCompleted((details) => {
      recordNetworkRequest(details);
    });
    browserSession.webRequest.onErrorOccurred((details) => {
      recordNetworkRequest(details);
    });
    hardenedSession = browserSession;
    return browserSession;
  }

  function recordNetworkRequest(details: BrowserNetworkRequestDetails): void {
    const webContentsId = (details as { webContentsId?: unknown }).webContentsId;
    if (typeof webContentsId !== "number") {
      return;
    }
    const entry = entriesByWebContentsId.get(webContentsId);
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    entry.networkLog.record(toBrowserNetworkEntry(details, Date.now()));
  }

  function pushFavicon(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    dataUrl: string | null,
  ): void {
    send(hostWindow, BB_DESKTOP_BROWSER_FAVICON_CHANNEL, { tabId, dataUrl });
  }

  /**
   * Drop an icon that belongs to a page the tab has left, once loading settles.
   *
   * The icon is keyed to the page URL it was resolved for, and this runs at
   * `did-stop-loading` rather than at commit, which is what makes a **reload keep
   * its icon**: the page is the same page, so nothing has to be re-declared or
   * re-fetched. Clearing at commit instead made the icon depend on the new
   * document re-announcing it, and a reload does not always do that — the bug this
   * replaces. The cost is a page that drops its icon on reload keeping the old one,
   * which is also what a real browser's favicon cache does.
   */
  function dropStaleFavicon(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    if (entry.faviconUrl === null) {
      return;
    }
    if (
      entry.faviconPageKey ===
      resolveBrowserFaviconPageKey(entry.view.webContents.getURL())
    ) {
      return;
    }
    entry.faviconUrl = null;
    entry.faviconPageKey = null;
    pushFavicon(hostWindow, tabId, null);
  }

  /**
   * Fetch a newly declared favicon in the browsing session and push it as a data
   * URI. The page's URL never leaves this process — see
   * `desktop-browser-favicon.ts` for why that is the point rather than a detail.
   */
  async function updateFavicon(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    urls: readonly string[],
  ): Promise<void> {
    const selected = selectBrowserFaviconUrl(urls);
    if (selected === null) {
      // Nothing usable declared. The icon the tab already wears is dropped when
      // loading settles, not here, so a page that declares its icon in stages
      // does not flicker through the generic mark.
      return;
    }
    if (selected === entry.faviconUrl) {
      // Same icon, re-announced (a reload, a re-parse). Re-key it to the page it
      // was announced for and skip the fetch: the renderer already has it.
      entry.faviconPageKey = resolveBrowserFaviconPageKey(
        entry.view.webContents.getURL(),
      );
      return;
    }
    const rate = evaluatePopupRate({
      timestamps: entry.faviconFetchTimestamps,
      now: Date.now(),
      windowMs: FAVICON_FETCH_WINDOW_MS,
      maxInWindow: FAVICON_FETCH_MAX_IN_WINDOW,
    });
    entry.faviconFetchTimestamps = rate.timestamps;
    if (!rate.allowed) {
      return;
    }

    const session = ensureHardenedSession();
    const dataUrl = await resolveBrowserFaviconDataUrl({
      fetchFavicon: (url) => session.fetch(url),
      urls: [selected],
    });
    if (dataUrl === null) {
      return;
    }
    // The view may have navigated away or been destroyed while the icon was in
    // flight; a late icon must not land on whatever the tab shows now.
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    entry.faviconUrl = selected;
    entry.faviconPageKey = resolveBrowserFaviconPageKey(
      entry.view.webContents.getURL(),
    );
    pushFavicon(hostWindow, tabId, dataUrl);
  }

  function pushState(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
  ): void {
    const entry = entries.get(browserViewKey(hostWindow, tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    send(
      hostWindow,
      BB_DESKTOP_BROWSER_STATE_CHANNEL,
      buildBrowserState(tabId, entry),
    );
  }

  function wireWebContents(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const webContents = entry.view.webContents;

    webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) {
        return;
      }
      const command = args.resolveAppCommand({
        altKey: input.alt,
        code: input.code,
        ctrlKey: input.control,
        key: input.key,
        metaKey: input.meta,
        shiftKey: input.shift,
      });
      if (command === null) return;
      // Prevent both the untrusted page and Electron's application menu from
      // also handling a chord that bb resolved as a browser command.
      event.preventDefault();
      if (command === "browser.focusLocation") {
        args.focusHostWebContents(hostWindow.webContents.id);
      }
      args.dispatchAppCommand({
        command,
        hostWebContentsId: hostWindow.webContents.id,
      });
    });

    webContents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame) {
        return;
      }
      if (shouldBlockEntryTopLevelRequest(entry, event.url)) {
        event.preventDefault();
      }
    });
    webContents.on("will-navigate", (event, url) => {
      if (shouldBlockEntryTopLevelRequest(entry, url)) {
        event.preventDefault();
      }
    });
    webContents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      if (shouldBlockEntryTopLevelRequest(entry, url)) {
        event.preventDefault();
      }
    });

    webContents.setWindowOpenHandler((details) => {
      const { openTabUrl } = resolveWindowOpenAction(details.url);
      if (openTabUrl !== null) {
        const decision = evaluatePopupRate({
          timestamps: entry.popupTimestamps,
          now: Date.now(),
          windowMs: POPUP_RATE_WINDOW_MS,
          maxInWindow: POPUP_RATE_MAX_IN_WINDOW,
        });
        entry.popupTimestamps = decision.timestamps;
        if (decision.allowed) {
          send(hostWindow, BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL, {
            url: openTabUrl,
          });
          send(hostWindow, BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL, {
            tabId,
            url: openTabUrl,
          });
        }
      }
      return { action: "deny" };
    });

    // Right-click menu for the untrusted browser view. Built from this view's
    // own webContents so the standard editing roles act on it (not the host
    // React surface), giving Copy parity even when focus is elsewhere. Only
    // plain editing roles are exposed — no dev tools, reload, or bb-bridge
    // surface — keeping the untrusted-content posture.
    webContents.on("context-menu", (_event, params) => {
      if (webContents.isDestroyed()) {
        return;
      }
      const { editFlags } = params;
      const menu = Menu.buildFromTemplate([
        {
          role: "cut",
          enabled: editFlags.canCut,
        },
        {
          role: "copy",
          enabled: editFlags.canCopy && params.selectionText.length > 0,
        },
        {
          role: "paste",
          enabled: editFlags.canPaste,
        },
        { type: "separator" },
        {
          role: "selectAll",
          enabled: editFlags.canSelectAll,
        },
      ]);
      menu.popup();
    });

    // Recorded from the moment the tab exists, and never cleared on navigation:
    // the log answers "what has this tab logged", which spans the redirect that
    // got it here. Clearing on `did-navigate` would also drop the main-frame
    // request's own status — the single most useful entry in a network log.
    webContents.on("console-message", (details: BrowserConsoleMessageDetails) => {
      entry.consoleLog.record(toBrowserConsoleEntry(details, Date.now()));
    });

    const refresh = () => pushState(hostWindow, tabId);
    webContents.on("did-start-loading", refresh);
    webContents.on("did-stop-loading", () => {
      dropStaleFavicon(hostWindow, tabId, entry);
      refresh();
    });
    webContents.on("did-navigate", (_event, url) => {
      commitEntryMainFrameUrl(entry, url);
      entry.lastErrorText = null;
      // Snapshot refs name nodes in the document that produced them; a new
      // document means every ref is now either dangling or, worse, pointing at
      // whatever inherited that node id. Same contract Playwright has.
      invalidateSnapshotRefs(entry);
      refresh();
    });
    webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        commitEntryMainFrameUrl(entry, url);
        // A same-document navigation keeps the document but routinely replaces
        // the view an SPA is showing, so the refs are just as stale.
        invalidateSnapshotRefs(entry);
      }
      refresh();
    });
    webContents.on("did-start-navigation", () => {
      entry.lastErrorText = null;
      refresh();
    });
    webContents.on("page-title-updated", refresh);
    // A page's favicon URL is still never forwarded: the renderer receives only a
    // `data:` URI the shell built from bytes it fetched in the browsing session,
    // so the trusted bb app neither sees nor requests anything the page chose.
    // `desktop-browser-favicon.ts` carries the reasoning and the limits.
    webContents.on("page-favicon-updated", (_event, urls) => {
      void updateFavicon(hostWindow, tabId, entry, urls);
    });
    webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
          return;
        }
        entry.lastErrorText =
          errorDescription.length > 0
            ? errorDescription
            : "Failed to load page";
        refresh();
      },
    );
  }

  function createEntry(args: CreateEntryArgs): BrowserViewEntry {
    ensureHardenedSession();
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Intentionally NO preload: browsed pages are untrusted and must never
        // receive a bb bridge.
      },
    });
    const entry: BrowserViewEntry = {
      view,
      lastErrorText: null,
      currentMainFrameLocalOriginKey: null,
      desiredBounds: args.desiredBounds,
      popupTimestamps: [],
      faviconUrl: null,
      faviconPageKey: null,
      faviconFetchTimestamps: [],
      visible: false,
      cdp: null,
      pendingDialog: null,
      dialogsWired: false,
      automationWorldId: null,
      consoleLog: new BrowserObservationLog(BB_BROWSER_OBSERVATION_BUFFER_SIZE),
      networkLog: new BrowserObservationLog(BB_BROWSER_OBSERVATION_BUFFER_SIZE),
      routes: [],
      routesWired: false,
      routesEnabled: false,
      offline: false,
      video: null,
      videoWired: false,
      mousePoint: { x: 0, y: 0 },
      snapshotRefs: new Map(),
      snapshotGeneration: 0,
    };
    wireWebContents(args.hostWindow, args.tabId, entry);
    args.hostWindow.contentView.addChildView(view);
    entries.set(browserViewKey(args.hostWindow, args.tabId), entry);
    entriesByWebContentsId.set(view.webContents.id, entry);
    return entry;
  }

  function loadIfNeeded(entry: BrowserViewEntry, url: string): void {
    if (url.length === 0) {
      return;
    }
    if (entry.view.webContents.getURL() === url) {
      return;
    }
    if (!isAllowedBrowserUrl(url)) {
      return;
    }
    entry.lastErrorText = null;
    entry.view.webContents.loadURL(url).catch(() => {
      // Usually surfaced through `did-fail-load`; swallow the rejection.
    });
  }

  function destroyEntry(
    hostWindow: DesktopBrowserHostWindow,
    key: string,
  ): void {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    entries.delete(key);
    entriesByWebContentsId.delete(entry.view.webContents.id);
    releaseCdpSession(entry);
    clearEntryLocalOriginState(entry);
    if (!hostWindow.isDestroyed()) {
      hostWindow.contentView.removeChildView(entry.view);
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  }

  /**
   * The tab's CDP session, attached on first use. Automation is what pays for
   * the debugger, so nothing else in the shell ever calls this.
   */
  function ensureCdpSession(entry: BrowserViewEntry): CdpSession {
    if (entry.cdp !== null && entry.cdp.isAttached()) {
      return entry.cdp;
    }
    const session = createCdpSession({
      target: entry.view.webContents.debugger,
      onDetach: () => {
        // Refs were resolved against a session that no longer exists.
        entry.cdp = null;
        invalidateSnapshotRefs(entry);
        forgetEntryInterception(entry);
      },
    });
    entry.cdp = session;
    return session;
  }

  /**
   * Chromium drops request interception, network emulation and the screencast
   * when its protocol client goes, so the tab is routed, online and unfilmed
   * again whether we like it or not. Forgetting them here is what stops
   * `route-list` describing a tab that is no longer mocked, and `video-stop`
   * answering with a recording that stopped growing when the debugger did.
   */
  function forgetEntryInterception(entry: BrowserViewEntry): void {
    entry.routes = [];
    entry.routesWired = false;
    entry.routesEnabled = false;
    entry.offline = false;
    entry.video = null;
    entry.videoWired = false;
  }

  function releaseCdpSession(entry: BrowserViewEntry): void {
    entry.cdp?.detach();
    entry.cdp = null;
    entry.dialogsWired = false;
    entry.pendingDialog = null;
    forgetEntryInterception(entry);
  }

  /**
   * Take this tab's JavaScript dialogs.
   *
   * Enabling the `Page` domain is what moves dialogs off Chromium's native
   * modal and onto the protocol — which is the point (an agent can answer one)
   * and also the cost (a human now sees the app's dialog instead of the
   * system's). It happens per tab, on the same lazy attach automation pays for,
   * so a tab nobody has automated keeps the native behaviour.
   */
  async function ensureDialogInterception(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    session: CdpSession,
  ): Promise<void> {
    if (entry.dialogsWired) {
      return;
    }
    entry.dialogsWired = true;

    session.on("Page.javascriptDialogOpening", (params) => {
      const opening = params as {
        type?: string;
        message?: string;
        defaultPrompt?: string;
      };
      const type = opening.type ?? "alert";
      entry.pendingDialog = {
        type:
          type === "confirm" ||
          type === "prompt" ||
          type === "beforeunload"
            ? type
            : "alert",
        message: truncate(
          opening.message ?? "",
          BB_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
        ),
        defaultPrompt: truncate(
          opening.defaultPrompt ?? "",
          BB_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
        ),
      };
      // Stand a bitmap of the frozen page in for the hidden view, so the dialog
      // appears over the page rather than over an empty panel. Same machinery
      // the resize burst uses; a capture that fails just leaves the panel bare.
      captureDialogPlaceholder(hostWindow, tabId, entry);
      applyEntryVisibility(entry, hostWindow);
      send(hostWindow, BB_DESKTOP_BROWSER_DIALOG_CHANNEL, {
        tabId,
        dialog: entry.pendingDialog,
      });
    });

    session.on("Page.javascriptDialogClosed", () => {
      clearPendingDialog(hostWindow, tabId, entry);
    });

    await session.enableDomain("Page");
  }

  function captureDialogPlaceholder(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    entry.view.webContents
      .capturePage()
      .then((image) => {
        if (entry.pendingDialog === null || image.isEmpty()) {
          return;
        }
        send(hostWindow, BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId,
          dataUrl: `data:image/jpeg;base64,${image
            .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
            .toString("base64")}`,
        });
      })
      .catch(() => {
        // No placeholder; the panel's own background shows behind the dialog.
      });
  }

  function clearPendingDialog(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    if (entry.pendingDialog === null) {
      return;
    }
    entry.pendingDialog = null;
    applyEntryVisibility(entry, hostWindow);
    // Reveal first, then drop the placeholder, so the swap never flashes an
    // empty panel — the same ordering `endWindowResize` uses.
    send(hostWindow, BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
      tabId,
      dataUrl: null,
    });
    send(hostWindow, BB_DESKTOP_BROWSER_DIALOG_CHANNEL, {
      tabId,
      dialog: null,
    });
  }

  function withEntry(
    args: HostScopedTabArgs,
    fn: (entry: BrowserViewEntry) => void,
  ): void {
    const entry = entries.get(browserViewKey(args.hostWindow, args.tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    fn(entry);
  }

  /**
   * Snapshot a tab, optionally narrowed to what a selector matches.
   *
   * One function behind both methods, because the scoped and unscoped forms
   * differ by which node the render starts at and by nothing else — they take
   * the same locks, hand out refs the same way, and invalidate the same table.
   */
  async function captureTabSnapshot(args: {
    hostWindow: DesktopBrowserHostWindow;
    request: BbDesktopBrowserSnapshotRequest | BbDesktopBrowserSnapshotInRequest;
  }): Promise<BbDesktopBrowserSnapshotResult> {
    const { hostWindow, request } = args;
    const entry = entries.get(browserViewKey(hostWindow, request.tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return { ok: false, reason: "no-view" };
    }
    if (entry.view.webContents.getURL().length === 0) {
      return { ok: false, reason: "no-page" };
    }

    let session: CdpSession;
    try {
      session = ensureCdpSession(entry);
    } catch (error) {
      // DevTools holding the tab is the realistic cause, and it is worth
      // saying so rather than reporting a generic failure.
      return {
        ok: false,
        reason: "debugger-unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      // Any automation on this tab means the shell owns its dialogs from now
      // on — otherwise the first `confirm()` would block the page with nothing
      // able to answer it.
      await ensureDialogInterception(hostWindow, request.tabId, entry, session);
      const selector = "selector" in request ? request.selector : null;
      // Resolved before the tree is fetched, so a selector that matches nothing
      // costs a page-sized response nobody reads.
      const backendNodeId =
        selector === null ? null : await resolveSelectorNode(session, selector);

      await session.enableDomain("Accessibility");
      const response = await session.send<{ nodes?: AxNode[] }>(
        "Accessibility.getFullAXTree",
      );
      const nodes = response.nodes ?? [];

      // Scoping narrows what is rendered, not what Chromium sends: the tree
      // arrives whole either way, because `Accessibility.getPartialAXTree`
      // answers with one level of children and rebuilding a subtree from it
      // would be a round trip per level. What it saves is the caller's context,
      // which is the scarce thing here.
      let root: AxNode | undefined;
      if (backendNodeId !== null) {
        const found = findBrowserSnapshotRoot(nodes, backendNodeId);
        if (found === null) {
          throw new SnapshotRefusal(
            "no-match",
            `${JSON.stringify(selector)} matched an element the accessibility tree does not describe — it is probably hidden.`,
          );
        }
        root = found;
      }

      const built = buildBrowserSnapshot({
        nodes,
        ...(root === undefined ? {} : { root }),
        maxDepth: request.maxDepth,
        maxLength: BB_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH,
      });

      // Replacing the table is itself an invalidation: refs from the previous
      // snapshot must not stay resolvable behind the new ones. A scoped
      // snapshot is no exception — it hands out `e1` again, for a different
      // element than the last one called `e1`.
      invalidateSnapshotRefs(entry);
      for (const { ref, backendNodeId: refNodeId } of built.refs) {
        entry.snapshotRefs.set(ref, refNodeId);
      }

      return {
        ok: true,
        tabId: request.tabId,
        ...entryPageIdentity(entry),
        snapshot: built.text,
        generation: entry.snapshotGeneration,
        refCount: built.refs.length,
        truncated: built.truncated,
      };
    } catch (error) {
      if (error instanceof SnapshotRefusal) {
        return { ok: false, reason: error.reason, message: error.message };
      }
      return {
        ok: false,
        reason: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    attach({ hostWindow, request }) {
      const key = browserViewKey(hostWindow, request.tabId);
      const existing = entries.get(key) ?? null;
      // A freshly-created entry starts hidden, so its prior visibility is false.
      const wasVisible = existing?.visible ?? false;
      const entry =
        existing ??
        createEntry({
          desiredBounds: request.bounds,
          hostWindow,
          tabId: request.tabId,
        });
      setEntryDesiredBounds({ bounds: request.bounds, entry, hostWindow });
      entry.visible = request.visible;
      applyEntryVisibility(entry, hostWindow);
      // Focus on a real not-visible → visible transition so a freshly-mounted
      // active tab (shown via attach, not setVisible) wires the Edit-menu
      // copy/cut/paste roles and Cmd+C to this view's webContents.
      if (
        request.visible &&
        !wasVisible &&
        !entry.view.webContents.isDestroyed()
      ) {
        entry.view.webContents.focus();
      }
      loadIfNeeded(entry, request.url);
      pushState(hostWindow, request.tabId);
    },
    detach({ hostWindow, tabId }) {
      destroyEntry(hostWindow, browserViewKey(hostWindow, tabId));
    },
    navigate({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        loadIfNeeded(entry, request.url);
      });
    },
    goBack({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoBack()) {
          entry.view.webContents.navigationHistory.goBack();
        }
      });
    },
    goForward({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          entry.view.webContents.navigationHistory.goForward();
        }
      });
    },
    reload({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.reload();
      });
    },
    stop({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.stop();
      });
    },
    async readPage({ hostWindow, tabId }) {
      const entry = entries.get(browserViewKey(hostWindow, tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      const webContents = entry.view.webContents;
      // The empty-URL new-tab convention (see `loadIfNeeded`): the view exists
      // but is showing nothing, which is a different answer from "no view".
      if (webContents.getURL().length === 0) {
        return { ok: false, reason: "no-page" };
      }

      const raw = await runIsolatedScript(
        webContents,
        BB_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
      );

      if (raw.kind === "timeout") {
        return { ok: false, reason: "timeout" };
      }
      if (raw.kind === "failed") {
        return { ok: false, reason: "unreadable" };
      }
      // The page can be torn down while its own script is in flight.
      if (webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      const content = parseBrowserPageReadContent(raw.value);
      if (content === null) {
        return { ok: false, reason: "unreadable" };
      }

      return {
        ok: true,
        tabId,
        ...entryPageIdentity(entry),
        isLoading: webContents.isLoadingMainFrame(),
        ...content,
      };
    },
    snapshot({ hostWindow, request }) {
      return captureTabSnapshot({ hostWindow, request });
    },
    snapshotIn({ hostWindow, request }) {
      return captureTabSnapshot({ hostWindow, request });
    },
    async respondToDialog({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        !entry ||
        entry.view.webContents.isDestroyed() ||
        entry.pendingDialog === null ||
        entry.cdp === null
      ) {
        return false;
      }
      const isPrompt = entry.pendingDialog.type === "prompt";
      try {
        await entry.cdp.send("Page.handleJavaScriptDialog", {
          accept: request.accept,
          // Chromium rejects promptText on a non-prompt dialog.
          ...(isPrompt && request.accept
            ? { promptText: request.promptText ?? "" }
            : {}),
        });
      } catch {
        // The page may have gone while the answer was in flight. Fall through:
        // clearing the state below is what stops the view staying hidden.
        clearPendingDialog(hostWindow, request.tabId, entry);
        return false;
      }
      // `Page.javascriptDialogClosed` also clears this; doing it here as well
      // keeps the view from staying hidden if that event never arrives.
      clearPendingDialog(hostWindow, request.tabId, entry);
      return true;
    },
    async interact({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      if (entry.view.webContents.getURL().length === 0) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        // Same reason as in `snapshot`: from the moment we drive this tab, its
        // dialogs are ours to answer. A click that opens a `confirm()` would
        // otherwise block the page with nothing able to respond.
        await ensureDialogInterception(
          hostWindow,
          request.tabId,
          entry,
          session,
        );
        await session.enableDomain("DOM");
        await performInteraction(session, entry, request);
      } catch (error) {
        if (error instanceof InteractionRefusal) {
          return { ok: false, reason: error.reason, message: error.message };
        }
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      // A click that navigated has already changed these; reporting them saves
      // the caller a round trip it would otherwise race.
      return {
        ok: true,
        tabId: request.tabId,
        ...entryPageIdentity(entry),
      };
    },
    async observe({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await captureObservation(
          entry,
          request.tabId,
          request.observation,
        );
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async captureFullPage({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      if (entry.view.webContents.getURL().length === 0) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      // No `ensureDialogInterception` here, unlike every other command that
      // attaches a session: this one does not drive the page, so it cannot
      // provoke a dialog, and taking a tab's dialogs over is a visible change
      // to how the browser behaves for the human using it. A picture should not
      // cost that.
      try {
        return await captureFullPageImage(entry, session, request);
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async storage({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await captureStorage({
          entry,
          tabId: request.tabId,
          operation: request.operation,
          // The browsed partition's jar, which is the only one these views ever
          // write to — nothing here can reach the app's own session.
          cookies: ensureHardenedSession().cookies,
        });
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async control({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      // `route-list` is the exception worth allowing on a blank tab: routes are
      // set up before a page is loaded as often as after, and answering "no
      // page" to a question about the tab's own state would be wrong.
      if (
        entry.view.webContents.getURL().length === 0 &&
        request.operation.kind !== "route-list"
      ) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        // Same reason as in `snapshot` and `interact`: once we drive this tab,
        // its dialogs are ours to answer, and an evaluated `confirm()` would
        // otherwise block the page with nothing able to respond.
        await ensureDialogInterception(hostWindow, request.tabId, entry, session);
        return await performControl(session, entry, request.tabId, request);
      } catch (error) {
        if (error instanceof ControlRefusal) {
          return { ok: false, reason: error.reason, message: error.message };
        }
        if (error instanceof InteractionRefusal) {
          return {
            ok: false,
            reason: controlRefusalReason(error.reason),
            message: error.message,
          };
        }
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async record({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      // Only starting needs a page: a film of a blank tab is a blank film,
      // while stopping one has frames to hand back whatever the tab shows now.
      if (
        entry.view.webContents.getURL().length === 0 &&
        request.operation.kind === "video-start"
      ) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        // Filming needs the `Page` domain, and enabling it is what moves this
        // tab's dialogs onto the protocol. So the same rule as everywhere else
        // applies, and for a sharper reason: a page that opens a dialog
        // mid-recording would otherwise sit there with nobody able to answer it.
        await ensureDialogInterception(hostWindow, request.tabId, entry, session);
        return await performRecord(
          session,
          entry,
          request.tabId,
          request.operation,
        );
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    setBounds({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        setEntryDesiredBounds({ bounds: request.bounds, entry, hostWindow });
      });
    },
    setVisible({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        const wasVisible = entry.visible;
        entry.visible = request.visible;
        applyEntryVisibility(entry, hostWindow);
        // Focus the view only on a real not-visible → visible transition so the
        // Edit-menu copy/cut/paste roles and Cmd+C target this view's
        // webContents (the focused one). Skip redundant re-syncs so we never
        // yank focus away from the React address bar mid-interaction.
        if (
          request.visible &&
          !wasVisible &&
          !entry.view.webContents.isDestroyed()
        ) {
          entry.view.webContents.focus();
        }
      });
    },
    beginWindowResize(hostWindow) {
      if (isHostResizing(hostWindow)) {
        return;
      }
      resizingHostIds.add(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) {
          continue;
        }
        if (entry.visible) {
          startResizeSnapshot(hostWindow, key.slice(prefix.length), entry);
        }
      }
    },
    endWindowResize(hostWindow) {
      if (!isHostResizing(hostWindow)) {
        return;
      }
      resizingHostIds.delete(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) {
          continue;
        }
        if (entry.visible) {
          applyEntryDesiredBounds(entry, hostWindow);
        }
        applyEntryVisibility(entry, hostWindow);
        send(hostWindow, BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId: key.slice(prefix.length),
          dataUrl: null,
        });
      }
    },
    releaseWindow(hostWebContentsId) {
      resizingHostIds.delete(hostWebContentsId);
      const prefix = `${hostWebContentsId}:`;
      for (const [key, entry] of [...entries.entries()]) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryLocalOriginState(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
    destroyAll() {
      resizingHostIds.clear();
      for (const [key, entry] of [...entries.entries()]) {
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryLocalOriginState(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
  };
}
