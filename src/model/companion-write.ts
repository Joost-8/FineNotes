/** Journalled, same-folder staging: a failed render/write never truncates the good PDF. */
import type { CompanionEntry } from "./companion-pdf";

export interface CompanionWriteIO {
  exists: (path: string) => boolean;
  create: (path: string, bytes: Uint8Array) => Promise<void>;
  identity: (path: string) => Promise<string | null>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  persist: () => Promise<void>;
}

export async function recoverCompanionWrite(
  entry: CompanionEntry,
  id: string,
  io: CompanionWriteIO,
): Promise<void> {
  const tx = entry.transaction;
  if (!tx) return;
  if (
    entry.pdfPath !== tx.target &&
    io.exists(entry.pdfPath) &&
    (await io.identity(entry.pdfPath)) === id
  ) {
    for (const path of [tx.stage, tx.backup]) if (io.exists(path)) await io.remove(path);
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
  } else
    throw new Error(
      "Companion replacement recovery is incomplete; the previous PDF backup is preserved.",
    );
}

export async function replaceCompanionPdf(
  entry: CompanionEntry,
  bytes: Uint8Array,
  id: string,
  io: CompanionWriteIO,
): Promise<void> {
  await recoverCompanionWrite(entry, id, io);
  const target = entry.pdfPath;
  const stage = `${target}.fn-${id}-pending.pdf`;
  const backup = `${target}.fn-${id}-backup.pdf`;
  if (io.exists(stage) || io.exists(backup))
    throw new Error("A companion staging/backup path is occupied. Resolve it before updating.");
  if (io.exists(target) && (await io.identity(target)) !== id)
    throw new Error("Refusing to replace an unrelated PDF.");
  entry.transaction = { target, stage, backup };
  // Persist recovery paths before any binary write or rename.
  await io.persist();
  try {
    await io.create(stage, bytes);
    if ((await io.identity(stage)) !== id)
      throw new Error("Staged companion PDF did not validate.");
    if (entry.pdfPath !== target)
      throw new Error("Companion moved during replacement; retry at its new path.");
    if (io.exists(target)) {
      if ((await io.identity(target)) !== id)
        throw new Error("Companion target changed during export.");
      await io.rename(target, backup);
    }
    await io.rename(stage, target);
    if ((await io.identity(target)) !== id)
      throw new Error("Companion replacement did not validate.");
    if (io.exists(backup)) await io.remove(backup);
    delete entry.transaction;
    await io.persist();
  } catch (error) {
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
