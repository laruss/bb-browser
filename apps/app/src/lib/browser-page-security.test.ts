import { describe, expect, it } from "vitest";
import {
  describeBrowserPageSecurity,
  resolveBrowserPageSecurity,
} from "./browser-page-security";

function resolve(url: string, certificateTrustedByUser = false) {
  return resolveBrowserPageSecurity({ certificateTrustedByUser, url });
}

describe("browser page security", () => {
  it("reads what the URL settles", () => {
    expect(resolve("https://example.com/a")).toEqual({
      kind: "encrypted",
      host: "example.com",
    });
    expect(resolve("http://example.com/a").kind).toBe("plain");
    expect(resolve("http://localhost:5173/").kind).toBe("local");
    expect(resolve("")).toEqual({ kind: "none", host: "" });
  });

  // The lie the popover exists to end: https over a certificate nobody vouched
  // for is encrypted and anonymous, and the old padlock called it secure.
  it("stops calling a hand-trusted certificate secure", () => {
    const security = resolve("https://dev.box.test/", true);

    expect(security.kind).toBe("certificate-untrusted");
    expect(describeBrowserPageSecurity(security).title).toBe(
      "Certificate is not trusted",
    );
  });

  // A trusted certificate is a claim about the host, and http has no
  // certificate at all — so the flag must not colour a plain page.
  it("ignores the flag on a page that has no certificate", () => {
    expect(resolve("http://example.com/", true).kind).toBe("plain");
    expect(resolve("http://127.0.0.1:1/", true).kind).toBe("local");
  });

  it("says something for every state, and claims nothing with no page", () => {
    for (const url of [
      "https://example.com/",
      "http://example.com/",
      "http://localhost/",
      "",
    ]) {
      const copy = describeBrowserPageSecurity(resolve(url));
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
    }
    expect(describeBrowserPageSecurity(resolve("")).label).toBeNull();
  });
});
