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
