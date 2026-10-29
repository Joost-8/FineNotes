/**
 * The lasso's Screenshot (Joost on PR #59): a small dialog showing the
 * picture of what is selected, with two choices, Copy and Share.
 *
 * - **Copy** puts the PNG on the system clipboard.
 * - **Share…** hands it to the system share sheet through the Web Share API
 *   (`navigator.share` with a file), as Export as PDF does: the iPad's and
 *   iPhone's share sheet, Android's, and the desktop's where Chromium offers
 *   one. Obsidian's own API has no share function.
 * - Where the platform cannot share a file (`navigator.canShare` says no,
 *   or there is no Web Share at all), the second choice is **Save image**:
 *   the PNG goes into the notebook's pictures folder, as an imported
 *   picture would.
 *
 * Both act on a fresh tap in the dialog: the clipboard and the share sheet
 * want a user gesture, which the menu's tap has spent by then.
 */

import { type App, Modal } from "obsidian";
import { errorMessage } from "../util/errors";

/** What the dialog's second choice is on this platform. */
export type ScreenshotSecond = "share" | "save";

/**
 * Share when the platform takes a file through Web Share, else save.
 * `share`/`canShare` are passed in (`navigator`'s), so the rule is testable.
 */
export function screenshotSecond(
  share: unknown,
  canShare: ((data: { files: File[] }) => boolean) | undefined,
  file: File,
): ScreenshotSecond {
  if (typeof share !== "function" || typeof canShare !== "function") return "save";
  try {
    return canShare({ files: [file] }) ? "share" : "save";
  } catch {
    return "save";
  }
}

export interface ScreenshotHost {
  /** Put the PNG on the clipboard; whether it got there. */
  copy(png: Blob): Promise<boolean>;
  /** Save the PNG into the vault; its path, or null when it could not. */
  save(png: Blob): Promise<string | null>;
  /** Say briefly what happened, once the dialog is gone. */
  tell(text: string): void;
}

export class ScreenshotModal extends Modal {
  private url: string | null = null;

  constructor(
    app: App,
    private readonly png: Blob,
    /** The file name it is shared or saved under. */
    private readonly name: string,
    private readonly host: ScreenshotHost,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-screenshot-modal");
    this.titleEl.setText("Screenshot");
    const body = this.contentEl;
    const preview = body.createDiv({ cls: "goodobsidian-screenshot-preview" });
    this.url = URL.createObjectURL(this.png);
    preview.createEl("img", { attr: { src: this.url, alt: "The selection as a picture" } });
    const status = body.createDiv({ cls: "goodobsidian-ask-status" });
    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });

    const file = new File([this.png], this.name, { type: "image/png" });
    const second = screenshotSecond(
      typeof navigator !== "undefined" ? navigator.share : undefined,
      typeof navigator !== "undefined" ? navigator.canShare?.bind(navigator) : undefined,
      file,
    );
    if (second === "share") {
      const share = actions.createEl("button", { text: "Share…" });
      share.addEventListener("click", () => {
        navigator.share({ files: [file], title: this.name }).then(
          () => this.close(),
          (error: unknown) => {
            // Dismissing the sheet rejects with AbortError; that is not a failure.
            if (error instanceof DOMException && error.name === "AbortError") return;
            status.addClass("is-error");
            status.setText(errorMessage(error));
          },
        );
      });
    } else {
      const save = actions.createEl("button", { text: "Save image" });
      save.addEventListener("click", () => {
        void this.host.save(this.png).then((path) => {
          if (!path) {
            status.addClass("is-error");
            status.setText("The picture could not be saved.");
            return;
          }
          this.close();
          this.host.tell(`Saved ${path}`);
        });
      });
    }
    const copy = actions.createEl("button", { cls: "mod-cta", text: "Copy" });
    copy.addEventListener("click", () => {
      void this.host.copy(this.png).then((copied) => {
        if (!copied) {
          status.addClass("is-error");
          status.setText("The picture could not be copied.");
          return;
        }
        this.close();
        this.host.tell("Copied as a picture");
      });
    });
  }

  override onClose(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.contentEl.empty();
  }
}
