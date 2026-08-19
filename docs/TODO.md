# TODO

Work that is **deliberately not done**, with the reason, so nobody has to
re-derive it — and so nothing here reads as an oversight. Anything that is simply
next lives in [PROJECT_PLAN.md](PROJECT_PLAN.md); anything that will never be
done lives in its §19 Non-Goals.

## The test that sorts this list

**Can a plugin close this gap today?**

- **Yes** → it is an example plugin, not core work. Building it in the core spends
  the demonstration the MVP exists to make ("the browser can be extended through
  coding-agent-generated plugins").
- **No, for a structural reason** → the core does it, in the plugin-shaped way
  where the structure allows.

That test is what deferred bookmarks and what reshaped the search engine into a
declared plugin point rather than a setting — see
[architecture/browser-gaps.md](architecture/browser-gaps.md) for both arguments in
full.

## A plugin could own these — and now nothing is in the way

Each of these is a whole feature a plugin can store, act on and search
(`bb.storage.database`, tab and page menu entries, an omnibox provider, a
site-info section, its own panel). What they used to be missing was a place in bb's
chrome; as of 2026-08-19 they have all three:

- a **star in the address bar** — `bb.browser.registerToolbarItem`, with the
  per-page state a star needs;
- a section on the **new-tab screen** — `bb.browser.registerNewTabWidget`;
- **a chord of their own** — `bb.ui.registerCommand`.

See [architecture/browser-surface.md](architecture/browser-surface.md) for all
three.

- ~~**Bookmarks.**~~ **Done as an example**, which is where the sorting test put
  it: `examples/plugins/bookmarks` — the star, the new-tab list, `Cmd+D`, an
  omnibox provider and its own SQLite, with no core change.
- **Read-later, per-site notes, link collections.** Nothing is in the way; each is
  the bookmarks example with a different table. They stay unbuilt because one
  worked example makes the point and three would be three copies of it.

**Nothing here is waiting on core work any more.** What is left in this file is
either a screen bb has not drawn (below) or a decision nobody has needed yet.

## Core-only, cheap

- **A history page** — per-day view, search UI, bulk delete. The API and the store
  are done ([architecture/browser-history.md](architecture/browser-history.md));
  this is a screen.
- **Download progress**, and a download list that survives a restart
  ([architecture/browser-downloads.md](architecture/browser-downloads.md)).
- **Clear browsing data** — history has a delete API, cookies have one through
  `page.storage`; there is no UI that spends them.
- **"Close others" / "Close to the right"** on the tab menu.
- **Spellcheck suggestions** in the page's context menu (underlining already
  works — it is Chromium's).

## Core-only, structural

- **An audio indicator** — "this tab is making noise" is Chromium's observation,
  and the shell would have to report it. Muting is done; the indicator is not
  ([architecture/browser-surface.md](architecture/browser-surface.md)).
- **A per-origin favicon store.** Icons are keyed by _tab id_ and session-scoped,
  so no list of _addresses_ — history, bookmarks, the omnibox — can show one.
- **Frecency ranking.** `visit_count` is stored and unused; the omnibox ranks by
  match and recency only.
- **Dragging a tab between windows.** Reordering within a strip is done; moving a
  tab across windows means moving its `WebContentsView` between hosts.
- **Session restore fidelity.** A restart brings back URLs; scroll position and
  form state come back only for a tab reopened within the session (the shell holds
  Chromium's `pageState` in memory).
- **Per-site permission toggles and a cookie count** in the site panel. bb's
  permission policy is fixed in the shell, so there is nothing per-site to toggle
  yet.
- **Incognito and profiles.** One fixed `persist:bb-browser` partition.
- **Picture-in-picture and media keys**; **DRM will not play** at all (no Widevine
  in Electron).
- **One overlay owner per window.** Freezing the page for a panel is owned in two
  places today — the surface (tab menu, tab switcher) and the chrome (downloads,
  site panel) — so two panels open at once could thaw each other's page. Unlikely
  in practice because each closes the other, documented rather than fixed.
- **Streaming HTTP across the plugin boundary.** Deferred on purpose; a plugin's
  route buffers its response.

## Deliberately not for the browser at all

- **Agent tools** wrapping the browser commands added for plugins (`page.zoom`,
  `tabs.pin`/`mute`/`duplicate`/`move`). The plugin API is what asked for them; an
  agent that needs them can go through a plugin.
- Everything in [PROJECT_PLAN.md](PROJECT_PLAN.md) §19 — a Chrome replacement, a
  Chromium fork, sync, a password manager, every browser setting.
