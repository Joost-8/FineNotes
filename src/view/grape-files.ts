/**
 * Grape (the handwriting recognizer model), downloaded on first use into
 * `<plugin>/handwriting/` (registered with the shared ModelRegistry,
 * model-downloads.ts).
 *
 * While a release still bundles Grape (`BUNDLE_GRAPE`, esbuild.config.mjs),
 * the bundled copy is written there in the background (`bridge`), verified
 * like a download: people who update then have the file before the release
 * that stops bundling it, and vault sync carries it to their other devices.
 * Only a fresh install of a release without the bundle sees the download card.
 */

import { bundleFormatOf } from "../recognition/hwr/bundle";
import { GRAPE_MODEL } from "../recognition/hwr/grape-model";
import type { AssetStore } from "../downloads/model-store";
import type { ModelRegistry } from "./model-downloads";
import { bundledGrape } from "./grape-bundle";

/** How long a "not here" answer is trusted before the folder is looked at again (vault sync). */
const RECHECK_MS = 30_000;

export class GrapeFiles {
  readonly model: AssetStore;
  private lastCheck = 0;
  private bridging: Promise<boolean> | null = null;

  constructor(private readonly registry: ModelRegistry) {
    this.model = registry.register(GRAPE_MODEL, { formatOf: bundleFormatOf });
  }

  /** Look at the folder again when the last look found nothing usable a while ago. */
  private async fresh(): Promise<void> {
    const stale = this.model.state.kind !== "ready" && Date.now() - this.lastCheck > RECHECK_MS;
    if (stale) this.lastCheck = Date.now();
    await this.model.check(stale);
  }

  /**
   * Write the bundled copy to the folder when no verified file is there (a
   * build that bundles Grape only). True when Grape is on disk afterwards.
   */
  bridge(): Promise<boolean> {
    this.bridging ??= (async () => {
      const bytes = await bundledGrape();
      if (!bytes) return false;
      return this.model.adopt(GRAPE_MODEL.files[0].name, bytes);
    })().finally(() => {
      this.bridging = null;
    });
    return this.bridging;
  }

  /**
   * The model to load, or null after offering the download (`how`: "auto"
   * for features that run by themselves, which stay quiet after Not now).
   */
  async source(
    how: "auto" | "ask" = "auto",
  ): Promise<{ key: string; read: () => Promise<ArrayBuffer> } | null> {
    await this.fresh();
    let file = await this.model.file();
    // Asked for before the background bridge ran: write the bundled copy now.
    if (!file && (await this.bridge())) file = await this.model.file();
    if (!file) {
      this.registry.offer(GRAPE_MODEL.id, how);
      return null;
    }
    return {
      key: `grape:${file}`,
      read: async () => {
        const bytes = await this.model.bytes();
        if (bytes) return bytes;
        // Gone since it was found: look again next time.
        await this.model.check(true);
        throw new Error("Grape is not on this device");
      },
    };
  }

  /** Offer the download (the settings switches call this with "ask"). */
  offer(how: "auto" | "ask"): void {
    this.registry.offer(GRAPE_MODEL.id, how);
  }
}
