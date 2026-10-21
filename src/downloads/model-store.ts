/**
 * Keeps one downloadable model (model-manifest.ts) in its folder: finds it,
 * verifies it, downloads it when asked, and says which files to read.
 *
 * - A file is used only once its size and SHA-256 match the manifest, also
 *   when it arrived by vault sync; a verified file is never downloaded again.
 * - Each file goes to `<name>.download` and is renamed into place only after
 *   it is verified, so a half-written file is never read.
 * - Files are asked for in byte ranges; a failed range is retried, and a
 *   retry of the whole download goes on from the bytes already in (and skips
 *   the files already stored).
 * - `adopt` stores bytes the plugin already has (a bundled copy), verified
 *   the same way, so an update that stops bundling a model needs no download.
 *
 * The folder, the network, the hash and the clock are passed in
 * (`AssetStoreDeps`), so this module needs neither Obsidian nor a DOM.
 */

import {
  type AssetEvent,
  type AssetState,
  type FailReason,
  type ModelAsset,
  type ModelFile,
  type OlderFile,
  isBusy,
  nextRange,
  storedVersions,
  totalBytes,
  transition,
  usableFile,
} from "./model-manifest";

export interface AssetStoreDeps {
  /** The names of the files in the model's folder ([] when it does not exist). */
  list(): Promise<string[]>;
  read(name: string): Promise<ArrayBuffer>;
  /** Write a file, creating the folder when needed. */
  write(name: string, data: ArrayBuffer): Promise<void>;
  /** Rename within the folder; the target does not exist. */
  rename(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
  /**
   * One GET. `range` asks for those bytes (inclusive). Resolves with any
   * HTTP status; rejects only when no answer came (offline, DNS, TLS).
   */
  get(
    url: string,
    range?: { start: number; end: number },
  ): Promise<{ status: number; body: ArrayBuffer }>;
  sha256(data: ArrayBuffer): Promise<string>;
  /** The format version a stored main file says it is in, or null when it is not this model. */
  formatOf(data: ArrayBuffer): number | null;
  sleep(ms: number): Promise<void>;
}

/** Tries per byte range before the download is given up, and the waits between them. */
export const RETRY_WAITS_MS = [1000, 3000];

class DownloadError extends Error {
  constructor(
    readonly reason: FailReason,
    detail: string,
  ) {
    super(detail);
  }
}

export class AssetStore {
  private current: AssetState = { kind: "unknown" };
  private readonly listeners = new Set<() => void>();
  private checking: Promise<AssetState> | null = null;
  private downloading: Promise<boolean> | null = null;
  /** Bytes of an interrupted download of `partialFile`, kept for the retry. */
  private partialFile: string | null = null;
  private partial: Uint8Array[] = [];
  private partialBytes = 0;

  constructor(
    readonly asset: ModelAsset,
    private readonly deps: AssetStoreDeps,
  ) {}

  get state(): AssetState {
    return this.current;
  }

