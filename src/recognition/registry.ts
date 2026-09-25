/**
 * The transcription engines by id. The plugin starts from the manual engine
 * and adds cloud AI to the map on load (`main.ts`); the settings store the id
 * of the one to use. Pure: no DOM, no Obsidian.
 */

import type { RecognitionProvider } from "./provider";
import { MANUAL_PROVIDER_ID, manualProvider } from "./manual";
import { LLM_PROVIDER_ID } from "./llm-request";

/** A fresh map holding the manual engine. */
export function createProviderRegistry(): Map<string, RecognitionProvider> {
  return new Map([[MANUAL_PROVIDER_ID, manualProvider]]);
}

/**
 * The engine stored under `id`. A saved id this build does not have — the
 * on-device "trocr-local" engine, since removed, or anything hand-edited into
 * data.json — means manual. A `Map` has no inherited keys, so an id such as
 * "toString" cannot resolve to something that is not an engine.
 */
export function resolveProvider(
  registry: ReadonlyMap<string, RecognitionProvider>,
  id: string,
): RecognitionProvider {
  return registry.get(id) ?? registry.get(MANUAL_PROVIDER_ID) ?? manualProvider;
}

const LABELS: ReadonlyMap<string, string> = new Map([
  [MANUAL_PROVIDER_ID, "Manual — you type the text yourself"],
  [LLM_PROVIDER_ID, "Cloud AI — with your own API key"],
]);

/** The engine's name in the settings dropdown; an unknown id shows as itself. */
export function providerLabel(id: string): string {
  return LABELS.get(id) ?? id;
}
