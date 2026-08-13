// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserPageDialog } from "./BrowserPageDialog";

/**
 * This replaces Chromium's own dialog for the human using the tab, so the cases
 * that matter are the ones where getting it wrong loses their answer or leaves
 * them no way out.
 */

function dialog(
  overrides: Partial<{
    type: "alert" | "confirm" | "prompt" | "beforeunload";
    message: string;
    defaultPrompt: string;
  }> = {},
) {
  return {
    type: "confirm" as const,
    message: "Delete everything?",
    defaultPrompt: "",
    ...overrides,
  };
}

afterEach(() => {
  // No global auto-cleanup here, and a leaked dialog from the previous case
  // would satisfy the next one's queries.
  cleanup();
});

describe("BrowserPageDialog", () => {
  it("shows the page's message and reports acceptance", () => {
    const onRespond = vi.fn();
    render(<BrowserPageDialog dialog={dialog()} onRespond={onRespond} />);

    expect(screen.getByText("Delete everything?")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(onRespond).toHaveBeenCalledWith({ accept: true });
  });

  it("offers no way to decline an alert, because there is none", () => {
    const onRespond = vi.fn();
    render(
      <BrowserPageDialog
        dialog={dialog({ type: "alert", message: "Saved" })}
        onRespond={onRespond}
      />,
    );

    // `alert()` has one outcome; a Cancel button would imply a choice the page
    // never offered.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onRespond).toHaveBeenCalledWith({ accept: true });
  });

  it("returns the typed answer for a prompt, seeded with the page's default", () => {
    const onRespond = vi.fn();
    render(
      <BrowserPageDialog
        dialog={dialog({
          type: "prompt",
          message: "Your name?",
          defaultPrompt: "anon",
        })}
        onRespond={onRespond}
      />,
    );

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Response",
    });
    expect(input.value).toBe("anon");
    fireEvent.change(input, { target: { value: "Konstantin" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Enter submits: the native dialog behaved that way and a prompt is
    // otherwise two interactions for one answer.
    expect(onRespond).toHaveBeenCalledWith({
      accept: true,
      promptText: "Konstantin",
    });
  });

  it("cancels on Escape wherever the page allows it", () => {
    const onRespond = vi.fn();
    const { rerender } = render(
      <BrowserPageDialog dialog={dialog()} onRespond={onRespond} />,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onRespond).toHaveBeenCalledWith({ accept: false });

    onRespond.mockClear();
    rerender(
      <BrowserPageDialog
        dialog={dialog({ type: "alert" })}
        onRespond={onRespond}
      />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("renders a page's markup as text", () => {
    render(
      <BrowserPageDialog
        dialog={dialog({ message: "<img src=x onerror=alert(1)>" })}
        onRespond={vi.fn()}
      />,
    );

    // The message is attacker-authored; it is content, never markup.
    expect(screen.getByText("<img src=x onerror=alert(1)>")).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });
});
