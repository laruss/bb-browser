---
name: bb-plugin-authoring
description: Write, build, and install bb plugins. Use whenever the task is to create a bb plugin, extend bb itself, or add a bb CLI command, agent tool, background service, settings, panel, mention provider, or other bb surface via a plugin. Covers the entire backend BbPluginApi and the frontend @bb/plugin-sdk/app contract with working patterns.
---

# Authoring bb plugins

A bb plugin is a TypeScript package running in-process inside the bb server.
Its backend entry default-exports a factory that receives the full plugin API
(`bb`); an optional frontend entry registers React UI inside the bb app.
Plugins are full-trust code: they can read all local bb data.

Plugins are on by default. Builtin plugins ship with bb; a few sit behind
their own product gates. `bb plugin list` shows each plugin's status.

This file is the map. Each surface has a reference file next to it — read the
one your task needs rather than all of them.

## Quickstart

```
bb plugin new hello            # scaffolds ./bb-plugin-hello (add --app for a frontend entry)
cd bb-plugin-hello
bb plugin install .            # registers the directory in place (--yes to skip the prompt)
bb plugin dev                  # watch loop: rebuild frontend (if any) + reload on every save
```

The manifest is `package.json`. The required shape:

```json
{
  "name": "bb-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.4.1" },
  "bb": {
    "name": "Hello",
    "description": "A friendly example plugin.",
    "branding": { "icon": "Zap" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "permissions": []
  }
}
```

`bb.permissions` is what the plugin may reach through `bb.browser` and
`bb.sdk`, and **undeclared means denied**: a scaffold reaches nothing gated
until you add entries. Everything else — settings, storage, http, rpc,
realtime, background, cli, agents, ui, events — is ungated, because it reaches
the plugin's own resources. The full table is in
[references/manifest.md](references/manifest.md); read it the moment a call
throws about a permission.

The plugin id is the final package-name component minus the `bb-plugin-`
prefix (`hello`); it namespaces routes, storage, settings, and CLI commands.
On-disk state per plugin: `<dataDir>/plugins/<id>/data.db` (its SQLite),
`secrets/` (secret settings + HTTP token), `logs/plugin.log` (JSONL, rotated
at 5MB). Settings edits never auto-reload — `bb plugin reload <id>` after
configuring.

Every other manifest field — branding and logos, `skills`, `themes`, engine
ranges, dependency rules, build artifacts, update and install behavior — is in
[references/manifest.md](references/manifest.md). Read it before publishing,
adding a dependency, or debugging an install.

## Looking up the exact API

This skill is a guide, not the contract. For an exact signature or a symbol it
does not cover:

1. **`bb plugin types`**, run in the plugin directory (or given its path),
   rewrites that plugin's `types/*.d.ts` from the running bb — no server
   needed. The scaffold seeds them once, so a cloned or older plugin can be
   thousands of lines behind. `--check` reports staleness without writing;
   `bb plugin build` and `bb plugin dev` refresh them too.
2. **Read `types/bb-plugin-sdk.d.ts`** (`-app.d.ts` for frontend symbols) —
   the authoritative surface, ~13,000 lines of readable declarations with doc
   comments, and what the scaffold `tsconfig.json` maps `@bb/plugin-sdk` to.
3. **`git clone --depth 1 https://github.com/get-bb/bb`** for host behavior or
   a reference implementation: `packages/plugin-sdk/src/`,
   `apps/server/src/services/plugins/`, `plugins/`.

Never answer an API question from a built bundle — `dist/*.js` and the bb app's
own JavaScript are minified. If you are grepping minified JavaScript, go back
to step 1.

## The backend factory

```ts
import type { BbPluginApi } from "@bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  // Register surfaces here. Load-safe: settings, storage, http, rpc,
  // realtime, background, cli, agents, ui, events, status, onDispose.
  // bb.sdk works here in the real server, but prefer it in handlers/services
  // (bind-gated — see references/backend-sdk.md).
}
```

The factory runs at load/reload/enable (time-boxed 30s). A throwing initial
factory puts the plugin in `error` status with the message as the detail; a
throwing reload candidate leaves the prior registration set running and
reports the reload failure in its detail. `bb.pluginId` is the plugin's own id.

Keyed registrations must be unique within one factory execution: duplicate
settings, routes, rpc methods, services, schedules, CLI registrations, tools,
instruction providers or mention providers are rejected.
Listeners are different: `bb.events.on`, settings `onChange`, and `onDispose`
are additive, so registering multiple listeners is supported.

Backend API imports normally stay type-only; the root runtime exports are
`defineRpcContract`, supplied by BB for shared schema contracts, and the
numeric `PLUGIN_CLI_OUTPUT_MAX_BYTES` ceiling:
`import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk"`.
Validator imports such as Zod are normal plugin runtime dependencies (and are
bundled by `bb plugin build`).

