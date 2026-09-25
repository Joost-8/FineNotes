/**
 * "Generate image": a prompt, a shape (square / landscape / portrait) and a
 * Generate button. The host does the rest — consent, the request, saving the
 * picture into the vault and placing it on the page — and this modal only
 * shows progress and the vendor's own error message if it fails.
 */

import { type App, Modal } from "obsidian";
import type { ImageAspect } from "../recognition/ai-image";
import { errorMessage } from "../util/errors";

export interface GenerateImageHost {
  /** "OpenAI (GPT)" … — where the prompt goes. */
  target: string;
  /** 1-based page the picture will be placed on. */
  pageNumber: number;
  aspect: ImageAspect;
  /** Resolves true when the picture is on the page, false when the user declined to send. */
  generate: (prompt: string, aspect: ImageAspect) => Promise<boolean>;
}

const ASPECTS: ReadonlyArray<{ id: ImageAspect; label: string }> = [
  { id: "square", label: "Square" },
  { id: "landscape", label: "Landscape" },
  { id: "portrait", label: "Portrait" },
];

export class GenerateImageModal extends Modal {
  private aspect: ImageAspect;
  private busy = false;
  private closed = false;
  private readonly aspectButtons = new Map<ImageAspect, HTMLButtonElement>();

  constructor(
    app: App,
    private readonly host: GenerateImageHost,
  ) {
    super(app);
    this.aspect = host.aspect;
  }

  override onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("goodobsidian-genimage-modal", "goodobsidian-dialog");
    this.titleEl.setText("Generate image");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-ask");

    const input = contentEl.createEl("textarea", { cls: "goodobsidian-ask-input" });
    input.placeholder = "Describe the picture — e.g. a labelled diagram of a plant cell";
    input.rows = 4;

    const seg = contentEl.createDiv({ cls: "goodobsidian-segmented" });
    for (const { id, label } of ASPECTS) {
      const button = seg.createEl("button", { cls: "clickable-icon", text: label });
      button.addEventListener("click", () => {
        if (this.busy) return;
        this.aspect = id;
        this.syncAspect();
      });
      this.aspectButtons.set(id, button);
    }
    this.syncAspect();

    contentEl.createDiv({
      cls: "goodobsidian-ask-note",
      text:
        `Sends your description to ${this.host.target}. The picture is saved with this ` +
        `note's images and placed on page ${this.host.pageNumber}.`,
    });
    const status = contentEl.createDiv({ cls: "goodobsidian-ask-status" });

    const actions = contentEl.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const generate = actions.createEl("button", { cls: "mod-cta", text: "Generate" });

    const run = async (): Promise<void> => {
      const prompt = input.value.trim();
      if (!prompt || this.busy) {
        input.focus();
        return;
      }
      this.busy = true;
      generate.disabled = true;
      status.removeClass("is-error");
      status.setText("Generating… this can take up to a minute.");
      try {
        const placed = await this.host.generate(prompt, this.aspect);
        if (this.closed) return;
        if (placed) {
          this.close();
          return;
        }
        status.setText("");
      } catch (error) {
        if (this.closed) return;
        status.addClass("is-error");
        status.setText(errorMessage(error));
      } finally {
        this.busy = false;
        if (!this.closed) generate.disabled = false;
      }
    };
    generate.addEventListener("click", () => void run());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void run();
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  override onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }

  private syncAspect(): void {
    for (const [id, button] of this.aspectButtons) {
      button.toggleClass("is-active", id === this.aspect);
      button.setAttribute("aria-pressed", String(id === this.aspect));
    }
  }
}
