import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPluginKvValue } from "@bb/db";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * The loader actually placing a plugin in a plugin process.
 *
 * Everything below this has its own tests; what this file is for is the seam
 * itself — that `runPluginOutOfProcess` changes where a plugin runs and
 * nothing else, that the rest of the server cannot tell, and that a plugin
 * which cannot leave the server says so and stays.
 */

async function writePlugin(
  dir: string,
  options: { name: string; permissions?: readonly string[]; source: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: {
        name: "Out of process fixture",
        description: "Fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(options.permissions === undefined
          ? {}
          : { permissions: options.permissions }),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.source);
  return rootDir;
}

const CONTEXT_MENU_PLUGIN = `
  export default function plugin(bb: any) {
    bb.log.info("loaded out of process");
    bb.browser.registerContextMenuItem({
      id: "shout",
      title: "Shout",
      run: (ctx: any) => (ctx.selectionText ?? "").toUpperCase(),
    });
    bb.background.schedule("nightly", "0 3 * * *", () => {});
    // Runs in the plugin process; the write lands in the server's store, so
    // whether this instance was disposed is observable from outside.
    bb.onDispose(() => bb.storage.kv.set("disposed", true));
  }
`;

/** What the same plugin looks like after an edit, for the reload test. */
const EDITED_CONTEXT_MENU_PLUGIN = CONTEXT_MENU_PLUGIN.replace(
  `id: "shout",
      title: "Shout",`,
  `id: "whisper",
      title: "Whisper",`,
);

// An rpc contract used to make a plugin ineligible to leave the server,
// because the host validated with the plugin's own schema object. It validates
// next to the handler now, so this plugin moves like any other.
//
// The schema is hand-rolled rather than zod's: a Standard Schema is a shape,
// not a class, and a fixture in a temp directory has no node_modules to import
// a real validator from — in either placement, which is what once looked like
// a plugin-process defect and was the fixture's own.
const RPC_PLUGIN = `
  const wantsAnObject = {
    "~standard": {
      version: 1,
      vendor: "fixture",
      validate: (value: unknown) =>
        typeof value === "object" && value !== null
          ? { value }
          : { issues: [{ message: "expected an object" }] },
    },
  };
  export default function plugin(bb: any) {
    bb.rpc.register(
      { greet: { input: wantsAnObject, output: wantsAnObject } },
      { greet: ({ who }: { who: string }) => ({ text: "hi " + who }) },
    );
  }
`;

describe("loading a plugin into a plugin process", () => {
  let harness: TestAppHarness;

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function start(
    runPluginOutOfProcess: (pluginId: string) => boolean,
  ): Promise<void> {
    harness = await createTestAppHarness({ runPluginOutOfProcess });
  }

  it("loads and runs it, and the rest of the server cannot tell", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
    // Read through the ordinary dispatcher, which has no idea where the
    // plugin is: it finds the registration and calls it.
    const items = harness.pluginService.listContextMenuItemContributions();
    expect(items.map((item) => item.itemId)).toContain("shout");
  }, 30_000);

  // The one place the difference is visible, and it is visible on purpose:
  // there is no in-process `bb` to hand back.
  it("has no local bb object for it", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );
    await harness.pluginService.installPath(rootDir);

    expect(() => harness.pluginService.getApi("remote")).toThrow(
      /runs in its own process/,
    );
  }, 30_000);

  it("keeps loading in the server when the switch is off", async () => {
    await start(() => false);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect(entry.status).toBe("running");
    expect(harness.pluginService.getApi("remote")).toBeDefined();
  }, 30_000);

  it("serves an rpc method from the plugin's process, contract and all", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name: "bb-plugin-rpcish", source: RPC_PLUGIN },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    // No fallback: a contract full of validators is no longer a reason to
    // stay, because the validating happens where the handler is.
    expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
    expect(() => harness.pluginService.getApi("rpcish")).toThrow(
      /runs in its own process/,
    );

    const lookup = harness.pluginService.getRpcHandler("rpcish", "greet");
    if (lookup.outcome !== "found") throw new Error(lookup.outcome);
    await expect(
      harness.pluginService.invokeRpcHandler("rpcish", "greet", lookup.value, {
        who: "мир",
      }),
    ).resolves.toEqual({ ok: true, result: { text: "hi мир" } });

    // And the plugin's own validator still refuses what it always refused —
    // one process away, with the rpc failure shape intact.
    await expect(
      harness.pluginService.invokeRpcHandler(
        "rpcish",
        "greet",
        lookup.value,
        "not an object" as never,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "rpc input validation failed",
        issues: [{ message: "expected an object" }],
      },
    });
  }, 30_000);

  // A reload starts the successor while the predecessor is still serving —
  // that ordering is what makes a failed reload keep the old plugin — so for
  // the moment the swap takes, one plugin has two instances. Keyed by plugin
  // id the second start was refused outright ("already started"), which is
  // what `SupervisedPlugin.instanceId` exists to fix.
  it("reloads it, and the new instance is the one serving", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );
    await harness.pluginService.installPath(rootDir);
    // Edit it first: a predecessor that never went away is then visible in
    // what the server serves, rather than only suspected.
    await writeFile(join(rootDir, "server.ts"), EDITED_CONTEXT_MENU_PLUGIN);

    await harness.pluginService.reload("remote");

    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "remote");
    expect([entry?.status, entry?.statusDetail]).toEqual(["running", null]);
    expect(
      harness.pluginService
        .listContextMenuItemContributions()
        .map((item) => item.itemId),
    ).toEqual(["whisper"]);
    // And it is a live channel, not a registration table left behind by a
    // handle whose process is gone.
    await expect(
      harness.pluginService.runContextMenuItem({
        pluginId: "remote",
        itemId: "whisper",
        context: { selectionText: "тихо" } as never,
      }),
    ).resolves.toEqual({ ok: true });
    // The predecessor was disposed rather than abandoned: its onDispose ran
    // in the plugin process and its write reached the server's store.
    expect(getPluginKvValue(harness.db, "remote", "disposed")).toBe("true");
  }, 30_000);

  // The other half of building the successor first: when it fails, the plugin
  // that is still serving must keep serving, and must not be relabelled with
  // the failure. The in-process path has always done this; going out of
  // process must not be the reason a live plugin reads as broken.
  it("keeps the running plugin when its reload fails out of process", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );
    await harness.pluginService.installPath(rootDir);
    await writeFile(
      join(rootDir, "server.ts"),
      `export default function plugin() { throw new Error("factory exploded"); }`,
    );

    await harness.pluginService.reload("remote");

    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "remote");
    expect(entry?.status).toBe("running");
    expect(entry?.statusDetail).toMatch(/reload failed: .*factory exploded/);
    // Still the predecessor's registrations, still answering.
    expect(
      harness.pluginService
        .listContextMenuItemContributions()
        .map((item) => item.itemId),
    ).toEqual(["shout"]);
    await expect(
      harness.pluginService.runContextMenuItem({
        pluginId: "remote",
        itemId: "shout",
        context: { selectionText: "тихо" } as never,
      }),
    ).resolves.toEqual({ ok: true });
  }, 30_000);
});
