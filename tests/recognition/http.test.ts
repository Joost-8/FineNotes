/**
 * `http.ts` against a fake `requestUrl`: what each helper hands Obsidian, and
 * that a request which never reached a server comes back as a
 * `ConnectionError` while an HTTP error status comes back as a response.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

const obsidian = await import("obsidian");
const { ConnectionError, postBytes, postJson } = await import("../../src/recognition/http");

const requestUrl = vi.mocked(obsidian.requestUrl);
let sent: RequestUrlParam[] = [];
const notFound = {
  status: 404,
  headers: {},
  text: "",
  json: null,
} as unknown as RequestUrlResponse;

/** Make `requestUrl` fail the way a refused or unreachable connection does. */
function failWith(reason: unknown): void {
  requestUrl.mockImplementation((() =>
    Promise.reject(reason)) as unknown as typeof obsidian.requestUrl);
}

beforeEach(() => {
  sent = [];
  requestUrl.mockReset();
  requestUrl.mockImplementation(((param: RequestUrlParam) => {
    sent.push(param);
    return Promise.resolve(notFound);
  }) as typeof obsidian.requestUrl);
});

describe("postJson", () => {
  it("POSTs the body as JSON text and never lets requestUrl throw on a status", async () => {
    const result = await postJson("https://x.test/v1", { authorization: "Bearer k" }, { a: [1] });
    expect(result).toBe(notFound);
    expect(sent).toEqual([
      {
        url: "https://x.test/v1",
        method: "POST",
        headers: { authorization: "Bearer k" },
        body: '{"a":[1]}',
        throw: false,
      },
    ]);
  });

  it("turns a request that never arrived into a ConnectionError with its message", async () => {
    failWith(new Error("net::ERR_CONNECTION_REFUSED"));
    const failure = postJson("http://localhost:1/v1", {}, {});
    await expect(failure).rejects.toBeInstanceOf(ConnectionError);
    await expect(failure).rejects.toThrow("net::ERR_CONNECTION_REFUSED");
  });

  it("keeps a thrown non-Error's text", async () => {
    failWith("offline");
    await expect(postJson("http://localhost:1/v1", {}, {})).rejects.toThrow("offline");
  });
});

describe("postBytes", () => {
  it("sends exactly the bytes of the view, with the content type in its own field", async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    await postBytes("https://x.test/upload", { "x-goog-api-key": "k" }, "audio/m4a", view);
    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request).toMatchObject({
      url: "https://x.test/upload",
      method: "POST",
      headers: { "x-goog-api-key": "k" },
      contentType: "audio/m4a",
      throw: false,
    });
    expect(request.body).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(request.body as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("reports a failed connection the same way", async () => {
    failWith(new Error("TLS handshake failed"));
    await expect(postBytes("https://x.test", {}, "text/plain", new Uint8Array(1))).rejects.toThrow(
      ConnectionError,
    );
  });
});
