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
import {
  ASKED_LEVEL_SLOPE,
  type HandProfile,
  type RuleBlock,
  measureHand,
  measureLines,
} from "../ink/tidy";
import { t } from "../i18n/translate";
import { MIN_PRACTICE_LINES } from "../recognition/hwr/learned-model";
import type { LineReading } from "../recognition/hwr/recognizer";
import type { InkStroke } from "../recognition/hwr/features";
import { type NeatenEdit, neatenEdit } from "../recognition/writer/apply";
import type { WriterClient } from "../recognition/writer/client";
import { isOutOfMemory } from "../recognition/writer/protocol";
import { clearanceFor, type LineToPlace, placeLines } from "../recognition/writer/layout";
import { proseLike } from "../recognition/writer/pool";
import { errorRate, neatenLine, readBackRewrite } from "../recognition/writer/repair";
import { readsAs } from "../recognition/writer/known-layout";
import {
  type TaggedLine,
  type WrittenStroke,
  levelledStrokes,
  median,
} from "../recognition/writer/rows";
import {
  inkFoot,
  inkXHeight,
  leastXHeight,
  writtenFoot,
  writtenXHeight,
} from "../recognition/writer/x-height";
import { ownInkRewrite } from "../recognition/writer/own-ink";
import { heldWordAt, placeWord, wordEdit } from "../recognition/writer/held-word";
import { DEFAULT_TRIES } from "../recognition/writer/flow-meta";
import { type WriterKind, WRITER_KINDS, kindFor } from "../recognition/writer/kinds";
import { guidanceAt } from "../recognition/writer/neatness";
import { roughness } from "../recognition/writer/evenness";
import { strengthAt } from "../recognition/writer/neatness";
import { straighten } from "../recognition/writer/straighten";
import {
  type ManifestProblem,
  type WriterManifest,
  manifestFormat,
  parseManifest,
} from "../recognition/writer/manifest";
import {
  type WordAnswer,
  applyAnswers,
  joinPunctuation,
  pickQuestions,
  sureOfAnswered,
  questionBudget,
  sureWords,
  unsureCandidates,
  writeUnasked,
  wordCore,
  wordSureness,
  wordsOf,
} from "../recognition/writer/sure-words";
import { WRITER_HOSTED, WRITER_MODEL } from "../recognition/writer/writer-model";
import { OCR_WASM_FILE } from "../recognition/ocr/ocr-model";
import { ModelNotDownloadedError, type HandwritingReader } from "./handwriting";
import type { ModelRegistry } from "./model-downloads";
import { type LearningHost, readAllPracticeLines, writePracticePage } from "./handwriting-learning";

/** How many times an exact line (an answer) is written before the glyphs are left to write it. */
const EXACT_ATTEMPTS = 3;
/** Practice lines looked at beyond the ones shown, in case some cannot be tied to their letters. */
const SPARE_LINES = 4;
/** How often the menu may ask for the model's files to be looked for again. */
const RECHECK_MS = 30_000;
/** Wait before starting the writer again after it ran out of memory starting (a worker's memory is reclaimed late). */
const OOM_RETRY_MS = 1500;

export interface NeatenHost {
  app: App;
  models: ModelRegistry;
  handwriting: HandwritingReader;
  /** The word list, as the reader gets it; null without one. */
  lexicon(): {
    version: number;
    words: () => string[];
    /** The writer's own answered words (personal-words.ts), lower case. */
    answered?: () => ReadonlySet<string>;
  } | null;
  /** The writer's answers about words on a page (corrections.json). */
  answers(note: string, pageId: string): Promise<WordAnswer[]>;
  learningHost(): LearningHost;
  /** Pause the OCR and let its model go; the returned function lets it carry on. */
  pauseOcr(): Promise<() => void>;
  /** Where Beautify's neatness slider sits, 0 (most like the writer's ink) to 1 (neatest). */
  neatness(): number;
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
  /** The page's width (page px): nothing written or moved goes past it. */
  pageWidth?: number;
  /** Asked between steps: true ends the work, nothing changes. */
  stop: () => boolean;
  /**
   * Ask the writer about words Grape is not sure of (their ink), one after
   * another with the word card; resolves with the ink of each word they
   * answered (the view fills it). Without it those words stay as written.
   */
  ask?: (words: string[][]) => Promise<string[][]>;
  /** Told just before `ask`: from then on the selection may go (a tap closing a card) without stopping the work. */
  asking?: () => void;
  /**
   * A stroke of the held word: only that word is rewritten ("Beautify this
   * word", `held-word.ts`), and nothing else moves but the words after it.
   * `selected` is then its line, or the word's own ink when it stands alone.
   */
  word?: string;
}

