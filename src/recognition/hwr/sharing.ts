/**
 * "Help improve Grape": sharing handwriting the user has already labelled,
 * so the next Grape learns more hands than its makers'. Opt-in with one
 * choice, with a review the user may open before any send, and stoppable
 * and deletable at any time (research/review/help-improve-grape.html).
 *
 * Three kinds of labelled ink, shared together:
 *
 * - **practice**: lines copied on a practice sheet (symbol sheet included).
 *   FineNotes chose the text, so it says nothing about the writer but how
 *   they write;
 * - **word**: a word Grape misread and the user corrected, or one they
 *   confirmed as a slip of the pen;
 * - **equation**: a piece of a calculation note's sum, as the user corrected
 *   or accepted it.
 *
 * Never shared: words the user only confirmed as real words Grape's list
 * lacks ("ignore" answers outside calculation notes). They are mostly names
 * and course terms, and with one choice for everything nobody would see
 * them go (Joost, 2026-11-16: one choice, review optional).
 *
 * What an item carries is exactly what the review sheet shows: the ink
 * (moved to start at 0, 0, its times made relative) and its text. A
 * correction's note path and page id, stroke ids and everything else stay
 * on the device. A test pins that.
 *
 * The ledger (`shared.json`, beside `corrections.json`) records the
 * consent, the contributor id and its deletion key, and which items were
 * sent or declined. It lives in the vault so every device of one vault
 * shares one contributor and never sends an item twice.
 *
 * PURE: no DOM, no Obsidian. Ids are SHA-256 through `crypto.subtle`, which
 * Obsidian's web views and Node both have.
 */

import type { Correction, CorrectionKind, CorrectionsFile } from "./corrections";

/** The kinds of labelled ink that are shared. */
export type ShareKind = "practice" | "word" | "equation";

export const SHARE_KINDS: readonly ShareKind[] = ["practice", "word", "equation"];

/**
 * The consent's wording version. A change to what is shared, why, or under
 * what licence raises it, and everyone who agreed to an older one is asked
 * again before anything more is sent.
 */
export const CONSENT_VERSION = 4;

/**
 * What donors agree to (Joost's choice, 2026-11-16, replacing CC0): the
 * items stay private, used only to train and test Grape and in Joost's
 * research; never published as a dataset. Only the Grape models trained on
 * them are released, under Apache 2.0.
 *
 * Version 3 (2026-11-19): to check that each label matches its ink, an item
 * may be shown to Anthropic's Claude through its API, as a picture of the ink
 * and its text only, under Anthropic's commercial terms (no training on it).
 * Items shared under `finenotes-grape-private-1` never are.
 *
 * Version 4 (2026-11-23): items may also train FineNotes' handwriting
 * writer (neatening, rewriting a corrected word in its writer's hand,
 * made-up lines that train Grape), released like Grape and holding no
 * contributor's style; made-up lines in contributors' styles stay private
 * and may be checked by Claude too; a reading the user acted on counts as
 * labelled; training may run on Google Cloud in the EU. Agreeing after an
 * older version covers what was already shared ({@link SharingLedger.upgradeOwed}).
 */
export const SHARE_LICENCE = "finenotes-grape-private-3";

/** What changed in the terms, as the "terms changed" dialog lists it. */
export type ConsentChange = "anthropic" | "writer" | "madeUp" | "used" | "cloud";

/**
 * The changes since consent version `from`, oldest first: what someone who
 * agreed to `from` has not agreed to yet.
 */
export function consentChanges(from: number): ConsentChange[] {
  const out: ConsentChange[] = [];
  if (from < 3) out.push("anthropic");
  if (from < 4) out.push("writer", "madeUp", "used", "cloud");
  return out;
}

/** The batch format, read by the server and the rig. */
export const SHARE_FORMAT = "finenotes-ink-share/1";

/** Most bytes of JSON in one request: the server refuses more. */
export const MAX_BATCH_BYTES = 256 * 1024;

/** One stroke of a shared item. */
export interface ShareStroke {
  /** x, y, pressure, …, page px, moved so the item's ink starts at 0, 0. */
  pts: number[];
  /** ms after the item's first stroke began; null when unknown. */
  t0: number | null;
  /**
   * The pen's raw samples (x, y, pressure, ms, …), moved like `pts`. Only
   * practice sheets keep them.
   */
  samples?: number[];
}

