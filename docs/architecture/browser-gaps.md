# Browser Gaps

What a desktop browser does that this one does not, taken at `63cc4fccf` — after
plan §18 Phase 5 and the automation stages in
[browser-automation.md](browser-automation.md).

Every other document here describes what was built and why. This one describes
what is missing, so the next phase can argue with a written list instead of
discovering it one site at a time.

## How this was produced

Direct reading of `apps/desktop/src` — the shell owns nearly every decision
below — and `apps/app/src`, checked against Chrome's own published feature and
shortcut surface. Each entry names where the behaviour is decided in code, or
states that no such code exists: **an absent handler is the finding**, and the
grep that found nothing is the evidence.

Two kinds of gap are kept apart throughout, because they need different
arguments. A **decided** gap has a comment or a document saying so and a reason
behind it; an **unbuilt** gap is simply work nobody has done. Re-opening the
first is a policy discussion. Closing the second is scheduling.

## Tier 1 — dead ends

A user hits these within minutes of real browsing, and every one of them fails
_silently_: no error screen, no toast, no log. That is the common defect, and it
matters more than any single item — a browser that refuses is usable, a browser
that does nothing is broken.

### ~~Downloads are cancelled, and nothing says so~~ — closed

Every download link, "export CSV" button and `Content-Disposition: attachment`
response used to do nothing at all: `will-download` answered `preventDefault()`
with no message anywhere. Downloads now write to the user's downloads folder and
report themselves — see [browser-downloads.md](browser-downloads.md), which also
covers the plugin contribution point that lets a plugin re-home or consume them.

A toolbar button appears once something has been downloaded, listing the ten
most recent with open and show-in-folder on each. What is still missing is
progress, persistence across restarts, and pause/resume — deliberate omissions
rather than oversights, listed in that document's own Next section.

### ~~PDFs are a dead click~~ — closed

The browsed view set no `plugins` preference, so it defaulted off, Chromium's
built-in viewer never loaded, and Chromium fell back to downloading a document
it cannot display — which, while downloads were also denied, meant a PDF link
produced _nothing_.

Both halves are decided now. Downloads work, and `plugins: true` turns the
viewer on, so a PDF opens as a page. The cost was worth stating rather than
inheriting, and it is stated in [browser-surface.md](browser-surface.md): the
viewer admits one more parser of an attacker-supplied format, bounded by
PDFium's own sandboxed process — where the alternative, an OS reader opening
every downloaded PDF, has no sandbox at all.

**Reading** one was the other half, and it is closed too. The viewer's wrapper
frame really is empty, and Chromium hands the text over nowhere — not through
the accessibility tree, which is where it looked most likely to be. So the shell
refetches the document through the browsing session and parses it in a utility
process; the accessibility snapshot still sees only the wrapper, which is the
honest limit, because a PDF has no elements to act on either way. See the PDF
section of [browser-surface.md](browser-surface.md).

### ~~`window.open` flows break~~ — closed

The shell denies every popup and hands the URL to the renderer to open as a tab
(`desktop-browser-view.ts:2285`). For a plain `target="_blank"` link that is
exactly right, and it works — see the popup section of
[browser-surface.md](browser-surface.md), which is where the surface's missing
subscription was fixed.

What it cannot serve is a page that **uses the handle it got back**:

- `window.open()` returns `null`, which is precisely how a page detects a popup
  blocker — so OAuth and payment SDKs report "popup blocked" and stop, rather
  than continuing into the tab we opened for them;
- the new tab has no `window.opener`, so the `postMessage` handshake an OAuth
  popup completes with cannot run;
- `about:blank` popups — the shape a page uses when it opens a window and writes
  into it — are dropped outright, because `isAllowedPublicBrowserPopupUrl`
  requires public `http(s)`.

The practical consequence was that **"Sign in with …" did not work**, on a
browser whose whole point is to be the user's real logged-in session.

Popups are real now for tabs that claim them — Chromium creates the window, the
shell hosts it as a tab, and the page gets the handle, the opener and the
`window.close()` it was always asking for. The security decision was made rather
than avoided, and it is written down in
[browser-surface.md](browser-surface.md): the popup policy and the rate limiter
both survive unchanged, `about:blank` is admitted deliberately and only on this
path, and the hardening rides along because a popup inherits its opener's web
preferences.