export type NeatenOutcome =
  | { kind: "done"; edit: NeatenEdit; style: Stroke[] }
  /** Nothing could be rewritten (no model or sheet, no word Grape is sure of, a problem): tidy only. */
  | { kind: "tidy" }
  /** Stopped by the user (an edit, the selection left): nothing changes. */
  | { kind: "stopped" }
  /** "Beautify this word" could not write the word: it stays as written, nothing is tidied. */
  | { kind: "nothing" };

/** One line to beautify: its text, words, and which words to rewrite. */
interface NeatenJob {
  text: string;
  strokes: Stroke[];
  /** Each word's ink (stroke ids). */
  words: string[][];
  /** Each word's text. */
  read: string[];
  rewrite: boolean[];
  /** How sure Grape is of each word (`wordSureness`); 1 for a word the writer answered. */
  sure: number[];
  /** Set once asked: the words the writer answered on a card. */
  answered?: boolean[];
  /** Words the writer answered on an earlier run (`applyAnswers`). */
  known: boolean[];
  xHeight: number | null;
  /** Grape's letters on the line, as indices into `strokes`. */
  chars: NonNullable<LineReading["chars"]>;
}

/** A copied line the writer may be shown: its text and ink, and what identifies it for the cache. */
interface PoolLine {
  key: string;
  text: string;
  strokes: InkStroke[];
}

export class NeatenService {
  private writer: WriterClient | null = null;
  /** The model in the folder: its manifest and the kind that runs it (null until read). */
  private model: { manifest: WriterManifest; kind: WriterKind; key: string } | null = null;
  /** Copied lines tied to their letters, by `PoolLine.key` (null: could not be). */
  private readonly tagged = new Map<string, TaggedLine | null>();
  private running = false;
  /** Whether this session already asked for a practice sheet. */
  private askedSheet = false;
  /** When `available` last asked the store to look for the files again. */
  private lookedAt = 0;
  /** Prose-like practice lines at the last Beautify (null: none yet this session). */
  private practiceLines: number | null = null;
  /** When `ready` last counted the practice lines (0: never). */
  private countedAt = 0;
  /** Lets the OCR carry on; held while the writer's worker lives. */
  private ocrHold: (() => void) | null = null;
  /** `readyWriter` is starting the worker a second time: its release keeps the OCR paused. */
  private retrying = false;

  constructor(private readonly host: NeatenHost) {
    // Listed in Settings › Models on this device from the start, like the other models.
    // An older version in the folder is read for its manifest's format (needs an update).
    const formatOf = (data: ArrayBuffer): number | null =>
      manifestFormat(new TextDecoder().decode(data));
    void host.models.register(WRITER_MODEL, { formatOf }).check();
  }

  /**
   * What writing in the hand needs, begun for a corrected word
   * (write-in-hand.ts `setUp`): the model's download card when it is not on
   * this device, and once it is (now, or when its download ends) the
   * practice sheet's dialog when too few of its lines are copied.
   */
  setUp(): void {
    const store = this.host.models.register(WRITER_MODEL);
    const sheet = async (): Promise<void> => {
      const model = await this.loadModel();
      if ("problem" in model) return;
      const pool = await this.poolOf((ch) => model.manifest.chars.indexOf(ch) > 0);
      this.practiceLines = pool.length;
      if (pool.length >= MIN_PRACTICE_LINES) return;
      const write = () => void writePracticePage(this.host.learningHost());
      new NeedsSheetModal(this.host.app, write, true).open();
    };
    const begin = async (): Promise<void> => {
      await store.check(true);
      if (store.state.kind === "ready") return sheet();
      const stop = store.subscribe(() => {
        if (store.state.kind !== "ready") return;
        stop();
        void sheet().catch((error) => console.warn("FineNotes: practice sheet check", error));
      });
      this.host.models.offer(WRITER_MODEL.id, "ask");
      // "Not now", or no answer: a download started later elsewhere does not open the sheet.
      window.setTimeout(() => {
        const kind = store.state.kind;
        if (kind !== "downloading" && kind !== "verifying") stop();
      }, 120_000);
    };
    void begin().catch((error) => console.warn("FineNotes: could not set up writing", error));
  }

