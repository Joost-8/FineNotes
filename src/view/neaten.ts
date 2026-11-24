/**
 * Neaten: the selected handwriting rewritten neater, in the writer's own
 * hand, on this device (research/handwriting-rig, "A long", 2026-11-24).
 *
 * 1. Grape reads each selected line (as a page is read); only the words it
 *    is sure of, or that the writer corrected, are rewritten
 *    (`writer/sure-words.ts`); the rest keep the writer's strokes.
 * 2. The writer is shown the writer's own practice sheets: the prose-like
 *    copied lines that share most letters with the line, tied to their
 *    letters by Grape (each line once, kept until its sheet changes).
 * 3. The writer's worker writes each line, best of three, then the repair
 *    of words Grape still rejects (`writer/repair.ts`); one line at a time.
 *    The OCR is paused for the whole run and its model let go, and the
 *    writer is let go at the end, so the two models are never in memory
 *    together.
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
import type { InkStroke } from "../recognition/hwr/features";
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
import {
  type WordAnswer,
  applyAnswers,
  joinPunctuation,
  sureWords,
  wordCore,
  wordsOf,
} from "../recognition/writer/sure-words";
import { WRITER_FILES, WRITER_HOSTED, WRITER_MODEL } from "../recognition/writer/writer-model";
import { OCR_WASM_FILE } from "../recognition/ocr/ocr-model";
import { ModelNotDownloadedError, type HandwritingReader } from "./handwriting";
import type { ModelRegistry } from "./model-downloads";
import { type LearningHost, readAllPracticeLines, writePracticePage } from "./handwriting-learning";

/** Tries per line, kept by what Grape reads back (the research's best of 3). */
const TRIES = 3;
/** Practice lines looked at beyond the ones shown, in case some cannot be tied to their letters. */
const SPARE_LINES = 4;

export interface NeatenHost {
  app: App;
  models: ModelRegistry;
  handwriting: HandwritingReader;
  /** The word list, as the reader gets it; null without one. */
  lexicon(): { version: number; words: () => string[] } | null;
  /** The writer's answers about words on a page (corrections.json). */
  answers(note: string, pageId: string): Promise<WordAnswer[]>;
  learningHost(): LearningHost;
  /** Pause the OCR and let its model go; the returned function lets it carry on. */
  pauseOcr(): Promise<() => void>;
}

/** What the surface asks for: a page's strokes and the selected ones. */
export interface NeatenRequest {
  pageId: string;
  /** The note's vault path, for the writer's answers about its words (the view fills it). */
  note?: string;
  /** The page's own strokes (no mirrors of joined pages). */
  strokes: readonly Stroke[];
  selected: ReadonlySet<string>;
  /** The page's ruled lines, if any (Tidy sets lines on them). */
  rules: readonly RuleBlock[] | null;
  /** Asked between steps: true ends the work, nothing changes. */
  stop: () => boolean;
}

export type NeatenOutcome =
  | { kind: "done"; edit: NeatenEdit; style: Stroke[] }
  | { kind: "nothing" | "stopped" | "needs-sheet" | "needs-model" };

/** A copied line the writer may be shown: its text and ink, and what identifies it for the cache. */
interface PoolLine {
  key: string;
  text: string;
  strokes: InkStroke[];
}

export class NeatenService {
  private writer: WriterClient | null = null;
  private meta: WriterMeta | null = null;
  /** Copied lines tied to their letters, by `PoolLine.key` (null: could not be). */
  private readonly tagged = new Map<string, TaggedLine | null>();
  private running = false;

  constructor(private readonly host: NeatenHost) {
    // Listed in Settings › Models on this device from the start, like the other models.
    void host.models.register(WRITER_MODEL).check();
  }

  /** Whether the menu offers Neaten: the model can be downloaded, or is already here. */
  available(): boolean {
    return WRITER_HOSTED || this.host.models.register(WRITER_MODEL).state.kind === "ready";
  }

