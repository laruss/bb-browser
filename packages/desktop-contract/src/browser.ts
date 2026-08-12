import { z } from "zod";

/**
 * Hard caps on attacker-influenced strings crossing the browser IPC boundary so
 * a hostile page cannot force oversized values into IPC payloads or persisted
 * (localStorage) tab state. The main process truncates to these before sending;
 * the schemas reject anything longer.
 */
export const BB_DESKTOP_BROWSER_MAX_URL_LENGTH = 4096;
export const BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH = 1024;

/**
 * Pixel rect of the panel region the native browser view must overlay,
 * measured by the renderer against its own layout viewport. The preload
 * converts these CSS pixels to native window points at the current page zoom
 * before it sends the rect to the desktop main process. This rect is the
 * single placement authority: the renderer re-measures and pushes it whenever
 * its layout moves the panel, and the desktop main process only intersects it
 * with the live window content bounds — it never extrapolates placement from
 * native window resizes, whose size the renderer's (possibly lagging) chrome
 * paint does not yet reflect.
 */
export const bbDesktopBrowserViewBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .strict();
export type BbDesktopBrowserViewBounds = z.infer<
  typeof bbDesktopBrowserViewBoundsSchema
>;

export interface BbDesktopBrowserViewportBounds {
  width: number;
  height: number;
}

interface ClampIntegerToRangeArgs {
  max: number;
  min: number;
  value: number;
}

export interface ClampBbDesktopBrowserViewBoundsArgs {
  bounds: BbDesktopBrowserViewBounds;
  viewport: BbDesktopBrowserViewportBounds;
}

function clampIntegerToRange(args: ClampIntegerToRangeArgs): number {
  return Math.min(Math.max(args.value, args.min), args.max);
}

export function clampBbDesktopBrowserViewBounds(
  args: ClampBbDesktopBrowserViewBoundsArgs,
): BbDesktopBrowserViewBounds {
  const viewportRight = Math.max(0, Math.round(args.viewport.width));
  const viewportBottom = Math.max(0, Math.round(args.viewport.height));
  const x = clampIntegerToRange({
    value: args.bounds.x,
    min: 0,
    max: viewportRight,
  });
  const y = clampIntegerToRange({
    value: args.bounds.y,
    min: 0,
    max: viewportBottom,
  });
  const right = clampIntegerToRange({
    value: args.bounds.x + args.bounds.width,
    min: x,
    max: viewportRight,
  });
  const bottom = clampIntegerToRange({
    value: args.bounds.y + args.bounds.height,
    min: y,
    max: viewportBottom,
  });

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

/**
 * Create-or-update the view for a browser tab. `url` may be empty to mean "no
 * page yet" (the renderer shows its new-tab screen and keeps the view hidden).
 *
 * Version-skew warning: the desktop shell attaches to any already-running bb
 * server that passes its health probe (no version handshake — see
 * apps/desktop/src/server-probe.ts) and loads the SPA that server serves, so
 * the renderer and the shell's main process routinely come from different
 * builds. This and the other `.strict()` browser request shapes are therefore
 * wire-frozen: adding a required field breaks old SPAs against a new shell,
 * and adding any field breaks new SPAs against an old shell's strict parser.
 * Change them only alongside an explicit capability/version negotiation in
 * the preload bridge.
 */
export const bbDesktopBrowserAttachRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    bounds: bbDesktopBrowserViewBoundsSchema,
    visible: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserAttachRequest = z.infer<
  typeof bbDesktopBrowserAttachRequestSchema
>;

export const bbDesktopBrowserNavigateRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserNavigateRequest = z.infer<
  typeof bbDesktopBrowserNavigateRequestSchema
>;

export const bbDesktopBrowserSetBoundsRequestSchema = z
  .object({
    tabId: z.string().min(1),
    bounds: bbDesktopBrowserViewBoundsSchema,
  })
  .strict();
export type BbDesktopBrowserSetBoundsRequest = z.infer<
  typeof bbDesktopBrowserSetBoundsRequestSchema
>;

export const bbDesktopBrowserSetVisibleRequestSchema = z
  .object({
    tabId: z.string().min(1),
    visible: z.boolean(),
  })
  .strict();
export type BbDesktopBrowserSetVisibleRequest = z.infer<
  typeof bbDesktopBrowserSetVisibleRequestSchema
>;

/** Ref for tab-scoped commands with no other payload (detach/back/forward/reload/stop). */
export const bbDesktopBrowserTabRefSchema = z
  .object({
    tabId: z.string().min(1),
  })
  .strict();

/**
 * Current navigation state of a browser view, pushed main → renderer on every
 * relevant `webContents` event. A snapshot of live state — never a queue ladder.
 */
export const bbDesktopBrowserStateSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    errorText: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
  })
  .strict();
export type BbDesktopBrowserState = z.infer<typeof bbDesktopBrowserStateSchema>;

/**
 * Request from main → renderer to open a popup (`window.open`/`target=_blank`)
 * as a new in-panel browser tab. The native OS popup window is always denied.
 */
