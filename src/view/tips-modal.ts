/**
 * Tips, like Apple's: collections of moving pictures, each paging through
 * tips. Also shows an update's highlights, with the same pager.
 */

import { type App, Menu, Modal, Notice, Platform, setIcon } from "obsidian";
import { t } from "../i18n/translate";
import { TIP_COLLECTIONS, TIP_SECTIONS, type Tip, type TipCollection } from "../model/tips";
import { tipScene } from "../model/tip-scenes";
import { TipPad } from "./tip-pad";
import { TipVisual } from "./tip-visual";
import { featureById, featureLink } from "../model/feature-index";
import { DialogKeyboard } from "./dialog-keyboard";
import { type FeatureHost, featureControl, featureList } from "./feature-rows";

/** Features a search inside Tips lists at most. */
const TIPS_SEARCH_HITS = 12;

export interface TipsActions {
  openTour: () => void;
  openChangelog: () => void;
  showNews: () => void;
  /** The welcome dialog: the tour, importing notebooks, Simple look. */
  showWelcome: () => void;
  /** What a tip's own button, and a found feature's row, can do. */
  features: FeatureHost;
}

/** What the pager shows: `title` over `tips`, opened at `index`. */
export interface TipsPage {
  title: string;
  tips: readonly Tip[];
  index: number;
}

const SWIPE_PX = 44;
const SLIDE_MS = 240;

export class TipsModal extends Modal {
  private visuals: TipVisual[] = [];
  private observer: IntersectionObserver | null = null;
  private pad: TipPad | null = null;
  /** Null while the collections show. */
  private page: TipsPage | null = null;
  /** The pager came from the collections, so its back arrow returns there. */
  private cameFromList = false;
  private stage: HTMLElement | null = null;
  /** Keeps the search field above the iPad keyboard. */
  private keyboard: DialogKeyboard | null = null;

  constructor(
    app: App,
    private readonly actions: TipsActions,
    private readonly opening: TipsPage | null = null,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-tips");
    this.scope.register([], "ArrowRight", () => {
      this.step(1);
      return false;
    });
    this.scope.register([], "ArrowLeft", () => {
      this.step(-1);
      return false;
    });
    if (this.opening) this.showPage(this.opening, 0);
    else this.showCollections();
  }

  override onClose(): void {
    this.keyboard?.end();
    this.keyboard = null;
    this.clearLive();
    this.contentEl.empty();
  }

  private clearLive(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.pad?.destroy();
    this.pad = null;
    for (const visual of this.visuals) visual.destroy();
    this.visuals = [];
    this.stage = null;
  }

  // --- The collections -------------------------------------------------------

