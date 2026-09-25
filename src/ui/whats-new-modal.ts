import { type App, type Component, MarkdownRenderer, Modal } from "obsidian";

/**
 * "What's new in FineNotes": release notes from the bundled changelog,
 * shown once after an update and on demand. `owner` keeps the rendered
 * markdown's children (embeds, links) alive; the plugin passes itself.
 */
export class WhatsNewModal extends Modal {
  constructor(
    app: App,
    private readonly notes: string,
    private readonly owner: Component,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText("What's new in FineNotes");
    this.modalEl.addClass("goodobsidian-whats-new", "goodobsidian-dialog");
    void MarkdownRenderer.render(this.app, this.notes, this.contentEl, "", this.owner);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