  /** Neaten the selected lines. Shows its own dialogs and notices; the surface applies a "done". */
  async run(request: NeatenRequest): Promise<NeatenOutcome> {
    // A second tap while it works: the first run goes on.
    if (this.running) return { kind: "stopped" };
    this.running = true;
    let resumeOcr: (() => void) | null = null;
    try {
      const outcome = await this.work(request, async () => {
        resumeOcr ??= await this.host.pauseOcr();
      });
      if (outcome.kind === "nothing") new Notice(t("ai.neaten.nothingSure"));
      return outcome;
    } catch (error) {
      console.warn("FineNotes: Neaten stopped", error);
      new Notice(
        error instanceof ModelNotDownloadedError
          ? t("view.notice.plain", { message: error.message })
          : t("ai.neaten.failed"),
        8000,
      );
      return { kind: "stopped" };
    } finally {
      // The writer goes before the OCR may load again.
      this.writer?.dispose();
      (resumeOcr as (() => void) | null)?.();
      this.running = false;
    }
  }

  private async work(
    request: NeatenRequest,
    pauseOcr: () => Promise<void>,
  ): Promise<NeatenOutcome> {
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
    const answers = request.note ? await this.host.answers(request.note, request.pageId) : [];
    const readings = await this.host.handwriting.readForNeaten(lines, lexicon);
    const jobs = lines.flatMap((strokes, li) => {
      const job = this.jobOf(strokes, readings[li], writable, listed, answers);
      return job ? [job] : [];
    });
    if (jobs.length === 0) return { kind: "nothing" };
    if (request.stop()) return { kind: "stopped" };

    // The writer, alone in memory with Grape.
    await pauseOcr();
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
      const shown = await this.shownFor(job.text, pool, meta);
      const ref = referenceOf(shown, meta.refCurves, index);
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
    answers: readonly WordAnswer[],
  ): { text: string; strokes: Stroke[]; words: string[][]; rewrite: boolean[] } | null {
    if (!reading || !reading.wordStrokes || !reading.chars) return null;
    const read = wordsOf(reading.text);
    const ink = reading.wordStrokes.map((word) =>
      word.map((i) => strokes[i]?.id).filter((id): id is string => !!id),
    );
    if (read.length === 0 || ink.length !== read.length) return null;
    // The writer's own answers come first: a corrected word is what they said it is.
    const answered = applyAnswers(read, ink, answers);
    const text = answered.words.join(" ");
    // The model writes the whole line (its neighbours shape each word), so every letter must be one it has.
    if (!Array.from(text).every(writable)) return null;
    const inList = listed
      ? (w: string) => listed.has(w.toLowerCase()) || answered.listed.has(wordCore(w).toLowerCase())
      : null;
    const rewrite = sureWords(
      text,
      reading.greedy,
      reading.chars,
      writable,
      undefined,
      answered.known,
      inList,
    );
    const joined = joinPunctuation({ words: answered.words, ink, rewrite });
    if (!joined.rewrite.some(Boolean)) return null;
    return { text: joined.words.join(" "), strokes, words: joined.ink, rewrite: joined.rewrite };
  }

  /** Every prose-like copied line of the vault's practice sheets (not yet tied to its letters). */
  private async poolOf(writable: (ch: string) => boolean): Promise<PoolLine[]> {
    const { lines, sources } = await readAllPracticeLines(this.host.learningHost());
    // `lines` holds each source's lines in turn: give each line its file and place.
    const out: PoolLine[] = [];
    let at = 0;
    for (const source of sources) {
      const mtime = this.host.app.vault.getFileByPath(source.path)?.stat.mtime ?? 0;
      for (let i = 0; i < source.lines; i++, at++) {
        const line = lines[at];
        if (!line || !proseLike(line.text, writable)) continue;
        out.push({ key: `${source.path}|${mtime}|${i}`, text: line.text, strokes: line.strokes });
      }
    }
    return out;
  }

  /**
   * The copied lines to show for `text`: those sharing most letters with it
   * (`pickLines`), tied to their letters by Grape when first needed; a line
   * that cannot be is passed over for the next.
   */
  private async shownFor(text: string, pool: PoolLine[], meta: WriterMeta): Promise<TaggedLine[]> {
    const picked = pickLines(text, pool, meta.refLines + SPARE_LINES);
    const missing = picked.filter((line) => !this.tagged.has(line.key));
    if (missing.length > 0) {
      const tagged = await this.host.handwriting.tagLines(
        missing.map((line) => ({ text: line.text, strokes: line.strokes })),
      );
      missing.forEach((line, i) => {
        const done = tagged[i];
        this.tagged.set(line.key, done ? calm(done, meta.hold) : null);
      });
    }
    return picked
      .map((line) => this.tagged.get(line.key) ?? null)
      .filter((line): line is TaggedLine => line !== null)
      .slice(0, meta.refLines);
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