/** One labelled piece of ink, as it is sent. */
export interface ShareItem {
  /** `sha256:` of the kind, text and ink: the same item from two devices is one item. */
  id: string;
  kind: ShareKind;
  /** What the ink says. */
  text: string;
  /** A correction's or equation's reading by Grape, when it differed from `text`. */
  read?: string;
  /** How a correction was answered. */
  answer?: CorrectionKind;
  /** A practice line's set (100: the symbol sheet). */
  set?: number;
  /** What a practice sheet was written on and with ("ipad", "pen"). */
  device?: string;
  input?: string;
  strokes: ShareStroke[];
}

/** A practice line as the plugin reads it from a sheet. */
export interface PracticeSource {
  text: string;
  set: number | null;
  device?: string;
  input?: string;
  strokes: ReadonlyArray<{ pts: ArrayLike<number>; t0?: number | null; samples?: number[] }>;
}

export interface SharingConsent {
  /** {@link CONSENT_VERSION} when it was given. */
  version: number;
  /** ms since the epoch. */
  at: number;
}

export interface SharingLedger {
  version: 1;
  /**
   * When this contributor began (ms): a delete starts a new one. Two
   * ledgers merge by keeping the newer epoch whole, so a device that missed
   * a delete cannot bring the deleted ids back.
   */
  epoch: number;
  /** Random, made on the device: `c_` and 16 base-32 characters. Null until the first agreement. */
  contributor: string | null;
  /** The secret that proves the contributor to the server (it stores only its hash). */
  key: string | null;
  /** Null when sharing is off (never on, or stopped). */
  consent: SharingConsent | null;
  /**
   * Whether the one-time invite (after a learning run that helped) was
   * shown and answered: it is never shown again on any device of the vault.
   */
  invited: boolean;
  /** Item ids the server has. */
  sent: string[];
  /** Item ids the user unticked in a review: never offered again. */
  declined: string[];
  /**
   * A delete asked for and not yet confirmed by the server (ms), with the
   * contributor and key it is for: sent again until it succeeds.
   */
  pendingDelete: { at: number; contributor: string; key: string } | null;
  /**
   * When the last delete the server confirmed was asked for (ms; 0: none).
   * A merge drops a pending delete at or before it, so a copy synced before
   * the confirmation cannot bring the finished delete back.
   */
  deletedAt: number;
  /**
   * The consent version the server must still be told covers what this
   * contributor already shared (0: nothing owed). Set when someone who
   * agreed to an older version agrees to this one; sent again until the
   * server confirms, as a delete is.
   */
  upgradeOwed: number;
}

export function emptyLedger(now = 0): SharingLedger {
  return {
    version: 1,
    epoch: now,
    contributor: null,
    key: null,
    consent: null,
    invited: false,
    sent: [],
    declined: [],
    pendingDelete: null,
    deletedAt: 0,
    upgradeOwed: 0,
  };
}

/** Whether sharing is on under the consent wording in use now. */
export function sharingOn(ledger: SharingLedger): boolean {
  return ledger.consent !== null && ledger.consent.version === CONSENT_VERSION;
}

/**
 * Read a ledger, keeping what is well formed. A file that is not one reads
 * as empty: sharing is off until the user agrees again, which is the safe
 * side of a broken file.
 */
export function parseLedger(raw: string | null): SharingLedger {
  const out = emptyLedger();
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(data)) return out;
  if (typeof data.epoch === "number" && Number.isFinite(data.epoch)) out.epoch = data.epoch;
  if (typeof data.contributor === "string" && CONTRIBUTOR.test(data.contributor)) {
    out.contributor = data.contributor;
  }
  if (typeof data.key === "string" && data.key.length >= 32) out.key = data.key;
  // A contributor without its key (or the reverse) cannot send or delete.
  if (!out.contributor || !out.key) {
    out.contributor = null;
    out.key = null;
  }
  const consent = data.consent;
  if (
    isRecord(consent) &&
    typeof consent.version === "number" &&
    typeof consent.at === "number" &&
    out.contributor
  ) {
    out.consent = { version: consent.version, at: consent.at };
  }
  out.invited = data.invited === true;
  out.sent = ids(data.sent);
  out.declined = ids(data.declined);
  const pending = data.pendingDelete;
  if (
    isRecord(pending) &&
    typeof pending.at === "number" &&
    typeof pending.contributor === "string" &&
    CONTRIBUTOR.test(pending.contributor) &&
    typeof pending.key === "string"
  ) {
    out.pendingDelete = { at: pending.at, contributor: pending.contributor, key: pending.key };
  }
  if (typeof data.deletedAt === "number" && Number.isFinite(data.deletedAt)) {
    out.deletedAt = data.deletedAt;
  }
  if (out.pendingDelete && out.pendingDelete.at <= out.deletedAt) out.pendingDelete = null;
  if (
    typeof data.upgradeOwed === "number" &&
    Number.isInteger(data.upgradeOwed) &&
    data.upgradeOwed > 0 &&
    out.contributor
  ) {
    out.upgradeOwed = data.upgradeOwed;
  }
  return out;
}

