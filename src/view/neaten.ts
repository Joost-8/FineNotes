/**
 * Neaten: the selected handwriting rewritten neater, in the writer's own
 * hand, on this device (research/handwriting-rig, "A long", 2026-11-24).
 *
 * 1. Grape reads each selected line (as a page is read); only the words it
 *    is sure of are rewritten (`writer/sure-words.ts`), the rest keep the
 *    writer's strokes.
 * 2. The writer is shown the writer's own practice sheets: every
 *    prose-like copied line in the vault, tied to its letters by Grape
 *    (cached until a sheet changes).
 * 3. The writer's worker writes each line, best of three, then the repair
 *    of words Grape still rejects (`writer/repair.ts`); one line at a time,
 *    and the OCR's worker is let go first so the two models are never in
 *    memory together.
 * 4. Each written line is put where the writer's was, its words spaced as
 *    the writer spaces them, and Tidy goes over the result
 *    (`writer/layout.ts`, `writer/apply.ts`); the surface applies the edit
 *    as one undo step.
 *
 * Without 10 copied lines it offers Learn's practice sheet; without the
 * model, the download card.
 */

import { type App, Modal, Notice } from "obsidian";
import type { Stroke } from "../model/document";
import { type RuleBlock, measureHand, measureLines } from "../ink/tidy";
import { t } from "../i18n/translate";
import { MIN_PRACTICE_LINES } from "../recognition/hwr/learned-model";
import type { LineReading } from "../recognition/hwr/recognizer";
import { type NeatenEdit, neatenEdit } from "../recognition/writer/apply";
import type { WriterClient } from "../recognition/writer/client";
import { type LineToPlace, placeLines } from "../recognition/writer/layout";
import { proseLike } from "../recognition/writer/pool";
import { neatenLine } from "../recognition/writer/repair";
import {
  type TaggedLine,
  calm,
  levelledStrokes,
  pickLines,
  referenceOf,
} from "../recognition/writer/rows";
import type { WriterMeta } from "../recognition/writer/sampler";
import { sureWords, wordsOf } from "../recognition/writer/sure-words";
import { WRITER_FILES, WRITER_MODEL } from "../recognition/writer/writer-model";
import { OCR_WASM_FILE } from "../recognition/ocr/ocr-model";
import type { HandwritingReader } from "./handwriting";
import type { ModelRegistry } from "./model-downloads";
import { type LearningHost, readAllPracticeLines, writePracticePage } from "./handwriting-learning";

/** Tries per line, kept by what Grape reads back (the research's best of 3). */
const TRIES = 3;

export interface NeatenHost {
  app: App;
  models: ModelRegistry;
  handwriting: HandwritingReader;
  /** The word list, as the reader gets it; null without one. */
  lexicon(): { version: number; words: () => string[] } | null;
  learningHost(): LearningHost;
  /** Let the OCR's worker go, so its model and the writer's are never loaded together. */
  releaseOcr(): void;
}

/** What the surface asks for: a page's strokes and the selected ones. */
export interface NeatenRequest {
  /** The page's own strokes (no mirrors of joined pages). */
  strokes: readonly Stroke[];
  selected: ReadonlySet<string>;
  /** The page's ruled lines, if any (Tidy sets lines on them). */
  rules: readonly RuleBlock[] | null;
  /** Asked between steps: true ends the work, nothing changes. */
  stop: () => boolean;
  /** Lines written so far, of how many. */
  progress?: (done: number, total: number) => void;
}

export type NeatenOutcome =
  | { kind: "done"; edit: NeatenEdit; style: Stroke[] }
  | { kind: "nothing" | "stopped" | "needs-sheet" | "needs-model" };

export class NeatenService {
  private writer: WriterClient | null = null;
  private meta: WriterMeta | null = null;
  /** The writer's tagged lines, and what they were made from. */
  private pool: { key: string; lines: TaggedLine[] } | null = null;
  private running = false;

  constructor(private readonly host: NeatenHost) {}

