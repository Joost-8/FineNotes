/**
 * The files FineNotes downloads on first use instead of bundling them: Grape
 * (the handwriting recognizer model) and the word list that "Underline words
 * it may have misread" checks against. Each is pinned here by URL, byte size
 * and SHA-256, so a file is used only when it is exactly the one this build
 * was made with, wherever it came from (a download, or vault sync from
 * another device).
 *
 * Also here: the state each file is in (`AssetState`, moved on by
 * `transition`), what the settings row says about it, and the byte ranges a
 * download asks for.
 *
 * PURE: no DOM, no Obsidian, no network.
 */

/** A downloadable file, as this build expects it. */
export interface Asset {
  id: "grape" | "words";
  /** What the user is told it is. */
  label: string;
  version: string;
  url: string;
  /** Size in bytes. */
  bytes: number;
  /** Lower-case hex. */
  sha256: string;
  /**
   * The file format this build reads. A stored file of another version is
   * still used while its format matches; once it does not, it must be
   * downloaded again.
   */
  format: number;
  /** The stored file's name, in the plugin's `handwriting/` folder. */
  file: string;
  /** Names of this asset's other versions: `prefix<version>suffix`. */
  prefix: string;
  suffix: string;
}

/** Grape 1.0, as published at Joost-8/Grape (Apache 2.0). */
export const GRAPE_MODEL: Asset = {
  id: "grape",
  label: "Grape (handwriting recognizer model)",
  version: "1.0",
  url: "https://github.com/Joost-8/Grape/releases/download/v1.0/grape-1.0.bin",
  bytes: 3_500_236,
  sha256: "87a9ddd56b6bcf01e66a027ff74f1b8ba9a58fe0d4b0077e6abb6455710d21f9",
  format: 1,
  file: "grape-1.0.bin",
  prefix: "grape-",
  suffix: ".bin",
};

/** The public word list, built by scripts/build-words.mjs from the rig's LM text only. */
export const WORD_LIST: Asset = {
  id: "words",
  label: "Word list",
  version: "1",
  url: "https://github.com/Joost-8/Grape/releases/download/words-1/words-1.txt",
  bytes: 221_681,
  sha256: "2d1520ac9f674c520c53f4928b9bab3874a33e1ebf9a702e4cb6ad3e4c62ed01",
  format: 1,
  file: "words-1.txt",
  prefix: "words-",
  suffix: ".txt",
};

export const ASSETS: readonly Asset[] = [GRAPE_MODEL, WORD_LIST];

/** Why a download did not finish. */
export type FailReason = "offline" | "http" | "damaged" | "storage";

/** An older version on disk: its version, and whether this build can still read it. */
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
  | { kind: "downloading"; received: number; total: number; older?: OlderFile }
  | { kind: "verifying"; older?: OlderFile }
  | { kind: "ready" }
  | { kind: "failed"; reason: FailReason; detail: string; older?: OlderFile };

export type AssetEvent =
  /** What a look at the folder found: the verified file, an older one, or nothing. */
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

/** The file to read in this state: the current one, an older readable one, or none. */
export function usableFile(asset: Asset, state: AssetState): string | null {
  if (state.kind === "ready") return asset.file;
  const older = olderOf(state);
  return older?.usable ? older.file : null;
}

/** True while a download is running. */
export function isBusy(state: AssetState): boolean {
  return state.kind === "downloading" || state.kind === "verifying";
}

/** The version in a stored name of this asset ("grape-1.0.bin" → "1.0"), or null. */
export function versionOf(asset: Asset, name: string): string | null {
  if (!name.startsWith(asset.prefix) || !name.endsWith(asset.suffix)) return null;
  const version = name.slice(asset.prefix.length, name.length - asset.suffix.length);
  return /^[0-9][0-9A-Za-z.-]*$/.test(version) ? version : null;
}

/**
 * What the folder holds of this asset, from its file names: the current file
 * (still to be verified), and the other versions, newest first by name.
 */
export function storedVersions(
  asset: Asset,
  names: readonly string[],
): { current: boolean; others: { version: string; file: string }[] } {
  let current = false;
  const others: { version: string; file: string }[] = [];
  for (const name of names) {
    if (name === asset.file) {
      current = true;
      continue;
    }
    const version = versionOf(asset, name);
    if (version !== null) others.push({ version, file: name });
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

/** The settings row's line about an asset in this state. */
export function stateText(asset: Asset, state: AssetState): string {
  const size = formatSize(asset.bytes);
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
      return `Downloading… ${percent(state.received, state.total || asset.bytes)}% of ${size}`;
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
