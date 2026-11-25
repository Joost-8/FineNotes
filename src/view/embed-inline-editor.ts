/**
 * Inline handwriting editor mounted directly over a single-page FineNotes
 * embed (`page-embed.ts`) inside a Markdown note in Live Preview.
 *
 * Reuses FineNotes' real `Toolbar` (preserving the user's exact saved pens,
 * colors, widths, and toolbar layout order), `InkSurface`, and
 * `TemplatePickerModal` so the UI matches normal notebooks 1-to-1.
 */

import { type App, type TFile, Notice, setIcon } from "obsidian";
import type GoodObsidianPlugin from "../main";
import { t } from "../i18n/translate";
import { attachmentDefaults, penPreferencesOf } from "../settings-data";
import { PALETTE, SIZES, VIEW_TYPE_INK } from "../constants";
import { pushRecentColor } from "../model/colors";
import { InsertImage } from "../model/commands";
import { resolveAttachmentFolder } from "../model/attachment-folders";
import { newImageElement, placeImageBox } from "../model/images";
import { addSavedPen, isPenId, samePen, savedPensOf } from "../model/saved-pens";
import { DEFAULT_PAGE_GEOMETRY, type InkDocument, type Page } from "../model/document";
import { attachDotClock, dotClockOf } from "../model/dot-ids";
import {
  INLINE_DEFAULT_HEIGHT,
  finishInlineSketchPage,
  initialInlineManualHeight,
  inlineClampedResizeHeight,
  inlineGrowHeight,
  inlineGrowHeightForPoint,
  isInlineSketchPage,
  mergeInlinePageEdits,
} from "../model/inline-sketch";
import { DARK_PAPER, LIGHT_PAPER, type PaperTheme } from "../canvas/backdrop";
import { TemplatePickerModal } from "./template-picker";
import { ConfirmModal } from "../ui/confirm-modal";
import { pickImageFiles, prepareImageBytes, saveImageAttachment } from "./image-import";
import { copyPictureToSystemClipboard } from "./picture-clipboard";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import { InkSurface } from "./ink-surface";
import { toolStateFrom } from "./ink-view";
import { SavedPenModal } from "./saved-pen-modal";
import { penOfState, Toolbar, type ToolbarState } from "./toolbar";
import { normalizeLayout, type BarItemId, type ToolbarLayout } from "./toolbar-layout";
import { editClosedNotebook, notebookIsOpen, readClosedNotebook } from "./notebook-transaction";

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
]);

const DEFAULT_INLINE_LAYOUT: ToolbarLayout = {
  start: ["undo", "redo"],
  middle: ["select", "pen", "eraser", "shape", "text", "accessories"],
  end: ["stylus"],
  off: [],
};

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

let activeEditor: EmbedInlineEditor | null = null;

function setActiveEditor(editor: EmbedInlineEditor | null): void {
  activeEditor = editor;
}

export function getActiveEmbedInlineEditor(): EmbedInlineEditor | null {
  return activeEditor;
}

export class EmbedInlineEditor {
  private surface: InkSurface | null = null;
  private toolbar: Toolbar | null = null;
  private images: VaultImageCache | null = null;
  private toolState: ToolbarState;
  private doc: InkDocument | null = null;
  private basePage: Page | null = null;
  private stageEl: HTMLElement | null = null;
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

  async start(): Promise<void> {
    const { app, slotEl, notebookFile, pageId, plugin } = this.req;
    while (activeEditor && activeEditor !== this) {
      if (activeEditor.hostSlot === slotEl || !(await activeEditor.close())) {
        return;
      }
    }
    if (this.closed || !slotEl.isConnected) return;
    setActiveEditor(this);

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
        if (activeEditor === this) setActiveEditor(null);
        return;
      }
      const target =
        fullDoc.pages.find((p) => p.id === pageId) ?? fullDoc.pages[this.req.pageNumber - 1];
      if (!target) throw new Error(t("notebooks.handwrite.errPageNotFound"));

