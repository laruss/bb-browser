import type Database from "better-sqlite3";
import type { Context } from "hono";
import type * as z from "zod";
import type { BbSdk } from "@bb/sdk";
import type { ThreadResponse } from "@bb/server-contract";
import type { JsonValue } from "./json-value.js";
import type { PluginRpcContract, PluginRpcHandlers } from "./rpc-contract.js";

/**
 * The backend plugin API contract — the `bb` object handed to a plugin's
 * `server.ts` factory (`export default function plugin(bb: BbPluginApi)`).
 *
 * Types only: the implementation lives in the BB server
 * (apps/server/src/services/plugins/plugin-api.ts), which imports these
 * shapes so the contract and the implementation cannot drift. Plugin authors
 * import them type-only (`import type { BbPluginApi } from
 * "@bb/plugin-sdk"`); the import is erased when BB loads the file.
 *
 * Runtime classes stay host-side. NeedsConfigurationError in particular is
 * matched by NAME, so plugin code needs no runtime import:
 * `throw Object.assign(new Error(msg), { name: "NeedsConfigurationError" })`.
 */

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Settings (design §4.2).
// ---------------------------------------------------------------------------

/**
 * Declarative settings descriptors (`bb.settings.define`). Deliberately plain
 * data — not zod — so the host can render settings forms and the CLI can
 * parse values without executing plugin code.
 */
export type PluginSettingDescriptor =
  | {
      type: "string";
      label: string;
      description?: string;
      /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
      secret?: true;
      default?: string;
    }
  | { type: "boolean"; label: string; description?: string; default?: boolean }
  | {
      type: "select";
      label: string;
      description?: string;
      options: string[];
      default?: string;
    }
  | { type: "project"; label: string; description?: string; default?: string };

export type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;

export type PluginSettingValue = string | boolean;

/** `default` present → non-optional value; absent → `T | undefined`. */
export type PluginSettingsValues<
  Ds extends Record<string, PluginSettingDescriptor>,
> = {
  [K in keyof Ds]: Ds[K] extends { default: string | boolean }
    ? PluginSettingValueOf<Ds[K]>
    : PluginSettingValueOf<Ds[K]> | undefined;
};

type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
  type: "boolean";
}
  ? boolean
  : string;

export interface PluginSettingsHandle<
  Ds extends Record<string, PluginSettingDescriptor>,
> {
  /** Load-safe: callable inside the factory. */
  get(): Promise<PluginSettingsValues<Ds>>;
  /** Fires after values change through the settings route/CLI. */
  onChange(
    listener: (
      next: PluginSettingsValues<Ds>,
      prev: PluginSettingsValues<Ds>,
    ) => void,
  ): void;
}

export interface PluginSettings {
  define<Ds extends Record<string, PluginSettingDescriptor>>(
    descriptors: Ds,
  ): PluginSettingsHandle<Ds>;
}

// ---------------------------------------------------------------------------
// Storage (design §4.3).
// ---------------------------------------------------------------------------

export interface PluginKvStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginStorage {
  /** Namespaced JSON key-value rows in bb.db; values ≤256KB each. */
  kv: PluginKvStorage;
  /**
   * Open (or reuse the path of) the plugin's own SQLite database at
   * <dataDir>/plugins/<id>/data.db — the server's better-sqlite3, WAL mode,
   * busy_timeout 5000. Handles are host-tracked and closed on
   * dispose/reload; a closed handle throws on use.
   */
  database(): Database.Database;
  /**
   * Ordered-statement migration helper: statement index = migration id in a
   * `_bb_migrations` table; unapplied statements run in one transaction.
   * Append-only — never reorder or edit shipped statements.
   */
  migrate(db: Database.Database, statements: string[]): void;
}

// ---------------------------------------------------------------------------
// Thread lifecycle events (design §4.5).
// ---------------------------------------------------------------------------

/**
 * Thread lifecycle events a plugin can observe (design §4.5). Observe-only:
 * handlers run fire-and-forget after the transition is applied and can never
 * block or veto it. `thread` is the same public DTO GET /threads/:id serves.
 */
