/**
 * The OpenRouter Connect flow's pure half: PKCE (RFC 7636) and OpenRouter's
 * two endpoints. `main.ts` does the browser round trip and the POST.
 */

import { describe, expect, it } from "vitest";
import {
  OPENROUTER_CALLBACK_ACTION,
  buildKeyExchangeRequest,
  buildOpenRouterAuthUrl,
  codeChallenge,
  extractOpenRouterKey,
  generateCodeVerifier,
} from "../../src/recognition/openrouter-auth";

function base64UrlBytes(text: string): number[] {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return [...atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))].map((c) => c.charCodeAt(0));
}

describe("the code verifier", () => {
  it("is 32 random bytes in unpadded base64url: 43 characters", () => {
    for (const fresh of Array.from({ length: 20 }, generateCodeVerifier)) {
      expect(fresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(base64UrlBytes(fresh)).toHaveLength(32);
    }
  });

  it("is new every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe("the S256 code challenge", () => {
  it("matches RFC 7636 appendix B", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("is base64url of SHA-256, without padding", async () => {
    // SHA-256("") = e3b0c442…b855, whose base64 uses both "+" and "/".
    expect(await codeChallenge("")).toBe("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  });
});

describe("OpenRouter's endpoints", () => {
  it("sends the user to openrouter.ai/auth with the callback and the challenge", () => {
    expect(OPENROUTER_CALLBACK_ACTION).toBe("goodobsidian-openrouter");
    expect(buildOpenRouterAuthUrl("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(
      "https://openrouter.ai/auth?callback_url=obsidian%3A%2F%2Fgoodobsidian-openrouter" +
        "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256",
    );
  });

  it("trades the code and verifier for a key at auth/keys", () => {
    expect(buildKeyExchangeRequest("the-code", "the-verifier")).toEqual({
      url: "https://openrouter.ai/api/v1/auth/keys",
      headers: { "content-type": "application/json" },
      body: { code: "the-code", code_verifier: "the-verifier", code_challenge_method: "S256" },
    });
  });

  it("reads the key from the reply, or nothing", () => {
    expect(extractOpenRouterKey({ key: "sk-or-v1-abc", user_id: "u" })).toBe("sk-or-v1-abc");
    for (const json of [null, undefined, "sk-or", 1, [], {}, { key: 42 }, { key: null }]) {
      expect(extractOpenRouterKey(json), JSON.stringify(json)).toBe("");
    }
  });
});