  /** Whether the menu offers Neaten: the model can be downloaded, or is already here. */
  available(): boolean {
    const store = this.host.models.register(WRITER_MODEL);
    if (WRITER_HOSTED || store.state.kind === "ready") return true;
    // Files that sync brings after launch: looked for again, for the next time the menu opens.
    const now = Date.now();
    if (now - this.lookedAt > RECHECK_MS) {
      this.lookedAt = now;
      void store.check(true);
    }
    return false;
  }

  /**
   * Whether Beautify writes in the hand here, as far as is known without
   * reading the vault: the model is on the device, and the last count of
   * practice lines (none yet this session: not known, so yes) was enough.
   * The neatness slider shows only then.
   */
  writesInHand(): boolean {
    if (this.host.models.register(WRITER_MODEL).state.kind !== "ready") return false;
    return this.practiceLines === null || this.practiceLines >= MIN_PRACTICE_LINES;
  }

  /** Neaten the selected lines. Shows its own dialogs and notices; the surface applies a "done". */
  async run(request: NeatenRequest): Promise<NeatenOutcome> {
    // While the writer is busy (another Beautify, or a text being written in the hand) this
    // one waits its turn, unless the user moves on meanwhile.
    while (this.running) {
      if (request.stop()) return { kind: "stopped" };
      await new Promise((done) => window.setTimeout(done, 100));
    }
    this.running = true;
    try {
      return await this.work(request);
    } catch (error) {
      console.warn("FineNotes: Beautify stopped", error);
      new Notice(
        error instanceof ModelNotDownloadedError
          ? t("view.notice.plain", { message: error.message })
          : isOutOfMemory(error)
            ? t("ai.neaten.noMemory")
            : t("ai.neaten.failed"),
        8000,
      );
      return { kind: "tidy" };
    } finally {
      // The writer stays loaded for the next use; its idle release lets it go, and the OCR on.
      this.running = false;
    }
  }

  /**
   * The writer's worker with `model` loaded, for Beautify and for writing
   * known text. The OCR is paused for as long as the worker lives (the two
   * models are never in memory together) and carries on when the worker is
   * let go (`IDLE_RELEASE_MS` unused, an error, the plugin unloading).
   * The worker is kept between uses: on the iPad a new worker started soon
   * after another was let go ran out of WebAssembly memory 3 times in 4
   * (24 November). If it still does, it is let go, and started once more
   * after a pause; a second failure is thrown (`isOutOfMemory` tells it).
   */
  async readyWriter(model: {
    manifest: WriterManifest;
    kind: WriterKind;
    key: string;
  }): Promise<WriterClient> {
    this.ocrHold ??= await this.host.pauseOcr();
    const writer = await this.writerClient();
    const { manifest, kind } = model;
    const files = async () => {
      const graphs: Record<string, ArrayBuffer> = {};
      for (const role of Object.keys(kind.graphs)) {
        graphs[role] = await this.bytes(manifest.graphs[role].file);
      }
      return { files: { graphs, wasm: await this.bytes(OCR_WASM_FILE.name) }, manifest };
    };
    try {
      await writer.ensureModel(model.key, files);
    } catch (error) {
      if (!isOutOfMemory(error)) throw error;
      console.warn(
        "FineNotes: the handwriting writer ran out of memory starting; trying once more",
        error,
      );
      this.retrying = true;
      try {
        writer.dispose();
        await new Promise((done) => window.setTimeout(done, OOM_RETRY_MS));
        await writer.ensureModel(model.key, files);
      } finally {
        this.retrying = false;
      }
    }
    return writer;
  }

