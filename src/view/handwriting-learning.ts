/**
 * Learning the user's handwriting: the practice files, a tuning run in the
 * background, and the learned model's file (research/
 * PERSONAL_HANDWRITING_MODEL.md, the practice-page version).
 *
 * A run starts from Grape as downloaded every time, in a worker of its own
 * (reading goes on meanwhile), learns from every practice file in the vault,
 * and keeps its result only when it reads the held-out practice lines better
 * than Grape itself. It belongs to the plugin, not to a dialog: the
 * settings show its progress on the Learn now button and can stop it, and
 * closing them leaves it running. The learned model is a file in the
 * plugin's folder, `handwriting/grape-2/personal.bin`; the one it replaced
 * is kept beside it as `personal-prev.bin`, to go back to.
 *
 * A learned model is never removed on the way to something else: reading
 * with Grape alone is a switch (`useLearnedHandwriting`) that keeps the
 * file, and deleting it is its own action, confirmed first (Joost lost his
 * learned model to a "Use Grape" button that deleted it, 2026-10-21).
 */

import { type App, Notice, type TFile, normalizePath, setIcon } from "obsidian";
import {
  type CorrectionsFile,
  correctionLines,
  parseCorrections,
} from "../recognition/hwr/corrections";
import { correctionsPath } from "./word-check";
import { PRACTICE_FILE_SUFFIX } from "../constants";
import { DEFAULT_PAGE_GEOMETRY, type InkDocument } from "../model/document";
import { parseInkFile } from "../model/serialize";
import type { HwrWorkerClient } from "../recognition/hwr/client";
import type { HwrProgress, HwrTuned } from "../recognition/hwr/protocol";
import type { LabelledLine } from "../recognition/hwr/tune";
import {
  PRACTICE_SETS,
  SYMBOL_SET,
  isSymbolSet,
  missingSymbols,
  practiceLines,
  practicePrompts,
  practiceSetOfDoc,
  promptCount,
} from "../recognition/practice";
import {
  type LearnedModel,
  type LearnedSource,
  MIN_PRACTICE_LINES,
  type PracticeSheet,
  relearnText,
} from "../recognition/hwr/learned-model";
import { errorMessage } from "../util/errors";
import type { LearnResult } from "../recognition/hwr/learn-window-model";

export { type LearnedModel, MIN_PRACTICE_LINES };

/** The recipe's steps (93 % of the gain of 300, in the rig). */
export const LEARN_STEPS = 100;

/** What the learning code needs from the plugin. */
export interface LearningHost {
  app: App;
  /** The plugin's folder in the vault (`manifest.dir`). */
  pluginDir: string;
  settings: {
    handwritingModel?: LearnedModel;
    grape2Model?: LearnedModel;
    /** The models `personal-prev.bin` holds, kept to go back to. */
    handwritingModelPrevious?: LearnedModel;
    grape2ModelPrevious?: LearnedModel;
    /** Read with the learned model when its file is here; off, with Grape alone. */
    useLearnedHandwriting?: boolean;
    /** Corrected words there were at the last reminder to learn again, or the last run (`relearnDue`). */
    relearnRemindedAt?: number;
    /** The practice notebook made before practice files, if any. */
    practiceNotebookPath?: string;
  };
  saveSettings(): Promise<void>;
  /** Create practice file `set` (the symbol sheet: only lines `only`) and open it; the file, or null. */
  createPracticeFile(set: number, only?: readonly number[]): Promise<TFile | null>;
  /** The reader should load its model again (a new one was saved, or reset). */
  reloadReader(): void;
  /** Grape's bytes, to learn from; null (after offering the download) when it is not here. */
  baseModel(): Promise<ArrayBuffer | null>;
  /** The chosen Grape's id ("grape", "grape-2"), recorded with what is learned from it. */
  baseId: string;
  /** The notebook at `path` as it is now, when it is open (unsaved ink included). */
  openNotebook(path: string): InkDocument | null;
}

/**
 * Each Grape has its own learned model (learned from it, read only with it):
 * the setting that describes it.
 */
