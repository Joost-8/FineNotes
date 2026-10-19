/**
 * Models FineNotes downloads on first use instead of bundling them (Grape,
 * the handwriting recognizer; later Whisper for audio). Each is pinned by
 * the build that uses it: every file's URL, byte size and SHA-256, and the
 * format version that build reads. A file is used only when it is exactly
 * the pinned one, wherever it came from (a download, or vault sync from
 * another device).
 *
 * Also here: the state a model is in (`AssetState`, moved on by
 * `transition`), what the settings say about it, and the byte ranges a
 * download asks for. The model-specific entries live with their features
 * (recognition/hwr/grape-model.ts); this module knows none of them.
 *
 * PURE: no DOM, no Obsidian, no network.
 */

/** One file of a model. */
export interface ModelFile {
  /** Its name in the model's folder. */
  name: string;
  url: string;
  /** Size in bytes. */
  bytes: number;
  /** Lower-case hex. */
  sha256: string;
}

/** A downloadable model, as the build that uses it expects it. */
export interface ModelAsset {
  /** Stable id ("grape", "whisper-base"). */
  id: string;
  /** What the user is told it is. */
  label: string;
  /** One sentence: what it is for, shown on the download card. */
  purpose: string;
  version: string;
  /**
   * The file format this build reads. A stored older version is still used
   * while its format matches; once it does not, it must be downloaded again.
   */
  format: number;
  /** Its folder, relative to the plugin's folder ("handwriting"). */
  folder: string;
  /** Its files, at least one. The first is the main one: other versions are recognised by it. */
  files: readonly ModelFile[];
  /**
   * Other versions' main file is named `prefix<version>suffix`
   * ("grape-1.0.bin"); without these, other versions are not looked for.
   */
  prefix?: string;
  suffix?: string;
}

/** The model's total size in bytes. */
export function totalBytes(asset: ModelAsset): number {
  return asset.files.reduce((sum, file) => sum + file.bytes, 0);
}

/** Why a download did not finish. */
export type FailReason = "offline" | "http" | "damaged" | "storage";

/** An older version on disk: its version, its main file, and whether this build can still read it. */
export interface OlderFile {
  version: string;
  file: string;
  usable: boolean;
}

export type AssetState =
  /** Not looked for yet. */
  | { kind: "unknown" }
  | { kind: "missing" }
  /** Only another version is there: "needs update". */
  | { kind: "outdated"; older: OlderFile }
  /** `received` and `total` count every file of the model. */
  | { kind: "downloading"; received: number; total: number; older?: OlderFile }
  | { kind: "verifying"; older?: OlderFile }
  | { kind: "ready" }
  | { kind: "failed"; reason: FailReason; detail: string; older?: OlderFile };

export type AssetEvent =
  /** What a look at the folder found: every file verified, an older version, or nothing. */
  | { type: "found"; found: "current" | "none" | OlderFile }
  | { type: "start" }
  | { type: "progress"; received: number; total: number }
  | { type: "received" }
  | { type: "verified" }
  | { type: "failed"; reason: FailReason; detail: string }
  | { type: "removed" };

function olderOf(state: AssetState): OlderFile | undefined {
  return "older" in state ? state.older : undefined;
}

/**
 * The next state. An event that makes no sense in a state (progress while
 * ready, a second start while downloading) leaves it as it is.
 */
export function transition(state: AssetState, event: AssetEvent): AssetState {
  switch (event.type) {
    case "found":
      // A look at the folder never interrupts a download in flight.
      if (state.kind === "downloading" || state.kind === "verifying") return state;
      if (event.found === "current") return { kind: "ready" };
      if (event.found === "none") return { kind: "missing" };
      return { kind: "outdated", older: event.found };
    case "start":
      if (state.kind === "downloading" || state.kind === "verifying" || state.kind === "ready")
        return state;
      return withOlder({ kind: "downloading", received: 0, total: 0 }, olderOf(state));
    case "progress":
      if (state.kind !== "downloading") return state;
      return { ...state, received: event.received, total: event.total };
    case "received":
      if (state.kind !== "downloading") return state;
      return withOlder({ kind: "verifying" }, state.older);
    case "verified":
      if (state.kind !== "verifying") return state;
      return { kind: "ready" };
    case "failed":
      if (state.kind !== "downloading" && state.kind !== "verifying") return state;
      return withOlder(
        { kind: "failed", reason: event.reason, detail: event.detail },
        olderOf(state),
      );
    case "removed":
      if (state.kind === "downloading" || state.kind === "verifying") return state;
      return { kind: "missing" };
  }
}

