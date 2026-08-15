// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserDevToolsPanel } from "./BrowserDevToolsPanel";

afterEach(cleanup);

describe("BrowserDevToolsPanel", () => {
  // DevTools are opened detached, because the host view is ours, and a detached
  // DevTools expects a window frame to carry its close control — so it draws
  // none. Without this button the panel closes only by keyboard.
  it("offers the close control DevTools cannot draw itself", () => {
    const onClose = vi.fn();
    render(<BrowserDevToolsPanel onClose={onClose} tabId="browser:a" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Close developer tools" }),
    );

    expect(onClose).toHaveBeenCalled();
  });

  // Everything below the strip belongs to Chromium: the app measures that area
  // and draws nothing in it.
  it("leaves the measured area empty", () => {
    render(<BrowserDevToolsPanel onClose={vi.fn()} tabId="browser:a" />);

    expect(
      screen.getByTestId("browser-dev-tools-panel").childNodes,
    ).toHaveLength(0);
  });
});
