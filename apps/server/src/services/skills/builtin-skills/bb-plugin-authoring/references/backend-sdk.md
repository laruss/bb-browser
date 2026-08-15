# bb.sdk — driving bb itself from a plugin

Threads, projects, environments, hosts, files, terminals, providers, skills.
Read this when the plugin has to read or change bb's own state. The area map
lists method names only — `types/bb-plugin-sdk.d.ts` has the exact signatures.

## bb.sdk

The full bb SDK bound to this server over loopback — threads, projects,
providers, etc. **Bind-gated**: reading `bb.sdk` before the host binds it
throws. The real server binds it before loading plugins, so it is available
from the moment factories run there — but isolated harnesses may not, so
prefer using it from handlers, services, timers, and event handlers for
portability.

`bb.sdk.projects.list()` preserves the ordinary-project-only default. Plugins
that need the singleton personal project use
`bb.sdk.projects.list({ includePersonal: true })`.

**Area map.** Every area below is reachable from `bb.sdk`. This lists the
methods, not their arguments — read `types/bb-plugin-sdk.d.ts` for exact
signatures.

| Area             | Methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threads`        | `list` `get` `search` `spawn` `fork` `send` `update` `delete` `stop` `compact` `wait` `open` `output` `timeline` `conversationOutline` `promptHistory` `archive` `archiveAll` `unarchive` `pin` `unpin` `reorderPinned` `markRead` `markUnread` `childSummary` `paneAction` `timelineTurnSummaryDetails` `storageFiles` `storagePaths` `cancelPlan` `clearGoal` `continueAfterRateLimit` `rateLimitRecovery` `defaultExecutionOptions`; sub-areas `events` (`list` `wait`), `interactions` (`get` `list` `cancel` `resolve` `respond`), `queuedMessages` (`create` `list` `update` `delete` `send` `reorder` `setGroupBoundary`), `tabs` (`get` `update`) |
| `threadSections` | `list` `create` `update` `delete`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `projects`       | `list` `get` `create` `update` `delete` `reorder` `paths` `files` `fileContent` `branches` `commands` `defaultExecutionOptions` `promptHistory`; sub-areas `attachments` (`upload` `read` `copy`), `sources` (`add` `update` `delete`)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `environments`   | `get` `update` `status` `paths` `commit` `archiveThreads` `diff` `diffFile` `diffFiles` `diffBranches` `diffPatch` `pullRequest` `markPullRequestDraft` `markPullRequestReady` `mergePullRequest` `squashMerge`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `hosts`          | `list` `get` `update` `delete` `directory` `pathsExist` `pickFolder` `cloneDefaultPath` `createJoinCode` `retryUpdate` `providerCliStatus` `installProviderCli`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `files`          | `read` `write` `list` `listPaths` `mkdir` `move` `remove` `createPreview`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `terminals`      | `list` `create` `get` `input` `output` `resize` `rename` `restart` `close`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `providers`      | `list` `models`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `skills`         | `list` `listFiles` `getContent` `update` `remove`; sub-area `registry` (`search` `get` `detail` `install` `repositoryStars`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `plugins`        | `list` `install` `remove` `enable` `disable` `reload` `token` `callRpc` `getSource` `getSettings` `updateSettings` `checkUpdates` `listUpdateResults` `applyUpdate`; sub-area `catalog` (`search` `status` `install`)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `theme`          | `get` `catalog` `set`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `status`         | `get`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `system`         | `version` `config` `reloadConfig` `attention` `usageLimits` `executionOptions` `transcribeVoice` `updateGeneralSettings` `updateKeyboardSettings` `updateExperiments` `cliSkillsStatus` `installCliSkills` `onboardingAgents` `onboardingRepos` `onboardingEvent`                                                                                                                                                                                                                                                                                                                                                                                         |
| `guide`          | `render` (the `bb guide` text; local, no request)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Prefer your own `bb.settings` and `bb.storage` over `sdk.system` and
`sdk.plugins` for your plugin's own configuration. The `system` and `plugins`
areas write app-wide state that the user owns.

```ts
const thread = await bb.sdk.threads.spawn({
  projectId,
  environment: { type: "project-default" }, // server resolves the project's default environment
  prompt: "Work on this issue…", // prompt XOR input — exactly one
  title: "ENG-42: fix the flaky test",
  visibility: "hidden", // optional background worker; visible is the default
});
```

`threads.spawn` takes `prompt` (a string) or `input` (structured prompt
inputs) — never both. Attribution is auto-filled: `origin: "plugin"` and
`originPluginId: <your id>` unless you set them. `bb.sdk.threads.send({
threadId, mode: "auto", input: [...] })` starts a turn on an idle thread or
queues/steers a running one.

Read and edit existing threads with the same area — you do not need a
sidebar panel or a spawned thread to reach them:

```ts
const { threads } = await bb.sdk.threads.list({ projectId, limit: 50 });
const thread = await bb.sdk.threads.get({ threadId });
const timeline = await bb.sdk.threads.timeline({ threadId });
await bb.sdk.threads.update({ threadId, title: "Fix the flaky test" });
```

`threads.list` filters on `projectId`, `parentThreadId`, `sourceThreadId`,
`sectionId`, `originKind`, `originPluginId`, `archived`, `unsectioned`,
`hasParent`, and `includeHidden`, and it pages with `limit` and `offset`.
`threads.update` writes `title`, `sectionId`, `parentThreadId`, `model`,
`reasoningLevel`, and `visibility`. Use `threads.timeline` (or
`threads.output` for the last assistant text) to read a thread's messages.

Use `visibility: "hidden"` for background workers. Hidden threads stay
out of sidebar organization and do not contribute unread/pending favicon
attention. They otherwise retain ordinary
list, search, prompt-history, section, lifecycle, parent-operation, direct-open,
and direct-ID behavior. A thread you spawn with a `parentThreadId` inherits the
parent's visibility when you omit `visibility`, and a hidden child still
reports its turns and blockers to its parent. This is an organization contract, not a security
boundary: plugins are full-trust server code.

SDK realtime observation stays separate from plugin lifecycle events:
`bb.sdk.subscribe({ event, callback, ...selector })` returns an unsubscribe
function. Do not use `bb.events.on` for SDK entity-change subscriptions.

`bb.sdk.terminals` is the canonical terminal area. `list` and `create` take an
explicit discriminated `scope`: `{ kind: "thread", threadId }`,
`{ kind: "environment", environmentId }`, or
`{ kind: "host_path", hostId, cwd }`. The host is always explicit; there is no
primary-host default. Existing-session operations are terminal-ID-only:
`get`, `input`, `resize`, `output`, `rename`, `restart`, and `close`.
`restart` closes the old session and creates a shell with the same scope, size,
and title; it returns a new terminal ID and does not replay the original command.

`bb.sdk.files` reads and writes files on a connected host (not just the
server machine — this is the right primitive when the user's files may live
on another host, and its `rootPath` confinement + compare-and-swap guard make
it the right save path even locally):

```ts
const file = await bb.sdk.files.read({ path: "/home/me/notes/todo.md" });
// → { content, contentEncoding, sha256, sizeBytes, modifiedAtMs?, ... }

