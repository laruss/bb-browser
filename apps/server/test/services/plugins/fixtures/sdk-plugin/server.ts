/**
 * A plugin that reaches for `bb.sdk`, and only when asked to.
 *
 * `@bb/sdk` is loaded on demand in a plugin process — it costs ~100MB of
 * resident memory, and most plugins never touch it — so something has to prove
 * that a plugin which *does* touch it still gets a working SDK. Reaching for
 * it from a callback rather than the factory is also how a plugin is supposed
 * to use it: `bb.sdk` is bind-gated until the server is listening.
 */
export default function plugin(bb: {
  browser: {
    registerContextMenuItem(item: {
      id: string;
      title: string;
      run(context: { selectionText: string | null }): string;
    }): void;
  };
  sdk: { threads: { list(): unknown }; guide: { render(): unknown } };
}): void {
  bb.browser.registerContextMenuItem({
    id: "sdk_probe",
    title: "Probe the SDK",
    // Both halves of the contract the lazy load has to keep: an area method,
    // and `guide.render`, which answers without awaiting anything.
    run: () => `${typeof bb.sdk.threads.list} ${typeof bb.sdk.guide.render}`,
  });
}
