import { describe, expect, it } from "vitest";
import {
  browserRoutePatternToRegExp,
  formatBrowserEvalValue,
  matchBrowserRoute,
  toBrowserFulfillHeaders,
} from "../src/desktop-browser-control.js";

function route(pattern: string) {
  return {
    pattern,
    status: 200,
    contentType: "application/json",
    body: "{}",
    headers: [],
  };
}

describe("browserRoutePatternToRegExp", () => {
  it("stops a single star at a path separator and lets a double one cross", () => {
    // Playwright's dialect, which is the whole reason the patterns are globs
    // rather than regexes: a route written from its docs has to mean this.
    expect(browserRoutePatternToRegExp("https://x.test/*").test(
      "https://x.test/api",
    )).toBe(true);
    expect(browserRoutePatternToRegExp("https://x.test/*").test(
      "https://x.test/api/me",
    )).toBe(false);
    expect(browserRoutePatternToRegExp("https://x.test/**").test(
      "https://x.test/api/me",
    )).toBe(true);
  });

  it("matches a whole URL, not a piece of one", () => {
    const matcher = browserRoutePatternToRegExp("**/api/me");
    expect(matcher.test("https://x.test/api/me")).toBe(true);
    expect(matcher.test("https://x.test/api/me/extra")).toBe(false);
  });

  it("treats regex syntax in a pattern as characters to match", () => {
    // A query string is full of these. Reading them as syntax would silently
    // widen a route to URLs nobody asked to mock.
    const matcher = browserRoutePatternToRegExp("https://x.test/a.b?q=1+2");
    expect(matcher.test("https://x.test/a.b?q=1+2")).toBe(true);
    expect(matcher.test("https://x.test/axb?q=12")).toBe(false);
  });

  it("matches one non-separator character per question mark", () => {
    expect(browserRoutePatternToRegExp("**/v?/me").test("https://x.test/v2/me")).toBe(
      true,
    );
  });
});

describe("matchBrowserRoute", () => {
  it("answers with the first route that claims the URL", () => {
    // The list is kept newest-first, so this is "the one I just added wins".
    const routes = [route("**/api/**"), route("**/api/me")];

    expect(matchBrowserRoute(routes, "https://x.test/api/me")?.pattern).toBe(
      "**/api/**",
    );
  });

  it("skips a pattern that will not compile rather than failing the request", () => {
    const routes = [route("[unclosed"), route("**/me")];

    expect(matchBrowserRoute(routes, "https://x.test/me")?.pattern).toBe("**/me");
  });

  it("answers null when nothing matches, so the request is continued", () => {
    expect(matchBrowserRoute([route("**/api/**")], "https://x.test/")).toBeNull();
  });
});

describe("toBrowserFulfillHeaders", () => {
  it("puts the content type first and keeps the caller's headers", () => {
    expect(
      toBrowserFulfillHeaders({
        ...route("**"),
        headers: [{ name: "x-mock", value: "1" }],
      }),
    ).toEqual([
      { name: "content-type", value: "application/json" },
      { name: "x-mock", value: "1" },
    ]);
  });

  it("names no content type when the route declares none", () => {
    expect(
      toBrowserFulfillHeaders({ ...route("**"), contentType: "" }),
    ).toEqual([]);
  });
});

describe("formatBrowserEvalValue", () => {
  it("spells out an expression that returned nothing", () => {
    // "" and undefined are different answers, and a caller reading an empty
    // string could not tell which it got.
    expect(formatBrowserEvalValue(undefined, 100).value).toBe("undefined");
    expect(formatBrowserEvalValue(null, 100).value).toBe("null");
    expect(formatBrowserEvalValue("", 100).value).toBe('""');
  });

  it("carries structure as JSON", () => {
    expect(formatBrowserEvalValue({ a: [1, 2] }, 100)).toEqual({
      value: '{"a":[1,2]}',
      truncated: false,
    });
  });

  it("says when the answer was longer than it may carry", () => {
    const result = formatBrowserEvalValue("x".repeat(50), 10);

    expect(result.value).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("reports an unserializable answer rather than the whole call failing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(formatBrowserEvalValue(cyclic, 100).value).toBe("[unserializable]");
  });
});
