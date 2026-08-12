import { rankOmniboxSuggestions } from "./rank";
import type {
  OmniboxProvider,
  OmniboxProviderSuggestion,
  OmniboxSuggestion,
} from "./types";

// Query lifecycle: debounce, run, supersede. Framework-free so the timing rules
// are testable with fake timers instead of through a rendered component.

/**
 * Long enough that a fast typist triggers one run per word rather than per
 * keystroke, short enough that the list feels attached to the keyboard. The
 * default action does not wait for it — see `resolveOmniboxDefaultAction`.
 */
export const OMNIBOX_DEBOUNCE_MS = 120;
export const OMNIBOX_MAX_SUGGESTIONS = 8;
export const OMNIBOX_MAX_PER_PROVIDER = 4;

export interface OmniboxState {
  /** True while at least one provider has not settled for `query`. */
  isPending: boolean;
  /** The query these suggestions belong to; empty when there is no run. */
  query: string;
  suggestions: readonly OmniboxSuggestion[];
}

export const EMPTY_OMNIBOX_STATE: OmniboxState = {
  isPending: false,
  query: "",
  suggestions: [],
};

export interface CreateOmniboxControllerArgs {
  debounceMs?: number;
  maxPerProvider?: number;
  maxSuggestions?: number;
  onState: (state: OmniboxState) => void;
  /**
   * Registration order is meaningful: it breaks score ties, so built-in
   * providers are listed before ones that may be slower or less trusted.
   */
  providers: readonly OmniboxProvider[];
}

export interface OmniboxController {
  /** Abandon any run and emit the empty state. */
  clear: () => void;
  /** Stop emitting and abort in-flight providers. */
  dispose: () => void;
  /**
   * Swap the provider list without disturbing a run in progress, which
   * snapshots the list it started with. The built-in providers close over open
   * tabs and history, so they are rebuilt whenever a page navigates — that must
   * not abandon the query the user is in the middle of typing.
   */
  setProviders: (providers: readonly OmniboxProvider[]) => void;
  /** Queue a run for `text`, superseding any pending or in-flight run. */
  setQuery: (text: string) => void;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(Math.max(score, 0), 1);
}

/**
 * Attribution happens here rather than in providers: a provider cannot claim
 * another provider's id, and cannot score itself above the default action.
 */
function stampSuggestions(
  providerId: string,
  suggestions: readonly OmniboxProviderSuggestion[],
): readonly OmniboxSuggestion[] {
  return suggestions.map((suggestion) => ({
    ...suggestion,
    providerId,
    score: clampScore(suggestion.score),
  }));
}

/**
 * Create the query runner.
 *
 * Each run is identified by a monotonic id. Results from a superseded run are
 * dropped on arrival, so a provider that ignores its abort signal can waste
 * work but can never write into the current result set. Results are emitted as
 * each provider settles rather than after all of them, so one slow provider
 * delays only its own rows.
 *
 * Typing does not clear the visible list: a keystroke schedules a run and emits
 * nothing, so the previous query's rows stay up until the new run produces its
 * own. Blanking the list on every keystroke is the flicker this avoids.
 */
export function createOmniboxController(
  args: CreateOmniboxControllerArgs,
): OmniboxController {
  const {
    debounceMs = OMNIBOX_DEBOUNCE_MS,
    maxPerProvider = OMNIBOX_MAX_PER_PROVIDER,
    maxSuggestions = OMNIBOX_MAX_SUGGESTIONS,
    onState,
  } = args;

  let providers = args.providers;
  let runId = 0;
  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  function abandonRun(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    abortController?.abort();
    abortController = null;
    // Invalidate whatever the previous run may still resolve with.
    runId += 1;
  }

  function startRun(query: string): void {
    const currentRunId = runId;
    const runAbortController = new AbortController();
    abortController = runAbortController;
    // Snapshot: a provider list swapped mid-run must not renumber the results
    // this run is still collecting.
    const runProviders = providers;

    // Keyed by provider index, so duplicate provider ids cannot overwrite each
    // other's results, and flattening stays in registration order.
    const results = new Map<number, readonly OmniboxSuggestion[]>();
    let outstanding = runProviders.length;

    const emit = (): void => {
      const flattened = runProviders.flatMap(
        (_provider, index) => results.get(index) ?? [],
      );
      onState({
        isPending: outstanding > 0,
        query,
        suggestions: rankOmniboxSuggestions({
          maxPerProvider,
          maxSuggestions,
          suggestions: flattened,
        }),
      });
    };

    if (runProviders.length === 0) {
      emit();
      return;
    }

    for (const [index, provider] of runProviders.entries()) {
      void (async () => {
        let suggestions: readonly OmniboxSuggestion[] = [];
        try {
          suggestions = stampSuggestions(
            provider.id,
            await provider.suggest(query, {
              signal: runAbortController.signal,
            }),
          );
        } catch {
          // A failing provider drops out of this run; the rest still show. The
          // plugin-backed providers of the next milestone make this the normal
          // case rather than an edge case.
        }
        if (disposed || currentRunId !== runId) {
          return;
        }
        outstanding -= 1;
        results.set(index, suggestions);
        emit();
      })();
    }
  }

  return {
    clear() {
      abandonRun();
      if (!disposed) {
        onState(EMPTY_OMNIBOX_STATE);
      }
    },
    dispose() {
      abandonRun();
      disposed = true;
    },
    setProviders(nextProviders) {
      providers = nextProviders;
    },
    setQuery(text) {
      if (disposed) {
        return;
      }
      abandonRun();
      const query = text.trim();
      if (query.length === 0) {
        onState(EMPTY_OMNIBOX_STATE);
        return;
      }
      const scheduledRunId = runId;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (disposed || scheduledRunId !== runId) {
          return;
        }
        startRun(query);
      }, debounceMs);
    },
  };
}
