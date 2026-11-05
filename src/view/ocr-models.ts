/**
 * "Remove other OCR models" (Settings › Pages and notebooks › OCR model):
 * the models of the other choices and the folder of the first release leave
 * this device, only because the user asked. Switching the choice itself
 * never deletes anything.
 *
 * What the chosen model needs stays: the detector and the WebAssembly binary
 * are shared by every choice (model-manifest.ts `shared`), so a model's
 * removal leaves them.
 */

import { formatSize } from "../downloads/model-manifest";
import { t, tn } from "../i18n/translate";
import { OCR_OBSOLETE_FOLDERS, OCR_TIERS } from "../recognition/ocr/ocr-model";

/** What is needed of a registered model's store. */
export interface RemovableModel {
  readonly asset: {
    id: string;
    files: readonly { name: string; bytes: number }[];
    shared?: { files: readonly string[] };
  };
  readonly state: { kind: string };
  check(again?: boolean): Promise<unknown>;
  remove(): Promise<void>;
}

export interface OcrCleanupDeps {
  /** The registered store of a model, by its id. */
  store(id: string): RemovableModel | undefined;
  /** Folders are relative to the plugin's folder. */
  folderExists(folder: string): Promise<boolean>;
  removeFolder(folder: string): Promise<void>;
}

export interface OcrCleanupResult {
  /** The models removed, by id. */
  models: string[];
  /** The obsolete folders removed. */
  folders: string[];
  /** Bytes freed by the models (not counting the shared files, which stay). */
  bytes: number;
}

/** Bytes a model's removal frees: its files, but not the ones other models share. */
function ownBytes(model: RemovableModel): number {
  const shared = new Set(model.asset.shared?.files);
  return model.asset.files.filter((f) => !shared.has(f.name)).reduce((n, f) => n + f.bytes, 0);
}

/** Remove every OCR model but `activeId`'s, and the obsolete folders. */
export async function removeOtherOcrModels(
  activeId: string,
  deps: OcrCleanupDeps,
): Promise<OcrCleanupResult> {
  const result: OcrCleanupResult = { models: [], folders: [], bytes: 0 };
  for (const tier of OCR_TIERS) {
    if (tier.asset.id === activeId) continue;
    const model = deps.store(tier.asset.id);
    if (!model) continue;
    await model.check(true);
    // Only what is on this device; a download in flight is left running.
    if (model.state.kind === "missing" || model.state.kind === "unknown") continue;
    if (model.state.kind === "downloading" || model.state.kind === "verifying") continue;
    const had = model.state.kind === "ready";
    await model.remove();
    result.models.push(tier.asset.id);
    if (had) result.bytes += ownBytes(model);
  }
  for (const folder of OCR_OBSOLETE_FOLDERS) {
    if (!(await deps.folderExists(folder))) continue;
    await deps.removeFolder(folder);
    result.folders.push(folder);
  }
  return result;
}

/** What the notice says. */
export function cleanupText(result: OcrCleanupResult): string {
  const models = result.models.length;
  const folders = result.folders.length > 0;
  if (models === 0) return folders ? t("ai.ocr.removedOldFolder") : t("ai.ocr.noOtherModels");
  const size = formatSize(result.bytes);
  return folders
    ? tn("ai.ocr.removedModelsAndFolder", models, { size })
    : tn("ai.ocr.removedModels", models, { size });
}
