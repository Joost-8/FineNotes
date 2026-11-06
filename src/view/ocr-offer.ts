/**
 * The one question about reading scanned PDF pages: which reader to
 * download, with what each costs. Asked when a PDF page with no text of its
 * own first needs it, and again from the AI menu's download mark. Fast is
 * ticked and marked as the recommendation; the other readers are listed with
 * their downsides, so nothing is hidden and nothing needs a settings row.
 */

import { type App, Modal } from "obsidian";
import { formatSize, totalBytes } from "../downloads/model-manifest";
import { t } from "../i18n/translate";
import type { OcrTier, OcrTierId } from "../recognition/ocr/ocr-model";

export interface OcrOfferActions {
  /** The reader the user picked; the download starts. */
  download(tier: OcrTierId): void;
  /** Declined. */
  notNow(): void;
}

export class OcrOfferModal extends Modal {
  private picked: OcrTierId;
  private answered = false;

  constructor(
    app: App,
    private readonly tiers: readonly OcrTier[],
    initial: OcrTierId,
    private readonly actions: OcrOfferActions,
  ) {
    super(app);
    this.picked = tiers.some((t) => t.id === initial) ? initial : (tiers[0]?.id ?? "fast");
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("goodobsidian-ocr-offer");
    this.setTitle(t("ai.ocr.offerTitle"));
    contentEl.createEl("p", { text: t("ai.ocr.offerBody") });
    const list = contentEl.createDiv({ cls: "goodobsidian-ocr-offer-list" });
    list.setAttribute("role", "radiogroup");
    for (const tier of this.tiers) {
      const row = list.createEl("label", { cls: "goodobsidian-ocr-offer-row" });
      const radio = row.createEl("input", { type: "radio" });
      radio.name = "goodobsidian-ocr-tier";
      radio.checked = tier.id === this.picked;
      radio.addEventListener("change", () => {
        this.picked = tier.id;
      });
      const text = row.createDiv({ cls: "goodobsidian-ocr-offer-text" });
      const head = text.createDiv({ cls: "goodobsidian-ocr-offer-head" });
      head.createSpan({ text: tier.label });
      head.createSpan({
        cls: "goodobsidian-ocr-offer-size",
        text: formatSize(totalBytes(tier.asset)),
      });
      if (tier.id === "fast") {
        head.createSpan({ cls: "goodobsidian-ocr-offer-pick", text: t("ai.ocr.recommended") });
      }
      text.createDiv({ cls: "goodobsidian-ocr-offer-down", text: tier.downside });
    }
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    // `clickable-icon`: Obsidian pads any other button 20 px on iPad.
    buttons
      .createEl("button", { text: t("settings.models.notNow"), cls: "clickable-icon" })
      .addEventListener("click", () => {
        this.answered = true;
        this.actions.notNow();
        this.close();
      });
    buttons
      .createEl("button", { text: t("settings.models.download"), cls: "mod-cta clickable-icon" })
      .addEventListener("click", () => {
        this.answered = true;
        this.actions.download(this.picked);
        this.close();
      });
  }

  override onClose(): void {
    this.contentEl.empty();
    // Closed with the cross or Escape counts as Not now.
    if (!this.answered) this.actions.notNow();
  }
}
