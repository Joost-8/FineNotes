/**
 * The recognition engines and how the saved setting picks one: an id this
 * build does not know — the removed on-device "trocr-local", a typo, a key
 * that only an object's prototype has — means typing it yourself.
 */

import { describe, expect, it } from "vitest";
import type { RecognitionProvider } from "../../src/recognition/provider";
import { MANUAL_PROVIDER_ID } from "../../src/recognition/manual";
import {
  createProviderRegistry,
  providerLabel,
  resolveProvider,
} from "../../src/recognition/registry";
import { LLM_PROVIDER_ID } from "../../src/recognition/llm-request";

const cloud: RecognitionProvider = {
  id: LLM_PROVIDER_ID,
  requiresNetwork: true,
  recognize: () => Promise.resolve({ text: "from the cloud" }),
};

/** A registry as the plugin has it after `onload`: manual, plus cloud AI. */
function loaded(): Map<string, RecognitionProvider> {
  const engines = createProviderRegistry();
  engines.set(cloud.id, cloud);
  return engines;
}

describe("the registry", () => {
  it("starts with the manual engine alone, stored under 'manual'", () => {
    const fresh = createProviderRegistry();
    expect(MANUAL_PROVIDER_ID).toBe("manual");
    expect([...fresh.keys()]).toEqual([MANUAL_PROVIDER_ID]);
    expect(fresh.get(MANUAL_PROVIDER_ID)).toMatchObject({
      id: MANUAL_PROVIDER_ID,
      requiresNetwork: false,
    });
  });

  it("gives each registry its own map", () => {
    loaded();
    expect(createProviderRegistry().has(LLM_PROVIDER_ID)).toBe(false);
  });

  it("finds each engine by the id it is stored under", () => {
    const engines = loaded();
    expect(resolveProvider(engines, LLM_PROVIDER_ID)).toBe(cloud);
    expect(resolveProvider(engines, MANUAL_PROVIDER_ID)).toBe(engines.get(MANUAL_PROVIDER_ID));
  });

  it("falls back to manual for any id it does not hold", () => {
    const engines = loaded();
    for (const id of ["trocr-local", "", "Manual", "toString", "__proto__", "constructor"]) {
      expect(resolveProvider(engines, id).id, id).toBe(MANUAL_PROVIDER_ID);
    }
  });

  it("still answers with manual from an empty registry", () => {
    expect(resolveProvider(new Map(), "anything").id).toBe(MANUAL_PROVIDER_ID);
  });
});

describe("the manual engine", () => {
  it("transcribes nothing, offline", async () => {
    const manual = resolveProvider(loaded(), MANUAL_PROVIDER_ID);
    const result = await manual.recognize({
      strokes: [{ id: "s1", color: "#000", size: 2, tool: "pen", pts: [0, 0, 0.5] }],
      pageImage: { base64: "AAAA" },
    });
    expect(result).toEqual({ text: "" });
  });
});

describe("the dropdown labels", () => {
  it("describe the two engines", () => {
    expect(providerLabel(MANUAL_PROVIDER_ID)).toMatch(/^Manual\b/);
    expect(providerLabel(LLM_PROVIDER_ID)).toMatch(/^Cloud AI\b/);
    expect(providerLabel(LLM_PROVIDER_ID)).toMatch(/key/);
  });

  it("show an unknown id as it is", () => {
    for (const id of ["some-engine", "toString", ""]) expect(providerLabel(id), id).toBe(id);
  });
});
