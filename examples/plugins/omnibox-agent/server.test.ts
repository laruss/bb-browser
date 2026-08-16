// Backend tests for the omnibox-agent example, written against the official
// harness (`@bb/plugin-sdk/testing`) — no bb server, no browser.
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
  type FakePluginHost,
} from "@bb/plugin-sdk/testing";
import omniboxAgent from "./server";

const PROJECT_ID = "proj-1";

async function load(
  settings: Record<string, string> = {},
): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    permissions: pluginPermissionsFromManifest(import.meta.url),
    pluginId: "omnibox-agent",
    loopbackBaseUrl: "http://127.0.0.1:38886",
    settings,
    sdk: { threads: { spawn: async () => ({ id: "th_1" }) } },
  });
  await omniboxAgent(host.bb);
  return host;
}

function provider(host: FakePluginHost) {
  const record = host.harness.registrations.omniboxProviders[0];
  if (record === undefined) {
    throw new Error("no omnibox provider registered");
  }
  return record;
}

describe("omnibox-agent", () => {
  it("registers one labelled omnibox provider", async () => {
    const host = await load({ project: PROJECT_ID });

    expect(host.harness.registrations.omniboxProviders).toHaveLength(1);
    expect(provider(host)).toMatchObject({ id: "agent", label: "Agent" });
  });

  // The navigate row needs no configuration, so the plugin is useful before
  // anyone opens its settings.
  it("offers only the site search until a project is configured", async () => {
    const host = await load();

    const items = await provider(host).suggest({ query: "flaky tests" });

    expect(items.map((item) => item.id)).toEqual(["github"]);
    expect(items[0]?.action).toEqual({
      type: "navigate",
      url: "https://github.com/search?q=flaky%20tests&type=repositories",
    });
    expect(host.harness.needsConfigurationMessages).toHaveLength(1);
  });

  it("offers the agent row once configured, ranked above the site search", async () => {
    const host = await load({ project: PROJECT_ID });

    const items = await provider(host).suggest({ query: "flaky tests" });

    expect(items.map((item) => item.id)).toEqual(["ask", "github"]);
    expect(items[0]?.action).toEqual({ type: "run" });
    // Below 1: the browser's own default action keeps the top row.
    expect(items[0]?.score).toBeLessThan(1);
    expect(items[0]?.score ?? 0).toBeGreaterThan(items[1]?.score ?? 0);
  });

  it("spawns a thread for the query and opens it in the tab", async () => {
    const host = await load({ project: PROJECT_ID });

    const result = await provider(host).run?.("ask", { query: "flaky tests" });

    expect(host.harness.sdk.callsTo("threads.spawn")).toEqual([
      [
        expect.objectContaining({
          environment: { type: "project-default" },
          // Filled in by the host, so the thread is attributed to this plugin.
          origin: "plugin",
          originPluginId: "omnibox-agent",
          projectId: PROJECT_ID,
          prompt: "flaky tests",
        }),
      ],
    ]);
    expect(result).toEqual({ navigate: "http://127.0.0.1:38886/threads/th_1" });
  });

  it("refuses to run without a project", async () => {
    const host = await load();

    await expect(
      provider(host).run?.("ask", { query: "flaky tests" }),
    ).rejects.toThrow(/not configured/u);
  });

  it("rejects an unknown item id", async () => {
    const host = await load({ project: PROJECT_ID });

    await expect(
      provider(host).run?.("nope", { query: "flaky tests" }),
    ).rejects.toThrow(/unknown omnibox item/u);
  });
});
