import { describe, expect, it } from "vitest";
import { rankOmniboxSuggestions } from "./rank";
import type { OmniboxAction, OmniboxSuggestion } from "./types";

interface RowArgs {
  action?: OmniboxAction;
  id: string;
  providerId: string;
  score: number;
}

function row({ action, id, providerId, score }: RowArgs): OmniboxSuggestion {
  return {
    action: action ?? { type: "navigate", url: `https://${id}.test/` },
    id,
    kind: "navigate",
    providerId,
    score,
    subtitle: null,
    title: id,
  };
}

function keys(suggestions: readonly OmniboxSuggestion[]): string[] {
  return suggestions.map((suggestion) => suggestion.id);
}

const LIMITS = { maxPerProvider: 4, maxSuggestions: 8 };

describe("rankOmniboxSuggestions", () => {
  it("orders by score across providers", () => {
    const ranked = rankOmniboxSuggestions({
      ...LIMITS,
      suggestions: [
        row({ id: "weak", providerId: "a", score: 0.2 }),
        row({ id: "strong", providerId: "b", score: 0.9 }),
        row({ id: "middle", providerId: "a", score: 0.5 }),
      ],
    });

    expect(keys(ranked)).toEqual(["strong", "middle", "weak"]);
  });

  // Equal scores must not reshuffle between emits for the same query, or rows
  // move under the user's cursor as a slower provider answers.
  it("breaks ties on provider order, not arrival order", () => {
    const suggestions = [
      row({ id: "first", providerId: "a", score: 0.5 }),
      row({ id: "second", providerId: "b", score: 0.5 }),
      row({ id: "third", providerId: "c", score: 0.5 }),
    ];

    expect(keys(rankOmniboxSuggestions({ ...LIMITS, suggestions }))).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("caps each provider before ranking, keeping its strongest rows", () => {
    const ranked = rankOmniboxSuggestions({
      maxPerProvider: 2,
      maxSuggestions: 8,
      suggestions: [
        row({ id: "flood-1", providerId: "noisy", score: 0.3 }),
        row({ id: "flood-2", providerId: "noisy", score: 0.9 }),
        row({ id: "flood-3", providerId: "noisy", score: 0.8 }),
        row({ id: "flood-4", providerId: "noisy", score: 0.7 }),
        row({ id: "quiet", providerId: "quiet", score: 0.5 }),
      ],
    });

    expect(keys(ranked)).toEqual(["flood-2", "flood-3", "quiet"]);
  });

  it("applies the overall cap after ranking", () => {
    const ranked = rankOmniboxSuggestions({
      maxPerProvider: 4,
      maxSuggestions: 2,
      suggestions: [
        row({ id: "a", providerId: "p", score: 0.1 }),
        row({ id: "b", providerId: "q", score: 0.9 }),
        row({ id: "c", providerId: "r", score: 0.5 }),
      ],
    });

    expect(keys(ranked)).toEqual(["b", "c"]);
  });

  // An open tab and a history entry for the same page is the common case, and
  // two rows that do the same thing is worse than one row fewer.
  it("collapses suggestions with the same action, keeping the strongest", () => {
    const action: OmniboxAction = {
      type: "navigate",
      url: "https://example.test/",
    };
    const ranked = rankOmniboxSuggestions({
      ...LIMITS,
      suggestions: [
        row({ action, id: "from-history", providerId: "history", score: 0.5 }),
        row({ action, id: "from-tabs", providerId: "open-tabs", score: 0.8 }),
        row({ id: "other", providerId: "history", score: 0.6 }),
      ],
    });

    expect(keys(ranked)).toEqual(["from-tabs", "other"]);
  });

  it("keeps rows that differ only by action type", () => {
    const ranked = rankOmniboxSuggestions({
      ...LIMITS,
      suggestions: [
        row({
          action: { type: "navigate", url: "https://example.test/" },
          id: "open",
          providerId: "history",
          score: 0.5,
        }),
        row({
          action: { type: "activate-tab", tabId: "tab-1" },
          id: "switch",
          providerId: "open-tabs",
          score: 0.4,
        }),
      ],
    });

    expect(keys(ranked)).toEqual(["open", "switch"]);
  });

  it("returns nothing for no input", () => {
    expect(rankOmniboxSuggestions({ ...LIMITS, suggestions: [] })).toEqual([]);
  });
});
