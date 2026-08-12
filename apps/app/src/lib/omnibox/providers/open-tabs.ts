import { getBrowserUrlHost } from "@/lib/browser-url";
import { omniboxUrlMatchCandidates, scoreOmniboxTextMatch } from "../match";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

export const OMNIBOX_OPEN_TABS_PROVIDER_ID = "open-tabs";

/**
 * Ceiling for an open-tab row: below the default action, above history. A page
 * that is already loaded in another tab is the better answer than reopening it.
 */
const OMNIBOX_OPEN_TABS_SCORE_WEIGHT = 0.9;

export interface OmniboxOpenTab {
  id: string;
  title: string | null;
  url: string;
}

export interface CreateOmniboxOpenTabsProviderArgs {
  /**
   * Excluded from results: offering to switch to the tab the user is typing in
   * is a no-op row.
   */
  activeTabId: string | null;
  tabs: readonly OmniboxOpenTab[];
}

/**
 * Offers the open tabs whose title or URL matches, as tab switches rather than
 * navigations — the point is to not open a second copy of a page that is
 * already loaded.
 *
 * Tabs with no URL yet (a fresh new-tab row) are skipped: there is nothing to
 * switch to.
 */
export function createOmniboxOpenTabsProvider(
  args: CreateOmniboxOpenTabsProviderArgs,
): OmniboxProvider {
  return {
    id: OMNIBOX_OPEN_TABS_PROVIDER_ID,
    suggest(query): readonly OmniboxProviderSuggestion[] {
      const suggestions: OmniboxProviderSuggestion[] = [];
      for (const tab of args.tabs) {
        if (tab.id === args.activeTabId || tab.url.length === 0) {
          continue;
        }
        const match = scoreOmniboxTextMatch({
          candidates: [tab.title, ...omniboxUrlMatchCandidates(tab.url)],
          query,
        });
        if (match === 0) {
          continue;
        }
        suggestions.push({
          action: { type: "activate-tab", tabId: tab.id },
          id: tab.id,
          kind: "tab",
          score: match * OMNIBOX_OPEN_TABS_SCORE_WEIGHT,
          subtitle: getBrowserUrlHost(tab.url),
          title: tab.title ?? tab.url,
        });
      }
      return suggestions;
    },
  };
}
