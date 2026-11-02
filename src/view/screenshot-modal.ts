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
 *
 * A selection's picture shows the page behind it, as the page shows it:
 * paper, PDF and everything drawn there (FineNotes discussion #107). A
 * switch at the start of the actions, lit while it does, leaves the page out
 * for the selection on its own; Copy, Share and Save take the one shown.
 */

import { type App, Modal, setIcon } from "obsidian";
import { errorMessage } from "../util/errors";

/** What the dialog's second choice is on this platform. */
export type ScreenshotSecond = "share" | "save";

/**
 * Share when the platform takes a file through Web Share, else save.
 * Whether there is `navigator.share`, and `navigator.canShare`, are passed
 * in, so the rule is testable.
 */
export function screenshotSecond(
  hasShare: boolean,
  canShare: ((data: { files: File[] }) => boolean) | undefined,
  file: File,
): ScreenshotSecond {
  if (!hasShare || typeof canShare !== "function") return "save";
  try {
    return canShare({ files: [file] }) ? "share" : "save";
  } catch {
    return "save";
  }
}

/** A picture the dialog shows, and its size in page px. */
export interface ScreenshotPicture {
  png: Blob;
  width: number;
  height: number;
}

export interface ScreenshotHost {
  /** Put the PNG on the clipboard; whether it got there. */
  copy(png: Blob): Promise<boolean>;
  /** Save the picture into the vault; its path, or null when it could not. */
  save(picture: ScreenshotPicture): Promise<string | null>;
  /** Say briefly what happened, once the dialog is gone. */
  tell(text: string): void;
}

export class ScreenshotModal extends Modal {
  private readonly urls = new Map<ScreenshotPicture, string>();
  /** The picture shown, which Copy, Share and Save take. */
  private shown: ScreenshotPicture;

  constructor(
    app: App,
    /** The picture, with the page behind a selection's. */
    private readonly picture: ScreenshotPicture,
    /** The file name it is shared or saved under. */
    private readonly name: string,
    private readonly host: ScreenshotHost,
    /** The selection on its own, for the switch; absent, there is no switch. */
    private readonly inkOnly?: ScreenshotPicture,
  ) {
    super(app);
    this.shown = picture;
  }

  private urlOf(picture: ScreenshotPicture): string {
    let url = this.urls.get(picture);
    if (!url) {
      url = URL.createObjectURL(picture.png);
      this.urls.set(picture, url);
    }
    return url;
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-screenshot-modal");
    this.titleEl.setText("Screenshot");
    const body = this.contentEl;
    const preview = body.createDiv({ cls: "goodobsidian-screenshot-preview" });
    const img = preview.createEl("img", {
      attr: { src: this.urlOf(this.shown), alt: "The selection as a picture" },
    });
    const status = body.createDiv({ cls: "goodobsidian-ask-status" });
    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });

    const inkOnly = this.inkOnly;
    if (inkOnly) {
      // The page behind it: lit while it shows, off for the selection alone.
      const page = actions.createEl("button", {
        cls: "clickable-icon goodobsidian-screenshot-page",
        attr: { "aria-label": "Page behind" },
      });
      setIcon(page, "layers");
      const sync = (): void => {
        const on = this.shown === this.picture;
        page.toggleClass("is-active", on);
        page.setAttribute("aria-pressed", String(on));
        img.src = this.urlOf(this.shown);
      };
      sync();
      page.addEventListener("click", () => {
        this.shown = this.shown === this.picture ? inkOnly : this.picture;
        sync();
      });
    }

    const file = (): File => new File([this.shown.png], this.name, { type: "image/png" });
    const web = typeof navigator !== "undefined" ? navigator : undefined;
    const second = screenshotSecond(
      typeof web?.share === "function",
      typeof web?.canShare === "function" ? (data) => web.canShare(data) : undefined,
      file(),
    );
    if (second === "share") {
      const share = actions.createEl("button", { text: "Share…" });
      share.addEventListener("click", () => {
        navigator.share({ files: [file()], title: this.name }).then(
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
        void this.host.save(this.shown).then((path) => {
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
      void this.host.copy(this.shown.png).then((copied) => {
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
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.contentEl.empty();
  }
}
