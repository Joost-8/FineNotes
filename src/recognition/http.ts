/**
 * POSTs to the AI services, through Obsidian's `requestUrl`: the web view
 * blocks cross-origin `fetch` to them, on the iPad as on the desktop.
 *
 * `throw: false` makes every HTTP status an ordinary response for the caller
 * to read. What still rejects is a request that never got an answer at all —
 * refused, unreachable, DNS, TLS — and that comes back as a
 * `ConnectionError`, so callers can tell "the server said no" from "there is
 * no server".
 */

import { type RequestUrlParam, type RequestUrlResponse, requestUrl } from "obsidian";
import { errorMessage } from "../util/errors";

/** No reply came back: the connection itself failed. */
export class ConnectionError extends Error {}

async function post(param: Omit<RequestUrlParam, "method" | "throw">): Promise<RequestUrlResponse> {
  try {
    return await requestUrl({ ...param, method: "POST", throw: false });
  } catch (error) {
    throw new ConnectionError(errorMessage(error));
  }
}

/** POST `body` as JSON. */
export function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<RequestUrlResponse> {
  return post({ url, headers, body: JSON.stringify(body) });
}

/**
 * POST bytes that are already encoded (a multipart form, JSON as UTF-8).
 * The content type goes in `requestUrl`'s own field, the one that reaches
 * the wire on both desktop and mobile.
 */
export function postBytes(
  url: string,
  headers: Record<string, string>,
  contentType: string,
  body: Uint8Array,
): Promise<RequestUrlResponse> {
  // `requestUrl` wants an ArrayBuffer of exactly the body — never the
  // Uint8Array's whole backing buffer, which may be larger.
  const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  return post({ url, headers, contentType, body: buffer as ArrayBuffer });
}
