/** Journalled, same-folder staging: a failed render/write never truncates the good PDF. */
import { t } from "../i18n/translate";
import type { CompanionEntry } from "./companion-pdf";

export interface CompanionWriteIO {
  exists: (path: string) => boolean;
  create: (path: string, bytes: Uint8Array) => Promise<void>;
  identity: (path: string) => Promise<string | null>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  persist: () => Promise<void>;
  cancelled?: () => boolean;
}

export async function recoverCompanionWrite(
  entry: CompanionEntry,
  id: string,
  io: CompanionWriteIO,
): Promise<void> {
  const tx = entry.transaction;
  if (!tx) return;
  if (entry.pdfPath !== tx.target) {
    const moved = io.exists(entry.pdfPath) && (await io.identity(entry.pdfPath)) === id;
    for (const path of moved ? [tx.stage, tx.backup] : [tx.stage]) {
      if (io.exists(path) && (await io.identity(path)) === id) await io.remove(path);
    }
    // A backup at the old path may be the only good copy while the new path syncs.
    delete entry.transaction;
    await io.persist();
    return;
  }
  if (
    !io.exists(tx.target) &&
    !io.exists(tx.backup) &&
    (!io.exists(tx.stage) || (await io.identity(tx.stage)) !== id)
  ) {
    if (io.exists(tx.stage)) await io.remove(tx.stage);
    delete entry.transaction;
    await io.persist();
    return;
  }
  if (!io.exists(tx.target)) {
    if (io.exists(tx.backup) && (await io.identity(tx.backup)) === id)
      await io.rename(tx.backup, tx.target);
    else if (io.exists(tx.stage) && (await io.identity(tx.stage)) === id)
      await io.rename(tx.stage, tx.target);
  }
  if (io.exists(tx.target) && (await io.identity(tx.target)) === id) {
    for (const path of [tx.stage, tx.backup])
      if (io.exists(path) && (path === tx.stage || (await io.identity(path)) === id))
        await io.remove(path);
    delete entry.transaction;
    await io.persist();
  } else throw new Error(t("notebooks.companion.errBackupPreserved"));
}

export async function replaceCompanionPdf(
  entry: CompanionEntry,
  bytes: Uint8Array,
  id: string,
  io: CompanionWriteIO,
): Promise<boolean> {
  if (io.cancelled?.()) return false;
  await recoverCompanionWrite(entry, id, io);
  if (io.cancelled?.()) return false;
  const target = entry.pdfPath;
  const stage = `${target}.fn-${id}-pending.pdf`;
  const backup = `${target}.fn-${id}-backup.pdf`;
  if (io.exists(stage) || io.exists(backup))
    throw new Error(t("notebooks.companion.errStageOccupied"));
  const hadTarget = io.exists(target);
  if (hadTarget && (await io.identity(target)) !== id)
    throw new Error(t("notebooks.companion.errRefuseReplace"));
  let promoted = false;
  const cancel = async (): Promise<false> => {
    for (const path of promoted ? [stage, backup, target] : [stage, backup]) {
      if (io.exists(path) && (await io.identity(path)) === id) await io.remove(path);
    }
    delete entry.transaction;
    await io.persist();
    return false;
  };

  entry.transaction = { target, stage, backup };
  // Persist recovery paths before any binary write or rename.
  await io.persist();
  try {
    if (io.cancelled?.()) return await cancel();
    await io.create(stage, bytes);
    const stageId = await io.identity(stage);
    if (io.cancelled?.() || (hadTarget && !io.exists(target))) return await cancel();
    if (stageId !== id) throw new Error(t("notebooks.companion.errStageInvalid"));
    if (entry.pdfPath !== target) throw new Error(t("notebooks.companion.errMovedDuringWrite"));
    if (io.exists(target)) {
      if ((await io.identity(target)) !== id)
        throw new Error(t("notebooks.companion.errTargetChanged"));
      if (io.cancelled?.() || !io.exists(target)) return await cancel();
      await io.rename(target, backup);
    }
    if (io.cancelled?.()) return await cancel();
    await io.rename(stage, target);
    promoted = true;
    const targetId = await io.identity(target);
    if (io.cancelled?.()) return await cancel();
    if (targetId !== id) throw new Error(t("notebooks.companion.errReplacementInvalid"));
    if (io.exists(backup)) await io.remove(backup);
    delete entry.transaction;
    await io.persist();
    return true;
  } catch (error) {
    if (io.cancelled?.()) return cancel();
    // Restore via rename, not a second potentially partial binary write.
    if (!io.exists(target) && io.exists(backup) && (await io.identity(backup)) === id) {
      try {
        await io.rename(backup, target);
      } catch {
        /* Journal retains the recoverable previous PDF. */
      }
    }
    // Never remove an unverified file; leave the journal for recovery on next open.
    throw error;
  }
}
