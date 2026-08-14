import { useQuery, type QueryKey } from "@tanstack/react-query";
import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@/lib/plugin-mention-triggers";

/**
 * Host-rendered plugin contributions (plugin design §4.9), served by
 * GET /api/v1/plugins/contributions. Not in the typed server contract — the
 * plugin routes are server-policy glue — so fetched directly and typed
 * locally. One query covers every contribution kind; later kinds extend
 * {@link PluginContributions}.
 */
/** One mention provider contributed by a plugin (design §4.9). */
export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

/** One omnibox provider contributed by a plugin (`browser.omnibox.providers`). */
export interface PluginOmniboxProviderContribution {
  pluginId: string;
  id: string;
  label: string;
}

export interface PluginContributions {
  mentionProviders: PluginMentionProviderContribution[];
  omniboxProviders: PluginOmniboxProviderContribution[];
}

const EMPTY_CONTRIBUTIONS: PluginContributions = {
  mentionProviders: [],
  omniboxProviders: [],
};

function toOmniboxProviderContribution(
  value: unknown,
): PluginOmniboxProviderContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const provider = value as Record<string, unknown>;
  if (
    typeof provider.pluginId !== "string" ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string"
  ) {
    return null;
  }
  return {
    pluginId: provider.pluginId,
    id: provider.id,
    label: provider.label,
  };
}

function toMentionProviderContribution(
  value: unknown,
): PluginMentionProviderContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const provider = value as Record<string, unknown>;
  const triggers = normalizePluginMentionTriggers(provider.triggers);
  if (triggers === null) return null;
  if (
    typeof provider.pluginId !== "string" ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string"
  ) {
    return null;
  }
  return {
    pluginId: provider.pluginId,
    id: provider.id,
    label: provider.label,
    triggers,
  };
}

async function fetchPluginContributions(
  signal: AbortSignal,
): Promise<PluginContributions> {
  const response = await fetch("/api/v1/plugins/contributions", { signal });
  // Nothing to surface rather than an error: an older server (no plugin
  // routes) or a disabled experiment both mean "no contributions".
  if (!response.ok) return EMPTY_CONTRIBUTIONS;
  const body = (await response.json()) as {
    mentionProviders?: unknown;
    omniboxProviders?: unknown;
  };
  return {
    mentionProviders: Array.isArray(body.mentionProviders)
      ? body.mentionProviders
          .map(toMentionProviderContribution)
          .filter(
            (provider): provider is PluginMentionProviderContribution =>
              provider !== null,
          )
      : [],
    omniboxProviders: Array.isArray(body.omniboxProviders)
      ? body.omniboxProviders
          .map(toOmniboxProviderContribution)
          .filter(
            (provider): provider is PluginOmniboxProviderContribution =>
              provider !== null,
          )
      : [],
  };
}

export function pluginContributionsQueryKey(): QueryKey {
  return ["plugin-contributions"];
}

/**
 * Prefix covering every contributions cache entry. The realtime
 * `plugins-changed` broadcast invalidates it so `bb plugin
 * reload/enable/disable` reaches open pages without waiting out the stale
 * time.
 */
export function allPluginContributionsQueryKeyPrefix(): QueryKey {
  return ["plugin-contributions"];
}

/**
 * All host-rendered plugin contributions. Consumers read their kind from the
 * shared result so the app makes one contributions request total.
 */
export function usePluginContributions() {
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    staleTime: 30_000,
  });
}
export interface PluginMentionSearchItem {
  /** Opaque server-composed item reference; rides the mention resource. */
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

/** One provider's mention search results, grouped under its label. */
export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

function isMentionSearchItem(value: unknown): value is PluginMentionSearchItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.itemId === "string" &&
    typeof item.title === "string" &&
    (item.subtitle === null || typeof item.subtitle === "string") &&
    (item.icon === null || typeof item.icon === "string")
  );
}

function isMentionSearchGroup(
  value: unknown,
): value is PluginMentionSearchGroup {
  if (typeof value !== "object" || value === null) return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.pluginId === "string" &&
    typeof group.providerId === "string" &&
    typeof group.label === "string" &&
    Array.isArray(group.items) &&
    group.items.every(isMentionSearchItem)
  );
}

export interface PluginMentionSearchArgs {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

async function fetchPluginMentionSearch(
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({
    q: args.query,
    trigger: args.trigger,
  });
  if (args.projectId !== null) params.set("projectId", args.projectId);
  if (args.threadId !== null) params.set("threadId", args.threadId);
  const response = await fetch(
    `/api/v1/plugins/mentions/search?${params.toString()}`,
    { signal },
  );
  // Nothing to surface rather than an error: a disabled experiment or an
  // older server both mean "no plugin mention results".
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isMentionSearchGroup)
    : [];
}

