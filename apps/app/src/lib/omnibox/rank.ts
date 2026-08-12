import { omniboxActionKey, type OmniboxSuggestion } from "./types";

// Aggregation across providers. Pure: the controller feeds it whatever has
// arrived so far, so this runs again on every provider settle.

export interface RankOmniboxSuggestionsArgs {
  /** How many rows a single provider may occupy. */
  maxPerProvider: number;
  /** How many rows the omnibox shows in total. */
  maxSuggestions: number;
  /** Flattened in provider-registration order — see the tiebreak below. */
  suggestions: readonly OmniboxSuggestion[];
}

interface RankedEntry {
  /** Position in the flattened input; the stable tiebreak for equal scores. */
  index: number;
  suggestion: OmniboxSuggestion;
}

function byScoreThenOrder(left: RankedEntry, right: RankedEntry): number {
  return (
    right.suggestion.score - left.suggestion.score || left.index - right.index
  );
}

/**
 * Rank and trim the suggestions collected for one query.
 *
 * Order of operations is deliberate:
 *
 * 1. **Per-provider cap** first, so a provider returning fifty rows cannot
 *    crowd out the others before ranking even starts. This matters most for
 *    plugin providers, which are not trusted to be well behaved.
 * 2. **Deduplicate by action**, keeping the strongest score. Two providers
 *    finding the same page is the common case (an open tab and its history
 *    entry), and showing it twice is worse than losing a row.
 * 3. **Global sort**, then the overall cap.
 *
 * Equal scores never reshuffle: ties break on the flattened index, which the
 * controller derives from provider-registration order, not from the order in
 * which providers happened to resolve. Without that, a slow provider's rows
 * would jump position between emits for the same query.
 */
export function rankOmniboxSuggestions(
  args: RankOmniboxSuggestionsArgs,
): readonly OmniboxSuggestion[] {
  const perProvider = new Map<string, RankedEntry[]>();
  for (const [index, suggestion] of args.suggestions.entries()) {
    const entries = perProvider.get(suggestion.providerId) ?? [];
    entries.push({ index, suggestion });
    perProvider.set(suggestion.providerId, entries);
  }

  const capped: RankedEntry[] = [];
  for (const entries of perProvider.values()) {
    capped.push(
      ...entries.sort(byScoreThenOrder).slice(0, args.maxPerProvider),
    );
  }

  // Walking in ranked order means the first entry for an action is also its
  // strongest, so insertion order into this map is already the final order.
  const byAction = new Map<string, OmniboxSuggestion>();
  for (const entry of capped.sort(byScoreThenOrder)) {
    const key = omniboxActionKey(entry.suggestion.action);
    if (!byAction.has(key)) {
      byAction.set(key, entry.suggestion);
    }
  }

  return [...byAction.values()].slice(0, args.maxSuggestions);
}
