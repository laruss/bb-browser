import type { BbDesktopApi } from "@patcher/desktop-contract";

declare global {
  interface Window {
    bbDesktop?: BbDesktopApi;
  }
}

export {};
