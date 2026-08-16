import type { DbConnection } from "@bb/db";
import type { DynamicTool, Thread } from "@bb/domain";
import type { HostDaemonConnectTunnelIdentity } from "@bb/host-daemon-contract";
import {
  pluginUpdateCheckEntrySchema,
  type InstalledPlugin,
  type PluginApplyUpdateResult,
  type PluginRuntimeStatus,
  type PluginSourceDetail,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import type { BundledPluginRegistration } from "./builtin-registry.js";
import type { PluginManifest } from "./manifest.js";
import type {
  PluginApiHandle,
  PluginBackgroundServiceRecord,
  PluginMentionTrigger,
} from "./plugin-api.js";
import type { HostSharedPortCoordinator } from "../../ws/host-shared-ports.js";
export type {
  PluginApplyUpdateResult,
  PluginHandlerStats,
  PluginRuntimeStatus,
  PluginServiceEntry,
  PluginUpdateCheckEntry,
} from "@bb/server-contract";

/** Live state of one registered background service. */
export type PluginServiceState = "running" | "backoff" | "stopped";

export interface PluginScheduleEntry {
  name: string;
  cron: string;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: "running" | "ok" | "error" | null;
  lastError: string | null;
}

export type PluginListEntry = InstalledPlugin;

/**
 * Runner state for one background service instance. `current` is the live
 * start() promise; `restartTimer` is pending backoff. `disposed` stops the
 * settle handler from restarting a service that is being shut down.
 */
export interface ServiceRuntime {
  record: PluginBackgroundServiceRecord;
  state: PluginServiceState;
  controller: AbortController | null;
  current: Promise<void> | null;
  restartTimer: NodeJS.Timeout | null;
  consecutiveCrashes: number;
  startedAt: number;
  disposed: boolean;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  handle: PluginApiHandle;
  services: ServiceRuntime[];
  isBuiltin: boolean;
  builtinName: string | null;
  /**
   * Which supervised instance this load is, or null when it runs in the
   * server. Per load rather than per plugin: a reload has both instances alive
   * for the moment the swap takes, so disposing the previous one has to name
   * it (see `SupervisedPlugin.instanceId`).
   */
  remoteInstanceId: string | null;
}

export interface PluginServiceDeps {
  db: DbConnection;
  /**
   * Whether this plugin runs in a plugin process instead of the server's.
   *
   * Opt-in and off by default: the in-process path is the one every plugin has
   * always taken, and moving one is a decision an operator makes per plugin.
   * A plugin that turns out to be ineligible (see `pluginProcessEligibility`)
   * falls back to in-process with a warning rather than failing to load.
   */
  runPluginOutOfProcess?: (pluginId: string) => boolean;
  /**
   * How a plugin host process is spawned. Test seam: the supervisor's own
   * default forks the real entry, and a test that needs the spawn to fail (or
   * to be a fake) has no other way to say so.
   */
  spawnPluginHost?: import("./plugin-supervisor.js").PluginProcessSpawner;
  /**
   * Restart policy for plugin processes. Test seam: the defaults escalate over
   * ~8 seconds, which is right for a server and far too slow for a test that
   * needs a crashloop to run out.
   */
  pluginProcessRestart?: import("./plugin-supervisor.js").PluginSupervisorOptions["restart"];
  /** Omitted only by isolated plugin-runtime tests without a daemon plane. */
  sharedPorts?: Pick<
    HostSharedPortCoordinator,
    | "declareSharedPorts"
    | "validateSharedPortDeclaration"
    | "replaceDeclarationsForOwner"
    | "clearDeclarationsForOwner"
  >;
  ensureSharedPortTunnel?: (
    hostId: string,
  ) => Promise<HostDaemonConnectTunnelIdentity>;
  /** Thread DTO assembly for lifecycle events + plugin-signal broadcast +
   * the `plugins-changed` system broadcast on lifecycle completion. */
  hub: Pick<
    NotificationHub,
    "getDaemonSessionIdForHost" | "notifyPluginSignal" | "notifySystem"
  >;
  logger: ServerLogger;
  pendingInteractions?: Pick<
    import("../interactions/pending-interactions.js").PendingInteractionLifecycle,
    "requestPluginInteraction" | "interruptPluginInteractions"
  >;
  /**
   * Agent browser control (`bb.browser.tabs` / `page` / `navigation`). Optional
   * like `pendingInteractions`: isolated plugin-runtime tests build these deps by
   * hand, and a host without it simply refuses browser calls.
   */
  browserBridge?: import("../browser/browser-bridge.js").BrowserBridge;
  /** BB data dir: plugin database files and secrets live under <dataDir>/plugins/<id>/. */
  dataDir: string;
  /** BB app version, checked against manifests' engines.bb range. */
  appVersion: string;
  /** Declared first-party plugins bundled with the app; test-only override. */
  bundledPlugins?: readonly BundledPluginRegistration[];
  /** Managed source-development only: rebuild and reload builtin frontends. */
  watchBuiltinPluginSources?: boolean;
  /** Factory-execution time box; overridable in tests. */
  loadTimeoutMs?: number;
  /** Bound on awaiting a service's start() promise at dispose; tests shrink it. */
  serviceStopTimeoutMs?: number;
  /** First restart delay after a service crash (doubles, capped at 60s). */
  serviceRestartBaseMs?: number;
  /** Time box per mention provider search call; tests shrink it. */
  mentionSearchTimeoutMs?: number;
  /** Time box per mention provider resolve call at send; tests shrink it. */
  mentionResolveTimeoutMs?: number;
  /** Time box per omnibox provider suggest call; tests shrink it. */
  omniboxSuggestTimeoutMs?: number;
  /** Time box per omnibox `run` action; tests shrink it. */
  omniboxRunTimeoutMs?: number;
  /** Time box per browser download handler; tests shrink it. */
  browserDownloadTimeoutMs?: number;
  /** Time box per picked context-menu item; tests shrink it. */
  contextMenuRunTimeoutMs?: number;
  /** Failed candidates must remain healthy for this long before activation commits. */
  stabilizationWindowMs?: number;
  /** Previous artifacts and activation snapshots remain rollbackable for this long. */
  artifactRetentionMs?: number;
  /** Injectable policy clock for retention and activation tests. */
  now?: () => number;
  /** Test seam for deterministic stabilization-window completion. */
  scheduleStabilizationWindow?: (
    durationMs: number,
    onElapsed: () => void,
  ) => () => void;
  /** Test failpoint after state replay but before pointer restoration. */
  afterPluginRollbackStateRestored?: (args: {
    pluginId: string;
    snapshotId: string;
  }) => Promise<void>;
  /** Test seam for a crash after canonical promotion but before activation. */
  afterArtifactPromoted?: (args: {
    pluginId: string;
    artifactId: string;
    path: string;
  }) => Promise<void>;
  /** Test observation seam; called immediately before a managed download. */
  onArtifactMaterialize?: (args: { path: string }) => void;
}

/** One native tool contributed by a running plugin (design §4.4). */
export interface PluginAgentToolContribution {
  pluginId: string;
  tool: DynamicTool;
  /** Optional usage snippet for the thread-instructions assembly. */
  instructions: string | null;
}

/** One dynamic instructions provider from a running plugin. */
export interface PluginInstructionContribution {
  pluginId: string;
  provider: (ctx: { threadId: string; projectId: string }) => string | null;
}

/** Fully validated conditional selections for one thread/session resolution. */
export interface PluginResolvedAgentConfiguration {
  tools: PluginAgentToolContribution[];
  /** Only configured plugins appear. An empty set means fail-closed or an
   * intentional empty selection; absent plugins keep all manifest skills. */
  selectedSkillIdsByPlugin: ReadonlyMap<string, ReadonlySet<string>>;
  dynamicInstructions: Array<{ pluginId: string; text: string }>;
}

/** One mention provider contributed by a running plugin (design §4.9). */
export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

/** One row in a mention search group. `itemId` is the wire-composed
 * "<providerId>:<provider item id>" that rides the mention resource. */
export interface PluginMentionSearchItem {
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

/** One provider's results for GET /plugins/mentions/search, grouped so the
 * composer renders them under the provider's label. */
export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

/** One omnibox provider contributed by a running plugin
 * (`browser.omnibox.providers`). */
/** A plugin context-menu entry, as the app hands it to the desktop shell. */
export interface PluginContextMenuItemContribution {
  pluginId: string;
  itemId: string;
  title: string;
  when: { image: boolean; link: boolean; page: boolean; selection: boolean };
}

/** A plugin button on the browser's find bar (`browser.find.actions`). */
export interface PluginFindActionContribution {
  pluginId: string;
  itemId: string;
  title: string;
}

export interface PluginOmniboxProviderContribution {
  pluginId: string;
  id: string;
  label: string;
}

/**
 * One row in an omnibox suggest group. `itemId` is the wire-composed
 * "<providerId>:<provider item id>"; a `run` action is performed by posting it
 * back, so nothing about the plugin's internals reaches the client.
 */
export interface PluginOmniboxSuggestItem {
  itemId: string;
  title: string;
  subtitle: string | null;
  score: number;
  action: { type: "navigate"; url: string } | { type: "run" };
}

/** One provider's results for GET /plugins/omnibox/suggest. */
export interface PluginOmniboxSuggestGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginOmniboxSuggestItem[];
}

/** Result of performing one plugin omnibox `run` action. */
export type PluginOmniboxRunOutcome =
  | { ok: true; navigate: string | null }
  | { ok: false; error: string };

/** Result of resolving one plugin mention at send time (design §4.9). */
export type PluginMentionResolveResult =
  | { ok: true; context: string }
  | { ok: false; error: string };

/**
 * Narrow emitter the thread lifecycle seams call (design §4.5). Emission is
 * a no-op unless a loaded plugin registered a handler for the event; payload
 * assembly and handler dispatch happen async off the lifecycle path.
 */
export interface PluginThreadEventEmitter {
  emitThreadCreated(thread: Thread): void;
  emitThreadActive(thread: Thread): void;
  emitThreadIdle(thread: Thread): void;
  emitThreadFailed(thread: Thread): void;
  emitThreadArchived(thread: Thread): void;
  emitThreadDeleted(thread: Thread): void;
}

/**
 * Result of resolving a wire request (http route / rpc method) against the
 * live routing tables. "not-running" distinguishes an installed-but-unloaded
 * plugin (503 at the dispatcher) from an unknown plugin or route (404).
 */
export type PluginWireLookup<T> =
  | { outcome: "unknown-plugin" }
  | {
      outcome: "not-running";
      status: PluginRuntimeStatus;
      detail: string | null;
    }
  | { outcome: "not-found" }
  | { outcome: "found"; value: T };

export { pluginUpdateCheckEntrySchema };
export type PluginSourceView = PluginSourceDetail;

export type PluginApplyUpdateOutcome =
  | { ok: true; result: PluginApplyUpdateResult }
  | { ok: false; error: string };
