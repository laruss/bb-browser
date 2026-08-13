import { z } from "zod";

/**
 * The vocabulary an agent uses to drive the browser surface.
 *
 * It lives in `@bb/domain` because both ends need it and neither owns it: the
 * server sends commands (`@bb/server-contract` wraps these in a WS signal), the
 * app executes them against its tab store and the Electron bridge, and the app
 * sends outcomes back (`clientMessageSchema` in ./change-kinds.ts wraps those).
 *
 * Commands originate from a language model, so they are untrusted input and get
 * parsed like any other wire payload rather than trusted because they came from
 * "our own" server.
 *
 * Unlike the desktop IPC contract (invariant 2 in
 * docs/architecture/bb-migration.md) this wire carries no version skew: the
 * server serves the SPA, so both ends always ship together.
 */

/** Mirrors BB_DESKTOP_BROWSER_MAX_URL_LENGTH; the two must not drift. */
export const BROWSER_COMMAND_MAX_URL_LENGTH = 4096;
export const BROWSER_COMMAND_MAX_TITLE_LENGTH = 1024;
/**
 * Upper bound on text one `page.get_text` may return. The shell caps what it
 * reads out of a page; this caps what an agent may ask to keep, and a caller
 * wanting less passes a smaller `maxLength`.
 */
export const BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH = 65_536;

/**
 * What the browser knows about one surface tab.
 *
 * `live` is the load-bearing one: a tab only has a native view once it has been
 * the active tab while the browser surface was mounted. Tab bookkeeping works
 * for every tab; reading a page or replaying its history only works for a live
 * one. When `live` is false the navigation flags are false because they are
 * unknown, not because the answer is no.
 */
export const browserTabSnapshotSchema = z.object({
  tabId: z.string().min(1),
  url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
  title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
  active: z.boolean(),
  live: z.boolean(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
});
export type BrowserTabSnapshot = z.infer<typeof browserTabSnapshotSchema>;

/**
 * A null `tabId` means "the active tab" everywhere it appears, so an agent that
 * has not tracked tab ids can still work the browser it is looking at.
 */
const optionalTabIdSchema = z.string().min(1).nullable();

/**
 * Caps on what an interaction carries. These mirror the desktop contract's
 * (`BB_DESKTOP_BROWSER_MAX_FILL_TEXT_LENGTH` and its neighbours) and must not
 * drift: this schema is the agent-facing wire and that one is the shell wire,
 * and the app translates between them without re-checking sizes.
 */
export const BROWSER_COMMAND_MAX_FILL_TEXT_LENGTH = 8_192;
export const BROWSER_COMMAND_MAX_TYPE_TEXT_LENGTH = 1_024;
export const BROWSER_COMMAND_MAX_UPLOAD_FILES = 10;
export const BROWSER_COMMAND_MAX_SELECT_VALUES = 20;
export const BROWSER_COMMAND_MAX_VIEWPORT_SIZE = 10_000;

const browserRefSchema = z.string().regex(/^e[1-9][0-9]{0,5}$/u);
const browserKeyModifierSchema = z.enum(["Alt", "Control", "Meta", "Shift"]);

/**
 * What to do to a page, addressed through the `[ref=eN]` markers a snapshot
 * handed out.
 *
 * Structurally identical to the desktop contract's interaction union so the app
 * forwards it rather than rebuilding it field by field — the two are separate
 * because only one of them is version-skewed (the shell can be older than the
 * SPA), not because they say different things.
 */
export const browserInteractionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("click"),
    ref: browserRefSchema,
    button: z.enum(["left", "middle", "right"]),
    clickCount: z.union([z.literal(1), z.literal(2)]),
    modifiers: z.array(browserKeyModifierSchema).max(4),
  }),
  z.object({ action: z.literal("hover"), ref: browserRefSchema }),
  z.object({
    action: z.literal("drag"),
    ref: browserRefSchema,
    targetRef: browserRefSchema,
  }),
  z.object({
    action: z.literal("fill"),
    ref: browserRefSchema,
    text: z.string().max(BROWSER_COMMAND_MAX_FILL_TEXT_LENGTH),
  }),
  z.object({
    action: z.literal("type"),
    ref: browserRefSchema,
    text: z.string().max(BROWSER_COMMAND_MAX_TYPE_TEXT_LENGTH),
  }),
  z.object({
    action: z.literal("press"),
    ref: browserRefSchema.nullable(),
    key: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("select"),
    ref: browserRefSchema,
    values: z
      .array(z.string().max(BROWSER_COMMAND_MAX_TYPE_TEXT_LENGTH))
      .min(1)
      .max(BROWSER_COMMAND_MAX_SELECT_VALUES),
  }),
  z.object({
    action: z.literal("check"),
    ref: browserRefSchema,
    checked: z.boolean(),
  }),
  z.object({
    action: z.literal("upload"),
    ref: browserRefSchema,
    paths: z
      .array(z.string().min(1).max(1024))
      .min(1)
      .max(BROWSER_COMMAND_MAX_UPLOAD_FILES),
  }),
  z.object({
    action: z.literal("resize"),
    width: z.number().int().nonnegative().max(BROWSER_COMMAND_MAX_VIEWPORT_SIZE),
    height: z
      .number()
      .int()
      .nonnegative()
      .max(BROWSER_COMMAND_MAX_VIEWPORT_SIZE),
  }),
]);
export type BrowserInteraction = z.infer<typeof browserInteractionSchema>;

