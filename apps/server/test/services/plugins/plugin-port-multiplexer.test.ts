import { describe, expect, it } from "vitest";
import {
  createPluginChannel,
  type PluginPort,
} from "../../../src/services/plugins/plugin-channel.js";
import { createLinkedPorts } from "../../../src/services/plugins/plugin-ports.js";
import { createPortMultiplexer } from "../../../src/services/plugins/plugin-port-multiplexer.js";

/**
 * One pipe, several plugins. The properties that matter are that they cannot
 * hear each other, and that when the pipe dies they all find out — the second
 * being what makes a shared process survivable at all.
 */

function sharedPipe(options: { onUnroutable?: (p: string) => void } = {}) {
  const [serverSide, childSide] = createLinkedPorts();
  const problems: string[] = [];
  const server = createPortMultiplexer({
    port: serverSide,
    onUnroutable: (problem) => {
      problems.push(problem);
      options.onUnroutable?.(problem);
    },
  });
  const openedInChild: { key: string; port: PluginPort }[] = [];
  const child = createPortMultiplexer({
    port: childSide,
    acceptUnknownKeys: true,
    onChannelOpened: (key, port) => openedInChild.push({ key, port }),
    onUnroutable: (problem) => problems.push(problem),
  });
  return { server, child, openedInChild, problems, childSide };
}

/** Echoes its own key back, so a crossed wire is visible in the answer. */
function echoOnChild(key: string, port: PluginPort) {
  createPluginChannel({
    port,
    name: `child:${key}`,
    onRequest: ({ payload }) => ({ from: key, payload }),
  });
}

describe("many channels over one pipe", () => {
  it("keeps two plugins' traffic apart", async () => {
    const pipe = sharedPipe();
    const a = createPluginChannel({
      port: pipe.server.open("alpha"),
      name: "a",
    });
    const b = createPluginChannel({
      port: pipe.server.open("beta"),
      name: "b",
    });
    // The child side learns of a channel from its first frame, so send first.
    const askA = a.request({ method: "rpc", payload: 1 });
    const askB = b.request({ method: "rpc", payload: 2 });
    await new Promise((r) => setTimeout(r, 5));
    for (const opened of pipe.openedInChild)
      echoOnChild(opened.key, opened.port);
    // Re-ask now that the far side is listening; the first pair was only to
    // make the channels exist over there.
    void askA.catch(() => {});
    void askB.catch(() => {});

    await expect(a.request({ method: "rpc", payload: "one" })).resolves.toEqual(
      {
        from: "alpha",
        payload: "one",
      },
    );
    await expect(b.request({ method: "rpc", payload: "two" })).resolves.toEqual(
      {
        from: "beta",
        payload: "two",
      },
    );
  });

  it("leaves the other channel working when one closes", async () => {
    const pipe = sharedPipe();
    const a = createPluginChannel({
      port: pipe.server.open("alpha"),
      name: "a",
    });
    const b = createPluginChannel({
      port: pipe.server.open("beta"),
      name: "b",
    });
    a.notify({ method: "log.info", payload: null });
    b.notify({ method: "log.info", payload: null });
    await new Promise((r) => setTimeout(r, 5));
    for (const opened of pipe.openedInChild)
      echoOnChild(opened.key, opened.port);

    pipe.server.close("alpha");
    await new Promise((r) => setTimeout(r, 5));

    expect(a.closed).toBe(true);
    expect(b.closed).toBe(false);
    await expect(
      b.request({ method: "rpc", payload: "still here" }),
    ).resolves.toBeTruthy();
    expect(pipe.server.keys()).toEqual(["beta"]);
  });

  // The point of the whole layer: a shared process is only acceptable if one
  // crash tells every caller in it, rather than leaving promises pending.
  it("closes every channel when the pipe goes down", async () => {
    const pipe = sharedPipe();
    const a = createPluginChannel({
      port: pipe.server.open("alpha"),
      name: "a",
    });
    const b = createPluginChannel({
      port: pipe.server.open("beta"),
      name: "b",
    });
    const inFlightA = a.request({ method: "agentTool", payload: null });
    const inFlightB = b.request({ method: "agentTool", payload: null });

    pipe.childSide.close();

    await expect(inFlightA).rejects.toThrow(/closed/);
    await expect(inFlightB).rejects.toThrow(/closed/);
  });

  it("refuses a channel the server never opened", async () => {
    const pipe = sharedPipe();
    const rogue = pipe.child.open("uninvited");
    createPluginChannel({ port: rogue, name: "rogue" }).notify({
      method: "log.info",
      payload: "hello",
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(pipe.problems).toContain('frame for unopened channel "uninvited"');
  });

  it("reports a frame that is not a frame", async () => {
    const pipe = sharedPipe();
    (pipe.childSide.send as (m: unknown) => void)({ not: "a frame" });
    await new Promise((r) => setTimeout(r, 5));

    expect(pipe.problems.some((p) => p.startsWith("unroutable frame"))).toBe(
      true,
    );
  });

  it("will not open the same key twice", () => {
    const pipe = sharedPipe();
    pipe.server.open("alpha");

    expect(() => pipe.server.open("alpha")).toThrow(/already open/);
  });

  it("frees the key again once the channel closes", () => {
    const pipe = sharedPipe();
    pipe.server.open("alpha");
    pipe.server.close("alpha");

    expect(() => pipe.server.open("alpha")).not.toThrow();
  });
});
