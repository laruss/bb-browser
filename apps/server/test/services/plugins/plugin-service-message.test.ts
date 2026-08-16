import { describe, expect, it } from "vitest";
import { reduceServiceEvent } from "../../../src/services/plugins/plugin-service-message.js";

/**
 * The lifecycle a background service reduces to.
 *
 * Each case here mirrors a branch the in-process runner already performs in
 * `plugin-runtime.ts` — this is a description of existing behaviour, not a new
 * policy, and it is only worth anything if it stays true of that behaviour.
 * The branch each one corresponds to is named, so a change over there has
 * somewhere to fail over here.
 */

describe("reduceServiceEvent", () => {
  // Runner: `service.state = "running"` when start() is entered.
  it("marks a started service running", () => {
    expect(
      reduceServiceEvent({
        event: { kind: "started", name: "watcher" },
        stabilizing: false,
      }),
    ).toEqual({
      state: "running",
      restart: false,
      stopRetrying: false,
      failsPlugin: false,
    });
  });

  // Runner: "Resolved without being aborted: the service chose to stop."
  // Returning and throwing are different outcomes, and only one restarts.
  it("does not restart a service that returned", () => {
    expect(
      reduceServiceEvent({
        event: { kind: "exited", name: "watcher" },
        stabilizing: false,
      }),
    ).toMatchObject({ state: "stopped", restart: false });
  });

  // Runner: crash → backoff, consecutiveCrashes += 1, restart timer.
  it("restarts a crash from a settled plugin, through backoff", () => {
    expect(
      reduceServiceEvent({
        event: { kind: "crashed", name: "watcher", message: "boom" },
        stabilizing: false,
      }),
    ).toMatchObject({ state: "backoff", restart: true, failsPlugin: false });
  });

  // Runner: `if (stabilizingPluginIds.has(id))` → stopped, plugin set to
  // "error", no restart. The same reported crash, a different answer — which
  // is why the host decides and the plugin only reports.
  it("treats the same crash during activation as a failed load", () => {
    expect(
      reduceServiceEvent({
        event: { kind: "crashed", name: "watcher", message: "boom" },
        stabilizing: true,
      }),
    ).toMatchObject({ state: "stopped", restart: false, failsPlugin: true });
  });

  // Runner: NeedsConfigurationError → stopped, "not restarting until reload".
  it("stops retrying a service that asked to be configured", () => {
    expect(
      reduceServiceEvent({
        event: {
          kind: "needs-configuration",
          name: "watcher",
          message: "set a token",
        },
        stabilizing: false,
      }),
    ).toMatchObject({
      state: "stopped",
      restart: false,
      stopRetrying: true,
    });
  });

  // Activation is host-side knowledge, so it must not change the answer for
  // anything except a crash — otherwise the plugin's report would mean
  // different things depending on state it cannot see.
  it("ignores activation for every event but a crash", () => {
    for (const kind of ["started", "exited", "needs-configuration"] as const) {
      const event = { kind, name: "watcher", message: "x" } as never;
      expect(reduceServiceEvent({ event, stabilizing: true })).toEqual(
        reduceServiceEvent({ event, stabilizing: false }),
      );
    }
  });
});
