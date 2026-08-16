import { describe, expect, it } from "vitest";
import {
  rebuildHttpRequest,
  rebuildHttpResponse,
  reduceHttpRequest,
  reduceHttpResponse,
} from "../../../src/services/plugins/plugin-http-message.js";

/**
 * The message shape a plugin HTTP route reduces to, tested where naive
 * conversions break rather than on the happy path — a round trip of
 * `{"ok":true}` would pass with almost any implementation and prove nothing.
 */

describe("a request survives the round trip", () => {
  it("keeps method, url and a JSON body", async () => {
    const message = await reduceHttpRequest(
      new Request("http://127.0.0.1:3334/api/v1/plugins/notes/http/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
    );

    const rebuilt = rebuildHttpRequest(message);
    expect(rebuilt.method).toBe("POST");
    expect(rebuilt.url).toBe(
      "http://127.0.0.1:3334/api/v1/plugins/notes/http/events",
    );
    expect(rebuilt.headers.get("content-type")).toBe("application/json");
    expect(await rebuilt.json()).toEqual({ hello: "world" });
  });

  it("keeps the query string, which is part of the url and not a field", async () => {
    const message = await reduceHttpRequest(
      new Request("http://host/x?a=1&a=2&b=%20"),
    );

    const url = new URL(rebuildHttpRequest(message).url);
    expect(url.searchParams.getAll("a")).toEqual(["1", "2"]);
    expect(url.searchParams.get("b")).toBe(" ");
  });

  // Repeated ordinary headers arrive comma-joined, which is their wire form:
  // what matters is that the value survives, not that the pairs do.
  it("keeps a repeated header's full value", async () => {
    const headers = new Headers();
    headers.append("accept", "text/html");
    headers.append("accept", "application/json");
    const message = await reduceHttpRequest(
      new Request("http://host/x", { headers }),
    );

    expect(rebuildHttpRequest(message).headers.get("accept")).toBe(
      "text/html, application/json",
    );
  });

  it("carries a body that is bytes rather than text", async () => {
    const bytes = new Uint8Array([0, 159, 146, 150, 255]);
    const message = await reduceHttpRequest(
      new Request("http://host/x", { method: "POST", body: bytes }),
    );

    const rebuilt = new Uint8Array(
      await rebuildHttpRequest(message).arrayBuffer(),
    );
    expect([...rebuilt]).toEqual([...bytes]);
  });

  it("distinguishes no body from an empty one", async () => {
    const none = await reduceHttpRequest(new Request("http://host/x"));

    expect(none.body).toBeNull();
    expect(rebuildHttpRequest(none).body).toBeNull();
  });
});

describe("a response survives the round trip", () => {
  it("keeps status, status text and headers", async () => {
    const message = await reduceHttpResponse(
      Response.json({ ok: true }, { status: 201, statusText: "Created" }),
    );

    const rebuilt = rebuildHttpResponse(message);
    expect(rebuilt.status).toBe(201);
    expect(rebuilt.statusText).toBe("Created");
    expect(await rebuilt.json()).toEqual({ ok: true });
  });

  // Headers' own iterator joins set-cookie into one value, which would merge
  // two cookies into one unusable header.
  it("keeps several set-cookie headers apart", async () => {
    const response = new Response(null, {
      headers: [
        ["set-cookie", "a=1; Path=/"],
        ["set-cookie", "b=2; Path=/"],
      ],
    });

    const rebuilt = rebuildHttpResponse(await reduceHttpResponse(response));

    expect(rebuilt.headers.getSetCookie()).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });

  // The cost this shape charges, stated as a test rather than as prose: a
  // streaming body arrives whole on the far side.
  it("buffers a streaming body, which is the price of the boundary", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first "));
        controller.enqueue(new TextEncoder().encode("second"));
        controller.close();
      },
    });

    const message = await reduceHttpResponse(new Response(stream));

    expect(await rebuildHttpResponse(message).text()).toBe("first second");
    // Whole, not chunked: what the far side gets is a body, not a stream.
    expect(typeof message.body).toBe("string");
  });

  it("keeps a 204 without inventing a body", async () => {
    const message = await reduceHttpResponse(
      new Response(null, { status: 204 }),
    );

    expect(message.body).toBeNull();
    expect(rebuildHttpResponse(message).status).toBe(204);
  });
});
