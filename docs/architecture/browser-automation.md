# Browser Automation — plan

Target: everything the [Playwright Agent CLI](https://playwright.dev/agent-cli/introduction)
exposes to an agent, **minus its Testing group**, driving the user's real browser
surface instead of a headless instance.

Where this started is [agent-browser-tools.md](agent-browser-tools.md): 12 tools
covering navigation, tab bookkeeping and reading page text, plus `bb browser` as
a terminal path onto the same API — roughly PW's `goto` / `go-back` /
`go-forward` / `reload` / `tab-*` and half of `snapshot`, with **no interaction
at all**. Stages A and B closed that: an agent can now snapshot a page, address
its elements, and act on them.

## Two decisions that shape everything else

### 1. CDP is the backbone

Phase 5 read pages by injecting a constant script into an isolated world. That
was right for `innerText`. It does not survive contact with the rest of the
list, and the reason is not effort — it is that the hard parts are already
solved behind `webContents.debugger`:

| What we need | Hand-rolled | Via CDP |
| --- | --- | --- |
| Accessibility tree with stable refs | reimplement accessible-name computation (the accname spec) | `Accessibility.getFullAXTree` |
| Accept/dismiss a JS dialog | **impossible** — Electron only offers `disableDialogs` (suppress, no result) | `Page.javascriptDialogOpening` + `Page.handleJavaScriptDialog` |
| Mock a response body | `webRequest` can block but cannot supply a body | `Fetch.enable` + `Fetch.fulfillRequest` |
| File input upload | no Electron API | `DOM.setFileInputFiles` |
| Viewport control without fighting the surface layout | — | `Emulation.setDeviceMetricsOverride` |
| Console + network observation | partial (`webRequest` sees no bodies) | `Runtime`/`Log`/`Network` events |

PW itself is a CDP client; matching it without CDP means rewriting the parts of
Chromium's protocol that make it possible. Verified present in Electron 41.7.0:
`webContents.debugger.attach(protocolVersion)`.

Electron natively covers a few things more cheaply, and those stay native:
`capturePage()` (screenshot, already used for resize placeholders),
`printToPDF()` (PDF), `session.cookies` (cookies), `sendInputEvent()` (trusted
input — an alternative to `Input.dispatchMouseEvent`, both give `isTrusted:
true`; `element.click()` in an isolated world does not, and sites reject it).

Caveats to design around rather than discover:

- **One CDP client per `webContents`.** Attaching conflicts with DevTools on that
  view. Browsed views already deny DevTools, so this is compatible — but it must
  be enforced, not assumed.
- **Attach lazily, detach on teardown.** A debugger attached to every tab for the
  session's lifetime is both overhead and exposure. Attach on first automation
  command for a tab; detach with the view.
- **Handle the `detach` event.** A renderer crash drops the session silently and
  every later command would fail opaquely.
- **No visible indicator.** Unlike Chrome, Electron shows no "DevTools is
  debugging this browser" banner. Whatever we surface in the UI is the only
  signal the user gets.

### 2. The CLI is the primary surface, not 70 agent tools

PW Agent CLI exposes ~70 commands and it is *a CLI*, not 70 tool definitions —
deliberately, for token efficiency, with `install --skills` teaching the agent
what exists. That is the right answer for us too, and we already have the shape:
`bb browser`.

So the long tail lands in `bb browser <command>`, and the registered agent tools
stay a small curated set — the ones worth the tool-slot cost because they are
used constantly and their results need structure:

```
browser_snapshot        browser_click       browser_fill
browser_navigate        browser_press       browser_screenshot
browser_tabs_*          browser_page_get_text
```

Everything else (cookies, storage, routes, tracing, video, PDF, vision) is
reachable as `bb browser …`. bb agents run with shell access, so this costs them
nothing, and it keeps the provider's tool list from ballooning past the point
where models pick well.

Corollary: a dedicated skill teaching `bb browser` becomes worth writing — our
equivalent of `install --skills`.

## Scope map

| PW group | Plan | Mechanism |
| --- | --- | --- |
| Core — navigation | done | existing |
| Core — `snapshot` | **Stage A** | `Accessibility.getFullAXTree` |
| Core — dialogs | **Stage A** (also a live bug) | `Page.javascriptDialogOpening` / `handleJavaScriptDialog` |
| Core — click/fill/type/select/check/hover/drag/upload/press | done | `Input.*`, `DOM.setFileInputFiles` |
| Core — `resize` | done | `Emulation.setDeviceMetricsOverride` |
| Core — `screenshot` | Stage C | `capturePage()` |
| PDF | Stage C | `printToPDF()` |
| DevTools — `console` | Stage C | `Runtime.consoleAPICalled`, `Log.entryAdded` |
| Network — observe | Stage C | `Network.*` events |
| Storage — cookies / localStorage / sessionStorage / state-save/load | **Stage D** | `session.cookies`, `DOMStorage`, composed |
| Network — `route` / `unroute` / offline | **Stage E** | `Fetch.enable` + `fulfillRequest`, `Network.emulateNetworkConditions` |
| Vision — mousemove/down/up/wheel | Stage E | `Input.dispatchMouseEvent` by coordinate |
| Core — `eval` / `run-code` | Stage E | `Runtime.evaluate` |
| DevTools — tracing | Stage F | our own action log (see below) |
| DevTools — video | Stage F | `Page.startScreencast` → encode |
| Sessions (`-s`, `--profile`, `--persistent`) | **n/a** | PW runs separate browsers; ours is the user's one browser, and tabs are the unit |
| Testing (assertions, locator generation) | **out** | we are not a test runner |

## Stages

Each stage is independently useful and independently verifiable; the build stays
runnable throughout (plan §21 rule 10).

### Stage A — the primitive everything else needs

Without addressable elements there is no interaction: `innerText` cannot say
"click *this* button", and asking a model for CSS selectors is the brittle path
PW exists to avoid.

**Done:**

- **CDP session manager** (`desktop-browser-cdp.ts`) — lazy per-`webContents`
  attach, command dispatch, event fan-out, domain enablement deduplicated across
  concurrent callers, `detach` recovery, and a named refusal when another client
  (DevTools) holds the target.
- **`browser_snapshot`** (`desktop-browser-snapshot.ts`) —
  `Accessibility.getFullAXTree` reduced to PW's compact form, refs on interactive
  nodes only, state worth acting on (`[checked]`, `[collapsed]`, `[disabled]`),
  node/length/depth caps that report truncation. Reachable as an agent tool, as
  `bb.browser.page.snapshot`, and as `bb browser snapshot`.
- **Ref lifetime** — refs map to `backendNodeId`, invalidated on navigation and
  on same-document navigation, with a `generation` carried in the result so a
  later interaction command can be refused rather than resolved against whatever
  holds that node id now.

- **Dialogs**, with the app drawing its own. `Page.javascriptDialogOpening` →
  the shell records the dialog, captures the frozen page as a bitmap, hides the
  native view and pushes the dialog to the renderer;
  `BrowserPageDialog` draws over the placeholder; answering goes back through
  `Page.handleJavaScriptDialog` and the view returns. Agents answer the same
  dialog through `browser_handle_dialog` / `bb browser dialog`.

**Still open in this stage:**

- **Selector-scoped snapshots.** `maxDepth` is in; scoping to a CSS selector
  needs `DOM.querySelector` + `Accessibility.getPartialAXTree`, whose result
  shape differs. It is an optimization for large pages, not a capability, so it
  waits.

Done when: an agent can snapshot a real page and refer to its elements. ✅

### Stage B — interaction

**Done.**

- **Actionability** (`desktop-browser-actions.ts`) — the substantial part, as
  expected. One probe run in an isolated world answers attached / visible /
  settled / enabled / not-covered in a single round trip and returns the point to
  act at; the manager polls it until it passes or a 5s deadline expires, then
  reports *why* it never did. Stability is two `requestAnimationFrame`s and a box
  comparison; "not covered" is a hit test at the point about to be clicked, which
  is the check that catches the fading-out modal backdrop. The blocked reasons
  are separate because each implies a different fix — `covered` means dismiss
  something, `disabled` means fill something else first, `unstable` means wait.
- **One `interact` channel**, not one per verb. Every action shares the same
  preamble (resolve the ref, check the generation, wait for actionability), and a
  channel per verb would freeze nine copies of it across a wire-frozen boundary.
- `click` (with button, double, modifiers), `hover`, `drag` — trusted input at
  the probed point. A double click is press/release at count 1 then at count 2,
  because one event claiming `clickCount: 2` is not a double click to Chromium.
- `fill` — select the old value, then `Input.insertText`. Clearing is a Delete
  keystroke, since inserting an empty string inserts nothing.
- `type` — one key event per character, which is the whole difference from
  `fill`: autocompletes and input masks react to keystrokes, not to a value
  appearing.
- `press` — a small key table (`desktop-browser-keyboard.ts`) rather than
  Playwright's full HID map. Each event carries `key`, `code`,
  `windowsVirtualKeyCode` and `text`, because different consumers inside a page
  read different ones, and a key that inserts nothing uses `rawKeyDown`. An
  unknown key name is refused by name — pressing the wrong key on a live page is
  a side effect, so guessing is not an option.
- `select`, `check`/`uncheck` — semantic. Not a stylistic preference: a native
  `<select>` opens an OS-drawn popup no synthetic mouse event can reach, and
  "click the checkbox" is a toggle where an agent wants a known end state.
  Check/uncheck read the state first, click only if it differs, and confirm
  afterwards, because a controlled component can refuse.
- `upload` — `DOM.setFileInputFiles`, with no actionability wait: a styled upload
  control almost always hides the real `<input type=file>`.
- `resize` — `Emulation.setDeviceMetricsOverride`, with `0 0` clearing it. Device
  metrics rather than the view's bounds, which the renderer's layout owns.

Three registered agent tools (`browser_click`, `browser_fill`, `browser_press`),
the rest as `bb browser click|hover|drag|type|select|check|uncheck|upload|resize`
— the split the CLI decision above calls for. The instructions block tells the
model the CLI exists, since a tool it cannot see is a tool it will not use.

Done when: an agent can fill and submit a real form. ✅ (against fakes; see the
live-verification note at the end)

#### Ref lifetime, and the check that is deliberately optional

Interactions carry the `generation` of the snapshot their refs came from, and the
shell refuses a mismatch. It is **optional**, and the reasoning is worth keeping:
navigation already drops every ref, so acting on an element that no longer exists
fails either way (`unknown-ref`). What the generation adds is protection against
a *newer* snapshot having reassigned `e5` to a different element between the
caller reading it and acting on it — narrow, but silent when it bites.

So it is offered everywhere (the snapshot prints it, the tools take it, the CLI
has `--generation`) and required nowhere. Threading a value through every call
for a narrow race is ceremony a model pays for on every action; refusing to offer
it at all would be pretending the race does not exist.

### Stage C — observation

Cheap, high value, no new risk: `screenshot`, `pdf`, `console`, network request
listing (a bounded ring buffer per tab).

### Stage D — storage and state

Cookies, localStorage, sessionStorage, `state-save` / `state-load`.

Worth stating plainly in the tool descriptions and the skill: in a browser
holding the user's live logins, this group **is** credential access — `state-save`
on a logged-in session produces a file that is that session. PW's threat model is
a browser it created for a test; ours is not.

### Stage E — interception, vision, eval

- `route` / `route-list` / `unroute`, offline emulation.
- Vision-mode coordinate mouse commands (canvas, maps, WebGL — where the
  accessibility tree genuinely has nothing).
- `eval` / `run-code`.

This stage is where an agent gains capabilities the user cannot easily bound:
arbitrary JS in a page holding live credentials, and the ability to rewrite what
that page receives from the network. It is in scope by decision; it should land
last within the interactive set, behind its own review, and the doc should not
soften what it is.

### Stage F — recording

- **Tracing** means our own artifact, not PW's: PW traces are a bespoke format
  read by PW's viewer. Ours is an action log — command, snapshot, screenshot per
  step — which is what makes an agent's browser session reviewable after the
  fact.
- **Video** — `Page.startScreencast` frames encoded to webm.

### How the dialog UI works, and why it looks like that

The app cannot draw over a live page — a `WebContentsView` composites above the
DOM — so the sequence is: capture the frozen page, **hide the view**, push the
dialog, and draw the modal over the captured bitmap in the panel where the page
was. That is the resize-burst machinery reused wholesale; the placeholder `<img>`
and the hide/reveal ordering already existed for exactly this shape of problem.

Two consequences worth keeping in mind while extending it:

- **The modal must render after the placeholder.** They are absolutely
  positioned siblings, so DOM order decides which one is on top.
- **The view must come back on every path out**, including a
  `Page.handleJavaScriptDialog` that throws because the page died mid-answer.
  Losing a dialog is recoverable; leaving the user's browser view permanently
  hidden is not.

`alert()` gets no Cancel button, because `alert()` offers no such choice; Escape
dismisses everything else. The message is page-authored, so it renders as text.

## The dialog bug Stage A fixed

Before Stage A, `apps/desktop/src/desktop-browser-view.ts` handled JavaScript
dialogs **not at all**: no `disableDialogs`, no interception. Electron's default
is a native modal owned by the app window, so a page calling `alert()` or
`confirm()` blocked the whole BB window rather than only itself — and **an agent
had no way to answer it**. The user could click its buttons; the automation path
could not, so a dialog stopped an agent dead.

That was a live defect, not only a missing PW feature: reachable by any page,
independent of the automation work, which is why dialog handling sat in Stage A
rather than with the rest of the Core group.

Taking dialogs over via CDP has a consequence worth deciding deliberately rather
than discovering: once the `Page` domain is enabled on a view, Chromium routes
its dialogs to the protocol client and stops showing the native modal. So
whatever we do with them becomes what a **human** using that tab sees too, and
React cannot simply draw a replacement over the page — a `WebContentsView`
composites above the DOM (the same constraint that forces the omnibox list to
take layout space). Attaching CDP lazily, per tab, on first automation command
is what keeps ordinary browsing on the native path.

## What Stages A and B are and are not verified against

Covered by tests: the key table and chord parsing, including the one genuinely
ambiguous case (`"Shift++"` is the plus key, `"Shift+"` is nothing); the probe
parsers, where an unusable answer has to be told apart from "not ready yet"
because only the second is worth retrying; ref resolution reaching CDP as the
backend node id the snapshot recorded; a stale generation and an unknown ref both
refusing **before** anything is dispatched; the actionability wait giving up with
its reason; each action's CDP call sequence; and the interaction union parsing
identically on both wires, which is the only mechanical guard on the "must not
drift" claim those two schemas make about each other.

**Not verified against a real browser.** Everything above runs against a fake
`webContents.debugger`, so what no test here proves is that Chromium behaves as
documented:

- that enabling the `Page` domain moves dialogs off the native path (the
  assumption the whole dialog UI rests on);
- that `Accessibility.getFullAXTree` shapes real pages the way the builder
  expects;
- that `Page.createIsolatedWorld` + `DOM.resolveNode` reach the element, and that
  trusted input at the probed point lands on it.

The shortest way to find out, in order:

```bash
bun run dev            # and, in another shell, bun run dev:desktop
bun run bb:dev plugin enable browser-tools
# open /browser in the desktop app and load a page with a form, then:
bun run bb:dev browser snapshot        # refs, and the generation on stderr
bun run bb:dev browser fill e2 hello
bun run bb:dev browser click e1
# then, from the page's own console: alert("hi") — whose modal appears?
```

## Capability grouping

PW organises its commands into seven groups and then states plainly that in the
CLI all of them are always on. We should keep the grouping (Core / Network /
Storage / Vision / DevTools / PDF) as the shape of the docs and the CLI's help,
because it is also the natural seam if per-plugin permissions ever arrive
(PROJECT_PLAN §9, still unbuilt). Today the gate remains what it is: the
`browser-tools` plugin ships disabled, and enabling it hands an agent the user's
browser.

## Sizing

Stage A + B together came out comparable in size to all of Phase 5, as expected,
and the actionability checks were indeed the body of work — they are what
separates automation that works from automation that flakes. C is small. D and E
are moderate and mostly plumbing over CDP. F is the largest per unit of value and
should stay last.

## Upload, and what it does not add

`upload` hands a web page the contents of local files by absolute path, which
reads like an exfiltration primitive and deserves saying out loud. In bb's threat
model it is not a new one: an agent with these tools already has shell access and
could `curl` the same file to the same host. What it adds is a path where the
agent never sees the bytes it moved.

The honest framing is therefore the same as the rest of this plugin — the gate is
the plugin toggle, and enabling it hands an agent the user's browser. It is not a
reason to leave `upload` out, and it is not something to soften.
