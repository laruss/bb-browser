import { describe, expect, it } from "vitest";
import {
  permissionForBrowserCommand,
  type BrowserCommand,
  type PluginPermission,
} from "@bb/domain";
import { createFakePluginHost } from "../fake-plugin-host.js";

/**
 * The fake host charges each `bb.browser` method a permission, spelled out at
 * the call site. The host charges the *command* that method builds. Those are
 * two sets of decisions about the same thing, and this file is what stops them
 * disagreeing: each row states the method, what the fake charges it, and the
 * command the real API sends for it.
 *
 * A row failing means one of the two moved. Neither is automatically right —
 * the point is that nobody moves one silently.
 */
const SURFACE: ReadonlyArray<{
  /** How a plugin calls it, as an expression on `bb.browser`. */
  readonly call: (browser: never) => unknown;
  readonly label: string;
  readonly charged: PluginPermission;
  /** What `plugin-api.ts` sends for that call. */
  readonly command: BrowserCommand;
}> = [
  {
    label: "tabs.list",
    charged: "tabs.read",
    command: { type: "tabs.list" },
    call: (b: never) => (b as PluginBrowserish).tabs.list(),
  },
  {
    label: "tabs.open",
    charged: "tabs.modify",
    command: { type: "tabs.open", url: "https://a.test/", activate: true },
    call: (b: never) =>
      (b as PluginBrowserish).tabs.open({ url: "https://a.test/" }),
  },
  {
    label: "page.getText",
    charged: "page.read",
    command: { type: "page.get_text", tabId: null, maxLength: 100 },
    call: (b: never) => (b as PluginBrowserish).page.getText(),
  },
  {
    label: "page.act",
    charged: "page.interact",
    command: {
      type: "page.interact",
      tabId: null,
      generation: null,
      interaction: { action: "hover", ref: "e1" },
    },
    call: (b: never) =>
      (b as PluginBrowserish).page.act({ action: "hover", ref: "e1" }),
  },
  {
    label: "control.evaluate",
    charged: "page.inject",
    command: {
      type: "page.control",
      tabId: null,
      generation: null,
      operation: { kind: "evaluate", expression: "1", ref: null },
    },
    call: (b: never) =>
      (b as PluginBrowserish).control.evaluate({ expression: "1" }),
  },
  {
    label: "control.setOffline",
    charged: "network.intercept",
    command: {
      type: "page.control",
      tabId: null,
      generation: null,
      operation: { kind: "offline", offline: true },
    },
    call: (b: never) =>
      (b as PluginBrowserish).control.setOffline({ offline: true }),
  },
  {
    label: "page.network",
    charged: "network.observe",
    command: {
      type: "page.observe",
      tabId: null,
      observation: { kind: "network", limit: 10 },
    },
    call: (b: never) => (b as PluginBrowserish).page.network(),
  },
  {
    label: "storage.cookies",
    charged: "page.credentials",
    command: {
      type: "page.storage",
      tabId: null,
      operation: { kind: "cookies-get" },
    },
    call: (b: never) => (b as PluginBrowserish).storage.cookies(),
  },
  {
    label: "recording.traceStop",
    charged: "page.record",
    command: {
      type: "page.record",
      tabId: null,
      operation: { kind: "trace-stop" },
    },
    call: (b: never) => (b as PluginBrowserish).recording.traceStop(),
  },
];

/** The fake's browser surface is exercised dynamically; this names the parts used. */
type PluginBrowserish = {
  tabs: { list(): unknown; open(args: { url: string }): unknown };
  page: { getText(): unknown; act(args: unknown): unknown; network(): unknown };
  control: {
    evaluate(args: { expression: string }): unknown;
    setOffline(args: { offline: boolean }): unknown;
  };
  storage: { cookies(): unknown };
  recording: { traceStop(): unknown };
};

describe("the fake host charges what the host charges", () => {
  it.each(SURFACE)("$label", ({ charged, command }) => {
    expect(permissionForBrowserCommand(command)).toBe(charged);
  });

  // These methods refuse synchronously (the gate runs before any await) but
  // return promises when they get that far, so both shapes have to be caught.
  async function errorFrom(run: () => unknown): Promise<unknown> {
    try {
      await run();
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it.each(SURFACE)("$label refuses without it", async ({ call, charged }) => {
    const { bb } = createFakePluginHost({ pluginId: "p", permissions: [] });

    expect(await errorFrom(() => call(bb.browser as never))).toMatchObject({
      name: "PluginPermissionError",
      permission: charged,
    });
  });

  it.each(SURFACE)("$label is allowed with it", async ({ call, charged }) => {
    const { bb } = createFakePluginHost({
      pluginId: "p",
      permissions: [charged],
    });

    // Most of these then fail on the fake's own state ("no trace is running").
    // What matters here is only that the permission is no longer the reason.
    expect(await errorFrom(() => call(bb.browser as never))).not.toMatchObject({
      name: "PluginPermissionError",
    });
  });
});

describe("contribution points", () => {
  it("refuses an omnibox provider the plugin did not declare", () => {
    const { bb } = createFakePluginHost({ pluginId: "p", permissions: [] });

    expect(() =>
      bb.browser.registerOmniboxProvider({
        id: "x",
        label: "X",
        suggest: () => [],
      }),
    ).toThrow(/"omnibox\.register" permission/);
  });

  it("admits it once declared", () => {
    const { bb } = createFakePluginHost({
      pluginId: "p",
      permissions: ["omnibox.register"],
    });

    expect(() =>
      bb.browser.registerOmniboxProvider({
        id: "x",
        label: "X",
        suggest: () => [],
      }),
    ).not.toThrow();
  });

  // getStatus reports only whether a browser window is connected, which is not
  // the user's data — the host leaves it open and so does this.
  it("leaves getStatus open to a plugin that declared nothing", () => {
    const { bb } = createFakePluginHost({ pluginId: "p", permissions: [] });

    expect(() => bb.browser.getStatus()).not.toThrow();
  });
});

describe("bb.sdk in the fake host", () => {
  it("refuses an area the plugin did not declare, on the property read", () => {
    const { bb } = createFakePluginHost({ pluginId: "p", permissions: [] });

    expect(() => bb.sdk.terminals).toThrow(/"shell" permission/);
  });

  it("passes through an area it did declare", () => {
    const { bb } = createFakePluginHost({
      pluginId: "p",
      permissions: ["shell"],
    });

    expect(() => bb.sdk.terminals).not.toThrow();
  });

  // Two methods reach across areas. The fake missed them at first, which is
  // the exact drift the shared map exists to prevent: a plugin's own suite
  // passing on a manifest the install refuses.
  it("charges the cross-area methods their second price", () => {
    const threadsOnly = createFakePluginHost({
      pluginId: "p",
      permissions: ["threads"],
    });
    const workspaceOnly = createFakePluginHost({
      pluginId: "p",
      permissions: ["workspace"],
    });

    expect(() => threadsOnly.bb.sdk.threadSections.list()).toThrow(
      /"workspace"/,
    );
    expect(() =>
      workspaceOnly.bb.sdk.environments.archiveThreads({} as never),
    ).toThrow(/"threads"/);
  });

  it("charges thread events to threads, not to workspace", () => {
    const { bb } = createFakePluginHost({
      pluginId: "p",
      permissions: ["workspace"],
    });

    expect(() =>
      bb.sdk.subscribe({ event: "thread:changed", callback: () => {} }),
    ).toThrow(/"threads" permission/);
  });
});
