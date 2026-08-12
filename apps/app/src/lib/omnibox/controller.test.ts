import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOmniboxController, type OmniboxState } from "./controller";
import type {
  OmniboxProvider,
  OmniboxProviderContext,
  OmniboxProviderSuggestion,
} from "./types";

const DEBOUNCE_MS = 120;

function suggestion(id: string, score = 0.5): OmniboxProviderSuggestion {
  return {
    action: { type: "navigate", url: `https://${id}.test/` },
    id,
    kind: "navigate",
    score,
    subtitle: null,
    title: id,
  };
}

type SuggestResolver = (
  suggestions: readonly OmniboxProviderSuggestion[],
) => void;

interface DeferredProvider {
  calls: string[];
  provider: OmniboxProvider;
  /**
   * Release one specific `suggest` call. Per-call rather than per-provider,
   * because the point of several tests is what happens when an *earlier* call
   * answers after a later one has already started.
   */
  resolve: (
    callIndex: number,
    suggestions: readonly OmniboxProviderSuggestion[],
  ) => void;
  signals: AbortSignal[];
}

/** A provider whose answers are released by the test, to script arrival order. */
function deferredProvider(id: string): DeferredProvider {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const resolvers: SuggestResolver[] = [];
  return {
    calls,
    provider: {
      id,
      suggest(query: string, context: OmniboxProviderContext) {
        calls.push(query);
        signals.push(context.signal);
        return new Promise<readonly OmniboxProviderSuggestion[]>((resolve) => {
          resolvers.push(resolve);
        });
      },
    },
    resolve(callIndex, suggestions) {
      const resolver = resolvers[callIndex];
      if (resolver === undefined) {
        throw new Error(`No pending suggest call at index ${callIndex}`);
      }
      resolver(suggestions);
    },
    signals,
  };
}

function syncProvider(
  id: string,
  suggestions: readonly OmniboxProviderSuggestion[],
): OmniboxProvider {
  return { id, suggest: () => suggestions };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createOmniboxController", () => {
  it("runs providers once after the debounce, with the latest query", async () => {
    const deferred = deferredProvider("p");
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [deferred.provider],
    });

    controller.setQuery("g");
    controller.setQuery("gi");
    controller.setQuery("git");
    // Typing itself emits nothing: the previous query's rows stay up instead of
    // the list blanking on every keystroke.
    expect(states).toEqual([]);
    expect(deferred.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(deferred.calls).toEqual(["git"]);
  });

  it("emits each provider's rows as it settles, and clears isPending at the end", async () => {
    const fast = deferredProvider("fast");
    const slow = deferredProvider("slow");
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [fast.provider, slow.provider],
    });

    controller.setQuery("query");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    fast.resolve(0, [suggestion("fast-row")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toHaveLength(1);
    expect(states[0]?.isPending).toBe(true);
    expect(states[0]?.suggestions.map((row) => row.id)).toEqual(["fast-row"]);

    slow.resolve(0, [suggestion("slow-row")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toHaveLength(2);
    expect(states[1]?.isPending).toBe(false);
    expect(states[1]?.suggestions.map((row) => row.id)).toEqual([
      "fast-row",
      "slow-row",
    ]);
  });

  // The bug this guards: a slow provider answering the query the user has
  // already typed past, writing stale rows into the live list.
  it("drops results from a superseded run, even if the provider ignores the signal", async () => {
    const deferred = deferredProvider("p");
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [deferred.provider],
    });

    controller.setQuery("first");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(deferred.calls).toEqual(["first"]);

    controller.setQuery("second");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(deferred.signals[0]?.aborted).toBe(true);

    deferred.resolve(0, [suggestion("stale")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toEqual([]);
  });

  it("keeps the other providers when one throws", async () => {
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [
        {
          id: "broken",
          suggest() {
            throw new Error("provider blew up");
          },
        },
        syncProvider("healthy", [suggestion("healthy-row")]),
      ],
    });

    controller.setQuery("query");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(states.at(-1)?.isPending).toBe(false);
    expect(states.at(-1)?.suggestions.map((row) => row.id)).toEqual([
      "healthy-row",
    ]);
  });

  it("rejects a rejected promise the same way", async () => {
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [
        { id: "broken", suggest: () => Promise.reject(new Error("nope")) },
        syncProvider("healthy", [suggestion("healthy-row")]),
      ],
    });

    controller.setQuery("query");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(states.at(-1)?.suggestions.map((row) => row.id)).toEqual([
      "healthy-row",
    ]);
  });

  // A provider cannot claim another's attribution, nor outbid the default
  // action by returning an out-of-range score.
  it("stamps the provider id and clamps scores into [0, 1]", async () => {
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [
        {
          id: "honest",
          suggest: () => [
            { ...suggestion("greedy", 99), id: "greedy" },
            { ...suggestion("negative", -5), id: "negative" },
          ],
        },
      ],
    });

    controller.setQuery("query");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(states.at(-1)?.suggestions).toEqual([
      expect.objectContaining({ id: "greedy", providerId: "honest", score: 1 }),
      expect.objectContaining({
        id: "negative",
        providerId: "honest",
        score: 0,
      }),
    ]);
  });

  it("empties immediately for a blank query without running providers", async () => {
    const deferred = deferredProvider("p");
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [deferred.provider],
    });

    controller.setQuery("   ");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(states).toEqual([{ isPending: false, query: "", suggestions: [] }]);
    expect(deferred.calls).toEqual([]);
  });

  it("trims the query before providers see it", async () => {
    const deferred = deferredProvider("p");
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: () => {},
      providers: [deferred.provider],
    });

    controller.setQuery("  spaced  ");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(deferred.calls).toEqual(["spaced"]);
  });

  it("cancels a pending run on clear", async () => {
    const deferred = deferredProvider("p");
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [deferred.provider],
    });

    controller.setQuery("query");
    controller.clear();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(deferred.calls).toEqual([]);
    expect(states).toEqual([{ isPending: false, query: "", suggestions: [] }]);
  });

  it("stops emitting after dispose", async () => {
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [syncProvider("p", [suggestion("row")])],
    });

    controller.setQuery("query");
    controller.dispose();
    controller.setQuery("again");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(states).toEqual([]);
  });

  // Providers close over open tabs and history, so they are rebuilt whenever a
  // page navigates. That must not abandon the query being typed.
  it("swaps providers without disturbing a run in progress", async () => {
    const deferred = deferredProvider("original");
    const states: OmniboxState[] = [];
    const controller = createOmniboxController({
      debounceMs: DEBOUNCE_MS,
      onState: (state) => states.push(state),
      providers: [deferred.provider],
    });

    controller.setQuery("query");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    controller.setProviders([syncProvider("replacement", [])]);
    deferred.resolve(0, [suggestion("in-flight-row")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)?.suggestions.map((row) => row.id)).toEqual([
      "in-flight-row",
    ]);

    controller.setQuery("next");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(deferred.calls).toEqual(["query"]);
    expect(states.at(-1)?.suggestions).toEqual([]);
  });
});
