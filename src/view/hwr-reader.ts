/**
 * "Show this page read on this device": the page in view, read by the
 * on-device recogniser (`handwriting.ts`), line by line, with the timings.
 * Nothing leaves the device.
 */

import { type App, Modal, Notice, Setting } from "obsidian";
import type { HwrModelInfo } from "../recognition/hwr/protocol";
import type { PageReading } from "../recognition/hwr/recognizer";
import { errorMessage } from "../util/errors";
import type { HandwritingReader } from "./handwriting";
import type { InkView } from "./ink-view";

/** Read the page in view and show what it says. */
export async function showPageReading(
  app: App,
  reader: HandwritingReader,
  view: InkView,
): Promise<void> {
  const current = view.currentPageInk();
  if (!current) {
    new Notice("FineNotes: no page to read.");
    return;
  }
  const modal = new HwrReadingModal(app, current.number);
  modal.open();
  try {
    modal.status("Loading the model…");
    const info = await reader.model();
    modal.status(`Reading page ${current.number}…`);
    const started = performance.now();
    const reading = await reader.readPage(current.page.strokes);
    modal.show(info, reading, performance.now() - started);
  } catch (error) {
    modal.status(`Could not read the page: ${errorMessage(error)}`);
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
        `read on this device). ${reading.lines.length} lines, ${frames} frames ` +
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
