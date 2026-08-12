import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  omniboxSuggestionKey,
  type OmniboxSuggestion,
  type OmniboxSuggestionKind,
} from "@/lib/omnibox";

export interface BrowserOmniboxSuggestionsProps {
  /** `-1` means no row is selected, so Enter runs the default action. */
  highlightedIndex: number;
  listboxId: string;
  onHighlight: (index: number) => void;
  onSelect: (suggestion: OmniboxSuggestion) => void;
  optionId: (index: number) => string;
  suggestions: readonly OmniboxSuggestion[];
}

interface SuggestionKindPresentation {
  icon: IconName;
  label: string;
}

/**
 * Every row states which source produced it. That attribution is the point of
 * the omnibox rather than decoration: once plugins contribute suggestions, a
 * user must be able to see that a row came from a plugin and not from the
 * browser's own search.
 */
const SUGGESTION_KIND_PRESENTATION: Record<
  OmniboxSuggestionKind,
  SuggestionKindPresentation
> = {
  history: { icon: "Clock", label: "History" },
  navigate: { icon: "Globe", label: "Go" },
  // A plugin row's real source is its own label; this is only the fallback for
  // a provider that somehow contributed none.
  plugin: { icon: "Puzzle", label: "Plugin" },
  search: { icon: "Search", label: "Search" },
  tab: { icon: "Browser", label: "Tab" },
};

export function BrowserOmniboxSuggestions({
  highlightedIndex,
  listboxId,
  onHighlight,
  onSelect,
  optionId,
  suggestions,
}: BrowserOmniboxSuggestionsProps) {
  return (
    <ul
      // Part of the chrome's own layout rather than an overlay: a native
      // `WebContentsView` composites above the DOM, so anything drawn over the
      // page area would be invisible in the desktop app. See
      // docs/architecture/browser-surface.md.
      className="max-h-[45vh] shrink-0 overflow-y-auto border-b border-border bg-sidebar px-1 pb-1"
      id={listboxId}
      role="listbox"
      aria-label="Address and search suggestions"
    >
      {suggestions.map((suggestion, index) => {
        const presentation = SUGGESTION_KIND_PRESENTATION[suggestion.kind];
        const isHighlighted = index === highlightedIndex;
        return (
          <li key={omniboxSuggestionKey(suggestion)}>
            <button
              type="button"
              id={optionId(index)}
              role="option"
              aria-selected={isHighlighted}
              // Keep focus in the input: a blur would tear the list down before
              // the click landed.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                onHighlight(index);
              }}
              onClick={() => {
                onSelect(suggestion);
              }}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                isHighlighted
                  ? "bg-state-hover text-foreground"
                  : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              )}
            >
              <span className="flex w-14 shrink-0 items-center gap-1.5 text-subtle-foreground">
                <Icon name={presentation.icon} aria-hidden />
                <span className="truncate">
                  {suggestion.sourceLabel ?? presentation.label}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {suggestion.title}
              </span>
              {suggestion.subtitle === null ? null : (
                <span className="min-w-0 truncate font-mono text-muted-foreground [flex-shrink:9999]">
                  {suggestion.subtitle}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
