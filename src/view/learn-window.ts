/**
 * "Learn your handwriting": one window for the whole of it, opened from the
 * AI menu, the settings and the practice sheet's button. It shows the three
 * sheets, what there is to learn from, a run's progress with Stop, and how
 * the run ended, with the one next step as its filled button
 * (`recognition/hwr/learn-window-model.ts` decides what it says).
 *
 * The run belongs to the plugin's learner, not to the window: closing the
 * window leaves it running, and while a window is open it tells the result
 * there rather than in a notice.
 */

import { type App, Modal, setIcon } from "obsidian";
import { PRACTICE_SETS } from "../recognition/practice";
import {
  type LearnAction,
  type LearnResult,
  type LearnWindowView,
  learnWindow,
} from "../recognition/hwr/learn-window-model";
import type { PracticeSheet } from "../recognition/hwr/learned-model";
import {
  type HandwritingLearner,
  type LearningHost,
  practiceSheets,
  readCorrections,
  symbolsToWrite,
  writePracticePage,
  writeSymbolPractice,
} from "./handwriting-learning";

/** What the window needs from the plugin. */
export interface LearnWindowHost {
  learningHost(): LearningHost;
  learner: HandwritingLearner;
  /** Read with Grape alone: the result's "Go back to Grape". */
  setHandwritingReader(choice: string): Promise<void>;
}

/** What the vault holds toward learning, read when the window opens and after a run. */
interface Material {
  sheets: PracticeSheet[];
  corrections: number;
  symbolsWanted: boolean;
}

export class LearnWindow extends Modal {
  private material: Material | null = null;
  private result: LearnResult | null = null;
  private readonly dispose: Array<() => void> = [];
  /** Redraws the time left once a second while a run is on. */
  private ticker = 0;

  constructor(
    app: App,
    private readonly host: LearnWindowHost,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-learn-window");
    const learner = this.host.learner;
    this.dispose.push(
      learner.subscribe(() => this.draw()),
      learner.present((result) => {
        this.result = result;
        // A run that ended changed what there is: the sheets it used, the model.
        void this.load();
      }),
    );
    this.ticker = window.setInterval(() => {
      if (learner.progress) this.draw();
    }, 1000);
    this.draw();
    void this.load();
  }

  override onClose(): void {
    for (const off of this.dispose.splice(0)) off();
    window.clearInterval(this.ticker);
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    const host = this.host.learningHost();
    const [sheets, corrections, symbols] = await Promise.all([
      practiceSheets(host),
      readCorrections(host),
      symbolsToWrite(host),
    ]);
    this.material = {
      sheets,
      corrections: corrections.corrections.length,
      // No symbol sheet yet, or symbols added since it was written.
      symbolsWanted: symbols === null || symbols.length > 0,
    };
    this.draw();
  }

  /** The window as it stands now; before the vault is read, an empty card. */
  private draw(): void {
    const { contentEl } = this;
    contentEl.empty();
    const material = this.material;
    if (!material) return;
    const view = learnWindow({
      sheets: material.sheets,
      sets: PRACTICE_SETS.length,
      corrections: material.corrections,
      run: this.host.learner.progress,
      result: this.result,
      symbolsWanted: material.symbolsWanted,
      now: Date.now(),
    });
    this.titleEl.empty();
    setIcon(this.titleEl.createSpan({ cls: "goodobsidian-learn-icon" }), "graduation-cap");
    this.titleEl.createSpan({ text: view.title });
    contentEl.createDiv({ cls: "goodobsidian-learn-lead", text: view.lead });
    if (view.phase === "running") this.drawRun(contentEl, view);
    else if (view.phase === "better" && this.result?.kind === "better") {
      const { before, after } = this.result;
      const big = contentEl.createDiv({ cls: "goodobsidian-learn-big" });
      big.createSpan({ text: `${before} % → ${after} %` });
      big.createSpan({ cls: "goodobsidian-learn-unit", text: " mistakes" });
    } else if (view.phase === "kept" && this.result?.kind === "kept") {
      const { kept, learned, mine } = this.result;
      const big = contentEl.createDiv({ cls: "goodobsidian-learn-big" });
      big.createSpan({ text: `${kept} %` });
      big.createSpan({
        cls: "goodobsidian-learn-unit",
        text: ` with ${mine ? "your model" : "Grape"} · ${learned} % learned`,
      });
    } else if (view.marks.length > 0) this.drawSheets(contentEl, view, material);
    if (view.note) contentEl.createDiv({ cls: "goodobsidian-learn-note", text: view.note });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    for (const button of view.buttons) {
      const el = row.createEl("button", { text: button.label });
      if (button.cta) el.addClass("mod-cta");
      el.addEventListener("click", () => void this.act(button.action));
    }
  }

  /** The three sheets as marks, the symbol sheet beside them, and what there is. */
  private drawSheets(parent: HTMLElement, view: LearnWindowView, material: Material): void {
    const marks = parent.createDiv({ cls: "goodobsidian-learn-sheets" });
    for (const mark of view.marks) {
      const cell = marks.createDiv({ cls: `goodobsidian-learn-sheet is-${mark.state}` });
      const sign = cell.createDiv({ cls: "goodobsidian-learn-sheet-mark" });
      if (mark.state === "done") setIcon(sign, "check");
      else sign.setText(String(mark.set));
      cell.createDiv({ text: `Sheet ${mark.set}` });
      if (mark.detail)
        cell.createDiv({ cls: "goodobsidian-learn-sheet-detail", text: mark.detail });
    }
    if (view.symbols) {
      const symbols = parent.createEl("button", {
        cls: "goodobsidian-learn-extra clickable-icon",
        text: "+ Symbols sheet",
      });
      symbols.setAttribute("aria-label", "Write the symbol sheet: digits, operators and signs");
      symbols.addEventListener("click", () => void this.act({ kind: "symbols" }));
    }
    const count = (label: string, value: string): void => {
      const line = parent.createDiv({ cls: "goodobsidian-learn-count" });
      line.createSpan({ text: label });
      line.createEl("b", { text: value });
    };
    count(
      "Lines copied",
      view.missing > 0 ? `${view.lines} · ${view.missing} more needed` : String(view.lines),
    );
    count("Words you corrected", String(material.corrections));
  }

  private drawRun(parent: HTMLElement, view: LearnWindowView): void {
    const big = parent.createDiv({ cls: "goodobsidian-learn-big" });
    big.createSpan({ text: `${view.percent} %` });
    big.createSpan({
      cls: "goodobsidian-learn-unit",
      text: view.minutesLeft === null ? " · starting" : ` · about ${view.minutesLeft} min left`,
    });
    const meter = parent.createDiv({ cls: "goodobsidian-learn-meter" });
    meter.createDiv().setCssProps({ width: `${view.percent}%` });
  }

  private async act(action: LearnAction): Promise<void> {
    const host = this.host.learningHost();
    switch (action.kind) {
      case "write":
        this.close();
        await writePracticePage(host);
        return;
      case "continue":
        this.close();
        await this.app.workspace.openLinkText(action.path, "", false);
        return;
      case "symbols":
        this.close();
        await writeSymbolPractice(host);
        return;
      case "learn":
        this.result = null;
        await this.host.learner.start();
        this.draw();
        return;
      case "stop":
        this.host.learner.stop();
        return;
      case "grape":
        await this.host.setHandwritingReader("grape");
        this.close();
        return;
      case "close":
        this.close();
        return;
    }
  }
}