Which tabs claim popups is the renderer's declaration, not the shell's guess.
The thread panel claims none — a link there follows the user's in-app-link
preference and may leave for the system browser — so it keeps the older
deny-and-push behaviour, which is also the fallback for anything unclaimed.

### ~~Absent handlers~~ — closed

Each of these was a documented Electron event with no listener anywhere in
`apps/desktop/src`. All five are handled now; see
[browser-surface.md](browser-surface.md) for the policies and what they refuse.

| What the user does                           | Event                                               | What happens now                                                               |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Loads a page behind HTTP basic auth          | `login`                                             | A prompt naming the host — after any plugin auth provider has been asked first |
| Reaches a self-signed or expired certificate | `certificate-error`                                 | A prompt with the certificate's details and "proceed" behind them              |
| Clicks a video's fullscreen button           | `enter-html-full-screen` / `leave-html-full-screen` | The view takes the whole window and gives it back                              |
| Sits on a page whose renderer dies or hangs  | `render-process-gone` / `unresponsive`              | The error screen that already existed, with its reload button                  |
| Hits a site asking for a client certificate  | `select-client-certificate`                         | A picker, instead of Electron handing over the first certificate in the store  |

The observation that drove this is worth keeping: `did-fail-load` **was**
already handled and already drove an error screen, which is what made the rest
of the table an oversight rather than a policy — the machinery for telling the
user something went wrong existed and these paths did not reach it. Two of them
now reach exactly that machinery rather than growing a second one.

## Tier 2 — unbuilt surfaces

Standard browser functionality with no code behind it. Nothing here is decided
against; it is simply not written.

**Page**

| Feature                           | State                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Find in page (`Cmd+F`)            | **Done** — a find bar in the chrome, plus a plugin contribution point ([browser-surface.md](browser-surface.md))                      |
| Zoom (`Cmd +/-/0`), per-site zoom | `setZoomFactor` exists only for the app window, never for a browsed view                                                              |
| Print (`Cmd+P`)                   | `printToPDF` exists for agents only; no user-facing print                                                                             |
| Page context menu                 | **Done** — link, image, selection and navigation entries, plus a plugin contribution point ([browser-surface.md](browser-surface.md)) |
| View source                       | **Done** — Chromium's own DevTools, opened in the panel ([browser-surface.md](browser-surface.md))                                    |
| Reading a PDF as text             | **Done** — the shell refetches the document and parses it out of process, plus a plugin contribution point for scans ([browser-surface.md](browser-surface.md)) |
| Spellcheck corrections            | Underlining is Chromium's default; the browsed view's menu offers no suggestions                                                      |

The context menu is now built (open link in new tab or the default browser,
copy link address, copy/save image, search for the selection, back/forward/
reload), and plugins can add entries to it. What is left in that table is zoom,
print and spellcheck suggestions — each blocked on a shell capability rather
than on menu wiring.

**Developer panel**

There is no way to look at a page as a developer: no console, no network list,
no source, no element inspection. Wanted, at least at the level of Chromium's
first three panels — **view source, network, console** — plus an **Inspect**
entry in the page context menu once there is a panel for it to open.

This entry is worth more detail than the rest of the table, because most of it
is **already captured and unexposed**, and the one part that is genuinely
blocked is blocked by a decision rather than by work:

- **Console and network are recorded now**, per tab, from the moment the tab
  exists — `entry.consoleLog` and `entry.networkLog` in
  `desktop-browser-view.ts`, read through the `observe` channel, which is on the
  preload API and therefore reachable from the app rather than only from agents.
  A panel over these is a UI and a read loop, not a new capability.
- **Their limits come with them**, and a panel must not pretend otherwise:
  `console-message` hands over text Chromium has already flattened, so there
  are no structured arguments and no stack traces, and `webRequest` sees method,
  type, status and cache but **never bodies**
  ([browser-automation.md](browser-automation.md), Stage C).
- **View source is the one piece with nothing behind it.** `page.getText`
  returns rendered text, not markup. The cheap version is another constant
  script in the page-read isolated world returning `documentElement.outerHTML`
  — which is the _live DOM_, not what the server sent; the two differ on any
  page that scripts itself, and which one "view source" means is a decision to
  make rather than to discover.
