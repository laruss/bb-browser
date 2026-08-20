import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_PROTOCOLS,
  readDefaultBrowserStatus,
  requestDefaultBrowser,
  type DefaultBrowserEnvironment,
} from "../src/desktop-default-browser.js";

interface FakeEnvironmentArgs {
  defaults?: readonly string[];
  isPackaged?: boolean;
}

function createFakeEnvironment({
  defaults = [],
  isPackaged = true,
}: FakeEnvironmentArgs = {}): DefaultBrowserEnvironment & {
  requested: string[];
} {
  const owned = new Set(defaults);
  const requested: string[] = [];

  return {
    isPackaged,
    isDefaultProtocolClient(protocol) {
      return owned.has(protocol);
    },
    setAsDefaultProtocolClient(protocol) {
      requested.push(protocol);
      // Launch Services returns before the user has answered its dialog, so the
      // fake deliberately does not flip the answer.
      return true;
    },
    requested,
  };
}

describe("readDefaultBrowserStatus", () => {
  it("is the default only when it owns both schemes", () => {
    expect(
      readDefaultBrowserStatus(createFakeEnvironment({ defaults: ["http"] })),
    ).toEqual({ canRequest: true, isDefault: false });
    expect(
      readDefaultBrowserStatus(
        createFakeEnvironment({ defaults: DEFAULT_BROWSER_PROTOCOLS }),
      ),
    ).toEqual({ canRequest: false, isDefault: true });
  });

  it("cannot be asked for from a development run", () => {
    expect(
      readDefaultBrowserStatus(createFakeEnvironment({ isPackaged: false })),
    ).toEqual({ canRequest: false, isDefault: false });
  });
});

describe("requestDefaultBrowser", () => {
  it("asks for both schemes", () => {
    const environment = createFakeEnvironment();

    const status = requestDefaultBrowser(environment);

    expect(environment.requested).toEqual(["http", "https"]);
    // Still false: the user has not answered the system dialog yet, and the
    // shell re-reads the status when the app is activated again.
    expect(status).toEqual({ canRequest: true, isDefault: false });
  });

  it("asks for nothing from a development run", () => {
    const environment = createFakeEnvironment({ isPackaged: false });

    expect(requestDefaultBrowser(environment)).toEqual({
      canRequest: false,
      isDefault: false,
    });
    expect(environment.requested).toEqual([]);
  });

  it("asks for nothing when it is already the default", () => {
    const environment = createFakeEnvironment({
      defaults: DEFAULT_BROWSER_PROTOCOLS,
    });

    expect(requestDefaultBrowser(environment)).toEqual({
      canRequest: false,
      isDefault: true,
    });
    expect(environment.requested).toEqual([]);
  });
});
