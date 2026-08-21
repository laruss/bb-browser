# Backend core: logging, settings, storage, host facts, events, lifecycle

The parts of `PatcherPluginApi` a plugin uses regardless of which surface it
contributes.

- [bb.log](#bblog)
- [bb.settings](#bbsettings)
- [bb.storage](#bbstorage)
- [bb.server](#bbserver)
- [bb.events.on](#bbeventson--thread-lifecycle-events)
- [bb.status](#bbstatus)
- [bb.onDispose and the reload lifecycle](#bbondispose-and-the-reload-lifecycle)

## bb.log

`bb.log.debug|info|warn|error(message: string)` — goes to the server log
(prefixed `[plugin:<id>]`) and to the per-plugin JSONL file behind
`bb plugin logs <id> [-n N] [-f]`.

## bb.settings

`bb.settings.define(descriptors)` declares plain-data descriptors (rendered
in Extensions → Plugins and editable via `bb plugin config <id> set <key>
<value>`). Four descriptor types:

```ts
const settings = bb.settings.define({
  apiKey: { type: "string", label: "API key", secret: true }, // 0600 file, never in db or frontend
  teamKey: { type: "string", label: "Team", default: "" },
  mode: {
    type: "select",
    label: "Mode",
    options: ["fast", "slow"],
    default: "fast",
  },
  verbose: { type: "boolean", label: "Verbose", default: false },
  project: { type: "project", label: "Project" }, // project picker, stores a proj_* id
});
const { apiKey, teamKey } = await settings.get(); // load-safe; re-read inside handlers for freshness
settings.onChange((next, prev) => {
  /* fires after a settings save */
});
```

Typing rule: a descriptor **with** `default` yields a non-optional value
from `get()`; without one the value is `string | boolean | undefined` — so
give non-secrets defaults and handle missing secrets explicitly.

## bb.storage

- `bb.storage.kv` — namespaced JSON key-value rows in bb.db:
  `get<T>(key)`, `set(key, value)`, `delete(key)`, `list(prefix?)`. Values
  are capped at **256KB each** — kv is for cursors, links, and small state;
  caches and datasets go in the plugin database.
- `bb.storage.database()` — the plugin's own better-sqlite3 database at
  `<dataDir>/plugins/<id>/data.db` (WAL, busy_timeout 5000). Handles are
  host-tracked and closed on reload; a closed handle throws.
- `bb.storage.migrate(db, statements)` — statement index = migration id;
  unapplied statements run in one transaction. **Append-only**: never
  reorder or edit shipped statements, only push new ones.

```ts
const db = bb.storage.database();
bb.storage.migrate(db, [
  `CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
]);
```

## bb.server

Read-only facts about the running server. `bb.server.loopbackBaseUrl` is the
server's own loopback base URL (e.g. `http://127.0.0.1:38886`), which serves
the SPA + `/api` + `/ws` — for plugins that proxy or relay traffic back to
the server itself. **Bind-gated** like `bb.sdk`: reading it before the server is
listening throws, so prefer reading it from handlers, services, and timers.

## bb.events.on — thread lifecycle events

```ts
bb.events.on("thread.created", ({ thread }) => { ... });
bb.events.on("thread.active", ({ thread }) => { ... });
bb.events.on("thread.idle", ({ thread, lastAssistantText }) => { ... });   // lastAssistantText: string | null
bb.events.on("thread.failed", ({ thread, error }) => { ... });             // error: string | null
bb.events.on("thread.archived", ({ thread }) => { ... });
bb.events.on("thread.deleted", ({ thread }) => { ... });
```

Exactly six events. `thread.active` fires when an applied lifecycle
transition enters the running `active` state. `thread.archived` fires after a
thread is archived, including cascade archives (archiving a parent archives
its children too, each with its own event). Observe-only handlers run
fire-and-forget after the transition and can never block or veto it. `thread`
is the same DTO `GET /api/v1/threads/:id` serves. Errors are caught, logged,
and counted in the plugin's handler stats (`bb plugin list`).

Lifecycle events are broadcast to all loaded plugins regardless of sidebar
visibility.

`thread.created` fires on row creation, so the first user message is not
always in the timeline yet. To react to a thread's content, listen on
`thread.active` or `thread.idle`, then read the messages with
`bb.sdk.threads.timeline`. Because handlers are fire-and-forget, work you do
in a handler — including `bb.sdk.threads.update({ threadId, title })` —
cannot delay or interrupt the thread's turn.

## bb.status

`bb.status.needsConfiguration(message)` — mark the plugin
`needs-configuration` (shown in `bb plugin list` and the UI) instead of
failing. Cleared on the next load.

## bb.onDispose and the reload lifecycle

`bb.onDispose(hook)` registers cleanup; hooks run **LIFO**. On
reload the host first runs the factory against a candidate registration set.
If it throws, the complete previous set stays live. Once the candidate
succeeds, the host aborts old background services and awaits them (bounded),
runs dispose hooks LIFO (each isolated), drains in-flight http/rpc/event
handlers, closes every `storage.database()` handle, invalidates the old `bb`
handle, and replaces the registration set wholesale. Disable/shutdown perform
the same cleanup without a replacement. A
captured `bb` from a previous load throws `PluginContextStaleError` on use
— never stash the API object in module-level state that outlives a load.
