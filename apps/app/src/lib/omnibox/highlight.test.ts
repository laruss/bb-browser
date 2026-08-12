import { describe, expect, it } from "vitest";
import { nextOmniboxHighlight } from "./highlight";

describe("nextOmniboxHighlight", () => {
  it("enters the list from the typed text", () => {
    expect(nextOmniboxHighlight({ count: 3, current: -1, step: 1 })).toBe(0);
    expect(nextOmniboxHighlight({ count: 3, current: -1, step: -1 })).toBe(2);
  });

  it("walks the rows", () => {
    expect(nextOmniboxHighlight({ count: 3, current: 0, step: 1 })).toBe(1);
    expect(nextOmniboxHighlight({ count: 3, current: 2, step: -1 })).toBe(1);
  });

  // The typed text is a position in the cycle, so the default action is always
  // reachable without retyping.
  it("cycles back through the typed text at both ends", () => {
    expect(nextOmniboxHighlight({ count: 3, current: 2, step: 1 })).toBe(-1);
    expect(nextOmniboxHighlight({ count: 3, current: 0, step: -1 })).toBe(-1);
  });

  it("has nowhere to go with no rows", () => {
    expect(nextOmniboxHighlight({ count: 0, current: -1, step: 1 })).toBe(-1);
    expect(nextOmniboxHighlight({ count: 0, current: -1, step: -1 })).toBe(-1);
  });

  it("cycles a single row", () => {
    expect(nextOmniboxHighlight({ count: 1, current: -1, step: 1 })).toBe(0);
    expect(nextOmniboxHighlight({ count: 1, current: 0, step: 1 })).toBe(-1);
  });
});
