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
 * paper, PDF and everything drawn there (FineNotes discussion #107). One
 * choice at the start of the actions says what the picture includes
 * (`screenshot-parts.ts`): everything, the selection on its own, or the page
 * behind it without its ink (FineNotes#211); Copy, Share and Save take the
 * one shown.
 */

import { type App, Modal, setIcon } from "obsidian";
import { t } from "../i18n/translate";
import { errorMessage } from "../util/errors";
import { SCREENSHOT_PARTS, SCREENSHOT_PART_ICONS, type ScreenshotPart } from "./screenshot-parts";

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

/** A selection's other pictures, for the dialog's choice of what to include. */
export interface ScreenshotOthers {
  /** The selection on its own. */
  selection: ScreenshotPicture;
  /** The page behind it without its ink, drawn when first asked for; null when it could not be. */
  page: () => Promise<ScreenshotPicture | null>;
}

/** What each choice is called, to screen readers and on hover. */
function partLabel(part: ScreenshotPart): string {
  if (part === "all") return t("view.screenshot.partAll");
  if (part === "selection") return t("view.screenshot.partSelection");
  return t("view.screenshot.partPage");
}

export class ScreenshotModal extends Modal {
  private readonly urls = new Map<ScreenshotPicture, string>();
  /** The picture shown, which Copy, Share and Save take. */
  private shown: ScreenshotPicture;
  /** Which of the choices it is. */
  private shownPart: ScreenshotPart = "all";

  constructor(
    app: App,
    /** The picture, with the page behind a selection's. */
    private readonly picture: ScreenshotPicture,
    /** The file name it is shared or saved under. */
    private readonly name: string,
    private readonly host: ScreenshotHost,
    /** The selection's other pictures, for the choice; absent, there is no choice. */
    private readonly others?: ScreenshotOthers,
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
    this.titleEl.setText(t("view.screenshot.title"));
    const body = this.contentEl;
    const preview = body.createDiv({ cls: "goodobsidian-screenshot-preview" });
    const img = preview.createEl("img", {
      attr: { src: this.urlOf(this.shown), alt: t("view.screenshot.alt") },
    });
    const status = body.createDiv({ cls: "goodobsidian-ask-status" });
    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });

    const others = this.others;
    if (others) {
      // One choice of what the picture includes: icons in a segmented well.
      const choice = actions.createDiv({
        cls: "goodobsidian-segmented is-icons goodobsidian-screenshot-parts",
        attr: { role: "radiogroup", "aria-label": t("view.screenshot.include") },
      });
      let pageOnly: Promise<ScreenshotPicture | null> | null = null;
      const pictureOf = async (part: ScreenshotPart): Promise<ScreenshotPicture | null> => {
        if (part === "all") return this.picture;
        if (part === "selection") return others.selection;
        pageOnly ??= others.page();
        return pageOnly;
      };
      const buttons = new Map<ScreenshotPart, HTMLButtonElement>();
      const sync = (): void => {
        for (const [part, button] of buttons) {
          const on = this.shownPart === part;
          button.toggleClass("is-active", on);
          button.setAttribute("aria-checked", String(on));
        }
        img.src = this.urlOf(this.shown);
      };
      for (const part of SCREENSHOT_PARTS) {
        const button = choice.createEl("button", {
          cls: "clickable-icon",
          attr: { role: "radio", "aria-label": partLabel(part), title: partLabel(part) },
        });
        setIcon(button, SCREENSHOT_PART_ICONS[part]);
        buttons.set(part, button);
        button.addEventListener("click", () => {
          if (this.shownPart === part) return;
          void pictureOf(part).then((picture) => {
            if (!picture) {
              button.disabled = true;
              status.addClass("is-error");
              status.setText(t("view.screenshot.failed"));
              return;
            }
            this.shown = picture;
            this.shownPart = part;
            sync();
          });
        });
      }
      sync();
    }

    const file = (): File => new File([this.shown.png], this.name, { type: "image/png" });
    const web = typeof navigator !== "undefined" ? navigator : undefined;
    const second = screenshotSecond(
      typeof web?.share === "function",
      typeof web?.canShare === "function" ? (data) => web.canShare(data) : undefined,
      file(),
    );
    if (second === "share") {
      const share = actions.createEl("button", { text: t("view.screenshot.share") });
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
      const save = actions.createEl("button", { text: t("view.screenshot.saveImage") });
      save.addEventListener("click", () => {
        void this.host.save(this.shown).then((path) => {
          if (!path) {
            status.addClass("is-error");
            status.setText(t("view.screenshot.saveFailed"));
            return;
          }
          this.close();
          this.host.tell(t("view.screenshot.saved", { path }));
        });
      });
    }
    const copy = actions.createEl("button", { cls: "mod-cta", text: t("common.copy") });
    copy.addEventListener("click", () => {
      void this.host.copy(this.shown.png).then((copied) => {
        if (!copied) {
          status.addClass("is-error");
          status.setText(t("view.screenshot.copyFailed"));
          return;
        }
        this.close();
        this.host.tell(t("view.screenshot.copied"));
      });
    });
  }

  override onClose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.contentEl.empty();
  }
}
