/// <reference types="vitest/jsdom" />

/**
 * Give jsdom tests jsdom's `localStorage` and `sessionStorage`.
 *
 * Node now defines global storage accessors of its own. Vitest keeps existing
 * globals when it overlays a jsdom environment and then aliases `window` to
 * `globalThis`, so `window.localStorage` resolves to Node's rather than the
 * document's — an object with none of `Storage`'s methods on it. Anything that
 * calls `clear()` throws, and anything that merely reads finds an empty store
 * shared with every other test in the worker.
 *
 * Applied for every package by {@link defineWorkspaceTestConfig} rather than by
 * each package that happens to notice: it is a property of the runtime, not of
 * a suite, and it was already fixed once locally in `apps/app` before the next
 * package hit it.
 *
 * A no-op outside jsdom, so `environment: "node"` packages load it harmlessly.
 */
if (typeof window !== "undefined" && typeof jsdom !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: jsdom.window.localStorage,
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: jsdom.window.sessionStorage,
  });
}
