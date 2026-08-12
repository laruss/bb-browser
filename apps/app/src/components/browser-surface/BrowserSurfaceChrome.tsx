import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { BbDesktopBrowserState } from "@bb/desktop-contract";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { runPluginOmniboxAction } from "@/hooks/queries/plugin-contribution-queries";
import { getBbDesktopInfo, getDesktopBrowserApi } from "@/lib/bb-desktop";
import { getBrowserUrlSecurity } from "@/lib/browser-url";
import {
  nextOmniboxHighlight,
  resolveOmniboxDefaultAction,
  useOmnibox,
  type OmniboxAction,
  type OmniboxProvider,
  type OmniboxSuggestion,
} from "@/lib/omnibox";
import { BrowserOmniboxSuggestions } from "./BrowserOmniboxSuggestions";

export interface BrowserSurfaceChromeProps {
  /** Tab switches are surface state, so the surface performs them. */
  onActivateTab: (tabId: string) => void;
  providers: readonly OmniboxProvider[];
  /** The active tab, whose native view this chrome drives. */
  tabId: string;
  url: string;
}

/**
 * The selected row, tagged with the query it belongs to. Tagging rather than
 * resetting on change: providers settle one at a time for a single query, so the
 * selection has to survive re-ranking within a query while never carrying over
 * to the next one.
 */
interface OmniboxHighlight {
  index: number;
  query: string;
}

const NO_OMNIBOX_HIGHLIGHT: OmniboxHighlight = { index: -1, query: "" };

interface ChromeButtonProps {
  disabled?: boolean;
  icon: "ChevronLeft" | "ChevronRight" | "RotateCcw" | "X" | "ExternalLink";
  label: string;
  onClick: () => void;
}

const OMNIBOX_LISTBOX_ID = "browser-omnibox-suggestions";

function omniboxOptionId(index: number): string {
  return `browser-omnibox-option-${index}`;
}

function ChromeButton({ disabled, icon, label, onClick }: ChromeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center justify-center transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
        CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
      )}
    >
      <Icon name={icon} aria-hidden />
    </button>
  );
}

/**
 * The browser surface's own navigation chrome, replacing the address bar that
 * `BrowserTabContent` renders for the thread panel (which is why the surface
 * passes `showChrome={false}` to the deck).
 *
 * The address input is an omnibox: it collects suggestions from providers while
 * the user types, and only the providers know where suggestions come from —
 * which is what lets a plugin add a source later without this component
 * changing.
 *
 * Navigation state is read straight from the native view's own event stream
 * rather than lifted out of `BrowserTabContent`, so a navigation re-renders this
 * strip alone and not the deck below it.
 */