export interface PluginThreadEventPayloads {
  /** Fired after a thread row is created. */
  "thread.created": { thread: ThreadResponse };
  /** Fired when a thread transitions into `active`. */
  "thread.active": { thread: ThreadResponse };
  /** Fired when a thread transitions into `idle`. `lastAssistantText` is
   * assembled the same way GET /threads/:id/output is. */
  "thread.idle": { thread: ThreadResponse; lastAssistantText: string | null };
  /** Fired when a thread transitions into `error`. `error` is the latest
   * system/error event message, when one exists. */
  "thread.failed": { thread: ThreadResponse; error: string | null };
  /** Fired after a thread is archived (including cascade archives). */
  "thread.archived": { thread: ThreadResponse };
  /** Fired after a thread is soft-deleted. */
  "thread.deleted": { thread: ThreadResponse };
}

export type PluginThreadEventName = keyof PluginThreadEventPayloads;

export type PluginThreadEventHandler<E extends PluginThreadEventName> = (
  payload: PluginThreadEventPayloads[E],
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Wire surfaces: HTTP, rpc, realtime (design §4.6/§4.7).
// ---------------------------------------------------------------------------

export type PluginHttpAuthMode = "local" | "token" | "none";

export type PluginHttpHandler = (
  context: Context,
) => Response | Promise<Response>;

export interface PluginHttp {
  /**
   * Register an HTTP route, mounted at
   * `/api/v1/plugins/<id>/http/<path>`. Auth modes (default "local"):
   * - "local": Origin/Host must be a local BB app origin; non-GET requires
   *   content-type application/json (forces a CORS preflight).
   * - "token": requires the per-plugin token (`bb plugin token <id>`) via
   *   the x-bb-plugin-token header or ?token=.
   * - "none": no checks — only for signature-verified webhooks.
   */
  route(
    method: string,
    path: string,
    handler: PluginHttpHandler,
    opts?: { auth?: PluginHttpAuthMode },
  ): void;
}

export interface PluginRpc {
  /**
   * Register a Standard Schema-driven rpc contract and its inferred handlers,
   * served at POST
   * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
   * host validates input before invocation and output before strict JSON
   * serialization. The response is `{ ok: true, result }` or
   * `{ ok: false, error: { code, message, issues? } }`.
   */
  register<Contract extends PluginRpcContract>(
    contract: Contract,
    handlers: PluginRpcHandlers<Contract>,
  ): void;
}

export interface PluginRealtime {
  /**
   * Broadcast an ephemeral `plugin-signal` WS message
   * `{ pluginId, channel, payload }` to every connected client (V1 has no
   * per-channel subscriptions). `payload` must be JSON-serializable;
   * `undefined` is normalized to `null`. Nothing is persisted.
   */
  publish(channel: string, payload: unknown): void;
}

// ---------------------------------------------------------------------------
// Background services and schedules (design §4.8).
// ---------------------------------------------------------------------------

export interface PluginBackground {
  /**
   * Register a long-lived background service. `start` runs after the
   * factory completes and should resolve when `signal` aborts
   * (dispose/reload/disable/shutdown). A crash restarts it with capped
   * exponential backoff; throwing NeedsConfigurationError marks the plugin
   * `needs-configuration` and stops restarting until the next load.
   */
  service(
    name: string,
    service: { start(signal: AbortSignal): void | Promise<void> },
  ): void;
  /**
   * Register a cron schedule (5-field expression, server-local time). The
   * durable row keyed (pluginId, name) is upserted at load; the periodic
   * sweep claims due rows with a CAS on next_run_at, but only while this
   * plugin is loaded. Failures land in last_status/last_error, visible in
   * `bb plugin list`.
   */
  schedule(name: string, cron: string, fn: () => void | Promise<void>): void;
}

// ---------------------------------------------------------------------------
// Agent-facing CLI subcommands (design §4.4).
// ---------------------------------------------------------------------------

export interface PluginCliCommandInfo {
  name: string;
  summary: string;
  usage: string;
}

/** Context forwarded from the invoking CLI when known; all fields optional. */
export interface PluginCliContext {
  cwd?: string;
  threadId?: string;
  projectId?: string;
  /** Aborted when the invoking CLI HTTP request disconnects. */
  signal?: AbortSignal;
}

export type PluginInteractionCancelReason =
  | "user"
  | "request-aborted"
  | "thread-stopped"
  | "thread-deleted"
  | "plugin-disposed"
  | "server-restarted"
  | "timeout";

export type PluginInteractionResult =
  | { outcome: "submitted"; value: JsonValue }
  | { outcome: "cancelled"; reason: PluginInteractionCancelReason };

export interface PluginInteractionRequest {
  threadId: string;
  rendererId: string;
  title: string;
  payload: JsonValue;
  /** Defaults to ten minutes; capped at one hour. */
  timeoutMs?: number;
}

export interface PluginCliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Maximum combined UTF-8 bytes accepted from plugin CLI stdout and stderr.
 * This is the shared source of truth for production and the testing harness.
 */
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;

export interface PluginCliOutputLimitError {
  code: "plugin_cli_output_too_large";
  message: string;
  maxBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  totalBytes: number;
}

/** Normalized host result returned by the plugin CLI HTTP/testing boundary. */
export interface PluginCliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: PluginCliOutputLimitError;
}