function withOlder<T extends AssetState>(state: T, older: OlderFile | undefined): T {
  return older ? { ...state, older } : state;
}

/** The main file to read in this state: the current one, an older readable one, or none. */
export function usableFile(asset: ModelAsset, state: AssetState): string | null {
  if (state.kind === "ready") return asset.files[0]?.name ?? null;
  const older = olderOf(state);
  return older?.usable ? older.file : null;
}

/** True while a download is running. */
export function isBusy(state: AssetState): boolean {
  return state.kind === "downloading" || state.kind === "verifying";
}

/** The version in another version's main file name ("grape-0.9.bin" → "0.9"), or null. */
export function versionOf(asset: ModelAsset, name: string): string | null {
  const { prefix, suffix } = asset;
  if (prefix === undefined || suffix === undefined) return null;
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return null;
  const version = name.slice(prefix.length, name.length - suffix.length);
  return /^[0-9][0-9A-Za-z.-]*$/.test(version) ? version : null;
}

/**
 * What the folder holds of this model, from its file names: whether every
 * current file is there (still to be verified), and the other versions,
 * newest first.
 */
export function storedVersions(
  asset: ModelAsset,
  names: readonly string[],
): { current: boolean; others: { version: string; file: string }[] } {
  const present = new Set(names);
  const current = asset.files.length > 0 && asset.files.every((f) => present.has(f.name));
  const main = asset.files[0]?.name;
  const others: { version: string; file: string }[] = [];
  for (const name of names) {
    if (name === main) continue;
    const version = versionOf(asset, name);
    if (version !== null && version !== asset.version) others.push({ version, file: name });
  }
  others.sort((a, b) => compareVersions(b.version, a.version));
  return { current, others };
}

/** Compare dotted versions numerically where they are numbers ("1.10" > "1.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c;
  }
  return 0;
}

/** Bytes as "3.5 MB" or "222 KB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** What a failure means to the user, in one short sentence. */
export function failureText(reason: FailReason, detail: string): string {
  switch (reason) {
    case "offline":
      return "Downloads when you're online.";
    case "http":
      return `GitHub did not send the file (${detail}). Try again later.`;
    case "damaged":
      return "The download arrived damaged. Try again.";
    case "storage":
      return `The file could not be saved: ${detail}`;
  }
}

/** The settings line about a model in this state. */
export function stateText(asset: ModelAsset, state: AssetState): string {
  const size = formatSize(totalBytes(asset));
  switch (state.kind) {
    case "unknown":
      return "Checking…";
    case "missing":
      return `Not downloaded yet (${size}).`;
    case "outdated":
      return state.older.usable
        ? `Version ${state.older.version} is on this device; ${asset.version} is ready to download (${size}).`
        : `Version ${state.older.version} no longer works with this FineNotes: download ${asset.version} (${size}).`;
    case "downloading":
      return `Downloading… ${percent(state.received, state.total || totalBytes(asset))}% of ${size}`;
    case "verifying":
      return "Checking the download…";
    case "ready":
      return `Version ${asset.version}, ${size}, on this device.`;
    case "failed":
      return failureText(state.reason, state.detail);
  }
}

/** Whole percent, 0 to 100. */
export function percent(received: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((100 * received) / total)));
}

/** The download is asked for in pieces this big: progress, and a retry goes on where it stopped. */
export const CHUNK_BYTES = 512 * 1024;

/**
 * The next byte range to ask for (inclusive ends, as HTTP `Range` has them),
 * or null when every byte is in.
 */
export function nextRange(
  received: number,
  total: number,
  chunk = CHUNK_BYTES,
): { start: number; end: number } | null {
  if (received >= total) return null;
  return { start: received, end: Math.min(total, received + chunk) - 1 };
}

/** Bytes as lower-case hex (for a SHA-256 digest). */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}