export function BrowserSurfaceChrome({
  onActivateTab,
  providers,
  tabId,
  url,
}: BrowserSurfaceChromeProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const locationShortcut = useAppCommandShortcut("browser.focusLocation");
  const [pushedState, setPushedState] = useState<BbDesktopBrowserState | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [highlight, setHighlight] = useState(NO_OMNIBOX_HIGHLIGHT);
  const omnibox = useOmnibox({ providers });

  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    return desktopBrowser.onState((next) => {
      if (next.tabId === tabId) {
        setPushedState(next);
      }
    });
  }, [desktopBrowser, tabId]);

  // Only state belonging to the current tab counts. Derived rather than reset on
  // tab change, so the newly activated tab's controls start neutral instead of
  // briefly describing the page the user just left.
  const navigationState = pushedState?.tabId === tabId ? pushedState : null;

  const suggestions = omnibox.suggestions;
  const highlightedIndex =
    highlight.query === omnibox.query ? highlight.index : -1;
  const highlightedSuggestion: OmniboxSuggestion | null =
    highlightedIndex < 0 ? null : (suggestions[highlightedIndex] ?? null);

  const highlightRow = useCallback(
    (index: number) => {
      setHighlight({ index, query: omnibox.query });
    },
    [omnibox.query],
  );

  const closeOmnibox = useCallback(() => {
    omnibox.clear();
    setHighlight(NO_OMNIBOX_HIGHLIGHT);
    setIsEditing(false);
  }, [omnibox]);

  const runAction = useCallback(
    (action: OmniboxAction) => {
      switch (action.type) {
        case "navigate":
          desktopBrowser?.navigate({ tabId, url: action.url });
          break;
        case "activate-tab":
          onActivateTab(action.tabId);
          break;
        case "plugin-run":
          // The plugin's action runs server-side and may take a moment; the
          // omnibox closes now and the tab navigates only if the plugin asks
          // for it. A failed action leaves the tab where it was rather than
          // sending it somewhere arbitrary.
          void runPluginOmniboxAction({
            itemId: action.itemId,
            pluginId: action.pluginId,
            query: action.query,
          }).then((url) => {
            if (url !== null) {
              desktopBrowser?.navigate({ tabId, url });
            }
          });
          break;
      }
      closeOmnibox();
      // Hand the keyboard back: the page, not the address bar, is what the user
      // just asked for.
      inputRef.current?.blur();
    },
    [closeOmnibox, desktopBrowser, onActivateTab, tabId],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const action =
        highlightedSuggestion?.action ?? resolveOmniboxDefaultAction(draft);
      if (action === null) {
        return;
      }
      runAction(action);
    },
    [draft, highlightedSuggestion, runAction],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        setDraft(url);
        closeOmnibox();
        inputRef.current?.blur();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      if (suggestions.length === 0) {
        return;
      }
      // Otherwise the caret jumps to the start/end of the input instead.
      event.preventDefault();
      highlightRow(
        nextOmniboxHighlight({
          count: suggestions.length,
          current: highlightedIndex,
          step: event.key === "ArrowDown" ? 1 : -1,
        }),
      );
    },
    [closeOmnibox, highlightRow, highlightedIndex, suggestions.length, url],
  );

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      omnibox.setQuery(value);
    },
    [omnibox],
  );

  const focusAddress = useCallback((): boolean => {
    if (desktopBrowser === null) {
      return false;
    }
    setDraft(url);
    setIsEditing(true);
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    return true;
  }, [desktopBrowser, url]);

  // Above `BrowserTabContent`'s handler: while this chrome is mounted, it owns
  // the address bar. (That one also declines when its own chrome is hidden.)
  useAppCommandHandler("browser.focusLocation", focusAddress, 200);

  if (desktopBrowser === null) {
    return null;
  }

  const isLoading = navigationState?.isLoading ?? false;
  const security = getBrowserUrlSecurity(url);
  const isOpen = isEditing && suggestions.length > 0;

  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-sidebar">
      <div className="flex h-11 items-center gap-1 px-2 py-1.5">
        <ChromeButton
          icon="ChevronLeft"
          label="Go back"
          disabled={!(navigationState?.canGoBack ?? false)}
          onClick={() => {
            desktopBrowser.goBack(tabId);
          }}
        />
        <ChromeButton
          icon="ChevronRight"
          label="Go forward"
          disabled={!(navigationState?.canGoForward ?? false)}
          onClick={() => {
            desktopBrowser.goForward(tabId);
          }}
        />
        <ChromeButton
          icon={isLoading ? "X" : "RotateCcw"}
          label={isLoading ? "Stop loading" : "Reload"}
          onClick={() => {
            if (isLoading) {
              desktopBrowser.stop(tabId);
              return;
            }
            desktopBrowser.reload(tabId);
          }}
        />
        <form onSubmit={handleSubmit} className="min-w-0 flex-1">
          <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3">
            <Icon
              name={
                security === "secure"
                  ? "Lock"
                  : security === "insecure"
                    ? "AlertTriangle"
                    : "Search"
              }
              className={cn(
                security === "secure" && "text-success",
                security === "insecure" && "text-warning",
                security === "none" && "text-muted-foreground",
              )}
              aria-label={
                security === "secure"
                  ? "Secure connection"
                  : security === "insecure"
                    ? "Connection not secure"
                    : undefined
              }
              aria-hidden={security === "none" ? true : undefined}
            />
            <input
              ref={inputRef}
              type="text"
              value={isEditing ? draft : url}
              onChange={(event) => {
                handleChange(event.target.value);
              }}
              onFocus={() => {
                setDraft(url);
                setIsEditing(true);
              }}
              onBlur={closeOmnibox}
              onKeyDown={handleKeyDown}
              placeholder="Search or enter address"
              role="combobox"
              aria-label={
                locationShortcut
                  ? `Address and search bar (${locationShortcut.label})`
                  : "Address and search bar"
              }
              aria-keyshortcuts={locationShortcut?.ariaKeyshortcuts}
              aria-expanded={isOpen}
              aria-controls={OMNIBOX_LISTBOX_ID}
              aria-activedescendant={
                highlightedIndex < 0
                  ? undefined
                  : omniboxOptionId(highlightedIndex)
              }
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
            />
          </div>
        </form>
        <ChromeButton
          icon="ExternalLink"
          label="Open in external browser"
          disabled={url.length === 0}
          onClick={() => {
            getBbDesktopInfo()?.openExternalUrl(url);
          }}
        />
      </div>
      {isOpen ? (
        <BrowserOmniboxSuggestions
          highlightedIndex={highlightedIndex}
          listboxId={OMNIBOX_LISTBOX_ID}
          onHighlight={highlightRow}
          onSelect={(suggestion) => {
            runAction(suggestion.action);
          }}
          optionId={omniboxOptionId}
          suggestions={suggestions}
        />
      ) : null}
    </div>
  );
}
