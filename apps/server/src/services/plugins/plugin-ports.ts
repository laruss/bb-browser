/**
 * The three ways a {@link PluginPort} is actually wired.
 *
 * Everything about moving bytes lives here so ./plugin-channel.ts can be about
 * correlation and lifetime and nothing else.
 */

import type { ChildProcess } from "node:child_process";
import type { PluginPort } from "./plugin-channel.js";

type Listener<T> = (value: T) => void;

/**
 * Two ports wired to each other in one process.
 *
 * Delivery is **asynchronous on purpose**. A synchronous linked pair would let
 * a test pass on re-entrancy that no real pipe permits — a handler observing
 * its own reply before returning, an ordering that only holds because the call
 * stack held it. A microtask is the cheapest thing that makes the seam behave
 * like a seam.
 *
 * It is also **serialized on purpose**, for the same reason one layer down.
 * Node's IPC puts every message through JSON, which drops `undefined`
 * properties and refuses cycles — so a payload with an optional field left
 * `undefined` sails through a real pipe and was rejected here as unreadable
 * (`isJsonValue`), hanging the request until close. A pair that skips the
 * round-trip is a pair that disagrees with the transport it stands in for,
 * in whichever direction happens to matter.
 */
export function createLinkedPorts(): [PluginPort, PluginPort] {
  const messageListeners: [Listener<unknown>[], Listener<unknown>[]] = [[], []];
  const closeListeners: [Listener<void>[], Listener<void>[]] = [[], []];
  let closed = false;

  const closeBoth = (): void => {
    if (closed) return;
    closed = true;
    for (const side of closeListeners) {
      for (const listener of [...side]) queueMicrotask(() => listener());
    }
  };

  const makePort = (self: 0 | 1): PluginPort => {
    const other = (self === 0 ? 1 : 0) as 0 | 1;
    return {
      send(message) {
        if (closed) return;
        // Serialized here rather than at delivery, because a real pipe throws
        // at the send too: `child.send` on something JSON cannot hold fails
        // for the caller, not silently for the reader.
        const delivered = JSON.parse(JSON.stringify(message)) as unknown;
        queueMicrotask(() => {
          if (closed) return;
          for (const listener of [...messageListeners[other]]) {
            listener(delivered);
          }
        });
      },
      onMessage(listener) {
        messageListeners[self].push(listener);
      },
      onClose(listener) {
        closeListeners[self].push(listener);
      },
      close: closeBoth,
    };
  };

  return [makePort(0), makePort(1)];
}

/**
 * The server's end of a spawned plugin process.
 *
 * Node's IPC channel does its own framing and JSON serialisation, which is why
 * this file has no codec in it. What it does own is the several ways a child
 * ends: `exit` when the process is gone, `close` when its stdio is, and
 * `disconnect` when only the channel went. All three mean the same thing to a
 * channel, and the first one to fire wins.
 */
export function createChildProcessPort(child: ChildProcess): PluginPort {
  const alreadyGone = child.exitCode !== null || child.signalCode !== null;
  if (!child.connected && !alreadyGone) {
    throw new Error(
      "plugin child has no usable IPC channel — spawn it with stdio including 'ipc'",
    );
  }
  const closeListeners: Listener<void>[] = [];
  // A child can exit between spawning it and wiring it up. Its `exit` event
  // has then already fired and will not fire again, so the channel would wait
  // on a process that is not there — the exact hang this layer exists to
  // prevent, arriving through the door marked "startup".
  let notifiedClosed = alreadyGone;
  const notifyClosed = (): void => {
    if (notifiedClosed) return;
    notifiedClosed = true;
    for (const listener of [...closeListeners]) listener();
  };

  child.on("exit", notifyClosed);
  child.on("close", notifyClosed);
  child.on("disconnect", notifyClosed);
  // A child that cannot even be spawned emits `error` and never `exit`.
  child.on("error", notifyClosed);

  return {
    send(message) {
      if (!child.connected) return;
      // The callback, not the return value, is where a failed send reports.
      // Any failure here means this channel will not carry another message —
      // a closed channel or a payload Node's IPC refused — so it is reported
      // as the end of the port. In-flight requests reject instead of hanging,
      // which is the failure this whole layer exists to prevent.
      child.send(message, (error) => {
        if (error) notifyClosed();
      });
    },
    onMessage(listener) {
      child.on("message", listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
      if (notifiedClosed) listener();
    },
    close() {
      if (child.connected) child.disconnect();
    },
  };
}

/**
 * The plugin process's own end, from inside the child.
 *
 * Throws when there is no IPC channel, because the alternative is a plugin host
 * that starts, registers everything, and silently talks to nobody.
 */
export function createParentProcessPort(
  proc: NodeJS.Process = process,
): PluginPort {
  const send = proc.send?.bind(proc);
  if (send === undefined) {
    throw new Error(
      "plugin host process has no IPC channel to its parent — it must be spawned with stdio including 'ipc'",
    );
  }
  const closeListeners: Listener<void>[] = [];
  let notifiedClosed = false;
  const notifyClosed = (): void => {
    if (notifiedClosed) return;
    notifiedClosed = true;
    for (const listener of [...closeListeners]) listener();
  };
  proc.on("disconnect", notifyClosed);

  return {
    send(message) {
      if (proc.connected !== true) return;
      send(message, undefined, undefined, (error) => {
        if (error) notifyClosed();
      });
    },
    onMessage(listener) {
      proc.on("message", listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
      if (notifiedClosed) listener();
    },
    close() {
      if (proc.connected === true) proc.disconnect();
    },
  };
}
