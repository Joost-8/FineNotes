/**
 * Inline handwriting editor mounted directly over a single-page FineNotes
 * embed (`page-embed.ts`) inside a Markdown note in Live Preview.
 *
 * Reuses FineNotes' real `Toolbar` (preserving the user's exact saved pens,
 * colors, widths, and toolbar layout order), `InkSurface`, and
 * `TemplatePickerModal` so the UI matches normal notebooks 1-to-1.
 */

import { type App, type TFile, Notice, Scope, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { t } from "../i18n/translate";
import { attachmentDefaults, penPreferencesOf, shownPaperTheme } from "../settings-data";
import { PALETTE, SIZES, VIEW_TYPE_INK } from "../constants";
import { pushRecentColor } from "../model/colors";
import { InsertImage, SetBackdrop } from "../model/commands";
import { resolveAttachmentFolder } from "../model/attachment-folders";
import { newImageElement, placeImageBox } from "../model/images";
import { addSavedPen, isPenId, samePen, savedPensOf } from "../model/saved-pens";
import { DEFAULT_PAGE_GEOMETRY, type InkDocument, type Page } from "../model/document";
import { dotClockOf } from "../model/dot-ids";
import {
  INLINE_DEFAULT_HEIGHT,
  finishInlineSketchPage,
  initialInlineManualHeight,
  inlineClampedResizeHeight,
  inlineEditDocument,
  inlineGrowHeight,
  inlineGrowHeightForPoint,
  isInlineSketchPage,
  mergeInlinePageEdits,
} from "../model/inline-sketch";
import {
  DARK_PAPER,
  LIGHT_PAPER,
  drawSynthetic,
  pageLook,
  type PaperTheme,
} from "../canvas/backdrop";
import { paintWritingGuides } from "../canvas/writing-guides";
import type { WritingGuideStyle } from "../model/writing-guides";
import { inlineKeyVerdict } from "./inline-editor-keys";
import { WriteHold } from "./write-hold";
import { TemplatePickerModal } from "./template-picker";
import { ConfirmModal } from "../ui/confirm-modal";
import { pickImageFiles, prepareImageBytes, saveImageAttachment } from "./image-import";
import { copyPictureToSystemClipboard } from "./picture-clipboard";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import { InkSurface } from "./ink-surface";
import { toolStateFrom } from "./ink-view";
import { SavedPenModal } from "./saved-pen-modal";
import { type GuideBinding, bindWritingGuides } from "./writing-guides";
import { penOfState, Toolbar, type ToolbarState } from "./toolbar";
import { normalizeLayout, type BarItemId, type ToolbarLayout } from "./toolbar-layout";
import { editClosedNotebook, notebookIsOpen, readClosedNotebook } from "./notebook-transaction";
import { deviceIdOf } from "./device-pages-session";
import {
  type InlineEditorHandle,
  claimInlineEditor,
  makeRoomFor,
  releaseInlineEditor,
} from "./inline-editor-registry";

export interface EmbedInlineEditRequest {
  plugin: GoodObsidianPlugin;
  app: App;
  slotEl: HTMLElement;
  notebookFile: TFile;
  pageId: string;
  pageNumber: number;
  sourcePath: string;
  onClosed?: () => void;
}

const INLINE_BAR_ITEMS = new Set<BarItemId>([
  "undo",
  "redo",
  "select",
  "pen",
  "eraser",
  "shape",
  "text",
  "accessories",
  "stylus",
  "ruler",
  "fill",
  "tape",
  "image",
  "sticker",
  "sticky",
  "guides",
]);

const ISOLATED_EVENTS = [
  "mousedown",
  "pointerdown",
  "touchstart",
  "touchend",
  "click",
  "dblclick",
  "contextmenu",
] as const;

function inlineLayoutFrom(raw: unknown, savedPenIds: ReadonlySet<string>): ToolbarLayout {
  const full = normalizeLayout(raw, savedPenIds);
  const keep = (ids: BarItemId[]): BarItemId[] =>
    ids.filter((id) => isPenId(id) || INLINE_BAR_ITEMS.has(id));
  const start = keep(full.start);
  const middle = keep(full.middle);
  const end = keep(full.end);
  if (!middle.includes("pen") && !start.includes("pen") && !end.includes("pen")) {
    middle.unshift("pen");
  }
  return { start, middle, end, off: full.off };
}

/** Remembers whether the inline options pill was open when the user last closed a block. */
let lastInlineOptionsOpen = false;

export class EmbedInlineEditor implements InlineEditorHandle {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private guides: GuideBinding | null = null;
  private images: VaultImageCache | null = null;
  private toolState: ToolbarState;
  private doc: InkDocument | null = null;
  private basePage: Page | null = null;
  private stageEl: HTMLElement | null = null;
  private toolbarHostEl: HTMLElement | null = null;
  private fauxBgEl: HTMLElement | null = null;
  private fauxHeaderEl: HTMLElement | null = null;
  private fauxCanvasEl: HTMLCanvasElement | null = null;
  private fauxHeaderPx = 0;
  private mountedPillRow = false;
  private guidesStyle: WritingGuideStyle | null = null;
  private manualHeight: number | null = null;
  private closed = false;
  private revision = 0;
  private savedRevision = 0;
  private saves: Promise<boolean> = Promise.resolve(true);
  private closing: Promise<boolean> | null = null;
  private saveTimer: number | null = null;
  private onlyStylus = false;
  private paperIsDark = false;
  private imageFolder: string | undefined;
  private cleanups: Array<() => void> = [];
  private disposed = false;
  /** Saves wait for a pause in the writing, never mid-stroke (write-hold.ts). */
  private readonly hold = new WriteHold();
  /** The paper the surface and the block show now; another (an undo) re-themes them. */
  private shownBackdrop: unknown = null;

  constructor(private readonly req: EmbedInlineEditRequest) {
    this.onlyStylus = req.plugin.stylusOnly;
    this.paperIsDark = req.slotEl.ownerDocument?.body?.classList.contains("theme-dark") ?? false;
    this.toolState = toolStateFrom(req.plugin.settings);
    if (
      this.toolState.tool !== "pen" &&
      this.toolState.tool !== "highlighter" &&
      this.toolState.tool !== "eraser" &&
      this.toolState.tool !== "select" &&
      this.toolState.tool !== "shape" &&
      this.toolState.tool !== "text"
    ) {
      this.toolState.tool = "pen";
    }
  }

  get hostSlot(): HTMLElement {
    return this.req.slotEl;
  }

  /** The notebook this block is a page of. */
  get filePath(): string {
    return this.req.notebookFile.path;
  }

  async start(): Promise<void> {
    const { app, slotEl, notebookFile, pageId, plugin } = this.req;
    // Another block open: it saves and closes first; one that cannot save stays open.
    if (!(await makeRoomFor(slotEl)) || this.closed || !slotEl.isConnected) {
      this.req.onClosed?.();
      return;
    }
    claimInlineEditor(this);

    const contentEditable = slotEl.getAttribute("contenteditable");
    slotEl.setAttribute("contenteditable", "false");
    this.cleanups.push(() => {
      if (contentEditable === null) slotEl.removeAttribute("contenteditable");
      else slotEl.setAttribute("contenteditable", contentEditable);
    });

    // Isolate pointer/mouse/touch/click events so Live Preview (CodeMirror 6)
    // never flips the active embed back into raw `![[...]]` Markdown text.
    const stopBubble = (e: Event): void => e.stopPropagation();
    for (const evt of ISOLATED_EVENTS) {
      slotEl.addEventListener(evt, stopBubble);
      this.cleanups.push(() => slotEl.removeEventListener(evt, stopBubble));
    }

    try {
      if (notebookIsOpen(app, notebookFile)) {
        throw new Error(t("notebooks.handwrite.errCloseBeforeEdit"));
      }
      const fullDoc = await readClosedNotebook(app, notebookFile, plugin.settings.paperWidth);
      if (this.closed || this.closing || !slotEl.isConnected) {
        this.dispose();
        return;
      }
      // Ids for new ink count on from every page of the notebook, not this one alone.
      const editing = inlineEditDocument(fullDoc, pageId, deviceIdOf(app));
      if (!editing) throw new Error(t("notebooks.handwrite.errPageNotFound"));
      const target = editing.page;

      this.imageFolder = resolveAttachmentFolder(
        fullDoc,
        "images",
        attachmentDefaults(plugin.settings),
      );
      const clone: Page = target;
      this.basePage = structuredClone(target);
      if (isInlineSketchPage(clone)) {
        this.manualHeight = initialInlineManualHeight(clone);
        if (clone.geometry.height < INLINE_DEFAULT_HEIGHT) {
          clone.geometry = { ...clone.geometry, height: INLINE_DEFAULT_HEIGHT };
        }
      }
      this.doc = editing.doc;

      this.mount();
    } catch (error) {
      new Notice(
        t("notebooks.handwrite.errOpenFailed", {
          error: error instanceof Error ? error.message : t("notebooks.handwrite.errOpenFallback"),
        }),
      );
      await this.close();
    }
  }

  private rememberPen(): void {
    if (this.toolState.tool === "pen" || this.toolState.tool === "highlighter") {
      this.req.plugin.saveLastPen(penOfState(this.toolState));
    }
  }

  private syncUndoRedo(): void {
    if (!this.surface || !this.toolbar) return;
    this.toolbar.setHistoryState(this.surface.canUndo, this.surface.canRedo);
  }

  private effectivePaperTheme(): PaperTheme {
    if (this.isTransparent()) {
      const base = this.paperIsDark ? DARK_PAPER : LIGHT_PAPER;
      return { ...base, desk: "transparent", edge: "transparent", seeThrough: true };
    }
    // Paper follows the dark-pages setting, as in the notebook view.
    const shown = shownPaperTheme(this.req.plugin.settings, this.paperIsDark);
    return { ...shown, desk: "transparent", edge: "transparent" };
  }

  /** The page's paper changed (picked, or undone): the surface, the bar and the block follow. */
  private syncPaper(): void {
    const page = this.doc?.pages[0];
    if (!page || page.backdrop === this.shownBackdrop) return;
    this.shownBackdrop = page.backdrop;
    const theme = this.effectivePaperTheme();
    this.surface?.setPaperTheme(theme);
    this.toolbar?.setNight(theme.night === true);
    this.syncStageAspect();
    this.paintFauxHeader();
    this.surface?.refreshInlinePage(page.id);
  }

  private mount(): void {
    const { app, slotEl, plugin, notebookFile } = this.req;
    const doc = this.doc;
    if (!doc) return;
    const page = doc.pages[0];
    const expandable = isInlineSketchPage(page);

    slotEl.addClass("is-inline-editing");
    const scroller = slotEl.closest<HTMLElement>(".cm-scroller, .markdown-preview-view");
    const activeHosts: HTMLElement[] = [];
    const viewWin = slotEl.ownerDocument.defaultView ?? window;
    for (let el = slotEl.parentElement; el && el !== scroller; el = el.parentElement) {
      if (
        el.matches(".internal-embed, .cm-embed-block, .callout, .callout-content, .cm-callout") ||
        viewWin.getComputedStyle(el).overflowY === "hidden"
      ) {
        el.addClass("finenotes-inline-active-embed");
        activeHosts.push(el);
      }
    }
    scroller?.addClass("finenotes-inline-active-scroller");
    this.cleanups.push(() => {
      slotEl.removeClass("is-inline-editing");
      for (const host of activeHosts) host.removeClass("finenotes-inline-active-embed");
      scroller?.removeClass("finenotes-inline-active-scroller");
      const p = this.doc?.pages[0];
      if (p) slotEl.setCssStyles({ aspectRatio: `${p.geometry.width} / ${p.geometry.height}` });
    });

    const overlay = slotEl.createDiv({ cls: "goodobsidian-inline-overlay is-mounting" });
    this.cleanups.push(() => overlay.remove());
    const mountWin = slotEl.ownerDocument.defaultView ?? window;
    const mountRaf = mountWin.requestAnimationFrame(() => overlay.removeClass("is-mounting"));
    this.cleanups.push(() => mountWin.cancelAnimationFrame(mountRaf));

    // Non-writable faux paper backdrop extending behind both the primary bar and open floating pill.
    const fauxBg = overlay.createDiv({ cls: "goodobsidian-inline-faux-bg" });
    const fauxCanvas = fauxBg.createEl("canvas", { cls: "goodobsidian-inline-faux-canvas" });
    this.fauxBgEl = fauxBg;
    this.fauxCanvasEl = fauxCanvas;

    // Native FineNotes Toolbar directly at the top of the active block (same style as normal notebooks)
    const toolbarHost = overlay.createDiv({ cls: "goodobsidian-inline-toolbar-host" });
    this.toolbarHostEl = toolbarHost;

    // Spacer that expands smoothly beneath the primary bar when a floating tool pill opens.
    const fauxHeader = overlay.createDiv({ cls: "goodobsidian-inline-faux-header" });
    this.fauxHeaderEl = fauxHeader;

    // Let the scroller position the bar during fast scrolling. A theme can
    // still introduce a scroll container between the block and that scroller.
    let needsTransform = false;
    for (let el: HTMLElement | null = slotEl; el && el !== scroller; el = el.parentElement) {
      const overflow = viewWin.getComputedStyle(el).overflowY;
      if (overflow !== "visible" && overflow !== "clip") {
        needsTransform = true;
        break;
      }
    }
    const followInset = 2;
    toolbarHost.setCssProps({ "--gob-inline-follow-inset": `${followInset}px` });
    let scheduleFollow: (() => void) | undefined;
    if (needsTransform) {
      toolbarHost.addClass("is-floating-follow");
      let followFrame = 0;
      let lastShift = 0;
      const updateFollow = (): void => {
        followFrame = 0;
        const rootTop = scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0;
        const rect = overlay.getBoundingClientRect();
        const distance = rootTop + followInset - rect.top;
        const shift = Math.max(0, Math.min(rect.height - toolbarHost.offsetHeight, distance));
        if (shift !== lastShift) {
          toolbarHost.setCssProps({ "--gob-pill-y": `${shift}px` });
          if (shift > 0 !== lastShift > 0) toolbarHost.toggleClass("is-detached", shift > 0);
          lastShift = shift;
        }
      };
      const onScroll = (): void => {
        if (!followFrame) followFrame = viewWin.requestAnimationFrame(updateFollow);
      };
      scheduleFollow = onScroll;
      const scrollTarget: EventTarget = scroller ?? viewWin;
      scrollTarget.addEventListener("scroll", onScroll, { passive: true });
      this.cleanups.push(() => {
        scrollTarget.removeEventListener("scroll", onScroll);
        if (followFrame) viewWin.cancelAnimationFrame(followFrame);
      });
      onScroll();
    } else {
      // Sticky positions the bar without a scroll listener. The observer
      // only switches its appearance when the block passes the sticky inset.
      const anchor = overlay.createDiv({ cls: "goodobsidian-sr-only" });
      anchor.setCssStyles({ top: "0", left: "0" });
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry?.rootBounds) return;
          const detached =
            entry.target === anchor
              ? entry.intersectionRatio < 1 && entry.boundingClientRect.top < entry.rootBounds.top
              : entry.boundingClientRect.top < entry.rootBounds.top;
          toolbarHost.toggleClass("is-detached", detached);
        },
        { root: scroller, rootMargin: `-${followInset}px 0px 0px`, threshold: [0, 1] },
      );
      observer.observe(anchor);
      observer.observe(overlay); // Also handle a jump past the anchor into a visible block.
      this.cleanups.push(() => observer.disconnect());
    }

    // Stage hosting FineNotes' real InkSurface
    const stage = overlay.createDiv({ cls: "goodobsidian-inline-stage" });
    this.stageEl = stage;
    this.syncStageAspect();
    let lastOverlayW = overlay.clientWidth;
    const ro = new ResizeObserver(() => {
      scheduleFollow?.();
      const w = overlay.clientWidth;
      if (w === lastOverlayW || w <= 0) return;
      lastOverlayW = w;
      overlay.addClass("is-mounting");
      this.syncStageAspect();
      this.paintFauxHeader();
      mountWin.requestAnimationFrame(() => overlay.removeClass("is-mounting"));
    });
    ro.observe(overlay);
    if (needsTransform) {
      ro.observe(toolbarHost);
      if (scroller) ro.observe(scroller);
    }
    this.cleanups.push(() => ro.disconnect());

    // Bottom drag handle for expandable inline sketches
    if (expandable) {
      const handle = overlay.createDiv({
        cls: "goodobsidian-inline-resize-handle",
        attr: { role: "separator", "aria-label": t("notebooks.handwrite.resizeArea") },
      });
      handle.createDiv({ cls: "goodobsidian-inline-resize-pill" });
      this.wireResizeHandle(handle);
    }

    const palette = [...PALETTE, ...(plugin.settings.customColors ?? [])];
    const savedPenIds = new Set(
      savedPensOf(plugin.settings.savedPens)
        .map((p) => p.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const allowedItems = new Set<BarItemId>([
      ...INLINE_BAR_ITEMS,
      ...(savedPenIds as Set<BarItemId>),
    ]);

    this.mountedPillRow = plugin.pillRow === true;

    this.toolbar = new Toolbar(
      toolbarHost,
      palette,
      SIZES,
      this.toolState,
      {
        returnToPenOnReselect: () => plugin.settings.returnToPenOnReselect === true,
        keepOptionsAcrossTools: () => plugin.settings.keepOptionsAcrossTools === true,
        onToolChange: (tool) => this.surface?.setTool(tool),
        onColorChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onSizeChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onPressureToggle: () => this.surface?.refreshPenCursor(),
        onPenTypeChange: () => {
          this.toolbar?.syncActive();
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        savedPens: () => savedPensOf(plugin.settings.savedPens),
        onReorderPens: (pens) => plugin.saveSavedPens(pens),
        onDeletePen: (id) =>
          plugin.saveSavedPens(
            savedPensOf(plugin.settings.savedPens).filter((pen) => pen.id !== id),
          ),
        onSavePen: (pen) =>
          plugin.saveSavedPens(addSavedPen(savedPensOf(plugin.settings.savedPens), pen)),
        onNewPen: (start, onMade) => {
          new SavedPenModal(app, {
            pen: start,
            index: null,
            pens: savedPensOf(plugin.settings.savedPens),
            highlighterAlpha: plugin.settings.highlighterAlpha,
            recent: plugin.settings.recentColors,
            palette: plugin.settings.customColors,
            onCustomColor: (color) => {
              plugin.settings.recentColors = pushRecentColor(plugin.settings.recentColors, color);
              void plugin.saveSettings();
            },
            onSave: (pen) => {
              plugin.saveSavedPens(addSavedPen(savedPensOf(plugin.settings.savedPens), pen));
              const made = savedPensOf(plugin.settings.savedPens).find((saved) =>
                samePen(saved, pen),
              );
              if (made) onMade(made);
            },
          }).open();
        },
        onEditPens: () => plugin.openSettingsTab(),
        onPenColors: (colors) => plugin.savePenColors(colors),
        onPenTypeOrder: (order) => plugin.savePenTypeOrder(order),
        onPenInks: (inks) => plugin.savePenInks(inks),
        onPenStabilization: (all) => plugin.savePenStabilization(all),
        penPreferences: () => penPreferencesOf(plugin.settings),
        onPenPreferences: (patch) => plugin.savePenPreferences(patch),
        onWidthPresets: (presets) => plugin.saveWidthPresets(presets),
        onEraserPresets: (presets) => plugin.saveEraserPresets(presets),
        onEraserChange: (mode, size) => plugin.saveEraser(mode, size),
        sizePreviewScales: () => this.surface?.sizePreviewScales() ?? { pen: 1, eraser: 1 },
        paintSizePaper: (canvas, width, height) =>
          this.surface?.paintPaperSample(canvas, width, height) ?? false,
        onEraserFilterChange: (filter) => plugin.saveEraserFilter(filter),
        onEraserGreyChange: (on) => plugin.saveEraserGrey(on),
        onLassoChange: (mode, filter) => {
          this.surface?.refreshLassoChrome();
          plugin.saveLasso(mode, filter);
        },
        onPenGesturesChange: (gestures) => plugin.savePenGestures(gestures),
        onShapeColorChange: (color) => {
          this.surface?.refreshPenCursor();
          plugin.saveShapeColor(color);
        },
        onShapeStyleChange: (style) => plugin.saveShapeStyle(style),
        onFillGapChange: (gap) => plugin.saveFillGap(gap),
        onFillColorChange: (color) => plugin.saveFillColor(color),
        onTapeChange: (color, height, mode, heights) =>
          plugin.saveTape(color, height, mode, heights),
        onTapeSnapTextChange: (on) => plugin.saveTapeSnapText(on),
        tapesShown: () => this.surface?.tapesShown() ?? null,
        onShowTapes: (shown) => this.surface?.showTapes(shown),
        onTableHeaderChange: (on) => plugin.saveTableHeader(on),
        onRecentColors: (colors) => plugin.saveRecentColors(colors),
        onPickFromPage: (done) => {
          if (this.surface) this.surface.pickColorFromPage(done);
          else done(null);
        },
        onTextToolChange: (style, pinned, dragSize) => plugin.saveTextTool(style, pinned, dragSize),
        onTextStyle: (patch) => this.surface?.applyTextStyle(patch),
        onTextSizePreview: (size) => this.surface?.previewTextSize(size),
        onTextFieldDone: (to) => this.surface?.textFieldDone(to),
        onTextList: (kind) => void this.surface?.applyTextList(kind),
        onTextDelete: () => void this.surface?.deleteEditingTextBox(),
        onInsertImage: () => {
          void pickImageFiles(slotEl, false, "image/*", false).then(([file]) => {
            if (file) void this.pastePicture(file);
          });
        },
        onPillPlaced: () => this.syncFauxHeader(),
        onWritingGuides: () => this.guides?.toggle(),
        writingGuidesEnabled: () => this.guides?.on() === true,
        renderWritingGuides: (body, resize) => this.guides?.render(body, resize) ?? (() => {}),
        onRuler: () => {
          const surface = this.surface;
          if (!surface) return;
          surface.setRulerOut(!surface.rulerOut);
          this.toolbar?.setRulerOut(surface.rulerOut);
        },
        onRulerChange: (kind, snap) => {
          this.surface?.setRulerOut(true);
          this.toolbar?.setRulerOut(true);
          plugin.saveRuler(kind, snap);
        },
        pressureAllowed: () => plugin.settings.pressureWidth === true,
        onUndo: () => {
          this.surface?.undo();
          this.syncUndoRedo();
        },
        onRedo: () => {
          this.surface?.redo();
          this.syncUndoRedo();
        },
        onClear: () => {
          void ConfirmModal.confirm(app, {
            title: t("notebooks.handwrite.clearTitle"),
            message: t("notebooks.handwrite.clearMessage"),
            cta: t("notebooks.handwrite.clearCta"),
          }).then((confirmed) => {
            if (confirmed) {
              this.surface?.clearStrokes();
              this.syncUndoRedo();
            }
          });
        },
        onOnlyStylusMode: (on) => {
          this.onlyStylus = on;
          this.toolbar?.setOnlyStylusMode(on);
          this.surface?.onlyStylusChanged();
          this.syncFingerScroll();
          void plugin.setOnlyStylusMode(on);
        },
      },
      {
        defaultSize: plugin.settings.defaultSize,
        reservedColors: [plugin.settings.defaultColor, ...(plugin.settings.customColors ?? [])],
        // The notebook's own layout, less what a block has no use for.
        layout: inlineLayoutFrom(plugin.settings.toolbarLayout, savedPenIds),
        allowedItems,
        popoverBounds: slotEl,
        // A press anywhere in the block, the page included, closes a popover.
        dismissRoot: slotEl,
        pillRow: plugin.pillRow === true,
        startOptionsTucked: !lastInlineOptionsOpen,
        onlyStylusMode: plugin.stylusOnly,
        fingerDrawing: plugin.fingerDrawing,
      },
    );

    // Mount native inline actions directly inside the Toolbar's own `.goodobsidian-bar-doc` group
    const barEl = toolbarHost.querySelector<HTMLElement>(".goodobsidian-toolbar");
    const endGroup = barEl?.querySelector<HTMLElement>(".goodobsidian-bar-doc") ?? barEl;
    // A page on a PDF slide keeps its slide: no paper to choose.
    if (endGroup && page.backdrop.kind !== "pdf") {
      const paperBtn = endGroup.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": t("notebooks.handwrite.paperTemplate") },
      });
      setIcon(paperBtn, "notepad-text");
      paperBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const p = this.doc?.pages[0];
        if (!p) return;
        const initial = p.backdrop.kind === "pdf" ? { kind: "blank" as const } : p.backdrop;
        new TemplatePickerModal(app, {
          mode: "change",
          initial,
          geometry: expandable ? DEFAULT_PAGE_GEOMETRY : p.geometry,
          allowTransparent: expandable,
          hideSizeControls: expandable,
          onApply: ({ backdrop }) => {
            // A command, so Undo takes the paper back too.
            this.surface?.applyCommand(new SetBackdrop(p.id, backdrop));
            plugin.settings.inlineLastBackdrop = structuredClone(backdrop);
            void plugin.saveSettings();
            this.revision++;
            this.syncPaper();
            this.scheduleSave();
          },
        }).open();
      });
    }
    if (endGroup) {
      const openBtn = endGroup.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": t("notebooks.handwrite.openInNotebook") },
      });
      setIcon(openBtn, "external-link");
      openBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.close().then(async (ok) => {
          if (!ok) return;
          const leaf = app.workspace.getLeaf(true);
          await leaf.setViewState(
            { type: VIEW_TYPE_INK, state: { file: notebookFile.path }, active: true },
            {
              pageIndex: Math.max(0, this.req.pageNumber - 1),
              pageId: this.req.pageId,
              highlightPage: true,
            },
          );
        });
      });

      const doneBtn = endGroup.createEl("button", {
        cls: "clickable-icon goodobsidian-inline-done-icon",
        attr: { type: "button", "aria-label": t("notebooks.handwrite.done") },
      });
      setIcon(doneBtn, "check");
      doneBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.close();
      });
    }

    this.images = new VaultImageCache(app);
    this.surface = new InkSurface(
      stage,
      doc,
      this.toolState,
      {
        desynchronizedCanvas: false,
        highlighterAlpha: plugin.settings.highlighterAlpha,
        paper: this.effectivePaperTheme(),
        debug: false,
        palette,
      },
      {
        onlyStylusMode: () => this.onlyStylus,
        fingerDrawing: () => !this.onlyStylus,
        fingerTapUndo: () => plugin.settings.fingerTapUndo !== false,
        lassoAnyPart: () => plugin.settings.lassoTouches !== false,
        textDragSize: () => plugin.settings.textDragSize === true,
        pencilTilt: () => plugin.settings.pencilTilt === true,
        straightenHighlighter: () => plugin.settings.straightHighlighter !== false,
        highlighterSnapsToText: () => plugin.settings.highlighterSnapText !== false,
        onCopyImage: (image) => copyPictureToSystemClipboard(app, image),
        onPasteImage: (file, at) => void this.pastePicture(file, at),
        onHistoryChange: (undo, redo) => this.toolbar?.setHistoryState(undo, redo),
        onTextEditing: (style) => this.toolbar?.setTextTarget(style),
        onTextAnchor: (rect) => this.toolbar?.setTextAnchor(rect),
        textPillState: () => this.toolbar?.textPillState ?? "-",
        growInlinePage: (y, buffer) => {
          if (!expandable) return false;
          return this.maybeGrowHeight(y, buffer);
        },
        // With the pen only, a finger scrolls the note: the surface leaves its touches alone.
        fingerScrollsHost: () => this.onlyStylus,
        onPen: (down) => {
          const now = performance.now();
          if (down) this.hold.penDown(now);
          else {
            this.hold.penUp(now);
            if (this.revision !== this.savedRevision) this.scheduleSave();
          }
        },
        onChange: () => {
          this.revision++;
          this.syncPaper();
          if (expandable) this.maybeGrowHeight();
          this.syncUndoRedo();
          this.scheduleSave();
        },
      },
    );
    this.surface.setInlineWidthLocked(true);
    this.syncStageAspect();
    this.syncFingerScroll();
    this.surface.setBackdropPainter(new VaultBackdropRenderer(null));
    this.images.onReady = (path) => this.surface?.imageReady(path);
    this.surface.setImagePainter(this.images);
    this.surface.setTool(this.toolState.tool);
    this.toolbar.setNight(this.effectivePaperTheme().night === true);
    this.syncUndoRedo();
    this.shownBackdrop = page.backdrop;
    const tabIndex = slotEl.tabIndex;
    slotEl.tabIndex = -1;
    this.cleanups.push(() => {
      slotEl.tabIndex = tabIndex;
    });
    slotEl.focus({ preventScroll: true });

    this.bindFinishKeys();
    // The notebook's own writing guides, as its notebook view shows them.
    this.guides = bindWritingGuides({
      settings: plugin.settings,
      save: () => void plugin.saveSettings(),
      path: () => this.req.notebookFile.path,
      apply: (style) => {
        this.guidesStyle = style;
        this.surface?.setWritingGuides(style);
        this.paintFauxHeader();
      },
      changed: () => this.toolbar?.syncWritingGuides(),
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      // Esc and Mod+Enter are the scope's (bindFinishKeys): a popover's Esc must reach it.
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
      if (this.surface?.handleKeyDown(e)) {
        e.stopPropagation();
      }
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (this.surface?.handlePaste(e)) {
        e.stopPropagation();
      }
    };
    slotEl.addEventListener("keydown", onKey, true);
    slotEl.addEventListener("paste", onPaste, true);
    this.cleanups.push(() => slotEl.removeEventListener("keydown", onKey, true));
    this.cleanups.push(() => slotEl.removeEventListener("paste", onPaste, true));
  }

  /**
   * Esc and Mod+Enter finish the block. Obsidian's hotkeys take Mod+Enter at
   * the window before a keydown here would hear it, so they go through a
   * scope (obsidian-host.md), built as the notebook view's is
   * (`notebookKeyScope`): one handler for every key, which acts only on a key
   * pressed in the block that nothing in it wants (inline-editor-keys.ts),
   * and otherwise leaves it to the note's own scope, its parent. The scope
   * goes back on top whenever the note's tab becomes active again.
   */
  private bindFinishKeys(): void {
    const { app, slotEl } = this.req;
    const keymap = (app as { keymap?: { pushScope(s: Scope): void; popScope(s: Scope): void } })
      .keymap;
    if (!keymap) return;
    const doc = slotEl.ownerDocument;
    const noteView = app.workspace
      .getLeavesOfType("markdown")
      .map((leaf) => leaf.view)
      .find((view) => view.containerEl.contains(slotEl));
    const scope = new Scope(noteView?.scope ?? app.scope);
    scope.register(null, null, (event) => {
      const target = event.target instanceof Node ? event.target : null;
      const verdict = inlineKeyVerdict({
        key: event.key,
        mod: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        prevented: event.defaultPrevented,
        composing: event.isComposing,
        modalOpen: doc.querySelector(".modal-container, .menu") !== null,
        inside: target !== null && slotEl.contains(target),
        editable:
          target instanceof HTMLElement &&
          (target.isContentEditable || target.closest("input, textarea, select") !== null),
        popoverOpen: slotEl.querySelector(".goodobsidian-popover") !== null,
      });
      if (verdict === "pass") return undefined;
      if (verdict === "surface" && this.surface?.handleKeyDown(event)) return false;
      void this.close();
      return false;
    });
    keymap.pushScope(scope);
    const ref = app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view.containerEl.contains(slotEl)) {
        keymap.popScope(scope);
        keymap.pushScope(scope);
      }
    });
    this.cleanups.push(() => {
      app.workspace.offref(ref);
      keymap.popScope(scope);
    });
  }

  /** With the pen only, a finger scrolls the note across the block; else it draws. */
  private syncFingerScroll(): void {
    this.stageEl?.toggleClass("is-finger-scroll", this.onlyStylus);
  }

  private isTransparent(): boolean {
    const page = this.doc?.pages[0];
    return Boolean(
      page && page.backdrop.kind !== "pdf" && page.backdrop.paperColor === "transparent",
    );
  }

  private syncFauxHeader(): void {
    const header = this.fauxHeaderEl;
    const host = this.toolbarHostEl;
    if (!header || !host) return;
    if (this.mountedPillRow) {
      this.fauxHeaderPx = 0;
      header.setCssStyles({ height: "0px" });
      this.fauxBgEl?.setCssStyles({ height: "0px" });
      return;
    }
    const pill = host.querySelector<HTMLElement>(".goodobsidian-options");
    // Keep the original paper position as the bar floats over the block.
    const open = pill !== null && !pill.hasClass("is-collapsed") && pill.childElementCount > 0;
    const nextPx = open ? Math.max(48, Math.ceil(pill.offsetHeight || 44) + 14) : 0;
    if (nextPx !== this.fauxHeaderPx) {
      this.fauxHeaderPx = nextPx;
      header.setCssStyles({ height: `${nextPx}px` });
    }
    this.paintFauxHeader();
  }

  private paintFauxHeader(): void {
    const bg = this.fauxBgEl;
    const canvas = this.fauxCanvasEl;
    const host = this.toolbarHostEl;
    const stage = this.stageEl;
    const page = this.doc?.pages[0];
    if (!bg || !canvas || !host || !stage || !page) return;
    if (this.mountedPillRow) {
      bg.setCssStyles({ height: "0px" });
      return;
    }
    const barH = Math.ceil(host.getBoundingClientRect().height || host.offsetHeight || 52);
    const totalH = barH + this.fauxHeaderPx + (this.fauxHeaderPx > 0 ? 1 : 0);
    bg.setCssStyles({ height: `${totalH}px` });
    if (totalH <= 0) return;
    // Paint at least barH + max pill height once, pinned to the bottom edge of `bg`,
    // so opening/closing the pill never stretches the canvas bitmap or repaints per frame.
    const paintH = Math.max(totalH, barH + 64);
    const cssW = stage.clientWidth || this.req.slotEl.clientWidth || page.geometry.width;
    if (!(cssW > 0)) return;
    const dpr = Math.min(
      3,
      (this.req.slotEl.ownerDocument.defaultView ?? window).devicePixelRatio || 1,
    );
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(paintH * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    canvas.setCssStyles({ height: `${paintH}px` });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    const scale = cssW / page.geometry.width;
    const headerPageH = paintH / scale;
    const theme = this.effectivePaperTheme();
    const geom = { width: page.geometry.width, height: headerPageH };
    ctx.save();
    ctx.scale(scale * dpr, scale * dpr);
    const phase = { x: 0, y: -headerPageH };
    if (page.backdrop.kind !== "pdf") {
      drawSynthetic(ctx, page.backdrop, geom, theme, 1, undefined, phase);
    }
    if (this.guidesStyle) {
      const look = pageLook(page.backdrop, theme);
      const fauxPage: Page = { ...page, geometry: geom };
      paintWritingGuides(
        ctx,
        fauxPage,
        { minX: 0, minY: 0, maxX: geom.width, maxY: geom.height },
        this.guidesStyle,
        look.paper,
        scale,
        scale * dpr,
        phase,
      );
    }
    ctx.restore();
  }

  private syncStageAspect(): void {
    const page = this.doc?.pages[0];
    if (!page || !this.stageEl) return;
    const availW = this.stageEl.clientWidth || this.req.slotEl.clientWidth || page.geometry.width;
    const scale = availW / page.geometry.width;
    const scaledH = Math.max(40, Math.ceil(page.geometry.height * scale));
    this.stageEl.setCssStyles({ height: `${scaledH}px` });
    this.req.slotEl.setCssStyles({ aspectRatio: "" });
    this.req.slotEl.toggleClass("is-transparent", this.isTransparent());
  }

  private maybeGrowHeight(liveY?: number, buffer?: number): boolean {
    const page = this.doc?.pages[0];
    if (!page) return false;
    const nextH =
      liveY !== undefined ? inlineGrowHeightForPoint(page, liveY, buffer) : inlineGrowHeight(page);
    if (nextH > page.geometry.height) {
      page.geometry = { ...page.geometry, height: nextH };
      this.syncStageAspect();
      this.surface?.refreshInlinePage(page.id);
      const win = this.req.slotEl.ownerDocument.defaultView ?? window;
      win.requestAnimationFrame(() => this.surface?.refreshInlinePage(page.id));
      return true;
    }
    return false;
  }

  private wireResizeHandle(handle: HTMLElement): void {
    let startY = 0;
    let startH = 0;
    let scale = 1;
    let pointerId: number | null = null;

    const onDown = (e: PointerEvent): void => {
      const page = this.doc?.pages[0];
      if (!page || !this.stageEl) return;
      e.preventDefault();
      e.stopPropagation();
      pointerId = e.pointerId;
      startY = e.clientY;
      startH = page.geometry.height;
      const cssW = this.stageEl.clientWidth || 600;
      scale = page.geometry.width / cssW;
      this.stageEl.addClass("is-resizing");
      handle.setPointerCapture(pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      const page = this.doc?.pages[0];
      if (pointerId === null || e.pointerId !== pointerId || !page) return;
      e.preventDefault();
      const desired = startH + (e.clientY - startY) * scale;
      const clamped = inlineClampedResizeHeight(page, desired);
      if (clamped !== page.geometry.height) {
        page.geometry = { ...page.geometry, height: clamped };
        this.manualHeight = clamped;
        this.revision++;
        this.syncStageAspect();
        this.surface?.refreshInlinePage(page.id);
      }
    };
    const onUp = (e: PointerEvent): void => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      pointerId = null;
      this.stageEl?.removeClass("is-resizing");
      const page = this.doc?.pages[0];
      if (page) this.surface?.refreshInlinePage(page.id);
      this.scheduleSave();
    };
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  private async pastePicture(file: File, at?: { x: number; y: number }): Promise<void> {
    const surface = this.surface;
    const doc = this.doc;
    const page = doc?.pages[0];
    if (!surface || !doc || !page || this.closing || this.closed) return;
    try {
      const prepared = await prepareImageBytes(await file.arrayBuffer(), file.type);
      if (this.surface !== surface || this.closing) return;
      const attachment = await saveImageAttachment(
        this.req.app,
        prepared,
        file.name || "Pasted image",
        this.req.notebookFile.path,
        this.imageFolder,
      );
      if (this.surface !== surface || this.closing) return;
      const region = at
        ? { minX: at.x - 1, minY: at.y - 1, maxX: at.x + 1, maxY: at.y + 1 }
        : surface.visibleRegion(0);
      const image = newImageElement(
        doc,
        attachment.path,
        placeImageBox(prepared, page.geometry, region),
      );
      surface.applyCommand(new InsertImage(page.id, image));
      surface.selectImage(page.id, image.id);
      this.revision++;
      this.scheduleSave();
    } catch (err) {
      new Notice(
        t("notebooks.handwrite.errAddImage", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  /**
   * A save rewrites the notebook on the main thread: it waits until the pen
   * has been up a moment, and is never made mid-stroke (write-hold.ts, and
   * ipad-input.md "Obsidian saved mid-stroke"). Done saves at once.
   */
  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    const wait = Math.max(500, this.hold.quietIn(performance.now()));
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      if (this.hold.writing(performance.now())) this.scheduleSave();
      else void this.flushSave();
    }, wait);
  }

  private flushSave(finishing = false): Promise<boolean> {
    if (!this.doc) return this.saves;
    const page = this.doc.pages[0];
    const trim = finishing && isInlineSketchPage(page);
    if (!trim && this.revision === this.savedRevision) return this.saves;
    const manualHeight = this.manualHeight;
    const clock = dotClockOf(this.doc) ?? null;
    const targetRev = this.revision;
    const updatedPage: Page = structuredClone(page);
    const { app, notebookFile, plugin } = this.req;
    this.saves = this.saves
      .catch(() => true)
      .then(async () => {
        try {
          const base = this.basePage;
          await editClosedNotebook(
            app,
            notebookFile,
            plugin.settings.paperWidth,
            (doc) => {
              const idx = doc.pages.findIndex((p) => p.id === updatedPage.id);
              const merged =
                idx >= 0 && base
                  ? mergeInlinePageEdits(base, doc.pages[idx], updatedPage)
                  : structuredClone(updatedPage);
              if (trim) finishInlineSketchPage(merged, manualHeight);
              if (idx >= 0) doc.pages[idx] = merged;
              else doc.pages.push(merged);
            },
            new Set([updatedPage.id]),
            clock,
          );
          this.basePage = updatedPage;
          this.savedRevision = Math.max(this.savedRevision, targetRev);
          return true;
        } catch (error) {
          new Notice(
            t("notebooks.handwrite.errSaveFailed", {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return false;
        }
      });
    return this.saves;
  }

  close(force = false): Promise<boolean> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.saveTimer !== null) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      const { slotEl } = this.req;
      const wasInert = slotEl.inert;
      const hadFocus = slotEl.contains(slotEl.ownerDocument.activeElement);
      slotEl.inert = true;
      const ok = await this.flushSave(true);
      slotEl.inert = wasInert;
      // Not saved, and the block still on screen: it stays open to try again.
      if (!ok && !force && slotEl.isConnected && this.surface) {
        if (hadFocus && slotEl.ownerDocument.activeElement === slotEl.ownerDocument.body) {
          slotEl.focus({ preventScroll: true });
        }
        this.closing = null;
        return false;
      }
      this.dispose();
      return ok;
    })();
    return this.closing;
  }

  /** Take everything down: the surface's canvases, the toolbar, listeners, the claim. */
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.closed = true;
    this.guides?.dispose();
    this.guides = null;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const pill = this.toolbarHostEl?.querySelector<HTMLElement>(".goodobsidian-options");
    if (pill) {
      lastInlineOptionsOpen = !pill.hasClass("is-collapsed") && pill.childElementCount > 0;
    }
    this.toolbar?.destroy();
    this.toolbar = null;
    this.surface?.destroy();
    this.surface = null;
    this.images?.destroy();
    this.images = null;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    releaseInlineEditor(this);
    this.req.onClosed?.();
  }
}