  /** Neaten the selected lines. Shows its own dialogs and notices; the surface applies a "done". */
  async run(request: NeatenRequest): Promise<NeatenOutcome> {
    if (this.running) return { kind: "stopped" };
    this.running = true;
    try {
      return await this.work(request);
    } catch (error) {
      new Notice(
        t("ai.neaten.failed", { error: error instanceof Error ? error.message : String(error) }),
      );
      return { kind: "stopped" };
    } finally {
      this.running = false;
    }
  }

  private async work(request: NeatenRequest): Promise<NeatenOutcome> {
    const store = this.host.models.register(WRITER_MODEL);
    await store.check();
    if (store.state.kind !== "ready") {
      this.host.models.offer(WRITER_MODEL.id, "ask");
      return { kind: "needs-model" };
    }
    const meta = await this.loadMeta();
    const writable = (ch: string): boolean => meta.chars.indexOf(ch) > 0;
    const pool = await this.poolOf(writable);
    if (pool.length < MIN_PRACTICE_LINES) {
      new NeedsSheetModal(
        this.host.app,
        () => void writePracticePage(this.host.learningHost()),
      ).open();
      return { kind: "needs-sheet" };
    }
    if (request.stop()) return { kind: "stopped" };

    // The selected lines, top to bottom, and what Grape reads in each.
    const selected = request.strokes.filter(
      (s) => request.selected.has(s.id) && s.tool === "pen" && !s.shape,
    );
    const byId = new Map(selected.map((s) => [s.id, s]));
    const lines = measureLines(selected).map((line) =>
      line.strokes.map((id) => byId.get(id)).filter((s): s is Stroke => !!s),
    );
    const profile = measureHand(request.strokes.filter((s) => s.tool === "pen" && !s.shape));
    if (lines.length === 0 || !profile) return { kind: "nothing" };
    const lexicon = this.host.lexicon();
    const listed = lexicon ? new Set(lexicon.words().map((w) => w.toLowerCase())) : null;
    const readings = await this.host.handwriting.readForNeaten(lines, lexicon);

    const jobs = lines.flatMap((strokes, li) => {
      const job = this.jobOf(strokes, readings[li], writable, listed);
      return job ? [job] : [];
    });
    if (jobs.length === 0) {
      new Notice(t("ai.neaten.nothingSure"));
      return { kind: "nothing" };
    }

    // The writer, alone in memory with Grape.
    this.host.releaseOcr();
    const writer = await this.writerClient();
    await writer.ensureModel(`${WRITER_MODEL.id}:${WRITER_MODEL.version}`, async () => ({
      files: {
        encode: await this.bytes(WRITER_FILES.encode),
        durations: await this.bytes(WRITER_FILES.durations),
        velocity: await this.bytes(WRITER_FILES.velocity),
        wasm: await this.bytes(OCR_WASM_FILE.name),
      },
      meta,
    }));
    const index = new Map(meta.chars.map((c, i) => [c, i]));
    const placing: LineToPlace<Stroke>[] = [];
    for (const [n, job] of jobs.entries()) {
      request.progress?.(n, jobs.length);
      const ref = referenceOf(pickLines(job.text, pool, meta.refLines), meta.refCurves, index);
      if (!ref) continue;
      const done = await neatenLine(
        job.text,
        ref,
        n,
        (text, r, seed, id, low) => writer.write(text, r, seed, id, low),
        (written) => this.host.handwriting.readRows(written),
        { seed: 0, tries: TRIES, repair: true, stop: request.stop },
      );
      if (!done || request.stop()) return { kind: "stopped" };
      placing.push({
        strokes: job.strokes,
        words: job.words,
        rewrite: job.rewrite,
        written: levelledStrokes(done.written, done.written.char, job.text),
      });
    }
    request.progress?.(jobs.length, jobs.length);
    const placed = placeLines(placing, profile);
    const edit = neatenEdit(request.strokes, placed, profile, request.rules);
    if (edit.added.length === 0) return { kind: "nothing" };
    // Each line's new strokes take the pen of the line's first stroke.
    return { kind: "done", edit, style: placing.map((line) => line.strokes[0]) };
  }