export function serializeLedger(ledger: SharingLedger): string {
  return `${JSON.stringify(ledger, null, 1)}\n`;
}

/**
 * Two copies of the ledger as one (this device's and the one sync brought).
 * The newer epoch wins whole; at the same epoch the sent and declined ids
 * are joined, the newer consent is kept, and a pending delete is kept
 * unless either copy knows the server confirmed it.
 */
export function mergeLedgers(a: SharingLedger, b: SharingLedger): SharingLedger {
  const deletedAt = Math.max(a.deletedAt, b.deletedAt);
  const owed = (...pending: SharingLedger["pendingDelete"][]): SharingLedger["pendingDelete"] =>
    pending.find((p) => p !== null && p.at > deletedAt) ?? null;
  if (a.epoch !== b.epoch) {
    const newer = a.epoch > b.epoch ? a : b;
    const older = newer === a ? b : a;
    // A delete the older copy still owes is not lost with it. An upgrade it
    // owed was for the contributor that delete ended, so it goes.
    return {
      ...newer,
      pendingDelete: owed(newer.pendingDelete, older.pendingDelete),
      deletedAt,
    };
  }
  const contributor = a.contributor ?? b.contributor;
  const key = a.contributor ? a.key : b.key;
  const consent =
    a.consent && b.consent
      ? a.consent.at >= b.consent.at
        ? a.consent
        : b.consent
      : (a.consent ?? b.consent);
  return {
    version: 1,
    epoch: a.epoch,
    contributor,
    key,
    consent: contributor ? consent : null,
    invited: a.invited || b.invited,
    sent: union(a.sent, b.sent),
    declined: union(a.declined, b.declined).filter(
      (id) => !a.sent.includes(id) && !b.sent.includes(id),
    ),
    pendingDelete: owed(a.pendingDelete, b.pendingDelete),
    deletedAt,
    upgradeOwed: contributor ? Math.max(a.upgradeOwed, b.upgradeOwed) : 0,
  };
}

/**
 * The ledger after the user agrees: a contributor is made on first
 * agreement (`random` gives the bytes).
 */
export function agree(
  ledger: SharingLedger,
  now: number,
  random: (bytes: number) => Uint8Array,
): SharingLedger {
  const contributor = ledger.contributor ?? `c_${base32(random(10))}`;
  const key = ledger.key ?? base32(random(32));
  // Agreeing after an older version covers what was already shared (the
  // dialog says so): the server is told, once it can be reached.
  const upgrading =
    ledger.consent !== null && ledger.consent.version < CONSENT_VERSION && ledger.sent.length > 0;
  return {
    ...ledger,
    contributor,
    key,
    consent: { version: CONSENT_VERSION, at: now },
    invited: true,
    upgradeOwed: upgrading ? CONSENT_VERSION : ledger.upgradeOwed,
  };
}

/** The server confirmed that the consent now covers what was shared before. */
export function upgradeDone(ledger: SharingLedger, version: number): SharingLedger {
  return ledger.upgradeOwed <= version ? { ...ledger, upgradeOwed: 0 } : ledger;
}

/** The invite was answered with "Not now": it is not shown again. */
export function inviteDismissed(ledger: SharingLedger): SharingLedger {
  return { ...ledger, invited: true };
}

/** Stop sharing: nothing more is sent. What was sent stays, and can still be deleted. */
export function stopSharing(ledger: SharingLedger): SharingLedger {
  return { ...ledger, consent: null };
}

/**
 * Ask to delete everything shared: sharing stops, a new epoch begins (so
 * nothing sent before is remembered as sent), and the delete is owed to the
 * server until it confirms.
 */