export function learnedKey(base: string): "handwritingModel" | "grape2Model" {
  return base === "grape-2" ? "grape2Model" : "handwritingModel";
}

/** The setting that describes the model before the last learning, kept to go back to. */
export function previousKey(base: string): "handwritingModelPrevious" | "grape2ModelPrevious" {
  return base === "grape-2" ? "grape2ModelPrevious" : "handwritingModelPrevious";
}

/** The learned model of the Grape `base` ("grape", "grape-2"), if there is one. */
export function learnedRecord(
  settings: LearningHost["settings"],
  base: string,
): LearnedModel | undefined {
  return settings[learnedKey(base)];
}

/** Where the learned model of Grape `base` is kept, in the vault: Grape 2's in its own folder. */
export function learnedModelPath(pluginDir: string, previous = false, base = "grape"): string {
  return normalizePath(`${learnedFolder(pluginDir, base)}/personal${previous ? "-prev" : ""}.bin`);
}

function learnedFolder(pluginDir: string, base: string): string {
  return normalizePath(`${pluginDir}/handwriting${base === "grape-2" ? "/grape-2" : ""}`);
}

/** A share of characters wrong, in %, to one decimal. */
const percent = (s: { errors: number; chars: number }): number =>
  s.chars > 0 ? Math.round((1000 * s.errors) / s.chars) / 10 : 0;

/** The learned model's file as it is now, to beat; null when there is none. */
async function readLearnedModel(host: LearningHost): Promise<ArrayBuffer | null> {
  const file = learnedModelPath(host.pluginDir, false, host.baseId);
  try {
    if (!learnedRecord(host.settings, host.baseId)) return null;
    return (await host.app.vault.adapter.exists(file))
      ? await host.app.vault.adapter.readBinary(file)
      : null;
  } catch {
    return null;
  }
}

/** Which learned model files are on this device: the one in use, and the one before it. */
export async function learnedFiles(
  host: LearningHost,
): Promise<{ current: boolean; previous: boolean; bytes: number }> {
  const adapter = host.app.vault.adapter;
  const current = await adapter.stat(learnedModelPath(host.pluginDir, false, host.baseId));
  const previous = await adapter.stat(learnedModelPath(host.pluginDir, true, host.baseId));
  return {
    current: current?.type === "file",
    previous: previous?.type === "file",
    bytes: current?.type === "file" ? current.size : 0,
  };
}

/**
 * The set a practice file's name says it is: "Handwriting practice 2.practice.md"
 * is 2, and "Symbol practice.practice.md" (or "Symbol practice 2…", a second
 * copy) is the symbol sheet.
 */
export function practiceSetOf(name: string): number | null {
  if (/^symbol practice( \d+)?\.practice\.md$/i.test(name)) return SYMBOL_SET;
  const match = /(\d+)\.practice\.md$/i.exec(name);
  const set = match ? Number(match[1]) : Number.NaN;
  return set >= 1 && set <= PRACTICE_SETS.length ? set : null;
}

/**
 * The set to write next: the first not written yet, else the one written
 * least often (more of the same lines still helps).
 */
export function nextPracticeSet(written: readonly (number | null)[]): number {
  const counts = PRACTICE_SETS.map((_, i) => written.filter((set) => set === i + 1).length);
  const fewest = Math.min(...counts);
  return counts.indexOf(fewest) + 1;
}

/**
 * The name the practice notebook from before practice files was made with
 * ("Handwriting practice", or "… 2" beside another).
 */
const LEGACY_NOTEBOOK = /^handwriting practice( \d+)?\.notebook\.md$/i;

/**
 * The practice files in the vault, and the practice notebook from before
 * them: at the path the settings keep, or, when it was moved while FineNotes
 * was not looking (Joost's was, and counted for nothing), by its name.
 */
