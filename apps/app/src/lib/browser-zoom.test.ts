import { describe, expect, it } from "vitest";
import {
  BROWSER_ZOOM_FACTORS,
  clampBrowserZoomFactor,
  stepBrowserZoomFactor,
} from "./browser-zoom";

describe("browser zoom steps", () => {
  it("walks the notches a user recognises, in both directions", () => {
    expect(stepBrowserZoomFactor(1, "in")).toBe(1.1);
    expect(stepBrowserZoomFactor(1.1, "in")).toBe(1.25);
    expect(stepBrowserZoomFactor(1, "out")).toBe(0.9);
    expect(stepBrowserZoomFactor(0.9, "out")).toBe(0.8);
  });

  it("stops at both ends rather than walking off the table", () => {
    const smallest = BROWSER_ZOOM_FACTORS[0] ?? 0;
    const largest = BROWSER_ZOOM_FACTORS.at(-1) ?? 0;

    expect(stepBrowserZoomFactor(smallest, "out")).toBe(smallest);
    expect(stepBrowserZoomFactor(largest, "in")).toBe(largest);
  });

  // A page can arrive at a factor that is on nobody's table: Chromium restores
  // what a site was left at, and that could have come from a pinch.
  it("lands on a real notch from a factor between two", () => {
    expect(stepBrowserZoomFactor(1.15, "in")).toBe(1.25);
    expect(stepBrowserZoomFactor(1.15, "out")).toBe(1.1);
  });

  it("clamps anything a plugin could hand it", () => {
    expect(clampBrowserZoomFactor(99)).toBe(5);
    expect(clampBrowserZoomFactor(0)).toBe(0.25);
    expect(clampBrowserZoomFactor(Number.NaN)).toBe(1);
  });

  // The factor walked from is Chromium's, rebuilt from a log-scale level, so it
  // need not be bit-identical to the notch that set it. One double's step below
  // 200% — where that step is wider than `Number.EPSILON` — an exact comparison
  // starts the walk at 175% and zooming in hands back the 200% the page is
  // already at: a chord that does nothing.
  it("treats a factor one step below a notch as being on it", () => {
    const stepBelowTwo = 2 - Number.EPSILON * 2;

    expect(stepBelowTwo).toBeLessThan(2);
    expect(stepBrowserZoomFactor(stepBelowTwo, "in")).toBe(2.5);
    expect(stepBrowserZoomFactor(stepBelowTwo, "out")).toBe(1.75);
  });
});
