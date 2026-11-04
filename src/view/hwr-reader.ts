/**
 * "Show this page read on this device": the page in view, read by the
 * on-device recogniser (`handwriting.ts`), line by line, with the timings.
 * Nothing leaves the device.
 */

import { type App, Modal, Notice, Setting } from "obsidian";
import { t } from "../i18n/translate";
import type { HwrModelInfo } from "../recognition/hwr/protocol";
import type { PageReading } from "../recognition/hwr/recognizer";
import { errorMessage } from "../util/errors";
import type { HandwritingReader } from "./handwriting";
import type { InkView } from "./ink-view";
import { writeSystemText } from "./system-clipboard";

/** Read the page in view and show what it says. */
export async function showPageReading(
  app: App,
  reader: HandwritingReader,
  view: InkView,
): Promise<void> {
  const current = view.currentPageInk();
  if (!current) {
    new Notice(t("ai.hwr.noPage"));
    return;
  }
  const modal = new HwrReadingModal(app, current.number);
  modal.open();
  try {
    modal.status(t("ai.hwr.loading"));
    const info = await reader.model();
    modal.status(t("ai.hwr.reading", { page: current.number }));
    const started = performance.now();
    const reading = await reader.readPage(current.page.strokes);
    modal.show(info, reading, performance.now() - started);
  } catch (error) {
    modal.status(t("ai.hwr.failed", { message: errorMessage(error) }));
  }
}

/**
 * A model's name as people know it: the bundled model's file still carries
 * its build name (its bytes are the published Grape 1.0), and a learned one
 * is named after it.
 */
export function modelLabel(name: string): string {
  return name.replace(/^(finenotes-hwr|grape)-1\.0/, "Grape 1.0");
}

/** The page's lines as read, with the letters as written where the LM changed them. */
class HwrReadingModal extends Modal {
  private readonly statusEl: HTMLElement;

  constructor(app: App, pageNumber: number) {
    super(app);
    this.titleEl.setText(t("ai.hwr.title", { page: pageNumber }));
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-hwr");
    this.contentEl.createDiv({
      cls: "goodobsidian-beta-note",
      text: t("ai.hwr.betaNote"),
    });
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
      t("ai.hwr.summary", {
        model: modelLabel(info.name),
        layers: info.layers,
        hidden: info.hidden,
        lm: info.lmContexts ? ", 6-gram LM" : "",
        engine: info.simd ? "WebAssembly SIMD" : "plain JavaScript",
        lines: reading.lines.length,
        frames,
        total: Math.round(totalMs),
        network: Math.round(network),
        decode: Math.round(decode),
        segment: Math.round(reading.segment),
      }),
    );
    const list = this.contentEl.createDiv({ cls: "goodobsidian-hwr-lines" });
    if (reading.lines.length === 0) list.createDiv({ text: t("ai.hwr.none") });
    for (const line of reading.lines) {
      const row = list.createDiv();
      row.createDiv({ text: line.text || "…" });
      const meta = row.createDiv({ cls: ["goodobsidian-hwr-meta", "setting-item-description"] });
      if (line.greedy !== line.text) {
        meta.appendText(`${t("ai.hwr.asWritten", { text: line.greedy })} `);
      }
      meta.appendText(
        t("ai.hwr.lineTimes", {
          frames: line.frames,
          network: Math.round(line.timings.network),
          decode: Math.round(line.timings.greedy + line.timings.beam),
        }),
      );
    }
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("ai.hwr.copyText")).onClick(() => {
          const text = reading.lines.map((l) => l.text).join("\n");
          writeSystemText(text).then(
            () => new Notice(t("ai.hwr.copied")),
            () => new Notice(t("ai.hwr.copyFailed")),
          );
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(t("common.close"))
          .setCta()
          .onClick(() => this.close()),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