export const bbDesktopBrowserOpenTabRequestSchema = z
  .object({
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserOpenTabRequest = z.infer<
  typeof bbDesktopBrowserOpenTabRequestSchema
>;

/**
 * Source-attributed variant of {@link bbDesktopBrowserOpenTabRequestSchema}.
 * Emitted on a new channel so the legacy wire-frozen popup event can remain
 * unchanged for desktop/SPA version skew.
 */
export const bbDesktopBrowserScopedOpenTabRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type BbDesktopBrowserScopedOpenTabRequest = z.infer<
  typeof bbDesktopBrowserScopedOpenTabRequestSchema
>;

/**
 * Upper bound for a snapshot data URL. A JPEG of a full-window view on a 5K
 * display lands well under this; the cap exists so a misbehaving push can
 * never balloon renderer memory.
 */
export const BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH = 8_388_608;

/**
 * A transient bitmap of a browser view, pushed main → renderer at the start
 * of a native window resize burst while the native view is hidden (the
 * independently composited overlay cannot stay visually glued to the chrome
 * mid-resize). The renderer paints it inside the panel so it scales with the
 * chrome. `dataUrl: null` clears the placeholder once the resize settles and
 * the live view is shown again.
 */
export const bbDesktopBrowserSnapshotSchema = z
  .object({
    tabId: z.string().min(1),
    dataUrl: z
      .string()
      .max(BB_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH)
      .nullable(),
  })
  .strict();
export type BbDesktopBrowserSnapshot = z.infer<
  typeof bbDesktopBrowserSnapshotSchema
>;

/**
 * Cap on a favicon data URL. Favicons cross the wire as the page's own image
 * bytes, so this is the wire-side twin of the shell's byte cap
 * (`BB_DESKTOP_BROWSER_MAX_FAVICON_BYTES`): base64 expands by 4/3, and the value
 * leaves room for the `data:<mime>;base64,` prefix on top of that.
 */
export const BB_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH = 196_608;

/**
 * The icon a browser tab shows, pushed main → renderer when a page declares one
 * and `null` when a navigation leaves the previous page's icon stale.
 *
 * `dataUrl` is built by the shell from bytes **it** fetched inside the browsing
 * session, and its media type comes from the shell's allowlist rather than from
 * the response. The page-controlled favicon URL never reaches the trusted bb app,
 * which is what keeps a tab icon from becoming a beacon on the app's own origin,
 * a loopback/LAN probe carrying app credentials, or a `javascript:`/`data:`
 * payload of the page's choosing. See `resolveBrowserFaviconDataUrl` in
 * apps/desktop.
 */
export const bbDesktopBrowserFaviconSchema = z
  .object({
    tabId: z.string().min(1),
    dataUrl: z
      .string()
      .max(BB_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH)
      .nullable(),
  })
  .strict();
export type BbDesktopBrowserFavicon = z.infer<
  typeof bbDesktopBrowserFaviconSchema
>;

export type BbDesktopBrowserStateHandler = (
  state: BbDesktopBrowserState,
) => void;
export type BbDesktopBrowserFaviconHandler = (
  favicon: BbDesktopBrowserFavicon,
) => void;
export type BbDesktopBrowserOpenTabHandler = (
  request: BbDesktopBrowserOpenTabRequest,
) => void;
export type BbDesktopBrowserScopedOpenTabHandler = (
  request: BbDesktopBrowserScopedOpenTabRequest,
) => void;
export type BbDesktopBrowserSnapshotHandler = (
  snapshot: BbDesktopBrowserSnapshot,
) => void;
export type BbDesktopBrowserUnsubscribe = () => void;

export interface BbDesktopBrowserApi {
  /** Create (or reuse) and show the view for `tabId`, loading `url` if non-empty. */
  attach(request: BbDesktopBrowserAttachRequest): void;
  /** Destroy the view for `tabId` (tears down its `webContents`). */
  detach(tabId: string): void;
  navigate(request: BbDesktopBrowserNavigateRequest): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  setBounds(request: BbDesktopBrowserSetBoundsRequest): void;
  setVisible(request: BbDesktopBrowserSetVisibleRequest): void;
  /** Subscribe to navigation-state pushes for every view in this window. */
  onState(listener: BbDesktopBrowserStateHandler): BbDesktopBrowserUnsubscribe;
  /** Subscribe to popup requests that should open as a new in-panel browser tab. */
  onOpenTab(
    listener: BbDesktopBrowserOpenTabHandler,
  ): BbDesktopBrowserUnsubscribe;
  /**
   * Subscribe to popup requests with the originating browser tab id. Optional
   * for version skew with desktop shells that predate source-attributed popups.
   */
  onScopedOpenTab?(
    listener: BbDesktopBrowserScopedOpenTabHandler,
  ): BbDesktopBrowserUnsubscribe;
  /**
   * Subscribe to resize-burst snapshot pushes. Optional purely for version
   * skew: the SPA routinely attaches to an older desktop shell whose preload
   * predates snapshots (see the wire-freeze note on
   * {@link bbDesktopBrowserAttachRequestSchema}); callers feature-detect and
   * fall back to the bare panel background during resizes.
   */
  onSnapshot?(
    listener: BbDesktopBrowserSnapshotHandler,
  ): BbDesktopBrowserUnsubscribe;
  /**
   * Subscribe to tab favicon pushes. Optional for the same version skew as
   * {@link BbDesktopBrowserApi.onSnapshot} — an older shell's preload has no
   * favicon channel — and feature-detection here is the negotiation that lets
   * the icon ride a new channel instead of a new field on the wire-frozen state.
   * Callers fall back to a generic icon.
   */
  onFavicon?(
    listener: BbDesktopBrowserFaviconHandler,
  ): BbDesktopBrowserUnsubscribe;
}
