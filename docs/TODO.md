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

## A plugin could own these — waiting on Phase 8 surfaces

Each of these is a whole feature a plugin can already store, act on and search
(`bb.storage.database`, tab and page menu entries, an omnibox provider, a
site-info section, its own panel). What none of them can do is put a control in
bb's chrome.

- **Bookmarks.** Blocked on three things: a **star in the address bar** (Phase 8
  _toolbar items_), a section on the **new-tab screen** (Phase 8 _new-tab
  widgets_), and a plugin owning a chord — `bb.ui.registerKeybinding` rebinds bb's
  _existing_ commands and refuses an unknown id (`appCommandIdSchema`). Design
  notes: [architecture/browser-gaps.md](architecture/browser-gaps.md).
- **Read-later, per-site notes, link collections.** The same three, for the same
  reason. Worth naming because they are why the surfaces are worth building once
  rather than a star being worth building for bookmarks.

**So the next core work is those surfaces**, not the features waiting on them.

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
