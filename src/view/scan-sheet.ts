/**
 * The scan sheet: a photo of a page, four corner handles to drag onto the
 * page's corners, and a live preview of the straightened, cleaned-up result
 * — the web version of Apple's document scanner (VisionKit itself is native
 * and out of a plugin's reach).
 *
 * Retake, Rotate, a Colour / Greyscale / Black & white choice, and Add page.
 * In a notebook, "Next page" keeps the current scan and opens the camera for
 * another; Add then puts them all in, in order, as one undo step (the host
 * does that — see `buildScanInsert`). A single page takes one scan onto
 * itself.
 *
 * The corners start where `initialCorners` finds the page, or 6 % in from
 * the photo's edges when it is not confident. While a corner moves, the
 * preview is straightened from a 640 px copy of the photo, and a loupe above
 * the finger shows the photo under the corner magnified — a finger covers
 * exactly the spot it is placing. On release both are redone from the full
 * working photo.
 *
 * A PDF can be picked too (from the photo picker, never the camera): the
 * iPad Files app's own "Scan Documents" makes one, better than anything a
 * web page can do, and its pages are added as they are — PDF-backed pages,
 * after any photo scans already kept. Not on a single page, which can take
 * no pages; there the picker offers pictures only.
 *
 * Sized for the iPad in both orientations: full screen on mobile, the photo
 * beside the preview in landscape and above it in portrait. Every control is
 * at least 44 px and works with a Pencil or a finger.
 */

import { type App, Modal, Notice, Platform, setIcon } from "obsidian";
import { looksLikePdf } from "../model/scan-commands";
import {
  type Quad,
  isUsableQuad,
  orderQuad,
  scanOutputSize,
  warpPerspective,
} from "../canvas/homography";
import { initialCorners } from "../canvas/page-detect";
import { SCAN_FILTERS, type ScanFilter, applyScanFilter } from "../canvas/scan-filters";
import {
  type Point,
  type RgbaImage,
  downscaleRgba,
  rotatePoint90,
  rotateRgba90,
} from "../canvas/scan-raster";
import { pickImageFile, releaseCanvas } from "./image-import";
import { measurePdfPages } from "./pdf-pages";
import { type PdfScan, type ScanItem, decodePhoto, encodeScan, paint } from "./scan-io";
import { errorMessage } from "../util/errors";

export interface ScanSheetHost {
  /**
   * Scans become new pages, and a PDF may be picked. False for a single
   * page: its scan goes onto that page, and PDFs are not offered.
   */
  multiPage: boolean;
  /**
   * Save the scans and put them in the notebook as one undo step. Resolves
   * true once they are in; false or a rejection leaves the sheet open with
   * the scans kept, so Add can be tried again.
   */
  insert: (items: ScanItem[]) => Promise<boolean>;
}

/** Long side of the photo copy the preview is straightened from while a corner moves, px. */
const PREVIEW_SOURCE = 640;
/** Long side of the preview while a corner moves, px. */
const DRAFT_LONG = 360;
/** Cap on the settled preview's long side, device px. */
const PREVIEW_MAX = 1024;
/** Room around the photo, CSS px, so a handle on its edge is still whole and grabbable. */
const STAGE_PAD = 28;
/** The magnifier: diameter (CSS px), magnification over the photo as shown, lift above the corner. */
const LOUPE_SIZE = 116;
const LOUPE_ZOOM = 3;
const LOUPE_LIFT = 92;
const LOUPE_OUTSIDE: readonly [number, number, number, number] = [96, 96, 96, 255];

const CORNER_NAMES = [
  "Top-left corner",
  "Top-right corner",
  "Bottom-right corner",
  "Bottom-left corner",
];

/** The filter chosen last, kept for the session: most people scan everything the same way. */
let lastFilter: ScanFilter = "colour";

interface Drag {
  index: number;
  pointerId: number;
  /** Corner minus pointer, photo px, so the corner does not jump to the finger. */
  dx: number;
  dy: number;
}

