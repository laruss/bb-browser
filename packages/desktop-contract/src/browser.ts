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

/**
 * Caps on the page content a read returns. Unlike the other caps here these
 * bound what reaches an *agent's* context rather than what reaches the tab
 * strip, so they are sized for a page's readable text and for a deliberate
 * selection rather than for a title. Three layers must agree: the in-page
 * extraction slices to these lengths so a huge document never crosses the
 * process boundary, the main process re-truncates before answering, and the
 * schema below rejects anything longer. A caller wanting less is expected to
 * trim further for its own budget.
 */
export const BB_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH = 65_536;
export const BB_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH = 16_384;

/**
 * What a page read answers with.
 *
 * Failures are a typed variant rather than a rejection: this crosses `invoke`,
 * where a thrown error arrives as a mangled `Error invoking remote method …`
 * string carrying no structure a caller could branch on.
 *
 * Deliberately **not** `.strict()`, unlike the push payloads above. Those are
 * parsed by the shell's own preload; this one is parsed by the SPA, which
 * routinely runs against a *newer* shell (invariant 2 in
 * docs/architecture/bb-migration.md). Zod's default strip lets a later shell add
 * a field without needing yet another channel, and `.catch` on `reason` keeps an
 * unknown future reason from failing the whole parse.
 *
 * On success, `text` and `selection` are page-controlled content — the document
 * chooses both. The caps and the two truncation flags are the whole defence;
 * nothing sanitizes this and no consumer may treat it as trusted. The flags are
 * separate because a caller that asked for a selection should not have to guess
 * which of the two was cut.
 */
export const bbDesktopBrowserPageReadResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    text: z.string().max(BB_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
    textTruncated: z.boolean(),
    selection: z.string().max(BB_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH),
    selectionTruncated: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` — the tab has no live `WebContentsView` (never attached this
     * session, or destroyed). `no-page` — attached but nothing loaded yet.
     * `timeout` — the page never answered. `unreadable` — anything else.
     */
    reason: z
      .enum(["no-view", "no-page", "timeout", "unreadable"])
      .catch("unreadable"),
  }),
]);
export type BbDesktopBrowserPageReadResult = z.infer<
  typeof bbDesktopBrowserPageReadResultSchema
>;

/**
 * Cap on a rendered accessibility snapshot. Larger than the page-text cap
 * because a snapshot is what an agent acts from — losing the element it needs
 * costs it a round trip — but still bounded: this is attacker-shaped content
 * (roles and labels a page chooses) on its way into a model's context.
 */
export const BB_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH = 65_536;

/**
 * Ask for a snapshot. `maxDepth` trades completeness for size on deep pages;
 * both bounds stay the shell's own constants otherwise, so nothing a caller
 * supplies reaches the page.
 */
export const bbDesktopBrowserSnapshotRequestSchema = z
  .object({
    tabId: z.string().min(1),
    maxDepth: z.number().int().positive().max(100).optional(),
  })
  .strict();
export type BbDesktopBrowserSnapshotRequest = z.infer<
  typeof bbDesktopBrowserSnapshotRequestSchema
>;

/**
 * The accessibility snapshot of one tab, and the refs it handed out.
 *
 * `generation` is the load-bearing field. Refs name nodes in the document that
 * produced them, so a navigation invalidates all of them; a caller that acts on
 * a ref must pass back the generation it was given, and the shell refuses the
 * command if it has moved on. Resolving a stale ref against whatever holds that
 * node id now would click the wrong thing silently, which is worse than failing.
 */
export const bbDesktopBrowserSnapshotResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    snapshot: z.string().max(BB_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH),
    generation: z.number().int().nonnegative(),
    refCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` as for page reads. `debugger-unavailable` — the
     * browser debugger could not be attached, DevTools holding the tab being
     * the realistic cause. `failed` — anything else.
     */
    reason: z
      .enum(["no-view", "no-page", "debugger-unavailable", "failed"])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type BbDesktopBrowserSnapshotResult = z.infer<
  typeof bbDesktopBrowserSnapshotResultSchema
>;

/** A page's `alert()` message is page-controlled text; bound it like a title. */
export const BB_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH = 4096;

/**
 * A JavaScript dialog the page has opened and is now blocked on.
 *
 * Once the shell takes dialogs over (it does, per tab, from the moment the
 * browser debugger attaches) Chromium stops drawing its own native modal, so
 * this is what the app must render instead. `dialog: null` means the tab has
 * none open — the same channel reports both, so a listener cannot miss the
 * close.
 *
 * `message` and `defaultPrompt` are written by the page. They are shown to a
 * human and handed to agents; nothing about them is trustworthy.
 */
export const bbDesktopBrowserDialogSchema = z
  .object({
    tabId: z.string().min(1),
    dialog: z
      .object({
        type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
        message: z
          .string()
          .max(BB_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH),
        defaultPrompt: z
          .string()
          .max(BB_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH),
      })
      .nullable(),
  })
  .strict();
export type BbDesktopBrowserDialog = z.infer<
  typeof bbDesktopBrowserDialogSchema
>;

/**
 * Answer the dialog a tab is blocked on. `promptText` is only meaningful for a
 * `prompt`, and only when accepting.
 */
export const bbDesktopBrowserDialogRespondRequestSchema = z
  .object({
    tabId: z.string().min(1),
    accept: z.boolean(),
    promptText: z
      .string()
      .max(BB_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH)
      .optional(),
  })
  .strict();
export type BbDesktopBrowserDialogRespondRequest = z.infer<
  typeof bbDesktopBrowserDialogRespondRequestSchema
>;

export type BbDesktopBrowserDialogHandler = (
  dialog: BbDesktopBrowserDialog,
) => void;

/**
 * Caps on what an interaction may carry into a page.
 *
 * `fill` replaces a field's value in one shot, so it can afford a large bound.
 * `type` sends one key event per character, so its bound is what keeps a single
 * command from spending minutes in the main process. Uploads and select values
 * are counted rather than sized: the interesting limit there is how many, not
 * how long.
 */
export const BB_DESKTOP_BROWSER_MAX_FILL_TEXT_LENGTH = 8_192;
export const BB_DESKTOP_BROWSER_MAX_TYPE_TEXT_LENGTH = 1_024;
export const BB_DESKTOP_BROWSER_MAX_UPLOAD_FILES = 10;
export const BB_DESKTOP_BROWSER_MAX_SELECT_VALUES = 20;
/** Widest viewport an emulated resize may ask for; beyond this is not a page. */
export const BB_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE = 10_000;

/**
 * A `[ref=eN]` handed out by a snapshot. Shaped, not free-form, so a ref that
 * was never a ref is refused here rather than looked up.
 */
const bbDesktopBrowserRefSchema = z.string().regex(/^e[1-9][0-9]{0,5}$/u);

const bbDesktopBrowserKeyModifierSchema = z.enum([
  "Alt",
  "Control",
  "Meta",
  "Shift",
]);

/**
 * What to do to a page.
 *
 * One union rather than a channel per verb: every one of these needs the same
 * preamble (resolve the ref, check the snapshot generation, wait for the element
 * to be actionable), and splitting them would duplicate that preamble nine
 * times across a wire-frozen boundary.
 *
 * `check` and `select` are semantic rather than positional because they cannot
 * be positional: a native `<select>` opens an OS popup no synthetic mouse event
 * reaches, and "click the checkbox" is a toggle, which is the wrong primitive
 * for an agent that wants a known end state.
 */
export const bbDesktopBrowserInteractionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("click"),
    ref: bbDesktopBrowserRefSchema,
    button: z.enum(["left", "middle", "right"]),
    /** 2 is a double click; Chromium wants the count on the event itself. */
    clickCount: z.union([z.literal(1), z.literal(2)]),
    modifiers: z.array(bbDesktopBrowserKeyModifierSchema).max(4),
  }),
  z.object({ action: z.literal("hover"), ref: bbDesktopBrowserRefSchema }),
  z.object({
    action: z.literal("drag"),
    ref: bbDesktopBrowserRefSchema,
    targetRef: bbDesktopBrowserRefSchema,
  }),
  z.object({
    action: z.literal("fill"),
    ref: bbDesktopBrowserRefSchema,
    text: z.string().max(BB_DESKTOP_BROWSER_MAX_FILL_TEXT_LENGTH),
  }),
  z.object({
    action: z.literal("type"),
    ref: bbDesktopBrowserRefSchema,
    text: z.string().max(BB_DESKTOP_BROWSER_MAX_TYPE_TEXT_LENGTH),
  }),
  z.object({
    action: z.literal("press"),
    /** Null presses the key at whatever the page has focused. */
    ref: bbDesktopBrowserRefSchema.nullable(),
    key: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("select"),
    ref: bbDesktopBrowserRefSchema,
    values: z
      .array(z.string().max(BB_DESKTOP_BROWSER_MAX_TYPE_TEXT_LENGTH))
      .min(1)
      .max(BB_DESKTOP_BROWSER_MAX_SELECT_VALUES),
  }),
  z.object({
    action: z.literal("check"),
    ref: bbDesktopBrowserRefSchema,
    /** The end state, not a toggle, so repeating the command is harmless. */
    checked: z.boolean(),
  }),
  z.object({
    action: z.literal("upload"),
    ref: bbDesktopBrowserRefSchema,
    /**
     * Absolute paths on the machine running the shell. This hands a web page
     * the contents of local files; see docs/architecture/browser-automation.md
     * for what that does and does not add to bb's threat model.
     */
    paths: z
      .array(z.string().min(1).max(1024))
      .min(1)
      .max(BB_DESKTOP_BROWSER_MAX_UPLOAD_FILES),
  }),
  z.object({
    action: z.literal("resize"),
    /** Both zero restores the tab to the panel's own size. */
    width: z.number().int().nonnegative().max(BB_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE),
    height: z
      .number()
      .int()
      .nonnegative()
      .max(BB_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE),
  }),
]);
export type BbDesktopBrowserInteraction = z.infer<
  typeof bbDesktopBrowserInteractionSchema
