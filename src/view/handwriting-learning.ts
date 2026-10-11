/**
 * Learning the user's handwriting: the practice files, a tuning run in the
 * background, and the learned model's file (research/
 * PERSONAL_HANDWRITING_MODEL.md, the practice-page version).
 *
 * A run starts from the built-in model every time, in a worker of its own
 * (reading goes on meanwhile), learns from every practice file in the vault,
 * and keeps its result only when it reads the held-out practice lines better
 * than the built-in model. It belongs to the plugin, not to a dialog: the
 * settings show its progress on the Learn now button and can stop it, and
 * closing them leaves it running. The learned model is a file in the
 * plugin's folder, `handwriting/personal.bin`; the one it replaced is kept
 * beside it as `personal-prev.bin`.
 */

import { type App, Notice, type TFile, normalizePath } from "obsidian";
import { PRACTICE_FILE_SUFFIX } from "../constants";
import { DEFAULT_PAGE_GEOMETRY, type InkDocument } from "../model/document";
import { parseInkFile } from "../model/serialize";
import type { HwrWorkerClient } from "../recognition/hwr/client";
import type { HwrProgress, HwrTuned } from "../recognition/hwr/protocol";
import type { LabelledLine } from "../recognition/hwr/tune";
import { PRACTICE_SETS, practiceLines } from "../recognition/practice";
import { errorMessage } from "../util/errors";
import { bundledModel } from "./handwriting";

/** Fewer copied lines than this, and there is not enough to learn from. */
export const MIN_PRACTICE_LINES = 10;
/** The recipe's steps (93 % of the gain of 300, in the rig). */
export const LEARN_STEPS = 100;

/** What the settings keep about the learned model. */
export interface LearnedModel {
  /** When it was learned, ISO. */
  learnedAt: string;
  /** Lines it learned from, and lines it was tested on. */
  lines: number;
  tested: number;
  /** Characters wrong on the test lines, in %, with the built-in model and with it. */
  before: number;
  after: number;
}

/** What the learning code needs from the plugin. */
export interface LearningHost {
  app: App;
  /** The plugin's folder in the vault (`manifest.dir`). */
  pluginDir: string;
  settings: {
    handwritingModel?: LearnedModel;
    /** The practice notebook made before practice files, if any. */
    practiceNotebookPath?: string;
  };
  saveSettings(): Promise<void>;
  /** Create practice file `set` and open it; the file, or null. */
  createPracticeFile(set: number): Promise<TFile | null>;
  /** The reader should load its model again (a new one was saved, or reset). */
  reloadReader(): void;
  /** The notebook at `path` as it is now, when it is open (unsaved ink included). */
  openNotebook(path: string): InkDocument | null;
}

/** Where the learned model is kept, in the vault. */
export function learnedModelPath(pluginDir: string, previous = false): string {
  return normalizePath(`${pluginDir}/handwriting/personal${previous ? "-prev" : ""}.bin`);
}

/** A share of characters wrong, in %, to one decimal. */
const percent = (s: { errors: number; chars: number }): number =>
  s.chars > 0 ? Math.round((1000 * s.errors) / s.chars) / 10 : 0;

/** What the settings say about the learned model, in a sentence. */
export function learnedSummary(model: LearnedModel | undefined): string {
  if (!model) {
    return "Copy a page of practice lines once, and FineNotes tunes its handwriting reader to your writing, on this device, in a few minutes.";
  }
  const date = model.learnedAt.slice(0, 10);
  return `Learned from ${model.lines} of your lines on ${date}: on ${model.tested} test lines it gets ${model.after} % of characters wrong, against ${model.before} % before.`;
}

