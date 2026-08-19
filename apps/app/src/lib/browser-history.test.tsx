// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useBrowserHistory } from "./browser-history";

const list = vi.hoisted(() => vi.fn(async () => []));
const record = vi.hoisted(() => vi.fn(async () => null));
const clearHistory = vi.hoisted(() => vi.fn(async () => 0));

vi.mock("@/lib/sdk", () => ({
  sdk: { browserHistory: { list, record, clear: clearHistory } },
}));

function renderBrowserHistory(scopeId: string | null) {
  const { wrapper } = createQueryClientTestHarness();
  return renderHook(() => useBrowserHistory(scopeId), { wrapper });
}

describe("useBrowserHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A browsed tab reports its state on every change, so the same finished page
  // arrives many times. Each report used to cost a localStorage write; it now
  // costs a request that runs every plugin's history filters.
  it("records a page once, however many times the tab reports it", async () => {
    const { result } = renderBrowserHistory("thr_a");

    act(() => {
      result.current.recordVisit({ url: "https://example.test/", title: "Ex" });
      result.current.recordVisit({ url: "https://example.test/", title: "Ex" });
    });

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    expect(record).toHaveBeenCalledWith({
      scopeId: "thr_a",
      title: "Ex",
      url: "https://example.test/",
    });
  });

  // A page that reports before its title arrives and again afterwards is two
  // different facts, and the second is the one worth storing.
  it("records again when the title changes", async () => {
    const { result } = renderBrowserHistory("thr_a");

    act(() => {
      result.current.recordVisit({ url: "https://example.test/", title: null });
      result.current.recordVisit({ url: "https://example.test/", title: "Ex" });
    });

    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
  });

  it("does nothing at all without a scope", async () => {
    const { result } = renderBrowserHistory(null);

    act(() => {
      result.current.recordVisit({ url: "https://example.test/", title: null });
      result.current.clear();
    });

    expect(record).not.toHaveBeenCalled();
    expect(clearHistory).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("clears its own scope, and lets the next visit be recorded again", async () => {
    const { result } = renderBrowserHistory("thr_a");

    act(() => {
      result.current.recordVisit({ url: "https://example.test/", title: "Ex" });
    });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.clear();
    });
    await waitFor(() =>
      expect(clearHistory).toHaveBeenCalledWith({ scopeId: "thr_a" }),
    );

    act(() => {
      result.current.recordVisit({ url: "https://example.test/", title: "Ex" });
    });
    await waitFor(() => expect(record).toHaveBeenCalledTimes(2));
  });
});
