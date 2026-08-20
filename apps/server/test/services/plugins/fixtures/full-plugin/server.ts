/**
 * One registration of every kind that can cross a process boundary, so the
 * in-process handle and the remote one can be compared member for member.
 *
 * Including `bb.rpc.register` and `bb.agents.registerTool`, whose zod schemas
 * are the point: a validator is a function and never crosses, so the check has
 * to run where the handler is. Comparing the two placements on the *same* zod
 * schema is what says it does — and says it the same way, down to the issues.
 */
import { z } from "zod";

export default function plugin(bb: any): void {
  bb.rpc.register(
    {
      greet: {
        input: z.object({ who: z.string().min(2) }),
        output: z.object({ text: z.string() }),
      },
    },
    { greet: ({ who }: { who: string }) => ({ text: `hi ${who}` }) },
  );

  bb.agents.registerTool({
    name: "shout_tool",
    description: "Uppercases a word.",
    instructions: "Use it to shout.",
    // `.default()` on purpose: it proves the *parsed* value reaches execute,
    // rather than the raw arguments passing through untouched.
    parameters: z.object({ word: z.string(), loud: z.boolean().default(true) }),
    execute: ({ word, loud }: { word: string; loud: boolean }) =>
      loud ? word.toUpperCase() : word,
  });

  bb.http.route("GET", "/ping", () => Response.json({ pong: true }));

  bb.background.service("worker", {
    start: (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve());
      }),
  });

  bb.background.schedule("nightly", "0 3 * * *", () => {
    calls.push("schedule");
  });

  bb.cli.register({
    name: "full",
    summary: "A fixture command.",
    commands: [{ name: "go", summary: "Go.", usage: "full go" }],
    run: (argv: string[]) => ({
      exitCode: 0,
      stdout: argv.join(","),
      stderr: "",
    }),
  });

  bb.agents.configure(() => ({ tools: [], skills: [] }));
  bb.agents.contributeInstructions(
    (ctx: { threadId: string }) => `instructions for ${ctx.threadId}`,
  );

  bb.ui.registerMentionProvider({
    id: "people",
    label: "People",
    search: (ctx: { query: string }) => [
      { id: `p-${ctx.query}`, title: ctx.query.toUpperCase() },
    ],
    resolve: (itemId: string) => ({ context: `resolved ${itemId}` }),
  });

  bb.ui.registerKeybinding({
    command: "browser.newTab",
    shortcut: { key: "t", mod: true },
  });

  bb.browser.registerOmniboxProvider({
    id: "search",
    label: "Search",
    suggest: (ctx: { query: string }) => [
      { id: "s1", title: `find ${ctx.query}` },
    ],
    run: (itemId: string) => ({ kind: "navigate", url: `https://x/${itemId}` }),
  });

  bb.browser.registerContextMenuItem({
    id: "shout",
    title: "Shout",
    run: (ctx: { selectionText: string | null }) =>
      (ctx.selectionText ?? "").toUpperCase(),
  });

  bb.browser.registerFindAction({
    id: "look",
    title: "Look up",
    run: (ctx: { query: string }) => `looking for ${ctx.query}`,
  });

  bb.browser.registerTabAction({
    id: "file",
    title: "File this tab",
    run: (ctx: { url: string | null }) => `filing ${ctx.url ?? "a bb screen"}`,
  });

  bb.browser.registerSiteInfoProvider({
    id: "facts",
    label: "Facts",
    describe: (ctx: { host: string }) => [{ label: "Host", value: ctx.host }],
  });

  bb.browser.registerSearchEngine({
    id: "kagi",
    name: "Kagi",
    urlTemplate: "https://kagi.com/search?q=%s",
  });

  bb.browser.registerPageStyle({
    id: "declutter",
    matches: ["https://example.test/**"],
    css: ".ad { display: none !important }",
  });

  bb.browser.registerPageScript({
    id: "toolbar",
    matches: ["https://example.test/**"],
    code: "bb.ready(function () { document.title = 'seen'; });",
  });

  bb.browser.registerAuthProvider(() => null);
  bb.browser.registerAuthProvider((challenge: { host: string }) => ({
    username: "u",
    password: challenge.host,
  }));

  bb.browser.registerPdfTextProvider(() => null);
  bb.browser.registerPdfTextProvider(() => "page text");

  bb.browser.registerDownloadHandler(() => {
    calls.push("download");
  });

  bb.events.on("thread.created", () => {
    calls.push("thread.created");
  });

  const settings = bb.settings.define({
    token: { type: "string", label: "Token", default: "" },
  });
  settings.onChange(() => {
    calls.push("settings");
  });

  bb.onDispose(() => {
    calls.push("dispose");
  });
}

/** Observable from the in-process build; the remote one reports over the wire. */
export const calls: string[] = [];
