import { clientMessageSchema } from "@bb/domain";
import { decodeSocketPayload } from "./decode-payload.js";
import type { NotificationHub } from "./hub.js";
import type { WatchInterestCoordinator } from "./watch-interests.js";

interface ClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function onClientSocketOpen(
  hub: NotificationHub,
  socket: ClientSocket,
): void {
  hub.registerClient(socket);
}

export function onClientSocketMessage(
  deps: {
    hub: NotificationHub;
    watchInterests: Pick<
      WatchInterestCoordinator,
      "subscribe" | "unsubscribe" | "releaseSocket"
    >;
  },
  socket: ClientSocket,
  raw: unknown,
): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeSocketPayload(raw));
  } catch {
    socket.close(1008, "invalid-message");
    return;
  }

  const result = clientMessageSchema.safeParse(decoded);
  if (!result.success) {
    socket.close(1008, "invalid-message");
    return;
  }
  const parsed = result.data;

  switch (parsed.type) {
    case "subscribe":
      deps.hub.subscribe(socket, parsed.target);
      deps.watchInterests.subscribe(socket, parsed.target);
      break;
    case "unsubscribe":
      deps.hub.unsubscribe(socket, parsed.target);
      deps.watchInterests.unsubscribe(socket, parsed.target);
      break;
    case "browser-host.register":
      deps.hub.registerBrowserHost(socket, {
        browserHostId: parsed.browserHostId,
      });
      break;
    case "browser-host.unregister":
      deps.hub.unregisterBrowserHost(socket);
      break;
    case "browser-command.response":
      // A stale response (its request already timed out) or one from a socket
      // that is no longer the addressed host is dropped, not an error: the
      // waiter's own identity check is what enforces that, so correctness never
      // depends on a client behaving.
      deps.hub.recordBrowserCommandResponse({ socket, message: parsed });
      break;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unhandled client message: ${_exhaustive}`);
    }
  }
}

export function onClientSocketClose(
  deps: {
    hub: NotificationHub;
    watchInterests: Pick<WatchInterestCoordinator, "releaseSocket">;
  },
  socket: ClientSocket,
): void {
  deps.watchInterests.releaseSocket(socket);
  deps.hub.unregisterClient(socket);
}