export interface PluginCliRegistration {
  /** Top-level command name (`bb <name> …`): lowercase [a-z0-9-]+, and not
   * a core bb command (see RESERVED_BB_CLI_COMMANDS in the server). */
  name: string;
  summary: string;
  /** Subcommand metadata rendered in help and the plugin-commands skill
   * without executing plugin code. Parsing argv is plugin-owned. */
  commands?: PluginCliCommandInfo[];
  run(
    argv: string[],
    ctx: PluginCliContext,
  ): PluginCliResult | Promise<PluginCliResult>;
}

export interface PluginCli {
  /**
   * Register this plugin's `bb` subcommand. One registration per factory
   * execution; a repeated call is rejected. Core bb commands always win
   * name collisions; reserved names are rejected at registration.
   */
  register(registration: PluginCliRegistration): void;
}

// ---------------------------------------------------------------------------
// Agent surfaces: per-turn context and native tools (design §4.4).
// ---------------------------------------------------------------------------

/** Per-turn context handed to bb.agents context providers (design §4.4). */
/** MCP-style content parts a native tool may return (design §4.4). */
export type PluginAgentToolContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type PluginAgentToolResult =
  | string
  | { content: PluginAgentToolContentPart[]; isError?: boolean };

/** Per-call context handed to a native tool's execute (design §4.4). */
export interface PluginAgentToolContext {
  threadId: string;
  projectId: string;
  /** The tool-call request's abort signal (aborts if the daemon round-trip
   * is torn down mid-call). */
  signal: AbortSignal;
}

/**
 * Native timeline labels for a plugin tool, keyed by BB's own timeline row
 * status. This is experimental: BB may refine its presentation contract
 * before the field is stabilized.
 */
export interface PluginAgentToolExperimentalStatusLabels {
  /** Label shown while the tool call is pending. */
  pending: string;
  /** Label shown after the tool call completes successfully. */
  completed: string;
}

export interface PluginAgentToolRegistrationBase {
  /** Tool name shown to the model: [a-zA-Z0-9_-]+, unique across plugins,
   * and not a built-in dynamic tool (see RESERVED_AGENT_TOOL_NAMES in the
   * server). */
  name: string;
  description: string;
  /**
   * Optional usage snippet appended to the thread instructions whenever
   * this tool is in the session's tool set (mirrors the built-in
   * update_environment_directory guidance). Limited to 4096 characters.
   */
  instructions?: string;
  /**
   * Optional native timeline labels. When omitted, BB shows the standard
   * tool name and arguments (for example, `Ran tool search_docs …`). Labels
   * apply only while the call is pending and after successful completion;
   * approval, error, and interruption states keep BB's standard rendering.
   */
  experimental_statusLabels?: PluginAgentToolExperimentalStatusLabels;
}

/** Stable, plain-data context resolved by the server for one agent session. */
export interface PluginAgentConfigurationContext {
  thread: {
    id: string;
    title: string | null;
    parentThreadId: string | null;
    sourceThreadId: string | null;
  };
  project: {
    id: string;
    kind: "standard" | "personal";
    name: string;
    gitRemoteUrl: string | null;
  };
  environment: {
    id: string;
    name: string | null;
    path: string | null;
    workspaceProvisionType: "unmanaged" | "managed-worktree" | "personal";
    branchName: string | null;
  };
  host: {
    id: string;
    name: string;
  };
  provider: {
    id: string;
    model: string;
  };
  /** How the thread was spawned. A side chat is the builtin side-chat
   * plugin's fork: `{ kind: "fork", pluginId: "side-chat" }`. */
  origin: {
    kind: "fork" | null;
    pluginId: string | null;
  };
}

/** Object form of a {@link PluginAgentConfiguration} tools entry: selects a
 * registered tool and overrides the parameter schema advertised to the
 * provider for this resolution only. */
