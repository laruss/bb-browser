/**
 * A plugin background service as messages.
 *
 * `service(name, { start(signal) })` is not a call: nothing returns, the
 * function runs until its signal aborts, and everything interesting — a crash,
 * a restart, backoff, a plugin declaring itself unconfigured — happens while it
 * is running. That looked like it needed its own vocabulary: two streams of
 * messages, and a host-side reducer for the state between them.
 *
 * **Applying it showed one of those two halves was unnecessary.** The channel
 * already carries the whole lifecycle as a single cancellable request
 * (./plugin-remote-handle.ts): the request stays open for as long as `start`
 * runs, the host's cancel message is the abort the plugin sees, resolving means
 * the service returned, and rejecting means it threw. Those are exactly the two
 * outcomes `onServiceSettled` in ./plugin-runtime.ts already decides on — so
 * the restart policy, the capped backoff, the crash counter and the "still
 * stabilizing" rule all keep working, in the one place they already lived.
 *
 * The reducer that used to be here went with them. It was a pure function of
 * the same decisions, which is a second copy of a policy, and this file's own
 * argument against that has not changed:
 *
 * - **The host owns the state machine.** A plugin host that decided its own
 *   restart policy would be a second policy, and two policies for one thing is
 *   how they disagree.
 * - **The plugin owns only what it observes**: that its `start` returned, or
 *   threw. It reports; it does not decide.
 *
 * What remains is the naming, which the transport does use: a `start` command
 * on the way out, and the outcomes named for what they are.
 */

/** Host → plugin. `stop` is delivered as the request's cancel message. */
export type PluginServiceCommand =
  | { kind: "start"; name: string }
  | { kind: "stop"; name: string };

/**
 * Plugin → host, as the request settles.
 *
 * Kept as names rather than sent as messages: `exited` is the request
 * resolving, `crashed` is it rejecting, and `needs-configuration` is it
 * rejecting with an error whose name says so — which the host recognises
 * through `isNeedsConfigurationError` without any special case, because errors
 * cross by name.
 */
export type PluginServiceOutcome = "exited" | "crashed" | "needs-configuration";
