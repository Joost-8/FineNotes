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
 *
 * Grape 2 (preview) is opt-in (Settings › Handwriting): when it is chosen,
 * it is registered and read instead, from its own folder. It is never bundled.
 */

import { bundleFormatOf } from "../recognition/hwr/bundle";
import { GRAPE_MODEL, type GrapeChoice, grapeAsset } from "../recognition/hwr/grape-model";
import type { AssetStore } from "../downloads/model-store";
import type { ModelRegistry } from "./model-downloads";
import { bundledGrape } from "./grape-bundle";

/** How long a "not here" answer is trusted before the folder is looked at again (vault sync). */
const RECHECK_MS = 30_000;

export class GrapeFiles {
  /** Grape 1.0, always registered (the default, and the bundle's). */
  private readonly first: AssetStore;
  private lastCheck = 0;
  private bridging: Promise<boolean> | null = null;

  constructor(
    private readonly registry: ModelRegistry,
    private readonly choice: () => GrapeChoice | undefined = () => "grape",
  ) {
    this.first = registry.register(GRAPE_MODEL, { formatOf: bundleFormatOf });
  }

  /** The chosen Grape's store (registered on first use, so Models lists it once chosen). */
  get model(): AssetStore {
    const asset = grapeAsset(this.choice());
    if (asset.id === GRAPE_MODEL.id) return this.first;
    return this.registry.register(asset, { formatOf: bundleFormatOf });
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
      return this.first.adopt(GRAPE_MODEL.files[0].name, bytes);
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
    const model = this.model;
    let file = await model.file();
    // Asked for before the background bridge ran: write the bundled copy now.
    if (!file && model === this.first && (await this.bridge())) file = await model.file();
    if (!file) {
      this.registry.offer(model.asset.id, how);
      return null;
    }
    return {
      key: `${model.asset.id}:${file}`,
      read: async () => {
        const bytes = await model.bytes();
        if (bytes) return bytes;
        // Gone since it was found: look again next time.
        await model.check(true);
        throw new Error(`${model.asset.label} is not on this device`);
      },
    };
  }

  /** Offer the download (the settings switches call this with "ask"). */
  offer(how: "auto" | "ask"): void {
    this.registry.offer(this.model.asset.id, how);
  }

  /** The chosen Grape's id ("grape", "grape-2"): a learned model is used only with its own base. */
  get id(): string {
    return this.model.asset.id;
  }
}