  private async work(request: NeatenRequest): Promise<NeatenOutcome> {
    const store = this.host.models.register(WRITER_MODEL);
    // Looked at again each time (the files may have come by sync since launch): ~0.2 s on the iPad.
    await store.check(true);
    if (store.state.kind !== "ready") {
      // Beautify was chosen, so its download card shows every time, even after a "Not now":
      // with "auto" it stayed away, and a device with an older Dostoyev (2.0 where 2.1 is
      // pinned) only tidied, silently (25 November, Joost's iPad). Beautify tidies meanwhile.
      this.host.models.offer(WRITER_MODEL.id, "ask");
      return { kind: "tidy" };
    }
    const model = await this.loadModel();
    if ("problem" in model) {
      new Notice(problemText(model.problem), 8000);
      return { kind: "tidy" };
    }
    const { manifest, kind } = model;
    const writable = (ch: string): boolean => manifest.chars.indexOf(ch) > 0;
    const pool = await this.poolOf(writable);
    this.practiceLines = pool.length;
    if (pool.length < MIN_PRACTICE_LINES) {
      // Once a session: after that Beautify just tidies.
      if (!this.askedSheet) {
        this.askedSheet = true;
        new NeedsSheetModal(
          this.host.app,
          () => void writePracticePage(this.host.learningHost()),
        ).open();
      }
      return { kind: "tidy" };
    }
    if (request.stop()) return { kind: "stopped" };

    // The selected lines, top to bottom, and what Grape reads in each.
    const selected = request.strokes.filter(
      (s) => request.selected.has(s.id) && s.tool === "pen" && !s.shape,
    );
    const byId = new Map(selected.map((s) => [s.id, s]));
    // Lines found as Tidy you ask for finds them: a line climbing up to 30 degrees is one line.
    const found = measureLines(selected, ASKED_LEVEL_SLOPE).map((line) =>
      line.strokes.map((id) => byId.get(id)).filter((s): s is Stroke => !!s),
    );
    // A held word on no line of its own (a word alone) is read as a line by itself.
    const lines = found.length === 0 && request.word !== undefined ? [selected] : found;
    const profile = measureHand(request.strokes.filter((s) => s.tool === "pen" && !s.shape));
    if (lines.length === 0 || !profile) return { kind: "tidy" };
    const lexicon = this.host.lexicon();
    // The list holds the writer's answered words too (personal-words.ts), from every page.
    const listed = lexicon ? new Set(lexicon.words().map((w) => w.toLowerCase())) : null;
    const readings = await this.host.handwriting.readForNeaten(lines, lexicon);
    const jobsWith = async () => {
      const answers = request.note ? await this.host.answers(request.note, request.pageId) : [];
      // Read again after the questions: the answers just given are in it.
      const everAnswered = this.host.lexicon()?.answered?.() ?? new Set<string>();
      return lines.flatMap((strokes, li) => {
        // For a held word only its own letters must be ones the model has (`workWord`).
        const lineWritable = request.word === undefined ? writable : () => true;
        const job = this.jobOf(strokes, readings[li], lineWritable, listed, answers, everAnswered);
        return job ? [job] : [];
      });
    };
    let jobs = await jobsWith();
    if (request.word !== undefined) {
      return this.workWord(request, request.word, jobs, jobsWith, { model, pool, profile });
    }
    // Of the words Grape is not sure of, the least sure few are asked about with the word card,
    // as many as the words allow, on each line and in all (`questionBudget`; Joost, 25 November:
    // ten cards for two lines was far too many; 26 November: two per 8 words, not linear). An
    // answered word is written as answered; a skipped one stays the writer's ink.
    const wordCount = jobs.reduce((n, job) => n + job.read.length, 0);
    const questions = pickQuestions(
      unsureCandidates(jobs),
      (line) => questionBudget(jobs[line]?.read.length ?? 0),
      questionBudget(wordCount),
    );
    const asked = new Set(questions.map((q) => jobs[q.line].words[q.word][0]));
    if (questions.length > 0 && request.ask) {
      request.asking?.();
      const confirmed = await request.ask(questions.map((q) => jobs[q.line].words[q.word]));
      if (request.stop()) return { kind: "stopped" };
      // Answered words take the writer's text from the saved answers.
      if (confirmed.length > 0) jobs = await jobsWith();
    }
    // A word not asked about is written when Grape's sureness of it is at least
    // WRITE_UNASKED_FROM and it is more than one letter; else it keeps the writer's ink
    // (`own-ink.ts`; "Beautify this word", `workWord`, is the writer asking for that word).
    // The read-back below also keeps a written word that does not read back as itself.
    jobs = jobs
      .map((job) => ({ ...job, ...writeUnasked(job, asked) }))
      .map((job) => ({ ...job, rewrite: ownInkRewrite(job) }))
      .filter((job) => job.rewrite.some(Boolean));
    if (jobs.length === 0) return { kind: "tidy" };
    if (request.stop()) return { kind: "stopped" };

    // What the model is shown for each line, before it is loaded: the reader must make its rows.
    const refs: unknown[] = [];
    for (const [n, job] of jobs.entries()) {
      const shown = await this.shownFor(job.text, pool, manifest, kind);
      if (!shown) {
        new Notice(problemText({ kind: "rows", detail: "the reader's curves differ" }), 8000);
        return { kind: "tidy" };
      }
      refs.push(kind.reference(job.text, shown, manifest, n + 1));
    }
    // The neatness dial is how far the written line's letters are straightened; the
    // guidance is the model's own at every stop (`neatness.ts`, `straighten.ts`).
    const guidance = manifest.sampling
      ? guidanceAt(this.host.neatness(), manifest.sampling.guidance)
      : undefined;
    const strength = strengthAt(this.host.neatness());
    const tries = manifest.sampling?.tries ?? DEFAULT_TRIES;
    if (request.stop()) return { kind: "stopped" };

    // The writer, alone in memory with Grape.
    const writer = await this.readyWriter(model);
    const placing: LineToPlace<Stroke>[] = [];
    for (const [n, job] of jobs.entries()) {
      const ref = refs[n];
      if (!ref) continue;
      const done = await neatenLine(
        job.text,
        ref,
        n,
        (text, r, seed, id, low) => writer.write(text, r, seed, id, low, guidance),
        (written) => this.host.handwriting.readRows(written),
        {
          seed: 0,
          tries,
          repair: true,
          stop: request.stop,
          // Of two tries read equally well, the more even one.
          uneven: (written) => roughness(written, written.char, job.text),
        },
      );
      if (!done || request.stop()) return { kind: "stopped" };
      // Words flat and level, letters standing and leaning evenly; no letter redrawn.
      const written = straighten(done.written, done.written.char, job.text, strength);
      // What is placed is what was read: the straightened line is read once more. A word
      // whose writing Grape does not read back as the word, or reads back only with a letter
      // it is unsure of, stays in the writer's own ink: the model wrote "simple" as
      // "single", "again" as "ag ain" and "at" like "nt" on Joost's iPad.
      const back = await this.host.handwriting.readRowsSure(written);
      if (request.stop()) return { kind: "stopped" };
      const rewrite = readBackRewrite(job.text, back.text, job.rewrite, back.sure);
      if (!rewrite.some(Boolean)) continue;
      placing.push({
        strokes: job.strokes,
        words: job.words,
        rewrite,
        answered: job.answered,
        written: levelledStrokes(written, written.char, job.text),
        // Written at the writer's own x-height, or at the least the model writes legibly with their pen.
        xHeight: {
          ink: job.xHeight,
          written: writtenXHeight(written, written.char, job.text),
          least: leastXHeight(median(job.strokes.map((s) => s.size))),
        },
      });
    }
    // The level line stands clear of the page's other pen ink, that of lines placed with it too.
    const pen = request.strokes.filter((s) => s.tool === "pen" && !s.shape);
    const placed = placeLines(
      placing.map((p) => {
        const own = new Set(p.strokes.map((s) => s.id));
        const foreign = pen.filter((s) => !own.has(s.id));
        return { ...p, clear: clearanceFor(p.strokes, foreign, profile.xHeight) };
      }),
      profile,
      request.pageWidth,
    );
    const edit = neatenEdit(request.strokes, placed, profile, request.rules, request.selected);
    if (edit.added.length === 0) return { kind: "tidy" };
    // Each line's new strokes take the pen of the line's first stroke.
    return { kind: "done", edit, style: placing.map((line) => line.strokes[0]) };
  }

