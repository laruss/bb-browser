// Channel names for the desktop-only web browser surface. Renderer → main
// commands drive a hardened, isolated `WebContentsView`; main → renderer pushes
// carry navigation state and popup-open requests. Mirrors the `bb-desktop:*`
// convention in `desktop-update-ipc.ts`.

export const BB_DESKTOP_BROWSER_ATTACH_CHANNEL = "bb-desktop:browser:attach";
export const BB_DESKTOP_BROWSER_DETACH_CHANNEL = "bb-desktop:browser:detach";
export const BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL =
  "bb-desktop:browser:navigate";
export const BB_DESKTOP_BROWSER_GO_BACK_CHANNEL = "bb-desktop:browser:go-back";
export const BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL =
  "bb-desktop:browser:go-forward";
export const BB_DESKTOP_BROWSER_RELOAD_CHANNEL = "bb-desktop:browser:reload";
export const BB_DESKTOP_BROWSER_STOP_CHANNEL = "bb-desktop:browser:stop";
export const BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL =
  "bb-desktop:browser:set-bounds";
export const BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL =
  "bb-desktop:browser:set-visible";
export const BB_DESKTOP_BROWSER_STATE_CHANNEL = "bb-desktop:browser:state";
export const BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL =
  "bb-desktop:browser:open-tab";
export const BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL =
  "bb-desktop:browser:scoped-open-tab";
export const BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL =
  "bb-desktop:browser:snapshot";
// Tab icons ride their own channel rather than a field on the wire-frozen state
// payload, so an older SPA's strict parser never sees a shape it would reject
// (invariant 2 in docs/architecture/bb-migration.md).
export const BB_DESKTOP_BROWSER_FAVICON_CHANNEL = "bb-desktop:browser:favicon";
// What a download did. Its own channel for the reason favicons got one, and one
// more: this is the only main -> renderer push that reports something the shell
// did to the user's filesystem, so it is worth seeing on its own name in a log.
export const BB_DESKTOP_BROWSER_DOWNLOAD_CHANNEL =
  "bb-desktop:browser:download";
// Opening a finished download, or showing it in the file manager. An invoke
// rather than a send because "the file is gone" is worth reporting, and its own
// channel because it is the only browser command that touches a path on disk
// instead of a tab.
export const BB_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL =
  "bb-desktop:browser:download-action";
// The app is drawing over the page area, so the page has to become a bitmap the
// app can draw on. Its own channel rather than a flag on `set-visible`: that
// one is the renderer's layout intent, while this one is a freeze the shell has
// to sequence (capture, then hide) and undo in the right order.
export const BB_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL =
  "bb-desktop:browser:set-overlay";
// The browser channels that answer. Reads are request/response, so these are
// `invoke`/`handle` pairs rather than `send`; each is a new channel behind an
// optional preload method for the same reason favicons were (invariant 2 in
// docs/architecture/bb-migration.md).
export const BB_DESKTOP_BROWSER_READ_PAGE_CHANNEL =
  "bb-desktop:browser:read-page";
// Named `snapshot-tree` because `BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL` above is
// already taken by the resize bitmap — different sense of the word, and the two
// must not be confused at a call site.
export const BB_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL =
  "bb-desktop:browser:snapshot-tree";
// Dialogs, once the shell owns them: a main -> renderer push carrying the open
// dialog (or null when it closes), and an invoke channel to answer it.
export const BB_DESKTOP_BROWSER_DIALOG_CHANNEL = "bb-desktop:browser:dialog";
export const BB_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL =
  "bb-desktop:browser:dialog-respond";
// Acting on the page. One channel for every verb, because they share the whole
// preamble (resolve a ref, check the snapshot generation, wait for the element
// to be actionable) and a channel per verb would freeze nine copies of it.
export const BB_DESKTOP_BROWSER_INTERACT_CHANNEL =
  "bb-desktop:browser:interact";
// Looking at the page without touching it: screenshot, PDF, console log,
// network log. One channel for the same reason `interact` is one, and the only
// automation channel that never attaches the browser debugger.
export const BB_DESKTOP_BROWSER_OBSERVE_CHANNEL =
  "bb-desktop:browser:observe";
// Cookies and web storage, read and written. Kept off the observe channel even
// though it attaches no debugger either: what crosses this one is the user's
// logins rather than what a page rendered, and that is worth being able to see
// in a stack trace and in a log without decoding a payload first.
export const BB_DESKTOP_BROWSER_STORAGE_CHANNEL =
  "bb-desktop:browser:storage";
// Driving a tab past the paths that make the rest of this safe: the caller's own
// JavaScript in the page, input at raw coordinates, a mocked network. Its own
// channel because what these have in common is how much they hand over, which is
// also the line per-plugin permissions would one day be drawn along.
export const BB_DESKTOP_BROWSER_CONTROL_CHANNEL =
  "bb-desktop:browser:control";
// The accessibility snapshot of one part of a page. Its own channel because the
// unscoped snapshot's request is strict and frozen: a `selector` added to it
// would be refused by every shell that predates this, and refused as "no view",
// which is advice about the wrong problem.
export const BB_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL =
  "bb-desktop:browser:snapshot-in";
// A picture of the whole document. Its own channel because the observe request
// carries a frozen union: a `fullPage` flag added to its screenshot member would
// be silently dropped by an older shell, which would answer with a viewport
// picture and call it a success. It is also the one capture that attaches the
// debugger, which is the property the observe channel exists to guarantee.
export const BB_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL =
  "bb-desktop:browser:capture-full-page";
// Filming a tab. Its own channel because it is the only automation command whose
// answer is an artifact rather than a fact about the page — megabytes of frames,
// bounded by the recording's own caps rather than by a single result's.
export const BB_DESKTOP_BROWSER_RECORD_CHANNEL = "bb-desktop:browser:record";