export function practiceFiles(host: LearningHost): TFile[] {
  const markdown = host.app.vault.getMarkdownFiles();
  const files = markdown.filter((file) => file.name.toLowerCase().endsWith(PRACTICE_FILE_SUFFIX));
  const legacy = host.settings.practiceNotebookPath;
  const old = legacy ? host.app.vault.getFileByPath(legacy) : null;
  const notebooks = old ? [old] : markdown.filter((file) => LEGACY_NOTEBOOK.test(file.name));
  for (const notebook of notebooks) {
    if (!files.some((file) => file.path === notebook.path)) files.push(notebook);
  }
  return files;
}

/** Write the next practice set to a new file, and open it. */
export async function writePracticePage(host: LearningHost): Promise<void> {
  const sets = (await practiceSheets(host)).map((sheet) => sheet.set);
  await host.createPracticeFile(nextPracticeSet(sets));
}

/**
 * Write the symbol sheet to a new file, and open it. Beside a symbol sheet
 * written before lines were added to it, the new sheet has only those lines.
 */
export async function writeSymbolPractice(host: LearningHost): Promise<void> {
  const missing = await symbolsToWrite(host);
  await host.createPracticeFile(SYMBOL_SET, missing && missing.length > 0 ? missing : undefined);
}

/**
 * The symbol lines no symbol sheet in the vault asks for yet (indices into
 * `SYMBOL_LINES`), or null when there is no symbol sheet at all.
 */
export async function symbolsToWrite(host: LearningHost): Promise<number[] | null> {
  const docs: InkDocument[] = [];
  for (const file of practiceFiles(host)) {
    const doc = await readPracticeDoc(host, file.path).catch(() => null);
    if (doc && isSymbolSet(doc.practice?.set)) docs.push(doc);
  }
  return docs.length > 0 ? missingSymbols(docs) : null;
}

/** A practice file's document: the open notebook (unsaved ink included), else its file. */
async function readPracticeDoc(host: LearningHost, path: string): Promise<InkDocument | null> {
  const open = host.openNotebook(path);
  if (open) return open;
  const file = host.app.vault.getFileByPath(path);
  if (!file) return null;
  return parseInkFile(await host.app.vault.read(file), DEFAULT_PAGE_GEOMETRY.width).doc;
}

/** The copied lines of one practice file: from the open notebook, else from its file. */
export async function readPracticeLines(
  host: LearningHost,
  path: string,
): Promise<LabelledLine[] | null> {
  const doc = await readPracticeDoc(host, path);
  return doc ? copiedLines(doc) : null;
}

function copiedLines(doc: InkDocument): LabelledLine[] {
  return practiceLines(doc).map((line) => ({
    text: line.text,
    strokes: line.strokes.map((s) => ({ pts: s.pts, t0: s.t0 ?? null })),
  }));
}

/**
 * The words answered under "Underline words it may have misread", as
 * labelled lines (`recognition/hwr/corrections.ts`).
 */
export async function readCorrectionLines(host: LearningHost): Promise<LabelledLine[]> {
  return correctionLines(await readCorrections(host));
}

/** The corrections file as it is in the vault now. */
export async function readCorrections(host: LearningHost): Promise<CorrectionsFile> {
  const adapter = host.app.vault.adapter;
  const file = correctionsPath();
  return parseCorrections((await adapter.exists(file)) ? await adapter.read(file) : null);
}

/** Every practice file's copied lines, in one list, and how many came from each file. */
export async function readAllPracticeLines(
  host: LearningHost,
): Promise<{ lines: LabelledLine[]; sources: LearnedSource[] }> {
  const lines: LabelledLine[] = [];
  const sources: LearnedSource[] = [];
  for (const file of practiceFiles(host)) {
    const copied = (await readPracticeLines(host, file.path)) ?? [];
    lines.push(...copied);
    if (copied.length > 0) sources.push({ path: file.path, lines: copied.length });
  }
  return { lines, sources };
}

/**
 * The practice sheets in the vault, by set, with the lines copied on each
 * and the lines each asks for (its own prompts: a sheet keeps the lines it
 * was made with). The notebook from before practice files counts as the set
 * its prompts are; a notebook without prompts is no sheet.
 */