export interface PluginAgentToolSelection {
  /** Name of a tool registered by this plugin via `registerTool`. */
  name: string;
  /** JSON-schema object (root `type: "object"`, JSON-serializable, at most
   * 128 KiB serialized) sent to the provider in place of the registered
   * parameter schema. Execution-side validation still runs the registered
   * parameters, so the override must only narrow what the registered schema
   * already accepts. */
  parameters: Record<string, unknown>;
}

/** Per-resolution selection returned by {@link PluginAgents.configure}. */
export interface PluginAgentConfiguration {
  /** Tool names registered by this plugin, or {@link PluginAgentToolSelection}
   * entries to also override a tool's advertised parameter schema for this
   * resolution. Duplicate or unknown names, or an invalid override, reject
   * this plugin's complete selection for the resolution. */
  tools: Array<string | PluginAgentToolSelection>;
  /** Skill frontmatter names from this plugin's manifest skill roots.
   * Duplicate or unknown names reject this plugin's complete selection. */
  skills: string[];
  /** Optional dynamic instructions. Output is truncated to 4096 characters. */
  instructions?: string;
}

export interface PluginAgents {
  /**
   * Select this plugin's statically registered tools and manifest skills for
   * each thread/session resolution, with optional dynamic instructions. The
   * callback is synchronous and runs at `thread.start` / `turn.submit`; it
   * never rebuilds registrations. Exactly one callback may be registered per
   * factory execution. A throw, malformed result, duplicate id, unknown id,
   * or more than 256 tool/skill ids fails closed for this plugin only.
   *
   * Tools take effect when the provider session is next started or resumed;
   * an already-running session is not hot-mutated. Instructions follow the
   * same boundary: a live provider session keeps the instructions it was
   * constructed with, and a changed selection applies when the session is
   * next constructed. Skill changes follow BB's environment runtime policy:
   * a busy runtime keeps its current catalog until a safe relaunch. Side chats
   * are ordinary plugin-owned forks here — read `origin` to detect them — and
   * their returned tool, skill, and dynamic-instruction selections apply at the
   * same boundaries.
   */
  configure(
    provider: (
      context: PluginAgentConfigurationContext,
    ) => PluginAgentConfiguration,
  ): void;
  /**
   * Register a native dynamic tool (design §4.4). `parameters` is either a
   * zod schema (validated per call; execute receives the parsed value) or a
   * plain JSON-schema object (no validation; execute receives the raw
   * arguments as `unknown`). Tool-set changes apply on the NEXT session
   * start — a tool registered mid-session is not hot-added to running
   * provider sessions. A second registration of the same name within this
   * plugin is rejected; a name already registered by another plugin is
   * rejected and surfaced as this plugin's status detail.
   */
  registerTool<Schema extends z.ZodType>(
    tool: PluginAgentToolRegistrationBase & {
      parameters: Schema;
      execute(
        params: z.output<Schema>,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
  registerTool(
    tool: PluginAgentToolRegistrationBase & {
      /** Raw JSON-schema escape hatch; params arrive unvalidated. */
      parameters: Record<string, unknown>;
      execute(
        params: unknown,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
  /**
   * Contribute a dynamic section appended to thread instructions. The
   * provider runs when a thread's runtime command config is resolved
   * (thread.start / turn.submit); return null to contribute nothing for
   * that resolution. A live provider session keeps the instructions it was
   * constructed with — a changed contribution takes effect when the
   * provider session is next constructed (thread start or resume after a
   * daemon restart, environment switch, or provider restart), never
   * mid-session. Must be synchronous and fast — it sits on the
   * thread-start path. Output longer than 4096 characters is truncated; a
   * throwing provider is logged against the plugin and contributes nothing.
   * A repeated registration within one factory execution is rejected.
   */
  contributeInstructions(
    provider: (ctx: { threadId: string; projectId: string }) => string | null,
  ): void;
}

// ---------------------------------------------------------------------------
// Host-rendered UI contributions (design §4.9).
// ---------------------------------------------------------------------------

export type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";

/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
export interface PluginMentionSearchContext {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

/** One row a mention provider returns from `search`. `id` is the provider's
 * own item id — the host namespaces it before it reaches the wire. */
export interface PluginMentionItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
}

export interface PluginMentionProviderRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
   * wire item ids as "<providerId>:<itemId>"). */
  id: string;
  /** Section label shown above this provider's rows in the mention menu. */
  label: string;
  /**
   * Composer trigger characters this provider should answer. Omit to use the
   * default `@` mention trigger. Valid triggers are `@`, `#`, `$`, `!`, and `~`.
   */
  triggers?: readonly PluginMentionTrigger[];
  /**
   * Runs server-side as the user types after one of this provider's triggers
   * in the composer. Each call is time-boxed (2s) and failure-isolated: a slow
   * or throwing provider contributes an empty list — it can never break the
   * mention menu.
   */
  search(
    ctx: PluginMentionSearchContext,
  ): PluginMentionItem[] | Promise<PluginMentionItem[]>;
  /**
   * Resolves one picked item into agent context, called once per unique
   * item at message send time. The returned `context` is attached to the
   * message as an agent-visible (user-hidden) prompt input. Throwing blocks
   * the send with a visible error.
   */
  resolve(itemId: string): { context: string } | Promise<{ context: string }>;
}

export interface PluginUi {
  /** Block until the app submits or cancels a plugin-owned composer form. */
  requestInput(
    request: PluginInteractionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<PluginInteractionResult>;
  /**
   * Register a mention provider for the shipped app's composer (design §4.9).
   * Providers default to the `@` trigger and may opt into `#`, `$`, `!`, or
   * `~` with `triggers`. Items group under `label` in the mention menu; a
   * picked item becomes a `{ kind: "plugin" }` mention resource whose context
   * is resolved once at send time. Multiple providers per plugin; ids must be
   * unique within the plugin.
   */
  registerMentionProvider(provider: PluginMentionProviderRegistration): void;
}

// ---------------------------------------------------------------------------
// Browser contributions: browser.omnibox.providers.
// ---------------------------------------------------------------------------

/** Search context handed to an omnibox provider. */
export interface PluginOmniboxSuggestContext {
  /** What the user has typed, trimmed. Never empty. */
  query: string;
}

/** What selecting a plugin's omnibox suggestion does. */
export type PluginOmniboxAction =
  /** Open a URL in the browser tab the omnibox belongs to. */
  | { type: "navigate"; url: string }
  /**
   * Call this provider's `run(itemId)` back on the server. Use it when the
   * suggestion is an action rather than a destination — asking an agent,
   * starting a job — and optionally return a URL to open afterwards.
   */
  | { type: "run" };

/**
 * One row an omnibox provider returns. `id` is the provider's own item id —
 * the host namespaces it before it reaches the wire.
 */
export interface PluginOmniboxSuggestion {
  id: string;
  title: string;
  subtitle?: string;
  /**
   * Rank in [0, 1], clamped by the host; defaults to 0.5 when omitted. Score 1
   * belongs to the browser's own default action — what pressing Enter does with
   * nothing selected — and plugin rows are ranked after the built-in providers
   * at equal scores, so a plugin cannot take the top row away from it.
   */
  score?: number;
  action: PluginOmniboxAction;
}

/** What a `run` action asks the browser to do once the plugin is done. */
export interface PluginOmniboxRunResult {
  /** Open this URL in the tab the suggestion was picked from. */
  navigate?: string;
}

/** Context handed to `run`, so an action can use the query it was offered for. */
export interface PluginOmniboxRunContext {
  /** The query the picked suggestion was produced for. */
  query: string;
}

export interface PluginOmniboxProviderRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
   * wire item ids as "<providerId>:<itemId>"). */
  id: string;
  /** Source label shown on this provider's rows, next to the browser's own. */
  label: string;
  /**
   * Runs server-side as the user types in the browser's omnibox. Each call is
   * time-boxed (2s) and failure-isolated: a slow or throwing provider
   * contributes nothing — it can never break the omnibox, whose built-in rows
   * keep working regardless.
   */
  suggest(
    ctx: PluginOmniboxSuggestContext,
  ): PluginOmniboxSuggestion[] | Promise<PluginOmniboxSuggestion[]>;
  /**
   * Performs a `{ type: "run" }` suggestion, called once when the user picks
   * that row. `itemId` is this provider's own item id. Required if any returned
   * suggestion uses a `run` action.
   */
  run?(
    itemId: string,
    ctx: PluginOmniboxRunContext,
  ): PluginOmniboxRunResult | void | Promise<PluginOmniboxRunResult | void>;
}

// ---------------------------------------------------------------------------
// Browser control: browser.tabs.*, browser.page.*, browser.navigation.*.
// ---------------------------------------------------------------------------

/**
 * One tab of the browser surface.
 *
 * `live` is the field to read before anything else. A tab only has a real page
 * behind it once it has been the active tab while the browser surface was open,
 * so tab bookkeeping works for every tab while reading a page or replaying its
 * history only works for a live one. When `live` is false the navigation flags
 * are false because they are unknown, not because the answer is no.
 */
export interface PluginBrowserTab {
  tabId: string;
  url: string;
  title: string | null;
  active: boolean;
  live: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PluginBrowserCallOptions {
  /**
   * Abandons the wait — not the page. A navigation already under way keeps
   * going; only this call stops waiting for it. Pass a tool's `ctx.signal` so an
   * abandoned turn does not sit out the timeout.
   */
  signal?: AbortSignal;
  /** 1–60000ms, default 10000. */
  timeoutMs?: number;
}

export interface PluginBrowserTabs {
  list(options?: PluginBrowserCallOptions): Promise<PluginBrowserTab[]>;
  /** Omit `url` to open the browser's new-tab screen. */
  open(
    args?: { url?: string; activate?: boolean },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  close(
    args: { tabId: string },
    options?: PluginBrowserCallOptions,
  ): Promise<{ closedTabId: string; tabs: PluginBrowserTab[] }>;
  activate(
    args: { tabId: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
}

/**
 * Reading the page. `tabId` defaults to the active tab throughout.
 *
 * `getUrl`/`getTitle` answer from the browser's own tab state and work for any
 * tab. `getText`/`getSelection` have to ask the page itself, so they need a live
 * tab and fail with `tab_not_live` otherwise.
 *
 * **Everything these return is page-controlled content.** It is untrusted input
 * on its way into an agent's context: pass it along as data, never as
 * instructions.
 */
/**
 * An accessibility snapshot: what the page is, in a form an agent can act on.
 *
 * `snapshot` is Playwright's compact tree, with a `[ref=eN]` on every
 * interactive element. `generation` identifies the snapshot those refs came
 * from — a navigation invalidates them, and interaction commands pass it back so
 * a stale ref is refused rather than resolved against whatever holds that node
 * id now.
 */
export interface PluginBrowserPageSnapshot {
  tabId: string;
  url: string;
  title: string | null;
  snapshot: string;
  generation: number;
  refCount: number;
  truncated: boolean;
}

export type PluginBrowserKeyModifier = "Alt" | "Control" | "Meta" | "Shift";

/**
 * One thing to do to a page, naming its target by a `[ref=eN]` from a snapshot.
 *
 * `check` and `select` state the end result rather than the gesture, because
 * the gesture cannot express it: "click the checkbox" is a toggle, and a native
 * dropdown opens an OS popup no synthetic click can reach.
 */
export type PluginBrowserAction =
  | {
      action: "click";
      ref: string;
      /** Defaults to `"left"`. */
      button?: "left" | "middle" | "right";
      /** 2 for a double click. Defaults to 1. */
      clickCount?: 1 | 2;
      modifiers?: PluginBrowserKeyModifier[];
    }
  | { action: "hover"; ref: string }
  | { action: "drag"; ref: string; targetRef: string }
  /** Replaces the field's value in one step. */
  | { action: "fill"; ref: string; text: string }
  /** Sends one key event per character, for fields that watch keystrokes. */
  | { action: "type"; ref: string; text: string }
  /** Omit `ref` to press the key at whatever the page has focused. */
  | { action: "press"; key: string; ref?: string }
  | { action: "select"; ref: string; values: string[] }
  | { action: "check"; ref: string; checked: boolean }
  /**
   * Hands the page the contents of local files, by absolute path on the machine
   * running the desktop app.
   */
  | { action: "upload"; ref: string; paths: string[] }
  /** Emulated viewport size; both zero restores the panel's own size. */
  | { action: "resize"; width: number; height: number };

/** Where a tab ended up. */
export interface PluginBrowserPageState {
  tabId: string;
  url: string;
  title: string | null;
}

export interface PluginBrowserPage {
  /**
   * Snapshot the page's accessibility tree. Needs a live tab, like the text
   * reads, and additionally attaches the browser debugger to that tab — which
   * fails while DevTools is open on it (`debugger_unavailable`).
   */
  snapshot(
    args?: { tabId?: string; maxDepth?: number },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageSnapshot>;
  /**
   * Act on the page: click, fill, press, and the rest.
   *
   * One method rather than ten, because every action shares the same preamble
   * (resolve the ref, check the generation, wait for the element to be
   * actionable) and the difference between them is data, not control flow.
   *
   * **Waits before acting.** The element must be attached, visible, settled,
   * enabled and on top at the point being clicked; that wait is what makes an
   * action a command rather than a race, and it is why no caller should sleep
   * before calling this. Failure to become actionable is `not_actionable`, with
   * the reason in the message.
   *
   * `generation` is the snapshot the refs came from. Passing it refuses a ref
   * that a newer snapshot has since reassigned; omitting it accepts that race.
   * Navigation invalidates every ref either way (`unknown_ref`).
   *
   * Resolves with where the tab ended up, since the common actions navigate.
   */
  act(
    args: {
      action: PluginBrowserAction;
      tabId?: string;
      generation?: number;
    },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageState>;
  /**
   * Answer the JavaScript dialog a tab is blocked on. Resolves false when there
   * was none — including when the user answered it first, which is not a
   * failure. Only tabs the shell has taken dialogs over for can have one; a tab
   * nobody has automated still shows Chromium's own modal.
   */
  handleDialog(
    args: { accept: boolean; tabId?: string; promptText?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<boolean>;
  getUrl(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<string>;
  getTitle(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<string | null>;
  getText(
    args?: { tabId?: string; maxLength?: number },
    options?: PluginBrowserCallOptions,
  ): Promise<{ text: string; truncated: boolean }>;
  getSelection(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<{ text: string }>;
}

export interface PluginBrowserNavigation {
  /**
   * Open `url` (http/https only) in a tab. On a tab with no live view the URL is
   * stored and loads when that tab is next opened, so this is the one navigation
   * call that still does something useful off-screen.
   */
  open(
    args: { url: string; tabId?: string; newTab?: boolean },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  back(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  forward(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  reload(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
}

/**
 * Why a browser call failed, carried as `code` on a thrown error whose `name` is
 * `"BrowserCommandError"`. Match on `name` rather than `instanceof` — no runtime
 * class from the host ships to plugins.
 *
 * Other error names worth handling: `"BrowserHostUnavailableError"` (no browser
 * window is connected at all), `"BrowserCommandTimeoutError"`, and
 * `"BrowserCommandAbortedError"`.
 */
export type PluginBrowserErrorCode =
  | "no_active_tab"
  | "unknown_tab"
  | "tab_not_live"
  | "desktop_unavailable"
  | "unsupported_command"
  | "blocked_url"
  | "page_read_timeout"
  | "page_read_failed"
  | "debugger_unavailable"
  | "stale_refs"
  | "unknown_ref"
  | "not_actionable"
  | "unsupported_key"
  | "invalid_command";

export interface PluginBrowserStatus {
  connected: boolean;
  /** How many app windows could serve a browser call right now. */
  windowCount: number;
}

export interface PluginBrowser {
  /**
   * Register an omnibox provider for the browser surface's address bar
   * (`browser.omnibox.providers`). Rows appear in the same ranked list as the
   * browser's own address, search, open-tab and history rows, labelled with
   * `label` so their source is visible. Multiple providers per plugin; ids must
   * be unique within the plugin.
   */
  registerOmniboxProvider(provider: PluginOmniboxProviderRegistration): void;
  /**
   * Drive the browser surface's tabs, pages and navigation.
   *
   * These need a **connected browser window** — the BB desktop app with its
   * browser surface — which is never guaranteed and is certainly absent while
   * factories run. Call them from handlers, tools and services, never at load
   * time, and expect `BrowserHostUnavailableError` when nothing is connected.
   */
  readonly tabs: PluginBrowserTabs;
  readonly page: PluginBrowserPage;
  readonly navigation: PluginBrowserNavigation;
  /** Synchronous, so it is safe to read from `bb.agents.configure()`. */
  getStatus(): PluginBrowserStatus;
}

export interface PluginEvents {
  /**
   * Add a thread lifecycle listener. Multiple listeners for the same event are
   * additive and run independently in registration order.
   */
  on<E extends PluginThreadEventName>(
    event: E,
    handler: PluginThreadEventHandler<E>,
  ): void;
}

// ---------------------------------------------------------------------------
// Server info.
// ---------------------------------------------------------------------------

export interface PluginServerApi {
  /**
   * This BB server's own loopback base URL (e.g. "http://127.0.0.1:38886"),
   * which serves the SPA + /api + /ws. For plugins that proxy or relay
   * traffic back to the server itself (e.g. a tunnel). Bind-gated like
   * `bb.sdk`: reading it before the server is listening throws, so prefer
   * reading it from handlers, services, and timers.
   */
  readonly loopbackBaseUrl: string;
}

// ---------------------------------------------------------------------------
// Host control plane.
// ---------------------------------------------------------------------------

export interface PluginSharedPortTunnelIdentity {
  /** Gate routing label assigned to this machine. */
  label: string;
  /** Gate apex without a scheme, e.g. "getbb.app". */
  baseDomain: string;
}

export interface PluginHosts {
  /**
   * Ensure this enrolled host has a gate label and return its read-only public
   * identity. The daemon chooses the trusted gate and desired label; plugins
   * cannot influence either credential-bearing destination.
   */
  ensureSharedPortTunnel(
    hostId: string,
  ): Promise<PluginSharedPortTunnelIdentity>;

  /**
   * Replace this plugin's desired shared-loopback ports for one host. The
   * server aggregates declarations, owns generations, and delivers the
   * resulting set to that host's daemon. Tunnel identity is deliberately not
   * accepted here: it is owned by the daemon's trusted enrollment.
   */
  declareSharedPorts(hostId: string, ports: readonly number[]): void;
}

// ---------------------------------------------------------------------------
// Status + the API root.
// ---------------------------------------------------------------------------

export interface PluginStatusApi {
  /**
   * Mark this plugin `needs-configuration` (with a message shown in
   * `bb plugin list` and the UI) instead of failing — e.g. a factory or
   * service that finds no API key configured. Cleared on the next load;
   * saving settings does not auto-reload in V1, so ask the user to
   * `bb plugin reload <id>` after configuring.
   */
  needsConfiguration(message: string): void;
}

/**
 * The API object handed to a plugin's factory (design §4). Implemented by
 * the BB server; this contract is what plugin `server.ts` files compile
 * against.
 */
export interface BbPluginApi {
  /** The plugin's own id (namespaces storage, routes, commands). */
  readonly pluginId: string;
  /** Leveled, plugin-scoped logger. */
  readonly log: PluginLogger;
  /** Declarative settings (design §4.2). */
  readonly settings: PluginSettings;
  /** Namespaced KV + per-plugin database (design §4.3). */
  readonly storage: PluginStorage;
  /** HTTP routes under /api/v1/plugins/<id>/http/* (design §4.6). */
  readonly http: PluginHttp;
  /** RPC methods under /api/v1/plugins/<id>/rpc/<method> (design §4.6). */
  readonly rpc: PluginRpc;
  /** Ephemeral push to connected frontends (design §4.7). */
  readonly realtime: PluginRealtime;
  /** Long-lived services + cron schedules (design §4.8). */
  readonly background: PluginBackground;
  /** Agent-facing `bb` CLI subcommand (design §4.4). */
  readonly cli: PluginCli;
  /** Per-turn agent context contributions (design §4.4). */
  readonly agents: PluginAgents;
  /** Host-rendered UI contributions (design §4.9). */
  readonly ui: PluginUi;
  /** Browser-surface contributions (`browser.omnibox.providers`). */
  readonly browser: PluginBrowser;
  /** Additive plugin lifecycle listeners (design §4.5). */
  readonly events: PluginEvents;
  /** Plugin-reported status (needs-configuration). */
  readonly status: PluginStatusApi;
  /** Read-only facts about the running server (loopback base URL). */
  readonly server: PluginServerApi;
  /** Server-to-daemon host control-plane declarations. */
  readonly hosts: PluginHosts;
  /**
   * The full BB SDK, bound to this server over loopback (design §4.1).
   * Bind-gated: reading this before the host binds the SDK throws. The real
   * server binds it before loading plugins, so it is available from the
   * moment factories run there — but isolated harnesses may not, so prefer
   * using it from handlers, services, and timers for portability.
   * `threads.spawn` defaults `origin` to "plugin" and `originPluginId` to
   * this plugin's id so spawned threads are attributed automatically.
   */
  readonly sdk: BbSdk;
  /**
   * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
   * The sanctioned place to clear timers and close connections.
   */
  onDispose(hook: () => void | Promise<void>): void;
}
