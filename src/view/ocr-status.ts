/**
 * The small, non-blocking note "Reading scanned pages 3/40" while the OCR
 * service (ocr-service.ts) is reading a PDF: an Obsidian notice that stays up
 * only while there is work, appears after a moment (a single quick page shows
 * nothing), and can be tapped away. It is told nothing it can block on.
 */

import { Notice } from "obsidian";
import type { OcrProgress, OcrService } from "./ocr-service";

/** Work shorter than this shows no note, ms. */
const SHOW_AFTER_MS = 1500;

/** The note's text for a progress, or null when there is none to show. */
export function statusText(progress: OcrProgress): string | null {
  if (!progress.active || progress.total <= 0) return null;
  const at = Math.min(progress.total, progress.done + 1);
  return `FineNotes: reading scanned pages ${at}/${progress.total}`;
}

export class OcrStatus {
  private notice: Notice | null = null;
  private timer = 0;
  private last: OcrProgress = { active: false, done: 0, total: 0 };
  private dismissed = false;
  private readonly unsubscribe: () => void;

  constructor(service: OcrService) {
    this.unsubscribe = service.subscribe((progress) => this.update(progress));
  }

  private update(progress: OcrProgress): void {
    this.last = progress;
    const text = statusText(progress);
    if (text === null) {
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.notice?.hide();
      this.notice = null;
      this.dismissed = false;
      return;
    }
    if (this.notice) {
      this.notice.messageEl.setText(text);
      return;
    }
    if (this.timer || this.dismissed) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      const now = statusText(this.last);
      if (now === null) return;
      const notice = new Notice(now, 0);
      // Tapped away: it stays away until this run of work is over.
      notice.containerEl.addEventListener("click", () => {
        this.dismissed = true;
        this.notice = null;
      });
      this.notice = notice;
    }, SHOW_AFTER_MS);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.unsubscribe();
    this.notice?.hide();
    this.notice = null;
  }
}
