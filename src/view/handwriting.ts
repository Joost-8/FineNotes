/**
 * The on-device handwriting reader, shared by every open notebook: one
 * worker (src/recognition/hwr/), loaded once with Grape (downloaded on first
 * use, grape-files.ts), or with a model file the user picked in the settings.
 * Nothing it reads leaves the device.
 *
 * It reads a page (its lines, for search and the text layer) or a handful of
 * strokes (a lassoed heading or word, to prefill a title or a link).
 */

import { type App, normalizePath } from "obsidian";
import type { Stroke } from "../model/document";
import type { HwrWorkerClient } from "../recognition/hwr/client";
import type { PageInk } from "../recognition/hwr/lines";
import type { HwrModelInfo, SuggestItem, SuggestResult } from "../recognition/hwr/protocol";
import type { LineReading, PageReading } from "../recognition/hwr/recognizer";

/**
 * Where the model comes from: a file the user picked, else the model learned
 * from their handwriting, else Grape as downloaded.
 */
export interface ModelSource {
  /** A vault path the user set; blank for none. */
  customPath: string;
  /** The learned model's vault path; blank when there is none. */
  learnedPath: string;
}

/** Grape as stored on this device: a key that changes with the file, and its bytes. */
export interface StoredModel {
  key: string;
  read: () => Promise<ArrayBuffer>;
}

/** Grape is not on this device yet; the download has been offered. */
export class ModelNotDownloadedError extends Error {
  constructor() {
    super(
      "Grape (handwriting recognizer model) is not on this device yet. It downloads when " +
        "you're online, from Settings › Models on this device.",
    );
    this.name = "ModelNotDownloadedError";
  }
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
  /** The version of the word list the worker has (`suggest`). */
  private lexiconVersion: number | null = null;

  constructor(
    private readonly app: App,
    private readonly source: () => ModelSource,
    /** Grape, or null when it is not here (grape-files.ts then offers the download). */
    private readonly grape: () => Promise<StoredModel | null>,
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
    let key: string;
    let read: () => Promise<ArrayBuffer>;
    if (file) {
      const stat = await this.app.vault.adapter.stat(file);
      if (!stat || stat.type !== "file") throw new Error(`no model file at "${file}"`);
      key = `${file}|${stat.mtime}|${stat.size}`;
      read = () => this.app.vault.adapter.readBinary(file);
    } else {
      const grape = await this.grape();
      if (!grape) throw new ModelNotDownloadedError();
      ({ key, read } = grape);
    }
    if (this.loaded?.key === key) return this.loaded.info;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      // The worker's code loads with it, on first use, not with the plugin.
      if (!this.client) {
        const { HwrWorkerClient } = await import("../recognition/hwr/client");
        this.client = new HwrWorkerClient();
      }
      const bytes = await read();
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

  /**
   * Find the lines in these strokes and read them. `keep`: the worker keeps
   * the lines' log-probabilities (the last two pages), for `suggest`.
   */
  async readPage(strokes: readonly Stroke[], keep = false): Promise<PageReading> {
    await this.model();
    const client = this.client;
    if (!client) throw new Error("the recogniser stopped");
    try {
      return await client.readPage(inkForReading(strokes), true, keep);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /**
   * List words for words of a page read with `keep` (lexicon.ts); null when
   * the worker no longer keeps that page. The word list goes to the worker
   * when its `version` is new to it.
   */
  async suggest(
    reading: number,
    items: SuggestItem[],
    lexicon: { version: number; words: () => string[] },
  ): Promise<SuggestResult[] | null> {
    await this.model();
    const client = this.client;
    if (!client) throw new Error("the recogniser stopped");
    if (this.lexiconVersion !== lexicon.version) {
      await client.setLexicon(lexicon.words());
      this.lexiconVersion = lexicon.version;
    }
    return client.suggest(reading, items);
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

  /** What a few strokes say: on one line (lines joined by spaces), or line by line. */
  async readInk(strokes: readonly Stroke[], keepLines = false): Promise<string> {
    const reading = await this.readPage(strokes);
    const text = readingText(reading);
    return (keepLines ? text : text.replace(/\n/g, " ")).trim();
  }

  dispose(): void {
    this.client?.terminate();
    this.client = null;
    this.loaded = null;
    this.lexiconVersion = null;
  }
}
