import type { PatcherDesktopApi } from "@patcher/desktop-contract";

declare global {
  interface Window {
    /** Deprecated alias kept for shells built before the Patcher rename. */
    bbDesktop?: PatcherDesktopApi;
    patcherDesktop?: PatcherDesktopApi;
  }
}

export {};
