# Backend surfaces: http, rpc, realtime, background, cli, agents, host UI

What a plugin registers in its factory to become reachable — from the bb
frontend, from an agent, from the CLI, from a timer, or from the outside world.

- [bb.http — HTTP routes](#bbhttp--http-routes)
- [bb.rpc — the frontend data plane](#bbrpc--the-frontend-data-plane)
- [bb.realtime](#bbrealtime)
- [bb.background — services and schedules](#bbbackground--services-and-schedules)
- [bb.cli — an agent-facing `bb` subcommand](#bbcli--an-agent-facing-bb-subcommand)
- [bb.ui.requestInput](#bbuirequestinput--replace-the-composer-with-a-blocking-plugin-form)
- [bb.agents — native tools and session configuration](#bbagents--native-tools-and-conditional-session-configuration)
- [bb.ui — host-rendered UI](#bbui--host-rendered-ui-no-frontend-bundle-needed)
- [bb.ui — rebinding keyboard shortcuts](#bbui--rebinding-keyboard-shortcuts)
- [bb.ui — a command of your own](#bbui--a-command-of-your-own)

## bb.http — HTTP routes

`bb.http.route(method, path, handler, { auth? })` mounts an exact-match
route (no params/wildcards) at `/api/v1/plugins/<id>/http/<path>`. The
handler is a Hono handler: `(context) => Response | Promise<Response>`.
Auth modes:

- `"local"` (default) — request must come from a local bb app origin.
  Right for anything the bb frontend calls.
- `"token"` — requires the per-plugin token (`bb plugin token <id>`;
  `--rotate` generates a new one, invalidating the old) via the
  `x-bb-plugin-token` header or `?token=`. Right for external scripts
  and machines you control.
- `"none"` — no checks. ONLY for webhooks that verify their own signature
  (e.g. Slack's `x-slack-signature` HMAC) inside the handler.

## bb.rpc — the frontend data plane

Define method names plus runtime input/output schemas once, then register
handlers against that contract. Schemas use validator-neutral Standard Schema
v1, which Zod 4 implements directly. The host validates input before invoking
the handler and output before serialization; handler parameters and return
values are inferred from the schemas.

```ts
import { defineRpcContract, type BbPluginApi } from "@patcher/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  listIssues: {
    input: z.object({ filter: z.string().optional() }).strict(),
    output: z.object({ issues: z.array(z.object({ id: z.string() })) }),
  },
  status: {
    input: z.null(), // null input lets the frontend omit the argument
    output: z.object({ ready: z.boolean() }),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    listIssues({ filter }) {
      return { issues: listCachedIssues(filter) };
    },
    status() {
      return { ready: true };
    },
  });
}
```

In `app.tsx`, import only the backend contract's type. The backend module and
its dependencies are erased from the frontend bundle:

```tsx
import { useRpc } from "@patcher/plugin-sdk/app";
import type { rpcContract } from "./server";

function IssuesButton() {
  const rpc = useRpc<typeof rpcContract>();

  async function loadIssues() {
    const { issues } = await rpc.call("listIssues", { filter: "open" });
    return issues;
  }

  return <button onClick={() => void loadIssues()}>Load issues</button>;
}
```

The wire envelope is `{ ok: true, result }` or `{ ok: false, error }`.
Failures use stable codes: `invalid_json`, `invalid_input`, `handler_error`,
`invalid_output`, `non_json_result`, and `unknown_method`; validation failures
also carry normalized `{ message, path? }[]` issues. Unknown methods return
404, invalid JSON/input returns 400, and handler/output/serialization failures
return 500. Results must be strict JSON values: cyclic objects, bigint,
undefined/functions, class instances, symbol keys, and non-finite numbers are
rejected rather than coerced or silently dropped.

## bb.realtime

`bb.realtime.publish(channel, payload)` broadcasts an ephemeral
`plugin-signal` WS message to every connected client; the frontend hook
`useRealtime(channel, handler)` receives it. Payload must be
JSON-serializable; nothing is persisted. Publish state-changed signals and
let the frontend refetch via rpc.

## bb.background — services and schedules

```ts
bb.background.service("worker", {
  async start(signal) {
    while (!signal.aborted) {
      await doWork();
      await sleep(60_000, signal);
    }
  },
});
bb.background.schedule("sync", "*/5 * * * *", async () => {
  await syncNow();
});
```

- A **service** starts after the factory completes and must resolve when
  `signal` aborts (reload/disable/shutdown). A crash restarts it with
  capped exponential backoff.
- A **schedule** is a 5-field cron (server-local time) backed by a durable
  row keyed (pluginId, name) — it survives server restarts, and the sweep
  claims due rows with a compare-and-swap, but it only fires while the
  plugin is loaded.
- Semantics differ on throw: a service throwing `NeedsConfigurationError`
  transitions the whole plugin to `needs-configuration` and stops
  restarting until the next load; a schedule throw (any error) only lands
  in the schedule's `last_status`/`last_error` shown by `bb plugin list`.
- `NeedsConfigurationError` is matched **by name**, so no runtime import is
  needed: `throw Object.assign(new Error(msg), { name:
"NeedsConfigurationError" })`. Pair it with `bb.status.needsConfiguration`
  in the factory so an unconfigured plugin reports itself instead of
  crash-looping:

```ts
const initial = await settings.get();
if (!initial.apiKey)
  bb.status.needsConfiguration(
    "Set apiKey with `bb plugin config <id>`, then reload.",
  );
```

## bb.cli — an agent-facing `bb` subcommand

One top-level command per plugin; a second `register` in one factory
execution is rejected.
Users and agents run `bb <name> …` like any core command; the bb CLI
proxies it to the server, where `run` executes.

```ts
bb.cli.register({
  name: "weather", // lowercase [a-z0-9-]+; core names (thread, plugin, …) are reserved
  summary: "Weather lookups",
  commands: [
    // help/skill metadata only; parsing argv is yours
    {
      name: "today",
      summary: "Today's weather",
      usage: "bb weather today <city>",
    },
  ],
  async run(argv, ctx) {
    // argv EXCLUDES the command name: `bb weather today sf` → argv = ["today", "sf"]
    // ctx: { cwd?, threadId?, projectId? } — whatever the invoking CLI knew
    return { exitCode: 0, stdout: "sunny" }; // { exitCode, stdout?, stderr? }
  },
});
```

Agents discover plugin commands through the server-generated
`plugin-commands` skill, which lists each command's `summary` and the
`commands` usage lines — fill both in. Combined stdout and stderr must fit
`PLUGIN_CLI_OUTPUT_MAX_BYTES` from `@patcher/plugin-sdk` (1,048,576 UTF-8 bytes).
The host rejects a larger result atomically as `plugin_cli_output_too_large`;
it never clips it. Page growing collections, cap verbose fields, and use
file/streaming commands for large content. Caveat: under the workspace
sandbox (Accept Edits / Approve for me), Claude's macOS sandbox permits
loopback, so `bb` CLI calls (including plugin commands) work sandboxed;
Linux and other provider sandboxes may still block loopback, in which case
those calls need escalation approval.

**Multi-machine rule: `run` executes on the server, so a path argument names
a file on the INVOKING machine, not on `run`'s filesystem.** Never open a
`ctx.cwd`-relative or user-supplied path with `node:fs` — on an enrolled
remote machine that silently reads or writes the wrong host's disk. Instead
resolve the invoking host (`ctx.threadId` → `bb.sdk.threads.get` →
`environmentId` → `bb.sdk.environments.get(...).hostId`, with an explicit
`--machine`-style flag as the no-thread escape hatch; `undefined` targets the
server's own host) and do all such file I/O through `bb.sdk.files` with that
`hostId`. Reference implementations: the docs plugin's pull/push sync and the
tasks plugin's attachment commands. `node:fs` remains correct for genuinely
server-local data such as files under the plugin's own data directory.

## bb.ui.requestInput — replace the composer with a blocking plugin form

Use `bb.ui.requestInput({ threadId, rendererId, title, payload, timeoutMs? },
{ signal? })` when plugin backend code must wait for sensitive or structured
user input. The promise resolves to `{ outcome: "submitted", value }` or
`{ outcome: "cancelled", reason }`. Payloads and responses are JSON values
capped at 64 KiB; response values are delivered only to the waiting plugin
invocation and are never persisted. Pair `rendererId` with a frontend
`pendingInteraction` slot. Pass a CLI handler's `ctx.signal` so disconnecting
the caller cancels the request.

## bb.agents — native tools and conditional session configuration

To give agents standing knowledge (conventions, workflows), ship a
`skills/` directory. For schema'd capabilities, register a native tool.
For a short, per-resolution instruction block (e.g. "the user is viewing
bb remotely — share tunnel URLs"), use `contributeInstructions`:

```ts
import { z } from "zod"; // runtime import — declare zod as a plugin dependency
bb.agents.registerTool({
  name: "docs_search", // [a-zA-Z0-9_-]+, unique ACROSS plugins
  description: "Search the bundled docs.",
  instructions: "Prefer docs_search over guessing conventions.", // optional, appended to thread instructions
  // Optional experimental native timeline labels. Without these, BB shows
  // its normal tool name and arguments. Errors/interruptions keep that
  // standard rendering so the failing tool remains identifiable.
  experimental_statusLabels: {
    pending: "Searching bundled docs",
    completed: "Searched bundled docs",
  },
  parameters: z.object({ query: z.string().min(1) }),
  async execute({ query }, { threadId, projectId, signal }) {
    return excerpts.join("\n"); // or { content: [{ type: "text", text }], isError? }
  },
});

// All tools and manifest skills are static registrations. configure() only
// selects this plugin's own ids when BB resolves a thread/session config.
bb.agents.configure((context) => ({
  tools: context.provider.id === "codex" ? ["docs_search"] : [],
  skills: context.project.kind === "standard" ? ["repo-conventions"] : [],
  instructions: `Docs selection resolved for ${context.project.name}.`,
}));

// Dynamic section evaluated at thread.start / turn.submit (sync, fast).
// Return null to contribute nothing for that resolution. Duplicate factory
// registrations are rejected. Output is capped at 4096
// characters; a throw is logged and contributes nothing. Side-chat
// threads never receive plugin instructions.
bb.agents.contributeInstructions(({ threadId, projectId }) => {
  if (!shouldAdviseRemoteUrls()) return null;
  return "The user is viewing bb remotely — share tunnel URLs, not localhost.";
});
```

`parameters` is a zod schema (zod 4; validated per call — bad model args
become a tool error, not a plugin crash) or a plain JSON-schema object
(execute then receives raw `unknown`). Tool-set changes apply on the NEXT
session start, not mid-session. Name collisions: within one factory execution
duplicate registrations are rejected; across plugins the earlier plugin wins
and yours is dropped with the reason in your status detail.

`experimental_statusLabels` is optional and supplies static, concise labels
keyed by BB's timeline row status (`pending`, `completed`). Each label is
limited to 80 characters; a longer label rejects the registration. BB snapshots the
labels into each plugin tool-call event; it is not a frontend bundle hook. A
status with no label — error, interrupted, or awaiting approval — falls back
to BB's standard `Running tool …` / `Ran tool …` wording, as does omitting the
field entirely.

`contributeInstructions` is **synchronous** and runs on the thread-start
path — keep it cheap. Prefer `skills/` for standing knowledge; use this
only when the text must reflect live plugin state at resolution time.

Ordering is standard BB instructions, selected tools' static snippets,
`contributeInstructions` output, `configure` dynamic instructions, data-dir
user instructions, then workspace instructions. Tool snippets are rejected at
registration above 4096 characters; each legacy/dynamic callback contribution
is truncated to 4096 characters.

`configure` is also synchronous and may be registered only once per factory
execution. Its context has required, plain-data `thread`, `project`,
`environment`, `host`, and `provider: { id, model }` objects, plus `sideChat`
and `origin: { kind, pluginId }`; genuinely absent values are `null`, not
omitted. `tools` names and `skills` frontmatter names may select only this
plugin's static registrations. A `tools` entry may instead be
`{ name, parameters }` to override the parameter schema advertised to the
provider for that resolution only — `parameters` must be a JSON-serializable
JSON-schema object with root `type: "object"`, at most 128 KiB serialized, and
should only narrow what the registered schema accepts, since execution-side
validation still runs the registered parameters. Unknown or duplicate ids,
malformed output, an invalid override, more than 256 ids in either array, or a
throwing callback fail closed for that plugin only. Dynamic `instructions` are
truncated to 4096 characters.

Resolution happens for `thread.start` and `turn.submit`. A selected tool set
takes effect only when the provider session is next started/resumed; BB never
hot-mutates a running provider session. Instructions follow the same rule: a
live provider session keeps the instructions it was constructed with, and
changed instructions apply when the session is next constructed.
Skill catalog changes follow the daemon's established runtime policy: a busy
environment keeps its current staged catalog until a safe relaunch. Side chats
evaluate `configure` with `sideChat: true`; returned tool, skill, and dynamic
instruction selections apply at those same boundaries. Independent side-chat
safety policy such as permission escalation is unchanged. The legacy
`contributeInstructions` provider remains excluded from side chats, so use
`configure` for side-chat-aware dynamic instructions.

## bb.ui — host-rendered UI (no frontend bundle needed)

```ts
bb.ui.registerMentionProvider({
  id: "issue",
  label: "Issues",
  triggers: ["@", "#"], // optional; defaults to ["@"]. Valid: @ # $ ! ~
  search({ trigger, query, projectId, threadId }) {
    // 2s time box, failure = empty list
    return [{ id: "42", title: "ENG-42 Fix flake", subtitle: "Todo" }];
  },
  resolve(itemId) {
    // once per unique item AT SEND TIME
    return { context: "# ENG-42…" }; // attached as agent-only context; throwing BLOCKS the send
  },
});
```

Thread actions render in the thread header; mention items render under
`label` in the menu for each registered trigger. All handlers run server-side.
There is deliberately no plugin slash-command surface: the composer's `/`
menu lists skills, so a plugin capability that crafts a prompt for the agent
ships as a `skills/` entry instead.

## bb.ui — rebinding keyboard shortcuts

```ts
bb.ui.registerKeybinding({
  command: "browser.newTab", // must be a known app command id
  shortcut: { key: "y", mod: true, shift: true }, // mod = Cmd on macOS, Ctrl elsewhere
});
// null frees the chord, e.g. to leave it to the page
bb.ui.registerKeybinding({ command: "browser.reload", shortcut: null });
```

This changes what _this install's_ defaults are, so the user's own overrides in
settings still win, and the settings UI shows a plugin's binding as the default
rather than as something the user changed. Unknown command ids are a load-time
error — the whole registration is rejected, not half-applied. Between plugins
the lowest plugin id wins a contested command, so the result never depends on
load order.

## bb.ui — a command of your own

`registerKeybinding` rebinds a command **BB already has**. This adds one it has
never heard of, with the chord that runs it:

```ts
bb.ui.registerCommand({
  id: "save-page",
  title: "Save this page", // how the shortcut is listed in Settings → Keyboard
  shortcut: { key: "d", mod: true }, // required — see below
  async run() {
    // No context: ask for what you need, and pay for it where it is already gated.
    const url = await bb.browser.page.getUrl(); // costs `tabs.read`
    await bb.storage.kv.set(`saved:${url}`, { at: Date.now() });
  },
});
```

Four rules, each with a reason worth knowing:

- **The chord is required.** BB has no command palette, so a command without one
  could never be run; a registration with no `shortcut.key` fails at load rather
  than sitting there doing nothing.
- **`run` is handed nothing.** A chord that carried the current page would give
  every command the address of whatever the user is looking at. Read what you need
  instead — `bb.browser.page.getUrl()`, `bb.browser.tabs.list()` — and the
  permission that already governs seeing the user's page (`tabs.read`) is the one
  that applies. This is also why `registerCommand` itself costs no permission.
- **BB's own bindings win.** Your chord is matched only after every one of BB's has
  declined, the user's own rebindings included — but BB's bindings are _scoped_, so
  a chord BB uses outside the browser can still be yours inside it (`Mod+D` is
  `diff.toggle`, which excludes a focused browser; the bookmarks example takes it
  from there). Settings → Keyboard lists your command under "Plugin shortcuts" and
  names BB's command when it shares the chord. Between plugins, the lowest plugin id
  wins.
- **It never fires while the user is typing**, or while a dialog is open — the same
  scope BB's own shortcuts follow.

Two of your own commands on one chord is refused at load: that is a mistake you
can fix, unlike two plugins wanting the same chord.
