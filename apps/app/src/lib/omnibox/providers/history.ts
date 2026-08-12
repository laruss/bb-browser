import type { BrowserHistoryEntry } from "@/lib/browser-history";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { omniboxUrlMatchCandidates, scoreOmniboxTextMatch } from "../match";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

export const OMNIBOX_HISTORY_PROVIDER_ID = "history";

/** Ceiling for a history row: below an open tab holding the same page. */
const OMNIBOX_HISTORY_SCORE_WEIGHT = 0.85;

export interface CreateOmniboxHistoryProviderArgs {
  /**
   * Most-recently-visited first, which is how `useBrowserHistory` already keeps
   * them. Recency needs no score term of its own: equal-scoring rows break
   * their tie on input order, so the newer visit stays above the older one.
   */
  entries: readonly BrowserHistoryEntry[];
}

/**
 * Offers previously visited pages. This is the surface's own navigation history
 * — the same per-scope list the new-tab screen shows — not a browser-wide
 * history store, because there is none yet.
 */
export function createOmniboxHistoryProvider(
  args: CreateOmniboxHistoryProviderArgs,
): OmniboxProvider {
  return {
    id: OMNIBOX_HISTORY_PROVIDER_ID,
    suggest(query): readonly OmniboxProviderSuggestion[] {
      const suggestions: OmniboxProviderSuggestion[] = [];
      for (const entry of args.entries) {
        const match = scoreOmniboxTextMatch({
          candidates: [entry.title, ...omniboxUrlMatchCandidates(entry.url)],
          query,
        });
        if (match === 0) {
          continue;
        }
        suggestions.push({
          action: { type: "navigate", url: entry.url },
          id: entry.url,
          kind: "history",
          score: match * OMNIBOX_HISTORY_SCORE_WEIGHT,
          subtitle: getBrowserUrlHost(entry.url),
          title: entry.title ?? entry.url,
        });
      }
      return suggestions;
    },
  };
}
