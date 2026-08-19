import type { QueryClient } from "@tanstack/react-query";
import { browserHistoryQueryKey } from "../queries/query-keys";

interface InvalidateBrowserHistoryArgs {
  queryClient: QueryClient;
  /** The surface whose recents changed — a thread id, or the browser's own. */
  scopeId: string;
}

/**
 * Refresh one surface's recents after this window recorded or cleared a visit.
 *
 * Local only, on purpose: the server broadcasts `browser-history-changed` for
 * removals, and deliberately says nothing about ordinary visits (see
 * services/browser/browser-history.ts), so the window that browsed is the one
 * that refreshes.
 */
export function invalidateBrowserHistory({
  queryClient,
  scopeId,
}: InvalidateBrowserHistoryArgs): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: browserHistoryQueryKey(scopeId),
  });
}
