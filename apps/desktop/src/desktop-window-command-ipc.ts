// Main-window commands that are initiated by native desktop chrome and handled
// by the trusted React renderer.

export const BB_DESKTOP_OPEN_NEW_TAB_CHANNEL = "bb-desktop:open-new-tab";
export const BB_DESKTOP_APP_COMMAND_CHANNEL = "bb-desktop:app-command";
export const BB_DESKTOP_GET_WINDOW_STATE_CHANNEL =
  "bb-desktop:get-window-state";
export const BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL =
  "bb-desktop:window-state-changed";
/**
 * The renderer asking for its own window to close — the other direction from
 * the request/response pair below, which is the shell asking the renderer
 * whether it may. Sent when the surface runs out of tabs: a browser window with
 * nothing open is a window with nothing to show.
 */
export const BB_DESKTOP_CLOSE_WINDOW_CHANNEL = "bb-desktop:close-window";
export const BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL =
  "bb-desktop:close-window-request";
export const BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL =
  "bb-desktop:close-window-response";
// How long main waits for the renderer to answer a close request before
// closing the window itself, so a crashed, hung, or still-loading renderer
// cannot make Cmd+W inert.
export const CLOSE_WINDOW_REQUEST_TIMEOUT_MS = 1000;
