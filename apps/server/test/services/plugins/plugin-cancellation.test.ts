import { describe, expect, it, vi } from "vitest";
import {
  linkCancellation,
  receiveCancellation,
  watchForCancellation,
  type PluginCancelMessage,
} from "../../../src/services/plugins/plugin-cancellation.js";

/**
 * Cancellation crossing as a message rather than as a signal.
 *
 * The halves are tested apart as well as wired together, because apart is how
 * they will run: the host watching a signal it owns, the plugin holding one it
 * built from a message. Wired together is only the in-process case.
 */

describe("the host half", () => {
  it("sends a cancel naming the call when its source aborts", () => {
    const sent: PluginCancelMessage[] = [];
    const source = new AbortController();
    watchForCancellation({
      callId: "notes:7",
      source: source.signal,
      send: (message) => sent.push(message),
    });

    source.abort(new Error("user stopped the turn"));

    expect(sent).toEqual([
      { kind: "cancel", callId: "notes:7", reason: "user stopped the turn" },
    ]);
  });

  // An abort that already happened fires no event, so waiting for one would
  // start a call that can never be cancelled.
  it("sends immediately for a source that has already aborted", () => {
    const sent: PluginCancelMessage[] = [];
    const source = AbortSignal.abort();

    watchForCancellation({ callId: "x:1", source, send: (m) => sent.push(m) });

    expect(sent).toHaveLength(1);
  });

  /**
   * The leak this design invites: a source outlives the calls made under it —
   * one CLI request, many calls — so a listener left behind accumulates on it.
   */
  it("takes its listener back off when detached", () => {
    const listeners = new Set<() => void>();
    const source = {
      aborted: false,
      reason: undefined,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    } as unknown as AbortSignal;

    const detach = watchForCancellation({
      callId: "x:1",
      source,
      send: vi.fn(),
    });
    expect(listeners.size).toBe(1);

    detach();

    expect(listeners.size).toBe(0);
  });
});

describe("the plugin half", () => {
  it("aborts the signal it built when the message arrives", () => {
    const { signal, cancel } = receiveCancellation("notes:7");
    expect(signal.aborted).toBe(false);

    cancel({ kind: "cancel", callId: "notes:7", reason: "stopped" });

    expect(signal.aborted).toBe(true);
  });

  // The reason cannot cross as an object, so it is rebuilt — as the shape
  // `fetch` produces, which is what `error.name === "AbortError"` expects.
  it("rebuilds a reason that reads like a real abort", () => {
    const { signal, cancel } = receiveCancellation("notes:7");

    cancel({ kind: "cancel", callId: "notes:7", reason: "stopped" });

    const reason = signal.reason as DOMException;
    expect(reason.name).toBe("AbortError");
    expect(reason.message).toBe("stopped");
  });

  // Correlation is the whole reason a call has an id.
  it("ignores a cancel meant for another call", () => {
    const { signal, cancel } = receiveCancellation("notes:7");

    cancel({ kind: "cancel", callId: "notes:8", reason: "stopped" });

    expect(signal.aborted).toBe(false);
  });
});

describe("wired together, which is the in-process case", () => {
  it("carries an abort from source to derived signal", () => {
    const source = new AbortController();
    const { signal } = linkCancellation({
      callId: "x:1",
      source: source.signal,
    });

    expect(signal?.aborted).toBe(false);
    source.abort();

    expect(signal?.aborted).toBe(true);
  });

  it("hands back an already-aborted signal for an already-aborted source", () => {
    const { signal } = linkCancellation({
      callId: "x:1",
      source: AbortSignal.abort(),
    });

    expect(signal?.aborted).toBe(true);
  });

  // A CLI context whose signal is absent must stay absent: a plugin can tell
  // "no cancellation" from "a signal that never fires".
  it("keeps an absent source absent", () => {
    const { signal } = linkCancellation({ callId: "x:1", source: undefined });

    expect(signal).toBeUndefined();
  });

  it("stops relaying once detached", () => {
    const source = new AbortController();
    const { signal, detach } = linkCancellation({
      callId: "x:1",
      source: source.signal,
    });

    detach();
    source.abort();

    expect(signal?.aborted).toBe(false);
  });
});