  /** One line's text, words, and which words to rewrite; null when the model cannot write it. */
  private jobOf(
    strokes: Stroke[],
    reading: LineReading | undefined,
    writable: (ch: string) => boolean,
    listed: ReadonlySet<string> | null,
    answers: readonly WordAnswer[],
    everAnswered: ReadonlySet<string> = new Set(),
  ): NeatenJob | null {
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
    const sure = sureOfAnswered(
      answered.words,
      wordSureness(text, reading.greedy, reading.chars, inList).map((s, i) =>
        answered.known.has(i) ? 1 : s,
      ),
      everAnswered,
    );
    const joined = joinPunctuation({
      words: answered.words,
      ink,
      rewrite,
      sure,
      known: answered.words.map((_, i) => answered.known.has(i)),
    });
    return {
      text: joined.words.join(" "),
      strokes,
      words: joined.ink,
      read: joined.words,
      rewrite: joined.rewrite,
      sure: joined.sure ?? [],
      known: joined.known ?? [],
      // The writer's x-height on this line, from the strokes Grape read as x-height letters.
      xHeight: inkXHeight(strokes, reading.chars),
      chars: reading.chars,
    };
  }

  /**
   * "Beautify this word": only the held word is rewritten. It is asked about
   * when Grape is not sure of it (the word card, as for lines), written alone,
   * read back, and put in its own place (`held-word.ts`); nothing else moves
   * but the words after it, and nothing is tidied. Tidy is never the outcome
   * here: a word that cannot be written stays as it is ("nothing").
   */
  private async workWord(
    request: NeatenRequest,
    held: string,
    first: NeatenJob[],
    again: () => Promise<NeatenJob[]>,
    ctx: {
      model: { manifest: WriterManifest; kind: WriterKind; key: string };
      pool: PoolLine[];
      profile: HandProfile;
    },
  ): Promise<NeatenOutcome> {
    const nothing: NeatenOutcome = { kind: "nothing" };
    let jobs = first;
    let at = heldWordAt(jobs, held);
    if (!at) return nothing;
    let job = jobs[at.line];
    // Asked about only when Grape is not sure of it, and never about another word.
    const word = at.word;
    const question = pickQuestions(
      unsureCandidates([job], { lone: true }).filter((q) => q.word === word),
    )[0];
    if (question && request.ask) {
      request.asking?.();
      const answered = await request.ask([job.words[at.word]]);
      if (request.stop()) return { kind: "stopped" };
      // Skipped: the word stays the writer's ink, and nothing needs saying.
      if (answered.length === 0) return { kind: "stopped" };
      jobs = await again();
      at = heldWordAt(jobs, held);
      if (!at) return nothing;
      job = jobs[at.line];
    }
    const text = job.read[at.word];
    const ink = job.words[at.word];
    const { manifest, kind } = ctx.model;
    if (!text || !ink?.length || !Array.from(text).every((ch) => manifest.chars.indexOf(ch) > 0))
      return nothing;
    const shown = await this.shownFor(text, ctx.pool, manifest, kind);
    if (!shown) {
      // Its own notice says why; a second one would only repeat it.
      new Notice(problemText({ kind: "rows", detail: "the reader's curves differ" }), 8000);
      return { kind: "stopped" };
    }
    const ref = kind.reference(text, shown, manifest, 1);
    const guidance = manifest.sampling
      ? guidanceAt(this.host.neatness(), manifest.sampling.guidance)
      : undefined;
    const tries = manifest.sampling?.tries ?? DEFAULT_TRIES;
    if (request.stop()) return { kind: "stopped" };
    const writer = await this.readyWriter(ctx.model);
    const done = await neatenLine(
      text,
      ref,
      0,
      (t2, r, seed, id, low) => writer.write(t2, r, seed, id, low, guidance),
      (written) => this.host.handwriting.readRows(written),
      {
        seed: 0,
        tries,
        repair: true,
        stop: request.stop,
        uneven: (written) => roughness(written, written.char, text),
      },
    );
    if (!done || request.stop()) return { kind: "stopped" };
    const written = straighten(
      done.written,
      done.written.char,
      text,
      strengthAt(this.host.neatness()),
    );
    // Placed only if it reads back as the word, every letter surely (as for lines).
    const back = await this.host.handwriting.readRowsSure(written);
    if (request.stop()) return { kind: "stopped" };
    if (!readBackRewrite(text, back.text, [true], back.sure)[0]) return nothing;
    // The feet of the held word's own letters (on a tilted line the line's would be off).
    const inWord = new Set(ink);
    const wordChars = job.chars.filter((c) =>
      c.strokes.every((i) => inWord.has(job.strokes[i]?.id ?? "")),
    );
    const line = measureLines(job.strokes, ASKED_LEVEL_SLOPE).sort(
      (a, b) => b.strokes.length - a.strokes.length,
    )[0];
    const placed = placeWord({
      line: job.strokes,
      word: ink,
      held,
      slope: line?.slope ?? 0,
      written: levelledStrokes(written, written.char, text),
      xHeight: {
        ink: job.xHeight,
        written: writtenXHeight(written, written.char, text),
        least: leastXHeight(median(job.strokes.map((s) => s.size))),
      },
      foot: {
        ink: inkFoot(job.strokes, wordChars),
        written: writtenFoot(written, written.char, text),
      },
      pageWidth: request.pageWidth,
    });
    if (!placed) return nothing;
    const style = job.strokes.find((s) => s.id === held) ?? job.strokes[0];
    return { kind: "done", edit: wordEdit(request.strokes, placed), style: [style] };
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
   * The copied lines to show for `text`, as the model's kind picks them,
   * tied to their letters by Grape when first needed, in the kind's order (a
   * line that cannot be is left out; the kind takes as many as it shows).
   * Null when the reader does not make the rows the model was trained on.
   */
  private async shownFor(
    text: string,
    pool: PoolLine[],
    manifest: WriterManifest,
    kind: WriterKind,
  ): Promise<TaggedLine[] | null> {
    const picked = kind.pick(text, pool, manifest.reference.lines + SPARE_LINES);
    const missing = picked.filter((line) => !this.tagged.has(line.key));
    if (missing.length > 0) {
      const { tol, norm } = manifest.rows;
      const tagged = await this.host.handwriting.tagLines(
        missing.map((line) => ({ text: line.text, strokes: line.strokes })),
        { tol, norm },
      );
      if (!tagged.rowsMatch) return null;
      missing.forEach((line, i) => this.tagged.set(line.key, tagged.lines[i] ?? null));
    }
    return picked
      .map((line) => this.tagged.get(line.key) ?? null)
      .filter((line): line is TaggedLine => line !== null);
  }

