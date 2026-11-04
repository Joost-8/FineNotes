/**
 * What the OCR service sees of the models: whichever one the setting
 * "OCR model" chooses now, with every model registered and listened to.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../fakes/obsidian"));
import { OCR_TIERS, effectiveOcrTier } from "../../src/recognition/ocr/ocr-model";
import { obsidianOcrDeps } from "../../src/view/ocr-deps";
import type { ModelAsset } from "../../src/downloads/model-manifest";

function fakeStore(asset: ModelAsset) {
  const listeners = new Set<() => void>();
  return {
    asset,
    state: { kind: "ready" as string },
    file: () => Promise.resolve(asset.id),
    bytes: (name?: string) =>
      Promise.resolve(new TextEncoder().encode(`${asset.id}/${name}`).buffer),
    check: vi.fn(() => Promise.resolve()),
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    fire: () => listeners.forEach((l) => l()),
    listeners,
  };
}

function setup(chosen: string, mobile = false) {
  const stores = new Map<string, ReturnType<typeof fakeStore>>();
  const offers: boolean[] = [];
  const host = {
    app: { vault: { adapter: {} } },
    pluginDir: () => "plugins/finenotes",
    models: {
      register: (asset: ModelAsset) => {
        const store = fakeStore(asset);
        stores.set(asset.id, store);
        return store;
      },
    },
    offer: (ask: boolean) => offers.push(ask),
    enabled: () => true,
    tier: () => effectiveOcrTier(chosen, mobile),
    mobile: () => mobile,
  };
  const { deps } = obsidianOcrDeps(host as never);
  return { deps, stores, offers, setChosen: (c: string) => (chosen = c) };
}

describe("obsidianOcrDeps", () => {
  it("registers every model this device offers: the largest not on a phone or tablet", () => {
    expect([...setup("fast").stores.keys()]).toEqual(OCR_TIERS.map((t) => t.asset.id));
    expect([...setup("fast", true).stores.keys()]).toEqual([
      OCR_TIERS[0].asset.id,
      OCR_TIERS[1].asset.id,
    ]);
  });

  it("follows the setting: the store, the offer and the model are the chosen one's", async () => {
    const r = setup("fast");
    expect(await r.deps.store.file()).toBe("ocr-ppocrv6");
    expect(r.deps.model?.()).toMatchObject({
      version: "ppocrv6-tiny-1",
      key: "ocr-ppocrv6:2",
      rec: "PP-OCRv6_tiny_rec.ort",
    });
    r.setChosen("most-accurate");
    expect(await r.deps.store.file()).toBe("ocr-ppocrv6-medium");
    expect(r.deps.model?.()).toMatchObject({
      version: "ppocrv6-medium-1",
      rec: "PP-OCRv6_medium_rec.ort",
      dict: "ppocrv6_dict.txt",
      confidence: { wordMean: 0.95, lineMean: 0.98, wordMin: 0.9 },
    });
    r.deps.offer();
    r.deps.offer(true);
    // The question about which reader to download is the plugin's (ocr-offer.ts).
    expect(r.offers).toEqual([false, true]);
  });

  it("hears any model arrive and stops hearing when told to", () => {
    const r = setup("accurate");
    const heard = vi.fn();
    const off = r.deps.store.subscribe(heard);
    r.stores.get("ocr-ppocrv6")?.fire();
    r.stores.get("ocr-ppocrv6-small")?.fire();
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    expect([...r.stores.values()].every((s) => s.listeners.size === 0)).toBe(true);
  });
});
