import { normalizeBrowserUrl } from "@/lib/browser-url";
import { OMNIBOX_DEFAULT_ACTION_SCORE } from "../default-action";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

export const OMNIBOX_NAVIGATION_PROVIDER_ID = "navigation";

/**
 * Offers the typed text as an address, when it is one. Nothing is offered for a
 * query like `best headphones`; the search provider takes the default row then.
 *
 * The URL-vs-search decision is not made here — it is `lib/browser-url.ts`,
 * unchanged and already the address bar's rule, so the omnibox cannot disagree
 * with what typing and pressing Enter has always done.
 */
export function createOmniboxNavigationProvider(): OmniboxProvider {
  return {
    id: OMNIBOX_NAVIGATION_PROVIDER_ID,
    suggest(query): readonly OmniboxProviderSuggestion[] {
      const url = normalizeBrowserUrl(query);
      if (url === null) {
        return [];
      }
      return [
        {
          action: { type: "navigate", url },
          // One row per query, so a constant id keeps the row identity stable
          // as the user keeps typing.
          id: "address",
          kind: "navigate",
          score: OMNIBOX_DEFAULT_ACTION_SCORE,
          subtitle: null,
          title: url,
        },
      ];
    },
  };
}