/**
 * Plugin mention-provider search for the composer's `@` menu (design §4.9).
 * Callers gate `enabled` on a non-empty (debounced) query plus at least one
 * registered mention provider so idle composers never poll the server.
 */
export function usePluginMentionSearch(
  args: PluginMentionSearchArgs,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: [
      "plugin-mention-search",
      args.trigger,
      args.query,
      args.projectId,
      args.threadId,
    ],
    queryFn: ({ signal }) => fetchPluginMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.trigger ? previous : undefined,
  });
}

/** What picking a plugin omnibox row does; `run` calls the plugin back. */
export type PluginOmniboxSuggestAction =
  | { type: "navigate"; url: string }
  | { type: "run" };

export interface PluginOmniboxSuggestItem {
  /** Opaque server-composed item reference; posted back for a `run` action. */
  itemId: string;
  title: string;
  subtitle: string | null;
  /** Already clamped to [0, 1] by the server. */
  score: number;
  action: PluginOmniboxSuggestAction;
}

/** One provider's omnibox suggestions, labelled with its source. */
export interface PluginOmniboxSuggestGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginOmniboxSuggestItem[];
}

function isOmniboxSuggestAction(
  value: unknown,
): value is PluginOmniboxSuggestAction {
  if (typeof value !== "object" || value === null) return false;
  const action = value as Record<string, unknown>;
  if (action.type === "run") return true;
  return action.type === "navigate" && typeof action.url === "string";
}

function isOmniboxSuggestItem(
  value: unknown,
): value is PluginOmniboxSuggestItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.itemId === "string" &&
    typeof item.title === "string" &&
    (item.subtitle === null || typeof item.subtitle === "string") &&
    typeof item.score === "number" &&
    isOmniboxSuggestAction(item.action)
  );
}

function isOmniboxSuggestGroup(
  value: unknown,
): value is PluginOmniboxSuggestGroup {
  if (typeof value !== "object" || value === null) return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group.pluginId === "string" &&
    typeof group.providerId === "string" &&
    typeof group.label === "string" &&
    Array.isArray(group.items) &&
    group.items.every(isOmniboxSuggestItem)
  );
}

/**
 * Plugin omnibox suggestions for one query (`browser.omnibox.providers`).
 *
 * Not a react-query hook: the omnibox controller drives providers itself, with
 * its own debounce and cancellation, and calls this from a provider adapter
 * rather than from a component.
 */
export async function fetchPluginOmniboxSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<PluginOmniboxSuggestGroup[]> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(
    `/api/v1/plugins/omnibox/suggest?${params.toString()}`,
    { signal },
  );
  // Nothing to surface rather than an error: a disabled experiment or an
  // older server both mean "no plugin suggestions".
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups.filter(isOmniboxSuggestGroup)
    : [];
}

export interface RunPluginOmniboxActionArgs {
  itemId: string;
  pluginId: string;
  /** The query the picked suggestion was produced for. */
  query: string;
}

/**
 * Perform a picked `run` suggestion. Returns the URL the plugin asks the
 * browser to open, or null when it asks for nothing (or the call failed —
 * a failed action must not navigate the tab somewhere arbitrary).
 */
export async function runPluginOmniboxAction(
  args: RunPluginOmniboxActionArgs,
): Promise<string | null> {
  const response = await fetch("/api/v1/plugins/omnibox/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      itemId: args.itemId,
      pluginId: args.pluginId,
      query: args.query,
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    navigate?: unknown;
    ok?: unknown;
  };
  if (body.ok !== true) return null;
  return typeof body.navigate === "string" && body.navigate.length > 0
    ? body.navigate
    : null;
}

export interface ReportPluginBrowserDownloadArgs {
  filename: string;
  id: string;
  mimeType: string;
  savePath: string | null;
  state: "completed" | "cancelled" | "interrupted" | "refused";
  tabId: string;
  url: string;
}

/**
 * Hand a finished download to whatever plugins registered a handler
 * (`browser.downloads.handlers`).
 *
 * Fire-and-forget by design: the file is already written and the user has
 * already been told, so this cannot fail in a way worth interrupting them
 * about. It resolves to how many handlers ran, which is what the tests assert
 * on and what a caller can log.
 */
export async function reportPluginBrowserDownload(
  args: ReportPluginBrowserDownloadArgs,
): Promise<number> {
  const response = await fetch("/api/v1/plugins/browser/downloads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) return 0;
  const body = (await response.json()) as {
    handlerCount?: unknown;
    ok?: unknown;
  };
  if (body.ok !== true || typeof body.handlerCount !== "number") return 0;
  return body.handlerCount;
}
