/**
 * Progress of reading scanned pages, as a mark and not a sentence: a ring
 * turns beside the page counter while the OCR service (ocr-service.ts) has
 * pages to read, and goes when it has none. It appears after a moment, so a
 * single quick page shows nothing. The ring itself is CSS on the body class
 * `goodobsidian-ocr-reading` (styles.css, end of file).
 */

import type { OcrService } from "./ocr-service";

/** Work shorter than this shows no ring, ms. */
export const SHOW_AFTER_MS = 1500;

/** The body class that turns the ring on. */
export const READING_CLASS = "goodobsidian-ocr-reading";

export class OcrStatus {
  private timer = 0;
  private shown = false;
  private readonly unsubscribe: () => void;

  constructor(service: OcrService) {
    this.unsubscribe = service.subscribe((progress) => this.update(progress.active));
  }

  private update(active: boolean): void {
    if (!active) {
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.hide();
      return;
    }
    if (this.timer || this.shown) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.shown = true;
      document.body.addClass(READING_CLASS);
    }, SHOW_AFTER_MS);
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    document.body.removeClass(READING_CLASS);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.unsubscribe();
    this.hide();
  }
}
