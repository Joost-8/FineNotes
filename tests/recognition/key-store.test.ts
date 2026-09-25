import { describe, expect, it } from "vitest";
import {
  type LegacyKeyFields,
  type SecretStorageLike,
  SecretKeyStore,
  SettingsKeyStore,
  guessVendorFromKey,
  migrateKeys,
  planKeyMigration,
  secretIdFor,
} from "../../src/recognition/key-store";
import type { LlmVendor } from "../../src/recognition/llm-request";

/** An in-memory stand-in for Obsidian's SecretStorage, with the same id rule. */
class FakeSecrets implements SecretStorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;
  /** Simulate a store that accepts a write but does not keep it. */
  dropWrites = false;

  setSecret(id: string, secret: string): void {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid secret id");
    if (this.failWrites) throw new Error("keychain locked");
    if (!this.dropWrites) this.map.set(id, secret);
  }

  getSecret(id: string): string | null {
    return this.map.get(id) ?? null;
  }
}

const legacy = (fields: Partial<LegacyKeyFields> = {}): LegacyKeyFields => ({
  llmVendor: "anthropic",
  llmApiKey: "",
  llmCustomApiKey: "",
  apiKeys: {},
  ...fields,
});

describe("secretIdFor", () => {
  it("is a valid, plugin-prefixed keychain id for every slot", () => {
    const slots: LlmVendor[] = ["anthropic", "openai", "google", "openrouter", "custom"];
    const secrets = new FakeSecrets();
    for (const slot of slots) {
      expect(secretIdFor(slot)).toBe(`goodobsidian-${slot}-api-key`);
      expect(() => secrets.setSecret(secretIdFor(slot), "x")).not.toThrow();
    }
  });
});

describe("SecretKeyStore", () => {
  it("stores, reads back and removes a key per slot", () => {
    const secrets = new FakeSecrets();
    const store = new SecretKeyStore(secrets);
    expect(store.secure).toBe(true);
    expect(store.get("openai")).toBe("");
    expect(store.set("openai", "  sk-proj-1  ")).toBe(true);
    expect(store.get("openai")).toBe("sk-proj-1");
    expect(store.get("anthropic")).toBe("");
    expect(store.remove("openai")).toBe(true);
    expect(store.get("openai")).toBe("");
    // Setting an empty key is a removal.
    store.set("google", "AIza1");
    expect(store.set("google", " ")).toBe(true);
    expect(store.get("google")).toBe("");
  });

  it("reports failure when the keychain throws or does not keep the key", () => {
    const secrets = new FakeSecrets();
    const store = new SecretKeyStore(secrets);
    secrets.failWrites = true;
    expect(store.set("openai", "sk-1")).toBe(false);
    expect(store.remove("openai")).toBe(false);
    secrets.failWrites = false;
    secrets.dropWrites = true;
    expect(store.set("openai", "sk-1")).toBe(false);
  });

  it("reads a throwing keychain as empty", () => {
    const store = new SecretKeyStore({
      setSecret: () => undefined,
      getSecret: () => {
        throw new Error("boom");
      },
    });
    expect(store.get("openai")).toBe("");
  });
});

describe("SettingsKeyStore", () => {
  it("keeps keys in the settings record and saves on every change", () => {
    const keys: Partial<Record<LlmVendor, string>> = {};
    let saves = 0;
    const store = new SettingsKeyStore(keys, () => saves++);
    expect(store.secure).toBe(false);
    expect(store.set("anthropic", " sk-ant-1 ")).toBe(true);
    expect(keys).toEqual({ anthropic: "sk-ant-1" });
    expect(store.get("anthropic")).toBe("sk-ant-1");
    expect(store.remove("anthropic")).toBe(true);
    expect(keys).toEqual({});
    expect(saves).toBe(2);
  });
});

describe("guessVendorFromKey", () => {
  it("recognises each vendor's documented prefix", () => {
    expect(guessVendorFromKey("sk-ant-api03-x")).toBe("anthropic");
    expect(guessVendorFromKey("sk-or-v1-x")).toBe("openrouter");
    expect(guessVendorFromKey("AIzaSyx")).toBe("google");
    expect(guessVendorFromKey("sk-proj-x")).toBe("openai");
    expect(guessVendorFromKey("sk-x")).toBe("openai");
    expect(guessVendorFromKey("hf_x")).toBeNull();
  });
});

