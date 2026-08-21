import { useCallback, useEffect, useState } from "react";
import type { BbDesktopDefaultBrowserStatus } from "@patcher/desktop-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

/**
 * What a build with no shell to ask — the web app — knows about it, and what a
 * shell that predates the question answers.
 */
export const UNAVAILABLE_DEFAULT_BROWSER_STATUS: BbDesktopDefaultBrowserStatus =
  {
    canRequest: false,
    isDefault: false,
  };

export interface DefaultBrowserStatusResult {
  /** Ask macOS to route web links to bb. The user answers a system dialog. */
  request: () => void;
  status: BbDesktopDefaultBrowserStatus;
}

/**
 * Whether macOS hands web links to bb.
 *
 * Subscribed as well as read because the answer changes outside this app: the
 * system's own confirmation returns before the user has answered it, and System
 * Settings can change it while bb is in the background. The shell re-reads on
 * activation and pushes the difference.
 */
export function useDefaultBrowserStatus(): DefaultBrowserStatusResult {
  const [status, setStatus] = useState<BbDesktopDefaultBrowserStatus>(
    UNAVAILABLE_DEFAULT_BROWSER_STATUS,
  );

  useEffect(() => {
    const desktopApi = getBbDesktopInfo();
    let cancelled = false;

    const unsubscribe = desktopApi?.onDefaultBrowserStatusChange?.(
      (nextStatus) => {
        setStatus(nextStatus);
      },
    );

    void desktopApi?.getDefaultBrowserStatus?.().then((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const request = useCallback(() => {
    void getBbDesktopInfo()
      ?.requestDefaultBrowser?.()
      .then((nextStatus) => {
        setStatus(nextStatus);
      });
  }, []);

  return { request, status };
}