export async function practiceSheets(host: LearningHost): Promise<PracticeSheet[]> {
  const sheets: PracticeSheet[] = [];
  for (const file of practiceFiles(host)) {
    let set = practiceSetOf(file.name);
    let written = 0;
    let prompts = 0;
    try {
      const doc = await readPracticeDoc(host, file.path);
      if (doc) {
        set ??= practiceSetOfDoc(doc);
        written = copiedLines(doc).length;
        prompts = promptCount(doc);
      }
    } catch {
      // A sheet that does not parse is listed with nothing copied.
    }
    const practiceFile = file.name.toLowerCase().endsWith(PRACTICE_FILE_SUFFIX);
    if (prompts === 0 && !practiceFile) continue;
    sheets.push({
      path: file.path,
      title: file.name
        .replace(/\.practice\.md$/i, "")
        .replace(/\.notebook\.md$/i, "")
        .replace(/\.md$/i, ""),
      set,
      written,
      prompts: prompts || practicePrompts(set ?? 1).length,
    });
  }
  return sheets.sort((a, b) => (a.set ?? 0) - (b.set ?? 0) || a.title.localeCompare(b.title));
}

/**
 * Delete the learned model and the one before it: reading goes back to
 * Grape alone. The settings ask first (`deleteQuestion`); nothing else calls it.
 */
export async function deleteLearnedModel(host: LearningHost): Promise<void> {
  const adapter = host.app.vault.adapter;
  for (const previous of [false, true]) {
    const file = learnedModelPath(host.pluginDir, previous, host.baseId);
    if (await adapter.exists(file)) await adapter.remove(file);
  }
  delete host.settings[learnedKey(host.baseId)];
  delete host.settings[previousKey(host.baseId)];
  await host.saveSettings();
  host.reloadReader();
  new Notice("FineNotes: deleted your learned handwriting model. Reading uses Grape alone.");
}

/**
 * Go back to the model before the last learning: the two files swap, and so
 * do their records, so the same action goes forward again.
 */
export async function swapWithPrevious(host: LearningHost): Promise<void> {
  const adapter = host.app.vault.adapter;
  const file = learnedModelPath(host.pluginDir, false, host.baseId);
  const previous = learnedModelPath(host.pluginDir, true, host.baseId);
  if (!(await adapter.exists(previous))) return;
  const swap = `${file}.swap`;
  const had = await adapter.exists(file);
  if (had) await adapter.rename(file, swap);
  await adapter.rename(previous, file);
  if (had) await adapter.rename(swap, previous);
  const key = learnedKey(host.baseId);
  const prevKey = previousKey(host.baseId);
  const [now, before] = [host.settings[key], host.settings[prevKey]];
  if (before) host.settings[key] = before;
  else delete host.settings[key];
  if (now) host.settings[prevKey] = now;
  else delete host.settings[prevKey];
  host.settings.useLearnedHandwriting = true;
  await host.saveSettings();
  host.reloadReader();
  new Notice("FineNotes: swapped your learned handwriting model for the one before it.");
}

/** Save a tuned model: the old one becomes the previous one. */
async function saveLearned(host: LearningHost, tuned: HwrTuned): Promise<void> {
  const adapter = host.app.vault.adapter;
  const file = learnedModelPath(host.pluginDir, false, host.baseId);
  const previous = learnedModelPath(host.pluginDir, true, host.baseId);
  const folder = learnedFolder(host.pluginDir, host.baseId);
  if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  if (await adapter.exists(file)) {
    if (await adapter.exists(previous)) await adapter.remove(previous);
    await adapter.rename(file, previous);
  }
  await adapter.writeBinary(file, tuned.bytes);
}

/**
 * The reminder to learn again (`relearnDue`): the learn icon (the AI menu's),
 * a title, how many words, and a button that starts learning. It stays
 * until tapped; a tap anywhere else on it closes it, as on any notice.
 */