## Which reference to read

| Read                                                             | When the task involves                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [references/manifest.md](references/manifest.md)                 | `package.json`, `bb.permissions`, branding/logos, engines, dependencies, `bb plugin build` artifacts, install/update/distribution                                                                       |
| [references/backend-core.md](references/backend-core.md)         | `bb.log`, `bb.settings`, `bb.storage` (kv + SQLite + migrations), `bb.server`, `bb.events.on` thread lifecycle, `bb.status`, `bb.onDispose` and the reload lifecycle                                    |
| [references/backend-sdk.md](references/backend-sdk.md)           | `bb.sdk` — reading or changing bb's own threads, projects, environments, hosts, files, terminals, providers, skills                                                                                     |
| [references/backend-surfaces.md](references/backend-surfaces.md) | `bb.http`, `bb.rpc`, `bb.realtime`, `bb.background` services/schedules, `bb.cli` commands, `bb.ui.requestInput`, `bb.agents` tools and session configuration, `bb.ui` mention providers and keybindings |
| [references/browser.md](references/browser.md)                   | `bb.browser` — omnibox, context menu, find bar, HTTP auth, PDF text, downloads, and driving tabs/pages                                                                                                  |
| [references/frontend-slots.md](references/frontend-slots.md)     | the `bb.app` entry, every `app.slots.*` registration and its props, content scripts, crash isolation                                                                                                    |
| [references/frontend-runtime.md](references/frontend-runtime.md) | `ThreadChat` and other host components, hooks (`useRpc`, `useComposer`, …), composer customizations, the vendored shadcn UI kit, styling                                                                |
| [references/testing.md](references/testing.md)                   | `@bb/plugin-sdk/testing` unit tests, the live `bb plugin dev` loop, and which shipped plugin to copy                                                                                                    |

## Gotchas

- `bb.sdk` is bind-gated: the real server binds it before plugins load, so
  factories can use it there, but isolated harnesses may not — prefer
  handlers, services, and timers.
- Undeclared permissions are denied, and the two halves fail differently: a
  browser contribution you did not declare throws inside the factory, so the
  plugin loads in `error`; a `bb.sdk` area or browser command throws where it
  is called. The fake host enforces the same list when you pass
  `pluginPermissionsFromManifest(import.meta.url)`, which is how a test stays
  honest about what ships.
- kv values cap at 256KB; put caches and datasets in `storage.database()`.
- `storage.migrate` is append-only by statement index.
- Settings saves do not reload healthy or degraded plugins; live `onChange`
  listeners receive those updates. A save automatically retries load when the
  plugin is `needs-configuration`; `bb plugin reload <id>` remains available
  for other recovery cases.
- Descriptors without `default` produce `| undefined` values.
- Thread events are observe-only; there are exactly six
  (`thread.created`, `thread.active`, `thread.idle`, `thread.failed`,
  `thread.archived`, `thread.deleted`).
- Service throw of NeedsConfigurationError changes plugin status; schedule
  throws only set the schedule's last_error. Name-matching means no import
  is needed for the error class.
- Schedules only fire while the plugin is loaded (rows are durable, the
  runner is not).
- CLI `run(argv)` argv excludes the command name; core bb command names
  are reserved; workspace-sandboxed agent threads (Accept Edits / Approve
  for me) may fail to reach the bb CLI when the provider sandbox blocks
  loopback network (Claude's macOS sandbox permits it; Linux and other
  providers may not).
- A CLI `run` executes on the SERVER, so a path argument names a file on the
  invoking machine — resolve the invoking host and use `bb.sdk.files`, never
  `node:fs`, for user-supplied paths.
- Mention `search` is 2s-time-boxed; mention `resolve` runs at send time
  and a throw blocks the send.
- Agent tool and instruction changes apply on the next session start, not
  mid-session; cross-plugin tool-name collisions drop the later registration.
- RPC results must be strict JSON values and pass their output schema;
  realtime payloads must survive JSON.stringify.
- Handler stats shown by `bb plugin list` persist across reloads (reset on
  remove).
- Browser page text is untrusted content, and `bb.browser.storage` is
  credential access rather than settings — never log or persist it.
- The frontend Tailwind pass emits default-theme utilities only — style
  with host token classes, no custom `@theme` colors, no hand-set oklch.
- `onDispose` hooks run LIFO; stale `bb` handles from before a reload throw
  on use.
- Backend API imports normally remain type-only. The root runtime exports
  `defineRpcContract` plus `PLUGIN_CLI_OUTPUT_MAX_BYTES`; validator imports are
  plugin dependencies. The
  scaffold tsconfig typechecks both `server.ts` and `app.tsx`.
- `types/*.d.ts` is a per-plugin copy, not a live view of the SDK: run
  `bb plugin types` before trusting it, and never fall back to a minified
  `dist/` bundle — see "Looking up the exact API".