  /** One line's text, words, and which words to rewrite; null when nothing on it may be. */
  private jobOf(
    strokes: Stroke[],
    reading: LineReading | undefined,
    writable: (ch: string) => boolean,
    listed: ReadonlySet<string> | null,
  ): { text: string; strokes: Stroke[]; words: string[][]; rewrite: boolean[] } | null {
    if (!reading || !reading.wordStrokes || !reading.chars) return null;
    // The model writes the whole line (its neighbours shape each word), so every letter must be one it has.
    const text = wordsOf(reading.text).join(" ");
    if (!text || !Array.from(text).every(writable)) return null;
    const words = reading.wordStrokes.map((word) =>
      word.map((i) => strokes[i]?.id).filter((id): id is string => !!id),
    );
    if (words.length !== wordsOf(text).length) return null;
    const inList = listed ? (w: string) => listed.has(w.toLowerCase()) : null;
    const rewrite = sureWords(
      text,
      reading.greedy,
      reading.chars,
      writable,
      undefined,
      undefined,
      inList,
    );
    return rewrite.some(Boolean) ? { text, strokes, words, rewrite } : null;
  }

  /** Every prose-like copied line of the vault's practice sheets, tagged (kept until a sheet changes). */
  private async poolOf(writable: (ch: string) => boolean): Promise<TaggedLine[]> {
    const { lines, sources } = await readAllPracticeLines(this.host.learningHost());
    const prose = lines.filter((line) => proseLike(line.text, writable));
    const stamps = sources.map((s) => {
      const stat = this.host.app.vault.getFileByPath(s.path)?.stat;
      return `${s.path}:${s.lines}:${stat?.mtime ?? 0}`;
    });
    const key = `${this.host.handwriting.info?.name ?? ""}|${stamps.join("|")}`;
    if (this.pool?.key === key) return this.pool.lines;
    if (prose.length < MIN_PRACTICE_LINES) return [];
    const tagged = await this.host.handwriting.tagLines(
      prose.map((line) => ({ text: line.text, strokes: line.strokes })),
    );
    const meta = await this.loadMeta();
    const pool = tagged
      .filter((line): line is TaggedLine => line !== null)
      .map((line) => calm(line, meta.hold));
    this.pool = { key, lines: pool };
    return pool;
  }

  private async loadMeta(): Promise<WriterMeta> {
    if (this.meta) return this.meta;
    const text = new TextDecoder().decode(await this.bytes(WRITER_FILES.meta));
    this.meta = JSON.parse(text) as WriterMeta;
    return this.meta;
  }

  private async bytes(name: string): Promise<ArrayBuffer> {
    const data = await this.host.models.register(WRITER_MODEL).bytes(name);
    if (!data) throw new Error(`the writer's file ${name} is missing`);
    return data;
  }

  private async writerClient(): Promise<WriterClient> {
    if (!this.writer) {
      // The worker's code loads with it, on first use, not with the plugin.
      const { WriterClient } = await import("../recognition/writer/client");
      this.writer = new WriterClient();
    }
    return this.writer;
  }

  /** Let the writer's worker go (the plugin unloads). */
  dispose(): void {
    this.writer?.dispose();
    this.writer = null;
  }
}

/** "Neaten needs your handwriting": Learn's practice sheet, the same sheet for both. */
export class NeedsSheetModal extends Modal {
  constructor(
    app: App,
    private readonly write: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(t("ai.neaten.needsSheetTitle"));
    this.contentEl.createEl("p", { text: t("ai.neaten.needsSheet", { min: MIN_PRACTICE_LINES }) });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons
      .createEl("button", { text: t("common.cancel") })
      .addEventListener("click", () => this.close());
    const cta = buttons.createEl("button", { cls: "mod-cta", text: t("ai.neaten.writeSheet") });
    cta.addEventListener("click", () => {
      this.close();
      this.write();
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
