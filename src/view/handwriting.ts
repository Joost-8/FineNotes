/**
 * The on-device handwriting reader, shared by every open notebook: one
 * worker (src/recognition/hwr/), loaded once with the model bundled in the
 * plugin, or with a model file the user picked in the settings. Nothing it
 * reads leaves the device.
 *
 * It reads a page (its lines, for search and the text layer) or a handful of
 * strokes (a lassoed heading or word, to prefill a title or a link).
 */

import { type App, normalizePath } from "obsidian";
import type { Stroke } from "../model/document";
import type { HwrWorkerClient } from "../recognition/hwr/client";
import type { PageInk } from "../recognition/hwr/lines";
import type { HwrModelInfo } from "../recognition/hwr/protocol";
import type { LineReading, PageReading } from "../recognition/hwr/recognizer";

/**
 * Where the model comes from: a file the user picked, else the model learned
 * from their handwriting, else the one built in.
 */
export interface ModelSource {
  /** A vault path the user set; blank for none. */
  customPath: string;
  /** The learned model's vault path; blank when there is none. */
  learnedPath: string;
}

/** The bundled model's bytes (a fresh copy), read only when first needed. */
export async function bundledModel(): Promise<ArrayBuffer> {
  const { default: bytes } = await import("../../models/finenotes-hwr-1.0.bin");
  // The worker takes the buffer it is given: hand it a copy.
  return bytes.slice().buffer;
}

/** The strokes the recogniser reads: pen ink, not highlighter, snapped shapes or tables. */
export function inkForReading(strokes: readonly Stroke[]): PageInk[] {
  return strokes
    .filter((s) => s.tool !== "highlighter" && !s.shape)
    .map((s) => ({ id: s.id, tool: s.tool, shape: s.shape ?? null, t0: s.t0 ?? null, pts: s.pts }));
}

/** Two letters or digits in a row: what tells writing from a drawing read as text. */
const WRITING = /[\p{L}\p{N}]{2}/u;

/**
 * A reading's lines as text, one line each. A line without two letters or
 * digits in a row is left out: that is a drawing read as text ("J-0-0"),
 * not writing, and it would only clutter search.
 */
export function readingText(reading: PageReading): string {
  return reading.lines
    .map((line) => line.text.trim())
    .filter((text) => WRITING.test(text))
    .join("\n");
}

export class HandwritingReader {
  private client: HwrWorkerClient | null = null;
  /** The model in the worker, and where it came from. */
  private loaded: { key: string; info: HwrModelInfo } | null = null;
  private loading: Promise<HwrModelInfo> | null = null;

  constructor(
    private readonly app: App,
    private readonly source: () => ModelSource,
  ) {}

  /** The model, loaded into the worker if it is not there yet (or its file changed). */
  async model(): Promise<HwrModelInfo> {
    const source = this.source();
    const custom = source.customPath.trim();
    let path = custom;
    // The learned model, when there is one and its file is there.
    if (!custom && source.learnedPath) {
      const learned = await this.app.vault.adapter.stat(source.learnedPath);
      if (learned?.type === "file") path = source.learnedPath;
    }
    const file = path ? normalizePath(path) : "";
    let key = "bundled";
    if (file) {
      const stat = await this.app.vault.adapter.stat(file);
      if (!stat || stat.type !== "file") throw new Error(`no model file at "${file}"`);
      key = `${file}|${stat.mtime}|${stat.size}`;
    }
    if (this.loaded?.key === key) return this.loaded.info;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      // The worker's code loads with it, on first use, not with the plugin.
      if (!this.client) {
        const { HwrWorkerClient } = await import("../recognition/hwr/client");
        this.client = new HwrWorkerClient();
      }
      const bytes = file ? await this.app.vault.adapter.readBinary(file) : await bundledModel();
      const info = await this.client.load(bytes);
      this.loaded = { key, info };
      return info;
    })();
    try {
      return await this.loading;
    } catch (error) {
      // A worker that failed is not trusted again: the next call starts anew.
      this.dispose();
      throw error;
    } finally {
      this.loading = null;
    }
  }

  /** Find the lines in these strokes and read them. */
  async readPage(strokes: readonly Stroke[]): Promise<PageReading> {
    await this.model();
    const client = this.client;
    if (!client) throw new Error("the recogniser stopped");
    try {
      return await client.readPage(inkForReading(strokes), true);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Read groups of strokes, each as one line (words, for the bracket test). */
  async readGroups(groups: readonly (readonly PageInk[])[]): Promise<LineReading[]> {
    await this.model();
    const client = this.client;
    if (!client) throw new Error("the recogniser stopped");
    try {
      return await client.readLines(
        groups.map((group) => [...group]),
        true,
      );
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** What a few strokes say, on one line: lines joined by spaces. */
  async readInk(strokes: readonly Stroke[]): Promise<string> {
    const reading = await this.readPage(strokes);
    return readingText(reading).replace(/\n/g, " ").trim();
  }

  dispose(): void {
    this.client?.terminate();
    this.client = null;
    this.loaded = null;
  }
}
