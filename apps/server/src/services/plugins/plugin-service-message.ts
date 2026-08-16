import type { PluginServiceState } from "./plugin-service-internal.js";

/**
 * A plugin background service as messages.
 *
 * The other callback that cannot cross as it stands, and it differs from every
 * other one in kind rather than in detail: `service(name, { start(signal) })`
 * is not a call. Nothing returns. The function runs until its signal aborts,
 * and everything interesting — a crash, a restart, backoff, a plugin declaring
 * itself unconfigured — happens while it is running.
 *
 * So a request/response transport cannot carry it. What it needs is two
 * streams of messages and one owner for the state between them, and this file
 * is that vocabulary.
 *
 * **Who owns what** is the decision worth recording, because it is not
 * obvious and it is the one that keeps the two sides honest:
 *
 * - **The host owns the state machine.** Restart, capped backoff, the crash
 *   counter, the "healthy for long enough to reset the backoff" rule — all of
 *   it stays where it is today. A plugin host that decided its own restart
 *   policy would be a second policy, and two policies for one thing is how
 *   they disagree.
 * - **The plugin owns only what it observes**: that its `start` returned, or
 *   threw, or that it wants to be marked unconfigured. It reports; it does not
 *   decide.
 *
 * That split is why {@link reduceServiceEvent} is a pure function from the
 * current state and one reported event to the next state: the host can run it
 * without asking anything, and it is testable against the transitions the
 * in-process runner already performs.
 */

/** Host → plugin. */
export type PluginServiceCommand =
  | { kind: "start"; name: string }
  /** The abort a plugin sees as its `signal` firing. */
  | { kind: "stop"; name: string };

/** Plugin → host. Everything the far side can truthfully report. */
export type PluginServiceEvent =
  /** `start` was entered; the host clocks health from here. */
  | { kind: "started"; name: string }
  /** `start` resolved on its own, which is a stop rather than a failure. */
  | { kind: "exited"; name: string }
  /** `start` threw. `message` is what lands in the plugin's status detail. */
  | { kind: "crashed"; name: string; message: string }
  /** The plugin threw NeedsConfigurationError: stop, and do not restart. */
  | { kind: "needs-configuration"; name: string; message: string };

/**
 * What the host does about one reported event.
 *
 * `restart` is the host's decision, not the plugin's — see the ownership note
 * above. `stopRetrying` distinguishes a service that failed from one that
 * asked to stay down until the next load, and `failsPlugin` marks the case
 * where a crash is the plugin's problem rather than the service's.
 */
export interface PluginServiceTransition {
  state: PluginServiceState;
  restart: boolean;
  stopRetrying: boolean;
  failsPlugin: boolean;
}

/**
 * The host's decision about one reported event.
 *
 * `stabilizing` is host-side knowledge the plugin does not have, and it is the
 * clearest illustration of the ownership split: the same reported crash means
 * "restart it" from a settled plugin and "this plugin failed to come up" from
 * one that is still activating. A plugin host deciding for itself could not
 * tell those apart.
 */
export function reduceServiceEvent(args: {
  event: PluginServiceEvent;
  /** The plugin is still activating, so a crash is a failed load. */
  stabilizing: boolean;
}): PluginServiceTransition {
  const settled = {
    restart: false,
    stopRetrying: false,
    failsPlugin: false,
  } as const;
  switch (args.event.kind) {
    case "started":
      return { ...settled, state: "running" };
    case "exited":
      // A service whose start() resolves has finished its work. The runner
      // does not restart it, which is the behaviour a transport must keep:
      // "returned" and "threw" are different outcomes.
      return { ...settled, state: "stopped" };
    case "needs-configuration":
      return { ...settled, state: "stopped", stopRetrying: true };
    case "crashed":
      return args.stabilizing
        ? { ...settled, state: "stopped", failsPlugin: true }
        : { ...settled, state: "backoff", restart: true };
  }
}
