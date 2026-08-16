import { describe, expect, it, vi } from "vitest";
import {
  onClientSocketMessage,
  onClientSocketOpen,
} from "../../src/ws/client-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

function createProtocolDeps(hub: NotificationHub) {
  return {
    hub,
    watchInterests: {
      releaseSocket: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
  };
}

describe("client websocket protocol", () => {
  it("subscribes valid client messages parsed through the shared schema", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toMatchObject({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["events-appended"],
    });
  });

  /**
   * `/ws` is not under `/api/v1`, so the request gate never sees it, and a
   * subscription is the whole of what it carries inward. A plugin subscribing
   * past its grants would be the one unpoliced route to the data the
   * permission names.
   */
  describe("a socket a plugin opened", () => {
    function pluginDeps(hub: NotificationHub, granted: string[]) {
      return {
        ...createProtocolDeps(hub),
        plugins: {
          apiPermissionProblem: (
            _id: string,
            required: readonly string[] | null,
          ) =>
            (required ?? []).every((permission) => granted.includes(permission))
              ? null
              : "missing",
        },
      };
    }

    function subscribe(
      deps: ReturnType<typeof pluginDeps>,
      socket: ReturnType<typeof createMockHubSocket>,
      target: unknown,
    ) {
      onClientSocketMessage(
        deps,
        socket,
        JSON.stringify({ type: "subscribe", target }),
      );
    }

    it("is refused a feed the plugin did not declare", () => {
      const hub = new NotificationHub();
      const warn = vi.fn();
      const deps = { ...pluginDeps(hub, ["workspace"]), logger: { warn } };
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket, "notes");

      subscribe(deps, socket, { kind: "thread-detail", threadId: "t1" });
      hub.notifyThread("t1", ["events-appended"]);

      expect(socket.messages).toHaveLength(0);
      // Refused, not fatal: other feeds on this socket keep working.
      expect(socket.closed).toHaveLength(0);
      // And not silent: this protocol has no error frame, so the only way a
      // refusal is findable at all is that the server says it happened.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("thread-detail"),
      );
    });

    it("keeps the feeds it did declare", () => {
      const hub = new NotificationHub();
      const deps = pluginDeps(hub, ["workspace"]);
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket, "notes");

      subscribe(deps, socket, { kind: "host-list" });
      hub.notifyHost("h1", ["host-connected"]);

      expect(socket.messages).toHaveLength(1);
    });

    it("admits the thread feed once the plugin declares it", () => {
      const hub = new NotificationHub();
      const deps = pluginDeps(hub, ["threads"]);
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket, "notes");

      subscribe(deps, socket, { kind: "thread-detail", threadId: "t1" });
      hub.notifyThread("t1", ["events-appended"]);

      expect(socket.messages).toHaveLength(1);
    });

    // The app and the CLI open the same endpoint and are not plugins.
    it("leaves a socket nobody claimed alone", () => {
      const hub = new NotificationHub();
      const deps = pluginDeps(hub, []);
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket);

      subscribe(deps, socket, { kind: "thread-detail", threadId: "t1" });
      hub.notifyThread("t1", ["events-appended"]);

      expect(socket.messages).toHaveLength(1);
    });
  });

  it("rejects subscribe messages whose target id is not a string", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: 123 },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("removes subscriptions after unsubscribe messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects subscribe messages for unknown targets", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "bogus" },
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects client messages with missing required fields", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("closes the socket instead of throwing on malformed JSON", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);

    expect(() => onClientSocketMessage(deps, socket, "{")).not.toThrow();
    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
  });

  it("updates watch interests from subscribe and unsubscribe messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );

    expect(deps.watchInterests.subscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
    expect(deps.watchInterests.unsubscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
  });

  it("rejects direct watch messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "watch.acquire",
        target: {
          kind: "environment-workspace",
          environmentId: "env-1",
        },
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(deps.watchInterests.subscribe).not.toHaveBeenCalled();
  });
});