- **Inspect needs element identity.** The context menu already carries `x`/`y`,
  which is exactly what `DOM.getNodeForLocation` wants — but that is CDP, which
  is the contested part below.

Two constraints shape it before any code is written. The panel is **persistent**
— open while browsing — so it cannot use the freeze-and-overlay trick the
downloads dropdown and tab switcher use; it has to take layout space, the way
the omnibox suggestion list does, and let the page shrink around it. And
anything richer than the buffers above wants CDP, which is where this collides
with a Tier 3 decision: **DevTools on browsed views is denied**, and the
automation stack now depends on holding the one protocol client per
`webContents` that Chromium allows. Opening native DevTools would take that
slot. A panel built on the existing observation channels does not; a panel that
grows an Elements tree eventually will, and that trade is the thing to decide
deliberately rather than discover.

**Tabs**

No tab context menu, no drag reorder, no pin / duplicate / mute. Reopening a
closed tab is done, with its page state
([browser-surface.md](browser-surface.md)). Tab overflow is covered: the strip
clips at a width floor rather than scrolling, which is a
[decided](browser-surface.md) trade rather than a gap.

**Keyboard** — mostly closed

The tab chords are in: `Cmd+T`, `Cmd+W`, `Cmd+Shift+T` (restoring history and
scroll, not just the URL), `Cmd+1`–`9`, `Cmd+[` / `Cmd+]`, and `Ctrl+Tab` /
`Ctrl+Shift+Tab` walking **recently used** tabs rather than positions. See
[browser-surface.md](browser-surface.md) for the ordering rule that decides
`Cmd+T` between the browser and the thread panel, and for why the MRU cycle ends
on a timer.

`Cmd+F` is in too, and arrived with the find bar rather than as a binding — see
[browser-surface.md](browser-surface.md). Still missing, and each blocked on a
capability rather than on a binding: `Cmd+P` (needs a user-facing print) and the
zoom trio (needs `setZoomLevel` on a browsed view). Those belong with their
features, not with the keyboard.

**Data**

- **Bookmarks do not exist.** No manifest, no store, no UI, nothing in the
  repository.
- **History is 24 entries of localStorage.** `browser-history.ts:14` caps at
  `BROWSER_HISTORY_MAX_ENTRIES = 24` per scope. That is a recents list, and it is
  also everything the omnibox's history provider can ever see — the ranking work
  in [omnibox.md](omnibox.md) is running against a 24-row corpus. No history
  page, no search, no per-day view.
- No download **progress** and no history across restarts (downloads and their
  list now work — see [browser-downloads.md](browser-downloads.md)), no
  clear-browsing-data UI, and
  no site-info popover — the padlock in the omnibox is decorative, computed from
  the URL by `getBrowserUrlSecurity`.

**Everything else**

Search engine is hardcoded (`SEARCH_ENGINE_URL`, `browser-url.ts:4` — Google,
no setting). No incognito or profiles: one fixed `persist:bb-browser` partition.
No autofill or password manager. No audio indicator, per-tab mute, picture-in-
picture or media keys, and no Widevine in Electron, so DRM streaming will not
play. Session restore carries URLs only — no scroll position, no form state.

**Multiple windows** is the one structural item in this tier. Browser views are
keyed `${hostWindow.webContents.id}:${tabId}`
(`desktop-browser-view.ts:453`), while surface tabs live in one module-scoped
`atomWithStorage` over localStorage. Two app windows on `/browser` would
therefore share a single tab list while each built its **own** `WebContentsView`
for every tab in it — the same page loaded twice, and a tab list mutating under
both. Not run; the keying and the storage are what imply it.

## Tier 3 — decided, and worth not re-litigating

These look like gaps in a feature comparison and are answers, each with its
reasoning already written down somewhere in this directory or in a code comment:

- **Permissions**: everything denied except `clipboard-sanitized-write`
  (`desktop-browser-view.ts:2043`). A prompt UI is explicitly "a later phase".
- **DevTools on browsed views**: denied, and CDP's one-client-per-`webContents`
  rule now depends on it ([browser-automation.md](browser-automation.md)).
  **Contested** — see the developer panel in Tier 2, which wants some of what
  DevTools would give and mostly does not need DevTools to give it.
- **Search completions** from a suggest endpoint: a network and privacy
  decision, not an omnibox one ([omnibox.md](omnibox.md)).