export function showRelearnNotice(fresh: number, learned: boolean, learn: () => void): Notice {
  const text = relearnText(fresh, learned);
  const notice = new Notice(
    createFragment((fragment) => {
      const card = fragment.createDiv({ cls: "goodobsidian-relearn-notice" });
      setIcon(card.createDiv({ cls: "goodobsidian-relearn-notice-icon" }), "graduation-cap");
      const words = card.createDiv({ cls: "goodobsidian-relearn-notice-words" });
      words.createDiv({ cls: "goodobsidian-relearn-notice-title", text: text.title });
      words.createDiv({ cls: "goodobsidian-relearn-notice-body", text: text.body });
      const button = card.createEl("button", {
        cls: "goodobsidian-relearn-notice-button mod-cta",
        text: learned ? "Learn again" : "Learn now",
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        notice.hide();
        learn();
      });
    }),
    0,
  );
  return notice;
}

/** A run in progress: how far along, and since when. */
export interface LearningProgress {
  step: number;
  steps: number;
  startedAt: number;
}

/** "Learning · 34 % · about 2 min left": what the Learn now button says while it runs. */
export function progressLabel(progress: LearningProgress, at: number): string {
  const share = Math.round((100 * progress.step) / progress.steps);
  if (progress.step === 0) return "Learning · starting…";
  const left = ((at - progress.startedAt) / progress.step) * (progress.steps - progress.step);
  return `Learning · ${share} % · about ${Math.max(1, Math.round(left / 60000))} min left`;
}

/**
 * The plugin's one learning run at a time. It outlives the settings tab:
 * the tab subscribes to show its progress, and closing the tab leaves it
 * running. The outcome is told in a notice, and in the settings next time.
 */
export class HandwritingLearner {
  private client: HwrWorkerClient | null = null;
  private current: LearningProgress | null = null;
  private stopped = false;
  private readonly listeners = new Set<() => void>();
  private readonly presenters = new Set<(result: LearnResult) => void>();

  constructor(private readonly host: () => LearningHost) {}

  /** The run in progress, or null. */
  get progress(): LearningProgress | null {
    return this.current;
  }

  /** Called on every change of progress, and when a run ends; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Learn from every practice file, in the background. Does nothing while a run is on. */
  async start(): Promise<void> {
    if (this.current) return;
    const host = this.host();
    // Practice lines first, then corrected words: every fifth is held out
    // for the gate, so both kinds are tested.
    const practice = await readAllPracticeLines(host);
    const corrections = await readCorrectionLines(host);
    const lines = [...practice.lines, ...corrections];
    if (lines.length < MIN_PRACTICE_LINES) {
      new Notice(
        `FineNotes: copy or correct at least ${MIN_PRACTICE_LINES} lines or words first; ${lines.length} so far.`,
        8000,
      );
      return;
    }
    const base = await host.baseModel();
    if (!base) {
      new Notice("FineNotes: learning starts from Grape, which is not downloaded yet.", 8000);
      return;
    }
    // The learned model this run would replace: the new one must beat it too.
    const rival = await readLearnedModel(host);
    this.stopped = false;
    const startedAt = Date.now();
    this.current = { step: 0, steps: LEARN_STEPS, startedAt };
    this.emit();
    let tuned: HwrTuned | null = null;
    try {
      const { HwrWorkerClient } = await import("../recognition/hwr/client");
      const client = new HwrWorkerClient();
      this.client = client;
      tuned = await client.tune(
        base,
        lines,
        LEARN_STEPS,
        "grape-1.0, learned",
        (p: HwrProgress) => {
          if (this.current) this.current = { ...this.current, step: p.step, steps: p.steps };
          this.emit();
        },
        rival ?? undefined,
      );
    } catch (error) {
      // The corrections are untouched: they still count as new, for the next run.
      if (!this.stopped) {
        this.tell({ kind: "failed", message: errorMessage(error) }, () => {
          new Notice(
            `FineNotes: learning stopped — ${errorMessage(error)}. Your sheets and corrected words are kept.`,
            10000,
          );
        });
      }
      this.finish();
      return;
    }
    this.finish();
    // A run that finished has had its say on these corrections: the next
    // reminder counts from here (a failed or stopped one leaves it be).
    host.settings.relearnRemindedAt = corrections.length;
    await host.saveSettings();
    await this.conclude(host, tuned, practice.sources, corrections.length, startedAt);
  }

