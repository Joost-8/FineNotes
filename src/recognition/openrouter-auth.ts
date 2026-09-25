/**
 * OpenRouter's "Connect" button, the part that needs no network: PKCE
 * (RFC 7636, method S256) and the two OpenRouter endpoints it talks to.
 *
 * The round trip, which `main.ts` runs: open the approval page in the
 * browser with a challenge; OpenRouter sends the user back to
 * `obsidian://goodobsidian-openrouter?code=…`; POST that code with the
 * verifier the challenge came from, and get an API key that belongs to the
 * user. The verifier never leaves the device until that POST, so a code
 * intercepted on the way back is useless on its own.
 */

/**
 * The `obsidian://` action OpenRouter redirects to. Protocol actions are one
 * namespace for every plugin, hence the plugin's name in it.
 */
export const OPENROUTER_CALLBACK_ACTION = "goodobsidian-openrouter";

/** Unpadded base64url (RFC 4648 §5), the alphabet PKCE uses. */
function base64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary)
    .replace(/=+$/, "")
    .replace(/[+/]/g, (char) => (char === "+" ? "-" : "_"));
}

/** A fresh verifier: 32 random bytes, the length RFC 7636 §4.1 recommends. */
export function generateCodeVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The S256 challenge for `verifier`: its SHA-256, in base64url. */
export async function codeChallenge(verifier: string): Promise<string> {
  const ascii = new TextEncoder().encode(verifier);
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", ascii)));
}

/** The page where the user approves FineNotes in their OpenRouter account. */
export function buildOpenRouterAuthUrl(challenge: string): string {
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", `obsidian://${OPENROUTER_CALLBACK_ACTION}`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

/** A JSON POST, not yet sent. */
export interface KeyExchangeRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** The request that turns the code from the redirect into an API key. */
export function buildKeyExchangeRequest(code: string, verifier: string): KeyExchangeRequest {
  return {
    url: "https://openrouter.ai/api/v1/auth/keys",
    headers: { "content-type": "application/json" },
    body: { code, code_verifier: verifier, code_challenge_method: "S256" },
  };
}

/** The key in OpenRouter's reply to that request, or "" when there is none. */
export function extractOpenRouterKey(json: unknown): string {
  if (typeof json !== "object" || json === null || !("key" in json)) return "";
  return typeof json.key === "string" ? json.key : "";
}
