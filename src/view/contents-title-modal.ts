/**
 * Asks for a page's title in the notebook's contents: "Add to contents" for
 * a page not listed yet, "Rename in contents" for one that is.
 *
 *   Add to contents
 *   Listed in the Contents tab of the page sidebar, where it starts a section.
 *   [ Page 16                       ]
 *                              12/80
 *                    [Cancel] [Add]
 *
 * The field starts empty for a new entry, with "Page N" as its placeholder,
 * so typing starts the title at once; an empty field adds "Page N". For a
 * heading inside a page (a section), the note says where it is listed and
 * the fallback is "Section on page N". A frame to embed (discussion #167,
 * `kind` "region") is named the same way: its fallback is "Frame N", N
 * being `index` + 1, and its name loses the characters a link cannot hold.
 * It only hands back the title; the host applies it as an undoable command.
 */

import { type App, Modal } from "obsidian";
import { t } from "../i18n/translate";
import { MAX_PAGE_TITLE_LENGTH, normalizePageTitle } from "../model/contents";
import { normalizeRegionName } from "../model/regions";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { type SpellingFix, SpellingRows } from "./spelling-row";

export class ContentsTitleModal extends Modal {
  private readonly keyboard: DialogKeyboard;
  /** The title field, once open; and whether the user has typed in it. */
  private field: HTMLInputElement | null = null;
  private fieldRow: HTMLElement | null = null;
  private typed = false;

  constructor(
    app: App,
    /** Zero-based index of the page being titled; for a frame, of the frame. */
    private readonly index: number,
    /** Its title now; `undefined` when it is not in the contents yet. */
    private readonly current: string | undefined,
    private readonly submit: (title: string) => void,
    /**
     * What is being named: the page itself, a heading inside it, a chapter of
     * its own, or a frame a note can embed.
     */
    private readonly kind: "page" | "section" | "chapter" | "region" = "page",
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    const renaming = this.current !== undefined;
    const page = this.index + 1;
    const region = this.kind === "region";
    const fallback = region
      ? t("view.region.fallback", { n: page })
      : this.kind === "chapter"
        ? t("view.contentsTitle.chapterFallback")
        : this.kind === "section"
          ? t("view.contentsTitle.sectionFallback", { page })
          : t("view.contentsTitle.pageFallback", { page });
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-contents-modal");
    this.titleEl.setText(
      region
        ? renaming
          ? t("view.region.rename")
          : t("view.region.add")
        : renaming
          ? t("view.contents.rename")
          : this.kind === "chapter"
            ? t("view.contents.newChapter")
            : t("view.contents.add"),
    );
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    if (this.kind !== "chapter" && !(region && renaming)) {
      body.createDiv({
        cls: "goodobsidian-ask-note",
        text: region
          ? t("view.region.note")
          : this.kind === "section"
            ? t("view.contentsTitle.sectionNote")
            : t("view.contentsTitle.pageNote"),
      });
    }
    const row = body.createDiv({ cls: "goodobsidian-contents-field-row" });
    const field = row.createEl("input", {
      cls: "goodobsidian-contents-field",
      type: "text",
      attr: {
        placeholder: fallback,
        "aria-label": region
          ? t("view.region.label")
          : this.kind === "chapter"
            ? t("view.contentsTitle.chapterLabel")
            : this.kind === "section"
              ? t("view.contentsTitle.sectionLabel", { page })
              : t("view.contentsTitle.pageLabel", { page }),
        maxlength: String(MAX_PAGE_TITLE_LENGTH),
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    field.value = this.current ?? "";
    this.field = field;
    this.fieldRow = row;
    const count = row.createDiv({ cls: "goodobsidian-contents-count" });
    const updateCount = (): void => {
      count.setText(`${field.value.length}/${MAX_PAGE_TITLE_LENGTH}`);
    };
    this.updateCount = updateCount;
    updateCount();
    field.addEventListener("input", () => {
      this.typed = true;
      updateCount();
    });
    this.keyboard.watch(field, row);

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.close());
    const done = actions.createEl("button", {
      cls: "mod-cta",
      text: renaming ? t("common.save") : t("view.contentsTitle.add"),
    });
    const finish = (): void => {
      const title = (region ? normalizeRegionName : normalizePageTitle)(field.value) ?? fallback;
      this.close();
      if (title !== this.current) this.submit(title);
    };
    done.addEventListener("click", finish);
    onEnterKey(field, finish);

    field.focus();
    field.select();
  }

  private updateCount: () => void = () => {};

  /**
   * A title read from the heading's ink, which arrives after the dialog
   * opens: it fills the field, selected so typing replaces it, unless the
   * user has typed already or the dialog is renaming. `fixes`: words the
   * ink may say otherwise, offered under the field (spelling-row.ts).
   */
  suggest(title: string, fixes: readonly SpellingFix[] = []): void {
    const field = this.field;
    const text = (this.kind === "region" ? normalizeRegionName : normalizePageTitle)(title);
    if (!field || this.typed || this.current !== undefined || text === undefined) return;
    field.value = text.slice(0, MAX_PAGE_TITLE_LENGTH);
    this.updateCount();
    field.select();
    if (fixes.length > 0 && this.fieldRow) new SpellingRows(this.fieldRow, field, fixes);
  }

  override onClose(): void {
    this.field = null;
    this.fieldRow = null;
    this.keyboard.end();
    this.contentEl.empty();
  }
}