export function requestDelete(ledger: SharingLedger, now: number): SharingLedger {
  const owed =
    ledger.contributor && ledger.key
      ? { at: now, contributor: ledger.contributor, key: ledger.key }
      : ledger.pendingDelete;
  return {
    ...emptyLedger(now),
    declined: [...ledger.declined],
    pendingDelete: owed,
    deletedAt: ledger.deletedAt,
  };
}

/** The server confirmed the delete. */
export function deleteDone(ledger: SharingLedger): SharingLedger {
  const at = ledger.pendingDelete?.at ?? 0;
  return { ...ledger, pendingDelete: null, deletedAt: Math.max(ledger.deletedAt, at) };
}

/** The ledger after items were sent (the server answered for them). */
export function markSent(ledger: SharingLedger, sent: readonly string[]): SharingLedger {
  return { ...ledger, sent: union(ledger.sent, sent) };
}

/** The ledger after a review: unticked items are never offered again. */
export function markDeclined(ledger: SharingLedger, declined: readonly string[]): SharingLedger {
  return { ...ledger, declined: union(ledger.declined, declined) };
}

// ---------------------------------------------------------------------------
// Items

/** Characters of a calculation: digits, operators, brackets, a letter for a variable. */
const MATHS_LABEL = /^[\d\s+\-−*×·÷/=().,^%<>≤≥≠±√πa-zA-Z]*$/u;

/** Whether a correction's label is a piece of a sum rather than a word. */
export function isEquationLabel(text: string): boolean {
  return MATHS_LABEL.test(text) && /[\d+\-−*×·÷/=^]/u.test(text) && !/[a-zA-Z]{2,}/.test(text);
}

/**
 * Which kind of share a correction is; null for one that is never shared:
 * a word only confirmed as real (mostly names and course terms).
 */
export function correctionKind(c: Pick<Correction, "kind" | "text" | "source">): ShareKind | null {
  if (c.source === "calc" || isEquationLabel(c.text)) return "equation";
  return c.kind === "ignore" ? null : "word";
}

/** An item before its id: what the review shows and the batch carries. */
export type ShareDraft = Omit<ShareItem, "id">;

/** The practice lines as items. Lines without ink, or without text, are none. */
export function practiceDrafts(lines: readonly PracticeSource[]): ShareDraft[] {
  const out: ShareDraft[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    const strokes = normalise(line.strokes);
    if (!text || strokes.length === 0) continue;
    const draft: ShareDraft = { kind: "practice", text, strokes };
    if (line.set !== null) draft.set = line.set;
    if (line.device) draft.device = line.device;
    if (line.input) draft.input = line.input;
    out.push(draft);
  }
  return out;
}

/** The corrections as items, one each. */
export function correctionDrafts(file: CorrectionsFile): ShareDraft[] {
  const out: ShareDraft[] = [];
  for (const c of file.corrections) {
    const kind = correctionKind(c);
    const strokes = normalise(c.strokes);
    if (!kind || strokes.length === 0) continue;
    const draft: ShareDraft = {
      kind,
      text: c.text,
      answer: c.kind,
      strokes,
    };
    if (c.read !== c.text) draft.read = c.read;
    out.push(draft);
  }
  return out;
}

/** The items with their ids, the same item (by id) once. */
export async function withIds(drafts: readonly ShareDraft[]): Promise<ShareItem[]> {
  const out: ShareItem[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const id = await itemId(draft);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...draft });
  }
  return out;
}

/**
 * An item's id: SHA-256 of its kind, text and ink. Nothing about where it
 * came from goes in, so the same ink synced to two devices has one id, and
 * the id says nothing the item does not.
 */