/** The set a practice file's name says it is: "Handwriting practice 2.practice.md" is 2. */
export function practiceSetOf(name: string): number | null {
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

/** The practice files in the vault, and the practice notebook from before them. */
export function practiceFiles(host: LearningHost): TFile[] {
  const files = host.app.vault
    .getMarkdownFiles()
    .filter((file) => file.name.toLowerCase().endsWith(PRACTICE_FILE_SUFFIX));
  const legacy = host.settings.practiceNotebookPath;
  const old = legacy ? host.app.vault.getFileByPath(legacy) : null;
  if (old && !files.includes(old)) files.push(old);
  return files;
}

/** Write the next practice set to a new file, and open it. */
export async function writePracticePage(host: LearningHost): Promise<void> {
  const sets = practiceFiles(host).map((file) => practiceSetOf(file.name));
  await host.createPracticeFile(nextPracticeSet(sets));
}

/** The copied lines of one practice file: from the open notebook, else from its file. */
export async function readPracticeLines(
  host: LearningHost,
  path: string,
): Promise<LabelledLine[] | null> {
  let doc = host.openNotebook(path);
  if (!doc) {
    const file = host.app.vault.getFileByPath(path);
    if (!file) return null;
    doc = parseInkFile(await host.app.vault.read(file), DEFAULT_PAGE_GEOMETRY.width).doc;
  }
  if (!doc) return null;
  return practiceLines(doc).map((line) => ({
    text: line.text,
    strokes: line.strokes.map((s) => ({ pts: s.pts, t0: s.t0 ?? null })),
  }));
}

/** Every practice file's copied lines, in one list. */
export async function readAllPracticeLines(host: LearningHost): Promise<LabelledLine[]> {
  const out: LabelledLine[] = [];
  for (const file of practiceFiles(host)) {
    out.push(...((await readPracticeLines(host, file.path)) ?? []));
  }
  return out;
}

/** Remove the learned model: reading goes back to the built-in one. */
export async function resetLearnedModel(host: LearningHost): Promise<void> {
  const adapter = host.app.vault.adapter;
  for (const previous of [false, true]) {
    const file = learnedModelPath(host.pluginDir, previous);
    if (await adapter.exists(file)) await adapter.remove(file);
  }
  delete host.settings.handwritingModel;
  await host.saveSettings();
  host.reloadReader();
  new Notice("FineNotes: reading with the built-in handwriting model again.");
}

/** Save a tuned model: the old one becomes the previous one. */
async function saveLearned(host: LearningHost, tuned: HwrTuned): Promise<void> {
  const adapter = host.app.vault.adapter;
  const file = learnedModelPath(host.pluginDir);
  const previous = learnedModelPath(host.pluginDir, true);
  const folder = normalizePath(`${host.pluginDir}/handwriting`);
  if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  if (await adapter.exists(file)) {
    if (await adapter.exists(previous)) await adapter.remove(previous);
    await adapter.rename(file, previous);
  }
  await adapter.writeBinary(file, tuned.bytes);
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
    const lines = await readAllPracticeLines(host);
    if (lines.length < MIN_PRACTICE_LINES) {
      new Notice(
        `FineNotes: copy at least ${MIN_PRACTICE_LINES} practice lines first; ${lines.length} so far.`,
        8000,
      );
      return;
    }
    this.stopped = false;
    this.current = { step: 0, steps: LEARN_STEPS, startedAt: Date.now() };
    this.emit();
    let tuned: HwrTuned | null = null;
    try {
      const { HwrWorkerClient } = await import("../recognition/hwr/client");
      const client = new HwrWorkerClient();
      this.client = client;
      tuned = await client.tune(
        await bundledModel(),
        lines,
        LEARN_STEPS,
        "finenotes-hwr-1.0, learned",
        (p: HwrProgress) => {
          if (this.current) this.current = { ...this.current, step: p.step, steps: p.steps };
          this.emit();
        },
      );
    } catch (error) {
      if (!this.stopped) new Notice(`FineNotes: learning stopped — ${errorMessage(error)}`, 10000);
      this.finish();
      return;
    }
    this.finish();
    await this.conclude(host, tuned);
  }

  /** Stop the run; nothing is saved. */
  stop(): void {
    if (!this.current) return;
    this.stopped = true;
    this.finish();
    new Notice("FineNotes: stopped learning your handwriting. Nothing was changed.");
  }

  private finish(): void {
    this.client?.terminate();
    this.client = null;
    this.current = null;
    this.emit();
  }

  /** Keep the result if it reads better, and say what came of it. */
  private async conclude(host: LearningHost, tuned: HwrTuned | null): Promise<void> {
    if (!tuned) {
      new Notice("FineNotes: there was nothing to learn from in the practice lines.", 10000);
      return;
    }
    const before = percent(tuned.before);
    const after = percent(tuned.after);
    if (!tuned.better) {
      new Notice(
        `FineNotes: on ${tuned.heldOut} test lines the learned reader got ${after} % of characters wrong, against ${before} % with the built-in one, so FineNotes keeps the built-in one. Copy more practice lines (another set helps) and try again.`,
        0,
      );
      return;
    }
    try {
      await saveLearned(host, tuned);
    } catch (error) {
      new Notice(`FineNotes: could not save the learned model — ${errorMessage(error)}`, 10000);
      return;
    }
    host.settings.handwritingModel = {
      learnedAt: new Date().toISOString(),
      lines: tuned.trained,
      tested: tuned.heldOut,
      before,
      after,
    };
    await host.saveSettings();
    host.reloadReader();
    this.emit();
    new Notice(
      `FineNotes learned your handwriting: on ${tuned.heldOut} test lines it now gets ${after} % of characters wrong, against ${before} % before.`,
      0,
    );
  }

  dispose(): void {
    this.client?.terminate();
    this.client = null;
    this.current = null;
    this.listeners.clear();
  }
}
