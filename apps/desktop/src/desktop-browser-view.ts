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
  type BbDesktopBrowserInteraction,
  type BbDesktopBrowserInteractRequest,
  type BbDesktopBrowserInteractResult,
  type BbDesktopBrowserPageReadResult,
  type BbDesktopBrowserSnapshot,
  type BbDesktopBrowserSnapshotRequest,
  type BbDesktopBrowserSnapshotResult,
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
  BB_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
  BB_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
  BB_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
  parseBrowserPageReadContent,
} from "./desktop-browser-page-read.js";
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
 * Turn a `[ref=eN]` back into something CDP can address.
 *
 * The generation check happens here rather than per action, because every
 * ref-carrying action needs it and forgetting it in one branch would be a
 * silently-wrong click rather than a visible failure.
 */
async function resolveInteractionTarget(
  session: CdpSession,
  entry: BrowserViewEntry,
  ref: string,
  generation: number | undefined,
): Promise<InteractionTarget> {
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
    hardenedSession = browserSession;
    return browserSession;
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
      },
    });
    entry.cdp = session;
    return session;
  }

  function releaseCdpSession(entry: BrowserViewEntry): void {
    entry.cdp?.detach();
    entry.cdp = null;
    entry.dialogsWired = false;
    entry.pendingDialog = null;
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

      // Race the read against the timeout, then drop whichever loses. A late
      // script result must not resolve a call already reported as timed out —
      // the same discipline `startResizeSnapshot` applies to a late capture.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const raw = await Promise.race([
        webContents
          .executeJavaScriptInIsolatedWorld(
            BB_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
            [{ code: BB_DESKTOP_BROWSER_PAGE_READ_SCRIPT }],
          )
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
    async snapshot({ hostWindow, request }) {
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
        await session.enableDomain("Accessibility");
        const response = await session.send<{ nodes?: AxNode[] }>(
          "Accessibility.getFullAXTree",
        );
        const built = buildBrowserSnapshot({
          nodes: response.nodes ?? [],
          maxDepth: request.maxDepth,
          maxLength: BB_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH,
        });

        // Replacing the table is itself an invalidation: refs from the previous
        // snapshot must not stay resolvable behind the new ones.
        invalidateSnapshotRefs(entry);
        for (const { ref, backendNodeId } of built.refs) {
          entry.snapshotRefs.set(ref, backendNodeId);
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
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
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
