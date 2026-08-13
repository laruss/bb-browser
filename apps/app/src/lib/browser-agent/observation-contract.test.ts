import { describe, expect, it } from "vitest";
import { bbDesktopBrowserObservationSchema } from "@bb/desktop-contract";
import { browserObservationSchema } from "@bb/domain";

/**
 * The observation union is written twice for the same reason the interaction
 * union is (see interaction-contract.test.ts): one copy is the agent wire and
 * one is the version-skewed shell wire, and the executor forwards a value parsed
 * by the first straight into the second. A field one accepts and the other
 * rejects parses on the way in and is refused at the last hop, far from the
 * change that caused it. This is the only place both are in scope.
 */

const ACCEPTED: unknown[] = [
  { kind: "screenshot", format: "png", quality: 1 },
  { kind: "screenshot", format: "jpeg", quality: 100 },
  { kind: "pdf" },
  { kind: "console", limit: 1 },
  { kind: "console", limit: 500 },
  { kind: "network", limit: 200 },
];

const REJECTED: unknown[] = [
  {},
  { kind: "screenshot" },
  { kind: "screenshot", format: "webp", quality: 80 },
  { kind: "screenshot", format: "jpeg", quality: 0 },
  { kind: "screenshot", format: "jpeg", quality: 101 },
  { kind: "screenshot", format: "jpeg", quality: 80.5 },
  { kind: "console" },
  { kind: "console", limit: 0 },
  // Past the buffer the shell keeps, so asking for it would promise entries
  // that cannot exist.
  { kind: "network", limit: 501 },
  { kind: "video" },
];

describe("the observation union, on both wires", () => {
  it("accepts the same observations", () => {
    for (const value of ACCEPTED) {
      expect(
        browserObservationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        bbDesktopBrowserObservationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it("rejects the same observations", () => {
    for (const value of REJECTED) {
      expect(
        browserObservationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(false);
      expect(
        bbDesktopBrowserObservationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });
});
