import {
  fetchPluginOmniboxSuggestions,
  type PluginOmniboxProviderContribution,
  type PluginOmniboxSuggestGroup,
} from "@/hooks/queries/plugin-contribution-queries";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

/**
 * Bridge from the `browser.omnibox.providers` contribution point to the
 * omnibox's own provider interface. A plugin provider is an `OmniboxProvider`
 * like any other: the controller clamps its scores, the ranking caps and
 * deduplicates its rows, and a failure drops it from the run — none of which it
 * can opt out of.
 */

export interface PluginOmniboxSuggestionSource {
  /**
   * Suggestions for one contributed provider. Providers of the same run share a
   * single request (see {@link createPluginOmniboxSuggestionSource}).
   */
  suggest: (
    args: { pluginId: string; providerId: string; query: string },
    signal: AbortSignal,
  ) => Promise<PluginOmniboxSuggestGroup | null>;
}

/**
 * One HTTP request per query, shared by every plugin provider in that run.
 *
 * The server answers for all plugins at once, but each contributed provider is
 * kept as a separate `OmniboxProvider` so it carries its own label and its own
 * per-provider row cap — one chatty plugin must not spend another plugin's
 * budget. Without this sharing that would cost one request per provider per
 * keystroke.
 *
 * Every provider in a run is aborted by the same controller signal, so the
 * shared request is cancelled exactly when the run is.
 */
export function createPluginOmniboxSuggestionSource(): PluginOmniboxSuggestionSource {
  let inflight: {
    groups: Promise<PluginOmniboxSuggestGroup[]>;
    query: string;
  } | null = null;

  return {
    async suggest({ pluginId, providerId, query }, signal) {
      if (inflight === null || inflight.query !== query) {
        inflight = {
          groups: fetchPluginOmniboxSuggestions(query, signal),
          query,
        };
        // A rejected shared request must not resurface as an unhandled
        // rejection through the providers that did not await it first.
        inflight.groups.catch(() => {});
      }
      const groups = await inflight.groups;
      return (
        groups.find(
          (group) =>
            group.pluginId === pluginId && group.providerId === providerId,
        ) ?? null
      );
    },
  };
}

export interface CreateOmniboxPluginProviderArgs {
  contribution: PluginOmniboxProviderContribution;
  source: PluginOmniboxSuggestionSource;
}

/** Provider id namespaced by plugin, so two plugins cannot collide. */
export function omniboxPluginProviderId(
  contribution: PluginOmniboxProviderContribution,
): string {
  return `plugin:${contribution.pluginId}:${contribution.id}`;
}

export function createOmniboxPluginProvider(
  args: CreateOmniboxPluginProviderArgs,
): OmniboxProvider {
  const { contribution, source } = args;
  return {
    id: omniboxPluginProviderId(contribution),
    async suggest(
      query,
      context,
    ): Promise<readonly OmniboxProviderSuggestion[]> {
      const group = await source.suggest(
        {
          pluginId: contribution.pluginId,
          providerId: contribution.id,
          query,
        },
        context.signal,
      );
      if (group === null) {
        return [];
      }
      return group.items.map((item) => ({
        action:
          item.action.type === "navigate"
            ? { type: "navigate", url: item.action.url }
            : {
                type: "plugin-run",
                itemId: item.itemId,
                pluginId: contribution.pluginId,
                providerId: contribution.id,
                query,
              },
        id: item.itemId,
        kind: "plugin",
        score: item.score,
        // The plugin's own label, so a row's source is visible rather than a
        // generic "plugin" badge — which is the point of letting plugins in.
        sourceLabel: group.label,
        subtitle: item.subtitle,
        title: item.title,
      }));
    },
  };
}

export interface CreateOmniboxPluginProvidersArgs {
  contributions: readonly PluginOmniboxProviderContribution[];
  source: PluginOmniboxSuggestionSource;
}

export function createOmniboxPluginProviders(
  args: CreateOmniboxPluginProvidersArgs,
): readonly OmniboxProvider[] {
  return args.contributions.map((contribution) =>
    createOmniboxPluginProvider({ contribution, source: args.source }),
  );
}
