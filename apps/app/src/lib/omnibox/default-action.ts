import { resolveBrowserAddressInput } from "@/lib/browser-url";
import type { OmniboxAction } from "./types";

/**
 * The score reserved for the default action. Exactly one of the navigation and
 * search providers claims it for any given query, so the top row always agrees
 * with what Enter does. Every other provider stays below it.
 */
export const OMNIBOX_DEFAULT_ACTION_SCORE = 1;

/**
 * What Enter does with no row explicitly selected: navigate to the typed
 * address, or search for the typed text. Null for blank input.
 *
 * Resolved synchronously from the query — never from the suggestion list — so
 * pressing Enter before the debounce elapses does the same thing as pressing it
 * after. A default read off the list would depend on whether providers had
 * answered yet, which is the kind of timing-dependent behaviour a user
 * experiences as the address bar losing keystrokes.
 */
export function resolveOmniboxDefaultAction(
  query: string,
): OmniboxAction | null {
  const url = resolveBrowserAddressInput(query);
  return url === null ? null : { type: "navigate", url };
}