  /** Stop the run; nothing is saved, and nothing is lost. */
  stop(): void {
    if (!this.current) return;
    this.stopped = true;
    this.finish();
    new Notice(
      "FineNotes: stopped learning your handwriting. Nothing was changed; your corrected words are kept.",
    );
  }

  private finish(): void {
    this.client?.terminate();
    this.client = null;
    this.current = null;
    this.emit();
  }

  /** Keep the result if it reads better, and say what came of it. */
  private async conclude(
    host: LearningHost,
    tuned: HwrTuned | null,
    sources: LearnedSource[],
    corrections: number,
    startedAt: number,
  ): Promise<void> {
    if (!tuned) {
      this.tell({ kind: "nothing" }, () => {
        new Notice("FineNotes: there was nothing to learn from in the practice lines.", 10000);
      });
      return;
    }
    const before = percent(tuned.before);
    const after = percent(tuned.after);
    if (!tuned.better && tuned.rival && tuned.after.errors < tuned.before.errors) {
      const rival = percent(tuned.rival);
      this.tell(
        { kind: "kept", tested: tuned.heldOut, kept: rival, learned: after, mine: true },
        () => {
          new Notice(
            `FineNotes: on ${tuned.heldOut} test lines the new reader got ${after} % of characters wrong, against ${rival} % with the one you have, so FineNotes keeps the one you have. Correct more words or write another practice set, and try again.`,
            0,
          );
        },
      );
      return;
    }
    if (!tuned.better) {
      const mine = tuned.rival !== undefined && tuned.rival !== null;
      this.tell(
        {
          kind: "kept",
          tested: tuned.heldOut,
          kept: mine && tuned.rival ? percent(tuned.rival) : before,
          learned: after,
          mine,
        },
        () => {
          new Notice(
            `FineNotes: on ${tuned.heldOut} test lines the learned reader got ${after} % of characters wrong, against ${before} % with the built-in one, so FineNotes keeps ${mine ? "the one you have" : "the built-in one"}. Copy more practice lines (another set helps) and try again.`,
            0,
          );
        },
      );
      return;
    }
    try {
      await saveLearned(host, tuned);
    } catch (error) {
      this.tell({ kind: "failed", message: `Could not save it: ${errorMessage(error)}` }, () => {
        new Notice(`FineNotes: could not save the learned model — ${errorMessage(error)}`, 10000);
      });
      return;
    }
    // The replaced model's record goes with its file, to personal-prev.bin.
    const replaced = host.settings[learnedKey(host.baseId)];
    if (replaced) host.settings[previousKey(host.baseId)] = replaced;
    else delete host.settings[previousKey(host.baseId)];
    host.settings[learnedKey(host.baseId)] = {
      // When it started: words corrected while it ran are new to it (`newCorrections`).
      learnedAt: new Date(startedAt).toISOString(),
      lines: tuned.trained,
      tested: tuned.heldOut,
      before,
      after,
      sources,
      corrections,
    };
    // Just learned: read with it.
    host.settings.useLearnedHandwriting = true;
    await host.saveSettings();
    host.reloadReader();
    this.emit();
    this.tell({ kind: "better", tested: tuned.heldOut, before, after }, () => {
      new Notice(
        `FineNotes learned your handwriting: on ${tuned.heldOut} test lines it now gets ${after} % of characters wrong, against ${before} % before.`,
        0,
      );
    });
  }

  /**
   * While a Learn your handwriting window is open, it tells how a run ended
   * (`show`); with none open, a notice does. Returns the unsubscribe.
   */
  present(show: (result: LearnResult) => void): () => void {
    this.presenters.add(show);
    return () => this.presenters.delete(show);
  }

  private tell(result: LearnResult, notice: () => void): void {
    if (this.presenters.size === 0) {
      notice();
      return;
    }
    for (const show of [...this.presenters]) show(result);
  }

  dispose(): void {
    this.client?.terminate();
    this.client = null;
    this.current = null;
    this.listeners.clear();
    this.presenters.clear();
  }
}
