# bb-plugin-omnibox-agent

The `browser.omnibox.providers` example — no frontend entry, no dependencies.
Type in the browser surface's omnibox and this plugin adds rows to the same
ranked list the browser fills with address, search, open-tab and history rows.

What it demonstrates:

- **`bb.browser.registerOmniboxProvider`** with both action kinds:
  - `{ type: "navigate", url }` — "Search GitHub for …", resolved by the browser
    without calling back into the plugin.
  - `{ type: "run" }` — "Ask an agent: …", which calls the plugin's `run(itemId,
{ query })` when picked.
- **`bb.sdk.threads.spawn`** — the `run` handler spawns a BB thread with the
  omnibox query as its prompt. BB fills in `origin: "plugin"` and
  `originPluginId: "omnibox-agent"`, so the thread is attributed in the thread
  list.
- **`bb.server.loopbackBaseUrl`** — `run` returns
  `{ navigate: "<server>/threads/<id>" }`, so the browser opens the new thread in
  the tab the omnibox was used from: the plugin points the browser at the BB app
  it is itself running inside.
- **`bb.status.needsConfiguration`** — the agent row needs a project, so it is
  offered only once one is set. The GitHub row works unconfigured, which is why
  the plugin is useful before anyone opens its settings.

## Try it

```bash
bb plugin install ./examples/plugins/omnibox-agent
bb plugin config omnibox-agent set project <project-id>
bb plugin reload omnibox-agent
```

Then open the browser surface (`/browser`, or the Browser button in the sidebar
footer) and type. Change `suggest` or `run`, run `bb plugin reload
omnibox-agent`, and the omnibox changes — no browser-core edit involved. That
round trip is the point of the example.

## Ranking

Scores are advisory and clamped to [0, 1] by the host. Score 1 belongs to the
browser's own default action — what Enter does with nothing selected — and plugin
providers are ranked after the built-in ones at equal scores, so a plugin can
never take the top row away from what the user typed. This plugin asks for 0.8
(agent row) and 0.55 (site search), landing under the default row and around the
browser's own open-tab and history rows.

## Tests

`server.test.ts` runs against `@bb/plugin-sdk/testing` — no bb server, no
browser. The end-to-end path (install → contributions → suggest → run → spawned
thread) is covered by `hero plugin: omnibox-agent` in
`apps/server/test/services/plugins/heroes.test.ts`.