- **Chrome extension compatibility**: plan §10, out of scope for the MVP.
- **Favicons live for the session only**: localStorage is not for page-supplied
  bytes ([browser-surface.md](browser-surface.md)).
- **Tab strip clips instead of scrolling**: a floor and a scrollport answer the
  same question, and this surface answers with the floor.

Changing any of these is legitimate — but as a reversal with a stated reason,
the way favicons were reversed, not as filling in a blank.

## What the gaps have in common

Three patterns, and each suggests a different kind of fix:

1. **Silence.** Downloads, PDFs, popups and every absent handler fail without
   telling anyone. The error screen already exists; none of these paths reaches
   it. A single "the browser refused this, and why" channel would improve all of
   them before any of the underlying features are built.
2. **v1 denials that were never revisited.** Downloads and permissions were both
   deferred with a comment. Both turned out to be load-bearing in a way the
   comments did not say: the download denial made every download link dead, and
   the blanket permission denial made every fullscreen button dead, because
   `fullscreen` is a permission and denying it rejects `requestFullscreen()`
   before any handler can run. Both are now allowed, deliberately and
   individually — the rest of the list still stands as written.
3. **The shell is finished where the renderer is not.** Keyboard forwarding, the
   context menu, favicons and page reads all have complete main-process support;
   what is missing is the command table, the menu entries, the UI. That
   asymmetry is why the keyboard and context-menu items are cheap and the
   downloads and popup items are not.

## Ordering

By value against cost, not by tier:

1. ~~**Keyboard set**~~ — done, minus the two chords that are really other
   features (`Cmd+P`, zoom).
2. ~~**Page context menu link/image entries**~~ — done, including the plugin
   contribution point.
3. ~~**Find in page**~~ — done: `findInPage` / `stopFindInPage` behind a new
   channel pair, a find bar that takes layout space (freezing the page would
   hide the highlights), and a plugin contribution point.
4. ~~**The absent Tier 1 handlers**~~ — done: all five, on one prompt channel
   that copies `BrowserPageDialog`'s freeze-and-draw pattern, plus an auth
   provider plugins can answer from. `Cmd+Shift+F` arrived with the fullscreen
   handler, since it is the same expansion asked for by hand.
5. ~~**PDF**~~ — done: the preference is on, the security question is answered
   in writing, and reading one as text is done too. That last part is not the
   viewer's doing — the text is not in the DOM and Chromium will not hand it
   over, so the shell refetches the document and parses it in a utility
   process.
6. ~~**Downloads**~~ — done; the manager UI it deliberately left out is in
   [browser-downloads.md](browser-downloads.md)'s Next section.
7. ~~**Popups with a live opener**~~ — done: real windows for tabs that claim
   them, hosted as tabs, with the popup policy and rate limiter intact and
   `about:blank` admitted on purpose.
8. ~~**Developer panel**~~ — done, and it turned out not to need building:
   `setDevToolsWebContents` puts Chromium's own DevTools in a view of ours, so
   the panel _is_ Elements, Console, Network and Sources rather than an
   imitation. It did argue with the CDP decision as predicted, and the argument
   was already settled — see [browser-surface.md](browser-surface.md).

History's 24-entry cap sits outside this list: it is cheap to raise and it
changes what the omnibox can do, so it belongs with whatever omnibox work comes
next rather than with browser features.

## Not verified

Everything with a file and line reference above was read at `63cc4fccf`, and
every "no such code" claim is a grep over `apps/desktop/src` and `apps/app/src`.
What is **inferred from code rather than observed in a running browser**, and
should be confirmed by hand before anyone plans around it:

- that a PDF link produces nothing (the `plugins`-off → download → cancelled
  chain) — the reading half of this was measured rather than inferred: the
  viewer's frame layout, the empty accessibility tree, the cookie-carrying
  refetch and the utility-process parse were each run against a real Electron
  before being written;
- the exact failure mode of an OAuth popup, which differs per SDK;
- the multi-window behaviour described above;
- that `<input type="file">` still opens Chromium's native picker, and that
  dragging a file into a page works — neither is blocked by anything found here,
  and neither was exercised.

The shortest way to check the first three is the same one the automation plan
uses: `bun run dev` plus `bun run dev:desktop`, then `/browser` in the desktop
app.
