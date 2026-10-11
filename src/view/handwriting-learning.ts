/**
 * Learning the user's handwriting: the practice notebook, a tuning run with
 * its progress, and the learned model's file (research/
 * PERSONAL_HANDWRITING_MODEL.md, the practice-page version).
 *
 * The run starts from the built-in model every time, in a worker of its own
 * (reading goes on meanwhile), and its result is kept only when it reads the
 * held-out practice lines better than the built-in model. The learned model
 * is a file in the plugin's folder, `handwriting/personal.bin`; the one it
 * replaced is kept beside it as `personal-prev.bin`.
 */

import { type App, Modal, Notice, Setting, type TFile, normalizePath } from "obsidian";
import { DEFAULT_PAGE_GEOMETRY, type InkDocument } from "../model/document";
import { parseInkFile } from "../model/serialize";
import type { HwrProgress, HwrTuned } from "../recognition/hwr/protocol";
import type { LabelledLine } from "../recognition/hwr/tune";
import { buildPracticeNotebook, practiceLines } from "../recognition/practice";
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
    practiceNotebookPath?: string;
  };
  saveSettings(): Promise<void>;
  /** Create a notebook with this document and open it; the file, or null. */
  createNotebook(title: string, build: () => InkDocument): Promise<TFile | null>;
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

/** Create the practice notebook, open it, and remember where it is. */
export async function writePracticePage(host: LearningHost): Promise<void> {
  const file = await host.createNotebook("Handwriting practice", () =>
    buildPracticeNotebook(DEFAULT_PAGE_GEOMETRY),
  );
  if (!file) return;
  host.settings.practiceNotebookPath = file.path;
  await host.saveSettings();
  new Notice(
    "FineNotes: copy each grey line on the line below it. Then choose Learn my handwriting in the settings, under Handwriting.",
    10000,
  );
}

/** The practice notebook's copied lines: from the open notebook, else from its file. */
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

/**
 * Learn from the practice notebook at `path` (the remembered one when
 * absent), with a dialog that shows the progress and the result.
 */
export async function learnHandwriting(host: LearningHost, path?: string): Promise<void> {
  const where = path ?? host.settings.practiceNotebookPath;
  if (!where) {
    new Notice("FineNotes: write the practice page first (Settings → FineNotes → Handwriting).");
    return;
  }
  const lines = await readPracticeLines(host, where);
  if (!lines) {
    new Notice(`FineNotes: could not find the practice notebook at "${where}".`);
    return;
  }
  if (lines.length < MIN_PRACTICE_LINES) {
    new Notice(
      `FineNotes: copy at least ${MIN_PRACTICE_LINES} practice lines first; ${lines.length} so far.`,
      8000,
    );
    return;
  }
  new LearnModal(host, lines).open();
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

/** The dialog of one learning run: progress, then what came of it. */
class LearnModal extends Modal {
  private stop: (() => void) | null = null;
  private finished = false;
  /** The dialog was closed before the run ended. */
  private cancelled = false;

  constructor(
    private readonly host: LearningHost,
    private readonly lines: LabelledLine[],
  ) {
    super(host.app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-learn");
    this.titleEl.setText("Learning your handwriting");
    void this.run();
  }

  override onClose(): void {
    // Closing before the end stops the run; nothing is saved.
    if (!this.finished) {
      this.cancelled = true;
      this.stop?.();
    }
    this.contentEl.empty();
  }

  private async run(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({
      cls: "setting-item-description",
      text: `From ${this.lines.length} practice lines, on this device. It takes a few minutes; you can keep using Obsidian, and closing this stops it.`,
    });
    const bar = contentEl.createEl("progress", { attr: { max: String(LEARN_STEPS), value: "0" } });
    bar.addClass("goodobsidian-learn-bar");
    const status = contentEl.createDiv({ cls: "setting-item-description", text: "Starting…" });
    const { HwrWorkerClient } = await import("../recognition/hwr/client");
    const client = new HwrWorkerClient();
    this.stop = () => client.terminate();
    const started = Date.now();
    const onProgress = (p: HwrProgress): void => {
      bar.value = p.step;
      const left = ((Date.now() - started) / p.step) * (p.steps - p.step);
      status.setText(
        `Step ${p.step} of ${p.steps} · about ${Math.max(1, Math.round(left / 60000))} min left`,
      );
    };
    let tuned: HwrTuned | null = null;
    try {
      tuned = await client.tune(
        await bundledModel(),
        this.lines,
        LEARN_STEPS,
        "finenotes-hwr-1.0, learned",
        onProgress,
      );
    } catch (error) {
      if (!this.cancelled) status.setText(`Learning stopped: ${errorMessage(error)}`);
      client.terminate();
      return;
    }
    client.terminate();
    this.finished = true;
    contentEl.empty();
    if (!tuned) {
      contentEl.createDiv({ text: "There was nothing to learn from in the practice lines." });
      this.addClose();
      return;
    }
    const before = percent(tuned.before);
    const after = percent(tuned.after);
    if (!tuned.better) {
      contentEl.createDiv({
        text: `On ${tuned.heldOut} test lines it got ${after} % of characters wrong, against ${before} % with the built-in model, so FineNotes keeps the built-in one. Copy more practice lines and try again.`,
      });
      this.addClose();
      return;
    }
    try {
      await saveLearned(this.host, tuned);
    } catch (error) {
      contentEl.createDiv({ text: `Could not save the learned model: ${errorMessage(error)}` });
      this.addClose();
      return;
    }
    this.host.settings.handwritingModel = {
      learnedAt: new Date().toISOString(),
      lines: tuned.trained,
      tested: tuned.heldOut,
      before,
      after,
    };
    await this.host.saveSettings();
    this.host.reloadReader();
    contentEl.createDiv({
      text: `Done. FineNotes now reads your handwriting with what it learned: on ${tuned.heldOut} test lines it gets ${after} % of characters wrong, against ${before} % before.`,
    });
    this.addClose();
  }

  private addClose(): void {
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Close")
        .setCta()
        .onClick(() => this.close()),
    );
  }
}
