import { describe, expect, it } from "vitest";
import {
  buildBrowserStorageScript,
  parseBrowserStorageCounts,
  parseBrowserStorageItems,
  readBrowserStorageScriptError,
  toBrowserCookie,
  toBrowserSessionCookieDetails,
} from "../src/desktop-browser-storage.js";

describe("toBrowserCookie", () => {
  it("puts an Electron cookie into the shape a state file uses", () => {
    expect(
      toBrowserCookie({
        name: "session",
        value: "abc123",
        domain: ".example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        expirationDate: 1_700_000_000,
        sameSite: "no_restriction",
      }),
    ).toEqual({
      name: "session",
      value: "abc123",
      domain: ".example.com",
      path: "/",
      expires: 1_700_000_000,
      httpOnly: true,
      secure: true,
      sameSite: "None",
    });
  });

  it("spells a session cookie's expiry -1, however it was reported", () => {
    // Electron reports a session cookie either by saying so or by leaving the
    // date off; Playwright's format has one way to say it.
    expect(toBrowserCookie({ name: "a", session: true, expirationDate: 5 }).expires).toBe(-1);
    expect(toBrowserCookie({ name: "a" }).expires).toBe(-1);
  });

  it("reports an undeclared SameSite as the policy the browser applies", () => {
    expect(toBrowserCookie({ sameSite: "unspecified" }).sameSite).toBe("Lax");
    expect(toBrowserCookie({}).sameSite).toBe("Lax");
    expect(toBrowserCookie({ sameSite: "strict" }).sameSite).toBe("Strict");
  });
});

describe("toBrowserSessionCookieDetails", () => {
  const cookie = {
    name: "session",
    value: "abc",
    domain: ".example.com",
    path: "/app",
    expires: 1_700_000_000,
    httpOnly: true,
    secure: true,
    sameSite: "None" as const,
  };

  it("rebuilds the url a saved cookie has to be written against", () => {
    expect(toBrowserSessionCookieDetails(cookie, "https://tab.test/")).toEqual({
      url: "https://example.com/app",
      name: "session",
      value: "abc",
      domain: ".example.com",
      path: "/app",
      secure: true,
      httpOnly: true,
      expirationDate: 1_700_000_000,
      sameSite: "no_restriction",
    });
  });

  it("offers a non-secure cookie over http, since Chromium refuses the other way round", () => {
    const details = toBrowserSessionCookieDetails(
      { ...cookie, secure: false },
      "https://tab.test/",
    );

    expect(details.url).toBe("http://example.com/app");
  });

  it("keeps a host-only cookie host-only by naming no domain", () => {
    // Electron normalizes whatever `domain` it is given with a preceding dot,
    // so passing one here would quietly widen the cookie to every subdomain.
    const details = toBrowserSessionCookieDetails(
      { ...cookie, domain: "example.com" },
      "https://tab.test/",
    );

    expect(details).not.toHaveProperty("domain");
    expect(details.url).toBe("https://example.com/app");
  });

  it("writes a cookie with no domain of its own against the tab", () => {
    const details = toBrowserSessionCookieDetails(
      { ...cookie, domain: "", path: "" },
      "https://tab.test/page",
    );

    expect(details.url).toBe("https://tab.test/page");
    expect(details.path).toBe("/");
  });

  it("omits the expiry of a session cookie rather than sending -1", () => {
    // -1 seconds since the epoch is 1969, which would delete the cookie.
    const details = toBrowserSessionCookieDetails(
      { ...cookie, expires: -1 },
      "https://tab.test/",
    );

    expect(details).not.toHaveProperty("expirationDate");
  });
});

describe("buildBrowserStorageScript", () => {
  it("carries a key the page could otherwise read as code", () => {
    const script = buildBrowserStorageScript({
      kind: "items-set",
      area: "local",
      items: [{ name: '"); alert(1); ("', value: "x" }],
    });

    // The payload is one JSON literal, so a quote in a key stays inside the
    // string it belongs to instead of ending it.
    expect(script).toContain(
      JSON.stringify({
        kind: "items-set",
        area: "local",
        items: [{ name: '"); alert(1); ("', value: "x" }],
      }),
    );
    expect(() => new Function(`return ${script}`)).not.toThrow();
  });

  it("builds a parsable program for every operation it takes", () => {
    for (const operation of [
      { kind: "items-get", area: "local" },
      { kind: "items-clear", area: "session", name: null },
      { kind: "items-clear", area: "local", name: "token" },
    ] as const) {
      expect(() =>
        new Function(`return ${buildBrowserStorageScript(operation)}`),
      ).not.toThrow();
    }
  });

  it("applies the caps inside the page rather than after the trip", () => {
    const script = buildBrowserStorageScript({
      kind: "items-get",
      area: "local",
    });

    expect(script).toContain("slice(0, 65536)");
    expect(script).toContain("truncated = true");
  });
});

describe("parseBrowserStorageItems", () => {
  it("reads back a list and what it left out", () => {
    expect(
      parseBrowserStorageItems({
        items: [{ name: "token", value: "abc" }],
        truncated: true,
      }),
    ).toEqual({ items: [{ name: "token", value: "abc" }], truncated: true });
  });

  it("refuses an answer that is not a list", () => {
    expect(parseBrowserStorageItems({ items: "token=abc" })).toBeNull();
    expect(parseBrowserStorageItems(null)).toBeNull();
  });
});

describe("parseBrowserStorageCounts", () => {
  it("reads the counts a write reported", () => {
    expect(parseBrowserStorageCounts({ applied: 3, rejected: 1 })).toEqual({
      applied: 3,
      rejected: 1,
      removed: 0,
    });
  });

  it("treats a nonsense count as none", () => {
    expect(parseBrowserStorageCounts({ removed: -2 })?.removed).toBe(0);
    expect(parseBrowserStorageCounts({ removed: "many" })?.removed).toBe(0);
  });
});

describe("readBrowserStorageScriptError", () => {
  it("passes a page's own refusal through, and nothing else", () => {
    expect(readBrowserStorageScriptError({ error: "no storage" })).toBe(
      "no storage",
    );
    expect(readBrowserStorageScriptError({ items: [] })).toBeNull();
    expect(readBrowserStorageScriptError("error")).toBeNull();
  });
});