export class ScanSheet extends Modal {
  /** The working photo (≤ 2560 px) and its preview copy; null while there is none. */
  private photo: RgbaImage | null = null;
  private small: RgbaImage | null = null;
  /** Corner handles in photo px, in the order they were placed (not necessarily TL TR BR BL). */
  private corners: Point[] = [];
  private detected = false;
  private filter: ScanFilter = lastFilter;
  /** Finished scans and picked PDFs waiting for Add, in order (photos may still be encoding). */
  private readonly kept: Array<Promise<ScanItem>> = [];
  /** How many notebook pages `kept` will make. */
  private keptPages = 0;
  /** Camera (true) or photo library, for Retake and Next page. */
  private capture = Platform.isMobile;
  private loadToken = 0;
  private busy = false;
  private closed = false;
  private inserted = false;

  private stageEl!: HTMLElement;
  private photoCanvas!: HTMLCanvasElement;
  private maskPath!: SVGPathElement;
  private outline!: SVGPolygonElement;
  private readonly handles: HTMLElement[] = [];
  private loupeEl!: HTMLElement;
  private loupeCanvas!: HTMLCanvasElement;
  private emptyEl!: HTMLElement;
  private emptyText!: HTMLElement;
  private statusEl!: HTMLElement;
  private previewCanvas!: HTMLCanvasElement;
  private captionEl!: HTMLElement;
  private retakeButton!: HTMLButtonElement;
  private rotateButton!: HTMLButtonElement;
  private nextButton: HTMLButtonElement | null = null;
  private addButton!: HTMLButtonElement;
  private addLabel!: HTMLElement;
  private readonly filterButtons = new Map<ScanFilter, HTMLButtonElement>();

  /** Photo px → stage CSS px: `stage = offset + photo × scale`. */
  private fit = { left: 0, top: 0, scale: 1 };
  /** Long side the photo canvas was last painted at, px (0: not painted). */
  private displayLong = 0;
  private resizeObserver: ResizeObserver | null = null;
  private drag: Drag | null = null;
  private frame = 0;
  private pendingPreview: "draft" | "full" | null = null;