export async function itemId(draft: ShareDraft): Promise<string> {
  const canonical = JSON.stringify([draft.kind, draft.text, draft.strokes.map((s) => s.pts)]);
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The items still to send: neither sent nor unticked in a review. */
export function pendingItems(items: readonly ShareItem[], ledger: SharingLedger): ShareItem[] {
  const done = new Set([...ledger.sent, ...ledger.declined]);
  return items.filter((item) => !done.has(item.id));
}

/** How many items of each kind. */
export function countByKind(items: readonly ShareItem[]): Record<ShareKind, number> {
  const out: Record<ShareKind, number> = { practice: 0, word: 0, equation: 0 };
  for (const item of items) out[item.kind]++;
  return out;
}

// ---------------------------------------------------------------------------
// Batches

export interface ShareClient {
  /** FineNotes' version. */
  app: string;
  /** The Grape the device reads with ("grape-2.0"), or null. */
  grape: string | null;
  /** "ipad", "iphone", "android", "desktop". */
  device: string;
}

export interface ShareBatch {
  format: typeof SHARE_FORMAT;
  contributor: string;
  consent: {
    version: number;
    licence: typeof SHARE_LICENCE;
  };
  client: ShareClient;
  items: ShareItem[];
}

/**
 * The items cut into batches of at most {@link MAX_BATCH_BYTES}. An item
 * too big for a batch of its own (a practice line written very slowly, with
 * thousands of samples) is left out and returned in `tooBig`. Null when
 * sharing is off: nothing is sent without consent.
 */
export function buildBatches(
  items: readonly ShareItem[],
  ledger: SharingLedger,
  client: ShareClient,
): { batches: ShareBatch[]; tooBig: ShareItem[] } | null {
  if (!sharingOn(ledger) || !ledger.contributor || !ledger.consent) return null;
  const head = (): ShareBatch => ({
    format: SHARE_FORMAT,
    contributor: ledger.contributor as string,
    consent: {
      version: CONSENT_VERSION,
      licence: SHARE_LICENCE,
    },
    client: { ...client },
    items: [],
  });
  const encoder = new TextEncoder();
  const empty = encoder.encode(JSON.stringify(head())).length;
  const batches: ShareBatch[] = [];
  const tooBig: ShareItem[] = [];
  let batch = head();
  let size = empty;
  for (const item of items) {
    const bytes = encoder.encode(JSON.stringify(item)).length + 1;
    if (empty + bytes > MAX_BATCH_BYTES) {
      tooBig.push(item);
      continue;
    }
    if (size + bytes > MAX_BATCH_BYTES) {
      batches.push(batch);
      batch = head();
      size = empty;
    }
    batch.items.push(item);
    size += bytes;
  }
  if (batch.items.length > 0) batches.push(batch);
  return { batches, tooBig };
}

// ---------------------------------------------------------------------------
// Helpers

const CONTRIBUTOR = /^c_[a-z2-7]{16}$/;

/**
 * The strokes moved so the ink starts at 0, 0, rounded (1/100 px, pressure
 * to 1/1000), times made relative to the first stroke. Where on the page
 * the word was written stays on the device.
 */
function normalise(
  strokes: ReadonlyArray<{ pts: ArrayLike<number>; t0?: number | null; samples?: number[] }>,
): ShareStroke[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let first = Number.POSITIVE_INFINITY;
  const whole = strokes.filter((s) => s.pts.length >= 3);
  for (const s of whole) {
    const usable = s.pts.length - (s.pts.length % 3);
    for (let i = 0; i < usable; i += 3) {
      // A poisoned point is dropped with its stroke below; it must not move the origin.
      if (Number.isFinite(s.pts[i]) && Number.isFinite(s.pts[i + 1])) {
        minX = Math.min(minX, s.pts[i]);
        minY = Math.min(minY, s.pts[i + 1]);
      }
    }
    if (typeof s.t0 === "number" && Number.isFinite(s.t0)) first = Math.min(first, s.t0);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return [];
  const out: ShareStroke[] = [];
  for (const s of whole) {
    const usable = s.pts.length - (s.pts.length % 3);
    const pts: number[] = [];
    let finite = true;
    for (let i = 0; i < usable; i += 3) {
      const x = s.pts[i];
      const y = s.pts[i + 1];
      const p = s.pts[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p)) finite = false;
      pts.push(round(x - minX, 100), round(y - minY, 100), round(p, 1000));
    }
    if (!finite) continue;
    const t0 =
      typeof s.t0 === "number" && Number.isFinite(s.t0) && Number.isFinite(first)
        ? Math.round(s.t0 - first)
        : null;
    const stroke: ShareStroke = { pts, t0 };
    if (s.samples && s.samples.length >= 4 && s.samples.length % 4 === 0) {
      const samples: number[] = [];
      for (let i = 0; i < s.samples.length; i += 4) {
        samples.push(
          round(s.samples[i] - minX, 100),
          round(s.samples[i + 1] - minY, 100),
          round(s.samples[i + 2], 1000),
          Math.round(s.samples[i + 3]),
        );
      }
      if (samples.every(Number.isFinite)) stroke.samples = samples;
    }
    out.push(stroke);
  }
  return out;
}

function round(value: number, per: number): number {
  return Math.round(value * per) / per;
}

function base32(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((v): v is string => typeof v === "string" && v.startsWith("sha256:"))),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
