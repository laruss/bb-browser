import { describe, expect, it } from "vitest";
import {
  CDP_MODIFIER_CONTROL,
  CDP_MODIFIER_META,
  CDP_MODIFIER_SHIFT,
  characterKeyEvent,
  parseBrowserKeyChord,
} from "../src/desktop-browser-keyboard.js";

/**
 * What a key event carries decides whether a page reacts at all: `text` is what
 * gets inserted, `windowsVirtualKeyCode` is what makes Chromium's own editing
 * behaviour fire. Getting one of them wrong produces an event that works on some
 * pages and silently does nothing on others, so each field is pinned here.
 */

describe("parseBrowserKeyChord", () => {
  it("emits the DOM spelling for a named key whatever case it was written in", () => {
    expect(parseBrowserKeyChord("enter")).toEqual({
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      // Enter inserts a carriage return; without it a <textarea> gets no newline
      // and Chromium's implicit form submission does not run.
      text: "\r",
      modifiers: 0,
    });
    expect(parseBrowserKeyChord("ArrowDown")?.key).toBe("ArrowDown");
    expect(parseBrowserKeyChord("ESC")?.code).toBe("Escape");
  });

  it("gives keys that insert nothing an empty text", () => {
    // The distinction drives `keyDown` vs `rawKeyDown` at the call site.
    expect(parseBrowserKeyChord("Escape")?.text).toBe("");
    expect(parseBrowserKeyChord("ArrowLeft")?.text).toBe("");
    expect(parseBrowserKeyChord("F5")).toEqual({
      key: "F5",
      code: "F5",
      windowsVirtualKeyCode: 116,
      text: "",
      modifiers: 0,
    });
  });

  it("treats a single character as its own key", () => {
    expect(parseBrowserKeyChord("a")).toEqual({
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      text: "a",
      modifiers: 0,
    });
    expect(parseBrowserKeyChord("7")?.code).toBe("Digit7");
    // A symbol's physical position depends on the layout, so claiming a `code`
    // would be a guess; the text is what matters and it is right.
    expect(parseBrowserKeyChord("/")).toEqual({
      key: "/",
      code: "",
      windowsVirtualKeyCode: 0,
      text: "/",
      modifiers: 0,
    });
  });

  it("collects modifiers and shifts the character they apply to", () => {
    expect(parseBrowserKeyChord("Shift+a")).toMatchObject({
      key: "A",
      text: "A",
      modifiers: CDP_MODIFIER_SHIFT,
    });
    expect(parseBrowserKeyChord("Ctrl+Shift+Enter")?.modifiers).toBe(
      CDP_MODIFIER_CONTROL | CDP_MODIFIER_SHIFT,
    );
    expect(parseBrowserKeyChord("Cmd+c")?.modifiers).toBe(CDP_MODIFIER_META);
  });

  it("drops the text under a command modifier", () => {
    // Otherwise Chromium both runs the shortcut and types the letter, which is
    // how "select all" ends up replacing the selection with "a".
    expect(parseBrowserKeyChord("Control+a")?.text).toBe("");
    expect(parseBrowserKeyChord("Meta+v")?.text).toBe("");
  });

  it("reads a trailing plus as the key itself", () => {
    expect(parseBrowserKeyChord("Shift++")).toMatchObject({
      key: "+",
      text: "+",
      modifiers: CDP_MODIFIER_SHIFT,
    });
    expect(parseBrowserKeyChord("+")?.key).toBe("+");
  });

  it("refuses anything it cannot emit rather than guessing", () => {
    // Pressing the wrong key on a live page is a side effect, so an unknown
    // name has to fail by name.
    expect(parseBrowserKeyChord("Meh")).toBeNull();
    expect(parseBrowserKeyChord("Hyper+a")).toBeNull();
    expect(parseBrowserKeyChord("F13")).toBeNull();
    expect(parseBrowserKeyChord("")).toBeNull();
    expect(parseBrowserKeyChord("Shift+")).toBeNull();
    expect(parseBrowserKeyChord("a".repeat(200))).toBeNull();
  });
});

describe("characterKeyEvent", () => {
  it("counts an astral character as one key", () => {
    // `length` would say 2 and send half a surrogate pair per event.
    const event = characterKeyEvent("😀");
    expect(event.text).toBe("😀");
    expect(event.modifiers).toBe(0);
  });
});
