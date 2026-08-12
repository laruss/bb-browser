import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestThreadSequence, getThread } from "@bb/db";
import { turnScope } from "@bb/domain";
import {
  generatedSkillsRootPath,
  pluginCommandsSkillDir,
} from "../../../src/services/plugins/plugin-commands-skill.js";
import { resolveInjectedSkillSources } from "../../../src/services/skills/injected-skills.js";
import { applyLoggedThreadLifecycleEvent } from "../../../src/services/threads/lifecycle-outcome.js";
import {
  seedEvent,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  startTestServer,
  testLogger,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

/** The repo's real hero example plugins — installed exactly as shipped. */
const EXAMPLES_DIR = fileURLToPath(
  new URL("../../../../../examples/plugins", import.meta.url),
);

// The examples pin engines.bb to ">=0.9"; the harness default app version
// ("0.0.0-test") would legitimately mark them incompatible.
const APP_VERSION = "1.0.0";

function slackHeaders(
  signingSecret: string,
  rawBody: string,
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    "v0=" +
    createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");
  return {
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  };
}

describe("hero plugin: agent-enrichment", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness({ appVersion: APP_VERSION });
    const entry = await harness.pluginService.installPath(
      join(EXAMPLES_DIR, "agent-enrichment"),
    );
    expect(entry.id).toBe("agent-enrichment");
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function runDocs(argv: string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/agent-enrichment/cli`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  }

  it("bb docs search returns excerpts from the bundled docs via the CLI endpoint", async () => {
    const result = await runDocs(["search", "conventional commits"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("conventions.md");
    expect(result.stdout).toContain("conventional commits");

    // The kv cache backs `bb docs last`.
    const last = await runDocs(["last"]);
    expect(last.exitCode).toBe(0);
    expect(last.stdout).toContain('"conventional commits"');
  });

  it("the caseSensitive boolean setting changes search behavior without a reload", async () => {
    const insensitive = await runDocs(["search", "CONVENTIONAL COMMITS"]);
    expect(insensitive.stdout).toContain("conventions.md");

    await harness.pluginService.updateSettings("agent-enrichment", {
      caseSensitive: true,
    });
    const sensitive = await runDocs(["search", "CONVENTIONAL COMMITS"]);
    expect(sensitive.exitCode).toBe(0);
    expect(sensitive.stdout).toContain("No matches");
  });

  it("its command reaches agents through the generated plugin-commands skill", async () => {
    const skillFile = join(
      pluginCommandsSkillDir(harness.config.dataDir),
      "SKILL.md",
    );
    const content = await readFile(skillFile, "utf8");
    expect(content).toContain("## bb docs —");
    expect(content).toContain("bb docs search <query...>");

    // Resolved the same way thread-runtime-config wires the generated root.
    const sources = resolveInjectedSkillSources(testLogger, {
      additionalSkillsRootPaths: [
        generatedSkillsRootPath(harness.config.dataDir),
      ],
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
      skillTreeRegistry: harness.deps.skillTreeRegistry,
    });
    expect(
      sources.find((source) => source.name === "plugin-commands"),
    ).toMatchObject({ kind: "tree", entryPath: "SKILL.md" });
  });

  it("auto-imports its skills/ directory through the plugin skills tier", () => {
    const pluginSkillRoots = harness.pluginService.listSkillRootContributions();
    expect(pluginSkillRoots).toContainEqual(
      expect.objectContaining({
        rootPath: join(EXAMPLES_DIR, "agent-enrichment", "skills"),
      }),
    );
    // Resolved the same way thread-runtime-config wires the plugin tier.
    const sources = resolveInjectedSkillSources(testLogger, {
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
      pluginSkillRoots,
      skillTreeRegistry: harness.deps.skillTreeRegistry,
    });
    const skill = sources.find((source) => source.name === "repo-conventions");
    expect(skill).toBeDefined();
    expect(skill?.description).toContain("Conventions");
    expect(skill).toMatchObject({ kind: "tree", entryPath: "SKILL.md" });
  });
});

describe("hero plugin: slack-bot", () => {
  it("webhook → spawn → thread.idle → chat.postMessage, end to end", async () => {
    const server = await startTestServer({ appVersion: APP_VERSION });
    const realFetch = globalThis.fetch;
    const slackCalls: Array<{ url: string; body: Record<string, unknown> }> =
      [];
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/slack-bot-hero-source",
      });

      // Mock ONLY the outbound Slack Web API (the true external boundary);
      // everything else — including the plugin's loopback bb.sdk calls —
      // passes through to the real fetch.
      globalThis.fetch = (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.startsWith("https://slack.com/")) {
          slackCalls.push({
            url,
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          });
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }
        return realFetch(input, init);
      }) as typeof fetch;

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const entry = await server.pluginService.installPath(
        join(EXAMPLES_DIR, "slack-bot"),
      );
      expect(entry.id).toBe("slack-bot");
      // Unconfigured: loaded, but honestly reporting what it needs.
      expect(entry.status).toBe("needs-configuration");
      expect(entry.statusDetail).toContain("bb plugin config slack-bot");

      // Configure (as `bb plugin config slack-bot set ...` would) + reload.
      const signingSecret = "test-signing-secret";
      await server.pluginService.updateSettings("slack-bot", {
        botToken: "xoxb-test-token",
        signingSecret,
        channelId: "C0GENERAL",
        project: project.id,
      });
      await server.pluginService.reload("slack-bot");
      expect(
        server.pluginService.list().find((p) => p.id === "slack-bot")?.status,
      ).toBe("running");

      const eventsUrl = `${server.baseUrl}/api/v1/plugins/slack-bot/http/events`;

      // An unsigned request never reaches the event handlers.
      const forged = await realFetch(eventsUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-slack-signature": "v0=deadbeef",
        },
        body: JSON.stringify({ type: "url_verification", challenge: "nope" }),
      });
      expect(forged.status).toBe(401);

      // Slack's URL-verification handshake round-trips the challenge.
      const challengeBody = JSON.stringify({
        type: "url_verification",
        challenge: "challenge-123",
      });
      const verification = await realFetch(eventsUrl, {
        method: "POST",
        headers: slackHeaders(signingSecret, challengeBody),
        body: challengeBody,
      });
      expect(verification.status).toBe(200);
      expect(await verification.json()).toEqual({
        challenge: "challenge-123",
      });

      // An app_mention spawns an attributed BB thread and records the
      // Slack-thread ↔ BB-thread mapping in kv.
      const mentionBody = JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C0GENERAL",
          text: "<@U0BOT> summarize the release notes",
          ts: "1720000000.000100",
        },
      });
      const mention = await realFetch(eventsUrl, {
        method: "POST",
        headers: slackHeaders(signingSecret, mentionBody),
        body: mentionBody,
      });
      expect(mention.status).toBe(200);
      expect(await mention.json()).toEqual({ ok: true });

      const api = server.pluginService.getApi("slack-bot");
      expect(api).toBeDefined();
      const threadId = await api?.storage.kv.get<string>(
        "slack:1720000000.000100",
      );
      expect(threadId).toBeDefined();
      const threadRow = getThread(server.db, threadId as string);
      expect(threadRow?.originPluginId).toBe("slack-bot");
      expect(threadRow?.title).toBe("Slack: summarize the release notes");

      // Drive the spawned thread to idle through the real lifecycle seam
      // (no live provider in tests) with an assistant message on record.
      const lifecycleDeps = {
        db: server.db,
        hub: server.hub,
        logger: testLogger,
      };
      applyLoggedThreadLifecycleEvent(lifecycleDeps, {
        threadId: threadId as string,
        event: { type: "run.started" },
      });
      seedEvent(server.deps, {
        threadId: threadId as string,
        environmentId: threadRow?.environmentId ?? null,
        providerThreadId: "provider-slack-1",
        scope: turnScope("turn-1"),
        sequence:
          getLatestThreadSequence(server.db, {
            threadId: threadId as string,
          }) + 1,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "assistant-1",
            text: "Release notes: all green.",
          },
        },
      });
      const outcome = applyLoggedThreadLifecycleEvent(lifecycleDeps, {
        threadId: threadId as string,
        event: { type: "run.succeeded" },
      });
      expect(outcome.applied).toBe(true);

      // thread.idle → chat.postMessage into the originating Slack thread.
      await vi.waitFor(() => expect(slackCalls).toHaveLength(1));
      expect(slackCalls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
      expect(slackCalls[0]?.body).toEqual({
        channel: "C0GENERAL",
        thread_ts: "1720000000.000100",
        text: "Release notes: all green.",
      });

      // The failure-isolation stats saw the handler and recorded no errors.
      const listed = server.pluginService
        .list()
        .find((p) => p.id === "slack-bot");
      expect(listed?.handlerStats.errorCount).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      await server.pluginService.stop();
      await server.close();
    }
  });
});

describe("hero plugin: omnibox-agent", () => {
  it("contributes omnibox rows, and a picked ask spawns an attributed thread", async () => {
    const server = await startTestServer({ appVersion: APP_VERSION });
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/omnibox-agent-hero-source",
      });
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });

      const suggest = async (query: string) => {
        const response = await fetch(
          `${server.baseUrl}/api/v1/plugins/omnibox/suggest?q=${encodeURIComponent(query)}`,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          groups: Array<{
            items: Array<{ itemId: string; score: number; action: unknown }>;
            label: string;
            providerId: string;
          }>;
        };
        return body.groups;
      };

      const entry = await server.pluginService.installPath(
        join(EXAMPLES_DIR, "omnibox-agent"),
      );
      expect(entry.id).toBe("omnibox-agent");
      // Unconfigured: loaded, but honestly reporting what it needs.
      expect(entry.status).toBe("needs-configuration");
      expect(entry.statusDetail).toContain("bb plugin config omnibox-agent");

      // The navigate row needs no configuration, so the plugin contributes to
      // the omnibox before anyone opens its settings.
      const unconfigured = await suggest("flaky tests");
      expect(unconfigured).toHaveLength(1);
      expect(unconfigured[0]?.label).toBe("Agent");
      expect(unconfigured[0]?.items.map((item) => item.itemId)).toEqual([
        "agent:github",
      ]);

      // Configure (as `bb plugin config omnibox-agent set ...` would) + reload:
      // the omnibox gains a row with no browser-core change.
      await server.pluginService.updateSettings("omnibox-agent", {
        project: project.id,
      });
      await server.pluginService.reload("omnibox-agent");
      expect(
        server.pluginService.list().find((p) => p.id === "omnibox-agent")
          ?.status,
      ).toBe("running");

      const configured = await suggest("flaky tests");
      expect(configured[0]?.items.map((item) => item.itemId)).toEqual([
        "agent:ask",
        "agent:github",
      ]);
      expect(configured[0]?.items[0]?.action).toEqual({ type: "run" });
      // Below 1: the browser's own default action keeps the top row.
      expect(configured[0]?.items[0]?.score).toBeLessThan(1);

      // Picking the ask row runs the plugin, which spawns a BB thread through
      // its loopback SDK and hands the browser the thread's URL to open.
      const run = await fetch(`${server.baseUrl}/api/v1/plugins/omnibox/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: "agent:ask",
          pluginId: "omnibox-agent",
          query: "flaky tests",
        }),
      });
      expect(run.status).toBe(200);
      const runBody = (await run.json()) as { navigate: string; ok: boolean };
      expect(runBody.ok).toBe(true);
      expect(runBody.navigate.startsWith(`${server.baseUrl}/threads/`)).toBe(
        true,
      );

      const threadId = runBody.navigate.split("/threads/")[1] ?? "";
      const threadRow = getThread(server.db, threadId);
      expect(threadRow?.originPluginId).toBe("omnibox-agent");
      expect(threadRow?.title).toBe("Omnibox: flaky tests");

      const listed = server.pluginService
        .list()
        .find((p) => p.id === "omnibox-agent");
      expect(listed?.handlerStats.errorCount).toBe(0);
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});
