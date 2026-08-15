import { describe, expect, it } from "vitest";
import {
  resolveDefaultSidebarWidth,
  resolveSidebarResizeWidth,
} from "./AppLayout";

// A third of the window, capped: wide enough to read a conversation on a laptop,
// and not a third of an ultrawide on a large display. Only ever the fallback for
// a panel nobody has dragged.
describe("resolveDefaultSidebarWidth", () => {
  it("takes a third of the window", () => {
    expect(resolveDefaultSidebarWidth(1080)).toBe(360);
  });

  it("stops at the cap on a wide display", () => {
    expect(resolveDefaultSidebarWidth(1920)).toBe(400);
    expect(resolveDefaultSidebarWidth(3440)).toBe(400);
  });

  it("never goes below the panel's own floor on a narrow window", () => {
    expect(resolveDefaultSidebarWidth(600)).toBe(240);
  });
});

// The sidebar is on the window's trailing edge, so its grab handle is on its
// leading one and the drag runs the opposite way to a left-hand sidebar's. That
// sign is the whole content of this helper: get it wrong and resizing still
// works, it just runs backwards.
describe("resolveSidebarResizeWidth", () => {
  it("widens when the handle is dragged toward the content", () => {
    expect(resolveSidebarResizeWidth({ deltaX: -40, startWidth: 320 })).toBe(
      360,
    );
  });

  it("narrows when the handle is dragged toward the window edge", () => {
    expect(resolveSidebarResizeWidth({ deltaX: 40, startWidth: 320 })).toBe(
      280,
    );
  });

  it("clamps to the sidebar's range rather than following the pointer out", () => {
    expect(resolveSidebarResizeWidth({ deltaX: -9000, startWidth: 320 })).toBe(
      900,
    );
    expect(resolveSidebarResizeWidth({ deltaX: 9000, startWidth: 320 })).toBe(
      240,
    );
  });

  // The ceiling has to clear a readable conversation, since the agent screens
  // paint in this panel now. A range that stops at a nav-list width would make
  // the drag pointless.
  it("allows a width a conversation can live in", () => {
    expect(
      resolveSidebarResizeWidth({ deltaX: -200, startWidth: 480 }),
    ).toBeGreaterThan(600);
  });
});
