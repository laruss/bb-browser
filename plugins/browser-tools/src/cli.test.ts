import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import plugin from "./server.js";

/**
 * `bb browser …` exists to make the bridge observable without running an agent,
 * so what matters here is that it reaches the same API and reports the same
 * refusals — a debugging tool that lies about the state of the bridge is worse
 * than none.
 */

function createHost() {
  const host = createFakePluginHost({ pluginId: "browser-tools" });
  plugin(host.bb);
  host.harness.behavior.browser.setTabs([
    { tabId: "tab-1", url: "https://example.com/", title: "Example" },
    { tabId: "tab-2", url: "https://other.test/", title: "Other", live: false },
  ]);
  host.harness.behavior.browser.setPageContent("tab-1", {
    text: "The page text.",
    selection: "page",
  });
  return host;
}

describe("bb browser CLI", () => {
  it("registers under a name the bb CLI allows", () => {
    const host = createHost();
    const cli = host.harness.inspection.registrations.cli;

    expect(cli?.name).toBe("browser");
    // Subcommand metadata is rendered in help without executing plugin code,
    // so it has to list what run() actually accepts.
    const names = (cli?.commands ?? []).map((command) => command.name);
    expect(names).toContain("tabs");
    expect(names).toContain("text");
    expect(names).toContain("status");
  });

  it("prints usage instead of guessing when told nothing", async () => {
    const host = createHost();

    const result = await host.harness.runCli([]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Usage: bb browser");
  });

  it("lists tabs, marking the active one and the cold ones", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["tabs"]);

    expect(result.exitCode).toBe(0);
    // A cold tab cannot be read or stepped through history, so it is the one
    // distinction the default output has to make visible.
    expect(result.stdout).toContain("tab-1");
    expect(result.stdout).toContain("live");
    expect(result.stdout).toContain("cold");
  });

  it("emits machine-readable output on request", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["tabs", "--json"]);

    const parsed = JSON.parse(result.stdout) as Array<{ tabId: string }>;
    expect(parsed.map((tab) => tab.tabId)).toEqual(["tab-1", "tab-2"]);
  });

  it("drives the same browser API the agent tools use", async () => {
    const host = createHost();

    await host.harness.runCli(["open", "https://example.com/next"]);
    await host.harness.runCli(["open", "https://fresh.test/", "--new-tab"]);
    await host.harness.runCli(["activate", "tab-2"]);
    await host.harness.runCli(["reload", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls.map((call) => call.type),
    ).toEqual([
      "navigation.open",
      "tabs.open",
      "tabs.activate",
      "navigation.reload",
    ]);
  });

  it("reads page text and reports a truncation on stderr", async () => {
    const host = createHost();

    const full = await host.harness.runCli(["text", "--tab", "tab-1"]);
    expect(full.stdout).toContain("The page text.");
    expect(full.stderr ?? "").not.toContain("truncated");

    const clipped = await host.harness.runCli([
      "text",
      "--tab",
      "tab-1",
      "--max",
      "3",
    ]);
    // stdout stays the content alone, so it can be piped.
    expect(clipped.stdout).toBe("The\n");
    expect(clipped.stderr).toContain("truncated");
  });

  it("targets a tab explicitly with --tab", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["url", "--tab", "tab-2"]);

    expect(result.stdout.trim()).toBe("https://other.test/");
  });

  it("answers a dialog and exits non-zero when there was none", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPendingDialog(true);

    const answered = await host.harness.runCli(["dialog", "dismiss"]);
    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain("dismissed");

    const none = await host.harness.runCli(["dialog", "accept"]);
    expect(none.exitCode).toBe(1);
    expect(none.stdout).toContain("No dialog was waiting");

    const bad = await host.harness.runCli(["dialog", "maybe"]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain("accept|dismiss");
  });

  it("reports the bridge's own state without touching a page", async () => {
    const host = createHost();

    const connected = await host.harness.runCli(["status"]);
    expect(connected.exitCode).toBe(0);
    expect(connected.stdout).toContain("Connected");

    host.harness.behavior.browser.setConnected(false);
    const offline = await host.harness.runCli(["status"]);
    // Non-zero so a script can gate on it.
    expect(offline.exitCode).toBe(1);
    expect(offline.stdout).toContain("No browser window is connected");
  });

  it("explains a failure the same way the agent tools do", async () => {
    const host = createHost();

    const cold = await host.harness.runCli(["text", "--tab", "tab-2"]);
    expect(cold.exitCode).toBe(1);
    expect(cold.stderr).toContain("Activate it");

    host.harness.behavior.browser.setConnected(false);
    const offline = await host.harness.runCli(["tabs"]);
    expect(offline.exitCode).toBe(1);
    expect(offline.stderr).toContain("open the BB desktop app");
  });

  it("rejects unknown commands and options rather than doing something else", async () => {
    const host = createHost();

    const unknownCommand = await host.harness.runCli(["eval"]);
    expect(unknownCommand.exitCode).toBe(2);
    expect(unknownCommand.stderr).toContain('Unknown command "eval"');

    const unknownOption = await host.harness.runCli(["tabs", "--all"]);
    expect(unknownOption.exitCode).toBe(2);
    expect(unknownOption.stderr).toContain("unknown option --all");

    const missingValue = await host.harness.runCli(["text", "--max"]);
    expect(missingValue.exitCode).toBe(2);
    expect(missingValue.stderr).toContain("positive integer");

    const missingUrl = await host.harness.runCli(["open"]);
    expect(missingUrl.exitCode).toBe(2);
    expect(missingUrl.stderr).toContain("URL is required");
  });
});

