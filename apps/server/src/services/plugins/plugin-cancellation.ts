/**
 * Cancellation as a message.
 *
 * Two callbacks hand the plugin an `AbortSignal` — `agentTool` and `cli`, the
 * ones marked `cancellable` in ./plugin-callbacks.ts. A signal is a capability
 * and not a value, so it is the one thing in those payloads that could never
 * be sent; the payload carries the data and the signal travels as its own
 * message instead.
 *
 * Unlike the http and background-service shapes, this one is **live**. The
 * host half and the plugin half both run today, wired to each other directly
 * because they are in the same process — so every agent tool and CLI call in
 * the suite exercises the path a transport will use, rather than a description
 * of it. What changes at the boundary is one function: `send`.
 *
 * The plugin-facing behaviour is meant to be indistinguishable. The signal a
 * plugin receives is now derived rather than forwarded, and the one visible
 * difference is `signal.reason`: a reason cannot cross as an object, so the
 * far side rebuilds one. It is rebuilt as a `DOMException` named `AbortError`,
 * which is what `fetch` produces and what `error.name === "AbortError"`
 * branches expect.
 */

/** Host → plugin, alongside the call it cancels. */
export interface PluginCancelMessage {
  kind: "cancel";
  callId: string;
  /** Human-readable; the far side rebuilds a reason from it. */
  reason: string;
}

function reasonText(source: AbortSignal): string {
  const reason: unknown = source.reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.length > 0) return reason;
  return "The operation was aborted";
}

/**
 * The plugin's side: a signal for one call, and the way a cancel message
 * reaches it.
 *
 * Nothing here touches the host's signal — that is the point. Across a
 * boundary this half runs in the plugin host with no access to whatever the
 * server was watching.
 */
export function receiveCancellation(callId: string): {
  signal: AbortSignal;
  cancel: (message: PluginCancelMessage) => void;
} {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cancel(message) {
      if (message.callId !== callId || controller.signal.aborted) return;
      controller.abort(new DOMException(message.reason, "AbortError"));
    },
  };
}

/**
 * The host's side: watch the signal this call was made under and emit a cancel
 * message when it fires. Returns the detach.
 *
 * **Detaching matters more than it looks.** The source is often long-lived —
 * one CLI request, one agent turn — while calls under it are many and short.
 * A listener left behind accumulates on that signal for as long as it lives,
 * which is the ordinary way this kind of relay leaks.
 *
 * An already-aborted source sends immediately rather than waiting for an event
 * that has been and gone.
 */
export function watchForCancellation(args: {
  callId: string;
  source: AbortSignal;
  send: (message: PluginCancelMessage) => void;
}): () => void {
  const emit = (): void => {
    args.send({
      kind: "cancel",
      callId: args.callId,
      reason: reasonText(args.source),
    });
  };
  if (args.source.aborted) {
    emit();
    return () => {};
  }
  args.source.addEventListener("abort", emit, { once: true });
  return () => {
    args.source.removeEventListener("abort", emit);
  };
}

/**
 * Both halves, wired to each other for the in-process case.
 *
 * `undefined` in, `undefined` out: a CLI context whose signal is absent must
 * stay absent rather than becoming one that never fires, because a plugin can
 * tell those apart.
 */
export function linkCancellation(args: {
  callId: string;
  source: AbortSignal | undefined;
}): { signal: AbortSignal | undefined; detach: () => void } {
  if (args.source === undefined) {
    return { signal: undefined, detach: () => {} };
  }
  const receiver = receiveCancellation(args.callId);
  const detach = watchForCancellation({
    callId: args.callId,
    source: args.source,
    // The transport seam: today a call, tomorrow a write.
    send: (message) => {
      receiver.cancel(message);
    },
  });
  return { signal: receiver.signal, detach };
}