export const browserCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tabs.list") }),
  z.object({
    type: z.literal("tabs.open"),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH).nullable(),
    activate: z.boolean(),
  }),
  z.object({ type: z.literal("tabs.close"), tabId: z.string().min(1) }),
  z.object({ type: z.literal("tabs.activate"), tabId: z.string().min(1) }),
  z.object({ type: z.literal("page.get_url"), tabId: optionalTabIdSchema }),
  z.object({ type: z.literal("page.get_title"), tabId: optionalTabIdSchema }),
  z.object({
    type: z.literal("page.get_text"),
    tabId: optionalTabIdSchema,
    maxLength: z
      .number()
      .int()
      .positive()
      .max(BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH),
  }),
  z.object({
    type: z.literal("page.get_selection"),
    tabId: optionalTabIdSchema,
  }),
  z.object({
    type: z.literal("page.handle_dialog"),
    tabId: optionalTabIdSchema,
    accept: z.boolean(),
    promptText: z.string().max(4096).nullable(),
  }),
  z.object({
    type: z.literal("page.snapshot"),
    tabId: optionalTabIdSchema,
    maxDepth: z.number().int().positive().max(100).nullable(),
  }),
  z.object({
    type: z.literal("page.interact"),
    tabId: optionalTabIdSchema,
    /**
     * Which snapshot the refs came from, or null to skip the check. Navigation
     * drops every ref regardless, so this only guards the narrower case where a
     * newer snapshot has reassigned the same ref to a different element.
     */
    generation: z.number().int().nonnegative().nullable(),
    interaction: browserInteractionSchema,
  }),
  z.object({
    type: z.literal("navigation.open"),
    tabId: optionalTabIdSchema,
    url: z.string().min(1).max(BROWSER_COMMAND_MAX_URL_LENGTH),
    newTab: z.boolean(),
  }),
  z.object({ type: z.literal("navigation.back"), tabId: optionalTabIdSchema }),
  z.object({
    type: z.literal("navigation.forward"),
    tabId: optionalTabIdSchema,
  }),
  z.object({
    type: z.literal("navigation.reload"),
    tabId: optionalTabIdSchema,
  }),
]);
export type BrowserCommand = z.infer<typeof browserCommandSchema>;
export type BrowserCommandType = BrowserCommand["type"];

/**
 * Command results. Most commands answer with the tab they acted on, so the
 * agent sees the outcome (the settled URL after a navigation, say) without a
 * second round trip.
 */
export const browserCommandValueSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tabs"),
    tabs: z.array(browserTabSnapshotSchema),
  }),
  z.object({ type: z.literal("tab"), tab: browserTabSnapshotSchema }),
  z.object({
    type: z.literal("closed"),
    closedTabId: z.string(),
    tabs: z.array(browserTabSnapshotSchema),
  }),
  z.object({ type: z.literal("url"), url: z.string() }),
  z.object({ type: z.literal("answered"), answered: z.boolean() }),
  z.object({ type: z.literal("title"), title: z.string().nullable() }),
  z.object({
    type: z.literal("text"),
    text: z.string().max(BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH),
    truncated: z.boolean(),
  }),
  z.object({
    /**
     * Where the tab ended up after the action. Clicking a link or submitting a
     * form is the common case, so answering with the page saves the caller a
     * follow-up read it would otherwise race against the navigation.
     */
    type: z.literal("interacted"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
  }),
  z.object({
    type: z.literal("snapshot"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    snapshot: z.string().max(BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH),
    /**
     * Which snapshot the refs belong to. Interaction commands will carry it
     * back so a ref from a page that has since navigated is refused rather than
     * resolved against whatever holds that node id now.
     */
    generation: z.number().int().nonnegative(),
    refCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
]);
export type BrowserCommandValue = z.infer<typeof browserCommandValueSchema>;

/**
 * Why a command could not be performed. Each one exists because it implies a
 * different next move for whoever asked — an agent that gets `tab_not_live` can
 * fix it by activating the tab, one that gets `desktop_unavailable` cannot fix
 * it at all and should say so instead of retrying.
 */
export const browserCommandErrorCodeSchema = z.enum([
  /** No tab is active, so a null tabId resolves to nothing. */
  "no_active_tab",
  /** The tab id names no open tab. */
  "unknown_tab",
  /** The tab has no native view: never activated this session, or destroyed. */
  "tab_not_live",
  /** Running outside the desktop app, where there is no browser at all. */
  "desktop_unavailable",
  /** This desktop build predates the capability (an older shell's preload). */
  "unsupported_command",
  /** The URL is not something the browser will open (http/https only). */
  "blocked_url",
  /** The page did not answer in time. */
  "page_read_timeout",
  /** The page answered with something unusable. */
  "page_read_failed",
  /** The browser debugger could not be attached — DevTools holds the tab. */
  "debugger_unavailable",
  /** The refs came from a snapshot the page has since moved past. */
  "stale_refs",
  /** No such ref in the tab's current snapshot. */
  "unknown_ref",
  /** The element never became clickable: covered, hidden, disabled, moving. */
  "not_actionable",
  /** The key named is not one the browser can press. */
  "unsupported_key",
  /** The command or its parameters did not parse. */
  "invalid_command",
]);
export type BrowserCommandErrorCode = z.infer<
  typeof browserCommandErrorCodeSchema
>;

export const browserCommandOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: browserCommandValueSchema }),
  z.object({
    ok: z.literal(false),
    code: browserCommandErrorCodeSchema,
    message: z.string().max(1024),
  }),
]);
export type BrowserCommandOutcome = z.infer<typeof browserCommandOutcomeSchema>;
