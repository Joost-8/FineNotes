/**
 * Replacing a Companion PDF so a failed render or write never leaves the
 * good PDF truncated: the new PDF is written beside it (the stage), the old
 * one is moved aside (the backup), the stage takes its name, and the backup
 * goes. Each step is in the journal first, so an interrupted write is
 * finished at the next start.
 *
 * This device's own files are trusted by name (the stage and backup carry
 * its device id) and nothing it wrote is read back. Only the PDF at the
 * target is checked, by `owned`, before it is moved aside.
 */
import { CompanionError, type CompanionEntry, type CompanionTransaction } from "./companion-pdf";

export interface CompanionWriteIO {
  exists: (path: string) => boolean;
  /** Whether the PDF at `path` is this notebook's (its Subject names it). */
  owned: (path: string) => Promise<boolean>;
  create: (path: string, bytes: Uint8Array) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  /** Deletes outright (not to the trash): only this device's own stage and backup. */
  remove: (path: string) => Promise<void>;
  persist: () => void;
}

/** Finishes or undoes an interrupted write, from the journal alone. */
export async function recoverCompanionWrite(
  entry: CompanionEntry,
  io: CompanionWriteIO,
): Promise<void> {
  const tx = entry.transaction;
  if (!tx) return;
  if (!io.exists(tx.target)) {
    // The old PDF was moved aside, or the new one was complete: either is the PDF.
    if (io.exists(tx.backup)) await io.rename(tx.backup, tx.target);
    else if (tx.staged && io.exists(tx.stage)) await io.rename(tx.stage, tx.target);
  }
  await cleanUp(tx, io);
  delete entry.transaction;
  io.persist();
}

async function cleanUp(tx: CompanionTransaction, io: CompanionWriteIO): Promise<void> {
  for (const path of [tx.stage, tx.backup]) if (io.exists(path)) await io.remove(path);
}

/**
 * Writes `bytes` as the companion at `tx.target`. A PDF already there must
 * be this notebook's; anything else is refused (`occupied`) and left alone.
 */
export async function replaceCompanionPdf(
  entry: CompanionEntry,
  tx: CompanionTransaction,
  bytes: Uint8Array,
  io: CompanionWriteIO,
): Promise<void> {
  await recoverCompanionWrite(entry, io);
  if (io.exists(tx.target) && !(await io.owned(tx.target))) throw new CompanionError("occupied");
  await cleanUp(tx, io);
  entry.transaction = { ...tx };
  // The paths are in the journal before anything is written.
  io.persist();
  try {
    await io.create(tx.stage, bytes);
    entry.transaction.staged = true;
    io.persist();
    if (io.exists(tx.target)) await io.rename(tx.target, tx.backup);
    await io.rename(tx.stage, tx.target);
    if (io.exists(tx.backup)) await io.remove(tx.backup);
    delete entry.transaction;
    io.persist();
  } catch {
    // Put the old PDF back by a rename, never a second write; the journal
    // keeps whatever is left for the next start.
    try {
      if (!io.exists(tx.target) && io.exists(tx.backup)) await io.rename(tx.backup, tx.target);
      if (io.exists(tx.target)) await cleanUp(tx, io);
      if (!io.exists(tx.stage) && !io.exists(tx.backup)) delete entry.transaction;
      io.persist();
    } catch {
      /* Left to recovery at the next start. */
    }
    throw new CompanionError("write");
  }
}