const saved = await bb.sdk.files.write({
  path: "/home/me/notes/todo.md",
  rootPath: "/home/me/notes", // optional: confine writes beneath this root
  content: "# Todo\n",
  expectedSha256: file.sha256, // CAS guard; omit for unconditional, null for create-only
  mode: 0o600, // optional POSIX mode for a newly created file; existing mode is preserved
});
if (saved.outcome === "conflict") {
  // File changed since the read (saved.currentSha256, null = deleted) —
  // re-read and merge instead of clobbering.
}
```

`hostId` is optional everywhere (defaults to the primary/local host).
`bb.sdk.files.list({ path, query?, limit? })` is a recursive fuzzy file
listing under a directory. Writes cap at 25 MB and return
`{ outcome: "written", sha256, sizeBytes }`.

Project prompt attachments use a separate server-managed byte surface. Upload
bytes available to the SDK caller with
`bb.sdk.projects.attachments.upload({ projectId, clientFile, filename?,
mimeType? })`; `clientFile` accepts `Uint8Array`, `ArrayBuffer`, `Blob`, or a
File-like value (bare bytes/Blob require `filename`). The SDK sends multipart
bytes and returns the stable uploaded-attachment DTO whose relative `path` can
be used in `localFile`/`localImage` prompt input. Read an existing attachment
with `bb.sdk.projects.attachments.read({ projectId, path })`. Image MIME types
cap at 10 MB and other files at 25 MB. There is no attachment list or
per-attachment remove operation.

For filesystem-backed products that need a tree or mutations,
`bb.sdk.files.listPaths({ path, includeFiles, includeDirectories, ... })`
returns recursive relative paths with their kind. `mkdir`, `move`, and `remove`
apply the same optional `hostId` routing and `rootPath` confinement as
read/write. Mutations are not automatically retried; `move` refuses to replace
an existing destination, and `remove` requires `recursive: true` for non-empty
directories.

`bb.sdk.files.createPreview({ hostId?, rootPath, ttlMs? })` returns a temporary
path-shaped `baseUrl`. Append individually encoded relative path segments to
serve browser assets from that confined host root. This is the preferred
transport for plugin images and sandboxed HTML with sibling-relative assets;
preview URLs expire and never reveal the host id or absolute root.
