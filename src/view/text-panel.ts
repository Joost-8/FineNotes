/**
 * The text layer panel below the pages: the note's Markdown outside the ink
 * block, as an editable field. Transcriptions land there, and the user can
 * add links, tags and notes that Obsidian's search and graph then find.
 *
 * The field shows the prose only. The frontmatter is set aside when a body
 * is loaded and put back in front of whatever the user types, so editing
 * the panel can never break the properties block.
 */

import { splitFrontmatter } from "../model/serialize";

export class TextPanel {
  readonly el: HTMLElement;
  /** The editable prose; the view listens to its `input` events. */
  readonly field: HTMLTextAreaElement;
  /** The frontmatter of the body last loaded, exactly as it was. */
  private frontmatter = "";

  constructor(parent: HTMLElement) {
    this.el = parent.createDiv({ cls: "goodobsidian-textpanel" });
    this.el.createDiv({
      cls: "goodobsidian-textpanel-label",
      text: "Text layer: the transcription, your [[links]] and #tags, all searchable",
    });
    this.field = this.el.createEl("textarea", {
      cls: "goodobsidian-textpanel-input",
      attr: { placeholder: "Type or transcribe here: key points, [[links]], #tags…" },
    });
  }

  /** Put `body`'s prose in the field, keeping its frontmatter for {@link edited}. */
  load(body: string): void {
    const { frontmatter, prose } = splitFrontmatter(body);
    this.frontmatter = frontmatter;
    this.field.value = prose;
  }

  /** The note body the field now describes: the kept frontmatter, then the prose. */
  edited(): string {
    return this.frontmatter + this.field.value;
  }

  /** Show or hide the panel. */
  setOpen(open: boolean): void {
    this.el.toggle(open);
  }
}