  constructor(
    app: App,
    private readonly host: ScanSheetHost,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("goodobsidian-scan-modal");
    this.titleEl.setText("Scan document");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-scan");
    const main = contentEl.createDiv({ cls: "goodobsidian-scan-main" });
    this.buildStage(main);
    this.buildResult(main);
    this.buildBar(contentEl);
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.stageEl);
    this.refresh();
  }

  override onClose(): void {
    this.closed = true;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const unsaved = this.keptPages;
    this.kept.length = 0;
    this.keptPages = 0;
    // Let go of the photo now: on an iPad it is tens of MB.
    this.photo = null;
    this.small = null;
    this.drag = null;
    for (const canvas of [this.photoCanvas, this.previewCanvas, this.loupeCanvas]) {
      if (canvas) releaseCanvas(canvas);
    }
    this.contentEl.empty();
    // While Add is running the scans are already on their way in; closing
    // the sheet then does not stop them, so nothing was discarded.
    if (!this.inserted && !this.busy && unsaved > 0) {
      new Notice(`Scan discarded: ${unsaved} page${unsaved === 1 ? " was" : "s were"} not added.`);
    }
  }

  /**
   * Open the camera (`capture`) or the photo picker, which in a notebook
   * also takes a PDF. Call it synchronously inside a tap: iPadOS opens a
   * picker only for a `click()` made during a user gesture. A cancelled pick
   * leaves the sheet as it was — with its own Take photo and Choose buttons
   * when there is no photo yet, the way to a PDF after the camera was
   * dismissed.
   */
  pickPhoto(capture: boolean): void {
    if (this.busy || this.closed) return;
    this.capture = capture;
    const accept = capture || !this.host.multiPage ? "image/*" : "image/*,application/pdf";
    void pickImageFile(this.contentEl, capture, accept).then((file) => {
      if (file && !this.closed) void this.load(file);
    });
  }

  /**
   * Pick a PDF straight away — what the Files app's "Scan Documents" saves.
   * Apple's own scanner does edges, perspective and many pages better than a
   * web page can, so this is the one-tap route to it. Same gesture rule as
   * {@link pickPhoto}.
   */
  pickPdf(): void {
    if (this.busy || this.closed) return;
    this.capture = false;
    void pickImageFile(this.contentEl, false, "application/pdf").then((file) => {
      if (file && !this.closed) void this.load(file);
    });
  }

  // --- Building ---------------------------------------------------------------

  private buildStage(parent: HTMLElement): void {
    const stage = parent.createDiv({ cls: "goodobsidian-scan-stage" });
    this.stageEl = stage;
    this.photoCanvas = stage.createEl("canvas", { cls: "goodobsidian-scan-photo" });
    const overlay = stage.createSvg("svg", { cls: "goodobsidian-scan-overlay" });
    this.maskPath = overlay.createSvg("path", { cls: "goodobsidian-scan-mask" });
    this.outline = overlay.createSvg("polygon", { cls: "goodobsidian-scan-outline" });
    CORNER_NAMES.forEach((name, index) => {
      const handle = stage.createDiv({
        cls: "goodobsidian-scan-handle",
        attr: { "aria-label": name, role: "button" },
      });
      handle.createDiv({ cls: "goodobsidian-scan-handle-dot" });
      handle.addEventListener("pointerdown", (event) => this.startDrag(event, index));
      handle.addEventListener("pointermove", (event) => this.moveDrag(event));
      handle.addEventListener("pointerup", (event) => this.endDrag(event));
      // iOS ends a pointer that stops moving in pointercancel (CLAUDE.md):
      // a corner held still is simply placed.
      handle.addEventListener("pointercancel", (event) => this.endDrag(event));
      this.handles.push(handle);
    });
    // Cancel touches on a handle, so iPadOS's long press and Scribble cannot
    // claim a corner the Pencil is holding (CLAUDE.md). Only on handles: a
    // tap on the empty state's buttons must still become a click.
    const claim = (event: TouchEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(".goodobsidian-scan-handle")) {
        event.preventDefault();
      }
    };
    stage.addEventListener("touchstart", claim, { passive: false });
    stage.addEventListener("touchmove", claim, { passive: false });

    this.loupeEl = stage.createDiv({ cls: "goodobsidian-scan-loupe is-hidden" });
    this.loupeCanvas = this.loupeEl.createEl("canvas");
    this.loupeEl.setCssStyles({ width: `${LOUPE_SIZE}px`, height: `${LOUPE_SIZE}px` });

    this.emptyEl = stage.createDiv({ cls: "goodobsidian-scan-empty" });
    setIcon(this.emptyEl.createDiv({ cls: "goodobsidian-scan-empty-icon" }), "scan-line");
    this.emptyText = this.emptyEl.createDiv({ cls: "goodobsidian-scan-empty-text" });
    const actions = this.emptyEl.createDiv({ cls: "goodobsidian-scan-empty-actions" });
    if (Platform.isMobile) this.button(actions, "camera", "Take photo", () => this.pickPhoto(true));
    const choose = Platform.isMobile ? "Choose photo" : "Choose picture";
    this.button(actions, "image", this.host.multiPage ? `${choose} or PDF` : choose, () =>
      this.pickPhoto(false),
    );
    this.statusEl = stage.createDiv({ cls: "goodobsidian-scan-status is-hidden" });
  }

  private buildResult(parent: HTMLElement): void {
    const result = parent.createDiv({ cls: "goodobsidian-scan-result" });
    const frame = result.createDiv({ cls: "goodobsidian-scan-preview-frame" });
    this.previewCanvas = frame.createEl("canvas", { cls: "goodobsidian-scan-preview" });
    this.captionEl = result.createDiv({ cls: "goodobsidian-scan-caption" });
  }

  private buildBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "goodobsidian-scan-bar" });
    this.retakeButton = this.button(
      bar,
      Platform.isMobile ? "camera" : "image",
      Platform.isMobile ? "Retake" : "Replace",
      () => this.pickPhoto(this.capture),
    );
    this.rotateButton = this.button(bar, "rotate-cw", "Rotate", () => this.rotate());
    const filters = bar.createDiv({ cls: "goodobsidian-segmented goodobsidian-scan-filters" });
    for (const { id, label } of SCAN_FILTERS) {
      const button = filters.createEl("button", { cls: "clickable-icon", text: label });
      button.addEventListener("click", () => this.setFilter(id));
      this.filterButtons.set(id, button);
    }
    this.syncFilterButtons();
    bar.createDiv({ cls: "goodobsidian-scan-spacer" });
    if (this.host.multiPage) {
      this.nextButton = this.button(bar, "plus", "Next page", () => this.keepAndNext());
    }
    this.addButton = this.button(bar, "check", "Add page", () => void this.finish());
    this.addButton.addClass("goodobsidian-scan-primary");
    this.addLabel =
      this.addButton.querySelector(".goodobsidian-scan-button-label") ?? this.addButton;
  }

  /** An icon-and-label button. `clickable-icon`: Obsidian pads other buttons 20 px on an iPad. */
  private button(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "goodobsidian-scan-button clickable-icon" });
    setIcon(button.createSpan({ cls: "goodobsidian-scan-button-icon" }), icon);
    button.createSpan({ cls: "goodobsidian-scan-button-label", text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  // --- The photo ----------------------------------------------------------------

  private async load(file: File): Promise<void> {
    const token = ++this.loadToken;
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      if (token === this.loadToken && !this.closed) {
        this.setStatus("Couldn't read that file. Try another one.", true);
      }
      return;
    }
    const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024));
    if (looksLikePdf(head, file.type, file.name)) {
      await this.loadPdf(bytes, file.name, token);
      return;
    }
    this.setStatus("Reading the photo…");
    try {
      const photo = await decodePhoto(bytes, file.type);
      if (token !== this.loadToken || this.closed) return;
      this.setPhoto(photo);
      this.setStatus("");
    } catch {
      if (token !== this.loadToken || this.closed) return;
      this.setStatus("Couldn't read that picture. Try another one.", true);
    }
  }

  /**
   * A picked PDF: its pages go in as they are. With nothing kept it is added
   * at once — the Files-app route is one pick; otherwise it joins the kept
   * scans and Add puts them all in, in order. A photo on screen is replaced,
   * as any pick through Replace replaces it.
   */
  private async loadPdf(bytes: ArrayBuffer, name: string, token: number): Promise<void> {
    if (!this.host.multiPage) {
      this.setStatus(
        "A PDF adds pages, and this is a single page. Convert it to a notebook first.",
        true,
      );
      return;
    }
    this.setStatus("Reading the PDF…");
    let pages: PdfScan["pages"];
    try {
      pages = await measurePdfPages(bytes);
    } catch {
      if (token === this.loadToken && !this.closed) {
        this.setStatus("Couldn't read that PDF. Try another one.", true);
      }
      return;
    }
    if (token !== this.loadToken || this.closed) return;
    this.setStatus("");
    const pdf: PdfScan = { kind: "pdf", bytes, name, pages };
    this.kept.push(Promise.resolve(pdf));
    this.keptPages += pages.length;
    if (this.photo) this.clearPhoto();
    if (this.kept.length === 1) {
      await this.finish();
      return;
    }
    this.refresh();
  }

  private setPhoto(photo: RgbaImage): void {
    this.photo = photo;
    this.small = downscaleRgba(photo, PREVIEW_SOURCE);
    // Detect on the preview copy (it is shrunk to 256 px either way) and
    // scale the corners back up to the working photo.
    const start = initialCorners(this.small);
    const kx = photo.width / this.small.width;
    const ky = photo.height / this.small.height;
    this.corners = start.quad.map((p) => ({ x: p.x * kx, y: p.y * ky }));
    this.detected = start.detected;
    this.displayLong = 0;
    this.layout();
    this.refresh();
    this.requestPreview("full");
  }

  private clearPhoto(): void {
    this.loadToken++;
    this.photo = null;
    this.small = null;
    this.corners = [];
    this.drag = null;
    this.displayLong = 0;
    releaseCanvas(this.photoCanvas);
    releaseCanvas(this.previewCanvas);
    this.captionEl.setText("");
    this.layout();
    this.refresh();
  }

  /** Turn the photo a quarter clockwise, corners and all. */
  private rotate(): void {
    const photo = this.photo;
    const small = this.small;
    if (!photo || !small || this.busy) return;
    this.photo = rotateRgba90(photo);
    this.small = rotateRgba90(small);
    this.corners = this.corners.map((p) => rotatePoint90(p, photo.width, photo.height));
    this.displayLong = 0;
    this.layout();
    this.requestPreview("full");
  }

  private setFilter(filter: ScanFilter): void {
    if (this.busy) return;
    this.filter = filter;
    lastFilter = filter;
    this.syncFilterButtons();
    this.requestPreview("full");
  }

  private syncFilterButtons(): void {
    for (const [id, button] of this.filterButtons) {
      button.toggleClass("is-active", id === this.filter);
      button.setAttribute("aria-pressed", String(id === this.filter));
    }
  }

  // --- Layout -------------------------------------------------------------------

  /** Fit the photo to the stage and put the handles and outline on it. */
  private layout(): void {
    const photo = this.photo;
    const width = this.stageEl.clientWidth;
    const height = this.stageEl.clientHeight;
    this.stageEl.toggleClass("has-photo", photo !== null);
    if (!photo || width <= 0 || height <= 0) return;
    const scale = Math.min(
      (width - 2 * STAGE_PAD) / photo.width,
      (height - 2 * STAGE_PAD) / photo.height,
    );
    if (!(scale > 0)) return;
    const w = photo.width * scale;
    const h = photo.height * scale;
    this.fit = { left: (width - w) / 2, top: (height - h) / 2, scale };
    this.photoCanvas.setCssStyles({
      left: `${this.fit.left}px`,
      top: `${this.fit.top}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    // Repaint only for a real change of size: a downscale of the working
    // photo costs tens of ms, and a window being dragged resizes every frame.
    const want = Math.min(
      Math.max(photo.width, photo.height),
      Math.round(Math.max(w, h) * (window.devicePixelRatio || 1)),
    );
    if (!this.displayLong || want > this.displayLong * 1.15 || want < this.displayLong * 0.6) {
      this.displayLong = want;
      paint(this.photoCanvas, downscaleRgba(photo, want));
    }
    this.placeOverlay();
  }

  private toStage(p: Point): Point {
    return { x: this.fit.left + p.x * this.fit.scale, y: this.fit.top + p.y * this.fit.scale };
  }

  private placeOverlay(): void {
    if (!this.photo || this.corners.length !== 4) return;
    this.corners.forEach((corner, i) => {
      const at = this.toStage(corner);
      this.handles[i].setCssStyles({ transform: `translate(${at.x}px, ${at.y}px)` });
    });
    const quad = orderQuad(this.corners).map((p) => this.toStage(p));
    const points = quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    this.outline.setAttribute("points", points.join(" "));
    const w = this.stageEl.clientWidth;
    const h = this.stageEl.clientHeight;
    // Everything but the page is dimmed: the stage, with the quad cut out.
    this.maskPath.setAttribute("d", `M0 0H${w}V${h}H0Z M${points.join("L")}Z`);
    this.outline.toggleClass("is-invalid", !this.usable());
  }

  // --- Dragging a corner ---------------------------------------------------------

  private pointerToPhoto(event: PointerEvent): Point {
    const r = this.stageEl.getBoundingClientRect();
    return {
      x: (event.clientX - r.left - this.fit.left) / this.fit.scale,
      y: (event.clientY - r.top - this.fit.top) / this.fit.scale,
    };
  }

  private startDrag(event: PointerEvent, index: number): void {
    if (!this.photo || this.busy || this.drag) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = this.handles[index];
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Not a live pointer (a synthetic event): the drag still works while
      // the pointer stays on the handle.
    }
    const at = this.pointerToPhoto(event);
    const corner = this.corners[index];
    this.drag = { index, pointerId: event.pointerId, dx: corner.x - at.x, dy: corner.y - at.y };
    handle.addClass("is-dragging");
    this.loupeEl.removeClass("is-hidden");
    this.requestPreview("draft");
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    const photo = this.photo;
    if (!drag || !photo || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const at = this.pointerToPhoto(event);
    this.corners[drag.index] = {
      x: Math.min(photo.width, Math.max(0, at.x + drag.dx)),
      y: Math.min(photo.height, Math.max(0, at.y + drag.dy)),
    };
    this.placeOverlay();
    this.requestPreview("draft");
  }

  private endDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.drag = null;
    this.handles[drag.index].removeClass("is-dragging");
    this.loupeEl.addClass("is-hidden");
    this.refresh();
    this.requestPreview("full");
  }

  // --- Preview and loupe -----------------------------------------------------------

  /** Coalesce preview work into one animation frame; a full render wins over a draft. */
  private requestPreview(kind: "draft" | "full"): void {
    if (this.pendingPreview !== "full") this.pendingPreview = kind;
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      const pending = this.pendingPreview;
      this.pendingPreview = null;
      if (this.closed) return;
      if (pending) this.renderPreview(pending);
      if (this.drag) this.renderLoupe();
    });
  }

  private usable(): boolean {
    const photo = this.photo;
    if (!photo || this.corners.length !== 4) return false;
    return isUsableQuad(orderQuad(this.corners), photo.width, photo.height);
  }

  private renderPreview(kind: "draft" | "full"): void {
    const photo = this.photo;
    const small = this.small;
    if (!photo || !small) return;
    const ok = this.usable();
    this.outline.toggleClass("is-invalid", !ok);
    this.captionEl.toggleClass("is-error", !ok);
    this.captionEl.setText(
      !ok
        ? "The corners don't make a page shape — drag them onto the page's corners."
        : this.detected
          ? "Page found. Drag a corner to adjust it."
          : "Drag the corners onto the page's corners.",
    );
    if (!ok) return;
    let source = photo;
    let quad: Quad = orderQuad(this.corners);
    let long = this.previewLong();
    if (kind === "draft") {
      const k = small.width / photo.width;
      source = small;
      quad = orderQuad(quad.map((p) => ({ x: p.x * k, y: p.y * k })));
      long = DRAFT_LONG;
    }
    const size = scanOutputSize(quad, source.width, source.height, long);
    const out = warpPerspective(source, quad, size.width, size.height);
    if (!out) return;
    applyScanFilter(out, this.filter);
    paint(this.previewCanvas, out);
  }

  /** The settled preview's long side: its frame in device px, capped. */
  private previewLong(): number {
    const frame = this.previewCanvas.parentElement;
    const css = frame ? Math.max(frame.clientWidth, frame.clientHeight) : 600;
    return Math.max(200, Math.min(PREVIEW_MAX, Math.round(css * (window.devicePixelRatio || 1))));
  }

  /** The photo under the corner being dragged, magnified, above the finger. */
  private renderLoupe(): void {
    const drag = this.drag;
    const photo = this.photo;
    if (!drag || !photo) return;
    const corner = this.corners[drag.index];
    const px = Math.round(LOUPE_SIZE * (window.devicePixelRatio || 1));
    const half = LOUPE_SIZE / 2 / (this.fit.scale * LOUPE_ZOOM);
    const view = warpPerspective(
      photo,
      [
        { x: corner.x - half, y: corner.y - half },
        { x: corner.x + half, y: corner.y - half },
        { x: corner.x + half, y: corner.y + half },
        { x: corner.x - half, y: corner.y + half },
      ],
      px,
      px,
      { background: LOUPE_OUTSIDE },
    );
    if (view) paint(this.loupeCanvas, view);
    const at = this.toStage(corner);
    const width = this.stageEl.clientWidth;
    let top = at.y - LOUPE_LIFT - LOUPE_SIZE / 2;
    // Near the top the loupe would leave the stage: show it below instead.
    if (top < 4) top = at.y + LOUPE_LIFT - LOUPE_SIZE / 2;
    const left = Math.min(width - LOUPE_SIZE - 4, Math.max(4, at.x - LOUPE_SIZE / 2));
    this.loupeEl.setCssStyles({ transform: `translate(${left}px, ${top}px)` });
  }

  // --- Keeping and adding ----------------------------------------------------------

  /** The current photo straightened at full size with the chosen filter, or null. */
  private renderScan(): RgbaImage | null {
    const photo = this.photo;
    if (!photo || !this.usable()) return null;
    const quad = orderQuad(this.corners);
    const size = scanOutputSize(quad, photo.width, photo.height);
    const out = warpPerspective(photo, quad, size.width, size.height);
    if (out) applyScanFilter(out, this.filter);
    return out;
  }

  /** Put the current scan aside (encoding in the background) and drop the photo. */
  private keep(scan: RgbaImage): void {
    const encoding = encodeScan(scan, this.filter);
    // Marked as handled here; `finish` still sees the rejection through Promise.all.
    encoding.catch(() => undefined);
    this.kept.push(encoding);
    this.keptPages += 1;
    this.clearPhoto();
  }

  /** "Next page": keep this scan and open the camera for the next. */
  private keepAndNext(): void {
    if (!this.host.multiPage || this.busy) return;
    const scan = this.renderScan();
    if (!scan) return;
    // Open the camera first, while this tap still counts as a user gesture.
    this.pickPhoto(this.capture);
    this.keep(scan);
  }

  /** "Add page": hand everything kept, and the scan on screen, to the host. */
  private async finish(): Promise<void> {
    if (this.busy) return;
    const scan = this.renderScan();
    if (scan) this.keep(scan);
    if (this.kept.length === 0) return;
    this.setBusy(true);
    this.setStatus("Adding…");
    try {
      const items = await Promise.all(this.kept);
      if (this.closed) return;
      if (await this.host.insert(items)) {
        this.inserted = true;
        if (!this.closed) this.close();
        return;
      }
      if (this.closed) return;
      this.setStatus("The scan wasn't added.", true);
    } catch (error) {
      if (this.closed) return;
      const message = errorMessage(error);
      this.setStatus(`Couldn't add the scan — ${message}`, true);
    }
    this.setBusy(false);
  }

  // --- State ------------------------------------------------------------------------

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.contentEl.toggleClass("is-busy", busy);
    this.refresh();
  }

  private setStatus(text: string, error = false): void {
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-hidden", text === "");
    this.statusEl.toggleClass("is-error", error);
  }

  /** Enable, disable and label the controls for the current state. */
  private refresh(): void {
    const has = this.photo !== null;
    const usable = this.usable();
    this.emptyEl.toggleClass("is-hidden", has);
    const ready = this.keptPages;
    this.emptyText.setText(
      ready > 0
        ? `${ready} page${ready === 1 ? "" : "s"} ready. Take the next photo, or add ${ready === 1 ? "it" : "them"}.`
        : this.host.multiPage
          ? "Take a photo of a page, or choose one — or a PDF made with Scan Documents in the Files app, whose pages are added as they are."
          : "Take a photo of a page, or choose one.",
    );
    this.retakeButton.disabled = this.busy || !has;
    this.rotateButton.disabled = this.busy || !has;
    for (const button of this.filterButtons.values()) button.disabled = this.busy;
    if (this.nextButton) this.nextButton.disabled = this.busy || !usable;
    const count = ready + (usable ? 1 : 0);
    this.addButton.disabled = this.busy || count === 0;
    this.addLabel.setText(
      !this.host.multiPage ? "Add to page" : count > 1 ? `Add ${count} pages` : "Add page",
    );
  }
}