describe("bb browser CLI interaction", () => {
  function interactionHost() {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      snapshot: '- button "Save" [ref=e1]\n- textbox "Name" [ref=e2]',
    });
    return host;
  }

  it("lists the acting commands in help", async () => {
    const host = interactionHost();

    const result = await host.harness.runCli(["help"]);

    expect(result.exitCode).toBe(0);
    for (const command of ["click", "fill", "press", "select", "upload"]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("builds each action from its positionals", async () => {
    const host = interactionHost();

    await host.harness.runCli(["click", "e1", "--tab", "tab-1"]);
    await host.harness.runCli(["hover", "e1", "--tab", "tab-1"]);
    await host.harness.runCli(["fill", "e2", "Ada", "Lovelace", "--tab", "tab-1"]);
    await host.harness.runCli(["press", "Enter", "e2", "--tab", "tab-1"]);
    await host.harness.runCli(["uncheck", "e1", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.act")
        .map((call) => call.args.action),
    ).toEqual([
      {
        action: "click",
        ref: "e1",
        button: "left",
        clickCount: 1,
        modifiers: [],
      },
      { action: "hover", ref: "e1" },
      // Everything after the ref is the text, so unquoted words still work.
      { action: "fill", ref: "e2", text: "Ada Lovelace" },
      { action: "press", key: "Enter", ref: "e2" },
      { action: "check", ref: "e1", checked: false },
    ]);
  });

  it("carries the click options through", async () => {
    const host = interactionHost();

    await host.harness.runCli([
      "click",
      "e1",
      "--tab",
      "tab-1",
      "--double",
      "--button",
      "right",
      "--modifier",
      "Shift",
      "--modifier",
      "Meta",
      "--generation",
      "2",
    ]);

    const call = host.harness.inspection.browserCalls.at(-1);
    expect(call?.args.generation).toBe(2);
    expect(call?.args.action).toEqual({
      action: "click",
      ref: "e1",
      button: "right",
      clickCount: 2,
      modifiers: ["Shift", "Meta"],
    });
  });

  it("takes the rest of the line as values or paths", async () => {
    const host = interactionHost();

    await host.harness.runCli(["select", "e1", "Red", "Blue", "--tab", "tab-1"]);
    await host.harness.runCli(["upload", "e1", "/tmp/a.png", "--tab", "tab-1"]);
    await host.harness.runCli(["drag", "e1", "e2", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.act")
        .map((call) => call.args.action),
    ).toEqual([
      { action: "select", ref: "e1", values: ["Red", "Blue"] },
      { action: "upload", ref: "e1", paths: ["/tmp/a.png"] },
      { action: "drag", ref: "e1", targetRef: "e2" },
    ]);
  });

  it("resizes, and resets with a word rather than two zeroes", async () => {
    const host = interactionHost();

    await host.harness.runCli(["resize", "1280", "720", "--tab", "tab-1"]);
    await host.harness.runCli(["resize", "reset", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.act")
        .map((call) => call.args.action),
    ).toEqual([
      { action: "resize", width: 1280, height: 720 },
      { action: "resize", width: 0, height: 0 },
    ]);
  });

  it("prints the snapshot generation where it will not pollute a pipe", async () => {
    const host = interactionHost();

    const result = await host.harness.runCli(["snapshot", "--tab", "tab-1"]);

    // stdout stays the tree alone; the number the acting commands want back
    // goes to stderr.
    expect(result.stdout).not.toContain("generation");
    expect(result.stderr).toContain("generation");
  });

  it("refuses an incomplete command instead of acting on a default", async () => {
    const host = interactionHost();

    for (const argv of [
      ["click"],
      ["drag", "e1"],
      ["select", "e1"],
      ["upload", "e1"],
      ["press"],
      ["resize", "wide"],
    ]) {
      const result = await host.harness.runCli(argv);
      expect(result.exitCode, argv.join(" ")).toBe(2);
    }
    expect(
      host.harness.inspection.browserCalls.filter(
        (call) => call.type === "page.act",
      ),
    ).toEqual([]);
  });

  it("rejects an option value it does not recognize", async () => {
    const host = interactionHost();

    const badButton = await host.harness.runCli(["click", "e1", "--button", "up"]);
    expect(badButton.exitCode).toBe(2);
    expect(badButton.stderr).toContain("left, middle or right");

    const badModifier = await host.harness.runCli([
      "click",
      "e1",
      "--modifier",
      "Hyper",
    ]);
    expect(badModifier.exitCode).toBe(2);

    const badGeneration = await host.harness.runCli([
      "click",
      "e1",
      "--generation",
      "-1",
    ]);
    expect(badGeneration.exitCode).toBe(2);
  });

  it("explains a stale ref the same way the tools do", async () => {
    const host = interactionHost();
    host.harness.behavior.browser.failNextCall("stale_refs");

    const result = await host.harness.runCli(["click", "e1", "--tab", "tab-1"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("fresh snapshot");
  });
});
