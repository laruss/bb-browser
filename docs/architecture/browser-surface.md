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
- Full `apps/app` suite: 2577 tests green. Repo typecheck: 58/58.
- Live: `bun run dev` plus `bun run dev:desktop` bring up server, daemon, Vite
  and the Electron shell; both new modules compile through Vite in the dev server.

Not verified automatically: how the surface _looks_, and a live page rendering
inside it. Open the desktop app and click the Browser button in the sidebar
footer, or go to `/browser`.

## Next

Milestone B is done: the reused address bar is replaced by the surface's own
omnibox chrome (`showChrome={false}` on the deck), and the per-scope navigation
history this surface records is one of its providers. See
[omnibox.md](omnibox.md) — including why the suggestion list takes layout space
instead of overlaying the page.
