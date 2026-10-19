/**
 * Keeps one downloadable file (model-manifest.ts) in the plugin's
 * `handwriting/` folder: finds it, verifies it, downloads it when asked, and
 * says which file to read.
 *
 * - A file is used only once its size and SHA-256 match the manifest, also
 *   when it arrived by vault sync; a verified file is never downloaded again.
 * - A download goes to `<file>.download` and is renamed into place only
 *   after it is verified, so a half-written file is never read.
 * - It is asked for in byte ranges; a failed range is retried, and a retry
 *   of the whole download goes on from the bytes already in.
 *
 * The folder, the network, the hash and the clock are passed in
 * (`AssetStoreDeps`), so this module needs neither Obsidian nor a DOM.
 */

import {
  type Asset,
  type AssetEvent,
  type AssetState,
  type FailReason,
  type OlderFile,
  isBusy,
  nextRange,
  storedVersions,
  transition,
  usableFile,
} from "./model-manifest";

export interface AssetStoreDeps {
  /** The names of the files in the folder ([] when it does not exist). */
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
  /** The format version a stored file says it is in, or null when it is not this asset. */
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
  /** Bytes of an interrupted download, kept for the retry. */
  private partial: Uint8Array[] = [];
  private partialBytes = 0;

  constructor(
    readonly asset: Asset,
    private readonly deps: AssetStoreDeps,
  ) {}

  get state(): AssetState {
    return this.current;
  }

  /** Called on every change of state; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    let names: string[] = [];
    try {
      names = await deps.list();
    } catch {
      names = [];
    }
    const stored = storedVersions(asset, names);
    if (stored.current && (await this.verifies(asset.file))) {
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

  /** True when the stored file is exactly the pinned one. */
  private async verifies(name: string): Promise<boolean> {
    try {
      const data = await this.deps.read(name);
      if (data.byteLength !== this.asset.bytes) return false;
      return (await this.deps.sha256(data)) === this.asset.sha256;
    } catch {
      return false;
    }
  }

  /** The file to read now, or null (missing, or only an unreadable older version). */
  async file(): Promise<string | null> {
    await this.check();
    return usableFile(this.asset, this.current);
  }

  /** The bytes of the file to read; null when there is none. */
  async bytes(): Promise<ArrayBuffer | null> {
    const file = await this.file();
    return file ? this.deps.read(file) : null;
  }

  /**
   * Download, verify and store the file; true when it is ready. A second
   * call while one runs joins it; once the file is ready, nothing is fetched.
   */
  download(): Promise<boolean> {
    if (this.downloading) return this.downloading;
    this.downloading = (async () => {
      await this.check();
      if (this.current.kind === "ready") return true;
      this.emit({ type: "start" });
      try {
        const data = await this.fetchAll();
        this.emit({ type: "received" });
        if (
          data.byteLength !== this.asset.bytes ||
          (await this.deps.sha256(data)) !== this.asset.sha256
        ) {
          this.dropPartial();
          throw new DownloadError("damaged", "size or checksum differs");
        }
        await this.store(data);
        this.dropPartial();
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
    this.partial = [];
    this.partialBytes = 0;
  }

  /** Every byte, in ranges, going on from an earlier attempt's. */
  private async fetchAll(): Promise<ArrayBuffer> {
    const total = this.asset.bytes;
    this.emit({ type: "progress", received: this.partialBytes, total });
    for (;;) {
      const range = nextRange(this.partialBytes, total);
      if (!range) break;
      const answer = await this.getWithRetry(range);
      if (answer.status === 200) {
        // The server ignored the range and sent the whole file.
        this.partial = [new Uint8Array(answer.body)];
        this.partialBytes = answer.body.byteLength;
        this.emit({ type: "progress", received: this.partialBytes, total });
        break;
      }
      const expected = range.end - range.start + 1;
      if (answer.body.byteLength !== expected) {
        this.dropPartial();
        throw new DownloadError("damaged", "a piece arrived short");
      }
      this.partial.push(new Uint8Array(answer.body));
      this.partialBytes += expected;
      this.emit({ type: "progress", received: this.partialBytes, total });
    }
    const out = new Uint8Array(this.partialBytes);
    let o = 0;
    for (const piece of this.partial) {
      out.set(piece, o);
      o += piece.byteLength;
    }
    return out.buffer;
  }

  private async getWithRetry(range: {
    start: number;
    end: number;
  }): Promise<{ status: number; body: ArrayBuffer }> {
    let last: DownloadError | null = null;
    for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
      if (attempt > 0) await this.deps.sleep(RETRY_WAITS_MS[attempt - 1] ?? 0);
      let answer: { status: number; body: ArrayBuffer };
      try {
        answer = await this.deps.get(this.asset.url, range);
      } catch {
        last = new DownloadError("offline", "no connection");
        continue;
      }
      if (answer.status === 200 || answer.status === 206) return answer;
      last = new DownloadError("http", `HTTP ${answer.status}`);
      // A missing file stays missing: no point asking again.
      if (
        answer.status >= 400 &&
        answer.status < 500 &&
        answer.status !== 408 &&
        answer.status !== 429
      )
        break;
    }
    throw last ?? new DownloadError("offline", "no connection");
  }

  /** Write through a temporary name, then move it into place. */
  private async store(data: ArrayBuffer): Promise<void> {
    const { deps, asset } = this;
    const temp = `${asset.file}.download`;
    await deps.write(temp, data);
    const names = await deps.list();
    if (names.includes(asset.file)) await deps.remove(asset.file);
    await deps.rename(temp, asset.file);
  }

  /** Other versions of this file: superseded once the current one is in. */
  private async removeOlder(): Promise<void> {
    const names = await this.deps.list().catch(() => []);
    for (const other of storedVersions(this.asset, names).others) {
      await this.deps.remove(other.file).catch(() => {});
    }
  }

  /** Remove the file and its other versions from this device. */
  async remove(): Promise<void> {
    if (isBusy(this.current)) return;
    const names = await this.deps.list().catch(() => []);
    const stored = storedVersions(this.asset, names);
    if (stored.current) await this.deps.remove(this.asset.file);
    for (const other of stored.others) await this.deps.remove(other.file).catch(() => {});
    this.dropPartial();
    this.emit({ type: "removed" });
  }

  /** Remove and download again. */
  async redownload(): Promise<boolean> {
    await this.remove();
    return this.download();
  }
}
