import { describe, expect, it } from "vitest";
import {
  browserUrlPatternToRegExp,
  matchesBrowserUrlPattern,
  normalizePluginSitePattern,
} from "../src/browser-url-pattern.js";

// The dialect is Playwright's, and the reason it is worth pinning here rather than
// only through the surfaces that use it: this is what decides which pages a plugin
// reaches, and every one of those surfaces trusts the answer.
describe("browserUrlPatternToRegExp", () => {
  it("crosses separators for ** and stops at one for *", () => {
    expect(
      matchesBrowserUrlPattern("https://x.test/*", "https://x.test/a"),
    ).toBe(true);
    expect(
      matchesBrowserUrlPattern("https://x.test/*", "https://x.test/a/b"),
    ).toBe(false);
    expect(
      matchesBrowserUrlPattern("https://x.test/**", "https://x.test/a/b"),
    ).toBe(true);
  });

  it("anchors both ends, so a pattern describes a whole URL", () => {
    expect(
      matchesBrowserUrlPattern("https://x.test/", "https://x.test/a"),
    ).toBe(false);
    // Anchored at the front too, so a pattern cannot be matched by a URL that
    // merely contains it.
    expect(
      browserUrlPatternToRegExp("https://x.test/").test(
        "https://evil.test/#https://x.test/",
      ),
    ).toBe(false);
  });

  it("treats every non-wildcard character as a literal", () => {
    // A query string is full of characters a regex would otherwise read as
    // syntax; a pattern is a pattern, not a program.
    expect(
      matchesBrowserUrlPattern(
        "https://x.test/s?q=(a+b)",
        "https://x.test/s?q=(a+b)",
      ),
    ).toBe(true);
    expect(matchesBrowserUrlPattern("https://a.test/", "https://axtest/")).toBe(
      false,
    );
  });

  it("matches nothing rather than throwing on a pattern that will not compile", () => {
    expect(
      matchesBrowserUrlPattern("https://x.test/[", "https://x.test/["),
    ).toBe(true);
  });
});

describe("normalizePluginSitePattern", () => {
  it("admits https, and wildcards in the host", () => {
    expect(normalizePluginSitePattern("https://github.com/**")).toBe(
      "https://github.com/**",
    );
    expect(normalizePluginSitePattern("https://*.github.com/**")).toBe(
      "https://*.github.com/**",
    );
  });

  it("admits plain http only for a literal loopback host", () => {
    expect(normalizePluginSitePattern("http://localhost:5173/**")).toBe(
      "http://localhost:5173/**",
    );
    expect(normalizePluginSitePattern("http://127.0.0.1/**")).toBe(
      "http://127.0.0.1/**",
    );
    expect(normalizePluginSitePattern("http://[::1]/**")).toBe(
      "http://[::1]/**",
    );
    // Standing access to a site over a connection anyone on the path can
    // impersonate is not a plugin's call to make.
    expect(normalizePluginSitePattern("http://intranet.example/**")).toBeNull();
    // A wildcard host cannot be trusted to stay loopback.
    expect(normalizePluginSitePattern("http://*.localhost/**")).toBeNull();
  });

  it("refuses anything that is not one of those two schemes", () => {
    for (const pattern of [
      "**",
      "file:///Users/me/**",
      "javascript:alert(1)",
      "https://",
      "",
      "https://x.test/ **",
      42,
      null,
    ]) {
      expect(normalizePluginSitePattern(pattern)).toBeNull();
    }
  });

  // Matching is case-sensitive and a URL never arrives with an upper-case host,
  // so a pattern written this way would claim no page at all. The caller compares
  // the normalised form against what was declared and refuses the difference —
  // see the manifest schema.
  it("folds the host to lower case, and leaves the path alone", () => {
    expect(normalizePluginSitePattern("https://GitHub.com/**")).toBe(
      "https://github.com/**",
    );
    expect(normalizePluginSitePattern("http://LOCALHOST:3000/**")).toBe(
      "http://localhost:3000/**",
    );
    // Paths are case-sensitive on most servers: folding one would change which
    // pages the pattern claims.
    expect(normalizePluginSitePattern("https://x.test/README.md")).toBe(
      "https://x.test/README.md",
    );
  });
});
