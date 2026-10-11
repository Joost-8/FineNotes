/**
 * Dev builds only: read the current page's handwriting with the on-device
 * recogniser (src/recognition/hwr/) and show the text. The model file is
 * research-only: it is read from the path in the settings, from the user's
 * own vault, and nothing leaves the device. main.ts loads this module only
 * in builds where `__FINENOTES_HWR__` is true.
 */

import { type App, Modal, Notice, Setting, normalizePath } from "obsidian";
import { HwrWorkerClient } from "../recognition/hwr/client";
import type { PageInk } from "../recognition/hwr/lines";
import type { HwrModelInfo } from "../recognition/hwr/protocol";
import type { PageReading } from "../recognition/hwr/recognizer";
import { errorMessage } from "../util/errors";
import type { InkView } from "./ink-view";

/** Which file is loaded in the worker, so it is read again only when it changed. */
interface Loaded {
  path: string;
  mtime: number;
  size: number;
  info: HwrModelInfo;
}

export class HwrDevReader {
  private client: HwrWorkerClient | null = null;
  private loaded: Loaded | null = null;

  constructor(private readonly app: App) {}

  /** Read the page in view and show what it says. */
  async readCurrentPage(view: InkView, modelPath: string): Promise<void> {
    const current = view.currentPageInk();
    if (!current) {
      new Notice("FineNotes: no page to read.");
      return;
    }
    const strokes: PageInk[] = current.page.strokes.map((s) => ({
      id: s.id,
      tool: s.tool,
      shape: s.shape ?? null,
      t0: s.t0 ?? null,
      pts: s.pts,
    }));
    const modal = new HwrReadingModal(this.app, current.number);
    modal.open();
    try {
      modal.status("Loading the model…");
      const info = await this.model(modelPath);
      modal.status(`Reading page ${current.number}…`);
      const started = performance.now();
      const reading = await (this.client as HwrWorkerClient).readPage(strokes, true);
      modal.show(info, reading, performance.now() - started);
    } catch (error) {
      modal.status(`Could not read the page: ${errorMessage(error)}`);
      // A worker that failed or timed out is not trusted again: the next run
      // starts a new one and reads the model again.
      this.dispose();
    }
  }

  /** Load the model file into the worker unless that very file is loaded. */
  private async model(path: string): Promise<HwrModelInfo> {
    const file = normalizePath(path.trim());
    const adapter = this.app.vault.adapter;
    const stat = await adapter.stat(file);
    if (!stat || stat.type !== "file") throw new Error(`no model file at "${file}"`);
    const { loaded } = this;
    if (
      loaded &&
      loaded.path === file &&
      loaded.mtime === stat.mtime &&
      loaded.size === stat.size
    ) {
      return loaded.info;
    }
    this.client ??= new HwrWorkerClient();
    this.loaded = null;
    const info = await this.client.load(await adapter.readBinary(file));
    this.loaded = { path: file, mtime: stat.mtime, size: stat.size, info };
    return info;
  }

  dispose(): void {
    this.client?.terminate();
    this.client = null;
    this.loaded = null;
  }
}

/** The page's lines as read, with the letters as written where the LM changed them. */
class HwrReadingModal extends Modal {
  private readonly statusEl: HTMLElement;

  constructor(app: App, pageNumber: number) {
    super(app);
    this.titleEl.setText(`Page ${pageNumber}, read on this device`);
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-hwr");
    this.statusEl = this.contentEl.createDiv({
      cls: ["goodobsidian-hwr-meta", "setting-item-description"],
    });
  }

  status(text: string): void {
    this.statusEl.setText(text);
  }

  show(info: HwrModelInfo, reading: PageReading, totalMs: number): void {
    const network = reading.lines.reduce((ms, l) => ms + l.timings.network, 0);
    const decode = reading.lines.reduce((ms, l) => ms + l.timings.greedy + l.timings.beam, 0);
    const frames = reading.lines.reduce((n, l) => n + l.frames, 0);
    this.status(
      `${info.name} (${info.layers}×${info.hidden} BLSTM${info.lmContexts ? ", 6-gram LM" : ""}, ` +
        `${info.simd ? "WebAssembly SIMD" : "plain JavaScript"}; ` +
        `research model, read from your vault). ${reading.lines.length} lines, ${frames} frames ` +
        `in ${Math.round(totalMs)} ms: network ${Math.round(network)} ms, decoding ` +
        `${Math.round(decode)} ms, lines ${Math.round(reading.segment)} ms.`,
    );
    const list = this.contentEl.createDiv({ cls: "goodobsidian-hwr-lines" });
    if (reading.lines.length === 0) list.createDiv({ text: "No handwriting found on this page." });
    for (const line of reading.lines) {
      const row = list.createDiv();
      row.createDiv({ text: line.text || "…" });
      const meta = row.createDiv({ cls: ["goodobsidian-hwr-meta", "setting-item-description"] });
      if (line.greedy !== line.text) meta.appendText(`as written: ${line.greedy} · `);
      meta.appendText(
        `${line.frames} frames, ${Math.round(line.timings.network)} + ` +
          `${Math.round(line.timings.greedy + line.timings.beam)} ms`,
      );
    }
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText("Copy text").onClick(() => {
          const text = reading.lines.map((l) => l.text).join("\n");
          navigator.clipboard.writeText(text).then(
            () => new Notice("FineNotes: page text copied."),
            () => new Notice("FineNotes: could not copy here; select the text instead."),
          );
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("Close")
          .setCta()
          .onClick(() => this.close()),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