  /**
   * The model in the folder, read from its manifest and checked against
   * what this build runs (`manifest.ts`, `kinds.ts`); a problem says why
   * not. Read again when the manifest file changed (an update).
   */
  private async loadModel(): Promise<
    { manifest: WriterManifest; kind: WriterKind; key: string } | { problem: ManifestProblem }
  > {
    const data = await this.host.models.register(WRITER_MODEL).bytes();
    if (!data) throw new Error("the writer's manifest is missing");
    const text = new TextDecoder().decode(data);
    if (this.model && this.model.key === text) return this.model;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { problem: { kind: "invalid", detail: "not JSON" } };
    }
    const parsed = parseManifest(json, new Set(WRITER_KINDS.keys()));
    if ("problem" in parsed) return parsed;
    const found = kindFor(parsed.manifest);
    if ("problem" in found) return found;
    this.model = { manifest: parsed.manifest, kind: found.kind, key: text };
    return this.model;
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
      // The worker let go: the OCR may load again (not while `readyWriter` starts it once more).
      this.writer = new WriterClient(() => {
        if (this.retrying) return;
        this.ocrHold?.();
        this.ocrHold = null;
      });
    }
    return this.writer;
  }

  /**
   * Whether known text can be written in the writer's hand now: Beautify's
   * own rule (`writesInHand`), with the practice lines counted, not assumed.
   * The count is Beautify's (`practiceLines`); it is taken again at most
   * every {@link RECHECK_MS}. `readyNow` gives the last answer at once, for
   * menus built without waiting.
   */
  async ready(): Promise<boolean> {
    const now = Date.now();
    if (now - this.countedAt >= RECHECK_MS) {
      this.countedAt = now;
      try {
        const store = this.host.models.register(WRITER_MODEL);
        await store.check(true);
        if (store.state.kind === "ready") {
          const model = await this.loadModel();
          if (!("problem" in model)) {
            const writable = (ch: string): boolean => model.manifest.chars.indexOf(ch) > 0;
            this.practiceLines = (await this.poolOf(writable)).length;
          }
        }
      } catch (error) {
        console.warn("FineNotes: could not count the practice lines", error);
      }
    }
    return this.readyNow(false);
  }

  /** The last answer of {@link ready}: false while the lines were never counted; a count again behind when it is old. */
  readyNow(look = true): boolean {
    if (look && Date.now() - this.countedAt >= RECHECK_MS) void this.ready();
    return this.practiceLines !== null && this.writesInHand();
  }

  /** Whether the model writes character `ch` (null until the model was read). */
  writes(ch: string): boolean {
    return (this.model?.manifest.chars.indexOf(ch) ?? -1) > 0;
  }

  /**
   * Known text (a corrected word, typed text, an answer) written in the
   * writer's hand, as Beautify writes a line: the same model, practice
   * lines, the same guidance (the neatness slider), tries and repair. Each text is one line, with its
   * own noise (`seed` and its place). Returns each line's strokes in model
   * units, words stood level (`rows.levelledStrokes`), and the practice
   * lines' ink (a hand to size by on an empty page). Null when the writer is
   * not ready, a text has a letter the model lacks, or `stop` said so.
   * The writer starts as Beautify's does (`readyWriter`): the OCR paused while
   * it lives, one retry when memory runs out (then it throws: `isOutOfMemory`).
   */
  async writeKnown(
    texts: readonly string[],
    /**
     * `attempts`: how many times a line Grape misreads is written again (the best reading kept).
     * `exact`: a line counts only when Grape reads it back as the text (an answer); else null.
     */
    options: { stop?: () => boolean; seed?: number; exact?: boolean; attempts?: number } = {},
  ): Promise<{ lines: WrittenStroke[][]; sample: InkStroke[] } | null> {
    if (texts.length === 0) return null;
    // One writing at a time, Beautify's included: wait for one in progress.
    while (this.running) {
      if (options.stop?.()) return null;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    this.running = true;
    const stop = options.stop ?? (() => false);
    try {
      if (!(await this.ready())) return null;
      const model = await this.loadModel();
      if ("problem" in model) return null;
      const { manifest, kind } = model;
      const writable = (ch: string): boolean => manifest.chars.indexOf(ch) > 0;
      if (!texts.every((text) => text.trim() !== "" && Array.from(text).every(writable)))
        return null;
      const pool = await this.poolOf(writable);
      if (pool.length < MIN_PRACTICE_LINES) return null;
      const refs: unknown[] = [];
      for (const [n, text] of texts.entries()) {
        const shown = await this.shownFor(text, pool, manifest, kind);
        if (!shown) return null;
        // Each line its own choices of what is shown (the pieces kind), as its own noise.
        const ref = kind.reference(text, shown, manifest, (options.seed ?? 0) + n + 1);
        if (ref === null) return null;
        refs.push(ref);
        if (stop()) return null;
      }
      const guidance = manifest.sampling
        ? guidanceAt(this.host.neatness(), manifest.sampling.guidance)
        : undefined;
      const tries = manifest.sampling?.tries ?? DEFAULT_TRIES;
      // The writer as Beautify starts it: the OCR paused while it lives, one retry when memory runs out.
      const writer = await this.readyWriter(model);
      const lines: WrittenStroke[][] = [];
      for (const [n, text] of texts.entries()) {
        let kept: Awaited<ReturnType<typeof neatenLine>> = null;
        let best: Awaited<ReturnType<typeof neatenLine>> = null;
        // Written again from other noise until Grape reads it back as the text (a word it
        // misreads may be misshapen: "friena", "bridye" on the iPad, 2026-11-25); otherwise
        // the best reading is kept, or for `exact` (an answer) nothing.
        for (
          let attempt = 0;
          attempt < (options.exact ? EXACT_ATTEMPTS : (options.attempts ?? 1));
          attempt++
        ) {
          const done = await neatenLine(
            text,
            refs[n],
            n,
            (t, r, seed, id, low) => writer.write(t, r, seed, id, low, guidance),
            (written) => this.host.handwriting.readRows(written),
            { seed: (options.seed ?? 0) + attempt * 7919, tries, repair: true, stop },
          );
          if (!done || stop()) return null;
          if (readsAs(text, done.read)) {
            kept = done;
            break;
          }
          if (!best || errorRate(text, done.read) < errorRate(text, best.read)) best = done;
        }
        if (!options.exact) kept ??= best;
        if (!kept) return null;
        lines.push(levelledStrokes(kept.written, kept.written.char, text));
      }
      return { lines, sample: pool.flatMap((line) => line.strokes) };
    } finally {
      // The worker stays for the next writing; its idle release lets it go and the OCR resume.
      this.running = false;
    }
  }

  /** Let the writer's worker go (the plugin unloads). */
  dispose(): void {
    this.writer?.dispose();
    this.writer = null;
  }
}

/** What the user is told about a model this build cannot run (the detail goes to the console). */
export function problemText(problem: ManifestProblem): string {
  console.warn("FineNotes: the handwriting writer cannot be used", problem);
  // A newer format or kind, or rows this build does not make: FineNotes is behind the model.
  return problem.kind === "invalid" ? t("ai.neaten.modelBroken") : t("ai.neaten.modelNewer");
}

/** "Neaten needs your handwriting": Learn's practice sheet, the same sheet for both. */
export class NeedsSheetModal extends Modal {
  constructor(
    app: App,
    private readonly write: () => void,
    /** Asked for a corrected word, not by Beautify: says so. */
    private readonly forWord = false,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(t(this.forWord ? "ai.hand.needsSheetTitle" : "ai.neaten.needsSheetTitle"));
    const body = this.forWord ? "ai.hand.needsSheet" : "ai.neaten.needsSheet";
    this.contentEl.createEl("p", { text: t(body, { min: MIN_PRACTICE_LINES }) });
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
