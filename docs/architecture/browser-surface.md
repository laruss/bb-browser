# Browser Surface

Milestone A of [`docs/PROJECT_PLAN.md`](../PROJECT_PLAN.md) §18 Phase 1: the
browser stops being a panel inside a thread and becomes a surface of its own.

## What was added, and what was deliberately reused

Phase 0 found that bb already contains a working embedded browser (see
[bb-migration.md](bb-migration.md)), so this milestone adds only what was
genuinely missing and reuses the rest unchanged:

| Piece                                                                        | Status                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Electron `WebContentsView` manager, session partition, popup policy          | reused, untouched                                                              |
| `packages/desktop-contract` browser IPC contract                             | reused, untouched                                                              |
| `BrowserTabContent` — bounds sync, resize snapshot, load errors, address bar | reused, untouched                                                              |
| `BrowserTabDeck` — mounts only the active tab's view                         | reused, untouched                                                              |
| Thread-independent tab ownership                                             | **new** (`apps/app/src/lib/browser-surface-tabs.ts`)                           |
| Tab strip                                                                    | **new** (`apps/app/src/components/browser-surface/BrowserSurfaceTabStrip.tsx`) |
| `/browser` route                                                             | **new** (`apps/app/src/views/BrowserSurfaceView.tsx`)                          |

Reusing `BrowserTabContent` matters more than it looks: its ~400 lines of effects
are the hard part — measuring the panel rect in CSS pixels, pushing it to the
main process on every layout move, standing in a bitmap while a native resize
burst hides the view. A second implementation of that would drift immediately.

## Tab ownership

The thread secondary panel keeps browser tabs in `secondaryPanelTabState.ts`
beside file previews, each carrying a `threadId` that pruning keys on. Surface
tabs carry no thread: they live in their own `atomWithStorage`, persist across
restarts, and survive thread navigation because nothing prunes them.

Reducers are pure and separate from the atom (`addBrowserSurfaceTab`,
`closeBrowserSurfaceTab`, `activateBrowserSurfaceTab`,
`updateBrowserSurfaceTab`), so tab behaviour is unit-testable without React —
including the two rules that are easy to get wrong: closing the focused tab hands
focus to the right-hand neighbour and falls back left, and a stored `activeTabId`
naming a tab that no longer exists is repointed on load rather than rendering an
empty surface behind a populated strip.

`updateBrowserSurfaceTab` returns the _same_ state object when nothing changed.
The native view pushes navigation state on every `webContents` event, so without
that the whole strip would re-render on each one.

### Popups are a subscription, and this surface shipped without one

`window.open` and `target="_blank"` never open a native popup: the shell denies
every one of them and pushes the request to the renderer instead
(`setWindowOpenHandler` → the open-tab channels). Nothing in the shell decides
where such a tab goes — **the mounted view does**, by subscribing. So the
subscription is not plumbing, it is the whole feature, and a route without one is
a link that silently does nothing. That is exactly what this surface shipped
with: `ThreadDetailView` and `RootComposeView` each subscribe for their own
panel, neither is mounted on `/browser`, and the surface subscribed nowhere.

