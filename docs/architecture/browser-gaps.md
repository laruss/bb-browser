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

### PDFs are a dead click, as a consequence of two other decisions

The browsed view sets no `plugins` preference
(`desktop-browser-view.ts:2402`), so it defaults off and Chromium's built-in PDF
viewer never loads. Chromium's fallback for a document it cannot display is to
download it.

**This entry is now expected to be half-fixed and is unverified.** It was
written when the download fallback was cancelled too, which is what made a PDF
link produce _nothing_; with downloads working, a PDF should now land in the
downloads folder instead of opening in a viewer. Nothing has confirmed that, and
it is the first thing to check by hand.

Displaying one inline is still **unbuilt**: `plugins: true` enables the viewer,
at the cost of admitting Chromium's PDF plugin into an untrusted view. Worth
deciding explicitly rather than inheriting.

### `window.open` flows break, and `target="_blank"` no longer does

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

The practical consequence is that **"Sign in with …" does not work**, on a
browser whose whole point is to be the user's real logged-in session. Fixing it
means letting some popups be real child windows with a live opener, which is a
security decision about untrusted pages rather than a UI one — the popup policy
and the rate limiter exist for reasons that survive this.

### Absent handlers

Each of these is a documented Electron event with no listener anywhere in
`apps/desktop/src`. All **unbuilt**, none deliberate as far as the tree records.

| What the user does                           | Event nobody handles                                | Result today                                               |
| -------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Loads a page behind HTTP basic auth          | `login`                                             | Electron cancels the auth; the page just fails             |
| Reaches a self-signed or expired certificate | `certificate-error`                                 | Generic load-error screen, no "Advanced → proceed" path    |
| Clicks a video's fullscreen button           | `enter-html-full-screen` / `leave-html-full-screen` | The page believes it is fullscreen; the view never resizes |
| Sits on a page whose renderer dies or hangs  | `render-process-gone` / `unresponsive`              | Blank view, no "Aw, snap", no reload affordance            |
| Hits a site asking for a client certificate  | `select-client-certificate`                         | No prompt                                                  |

`did-fail-load` **is** handled and drives the error screen
(`desktop-browser-view.ts:2385`), which is what makes the rest of this table
look like an oversight rather than a policy: the machinery for telling the user
something went wrong already exists and these paths do not reach it.

## Tier 2 — unbuilt surfaces

Standard browser functionality with no code behind it. Nothing here is decided
against; it is simply not written.

**Page**

| Feature                           | State                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find in page (`Cmd+F`)            | No `findInPage` call anywhere in the repo                                                                                                                              |
| Zoom (`Cmd +/-/0`), per-site zoom | `setZoomFactor` exists only for the app window, never for a browsed view                                                                                               |
| Print (`Cmd+P`)                   | `printToPDF` exists for agents only; no user-facing print                                                                                                              |
| Page context menu                 | Cut / copy / paste / select-all only (`desktop-browser-view.ts`). No open-link-in-new-tab, copy link address, save image, back/forward/reload, or search-for-selection |
| View source                       | None                                                                                                                                                                   |
| Spellcheck corrections            | Underlining is Chromium's default; the browsed view's menu offers no suggestions                                                                                       |

The context menu is the highest-value item in that table and the smallest: the
menu is already built in the shell, and link and image entries would route
through the same open-tab path popups now use.

**Tabs**

No tab context menu, no drag reorder, no pin / duplicate / mute, and no
reopen-closed-tab — `browser-surface-tabs.ts` keeps no closed-tab stack, so the
information needed for `Cmd+Shift+T` is discarded at close. Tab overflow is
covered: the strip clips at a width floor rather than scrolling, which is a
[decided](browser-surface.md) trade rather than a gap.

**Keyboard**

Exactly two browser-scoped bindings exist
(`apps/server/src/services/system/app-keybindings.ts:225`):
`browser.focusLocation` (`Cmd+L`) and `browser.reload` (`Cmd+R`). Missing:
`Cmd+T`, `Cmd+W`, `Cmd+Shift+T`, `Cmd+1..9`, `Ctrl+Tab`, `Cmd+[` / `Cmd+]`,
`Cmd+F`, `Cmd+P`, and the zoom trio.

`Cmd+T` and `Cmd+W` are worth naming separately, because they are not absent —
they are **bound to something else**. Both are panel commands
(`panel.newTab`, `panel.close`, lines 171–172) scoped to `mainWithoutModal`
rather than `browserFocus`, so on `/browser` they do not open or close a browser
tab, and inside a focused page they are not even forwarded.

The forwarding path itself is finished and generic: a key pressed in an
untrusted page reaches `before-input-event`
(`desktop-browser-view.ts:2238`), is resolved against the keybinding table by
`resolveDesktopBrowserAppCommand`, and is dispatched to the renderer as an app
command. So this whole row is table entries plus handlers — the cheapest large
improvement available.

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
   deferred with a comment. The comments are still accurate and the decisions
   have simply not been scheduled since.
3. **The shell is finished where the renderer is not.** Keyboard forwarding, the
   context menu, favicons and page reads all have complete main-process support;
   what is missing is the command table, the menu entries, the UI. That
   asymmetry is why the keyboard and context-menu items are cheap and the
   downloads and popup items are not.

## Ordering

By value against cost, not by tier:

1. **Keyboard set** — the mechanism is done; this is bindings and handlers.
2. **Page context menu link/image entries** — the menu exists; the open-tab path
   exists.
3. **Find in page** — self-contained: `findInPage` / `stopFindInPage`, a new IPC
   channel (invariant 2: new channel, optional method), a small chrome overlay.
4. **The absent Tier 1 handlers** — each is small on its own; certificates and
   basic auth need a dialog, and [browser-automation.md](browser-automation.md)'s
   `BrowserPageDialog` is the pattern to copy.
5. **PDF** — one preference, one security question.
6. ~~**Downloads**~~ — done; the manager UI it deliberately left out is in
   [browser-downloads.md](browser-downloads.md)'s Next section.
7. **Popups with a live opener** — the most valuable and the most dangerous;
   it reopens the popup policy deliberately rather than by accident.

History's 24-entry cap sits outside this list: it is cheap to raise and it
changes what the omnibox can do, so it belongs with whatever omnibox work comes
next rather than with browser features.

## Not verified

Everything with a file and line reference above was read at `63cc4fccf`, and
every "no such code" claim is a grep over `apps/desktop/src` and `apps/app/src`.
What is **inferred from code rather than observed in a running browser**, and
should be confirmed by hand before anyone plans around it:

- that a PDF link produces nothing (the `plugins`-off → download → cancelled
  chain);
- the exact failure mode of an OAuth popup, which differs per SDK;
- the multi-window behaviour described above;
- that `<input type="file">` still opens Chromium's native picker, and that
  dragging a file into a page works — neither is blocked by anything found here,
  and neither was exercised.

The shortest way to check the first three is the same one the automation plan
uses: `bun run dev` plus `bun run dev:desktop`, then `/browser` in the desktop
app.