>;

/**
 * Perform one interaction on a tab.
 *
 * `generation` is the snapshot the refs came from. It is **optional**, and the
 * tradeoff is worth stating: navigation already drops every ref, so the
 * dangerous case — acting on an element that no longer exists — is closed
 * either way. What the generation adds is protection against a *newer* snapshot
 * having reassigned `e5` to a different element between the caller reading it
 * and acting on it. A caller that passes it gets that check; one that omits it
 * accepts the race in exchange for not having to thread the value through.
 */
export const bbDesktopBrowserInteractRequestSchema = z
  .object({
    tabId: z.string().min(1),
    generation: z.number().int().nonnegative().optional(),
    interaction: bbDesktopBrowserInteractionSchema,
  })
  .strict();
export type BbDesktopBrowserInteractRequest = z.infer<
  typeof bbDesktopBrowserInteractRequestSchema
>;

/**
 * What an interaction answers with. Success carries where the tab ended up,
 * because the most common interaction — clicking a link or submitting a form —
 * changes it, and a caller that had to ask separately would race the next
 * navigation.
 */
export const bbDesktopBrowserInteractResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    tabId: z.string().min(1),
    url: z.string().max(BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
  }),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` / `debugger-unavailable` as elsewhere.
     * `stale-refs` — the snapshot those refs came from is no longer current.
     * `unknown-ref` — no such ref in the current snapshot; snapshot again.
     * `not-actionable` — the element never became clickable; `message` says why
     * (covered, disabled, still animating).
     * `unsupported-key` — the key name is not one the shell can emit.
     */
    reason: z
      .enum([
        "no-view",
        "no-page",
        "debugger-unavailable",
        "stale-refs",
        "unknown-ref",
        "not-actionable",
        "unsupported-key",
        "failed",
      ])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type BbDesktopBrowserInteractResult = z.infer<
  typeof bbDesktopBrowserInteractResultSchema
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
  /**
   * Read what a tab is currently showing — url, title, rendered text and the
   * user's selection.
   *
   * The only request/response method on this API; every other command is
   * fire-and-forget because nothing needed an answer until agents did. It never
   * rejects: transport, parse and page failures all come back as `ok: false`.
   *
   * The request is `tabId` and nothing else, deliberately. Any per-call knob
   * (a length, a selector, a format) would have to reach the script injected
   * into an untrusted page, which is a script-injection surface inside our own
   * privileged snippet. Limits are compile-time constants; a caller wanting less
   * trims what it gets back.
   *
   * Optional for the same version skew as {@link BbDesktopBrowserApi.onSnapshot}
   * and {@link BbDesktopBrowserApi.onFavicon}: an older shell's preload has no
   * read-page channel, and feature-detecting this method is the negotiation that
   * lets page reads ride a new channel instead of widening a wire-frozen request.
   * This is that pattern's first request/response instance.
   */
  readPage?(tabId: string): Promise<BbDesktopBrowserPageReadResult>;
  /**
   * Accessibility snapshot of the tab, with a ref on every interactive element,
   * for agents that need to act on the page rather than only read it.
   *
   * Optional for the same version skew as {@link BbDesktopBrowserApi.readPage}:
   * a shell that predates the browser debugger has no such channel, and callers
   * feature-detect rather than assume.
   */
  snapshot?(
    request: BbDesktopBrowserSnapshotRequest,
  ): Promise<BbDesktopBrowserSnapshotResult>;
  /**
   * Subscribe to JavaScript dialogs the shell has taken over, and to their
   * closing (`dialog: null`). Optional for version skew, like the pushes above.
   *
   * A tab whose debugger is not attached never emits these — its dialogs are
   * still Chromium's own native modals, which is what keeps ordinary browsing
   * unchanged until an agent touches the tab.
   */
  onDialog?(
    listener: BbDesktopBrowserDialogHandler,
  ): BbDesktopBrowserUnsubscribe;
  /**
   * Answer the dialog a tab is blocked on. Resolves false when the tab has no
   * dialog open — including when another answer won the race.
   */
  respondToDialog?(
    request: BbDesktopBrowserDialogRespondRequest,
  ): Promise<boolean>;
  /**
   * Act on the page — click, fill, press, and the rest — addressing elements by
   * the refs a {@link BbDesktopBrowserApi.snapshot} handed out.
   *
   * Waits for the element to be actionable before acting, so a caller does not
   * have to poll or sleep; the wait is what turns an action from a race into a
   * command. Optional for the same version skew as the methods above.
   */
  interact?(
    request: BbDesktopBrowserInteractRequest,
  ): Promise<BbDesktopBrowserInteractResult>;
}