describe("planKeyMigration", () => {
  it("files the old cloud key under the vendor that was selected", () => {
    expect(planKeyMigration(legacy({ llmVendor: "google", llmApiKey: " AIza1 " }), true)).toEqual([
      { slot: "google", key: "AIza1", from: { field: "llmApiKey" } },
    ]);
  });

  it("guesses by prefix when the custom endpoint was selected, and leaves an unknown key alone", () => {
    expect(
      planKeyMigration(legacy({ llmVendor: "custom", llmApiKey: "sk-or-v1-a" }), true),
    ).toEqual([{ slot: "openrouter", key: "sk-or-v1-a", from: { field: "llmApiKey" } }]);
    expect(planKeyMigration(legacy({ llmVendor: "custom", llmApiKey: "mystery" }), true)).toEqual(
      [],
    );
  });

  it("moves the endpoint key to its own slot, never a cloud one", () => {
    expect(planKeyMigration(legacy({ llmCustomApiKey: "local-secret" }), true)).toEqual([
      { slot: "custom", key: "local-secret", from: { field: "llmCustomApiKey" } },
    ]);
  });

  it("moves the plaintext per-vendor record only when there is a keychain", () => {
    const fields = legacy({ apiKeys: { openai: "sk-1", google: " " } });
    expect(planKeyMigration(fields, true)).toEqual([
      { slot: "openai", key: "sk-1", from: { field: "apiKeys", slot: "openai" } },
    ]);
    expect(planKeyMigration(fields, false)).toEqual([]);
  });
});

describe("migrateKeys", () => {
  it("blanks each plaintext copy only after the keychain holds it", () => {
    const fields = legacy({
      llmVendor: "openai",
      llmApiKey: "sk-1",
      llmCustomApiKey: "local",
      apiKeys: { google: "AIza1" },
    });
    const secrets = new FakeSecrets();
    expect(migrateKeys(fields, new SecretKeyStore(secrets))).toBe(3);
    expect(fields.llmApiKey).toBe("");
    expect(fields.llmCustomApiKey).toBe("");
    expect(fields.apiKeys).toEqual({});
    expect(secrets.getSecret("goodobsidian-openai-api-key")).toBe("sk-1");
    expect(secrets.getSecret("goodobsidian-custom-api-key")).toBe("local");
    expect(secrets.getSecret("goodobsidian-google-api-key")).toBe("AIza1");
  });

  it("keeps the plaintext key when the keychain fails, so nothing is lost", () => {
    const fields = legacy({ llmVendor: "openai", llmApiKey: "sk-1" });
    const secrets = new FakeSecrets();
    secrets.dropWrites = true;
    expect(migrateKeys(fields, new SecretKeyStore(secrets))).toBe(0);
    expect(fields.llmApiKey).toBe("sk-1");
  });

  it("does not overwrite a newer key already in the slot, but clears the stale copy", () => {
    const secrets = new FakeSecrets();
    secrets.setSecret("goodobsidian-openai-api-key", "sk-new");
    const fields = legacy({ llmVendor: "openai", llmApiKey: "sk-old" });
    expect(migrateKeys(fields, new SecretKeyStore(secrets))).toBe(1);
    expect(secrets.getSecret("goodobsidian-openai-api-key")).toBe("sk-new");
    expect(fields.llmApiKey).toBe("");
  });

  it("on old Obsidian, moves the pre-0.5 fields into the per-vendor record", () => {
    const fields = legacy({ llmVendor: "anthropic", llmApiKey: "sk-ant-1", llmCustomApiKey: "x" });
    const store = new SettingsKeyStore(fields.apiKeys ?? {}, () => undefined);
    expect(migrateKeys(fields, store)).toBe(2);
    expect(fields.apiKeys).toEqual({ anthropic: "sk-ant-1", custom: "x" });
    expect(fields.llmApiKey).toBe("");
    // Idempotent: a second load has nothing left to move.
    expect(migrateKeys(fields, store)).toBe(0);
  });
});