  private showCollections(): void {
    this.clearLive();
    this.page = null;
    this.titleEl.setText(t("notebooks.tips.title"));
    const top = this.contentEl;
    top.empty();
    const root = this.searchField(top);
    const byCell = new Map<Element, TipVisual>();
    this.observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const entry of entries) {
              const visual = byCell.get(entry.target);
              if (entry.isIntersecting) visual?.play();
              else visual?.pause();
            }
          });
    let index = 0;
    for (const section of TIP_SECTIONS) {
      if (section.title)
        root.createEl("h4", { cls: "goodobsidian-tips-section", text: t(section.title) });
      const grid = root.createDiv({ cls: "goodobsidian-tips-grid" });
      for (const collection of section.collections) {
        const tile = grid.createEl("button", {
          cls: "goodobsidian-tips-tile clickable-icon",
          attr: { type: "button" },
        });
        tile.style.setProperty("--gob-i", String(Math.min(index, 8)));
        tile.toggleClass("is-first", index === 0);
        const visual = new TipVisual(tile, tipScene(collection.tips[0].scene));
        this.visuals.push(visual);
        byCell.set(tile, visual);
        this.observer?.observe(tile);
        const caption = tile.createDiv({ cls: "goodobsidian-tips-tile-caption" });
        caption.createSpan({ text: t(collection.title) });
        caption.createSpan({
          cls: "goodobsidian-tips-count",
          text: String(collection.tips.length),
        });
        tile.addEventListener("click", () => this.openCollection(collection));
        index += 1;
      }
    }
    const foot = root.createDiv({ cls: "goodobsidian-tips-foot" });
    this.link(foot, t("notebooks.tips.tour"), () => {
      this.close();
      this.actions.openTour();
    });
    this.link(foot, t("notebooks.tips.allChanges"), () => {
      this.close();
      this.actions.openChangelog();
    });
  }

  /** A pill beside the search field: an icon and its name; it closes Tips and runs. */
  private quick(parent: HTMLElement, icon: string, text: string, run: () => void): void {
    const button = parent.createEl("button", {
      cls: "goodobsidian-tips-quick clickable-icon",
      attr: { type: "button" },
    });
    setIcon(button.createSpan({ cls: "goodobsidian-tips-quick-icon" }), icon);
    button.createSpan({ text });
    button.addEventListener("click", () => {
      this.close();
      run();
    });
  }

  private link(parent: HTMLElement, text: string, run: () => void): void {
    parent
      .createEl("button", {
        cls: "goodobsidian-tips-link clickable-icon",
        text,
        attr: { type: "button" },
      })
      .addEventListener("click", run);
  }

  private openCollection(collection: TipCollection): void {
    this.cameFromList = true;
    this.showPage({ title: t(collection.title), tips: collection.tips, index: 0 }, 0);
  }

  // --- The pager -------------------------------------------------------------

  private showPage(page: TipsPage, direction: number): void {
    this.clearLive();
    this.page = page;
    this.titleEl.setText(page.title);
    const root = this.contentEl;
    root.empty();
    const tip = page.tips[page.index];
    const pager = root.createDiv({ cls: "goodobsidian-tips-pager" });

    const stage = pager.createDiv({ cls: "goodobsidian-tips-stage" });
    this.stage = stage;
    this.visuals.push(new TipVisual(stage, tipScene(tip.scene)));
    this.watchSwipe(stage);

    const words = pager.createDiv({ cls: "goodobsidian-tips-words" });
    words.createEl("h3", { text: t(tip.title) });
    words.createEl("p", { text: t(tip.body) });
    const acts = words.createDiv({ cls: "goodobsidian-tips-actions" });
    this.featureButtons(acts, tip);

    const nav = pager.createDiv({ cls: "goodobsidian-tips-nav" });
    const back = this.navButton(nav, "chevron-left", t("notebooks.tips.previous"), () =>
      this.step(-1),
    );
    const dots = nav.createDiv({ cls: "goodobsidian-tips-dots" });
    page.tips.forEach((item, index) => {
      const dot = dots.createEl("button", {
        cls: "goodobsidian-tips-dot clickable-icon",
        attr: { type: "button", "aria-label": t(item.title) },
      });
      dot.toggleClass("is-on", index === page.index);
      dot.addEventListener("click", () => this.go(index));
    });
    const next = this.navButton(nav, "chevron-right", t("notebooks.tips.next"), () => this.step(1));
    back.toggleClass("is-hidden", page.index === 0 && !this.nextCollection(-1));
    next.toggleClass("is-hidden", page.index === page.tips.length - 1 && !this.nextCollection(1));

    if (this.cameFromList) {
      const list = this.titleEl.createEl("button", {
        cls: "goodobsidian-tips-back clickable-icon",
        attr: { type: "button", "aria-label": t("notebooks.tips.allTips") },
      });
      setIcon(list, "layout-grid");
      this.titleEl.prepend(list);
      list.addEventListener("click", () => this.showCollections());
    }
    if (direction !== 0) this.slideIn(pager, direction);
  }

  /**
   * The field above the collections: typing lists the features the words
   * mean (tips and switches), in place of the collections. Returns where
   * the collections go.
   */
  private searchField(top: HTMLElement): HTMLElement {
    // Beside the field, where they are seen at once: what an update brought, and the welcome.
    const head = top.createDiv({ cls: "goodobsidian-tips-head" });
    const field = head.createDiv({ cls: "goodobsidian-tips-search" });
    this.quick(head, "sparkles", t("notebooks.tips.whatsNew"), () => this.actions.showNews());
    this.quick(head, "hand", t("notebooks.tips.welcome"), () => this.actions.showWelcome());
    setIcon(field.createSpan(), "search");
    const input = field.createEl("input", {
      attr: {
        type: "search",
        placeholder: t("notebooks.features.search"),
        "aria-label": t("notebooks.features.search"),
      },
    });
    const found = top.createDiv({ cls: "goodobsidian-tips-found is-hidden" });
    const browse = top.createDiv({ cls: "goodobsidian-tips-browse" });
    input.addEventListener("input", () => {
      const query = input.value.trim();
      found.empty();
      found.toggleClass("is-hidden", query === "");
      browse.toggleClass("is-hidden", query !== "");
      if (query === "") return;
      featureList(found, query, this.actions.features, {
        limit: TIPS_SEARCH_HITS,
        askFor: true,
        done: () => this.close(),
      });
    });
    this.keyboard?.end();
    this.keyboard = new DialogKeyboard(this.modalEl);
    this.keyboard.start(input);
    // Obsidian puts the cursor in a dialog's first field. With a keyboard that
    // is "type to search"; on a tablet it would raise the keyboard over the tips.
    if (Platform.isMobile) {
      window.setTimeout(() => {
        if (input.ownerDocument.activeElement === input) input.blur();
      }, 0);
    }
    return browse;
  }

  /**
   * A tip ends in one action, by what it is: a gesture is tried on a scratch
   * page (Try it), a command runs (Show me), a setting is its switch; a tip
   * with a gesture and a switch has both. The link to the tip, which is for
   * answers elsewhere, waits behind the ⋯.
   */
  private featureButtons(parent: HTMLElement, tip: Tip): void {
    const feature = featureById(tip.id);
    if (!feature) {
      if (tip.tryIt) this.tryButton(parent, tip);
      return;
    }
    const action = feature.action;
    if (feature.tryOn) {
      const go = parent.createEl("button", {
        cls: "goodobsidian-tips-try clickable-icon",
        text: t("notebooks.tips.tryIt"),
        attr: { type: "button" },
      });
      go.addEventListener("click", () => {
        this.close();
        this.actions.features.tryFeature(feature);
      });
    } else if (tip.tryIt) this.tryButton(parent, tip);
    if (action?.kind === "command") {
      const show = parent.createEl("button", {
        cls: "goodobsidian-tips-try clickable-icon",
        text: t("notebooks.features.showMe"),
        attr: { type: "button" },
      });
      show.addEventListener("click", () => {
        this.close();
        this.actions.features.runCommand(action.id);
      });
    } else if (action) {
      featureControl(parent, feature, this.actions.features, undefined, true);
    }
    const more = parent.createEl("button", {
      cls: "goodobsidian-tips-copy clickable-icon",
      attr: { type: "button", "aria-label": t("notebooks.tips.more") },
    });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(t("notebooks.features.copyLink"))
          .setIcon("link")
          .onClick(() => {
            void navigator.clipboard
              ?.writeText(featureLink(feature.id))
              .then(() => new Notice(t("notebooks.features.linkCopied")));
          }),
      );
      menu.showAtMouseEvent(event);
    });
  }

  private navButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    run: () => void,
  ): HTMLElement {
    const button = parent.createEl("button", {
      cls: "goodobsidian-tips-arrow clickable-icon",
      attr: { type: "button", "aria-label": label },
    });
    setIcon(button, icon);
    button.addEventListener("click", run);
    return button;
  }

  private tryButton(parent: HTMLElement, tip: Tip): void {
    const button = parent.createEl("button", {
      cls: "goodobsidian-tips-try clickable-icon",
      text: t("notebooks.tips.tryIt"),
      attr: { type: "button" },
    });
    button.addEventListener("click", () => {
      const stage = this.stage;
      const mode = tip.tryIt;
      if (!stage || !mode) return;
      const trying = this.pad === null;
      this.pad?.destroy();
      this.pad = null;
      stage.toggleClass("is-trying", trying);
      if (trying) this.pad = new TipPad(stage, mode);
      button.setText(t(trying ? "notebooks.tips.watch" : "notebooks.tips.tryIt"));
    });
  }

  private step(by: number): void {
    const page = this.page;
    if (!page) return;
    const target = page.index + by;
    if (target >= 0 && target < page.tips.length) {
      this.showPage({ ...page, index: target }, by);
      return;
    }
    const collection = this.nextCollection(by);
    if (!collection) return;
    this.showPage(
      {
        title: t(collection.title),
        tips: collection.tips,
        index: by > 0 ? 0 : collection.tips.length - 1,
      },
      by,
    );
  }

  private go(index: number): void {
    const page = this.page;
    if (page && index !== page.index)
      this.showPage({ ...page, index }, index > page.index ? 1 : -1);
  }

  /** The collection before or after the open one; none for an update's highlights. */
  private nextCollection(by: number): TipCollection | null {
    if (!this.cameFromList || !this.page) return null;
    const first = this.page.tips[0];
    const at = TIP_COLLECTIONS.findIndex((collection) => collection.tips[0] === first);
    return at < 0 ? null : (TIP_COLLECTIONS[at + by] ?? null);
  }

  /** A flick across the picture pages; the Try it pad keeps its strokes. */
  private watchSwipe(stage: HTMLElement): void {
    let from: number | null = null;
    stage.addEventListener("pointerdown", (event) => {
      from = this.pad ? null : event.clientX;
    });
    stage.addEventListener("pointerup", (event) => {
      if (from === null) return;
      const moved = event.clientX - from;
      from = null;
      if (Math.abs(moved) >= SWIPE_PX) this.step(moved < 0 ? 1 : -1);
    });
    stage.addEventListener("pointercancel", () => {
      from = null;
    });
  }

  private slideIn(el: HTMLElement, direction: number): void {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: `translateX(${direction * 28}px)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      { duration: SLIDE_MS, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
  }
}
