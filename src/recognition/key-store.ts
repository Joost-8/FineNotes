/**
 * Where API keys live.
 *
 * Up to 0.4 every key sat in plain text in the plugin's `data.json`, which is
 * a vault file: it syncs with the vault and lands in every backup of it.
 * Obsidian 1.11.4 added `app.secretStorage` (the "Keychain" settings page),
 * which keeps secrets outside the vault files, and FineNotes keeps its keys
 * there. The manifest requires Obsidian 1.13.0, so the keychain should always
 * be present; the `data.json` store below is only the fallback for one that
 * is missing or lacks the methods this module calls.
 *
 * One slot per vendor, so the text vendor and the image vendor can hold
 * different keys, and so a key is only ever sent to the vendor it belongs to.
 * The `custom` slot is the self-hosted endpoint's key and is never sent
 * anywhere else (the property `llmCustomApiKey` existed to protect).
 *
 * No DOM, no Obsidian imports: the secret storage is passed in by shape.
 */

import type { LlmVendor } from "./llm-request";

/** The subset of Obsidian's `SecretStorage` this module relies on. */
export interface SecretStorageLike {
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
}

export interface KeyStore {
  /** True when keys are kept outside the vault's files. */
  readonly secure: boolean;
  /** The key for `slot`, or "" when none is set. */
  get(slot: LlmVendor): string;
  /** Store a key. True only once it reads back identical. */
  set(slot: LlmVendor, key: string): boolean;
  /** Forget a key. True when the slot now reads as empty. */
  remove(slot: LlmVendor): boolean;
}

/** Keychain id per slot: "lowercase alphanumeric with optional dashes". */
export function secretIdFor(slot: LlmVendor): string {
  return `goodobsidian-${slot}-api-key`;
}

/** Keys in Obsidian's keychain (1.11.4+). */
export class SecretKeyStore implements KeyStore {
  readonly secure = true;

  constructor(private readonly storage: SecretStorageLike) {}

  get(slot: LlmVendor): string {
    try {
      return (this.storage.getSecret(secretIdFor(slot)) ?? "").trim();
    } catch {
      return "";
    }
  }

  set(slot: LlmVendor, key: string): boolean {
    const value = key.trim();
    if (!value) return this.remove(slot);
    try {
      this.storage.setSecret(secretIdFor(slot), value);
    } catch {
      return false;
    }
    return this.get(slot) === value;
  }

  remove(slot: LlmVendor): boolean {
    // SecretStorage has no delete; an empty secret is what "no key" reads as.
    try {
      this.storage.setSecret(secretIdFor(slot), "");
    } catch {
      return false;
    }
    return this.get(slot) === "";
  }
}

/**
 * Keys in the plugin's settings, when there is no usable keychain. The record
 * is the live settings object; `save` persists it.
 */
export class SettingsKeyStore implements KeyStore {
  readonly secure = false;

  constructor(
    private readonly keys: Partial<Record<LlmVendor, string>>,
    private readonly save: () => void,
  ) {}

  get(slot: LlmVendor): string {
    const value = this.keys[slot];
    return typeof value === "string" ? value.trim() : "";
  }

  set(slot: LlmVendor, key: string): boolean {
    const value = key.trim();
    if (value) this.keys[slot] = value;
    else delete this.keys[slot];
    this.save();
    return this.get(slot) === value;
  }

  remove(slot: LlmVendor): boolean {
    return this.set(slot, "");
  }
}

/** The settings fields keys were kept in before 0.5 (and without a keychain). */
export interface LegacyKeyFields {
  llmVendor: LlmVendor;
  llmApiKey: string;
  llmCustomApiKey: string;
  apiKeys?: Partial<Record<LlmVendor, string>>;
}

export type LegacySource =
  { field: "llmApiKey" } | { field: "llmCustomApiKey" } | { field: "apiKeys"; slot: LlmVendor };

export interface KeyMigrationStep {
  slot: LlmVendor;
  key: string;
  from: LegacySource;
}

/**
 * Best guess at which vendor issued a key, from its documented prefix, or
 * null. Only used where the settings cannot say (see {@link planKeyMigration}).
 */
export function guessVendorFromKey(key: string): LlmVendor | null {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("AIza")) return "google";
  if (k.startsWith("sk-")) return "openai";
  return null;
}

/**
 * What to move where. `llmApiKey` was the key of whichever cloud vendor was
 * selected, so it belongs to that vendor's slot. When the selected vendor is
 * the custom endpoint, the field still holds the last *cloud* key, and only
 * its prefix can say whose it is; an unrecognisable one is left in place,
 * where it keeps working exactly as before (see `resolveKey` in main.ts).
 *
 * With `secure` false (no keychain) the plaintext `apiKeys` record *is* the
 * store, so only the two pre-0.5 fields move.
 */
export function planKeyMigration(legacy: LegacyKeyFields, secure: boolean): KeyMigrationStep[] {
  const steps: KeyMigrationStep[] = [];
  const cloudKey = legacy.llmApiKey.trim();
  if (cloudKey) {
    const slot = legacy.llmVendor !== "custom" ? legacy.llmVendor : guessVendorFromKey(cloudKey);
    if (slot) steps.push({ slot, key: cloudKey, from: { field: "llmApiKey" } });
  }
  const customKey = legacy.llmCustomApiKey.trim();
  if (customKey) steps.push({ slot: "custom", key: customKey, from: { field: "llmCustomApiKey" } });
  if (secure) {
    for (const [slot, key] of Object.entries(legacy.apiKeys ?? {})) {
      if (typeof key === "string" && key.trim()) {
        steps.push({
          slot: slot as LlmVendor,
          key: key.trim(),
          from: { field: "apiKeys", slot: slot as LlmVendor },
        });
      }
    }
  }
  return steps;
}

/**
 * Run a migration plan against `store`, blanking each legacy field only once
 * its key is confirmed stored. A slot that already holds a key keeps it (it
 * was set after the legacy copy, so it is the newer one) and the stale
 * plaintext copy is still cleared. Returns how many keys left the plaintext
 * fields, so the caller can say so once.
 */
export function migrateKeys(legacy: LegacyKeyFields, store: KeyStore): number {
  let moved = 0;
  for (const step of planKeyMigration(legacy, store.secure)) {
    const stored = store.get(step.slot) !== "" || store.set(step.slot, step.key);
    if (!stored) continue;
    switch (step.from.field) {
      case "llmApiKey":
        legacy.llmApiKey = "";
        break;
      case "llmCustomApiKey":
        legacy.llmCustomApiKey = "";
        break;
      case "apiKeys":
        if (legacy.apiKeys) delete legacy.apiKeys[step.from.slot];
        break;
    }
    moved++;
  }
  return moved;
}
