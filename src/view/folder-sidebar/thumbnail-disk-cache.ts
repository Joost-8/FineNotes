/**
 * Drawn notebook thumbnails kept as small JPEG files in the plugin's own
 * `thumbs` folder, so the library does not draw every notebook again each
 * time it opens. The newest 500 are kept.
 */

import { type App } from "obsidian";
import { dataUrlToBytes, jpegBytesToDataUrl, thumbnailHash } from "../../model/folder-thumbnail";

/** The most thumbnail files kept. */
const MAX_FILES = 500;
/** The folder is checked for old files after this many writes. */
const PRUNE_EVERY = 50;

export class ThumbnailDiskCache {
  private writes = 0;
  private dirReady = false;

  /** @param pluginDir this plugin's own folder (`manifest.dir`). */
  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
  ) {}

  private dir(): string {
    return `${this.pluginDir}/thumbs`;
  }

  private pathFor(key: string): string {
    return `${this.dir()}/${thumbnailHash(key)}.jpg`;
  }

  /** The thumbnail saved for `key` as a data URL, or null. */
  async read(key: string): Promise<string | null> {
    const path = this.pathFor(key);
    try {
      const adapter = this.app.vault.adapter;
      return (await adapter.exists(path))
        ? jpegBytesToDataUrl(await adapter.readBinary(path))
        : null;
    } catch {
      return null;
    }
  }

  /** Save the thumbnail (a data URL) for `key`. Failing to is not an error. */
  async write(key: string, dataUrl: string): Promise<void> {
    const dir = this.dir();
    const path = this.pathFor(key);
    try {
      const adapter = this.app.vault.adapter;
      if (!this.dirReady) {
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        this.dirReady = true;
      }
      await adapter.writeBinary(path, dataUrlToBytes(dataUrl));
      this.writes++;
      if (this.writes === 1 || this.writes % PRUNE_EVERY === 0) void this.prune();
    } catch {
      // A cache that cannot be written is only slower.
    }
  }

  /** Remove the oldest files beyond the 500 newest. */
  private async prune(): Promise<void> {
    const dir = this.dir();
    try {
      const adapter = this.app.vault.adapter;
      const listing = await adapter.list(dir);
      if (listing.files.length <= MAX_FILES) return;
      const files: { path: string; mtime: number }[] = [];
      for (const path of listing.files) {
        const stat = await adapter.stat(path);
        files.push({ path, mtime: stat?.mtime ?? 0 });
      }
      files.sort((a, b) => a.mtime - b.mtime);
      for (const file of files.slice(0, files.length - MAX_FILES)) await adapter.remove(file.path);
    } catch {
      // Pruning is housekeeping.
    }
  }
}