It prefers `onScopedOpenTab`, which names the tab that asked, and opens the
popup only for a tab this surface owns — the thread panel's popups are that
panel's business. `onOpenTab` is the fallback for a shell predating attribution
(invariant 2's version skew, again), where a route path is filtered out because
it belongs to `RouteNavigationProvider`.

The popup opens in the foreground, which `addBrowserSurfaceTab` already does for
every tab. Two limits are the shell's policy rather than the surface's: the
popup URL must be public `http(s)` (`isAllowedPublicBrowserPopupUrl`, so
`about:blank` popups are dropped), and a page churning them hits the same rate
limiter the favicon path uses.

### …and a simulated popup is not a popup

Everything above describes a tab that _stands in_ for a popup, and the standing
in is where it fails. `window.open()` returned `null` — which is precisely how a
page detects a popup blocker — so an OAuth SDK reported "popup blocked" and
stopped, while a tab it never asked for sat open behind the message. The tab had
no `window.opener`, so the `postMessage` handshake a sign-in popup finishes with
could not run, and it could not close itself when the flow ended.

None of that is fixable inside the simulation: the opener link is made by
Chromium when it creates the window, and no tab created afterwards can be given
one. So popups are now **real** for tabs that claim them — `action: "allow"`
with `createWindow`, Chromium's own window, hosted here as a tab.

**Which tabs claim them is the renderer's call**, declared over
`setPopupTabs`. This surface claims its own, because it owns them and can host
a window. The thread panel claims nothing on purpose: there a link follows the
user's in-app-link preference and may leave for the system browser, where an
opener means nothing — so it keeps the deny-and-push behaviour above, unchanged.

Three consequences of the reversal are worth stating, because each is a rule
that now lives in the shell:

- **The shell names the tab.** Every other tab exists because the renderer asked
  for one; a popup exists the moment `window.open()` returns, before the app has
  heard of it. So the id travels shell → renderer (`browser-popup:N`), the
  surface adopts it, and `attach` on such a tab **places the view without
  loading into it** — loading would navigate the popup away from the flow it was
  opened for.
- **The shell reports the close.** `window.close()` is how every OAuth flow
  ends, and only the shell sees the `webContents` die. `destroyEntry` removes
  the entry before closing, so the `destroyed` handler can tell a page closing
  its own popup from the renderer closing a tab.
- **`about:blank` is allowed now**, and only on this path. A page that opens a
  blank window and writes into it is the shape half the OAuth SDKs use; the
  blank popup inherits the opener's origin, so what it can reach is what the
  opener could already reach. Everything else the popup policy refused it still
  refuses — `javascript:`, `file:`, loopback and private hosts — and the rate
  limiter applies to real popups exactly as it did to simulated ones.

The hardening survives because a popup **inherits its opener's web
preferences**, and `createWindow` receives them in the options Electron passes.
Passing those options through is also what adopts the `webContents` Chromium
already created — build a fresh one instead and the result looks identical and
has no opener, which is the bug this path exists to remove.

## The `threadId` prop is a scope key, not a thread

`BrowserTabDeck` and `BrowserTabContent` take `threadId`, and pass it to the
navigation-history atom family and the native-view identity record. Neither
parses it — any stable string scopes them. The surface therefore passes
`BROWSER_SURFACE_SCOPE_ID` rather than borrowing a thread's id, and
`environmentId` is null because a surface tab belongs to no workspace.

Renaming that prop to `scopeId` across the thread code paths is the honest
follow-up. It was left alone here so this milestone touches no working thread
behaviour; the type system will carry the rename whenever it happens.

## Layout, for now

The route renders inside `AppLayout`, so bb's sidebar is still present and the
surface is reachable from a footer button next to Settings. That is deliberate
for Milestone A — plan §14 says to reuse bb surfaces until replacement is
necessary. The dedicated browser window (its own Electron window, no agent-
workspace chrome) is a later step, and the plan's target layout — tabs on top,
page left, agent panel right — arrives with it.

### The shell draws no chrome around the surface

`/browser` is the one route with neither the shared page header nor `main`'s
`p-4 md:p-5` content padding (`isBrowserSurfaceView` in `AppLayout`). The header
would be empty on this route — no title, no breadcrumbs, no actions — and the
padding read as a frame around a browser that should meet the window edge.

That is not free: the header is what normally holds the window's top-left
footprint, so the **tab strip inherits its obligations**. It therefore takes the
shared `CHROME_ROW_HEIGHT_CLASS` (48px) title-bar row and reserves the pinned
sidebar trigger — plus the macOS traffic lights while they are visible — by the
same rule as `AppPageHeader`
(`resolveTabStripTopLeftReserveClassName`). Two things break if that reserve
drifts, both silently: on the web build the sidebar toggle covers the first tab,
and in the macOS desktop app the traffic lights do — which is BB-46, a bug this
repo has already had once (see `lib/bb-desktop.ts` for the paired geometry).
A strip shorter than the row would also let those controls spill onto the omnibox
row below, so the height is part of the contract, not styling.

In desktop chrome the strip is also the window's drag region, since it is now the
only chrome on the title-bar row; every control on it opts back out
(`MACOS_WINDOW_NO_DRAG_CLASS`) to stay clickable.

### Tab sizing is Chromium's, and content is not an input to it

Every tab is the same width whatever its title says: Chromium's own 240px until
the tabs stop fitting, and from there they shrink together down to a floor.

The mechanism is one shared fixed basis (`basis-60`) plus `shrink`, deliberately
**not** `flex-1`: a title cannot widen its own tab either way, but dividing the
strip would stretch two open tabs across the whole window, and — the visible
tell — it would leave the leftover space _inside_ the tab list, pushing the
new-tab button to the far edge instead of following the last tab as Chromium's
does. Equal bases also shrink by equal amounts, so the tabs stay identical the
whole way down. No measuring, no resize observer.

The floor (`min-w-15`) is **what a tab needs once its title is gone**: the page
icon and the close control, nothing else. It is a sum of the tab's own geometry —
`pl-2` + a `size-4` icon + `gap-1.5` + the `pr-7` that reserves the close control
— so changing any of those paddings means recomputing it, which is why the
arithmetic is written out at `TAB_WIDTH_CLASS`.

Two consequences are deliberate rather than incidental:

- **No scrolling, at any count.** Past the floor the tab list clips. A floor and a
  scrollport are alternative answers to the same question, and this surface
  answers with the floor; the new-tab button therefore lives _outside_ the clipped
  list (and never shrinks) so a crowded strip never hides the way to open another
  tab — while the list's `min-w-0` is what still lets it be squeezed under its own
  content rather than pushing the button out of view.
- **Room for the close control is reserved, not overlapped**, at every width. The
  floor is what makes that affordable: no width exists where the control has to
  choose between covering the title and disappearing.

The tab is one control filling its box, with the close button as an absolutely
positioned sibling rather than a nested one: nesting would be invalid markup and
would fire both actions, and a tab whose hit area was only its text left the
padding above and below it dead.

**The tab's fill belongs to the box the close control is positioned in** — the
wrapper, not the inner button. Painting the button instead leaves the control
positioned against bounds nobody can see, which reads as a close button floating
outside its tab. The same bug had a second cause worth remembering:
`MACOS_WINDOW_NO_DRAG_CLASS` carries `relative`, and `cn` is tailwind-merge, so
appending it to an `absolute` element **replaces** the positioning and drops the
control into the strip's flow. The drag carve-out belongs on the tab box, which
covers both controls anyway.

### Page icons: a reversed decision, with its reason kept

The shell used to forward no favicons at all, and the comment saying so was a
security decision, not an omission: _"a remote, attacker-controlled favicon URL
must never be rendered (or fetched) by the trusted bb app surface."_ A browser
without tab icons is a worse browser, so the icons are now shown — and the
property that comment protected is still intact, because **the app never touches
the page's URL**:

- The **shell** fetches the icon, through `session.fetch` on the browsing
  partition. So the request carries that session's cookies rather than bb's, and
  it passes the session's own network firewall — `shouldBlockBrowserRequest`
  already refuses LAN hosts outright and loopback without frame attribution, which
  is what stops an icon from being a credentialed probe of bb's own services.
- The renderer receives a `data:` URI the shell built, with a media type taken
  from the shell's **allowlist** rather than from the response. A page cannot put a
  scheme, a URL, or a media type of its choosing into the strip's `<img>`.
- Candidates are `http(s)` only, the body is capped
  (`BB_DESKTOP_BROWSER_MAX_FAVICON_BYTES`), and a page that churns its
  `<link rel=icon>` hits the same sliding-window limiter the popup policy uses.
- SVG is refused: a document format with a parser surface a 16px icon does not
  need. `.ico`, PNG, JPEG, GIF, WebP and BMP go through.

What is _not_ removed, and should be named: the renderer decodes image bytes a
page supplied, exactly as it would for any `<img>`. The caps and the allowlist
bound that; they do not eliminate it. The shell deliberately does no decoding
itself (no resize, no re-encode) so the privileged process never parses those
bytes.

**A spinner takes the icon's place while the tab loads** — Chromium's trade:
on a tab you are waiting for, progress is worth more than identity. Loading state
reaches the strip the same way the icon does (`onLoadingChange` off the state
pushes the tab content already subscribes to), and it is reported "not loading" on
unmount, since nothing observes a tab whose content is gone and a stuck spinner
would outlive the load.

**The icon is keyed to the page's origin, and dropped when loading settles** —
not at commit. Clearing at commit is what made a **reload lose its icon**: it
pushed `null` and then depended on the new document re-announcing an icon, which a
reload does not reliably do. Now a reload keeps what it had (same origin, nothing
to re-fetch even if the icon _is_ re-announced), a hash change or `pushState`
keeps it too, and landing on another site drops it at `did-stop-loading`. Origin
rather than full URL because that is the granularity a site's icon actually has —
and because comparing URLs made a reload lose its icon over a trailing slash. The
cost: a page that _removes_ its icon on reload keeps showing the old one, which is
also what a real favicon cache does.

Two structural notes:

- The icon rides **its own IPC channel** with an optional `onFavicon` on the
  preload bridge, not a new field on the wire-frozen state payload — invariant 2 in
  [bb-migration.md](bb-migration.md), and the same shape the scoped popup event
  used. An older SPA never sees a payload its strict parser would reject; a newer
  SPA against an older shell simply finds no `onFavicon` and shows the generic
  mark.
- Icons live **for the session only**, in the surface view rather than the
  persisted tab state. Persisted tabs are localStorage, whose 5MB budget the tab
  list must not spend on page-supplied bytes. The visible consequence: after a
  restart, tabs wear the generic globe until visited — and since the deck mounts
  only the active tab, that is also true of tabs never opened this session.

### Separators, not gaps

Unselected tabs have no fill, so flush tabs would run together. They are separated
by a hairline pinned to the left edge of a tab (`inset-y-1.5 left-0 w-px`), which
with no gap utility on the list _is_ the edge it shares with the tab before it —
the separator cannot drift away from either tab because there is no space for it
to drift into. Chromium's rule for which ones are drawn: not on the first tab, and
none touching the active tab, which is bounded by its own fill.

## Browser-first startup

A starting app opens the browser rather than bb's home
(`useBrowserFirstStartupRoute`). Two things keep that from turning into "the home
screen is gone":

- It fires **once per app load**, so navigating home later in the session goes
  home and stays there. That is why it is an effect with a one-shot guard rather
  than a `<Navigate>` on `/` — `/` is still bb's home route, and the plan's own
  target has the agent app and the browser sharing the shell.
- It **replaces** the entry instead of pushing, so Back does not walk the user out
  of the browser into a screen they never asked for.

It is desktop-only: on the web build the surface has no native view to put in it
and would show only its "needs the desktop app" screen, so the web keeps landing
on home. A start on any other route — a deep link, a reload on settings, a thread
URL — is the user's destination and is left alone.

## Verified

- `browser-surface-tabs.test.ts` — 13 pure state and persistence cases.
- `BrowserSurfaceTabStrip.test.tsx` — the top-left reserve rule (collapsed
  sidebar, visible traffic lights, expanded sidebar, compact viewport, no sidebar
  context), that tabs of wildly different title lengths render one identical
  width box, that the list clips rather than scrolls, that the new-tab button sits
  outside the clipped list, that the tab is the control while the close button is
  a sibling of it, that the close button stays `absolute` in desktop chrome (the
  tailwind-merge trap above), that hairlines fall between plain tabs only, that the
  tab list is sized by its tabs so the new-tab button follows the last one, and
  that a tab shows its page icon when known and the generic mark when not.
- `desktop-browser-favicon.test.ts` — the icon policy: `http(s)`-only candidates,
  the media-type allowlist (svg and non-images refused), every failure mode
  collapsing to a silent null, the byte cap, that the largest accepted icon still
  fits the wire cap the other package declares, and the page key (every URL on a
  site is one page; other sites, ports and schemes are not).
- `desktop-browser-view-manager.test.ts` — the wiring: a declared icon fetched
  **through the browsing session** and pushed on the favicon channel, no fetch for a
  non-`http(s)` candidate, **a reload keeping its icon** (both silently and with the
  icon re-announced, which must not refetch), the icon dropped once the tab settles
  on another site, no refetch of an icon already pushed, and a page churning its
  icon cut off at the limiter.
- `BrowserSurfaceView.test.tsx` — an icon pushed for a tab reaches that tab's
  strip entry.
- `browser-first-startup.test.ts` — home starts in the browser, any other
  starting route is left alone, the web build stays on home.
- `BrowserSurfaceView.test.tsx` — first-mount tab, add/close/refocus, reopen
  after the last close, and that the surface **attaches the active tab's native
  view** and re-attaches on switch (the point of the surface is that it drives
  the real Electron layer, so that assertion is the load-bearing one).
- `BrowserSurfaceView.test.tsx` — a popup from one of the surface's own tabs
  opening as a foreground tab whose URL is what gets attached, one from a tab it
  does not own ignored, and the unscoped fallback still opening the tab.
- Full `apps/app` suite: 2577 tests green. Repo typecheck: 58/58.
- Live: `bun run dev` plus `bun run dev:desktop` bring up server, daemon, Vite
  and the Electron shell; both new modules compile through Vite in the dev server.

Not verified automatically: how the surface _looks_, and a live page rendering
inside it. Open the desktop app and click the Browser button in the sidebar
footer, or go to `/browser`.

## Keyboard: the chords, and the two that are not Chromium's

The surface now carries a browser's tab chords — `Cmd+T`, `Cmd+W`,
`Cmd+Shift+T`, `Cmd+1`–`8`, `Cmd+9` for the last tab, `Cmd+[` / `Cmd+]`, and
`Ctrl+Tab` / `Ctrl+Shift+Tab`. The commands live on the view that owns the tabs;
the chrome keeps only the address bar and reload.

Nothing new was needed to make a key pressed _inside a page_ work: the shell
already resolves chords against the keybinding table in `before-input-event` and
dispatches them to the renderer. What was missing was the table entries.

**`Cmd+T` and `Cmd+W` were not free.** Both were already bound — to
`panel.newTab` and `panel.close`, scoped `mainSurface`. The browser bindings are
registered **after** them and scoped `browserFocus`, and both resolvers (the
shell's and the renderer's) walk the table from the end, so the browser wins
exactly when the browser has focus and the panel keeps them everywhere else.
That ordering is load-bearing rather than incidental: moving these entries above
the panel ones silently gives `Cmd+T` back to the panel.

`Cmd+9` is the _last_ tab rather than the ninth, which is Chromium's rule, so
`browser.selectTab.*` is eight ids and not nine.

### Reopening a closed tab means reopening its state

`Cmd+Shift+T` restores the page **where it was** — back/forward history, scroll
offset, form values — not just its URL. Chromium serializes that as
`pageState` on each navigation entry, and Electron 41 exposes both halves:
`navigationHistory.getAllEntries()` and `.restore({ entries, index })`.

The split between processes follows from where that data can exist:

- **The shell keeps the session.** It captures the history in `destroyEntry`,
  at the last moment the page still exists, into a bounded map keyed by tab id.
  The entries carry form values, which have no business crossing a wire or
  sitting in a React store — and the renderer could not read them anyway.
- **The renderer keeps the tab.** A small in-memory stack of `{ tab, index }`,
  so a reopened tab lands back at its old position rather than at the end.

The two meet on the **tab id**: a reopened tab keeps the id it had, so `attach`
finds the stored session and restores instead of loading. That is why nothing
new crosses the IPC boundary for this feature — no channel, no contract change,
no version skew. Restoring drives its own navigation, so it _replaces_ the load;
doing both would fetch the page twice and the user would watch it happen.

Three rules keep it from lying about what it can do. A session is spent when
used, so a later reload behaves like any other tab. A session whose URL
disagrees with the URL the renderer asked for is dropped — the renderer is the
authority on where a tab should be. And a failed restore falls back to a plain
load, so the tab still shows its page, just without the history behind it.

The renderer's stack is deliberately **not persisted**, unlike the open tabs:
the state that makes a restore worth anything dies with the shell, so a stack
that survived a restart would promise something it could no longer deliver.

### `Ctrl+Tab` is the IDE's, not Chromium's

Chromium walks tabs by position. This walks them by **use**, and shows the list
while you walk it: hold Ctrl, press Tab to move down the list, release Ctrl to
land. One press and release — the common case — lands on the tab you were in
before this one, wherever it sits in the strip.

The order updates from `activeTabId` rather than from the call sites that change
it, so a click, the omnibox, a shortcut and an agent all count the same — one
place to be right instead of five. A tab nobody has switched to yet has no use
to be ordered by, so **a fresh session starts in tab order** and diverges from
it as the user works; the first Ctrl+Tab after launch therefore looks positional
because at that moment the two orders are the same thing.

Four properties, each of which the obvious implementation gets wrong:

- **Nothing is activated while stepping.** The tab changes when the user lands,
  so walking across five tabs does not load five pages.
- **The order is frozen while the switcher is open.** A list that re-sorted as
  the walk promoted its own rows would move the row under the user's finger,
  and would bounce between two tabs forever.
- **Landing promotes**, which is what makes repeated press-and-release a toggle
  between the last two tabs rather than a slow crawl through all of them.
- **A click on a row lands immediately**, because a mouse never releases Ctrl.

#### Seeing the Ctrl release at all

An IDE ends the walk when Ctrl comes up. The shell forwards **key-downs only** —
a key released inside a browsed page never becomes an app command — so the
release has to happen somewhere the DOM can see it.

Two things arrange that, and both are the reason this works at all rather than
polish. The shell **focuses the host window** when a cycle command arrives
(`HOST_FOCUSING_APP_COMMANDS`, the same move `Cmd+L` makes so typing reaches the
address bar), and the switcher panel **takes focus when it opens**, so the next
Ctrl+Tab resolves inside the browser command context instead of on `body`.

There is still a backstop timer, and it is only that: five seconds, long enough
that a user reading the list is never interrupted, present so a missed release
cannot strand the overlay with the page frozen behind it.

The panel floats over the page using the same freeze the downloads dropdown
does — `setOverlay`, described below — which is also what lets a click outside
the list land on a scrim rather than on the page.

### Plugins can rebind any of it

`bb.ui.registerKeybinding` lets a plugin change what a chord does, or free one
(`shortcut: null`). It is a third layer, and the order is the point: built-in
defaults, then plugins, then the user's own overrides on top. Folding a plugin
into the _defaults_ rather than into the overrides is what keeps the settings UI
truthful — a command a plugin rebound reads as this install's default, not as
something the user changed and could "reset".

Between plugins the lowest plugin id wins a contested command, so the result
does not depend on load order. An unknown command id fails the plugin at load
rather than being ignored, and nothing that plugin registered is applied.

What this does _not_ yet include is a plugin registering a command of its own —
a new id that runs plugin code. That is the other half of plan §7's
`browser.commands`, and it needs a dispatch path into the plugin host rather
than a table entry.

There is no switcher popup listing the tabs. It would now be possible — the
overlay machinery below is exactly what it needs — but it is a separate feature.

## The page context menu

Right-clicking a browsed page used to offer cut, copy, paste and select-all —
the editing roles and nothing else. It now offers what a browser offers, chosen
by what is under the pointer rather than shown all at once: a link menu is about
the link, and burying "Open Link in New Tab" under six editing roles is how a
menu stops being usable.

| Target         | Entries                                                |
| -------------- | ------------------------------------------------------ |
| Link           | Open in new tab, open in default browser, copy address |
| Image          | Copy image, copy address, save image                   |
| Editable field | Cut, copy, paste, select all                           |
| Selection      | Copy, search for it                                    |
| Bare page      | Back, forward, reload                                  |

Three of those reuse machinery rather than adding any. "Open in new tab" goes
down the **scoped open-tab channel popups already use**, so the renderer stays
the authority on where a tab goes. "Save image" is `downloadURL`, which lands in
`will-download` and is therefore named, rate-limited and reported by the code
[browser-downloads.md](browser-downloads.md) describes. And every entry that
acts on a URL takes the **same `http(s)`-only rule the popup policy applies** —
a page chooses these URLs, and `javascript:` in a link would otherwise become a
click that runs it. Copying an address stays enabled regardless: that goes to
the clipboard, not to a navigation.

"Search for …" is the one entry that cannot be answered in the shell: the search
engine belongs to the omnibox, and only the renderer knows what it is. So the
**query travels rather than a URL**, on its own channel, and the surface builds
the search with `buildBrowserSearchUrl` — the same function the omnibox uses,
rather than a second copy of the engine in the main process.

### Plugins can add to it

`bb.browser.registerContextMenuItem` — the plan's `browser.contextMenu.items`.
An item declares an `id`, a `title`, an optional `when` (`link`, `image`,
`selection`, `page`; any match shows it) and a `run(context)` that receives the
tab, the page URL, and whichever of link, image and selection was under the
pointer.

**Items are declared, not asked for at click time**, and that is the design
rather than an optimisation. The menu opens on a synchronous Electron event; a
menu that asked the server what to show would put a round trip in front of every
right-click. So the app pushes the declared list to the shell whenever plugins
change, the shell composes it from what it already holds, and only the _click_
travels back — app → server → the plugin's `run`.

Two consequences worth stating because they are visible to plugin authors:
`title` and `when` are fixed at registration, so an item cannot label itself
from what was clicked; and entries append **below** the browser's own behind a
separator — a plugin adds to this menu, it does not rearrange it.

`examples/plugins/explain-selection/` is the worked example, and it is the
plan's own Phase 6 one: "Explain with Agent" on a selection, spawning a BB
thread that quotes it. Its README is where the first consequence above is
argued from the plugin author's side — an item that needs configuration cannot
decide per click, so it registers nothing until it has some. The end-to-end path
is `heroes.test.ts` > `hero plugin: explain-selection`, which is plan §22's
second scenario: install → declared entry → picked → the selection in an agent's
first message.

## Find in page

`Cmd+F` opens a find bar over the active tab: a field that searches as you type,
a `3/12` counter, arrows, Escape to close. Chromium does the searching —
`webContents.findInPage` / `stopFindInPage`, with the counts arriving on
`found-in-page`.

It rides a new channel pair and an optional `find` / `onFindResult` on
`BbDesktopBrowserApi` (invariant 2 in [bb-migration.md](bb-migration.md)). Two
channels rather than an invoke pair, because **one query answers many times**:
Chromium reports the count while it is still scanning, so a request/response
shape could carry only the first of those answers or only the last.

Three details are worth keeping:

- **The query rides every command**, including `next` and `previous`. Not an
  oversight — Chromium's own find takes the text on each call, so a step that
  carried none would have nothing to search for. An empty query therefore reads
  as "stop searching" rather than "search for nothing", which is also what
  clearing the field does.
- **The shell drops results for a superseded query.** The user types another
  character while the previous query is still being counted; both answer. The
  entry remembers the request id it last issued and ignores anything else, so
  the counter never jumps backwards onto a query the bar has moved on from. The
  same id is forgotten on `did-navigate`, because a new document ends Chromium's
  session with it.
- **`findNext` is Chromium's `new_session` under a misleading name**: true
  begins a search, false steps through the one already running. A step with no
  session behind it — the first Enter after a navigation ended one — is treated
  as a new search rather than a no-op.

### The find bar takes layout space, and this one had no choice

The rule below says a transient panel should freeze the page and float over it.
The find bar is the exception, and for a reason that decides itself: freezing
the page to a bitmap is exactly what makes the highlights it just asked for
impossible to see. So the bar sits in the chrome and the page shrinks under it —
which is where Firefox puts its own — and the deck's existing bounds sync
follows without being told.

`Cmd+F` also joins the shell's host-focusing command set, next to `Cmd+L` and
the tab switcher: the next keystroke has to land in the app's field rather than
in the page.

### Plugins can add to it

`bb.browser.registerFindAction` — `browser.find.actions`. An action declares an
`id`, a `title` and a `run(context)` that receives the tab, the page URL and the
query. Buttons appear after the browser's own controls and are disabled while
the bar is empty, because every one of them is about the query.

The find bar is the one place that knows what the user is looking for on this
page, which is what makes it worth extending — "search this across my tabs",
"look it up in our docs", "ask an agent about it". Unlike the context menu this
needs no shell involvement at all: the bar is DOM, so the app renders the
declared list and posts the press to the server directly.

## The questions the network asks

Three Chromium events used to fail in silence, and their _defaults_ are what
made them dead ends rather than any missing UI: Electron cancels an
authentication challenge unless someone answers it, cancels a certificate error
the same way, and picks the **first certificate in the store** when a server
asks for a client certificate. So the page failed with nothing said, or a
credential was chosen for the user by position.

All three now ride one channel pair — `onPagePrompt` / `respondToPagePrompt`,
new and optional per invariant 2. They share a channel because they share a
shape: the load is stopped until something answers, and answering hands the
decision back to Chromium. Each prompt carries an `id`, which is what makes a
late answer harmless — a human can still be typing when the tab navigates away.

The view is hidden and the page frozen to a bitmap while one is open, exactly as
a JavaScript dialog does it.

### What is asked, and what is refused without asking

- **A password box is worth spoofing**, so a subresource may only ask when it is
  the page's own origin. Otherwise any page could embed an image from an
  attacker's server, have it answer `401`, and put a credential prompt in front
  of a user looking at someone else's address bar. A navigation may always ask:
  the user went there.
- **The realm is not on the wire at all.** It is server-controlled text next to
  a username field — the reason Chrome stopped showing it — so the shell keeps
  it only as the key deciding which parked requests one answer covers. The host
  is what the prompt shows, because it is the part a user can judge.
- **One prompt per tab.** A second question while one is open is refused rather
  than queued, which is the whole anti-nuisance policy.
- **Proxy authentication is refused outright**: there is no proxy configuration
  here to authenticate against, and a prompt attributed to no site is the least
  answerable of the lot.
- **Only the page's own certificate can be trusted by hand.** A subresource
  riding on a bad certificate is refused unless that exact certificate was
  already accepted for the page — a user cannot judge what they cannot see.
  Acceptance is keyed on host **and fingerprint**, so trusting one bad
  certificate does not trust the next one served from the same name, and it is
  session-only: never written down, gone on restart.

One path is unverified against a real server: declining a **client certificate**
calls Electron's callback with none, which is the one behaviour its docs do not
describe. It is wrapped, so a runtime that refuses it cannot take the main
process down — the request then fails, which is what declining meant.

### A page with a plugin behind it

`bb.browser.registerAuthProvider` — `browser.auth.providers`. A provider is
asked before the user is, and returning credentials means no prompt appears at
all; that is what makes a password manager a plugin here rather than a feature.
Providers run in plugin id order, sequentially, and the first to answer wins —
asking a second keychain after the first said yes is a lookup nobody needed.

A provider is asked **once per host per tab**. A second challenge from the same
host means the first answer was wrong, and replaying it would spin forever, so
the second one goes to the user.

Certificates are deliberately **not** delegated: "trust this server anyway" is
not a credential a plugin can look up, and it is exactly the decision that
should cost a human a click.

### A crashed or hung page says so

`render-process-gone` and `unresponsive` route into the error text
`did-fail-load` already drives, which is what gives them the error screen that
already exists with a reload button on it — no new surface, no new wire field. A
clean exit says nothing (that is a tab being torn down), `oom` names itself, and
`responsive` takes its own message back while leaving a real load error
underneath alone.

## PDF

`plugins: true` on the browsed view, which turns on Chromium's built-in viewer.
The preference keeps a name from an era that ended — NPAPI and PPAPI are gone,
and PDFium is the only "plugin" left — so what it decides today is exactly one
thing: whether a PDF link is a page or a download.

Without it, Chromium falls back to downloading a document it cannot display.
That was doubly invisible while downloads were denied (the link did _nothing_,
which is how it reached [browser-gaps.md](browser-gaps.md)); with downloads
working it became a file on disk, which is still the wrong answer for a browser
whose whole point is to be the user's real session.

What it admits is one more parser of a complex, attacker-supplied format next to
untrusted content. That is the bargain every Chromium-based browser makes, and
what bounds it is that PDFium runs in its own sandboxed process rather than in
the page's renderer. The alternative — every PDF becomes a download opened by
the OS reader — moves the same parsing to a program with **no** sandbox at all,
so refusing here would not have been the safer choice, only the one that looked
safer.

Two consequences worth knowing:

- The viewer brings **its own toolbar** (zoom, rotate, print, download) drawn by
  Chromium inside the page. It is not ours and does not follow the app's theme.
- Its download button goes through `will-download` like any other download, so
  it is named, rate-limited and reported by the same code
  ([browser-downloads.md](browser-downloads.md)).

### Reading one as text

`readPage` answers a PDF tab with the document's text, so `page.get_text` works
on a PDF the way it works on an article. Everything about how is decided by one
fact: **the text is not in the DOM.** Chromium leaves a stub in the main frame —
a stylesheet link and an empty body — and renders the document in a process of
its own, so `document.body.innerText` is `""`.

Two ways around that were tried against a real viewer before the third was
written, and both are recorded in desktop-browser-pdf-text.ts so they are not
tried again. **The accessibility tree** does not carry it: PDFium builds one —
it is how a screen reader reads a PDF in Chrome — but in the browser process,
not in the renderer CDP answers from, so attaching to the PDF content frame
returns five nodes ending in an `EmbeddedObject`, with
`--force-renderer-accessibility` making no difference. **Asking the viewer** for
its selection means scripting an extension frame whose internals carry no
compatibility promise.

So the shell refetches the document and parses it:

- **Through the browsing session**, with `credentials: "include"`. That is what
  makes a PDF behind a login readable at all — the cookies that fetched it for
  the viewer fetch it again — and the usual answer comes straight from the cache
  the viewer just filled.
- **Bounded while streaming.** The body is read in chunks against a 32MB cap, so
  a server that keeps sending is refused at the first chunk past it rather than
  buffered whole: `Content-Length` is a claim, and `arrayBuffer()` on a body
  that keeps going is a page-controlled allocation in the main process.
- **In a utility process.** Not for privilege — the parser is JavaScript, so
  this is not the sandbox PDFium has — but because parsing is unbounded CPU work
  on a document the page chose, and the main process is where every window's UI
  thread lives. A parse that spins there freezes the app and no timeout can
  rescue it; a parse that spins in a child is killed. One process per document,
  killed as soon as it answers.
- **Under one deadline** of 15s covering fetch and parse together, so a slow
  server cannot buy the parser more time than the whole read is allowed.

The parser is pdf.js, packaged as `unpdf`: one dependency, no native code, and
no `eval` or `Function` constructor anywhere in the build — the path that made
CVE-2024-4367 possible was removed upstream rather than switched off.

What it does not do, stated rather than discovered:

- **`blob:` and `data:` documents are out of reach**, because the main process
  cannot resolve a URL that means something only inside one renderer, and
  neither can a document that exists only as the answer to a POST. All of them
  read as `unreadable`. An in-page fetch would cover the first two and is the
  fallback to add if it turns out to matter.
- **A long document is truncated** to the same 64KB every page read is, with
  `textTruncated` set. There is no page range to ask for.
- **A scan reads as nothing**, because there is nothing to read: its pages are
  images. The agent is told so — "no text layer" — rather than handed an empty
  success that reads as a blank document.

Two refusals are PDF-only and exist because each is worth a different next step
than "could not be read": `too-large` says the document is past the cap and will
not become readable by asking again, and `password-protected` says a human has
something the agent does not.

### The plugin contribution point

`bb.browser.registerPdfTextProvider` — `browser.pdf.textProviders`. A provider
is handed `{ tabId, pageUrl, title }` and returns the document's text, or null.

It is asked in exactly one case: a document the browser parsed and found **no
text** in. That is the scan above, and it is the one case where reading needs
something the browser does not have — an OCR pass, a document service — and the
one case where asking costs nothing, because the built-in read has already come
back empty. A PDF with a text layer never reaches a provider, so this is not a
way to intercept ordinary reads.

Providers are asked in plugin id order and the first non-empty answer wins;
declining, throwing, and running past the 10s box all mean "ask the next one".
That box is the longest of any browser hook because this is the only one asked
to do real work, and nothing is held up on screen while it runs — an agent is
waiting for a tool result.

The viewer itself still offers no hook, for the reason it never did: it is
Chromium's own. A plugin that wants to re-home or convert PDFs registers a
download handler ([browser-downloads.md](browser-downloads.md)) instead.

## Developer tools

`Cmd+Alt+I` — Chromium's own chord — opens Chromium's own DevTools: Elements,
Console, Network, Sources. Not a panel that resembles them. The shell creates a
second native view, points the page's `webContents` at it with
`setDevToolsWebContents`, and opens the tools with `mode: "detach"` — detached
meaning "the host is ours", without which Chromium would dock them into a window
of its own choosing.

That decides almost everything else about the feature:

- **The app renders one control and nothing else.** `BrowserDevToolsPanel`
  reserves the area and reports its rect, exactly as `BrowserTabContent` does
  for the page. The exception is a close button, and it is an exception made
  after seeing the panel run: DevTools are opened detached because the host view
  is ours, and a detached DevTools expects a **window frame** to carry its close
  control — so it draws none. Preferring to add no chrome of our own is worth
  less than being able to close the panel without a keyboard.
- **The panel takes layout space**, like the find bar and for a sharper version
  of the same reason: two native views cannot be stacked, and freezing the page
  to draw over it would defeat the point of inspecting a live one.
- **The tools are per tab**, as in Chromium. Switching tabs hides one tab's
  tools and shows the other's, because the view's visibility follows its entry's
  — which is also what keeps it from compositing over a dropdown.
- **Both directions are reported.** DevTools open without the app asking
  ("Inspect" from the page menu) and close from their own toolbar, so
  `devtools-opened` / `devtools-closed` are pushed rather than assumed.
- **The view takes default web preferences.** It is not a browsed page: it is
  Chromium's own UI, and handing it the hardened, partitioned, sandboxed
  preferences meant for untrusted content would break the tools rather than
  contain them.

### The cost, which was predicted

[browser-gaps.md](browser-gaps.md) said this item would eventually argue with
the CDP decision, and it does: DevTools holds Chromium's only protocol client,
so while the panel is open the automation commands on that tab answer
`debugger-unavailable`.

Nothing had to be built for that. `createCdpSession` already refuses a target
that is attached, precisely because "DevTools is the realistic case", and every
automation result already carries `debugger-unavailable` as a typed refusal. A
human debugging a page and an agent driving it are two clients for one seat, and
the browser says so instead of failing somewhere else.

### Inspect

The page's context menu ends with **Inspect**, where every browser puts it: it
is about the page rather than about what was clicked. It opens the tools if they
are closed and calls `inspectElement` at the pointer, so the Elements panel
lands on the node — again Chromium's behaviour, because it is Chromium's code.

The entry is absent when the caller has no way to host the tools, rather than
present and inert.

## Fullscreen

Two different things share one mechanism. A page that calls the HTML fullscreen
API — a video player's button — gets what Chromium gives it: the **window** goes
to the OS's full screen and the **view** takes the whole content area of it, app
chrome included, with the renderer's own rect waiting untouched in
`desiredBounds` for the way back.

Two settings are what make a real fullscreen button — YouTube's, say — work at
all, and both were found by asking whether the API a page sees is Chromium's:

- **`fullscreen` is a permission**, and this session denied every permission but
  one. A denied `requestFullscreen()` rejects in the page, so
  `enter-html-full-screen` never fires and the button does nothing —
  handler or no handler. It is allowed now; `keyboardLock` stays denied
  _because_ of it, being the permission that would let a page keep the Escape
  that gets the user out.
- **`disableHtmlFullscreenWindowResize: true`** on the browsed view, which turns
  off Electron's own version of the window half so this code can do it instead.
  That is not a smaller behaviour but a more careful one: Electron's cannot tell
  a window the **user** had already put in full screen from one it expanded
  itself, so it would drop the user out of theirs when a video ended. Here the
  window is only taken back out if a page put it there, and closing the tab
  mid-video gives it back too.

With those, the page gets Chromium's own API and nothing simulated:
`document.fullscreenEnabled`, `fullscreenElement`, `fullscreenchange`, the
`:fullscreen` styling, `document.exitFullscreen()` and Escape are all
Chromium's, because all this code does is answer the embedder's question, move
the window and resize the view.

The OS animates its way into full screen, so the bounds applied on the event are
the pre-animation ones; the window's own resize burst re-applies them when it
settles (`endWindowResize`), which is the same path any window resize takes.

`Cmd+Shift+F` is the same expansion asked for by the user instead of by the
page, and it is held in a **separate flag** so a video leaving its own
fullscreen cannot take the user's choice with it, or the reverse. It never moves
the window, only the view — it is gated on the window already being full screen,
so there is nothing to move.

It ends when the tab does, too: switching tabs gives the chrome back, because
the expansion belongs to the tab it was asked for and a tab left expanded would
come back that way over a strip the user can no longer see.

It only does anything while the app window is already full screen, and that gate
lives in the renderer rather than the shell — the renderer is the side that
knows. Covering the tab strip and the omnibox inside an ordinary window would
leave a page with no browser around it and no obvious way back; in an ordinary
window the chord does nothing, which is what a browser does with a shortcut that
does not apply. Leaving the window's own full screen takes the page's with it.

## Drawing over a page is possible, and costs a frozen page

Two documents here say React cannot draw over the page area, and both are right
about the constraint: a native `WebContentsView` composites above the DOM. What
neither said is that there **is** a way through, that this repo already had it,
and that it is worth reaching for when the alternative reads wrong.

JavaScript dialogs freeze the page to a bitmap, hide the native view and draw on
the DOM that is left ([browser-automation.md](browser-automation.md), Stage A).
That sequence is now a command — `setOverlay` — and the downloads dropdown uses
it ([browser-downloads.md](browser-downloads.md)). It buys two things: a panel
that floats over the page, and clicks that land on the DOM everywhere, which is
what makes close-on-outside-click possible at all.

It costs a still page for as long as the overlay is up. So the rule is not "in
layout or nothing", it is:

- **Taking layout space** suits something tied to typing, where the page is not
  what the user is looking at and freezing it for the length of a search would
  be worse. The omnibox suggestion list stays as it is.
- **Freezing and overlaying** suits a transient panel opened and closed in
  seconds, where shoving the page down would read as a bug.

## Next

Milestone B is done: the reused address bar is replaced by the surface's own
omnibox chrome (`showChrome={false}` on the deck), and the per-scope navigation
history this surface records is one of its providers. See
[omnibox.md](omnibox.md) — including why the suggestion list takes layout space
instead of overlaying the page.
