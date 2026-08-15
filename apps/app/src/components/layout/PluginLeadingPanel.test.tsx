// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginLeadingPanelSlot } from "@/lib/plugin-slots";

const slotState = vi.hoisted(() => ({
  panels: [] as PluginLeadingPanelSlot[],
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ leadingPanels: slotState.panels }),
}));

// The mount scopes a plugin's stylesheet and contains its crashes; neither is
// what these tests are about.
vi.mock("@/components/plugin/PluginSlotMount", () => ({
  PluginSlotMount: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const {
  PluginLeadingPanel,
  resolveActiveLeadingPanel,
  resolveLeadingPanelResizeWidth,
} = await import("./PluginLeadingPanel");

function panel(pluginId: string, id: string): PluginLeadingPanelSlot {
  return {
    component: () => (
      <div data-testid={`body-${pluginId}`}>{pluginId} body</div>
    ),
    generation: 1,
    icon: "Puzzle",
    id,
    pluginId,
    title: `${pluginId} panel`,
  };
}

beforeEach(() => {
  slotState.panels = [];
  window.localStorage.clear();
});

afterEach(cleanup);

/**
 * The edge belongs to plugins, and what it looks like follows from how many
 * asked for it rather than from configuration.
 */
describe("PluginLeadingPanel", () => {
  it("is absent entirely when no plugin claims the edge", () => {
    render(<PluginLeadingPanel />);

    expect(screen.queryByTestId("plugin-leading-panel")).toBeNull();
  });

  // A rail to switch between one thing is a control that does nothing.
  it("gives a single plugin the panel, with no rail", () => {
    slotState.panels = [panel("notes", "notes")];
    render(<PluginLeadingPanel />);

    expect(screen.getByTestId("plugin-leading-panel")).toBeTruthy();
    expect(screen.queryByTestId("plugin-leading-panel-rail")).toBeNull();
    expect(screen.getByTestId("body-notes")).toBeTruthy();
  });

  it("draws a rail once there is a choice to make", () => {
    slotState.panels = [panel("notes", "notes"), panel("files", "files")];
    render(<PluginLeadingPanel />);

    expect(screen.getByTestId("plugin-leading-panel-rail")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // The first registration shows until the user picks otherwise.
    expect(screen.getByTestId("body-notes")).toBeTruthy();
    expect(screen.queryByTestId("body-files")).toBeNull();
  });
});

describe("resolveActiveLeadingPanel", () => {
  it("shows the first registration when nothing was chosen", () => {
    const panels = [panel("notes", "notes"), panel("files", "files")];

    expect(resolveActiveLeadingPanel({ panels, storedId: null })).toBe(
      panels[0],
    );
  });

  it("shows the one the user chose", () => {
    const panels = [panel("notes", "notes"), panel("files", "files")];

    expect(resolveActiveLeadingPanel({ panels, storedId: "files/files" })).toBe(
      panels[1],
    );
  });

  // A stored choice naming a plugin that is gone is a plugin that was disabled,
  // not an error — the panel falls back rather than going blank.
  it("falls back when the chosen plugin is no longer installed", () => {
    const panels = [panel("notes", "notes")];

    expect(
      resolveActiveLeadingPanel({ panels, storedId: "removed/gone" }),
    ).toBe(panels[0]);
  });

  it("has nothing to show when nothing is registered", () => {
    expect(
      resolveActiveLeadingPanel({ panels: [], storedId: "notes/notes" }),
    ).toBeNull();
  });
});

// This panel is on the leading edge and its handle is on its trailing one, so
// the drag runs the opposite way to the sidebar's. That sign is the whole
// content of the helper: get it wrong and resizing still works, backwards.
describe("resolveLeadingPanelResizeWidth", () => {
  it("widens when the handle is dragged toward the content", () => {
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: 40, startWidth: 280 }),
    ).toBe(320);
  });

  it("narrows when dragged back toward the window edge", () => {
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: -40, startWidth: 280 }),
    ).toBe(240);
  });

  it("clamps rather than following the pointer out of the window", () => {
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: 9000, startWidth: 280 }),
    ).toBe(640);
    expect(
      resolveLeadingPanelResizeWidth({ deltaX: -9000, startWidth: 280 }),
    ).toBe(200);
  });
});