  /** Called on every change of state; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: AssetEvent): void {
    const next = transition(this.current, event);
    if (next === this.current) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Look at the folder, once (`check(true)` to look again, after a sync or a removal). */
  check(again = false): Promise<AssetState> {
    if (isBusy(this.current)) return Promise.resolve(this.current);
    if (this.checking) return this.checking;
    if (!again && this.current.kind !== "unknown") return Promise.resolve(this.current);
    this.checking = this.look().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async look(): Promise<AssetState> {
    const { asset, deps } = this;
    const names = await this.names();
    const stored = storedVersions(asset, names);
    if (stored.current && (await this.allVerify())) {
      this.emit({ type: "found", found: "current" });
      return this.current;
    }
    let older: OlderFile | null = null;
    for (const other of stored.others) {
      try {
        const format = deps.formatOf(await deps.read(other.file));
        if (format === null) continue;
        older = { ...other, usable: format === asset.format };
        if (older.usable) break;
      } catch {
        // Unreadable: as if it were not there.
      }
    }
    this.emit({ type: "found", found: older ?? "none" });
    return this.current;
  }

  private async names(): Promise<string[]> {
    try {
      return await this.deps.list();
    } catch {
      return [];
    }
  }

  private async allVerify(): Promise<boolean> {
    for (const file of this.asset.files) if (!(await this.verifies(file))) return false;
    return true;
  }

  /** True when the stored file is exactly the pinned one. */
  private async verifies(file: ModelFile): Promise<boolean> {
    try {
      const data = await this.deps.read(file.name);
      if (data.byteLength !== file.bytes) return false;
      return (await this.deps.sha256(data)) === file.sha256;
    } catch {
      return false;
    }
  }

  /** The main file to read now, or null (missing, or only an unreadable older version). */
  async file(): Promise<string | null> {
    await this.check();
    return usableFile(this.asset, this.current);
  }

  /**
   * The bytes of a file of the model (the main one by default); null when
   * the model is not usable. An older version has only its main file.
   */
  async bytes(name?: string): Promise<ArrayBuffer | null> {
    const main = await this.file();
    if (!main) return null;
    if (name === undefined || name === this.asset.files[0]?.name) return this.deps.read(main);
    if (this.current.kind !== "ready" || !this.asset.files.some((f) => f.name === name))
      return null;
    return this.deps.read(name);
  }

  /**
   * Store bytes the plugin already has for file `name` (a bundled copy),
   * when they are exactly the pinned file and that file is not stored yet.
   * True when the model is ready afterwards. `bytes` is asked for only when
   * the file is not stored: decoding a bundled copy costs seconds on an
   * iPad, and this runs at every start-up.
   */
  async adopt(name: string, bytes: () => Promise<ArrayBuffer | null>): Promise<boolean> {
    const file = this.asset.files.find((f) => f.name === name);
    if (!file || isBusy(this.current) || this.downloading) return false;
    await this.check();
    if (this.current.kind === "ready") return true;
    let data: ArrayBuffer | null;
    try {
      data = await bytes();
    } catch {
      return false;
    }
    if (!data || data.byteLength !== file.bytes || (await this.deps.sha256(data)) !== file.sha256)
      return false;
    if (!(await this.verifies(file))) {
      try {
        await this.store(file.name, data);
      } catch {
        return false;
      }
    }
    const after = await this.check(true);
    if (after.kind === "ready") await this.removeOlder();
    return after.kind === "ready";
  }

  /**
   * Download, verify and store every file; true when the model is ready. A
   * second call while one runs joins it; once it is ready, nothing is fetched.
   */
  download(): Promise<boolean> {
    if (this.downloading) return this.downloading;
    this.downloading = (async () => {
      await this.check();
      if (this.current.kind === "ready") return true;
      this.emit({ type: "start" });
      try {
        const total = totalBytes(this.asset);
        let done = 0;
        for (const file of this.asset.files) {
          // Stored and verified by an earlier, interrupted run: keep it.
          if (await this.verifies(file)) {
            done += file.bytes;
            continue;
          }
          const data = await this.fetchFile(file, done, total);
          if (data.byteLength !== file.bytes || (await this.deps.sha256(data)) !== file.sha256) {
            this.dropPartial();
            throw new DownloadError("damaged", "size or checksum differs");
          }
          await this.store(file.name, data);
          this.dropPartial();
          done += file.bytes;
        }
        this.emit({ type: "received" });
        this.emit({ type: "verified" });
        await this.removeOlder();
        return true;
      } catch (error) {
        const failure =
          error instanceof DownloadError
            ? error
            : new DownloadError("storage", error instanceof Error ? error.message : String(error));
        this.emit({ type: "failed", reason: failure.reason, detail: failure.message });
        return false;
      }
    })().finally(() => {
      this.downloading = null;
    });
    return this.downloading;
  }

  private dropPartial(): void {
    this.partialFile = null;
    this.partial = [];
    this.partialBytes = 0;
  }

  /** Every byte of one file, in ranges, going on from an earlier attempt's. */
  private async fetchFile(file: ModelFile, before: number, total: number): Promise<ArrayBuffer> {
    if (this.partialFile !== file.name) {
      this.dropPartial();
      this.partialFile = file.name;
    }
    const progress = () =>
      this.emit({ type: "progress", received: before + this.partialBytes, total });
    progress();
    for (;;) {
      const range = nextRange(this.partialBytes, file.bytes, this.asset.chunkBytes);
      if (!range) break;
      const answer = await this.getWithRetry(file.url, range);
      if (answer.status === 200) {
        // The server ignored the range and sent the whole file.
        this.partial = [new Uint8Array(answer.body)];
        this.partialBytes = answer.body.byteLength;
        progress();
        break;
      }
      const expected = range.end - range.start + 1;
      if (answer.body.byteLength !== expected) {
        this.dropPartial();
        throw new DownloadError("damaged", "a piece arrived short");
      }
      this.partial.push(new Uint8Array(answer.body));
      this.partialBytes += expected;
      progress();
    }
    const out = new Uint8Array(this.partialBytes);
    let o = 0;
    for (const piece of this.partial) {
      out.set(piece, o);
      o += piece.byteLength;
    }
    return out.buffer;
  }

  private async getWithRetry(
    url: string,
    range: { start: number; end: number },
  ): Promise<{ status: number; body: ArrayBuffer }> {
    let last: DownloadError | null = null;
    for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
      if (attempt > 0) await this.deps.sleep(RETRY_WAITS_MS[attempt - 1] ?? 0);
      let answer: { status: number; body: ArrayBuffer };
      try {
        answer = await this.deps.get(url, range);
      } catch {
        last = new DownloadError("offline", "no connection");
        continue;
      }
      if (answer.status === 200 || answer.status === 206) return answer;
      last = new DownloadError("http", `HTTP ${answer.status}`);
      // A missing file stays missing: no point asking again.
      const status = answer.status;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) break;
    }
    throw last ?? new DownloadError("offline", "no connection");
  }

  /** Write through a temporary name, then move it into place. */
  private async store(name: string, data: ArrayBuffer): Promise<void> {
    const { deps } = this;
    const temp = `${name}.download`;
    await deps.write(temp, data);
    const names = await deps.list();
    if (names.includes(name)) await deps.remove(name);
    await deps.rename(temp, name);
  }

  /** Other versions of the main file: superseded once the current model is in. */
  private async removeOlder(): Promise<void> {
    const names = await this.names();
    for (const other of storedVersions(this.asset, names).others) {
      await this.deps.remove(other.file).catch(() => {});
    }
  }

  /** Remove the model's files and its other versions from this device. */
  async remove(): Promise<void> {
    if (isBusy(this.current)) return;
    const names = new Set(await this.names());
    for (const file of this.asset.files)
      if (names.has(file.name)) await this.deps.remove(file.name);
    for (const other of storedVersions(this.asset, [...names]).others)
      await this.deps.remove(other.file).catch(() => {});
    this.dropPartial();
    this.emit({ type: "removed" });
  }

  /** Remove and download again. */
  async redownload(): Promise<boolean> {
    await this.remove();
    return this.download();
  }
}