      this.imageFolder = resolveAttachmentFolder(
        fullDoc,
        "images",
        attachmentDefaults(plugin.settings),
      );
      const clone: Page = structuredClone(target);
      this.basePage = structuredClone(target);
      if (isInlineSketchPage(clone)) {
        this.manualHeight = initialInlineManualHeight(clone);
        if (clone.geometry.height < INLINE_DEFAULT_HEIGHT) {
          clone.geometry = { ...clone.geometry, height: INLINE_DEFAULT_HEIGHT };
        }
      }
      this.doc = {
        version: fullDoc.version,
        view: { scrollY: 0, width: clone.geometry.width, scale: 1 },
        pages: [clone],
      };
      const clock = dotClockOf(fullDoc);
      if (clock) attachDotClock(this.doc, clock);

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
      return { ...base, desk: "transparent" };
    }
    return { ...LIGHT_PAPER, desk: "transparent" };
  }

  private mount(): void {
    const { app, slotEl, plugin, notebookFile } = this.req;
    const doc = this.doc;
    if (!doc) return;
    const page = doc.pages[0];
    const expandable = isInlineSketchPage(page);

    slotEl.addClass("is-inline-editing");
    const embedHost = slotEl.closest<HTMLElement>(".internal-embed, .cm-embed-block");
    embedHost?.addClass("finenotes-inline-active-embed");
    const scroller = slotEl.closest<HTMLElement>(".cm-scroller");
    scroller?.addClass("finenotes-inline-active-scroller");
    this.cleanups.push(() => {
      slotEl.removeClass("is-inline-editing");
      embedHost?.removeClass("finenotes-inline-active-embed");
      scroller?.removeClass("finenotes-inline-active-scroller");
      const p = this.doc?.pages[0];
      if (p) slotEl.setCssStyles({ aspectRatio: `${p.geometry.width} / ${p.geometry.height}` });
    });

    const overlay = slotEl.createDiv({ cls: "goodobsidian-inline-overlay" });
    this.cleanups.push(() => overlay.remove());

    // Native FineNotes Toolbar directly at the top of the active block (same style as normal notebooks)
    const toolbarHost = overlay.createDiv({ cls: "goodobsidian-inline-toolbar-host" });

    // Stage hosting FineNotes' real InkSurface
    const stage = overlay.createDiv({ cls: "goodobsidian-inline-stage" });
    this.stageEl = stage;
    this.syncStageAspect();
    const ro = new ResizeObserver(() => this.syncStageAspect());
    ro.observe(stage);
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

    this.toolbar = new Toolbar(
      toolbarHost,
      palette,
      SIZES,
      this.toolState,
      {
        returnToPenOnReselect: () => plugin.settings.returnToPenOnReselect === true,
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
          void plugin.setOnlyStylusMode(on);
        },
        onLayout: (next) => {
          plugin.settings.inlineToolbarLayout = next;
          void plugin.saveSettings();
        },
      },
      {
        defaultSize: plugin.settings.defaultSize,
        reservedColors: [plugin.settings.defaultColor, ...(plugin.settings.customColors ?? [])],
        layout:
          plugin.settings.inlineToolbarLayout ??
          inlineLayoutFrom(plugin.settings.toolbarLayout, savedPenIds),
        allowedItems,
        popoverBounds: slotEl,
        pillRow: true,
        startOptionsTucked: true,
        resetLayout: DEFAULT_INLINE_LAYOUT,
        onlyStylusMode: plugin.stylusOnly,
        fingerDrawing: plugin.fingerDrawing,
      },
    );

    // Mount native inline actions directly inside the Toolbar's own `.goodobsidian-bar-doc` group
    const barEl = toolbarHost.querySelector<HTMLElement>(".goodobsidian-toolbar");
    const endGroup = barEl?.querySelector<HTMLElement>(".goodobsidian-bar-doc") ?? barEl;
    if (endGroup) {
      // 1. Native FineNotes Paper & Templates picker (`TemplatePickerModal`)
      const paperBtn = endGroup.createEl("button", {
        cls: "clickable-icon",
        attr: { type: "button", "aria-label": t("notebooks.handwrite.paperTemplate") },
      });
      setIcon(paperBtn, "file-spreadsheet");
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
            p.backdrop = backdrop;
            plugin.settings.inlineLastBackdrop = structuredClone(backdrop);
            void plugin.saveSettings();
            this.revision++;
            const theme = this.effectivePaperTheme();
            this.surface?.setPaperTheme(theme);
            this.toolbar?.setNight(theme.night === true);
            this.syncStageAspect();
            this.surface?.refreshInlinePage(p.id);
            this.scheduleSave();
          },
        }).open();
      });

      // 3. Open in full notebook — jumps directly to this exact page via `pageIndex`
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

      // 4. Done (matching native toolbar icon button)
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
        onChange: () => {
          this.revision++;
          if (expandable) this.maybeGrowHeight();
          this.syncUndoRedo();
          this.scheduleSave();
        },
      },
    );
    this.surface.setInlineWidthLocked(true);
    this.surface.setBackdropPainter(new VaultBackdropRenderer(null));
    this.images.onReady = (path) => this.surface?.imageReady(path);
    this.surface.setImagePainter(this.images);
    this.surface.setTool(this.toolState.tool);
    this.toolbar.setNight(this.effectivePaperTheme().night === true);
    this.syncUndoRedo();
    slotEl.tabIndex = -1;
    slotEl.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
        e.preventDefault();
        e.stopPropagation();
        void this.close();
        return;
      }
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

  private isTransparent(): boolean {
    const page = this.doc?.pages[0];
    return Boolean(
      page && page.backdrop.kind !== "pdf" && page.backdrop.paperColor === "transparent",
    );
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

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 500);
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

  close(): Promise<boolean> {
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
      if (!ok && slotEl.isConnected && this.surface) {
        if (hadFocus && slotEl.ownerDocument.activeElement === slotEl.ownerDocument.body) {
          slotEl.focus({ preventScroll: true });
        }
        this.closing = null;
        return false;
      }
      this.closed = true;
      this.toolbar?.destroy();
      this.toolbar = null;
      this.surface?.destroy();
      this.surface = null;
      this.images?.destroy();
      this.images = null;
      for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
      if (activeEditor === this) setActiveEditor(null);
      this.req.onClosed?.();
      return ok;
    })();
    return this.closing;
  }
}
