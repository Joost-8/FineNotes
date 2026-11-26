/**
 * The notebook view: one ink note (`.notebook.md`, `.page.md`, or the older
 * `.ink.md`) open in a tab. Obsidian reads and writes the file; this view
 * turns its text into a notebook and back, and puts the pieces on screen:
 *
 *   .goodobsidian-view                the tab's content
 *     .goodobsidian-toolbar           tools and actions (toolbar.ts), at any edge (bar-dock-model.ts)
 *     .goodobsidian-body              a row:
 *       .goodobsidian-pagesidebar       page thumbnails, shown on request (page-sidebar.ts)
 *       .goodobsidian-surface           the pages themselves (ink-surface.ts)
 *     .goodobsidian-textpanel         the note's Markdown text layer (text-panel.ts)
 *
 * Drawing, erasing, selecting and zooming belong to the surface. What stays
 * here is what concerns the file and the note as a whole: loading and saving
 * (with the guard in load-guard.ts), the text layer, transcription and the
 * AI menu, pages, pictures, scans and export.
 */

import { SetFurniture, furnitureText } from "../model/furniture";
import { SetPageTab, nextTabColor } from "../model/page-tabs";
import { SAVED_STICKERS_COLLECTION } from "./sticker-modal";
import { lookPaletteOf, lookStyleOf } from "../model/look";
import { stickerFolderFor, templateFolderFor } from "../model/vault-folders";
import { readShapeToolStyle } from "../model/shape-style";
import { DEFAULT_FILL_COLOR, readFillGap } from "../model/fill-region";
import { isTape, tapeColorOf, tapeHeightOf, tapeHeightsOf, tapeModeOf } from "../model/cover-tape";
import { notebookKeyScope } from "./notebook-keys";
import {
  Menu,
  Notice,
  Platform,
  TextFileView,
  TFile,
  type WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import {
  SetRegion,
  allRegions,
  findRegion,
  nextRegionId,
  regionKey,
  regionRect,
  regionSubpathName,
  uniqueRegionName,
} from "../model/regions";
import type { ShownRegion } from "./region-frames";
import {
  AUTO_RECOGNIZE_IDLE_MS,
  AUTO_RECOGNIZE_LEAVE_MS,
  DEVICE_READ_IDLE_MS,
  DEVICE_READ_NEXT_MS,
  DEVICE_READ_OPEN_MS,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAPER_WIDTH,
  ICON_INK_VIEW,
  PALETTE,
  SIZES,
  VIEW_TYPE_INK,
} from "../constants";
import {
  type AttachmentKind,
  type Bounds,
  type BesidePdf,
  type InkDocument,
  type PageComment,
  type Page,
  type Ruling,
  type TextBoxElement,
  blankPage,
  emptyDocument,
} from "../model/document";
import { DocumentEncoder, buildInkFile, inkFileText, parseInkFile } from "../model/serialize";
import { CompanionSession } from "./companion-session";
import { companionResources } from "../model/companion-pdf";
import { DotClock, attachDotClock, dotClockOf, idsIn } from "../model/dot-ids";
import {
  type DevicePagesLoad,
  devicePagesFolderOf,
  isDevicePagesPayload,
  notebookIdOf,
  readDeviceFileName,
} from "../model/device-pages";
import {
  DevicePagesWriter,
  legacyPayload,
  movedNotebook,
  randomId,
} from "../model/device-pages-writer";
import { movePagesFolder, rememberNotebookId } from "./device-pages-files";
import { DevicePagesSession, deviceIdOf } from "./device-pages-session";
import { BackgroundSaver } from "./background-save";
import type { RecognitionProvider } from "../recognition/provider";
import { MANUAL_PROVIDER_ID } from "../recognition/manual";
import { readTextSection, writeTextSection } from "../recognition/text-layer";
import {
  type TranscriptUpdate,
  hasAskableContent,
  autoTranscriptionBatch,
  choosePageTranscript,
  pageTranscriptViews,
  hasTranscribableContent,
  pageContentHash,
  pageKeys,
  transcriptionCropHeight,
  transcriptHashes,
  transcriptSources,
  renamedLinkTargets,
  syncLinkIndex,
  updatePageTranscripts,
} from "../recognition/page-transcripts";
import { adoptTaskStates, notebookTasks, syncTaskIndex } from "../recognition/task-index";
import { makeTask } from "../model/tasks";
import { type RenderedPage, renderPageForAi } from "../recognition/page-render";
import {
  type DeviceReading,
  type HandwritingReading,
  aiKeyFolded,
  buildAiMenu,
  resolveTranscribeVendor,
  transcriptionAvailability,
  textAvailability,
} from "../recognition/ai-menu-model";
import {
  learnedRecord,
  practiceFiles,
  practiceSheets,
  readCorrections,
} from "./handwriting-learning";
import { sheetButton } from "../recognition/hwr/learn-window-model";
import { practiceLines, promptCount } from "../recognition/practice";
import { CalcNotes } from "./calc-notes";
import { ColumnNotes } from "./column-notes";
import {
  type ChatFile,
  type ChatImage,
  type ChatTurn,
  buildAskSystemPrompt,
  buildAskToolsPrompt,
} from "../recognition/ai-chat";
import { type AskToolCall, searchResultText } from "../recognition/ask-tools";
import {
  VAULT_OFF_TEXT,
  askVaultScopeOf,
  docText,
  freeNotePath,
  inScope,
  linkedNotesText,
  newNoteFolder,
  newNoteText,
  noteFileName,
  readSlice,
  resolveNotePath,
  scopeText,
  vaultSearchText,
} from "../recognition/vault-context";
import { VaultContextSource } from "./vault-context-source";
import { askAbilitiesPrompt, helpEntries, helpText } from "../recognition/finenotes-help";
import { generatedImageName } from "../recognition/ai-image";
import { nextElementId, textBoxBelow, textBoxFrame } from "../recognition/ai-placement";
import {
  type AskAnswer,
  type AskToolOutcome,
  type GeneratedPicture,
  askAi,
  askAiWithTools,
  assertConfigured,
  generateImage,
  targetLabel,
  translateWithAi,
} from "../recognition/ai-client";
import { InkSurface, type SearchFocus } from "./ink-surface";
import { PdfBackdropCache } from "./pdf-backdrop";
import { PdfTextCache } from "./pdf-text-source";
import { type PdfWorker, acquirePdfWorker, releasePdfWorker } from "./pdf-worker";
import { vaultPathFromDrop } from "../model/file-drop";
import { droppedText, outsideDropEffect, takesDrag } from "./drop-text";
import { measurePdfPages } from "./pdf-pages";
import { VaultPaperLibrary, templateNamesIn } from "./paper-library-host";
import { paintedTextHeight, renderPageThumbnail } from "../canvas/renderer";
import {
  PAPER_COPY_PREFIX,
  type PaperEntry,
  existingCopy,
  paperBackdrop,
  paperGeometry,
  paperName,
} from "../model/paper-library";
import { PdfImportModal, VaultPdfSuggestModal } from "./pdf-import-modal";
import { PdfTabStrip, PdfTabsPopover, type StripTab } from "./pdf-tab-strip";
import {
  LAST_TABS_KEY,
  type LastTabs,
  NOTES_TAB,
  SNIPPET_HINT_KEY,
  STRIP_COLLAPSED_KEY,
  flagToStore,
  forgetTab,
  parseLastTabs,
  plusList,
  rememberTab,
  renameInLastTabs,
  showsStrip,
  storedFlag,
  stripTabs,
  tabAfterClosing,
  tabLabel,
} from "../model/pdf-tabs-list";
import {
  attachPdf,
  besideByPath,
  besideDocument,
  findBeside,
  hideTab,
  renameTab,
  setTabView,
  showTab as showBesideTab,
  sizesToRuns,
  syncMarks,
} from "../model/beside-pdfs";
import type { SurfaceSession } from "./surface-session";
import {
  SNIPPET_FLIP_MS,
  type SnippetHover,
  snippetBox,
  snippetSize,
  snippetCrop,
  snippetPixels,
  stepSnippetHover,
} from "../model/snippet";
import { RenameModal } from "./rename-modal";
import { WriteHold } from "./write-hold";
import { PEN_OPTIONS_RETURN_MS, returnsAfterLift, tucksOnWrite } from "./tool-return";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import { VaultImageCache } from "./image-cache";
import {
  measureImage,
  pickImageFiles,
  prepareImageBytes,
  saveImageAttachment,
} from "./image-import";
import { copyPictureToSystemClipboard, writePngToClipboard } from "./picture-clipboard";
import { type ScreenshotOthers, type ScreenshotPicture, ScreenshotModal } from "./screenshot-modal";
import { pageWithoutInk } from "./screenshot-parts";
import { pageCrop } from "./screenshot-crop";
import {
  ImageMenuPopover,
  type ImageMenuContext,
  type InsertImageOptions,
  imageMenuEntries,
} from "./image-menu";
import { isImagePath, mimeForExtension, normalizeMime } from "../canvas/image-raster";
import {
  newImageElement,
  newImageElements,
  nextImageId,
  placeImageBox,
  placeImageGrid,
} from "../model/images";
import {
  STICKY_SIDE,
  DEFAULT_STICKY_COLOR,
  newStickyNote,
  stickyBoxAt,
} from "../model/sticky-notes";
import {
  type BarItemId,
  type BarPreset,
  type ToolbarLayout,
  barItemOfTool,
  effectsOfOffItems,
  isItemOff,
  isPdfTabTool,
  layoutInUse,
  normalizeLayout,
  sameLayout,
} from "./toolbar-layout";
import { needsNewerReader } from "../model/format-features";
import type {
  ContentsLevel,
  ImageElement,
  PageChapter,
  PageSection,
  SlideRef,
} from "../model/document";
import { ScanSheet } from "./scan-sheet";
import type { ScanItem } from "./scan-io";
import {
  type SavedItem,
  buildScanInsert,
  pdfPageGeometry,
  scanFileName,
} from "../model/scan-commands";
import { AiMenuPopover } from "./ai-menu";
import {
  type CalculatorHost,
  CalculatorPopover,
  drawGraphMath,
  graphStateFor,
} from "./calculator-popover";
import { parseCalculatorData, windowOf, withWindow } from "../model/calculator-store";
import { GraphWindow } from "./graph-window";
import { centredOrigin } from "../model/calculator-keys";
import {
  AddGraph,
  EditGraph,
  GRAPH_DEFAULT_H,
  GRAPH_DEFAULT_W,
  graphFrameHeight,
  graphFromSpec,
  nextGraphId,
  specOfGraph,
} from "../model/graph-element";
import type { EquationElement, GraphElement } from "../model/document";
import { AddEquation, EditEquation, makeEquation, nextEquationId } from "../model/equation";
import { measureEquation } from "../canvas/equation-paint";
import { EquationEditor } from "./equation-editor";
import type { GraphSpec } from "../model/graph";
import { type Stroke } from "../model/document";
import { AddStrokeToPage } from "../model/page-commands";
import {
  MARGIN_DEFAULT_PERCENT,
  type PageMargin,
  SetPageMargin,
  contentCutBy,
  marginFloor,
  marginFor,
  marginOf,
  frameWidth,
  hasMargin,
  marginPaperOf,
  marginRuling,
  marginPercentOf,
  type MarginPaperChoice,
  type MarginScope,
  marginSideOf,
  marginSpacingOf,
  unmarginedGeometry,
  withoutFrame,
} from "../model/page-margin";
import { defaultMarginSpacing, storedMarginSpacing } from "../canvas/margin-paper";
import { mmToPage, pageToMm } from "../model/units";
import { AddTable } from "../model/table-commands";
import { setCellText } from "../model/table";
import { nextTableId } from "../model/table";
import { makeTable } from "../model/table";
import { presetGeometry } from "../ink/shape-geometry";
import { CommentModal } from "./comment-modal";
import {
  AddComment,
  MAX_COMMENT_LENGTH,
  RemoveComment,
  SetCommentResolved,
  SetCommentText,
  nextCommentId,
} from "../model/comments";
import { type AskAiHost, AskChatPanel } from "./ask-ai-modal";
import { AskChatWindow } from "./ask-window";
import { listChats, readAttachment, trashChat, writeChat } from "./ask-chats-io";
import {
  type FileKind,
  type FileRow,
  folderRows,
  notebookImages,
  recordingTranscripts,
} from "../model/notebook-files";
import { attachmentFromBytes, pdfsBehind } from "../recognition/ask-attachments";
import { chatsFolderFor } from "../recognition/ask-chat-file";
import { type AskPagesResult, AskSession } from "../recognition/ask-session";
import { GenerateImageModal } from "./generate-image-modal";
import { GoToBoardModal } from "./go-to-board-modal";
import { AddPage, type Command, InsertImage, RemovePage } from "../model/commands";
import {
  AddTextBoxToPage,
  ClearPage,
  MovePage,
  duplicatePageAfter,
  nextPageId,
  pageToInsertAfter,
  type InsertPosition,
  CompositeCommand,
  SetPageBookmark,
  SetPageTemplate,
  insertIndexFor,
  pageFromTemplate,
} from "../model/page-commands";
import {
  SetChapter,
  SetContentsLevels,
  SetPageTitle,
  SetPagesContents,
  SetSection,
  clearedContents,
  levelShift,
  nextSectionId,
} from "../model/contents";
import { MoveContents, planContentsDrop } from "../model/contents-drag";
import {
  type OutlineItem,
  addedEntries,
  outlineContents,
  tabOutlineEntries,
} from "../model/pdf-outline";
import { readPdfOutline } from "./pdf-outline";
import {
  type ChangeSet,
  type PagesSnapshot,
  diffPages,
  isEmptyChange,
  snapshotPages,
} from "../model/change-set";
import { ChangeLedger } from "../model/change-ledger";
import { type PdfOutlineOf, outlineText, placeOutline } from "../model/outline-edit";
import { pagesPhrase } from "../recognition/ask-session";
import {
  DuplicatePages,
  MovePages,
  RemovePages,
  isNoOpBlockMove,
  moveIndexForGap,
} from "../model/page-order";
import { ReceivePages, transferNotice, transferRefusal } from "../model/page-transfer";
import type { TransferReceipt } from "../main";
import { type MoveChoice, MovePagesModal } from "./move-pages-modal";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  externalUrl,
  isExternalTarget,
  linkStrokes,
  linkTargets,
  renameLinkTargets,
} from "../model/links";
import { LinkSuggestModal } from "./link-modal";
import { type ReadingContext, inkForReading, readingText } from "./handwriting";
import { pageWords } from "../recognition/hwr/page-words";
import { type HandwrittenLink, findHandwrittenLinks } from "../recognition/handwritten-links";
import type { PageReading } from "../recognition/hwr/recognizer";
import type { PageLanguage } from "../recognition/hwr/page-language";
import { type ReadWord, readWords, strokeKey } from "../recognition/hwr/corrections";
import { answeredTexts } from "../recognition/hwr/answered-reading";
import {
  type ReadLine,
  lineHits,
  pageHits,
  searchMatchTarget,
  transcriptMatchInk,
} from "../search/hit-strokes";
import {
  type LexiconSuggestion,
  SUGGEST_MARGIN,
  replaceCore,
  wordCore,
} from "../recognition/hwr/lexicon";
import {
  editedPhrase,
  editedWords,
  matchCase,
  selectionWords,
  wordToCorrect,
  wordsByLine,
} from "../recognition/hwr/selection-words";
import type { SpellingFix } from "./spelling-row";
import type { WordPopover } from "./word-popover";
import { type WordCardHost, askUnsureWords } from "./beautify-ask";
import { wordInHand } from "./write-in-hand";
import { type TranslateAi, TranslateWindow, type TranslateTarget } from "./translate-window";
import { nextDeviceStep } from "../recognition/device-reading";
import type { LinkableNote } from "../search/link-choices";
import {
  type Backdrop,
  type PageGeometry,
  type SyntheticBackdrop,
  isCoverRuling,
} from "../model/document";
import {
  paperPageFor,
  paperTemplateFor,
  parseRecent,
  pushRecent,
  shapePageFor,
} from "../model/templates";
import { SetSingle, changeCover } from "../model/notebook-commands";
import {
  boardDrawing,
  boardDrawingBox,
  drawnBounds,
  hasBoards,
  isBoard,
  isBoardPage,
  newBoardPage,
  textLinesHeight,
} from "../model/board";
import { resolveAttachmentFolder } from "../model/attachment-folders";
import { nearbyTarget, relinkDocument } from "../model/moved-files";
import { SetScrollDirection, scrollDirectionOf } from "../model/scroll-direction";
import { SetJoinedPages, joinedPagesOf } from "../model/joined-pages";
import { type NotebookInfo, NoteSettingsModal } from "./note-settings-modal";
import { SetReadOnly, isReadOnly } from "../model/read-only";
import { coverColorOfDocument, notebookName, renamePlan } from "../model/notebook-info";
import { ExportPdfModal } from "./export-modal";
import { penGesturesOf } from "../ink/pen-gestures";
import type { Feature } from "../model/feature-index";
import { TryHint } from "./try-hint";
import { closeMenuOnPressOutside } from "./menu-dismiss";
import { SearchPanel } from "./search-panel";
import { NotebookSearchModal } from "./search-modal";
import { type SearchResult, matchesOfKind } from "../search/search-results";
import { layoutPlainText, pdfHitGroups } from "../search/pdf-hits";
import {
  type KeptPrinted,
  getPrinted,
  printedKey,
  savePrinted,
  saveReading,
  vaultKeyOf,
} from "./search-store";
import {
  type PageText,
  collectPageText,
  holdsPhrase,
  matchText,
  searchPages,
  pageFromSubpath,
  pageInThisNotebook,
  folderNotebookSidecarPath,
  transcriptSidecarPath,
} from "../search/notebook-search";
import { pageLinkLabel } from "./page-embed-model";
import {
  type PdfExportSources,
  exportPagesToImages,
  exportPagesToPdf,
  keepsMargins,
  paintPagePreview,
} from "./pdf-export";
import { exportBaseName } from "../export/page-range";
import {
  type ExportMargins,
  exportFormatOf,
  exportMarginsOf,
  exportTarget,
  mimeTypeOf,
} from "../export/export-choice";
import { exportNamesOf, pdfName, rememberPdfName } from "../export/export-name";
import { inkFileSuffix, stripInkSuffix, uniqueFileName } from "../model/new-notebook";
import { TEMPLATE_EXTENSION, buildTemplatePackage } from "../import/template-package";
import { SaveTemplateModal, type TemplateDetails } from "./template-ui";
import { MorePanel } from "./more-panel";
import { ShortcutsModal } from "../ui/shortcuts-modal";
import { SHORTCUT_GROUPS } from "../model/shortcuts";
import { boundShortcutGroups } from "../model/shortcut-bindings";
import { fastKeys } from "../model/fast-ways";
import type { NudgeEvent } from "../model/nudges";
import { ContentsTitleModal } from "./contents-title-modal";
import { TaskModal } from "./task-modal";
import { InkTextModal } from "./ink-text-modal";
import { TranscriptModal } from "./transcript-modal";
import { sanitizeTextStyle, textStyleOf } from "../model/text-style";
import {
  DEFAULT_SHAPE_COLOR,
  parseHexColor,
  pushRecentColor,
  recentColorsOf,
} from "../model/colors";
import { AddPagePopover, TemplatePickerModal } from "./template-picker";
import { MARGIN_SWATCH_CSS_WIDTH, type MarginChoice, MarginPopover } from "./margin-popover";
import { CoverPopover } from "./cover-picker";
import { LIGHT_PAPER, type PaperTheme, paperTheme } from "../canvas/backdrop";
import { lassoFilterOf, lassoModeOf } from "../canvas/lasso";
import { rulerSettingsOf } from "../canvas/ruler-geometry";
import { eraserFilterOf } from "../ink/stroke-eraser";
import {
  type PageAction,
  PageSidebar,
  type PageSidebarRenderOptions,
  thumbnailRasterScale,
  type SectionAction,
  type SelectionAction,
  type TranscriptAction,
} from "./page-sidebar";
import {
  type ActiveTool,
  PEN_TYPES,
  Toolbar,
  type ToolbarState,
  penOfState,
  penTypeFor,
} from "./toolbar";
import type { PillDock } from "./pill-dock-model";
import type { BarDock } from "./bar-dock-model";
import { penInksOf } from "../model/pen-inks";
import { eraserPresetsOf, widthPresetsOf } from "../model/width-presets";
import { penTypeOrderOf } from "../model/pen-type-order";
import { penStabilizationOf } from "../model/pen-stabilization";
import {
  type SavedPen,
  addSavedPen,
  openingTool,
  samePen,
  savedPenOf,
  savedPensOf,
} from "../model/saved-pens";
import { SavedPenModal } from "./saved-pen-modal";
import { PANEL_SLIDE_MS, type PageSnapshot } from "./motion";
import {
  type BoardSpot,
  type LastPages,
  forgetInLastPages,
  LAST_PAGES_KEY,
  lastPageIndex,
  parseLastPages,
  rememberPage,
  renameInLastPages,
  reopenBoards,
  spotAnchor,
} from "../model/last-page";
import { NoteAudio } from "./note-audio";
import { LoadGuard } from "./load-guard";
import { OwnTexts, mergeReload } from "../model/reload-merge";
import { TextPanel } from "./text-panel";
import type GoodObsidianPlugin from "../main";
import type { GoodObsidianSettings } from "../settings";
import {
  attachmentDefaults,
  greyWhileErasingOf,
  handwritingReaderOf,
  penPreferencesOf,
  snapCurveOf,
  highlighterTipOf,
  snapModeOf,
  deskChoiceOf,
  deskColorOf,
  shownPaperTheme,
} from "../settings-data";
import { penCursorStyleOf } from "./pen-cursor";
import { english, t, tn } from "../i18n/translate";
import { errorMessage } from "../util/errors";
import { writeSystemText } from "./system-clipboard";
import { obsidianOpenUri } from "../model/home-link";
import { familiesIn } from "../model/font-catalogue";
import { vaultFonts } from "./font-store";
import { docOf, isElement, onWindowMoved, winOf } from "./host-window";
import { Presenter } from "./presenter";

/** Quiet time after the page being read changes before it is remembered. */
/** A notebook that has just opened waits this long before its first page's PDF text is read for OCR, ms. */
const OCR_OPEN_DELAY_MS = 800;
/** JPEG quality of a notebook attached to Ask AI as a PDF: legible to a model, a third the size. */
const ASK_PDF_QUALITY = 0.6;
/** Present mode fits the page once the pane has its new size (`startPresenting`). */
const PRESENT_SETTLE_MS = 150;
/** How long after opening a notebook its PDF pages' text starts being read for Home's search, ms. */
const PDF_INDEX_DELAY_MS = 4000;
/** The pause between two PDF pages read for Home's search, ms: never a burst. */
const PDF_INDEX_GAP_MS = 120;
const LAST_PAGE_DEBOUNCE_MS = 500;
/** How long a PDF's tab rests before where it is read is kept in the notebook, ms. */
const TAB_VIEW_SETTLE_MS = 2000;

/** How long the page in view must stay before it is checked for misread words, ms. */
const WORD_CHECK_WAIT_MS = 1500;
/** How long after one "this notebook is read-only" notice the next may show, ms. */
const READ_ONLY_NOTICE_MS = 4000;
/** A drag event this long after the last one starts a new drag, for the debug HUD. */
const DRAG_NOTE_GAP_MS = 1000;
/** PDF pages read for search between refreshes of an open search list (#112). */
const PDF_SEARCH_BATCH = 8;
/** How long after a notebook opens "Update available" appears, ms: once the bar is laid out. */
const UPDATE_TIP_DELAY_MS = 1500;

/**
 * The tools as the settings left them, for a view that has just opened: the
 * pen last written with, in any notebook (FineNotes#24), else the defaults.
 */
function toolStateFrom(s: GoodObsidianSettings): ToolbarState {
  const last = savedPenOf(s.lastPen);
  // Without a last pen, a notebook opens with the Fountain pen, a pressure pen.
  const spec = PEN_TYPES.find((type) => type.id === last?.type) ?? PEN_TYPES[0];
  const inks = penInksOf(s.penInks);
  return {
    tool: openingTool(s.defaultTool, last),
    color: last?.color ?? s.defaultColor,
    size: last?.size ?? s.defaultSize,
    penType: last?.type,
    pressureEnabled: s.pressureWidth && spec.pressure,
    snapMode: snapModeOf(s),
    snapCurvatureThreshold: snapCurveOf(s.snapCurvatureThreshold),
    eraserMode: s.eraserMode,
    eraserSize: s.eraserSize,
    widthPresets: widthPresetsOf(s.widthPresets),
    eraserPresets: eraserPresetsOf(s.eraserPresets),
    eraserFilter: eraserFilterOf(s.eraserFilter),
    eraserGrey: greyWhileErasingOf(s.greyWhileErasing),
    lassoMode: lassoModeOf(s.lassoMode),
    lassoFilter: lassoFilterOf(s.lassoFilter),
    textStyle: sanitizeTextStyle(s.textStyle),
    textPinned: s.textToolPinned === true,
    textDragSize: s.textDragSize === true,
    penGestures: penGesturesOf(s.penGestures),
    shapeColor: parseHexColor(s.shapeColor ?? "") ?? DEFAULT_SHAPE_COLOR,
    shapeStyle: readShapeToolStyle(s.shapeStyle),
    fillGap: readFillGap(s.fillGap),
    fillColor: parseHexColor(s.fillColor ?? "") ?? DEFAULT_FILL_COLOR,
    tapeColor: tapeColorOf(s.tapeColor),
    tapeHeight: tapeHeightOf(s.tapeHeight),
    tapeHeights: tapeHeightsOf(s.tapeHeights),
    tapeMode: tapeModeOf(s.tapeMode),
    tapeSnapText: s.tapeSnapText === true,
    tableHeader: s.tableHeader === true,
    recentColors: recentColorsOf(s.recentColors),
    // The pen in hand's row is its own, when it has one (model/pen-inks.ts).
    penColors: inks[spec.id]?.colors ?? (Array.isArray(s.penColors) ? [...s.penColors] : undefined),
    penInks: inks,
    penTypeOrder: penTypeOrderOf(
      s.penTypeOrder,
      PEN_TYPES.map((type) => type.id),
    ),
    penStabilization: penStabilizationOf(s.penStabilization),
    rulerKind: rulerSettingsOf(s.ruler).kind,
    rulerSnap: rulerSettingsOf(s.ruler).snap,
    zoomBox: s.magnifierZoomBox === true,
  };
}

/** What this device is, for a practice file's training data: "ipad", "android", "mac"… */
function deviceKind(): string {
  if (Platform.isIosApp) return Platform.isTablet ? "ipad" : "iphone";
  if (Platform.isAndroidApp) return Platform.isTablet ? "android-tablet" : "android";
  if (Platform.isMacOS) return "mac";
  if (Platform.isWin) return "windows";
  if (Platform.isLinux) return "linux";
  return "unknown";
}

/** The Files tab's kind, for every notebook opened in this session. */
let lastFileKind: FileKind = "recordings";

/** A page's latest reading on this device, for lassoed ink (`readSelection`). */
interface PageWords {
  hash: string;
  words: ReadWord[];
  /** Every stroke on its read lines, and each line's text. */
  read: Set<string>;
  lines: string[];
  /** Each line's text and its ink's word groups, for search to find words in (2.5.1). */
  readLines: ReadLine[];
  /** The worker's id for it, while it keeps its log-probabilities. */
  id?: number;
  /** The page's language (page-language.ts): the English word list is for "en" only. */
  language: PageLanguage;
}

/** What lassoed ink says, for a dialog's field. */
interface SelectionText {
  text: string;
  /** Words the ink may say otherwise (spelling-row.ts). */
  fixes: SpellingFix[];
  /** The page's read words it was taken from; empty when read afresh. */
  words: ReadWord[];
}

/** A page's words as last read, for its underlines (`checkWords`). */
interface CheckedPage {
  hash: string;
  words: ReadWord[];
  /** By stroke key: the list words a flagged word's ink fits best. */
  suggestions?: Map<string, LexiconSuggestion | null>;
}

/**
 * The ink a lassoed action acts on: what was selected, and the rest of any
 * word the lasso only touched (`selectionWords` reads such a word whole, so
 * the ink that word is made of goes with it).
 */
function touchedInk(strokeIds: readonly string[], read: SelectionText | null): string[] {
  const ids = new Set(strokeIds);
  for (const word of read?.words ?? []) for (const id of word.strokeIds) ids.add(id);
  return [...ids];
}

/** Files of a notebook changing together (a sync landing) are read once they have settled, ms. */
const DEVICE_PAGES_SETTLE_MS = 300;

/** How long the pen rests after a practice sheet's last line before the sharing invite. */
const SHEET_INVITE_DELAY_MS = 4000;

/** A PDF's outline being read for its tab's Contents, and its entries once in. */
interface PdfOutlineRead {
  read: Promise<void>;
  items?: OutlineItem[];
}

/** Why the outline tools refuse on a PDF's tab, for the model. */
const PDF_TAB_OUTLINE_TEXT =
  "The user is on a PDF's tab beside the notes: its contents are the PDF's own outline and cannot be " +
  "changed. Ask them to go back to the notes' tab to work on the notebook's outline.";

export class InkView extends TextFileView {
  /** The notebook on screen; a blank one until a file has loaded. */
  private doc: InkDocument;
  /** The note's Markdown outside the ink block: frontmatter, prose, text layer. */
  private noteBody = "";
  /** Whether the note may be saved over: never while a read is held. */
  private readonly guard = new LoadGuard();
  /** Texts this view loaded or wrote lately: a read of one holds nothing new (FineNotes#273). */
  private readonly ownTexts = new OwnTexts();
  /** The file's text as this view last loaded or wrote it; `null` when not known. */
  private knownText: string | null = null;
  /**
   * The file read again while open (FineNotes#273), for the diagnostics:
   * `own` reads of a text this view had, skipped; `empty` reads of an
   * emptied file, skipped; `merged` changes from
   * elsewhere taken in with this view's unsaved changes, `carried` of
   * those kept; `replaced` loaded as they were, nothing being unsaved.
   */
  private readonly diskReloads = { own: 0, empty: 0, merged: 0, carried: 0, replaced: 0 };
  /**
   * Not plain text to Obsidian (FineNotes#246). Obsidian's TextFileView
   * sets this, and while it is set a file changed on disk (a sync landing)
   * is patched into the view's unsaved text, character by character, before
   * `setViewData` sees it. Two ink blocks merged that way are one that does
   * not decode. Off, Obsidian hands over the file as it is on disk.
   */
  isPlaintext = false;

  /** True from `onOpen` to `onClose`, while the view's DOM exists. */
  private mounted = false;
  /** When the last "this notebook is read-only" notice showed, ms. */
  private readOnlyNoticeAt = 0;
  /** When the last drag event came over the notebook (`noteDrag`), ms. */
  private dragSeenAt = 0;
  private surface: InkSurface | null = null;
  /** Lines ending in "=" answered on a tap (off unless the setting is on). */
  private readonly calcNotes: CalcNotes;
  private readonly columnNotes: ColumnNotes;
  private toolbar: Toolbar | null = null;
  private sidebar: PageSidebar | null = null;
  /** The ⋯ panel, while open. */
  private morePanel: MorePanel | null = null;
  /** The keyboard shortcuts pop-up, while it shows. */
  private shortcuts: ShortcutsModal | null = null;
  private addPagePopover: { popover: AddPagePopover; anchor: HTMLElement } | null = null;
  private coverPopover: { popover: CoverPopover; anchor: HTMLElement } | null = null;
  private marginPopover: MarginPopover | null = null;
  private aiMenu: AiMenuPopover | null = null;
  private calculator: CalculatorPopover | null = null;
  /** The Translate window, while it is open. */
  private translateWindow: TranslateWindow | null = null;
  /** The equation window, while one is open (discussion #166). */
  private equationEditor: EquationEditor | null = null;
  /** The graph popped out of the calculator, floating over the notebook. */
  private graphWindow: GraphWindow | null = null;
  /** The transcription in progress, if any; `cancelled` is set by tapping its notice. */
  private transcription: { cancelled: boolean } | null = null;
  private pdfCache: PdfBackdropCache | null = null;
  /** The PDF pages' text, for the highlighter that snaps to it and for Copy text. */
  private pdfText: PdfTextCache | null = null;
  /** PDF pages' printed text for search, by `path:page` (#112); kept on this device too (search-store.ts). */
  private readonly pdfSearchText = new Map<string, string>();
  /** Reading the PDF pages' text for Home's search, a while after opening. */
  private pdfIndexTimer = 0;
  /** Whether this view holds a use of the shared PDF worker (`acquirePdfWorker`). */
  private pdfWorkerHeld = false;
  /** That worker once it is up: the PDF pages' text is read from its documents too. */
  private pdfWorker: PdfWorker | null = null;
  /** The search box's last query, for the next search. */
  private lastSearch = "";
  /** A link's `#Page N`, until the pages it names have loaded. */
  private pendingSubpath: string | null = null;
  /** Back/Forward's page (0-based), until the pages have loaded. */
  private pendingPageIndex: number | null = null;
  /** A result of Obsidian's own search, to light up on its page once it shows (2.5). */
  private pendingSearch: { pageIndex: number; query: string } | null = null;
  /**
   * The file this leaf has put on its remembered page. A second load of the
   * same file (a sync touched it) keeps the reader where they are.
   */
  private restoredPath: string | null = null;
  private lastPageTimer = 0;
  /** The file whose data `setViewData` last loaded; `null` after `clear`. */
  private loadedPath: string | null = null;
  /**
   * The notebook shown keeps its pages in one file per page per device
   * (FineNotes#274): its page folder, and this device's writing in it. The
   * notebook file itself then holds only the note and the legacy notebook,
   * written once; a save writes this device's changed page files.
   */
  private devicePages: DevicePagesSession | null = null;
  /** Counts loads, so page files read for an earlier one are dropped. */
  private devicePagesRead = 0;
  private devicePagesTimer = 0;
  /** The notebook whose "still syncing" notice has shown, so a reread does not repeat it. */
  private devicePagesNoticed: string | null = null;
  /**
   * A one-file notebook as it was read, for its move to page files at its
   * first save (#274): the payload it moves with, and the clock its new ids
   * already come from, so ids made before that save are dots too.
   */
  private pendingMove: {
    payload: string;
    clock: DotClock;
    /** The notebook as read, ready to write what changes from it. */
    writer: DevicePagesWriter;
  } | null = null;
  /** When the "still syncing" notice last showed for an edit refused, ms. */
  private syncingNoticeAt = 0;
  /**
   * The pages changed since the last save of page files, as the changes
   * named them; `null` when a change did not say (then every page is looked
   * at). A big notebook is not stored whole at every save.
   */
  private changedPages: Set<string> | null = new Set();
  private backdrops: VaultBackdropRenderer | null = null;
  /** The same PDFs at thumbnail size, so the sidebar never asks for page-sized rasters. */
  private thumbBackdrops: VaultBackdropRenderer | null = null;
  /**
   * Compresses saves quickly, hands back what was read while nothing
   * changed, and keeps each page's JSON for the background save. Every
   * change to a page must reach it: {@link requestSaveOf} names the pages,
   * and `requestSave` (wrapped in the constructor) counts as all of them.
   */
  private readonly encoder = new DocumentEncoder();
  /** Saves with the main thread kept free (background-save.ts). */
  private readonly saver: BackgroundSaver;
  /** Obsidian's own `requestSave`, which says nothing about what changed. */
  private readonly saveRequest: () => void;
  /** What `getViewData` answers while a background save writes; null otherwise. */
  private preparedContents: string | null = null;
  /** The save cache was found to have missed a change (reported once). */
  private missedReported = false;
  /** Saves and PDF rasterising wait while the pen writes (write-hold.ts). */
  private readonly writeHold = new WriteHold();
  private quietTimer = 0;
  /** "Until the pen lifts": brings back the pen's options once the pen has rested. */
  private optionsReturnTimer = 0;
  private images: VaultImageCache | null = null;
  /** The Ask AI conversation about this notebook, while it is open (see `askConversation`). */
  private askSession: AskSession | null = null;
  /** What Ask AI changed in this notebook while it is open, numbered, to take back later. */
  private readonly askChanges = new ChangeLedger();
  /** Ask AI answers given so far; each answer's number. */
  private askAnswers = 0;
  /** The answer being given: its number, and every command its tools made, for one undo step. */
  private askTurn: { answer: number; commands: Command[] } | null = null;
  /** The tool call running: what the notebook was before its first edit, and what it changed. */
  private askCall: { before: PagesSnapshot | null; set: ChangeSet | null; record: boolean } | null =
    null;
  /** The chats showing Ask AI's changes, told when the notebook changes. */
  private readonly askChangeListeners = new Set<() => void>();
  /** The vault as Ask AI reads it, kept for a few seconds across tool calls. */
  private vaultSource: VaultContextSource | null = null;
  /** Notes Ask wrote while this notebook is open, by lower-case title: the only ones it may rewrite. */
  private readonly askNotes = new Map<string, string>();
  /** Ask in its sidebar, beside the page (the other layout is a window). */
  private chatPanel: AskChatPanel | null = null;
  /** Ask as a window floating over the notebook (the layout `window`). */
  private askWindow: AskChatWindow | null = null;
  /** Search this notebook: the field and its results, in a sidebar or a window (#112). */
  private searchPanel: SearchPanel | null = null;
  /** The notebook's body, where search's sidebar docks. */
  private searchBody: HTMLElement | null = null;
  /** The page sidebar was shut when a pinch opened the overview: shut it again after. */
  private sidebarForOverview = false;
  private imageMenu: { popover: ImageMenuPopover; anchor: HTMLElement } | null = null;
  /** Recording, replay and audio transcription (0.5); see note-audio.ts. */
  private audio: NoteAudio | null = null;
  /** The current tool, colour, size and so on, shared with the toolbar and the surface. */
  private readonly toolState: ToolbarState;

  /** The text layer below the pages, while mounted. */
  private textPanel: TextPanel | null = null;
  private windowEventsOff: (() => void) | null = null;
  /** Whether the text layer is open; outlives the DOM, so a reopened view keeps it. */
  private textPanelOpen = false;

  /** The wait before an automatic transcription (see `scheduleAutoTranscription`). */
  private transcribeTimer = 0;
  /** Ids of the pages written on since the last automatic transcription took them. */
  private autoPages = new Set<string>();
  /** The page in view, to tell which page was left when another comes into view. */
  private shownPageId: string | null = null;
  /** Present mode while it is on (⋯ › Present). */
  private presenter: Presenter | null = null;
  /** The next on-device reading for search and the text layer (`scheduleDeviceReading`). */
  private deviceTimer = 0;
  /** A page is being read on the device right now. */
  private deviceBusy = false;
  /**
   * Words read on each page, by page id, with the page hash they were read
   * at: what an underlined word's tap looks up (`checkWords`).
   */
  private readonly checkedWords = new Map<string, CheckedPage>();
  /** Each page's latest reading at its content hash, by page id. */
  private readonly pageReadings = new Map<string, PageWords>();
  /** The card of the underlined word last tapped, while it is open. */
  private wordPopover: WordPopover | null = null;
  /** Stops the gear's update mark following the plugin's check. */
  private unwatchUpdates: (() => void) | null = null;
  /** The wait before the page in view is checked for misread words. */
  private wordCheckTimer = 0;
  /** Pages read on the device this session, by key, at the hash they were read at. */
  private readonly deviceRead = new Map<string, string>();
  /** The pen is on the page. */
  private penIsDown = false;

  /** Whether the input debug overlay is on. */
  private showHud: boolean;

  /** The PDF tabs under the tool bar (`pdf-tab-strip.ts`); hidden with none attached. */
  private pdfTabs: PdfTabStrip | null = null;
  private pdfTabsPopover: PdfTabsPopover | null = null;
  /** The notes' session on the surface, the one `setDocument` fills. */
  private notesSession: SurfaceSession | null = null;
  /** Each PDF tab shown since the notebook loaded, by its id: its undo, its view. */
  private readonly tabSessions = new Map<string, SurfaceSession>();
  /** The tab shown: {@link NOTES_TAB}, or a `BesidePdf` id. */
  private activeTab = NOTES_TAB;
  /** The tool the notes had in hand when a PDF's tab took over; it comes back with them. */
  private notesTool: ActiveTool | null = null;
  private tabViewTimer = 0;
  private pdfTabNoticeAt = 0;
  /**
   * A snippet being dragged off a PDF's tab (`startSnippet`): the slide it
   * is of, its area, its picture as it is drawn, and its rest over the Notes
   * tab. The timer asks again while it rests there without moving.
   */
  private snippet: {
    tab: string;
    page: number;
    size: { width: number; height: number };
    /** The width of the slide it came from, page px (`snippetSize`). */
    slideWidth: number;
    pixels: { width: number; height: number };
    picture: Promise<Blob | null>;
    hover: SnippetHover;
    at: { x: number; y: number };
  } | null = null;
  private snippetTimer = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: GoodObsidianPlugin,
  ) {
    super(leaf);
    // Any save asked for without naming pages may follow a change anywhere:
    // every page is serialised again (the save cache's conservative default).
    this.saveRequest = this.requestSave.bind(this);
    this.requestSave = () => {
      this.encoder.touchAll();
      this.changedPages = null;
      this.saveRequest();
    };
    this.saver = new BackgroundSaver(
      this.encoder,
      {
        target: () => {
          if (!this.file || this.guard.locked) return null;
          this.syncTabMarks();
          return { doc: this.doc, file: this.file };
        },
        body: () => this.syncedBody(),
        write: (contents, behind) => this.writePrepared(contents, behind),
        writeNow: () => this.writeFile(),
        penBusy: () => this.writeHold.writing(performance.now()),
      },
      // Loaded when first needed, as the recogniser's client is.
      async () =>
        typeof Worker === "undefined"
          ? null
          : (await import("./save-worker-client")).startSaveWorker(),
    );
    this.companion = this.companionSession();
    this.showHud = plugin.settings.debugHud;
    this.doc = this.blankNotebook();
    this.toolState = toolStateFrom(plugin.settings);
    this.calcNotes = new CalcNotes({
      app: this.app,
      reader: plugin.handwriting,
      enabled: () =>
        this.settings.calcNotes === true &&
        this.settings.handwritingOnDevice !== false &&
        !this.isPractice &&
        !this.isProtected(),
      surface: () => this.surface,
      page: (pageId) => this.doc.pages.find((p) => p.id === pageId) ?? null,
      openGraph: () => this.calculatorOnLine(null),
      learning: () => plugin.learningHost(),
      record: async (pageId, strokes, read, text, kind) => {
        const note = this.file?.path;
        if (!note) return;
        await plugin.wordCheck.record(
          { note, pageId, word: { text: read, strokeIds: strokes.map((s) => s.id) }, strokes },
          kind,
          text,
          "calc",
        );
      },
      handAnswer: (text, at) => plugin.writeInHand.answerInk(text, at),
    });
    this.columnNotes = new ColumnNotes({
      app: this.app,
      reader: plugin.handwriting,
      enabled: () =>
        this.settings.columnSums === true &&
        this.settings.handwritingOnDevice !== false &&
        !this.isPractice &&
        !this.isProtected(),
      surface: () => this.surface,
      page: (pageId) => this.doc.pages.find((p) => p.id === pageId) ?? null,
      learning: () => plugin.learningHost(),
      record: async (pageId, strokes, read, text, kind) => {
        const note = this.file?.path;
        if (!note) return;
        await plugin.wordCheck.record(
          { note, pageId, word: { text: read, strokeIds: strokes.map((s) => s.id) }, strokes },
          kind,
          text,
        );
      },
    });
  }

  /** The plugin's settings, read afresh each time: the settings tab may change them. */
  /**
   * The pen dialog for a new saved pen, from the toolbar's New pen
   * (FineNotes#211): it starts from `start` (the pen in hand), and the pen
   * it saves goes to `onMade` with its id.
   */
  private openNewPen(start: SavedPen, onMade: (pen: SavedPen) => void): void {
    const settings = this.settings;
    new SavedPenModal(this.app, {
      pen: start,
      index: null,
      pens: savedPensOf(settings.savedPens),
      highlighterAlpha: settings.highlighterAlpha,
      recent: settings.recentColors,
      palette: settings.customColors,
      onCustomColor: (color) => {
        settings.recentColors = pushRecentColor(settings.recentColors, color);
        void this.plugin.saveSettings();
      },
      onSave: (pen) => {
        this.plugin.saveSavedPens(addSavedPen(savedPensOf(this.settings.savedPens), pen));
        const made = savedPensOf(this.settings.savedPens).find((saved) => samePen(saved, pen));
        if (made) onMade(made);
      },
    }).open();
  }

  private get settings(): GoodObsidianSettings {
    return this.plugin.settings;
  }

  /** A notebook with one blank page, at the paper width the settings ask for. */
  private blankNotebook(): InkDocument {
    return emptyDocument(this.settings.paperWidth);
  }

  getViewType(): string {
    return VIEW_TYPE_INK;
  }

  override getIcon(): string {
    return ICON_INK_VIEW;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? t("view.notebook");
  }

  /** The note was renamed or moved: a header's `{title}` and the thumbnails follow. */
  override async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    this.surface?.setNotebookTitle(this.notebookTitle());
    this.updateSidebarRendering();
    // Obsidian calls this for other files too (a page file moved along): only this notebook counts.
    if (file === this.file) await this.followDevicePages(file.path);
  }

  /**
   * The notebook shown moved or was renamed (#274): its page folder is found
   * at its new place, or taken along from the old one, and saves go there.
   * What it had not written yet goes to the old place first, and moves with it.
   */
  private async followDevicePages(path: string): Promise<void> {
    const shown = this.devicePages;
    const id = shown ? notebookIdOf(shown.payload) : null;
    if (!shown || id === null) return;
    const folder = devicePagesFolderOf(path, id);
    if (folder === shown.folder && path === shown.path) return;
    if (!this.guard.locked) await this.saveDevicePages(shown, true);
    const next = new DevicePagesSession(
      this.app,
      path,
      shown.payload,
      folder,
      shown.device,
      shown,
      shown.clock,
    );
    next.writer = shown.writer;
    this.devicePages = next;
    await movePagesFolder(this.app, shown.path, path, id);
  }

  // --- Reading and writing the file ------------------------------------------

  /** What Obsidian writes to the file: the note rebuilt, unless its load was held. */
  getViewData(): string {
    if (this.preparedContents !== null) return this.preparedContents;
    const body = this.syncedBody();
    this.syncTabMarks();
    // Kept as page files: the notebook file holds the note and the legacy notebook, as it is.
    const pages = this.devicePages;
    if (pages) return this.guard.contents(() => inkFileText(body, pages.payload));
    const missed = this.encoder.missed;
    const text = this.guard.contents(() => buildInkFile(body, this.doc, this.encoder));
    if (this.encoder.missed > missed && !this.missedReported) {
      this.missedReported = true;
      console.warn("FineNotes: a page changed without telling the save cache; saved in full.");
    }
    return text;
  }

  /** The note's body, its links list brought up to date. */
  private syncedBody(): string {
    // The text block's links list follows the notebook's handwritten links,
    // so backlinks and the graph see them (FineNotes#20).
    this.noteBody = syncLinkIndex(this.noteBody, linkTargets(this.doc));
    // And its checklist follows the notebook's, for the Tasks plugin (2.5).
    this.noteBody = syncTaskIndex(this.noteBody, notebookTasks(this.doc));
    return this.noteBody;
  }

  /**
   * These pages changed (ids), or anything did when none are named: save,
   * and serialise only those pages again.
   */
  private requestSaveOf(pageIds?: readonly string[]): void {
    if (pageIds) this.encoder.touchIds(this.doc, pageIds);
    else this.encoder.touchAll();
    if (!pageIds) this.changedPages = null;
    else if (this.changedPages) for (const id of pageIds) this.changedPages.add(id);
    this.saveRequest();
  }

  /** Only the note's text around the ink changed: save it, with every page as cached. */
  private requestBodySave(): void {
    this.saveRequest();
  }

  /**
   * Obsidian's own save, the only way this view writes its file; nothing
   * while a load is held (load-guard.ts). Obsidian writes whenever the
   * view's text differs from what it last read, and the text a held load
   * was handed is not always that (FineNotes#246), so echoing it back is
   * not enough: a held load must never write.
   */
  private async writeFile(clear?: boolean): Promise<void> {
    if (this.guard.locked) return;
    const saving = super.save(clear);
    // Obsidian sets `data` to what it writes before its first wait, unless
    // another save is still running: a read of it is this view's own text.
    this.noteOwnText();
    await saving;
    if (clear) return;
    this.noteOwnText();
    // On disk now: what the next change from elsewhere is measured against.
    if (this.loadedPath !== null && this.file?.path === this.loadedPath) this.knownText = this.data;
  }

  /** Obsidian's `data` is a text this view wrote: remember it as its own (FineNotes#273). */
  private noteOwnText(): void {
    if (typeof this.data === "string" && this.data !== "") this.ownTexts.note(this.data);
  }

  /**
   * A background save's result: Obsidian's save writes it, `getViewData`
   * answering with it (Obsidian asks before its first `await`). `behind`:
   * the notebook changed since, so it is marked unsaved again.
   */
  private writePrepared(contents: string, behind: boolean): Promise<void> {
    this.preparedContents = contents;
    let saving: Promise<void>;
    try {
      saving = this.writeFile();
    } finally {
      this.preparedContents = null;
    }
    if (behind) this.saveRequest();
    return saving;
  }

  /** Obsidian read the file (on open, or because it changed on disk). */
  setViewData(data: string, clear: boolean): void {
    const began = performance.now();
    this.loadViewData(data, !clear);
    const kb = Math.round(data.length / 1024);
    this.plugin.startup.timed(`notebook loaded, ${kb} KB`, performance.now() - began);
  }

  /**
   * Load `data`. `reread`: Obsidian read the file again because the vault
   * said it changed, rather than opening it.
   */
  private loadViewData(data: string, reread = false): void {
    const sameFile = this.file !== null && this.file.path === this.loadedPath;
    const again = reread && sameFile && !this.guard.locked;
    // A text this view loaded or wrote itself: nothing new is on disk, so the
    // notebook, and its undo history, stay as they are (FineNotes#273).
    if (again && this.ownTexts.has(data)) {
      this.diskReloads.own++;
      // An older one, perhaps put back by a sync: the file gets this view's again.
      this.saveRequest();
      return;
    }
    // An empty file, read while something writes it whole (a copy, some
    // syncs: emptied first, then filled). It holds nothing, and taken as a
    // notebook it would blank this one; the read of the filled file follows.
    // Nothing is saved now, or this view would write over that copy.
    if (again && data.trim() === "") {
      this.diskReloads.empty++;
      return;
    }
    // The same file read again (changed on disk): stay on the tab shown.
    const stayOn = sameFile ? this.activeTab : NOTES_TAB;
    // What this view has, saved or not, to carry onto the file as it is now.
    const mine = again ? this.sinceKnown() : null;
    const { body, doc, payload, json } = parseInkFile(data, this.settings.paperWidth);
    // Kept as one file per page per device: its pages come from their files.
    // Without an id in its label its folder is unknown: held, as ink that will not load.
    const pageFolder =
      payload !== undefined && isDevicePagesPayload(payload)
        ? this.devicePagesFolder(payload)
        : null;
    if (this.file) rememberNotebookId(this.file.path, payload ? notebookIdOf(payload) : null);
    // What this view has not written yet goes to its page files before they are read again.
    const previousPages = this.devicePages;
    if (previousPages && sameFile && !this.guard.locked) {
      void this.saveDevicePages(previousPages, true);
    }
    const held = this.guard.admit({
      text: data,
      bytesOnDisk: this.file?.stat.size ?? 0,
      decoded: doc !== null || pageFolder !== null,
    });
    // A one-file notebook moves to page files at its first save (#274). What it
    // holds as read is taken now, before anything changes it (a merge, a relink,
    // an edit): the first save then only relabels the file and writes what
    // changed since, at no cost the pen could feel.
    let moveFrom: NonNullable<typeof this.pendingMove> | null = null;
    if (!pageFolder && doc && !held && payload !== undefined && !doc.practice) {
      const clock = new DotClock(deviceIdOf(this.app));
      clock.raise(idsIn(doc));
      moveFrom = {
        payload,
        clock,
        writer: DevicePagesWriter.fresh(clock.device, clock, doc),
      };
    }
    if (held) {
      const newer = payload !== undefined && needsNewerReader(payload);
      // Shown once when a load is held (see load-guard.ts); the second text is
      // for a notebook a newer FineNotes wrote with something this one cannot keep.
      new Notice(newer ? t("view.notice.newerFormat") : t("view.notice.heldLoad"), 10000);
    }
    this.noteBody = body;
    this.doc = doc ?? this.blankNotebook();
    if (!sameFile || held) this.ownTexts.forget();
    this.knownText = held ? null : data;
    if (!held) this.ownTexts.note(data);
    let merged = false;
    if (again && !held && doc) {
      const result = mine ? mergeReload(mine.base, mine.doc, doc) : null;
      // Kept as the file is when the merge adds nothing to it.
      const adds = result !== null && JSON.stringify(result.doc) !== JSON.stringify(doc);
      if (mine && result && (mine.unsaved || adds)) {
        this.doc = result.doc;
        // The note's own text: this view's, unless it changed over there.
        if (body === mine.baseBody) this.noteBody = mine.body;
        this.diskReloads.merged++;
        this.diskReloads.carried += result.carried;
        merged = true;
      } else {
        // Nothing here the file lacks: the file as it is.
        this.diskReloads.replaced++;
      }
    }
    this.devicePages = null;
    this.devicePagesRead++;
    if (doc && payload !== undefined && !held) this.encoder.remember(payload, json);
    // Files it points at that moved while it was closed (#14), and notes
    // its links lead to that Obsidian renamed in the links list.
    if (doc && !held && this.relinkDoc() + this.adoptRenamedLinks(body) > 0) this.requestSave();
    // Ticks made in the note (the Tasks plugin) since the notebook wrote it.
    if (doc && !held) this.adoptTicks(body);
    this.handOverWaitingPages(this.loadedPath, this.file?.path ?? null);
    // What this view carried over is not on disk yet.
    if (merged) this.requestSave();
    this.loadedPath = this.file?.path ?? null;
    this.pendingMove = moveFrom;
    if (moveFrom) {
      // New ids from now on are this device's dots (a merge may have brought more ids).
      moveFrom.clock.raise(idsIn(this.doc));
      attachDotClock(this.doc, moveFrom.clock);
    }
    if (pageFolder && !held && payload !== undefined && this.loadedPath !== null) {
      this.devicePages = new DevicePagesSession(
        this.app,
        this.loadedPath,
        payload,
        pageFolder,
        deviceIdOf(this.app),
        previousPages,
      );
      void this.readDevicePages();
    }
    this.textPanel?.load(this.noteBody);
    this.companion.loaded(again);
    if (!this.mounted) return;
    this.showDocument();
    this.matchPdfResolution();
    // A recording still running here means the file changed underneath
    // it: it stops, and joins the document now shown.
    this.audio?.documentReplaced();
    // The page to open on waits for the pages, while they are being read.
    if (!pageFolder) this.applyPendingPage();
    if (stayOn !== NOTES_TAB && this.offersPdfTab(stayOn)) this.showTab(stayOn);
    // Another notebook, or this one changed on disk: read what is unread.
    this.deviceRead.clear();
    this.scheduleDeviceReading(DEVICE_READ_OPEN_MS);
    window.clearTimeout(this.pdfIndexTimer);
    this.pdfIndexTimer = window.setTimeout(() => void this.indexPdfText(), PDF_INDEX_DELAY_MS);
  }

  /** The page folder of a notebook kept as one file per page per device, or `null` without an id. */
  private devicePagesFolder(payload: string): string | null {
    const id = notebookIdOf(payload);
    const path = this.file?.path;
    return id !== null && path ? devicePagesFolderOf(path, id) : null;
  }

  /**
   * Show a notebook kept as one file per page per device (FineNotes#274)
   * from its files. When every file is in (nothing still syncing) it can be
   * written from here on; otherwise it is shown as it is, takes no edits and
   * writes nothing, and is read again as its files arrive.
   */
  private async readDevicePages(): Promise<void> {
    const shown = this.devicePages;
    if (!shown) return;
    const read = ++this.devicePagesRead;
    const texts = await shown.readFiles();
    if (read !== this.devicePagesRead || this.devicePages !== shown) return;
    if (this.file?.path !== shown.path) return;
    let load: DevicePagesLoad;
    try {
      load = shown.load(texts, this.settings.paperWidth);
    } catch {
      // The notebook file's own payload is cut short: not one this view can write.
      this.devicePages = null;
      new Notice(t("view.notice.heldLoad"), 10000);
      return;
    }
    this.doc = load.doc;
    if (load.newer.length > 0) {
      if (this.devicePagesNoticed !== shown.path) new Notice(t("view.notice.newerFormat"), 10000);
      this.devicePagesNoticed = shown.path;
    } else if (load.syncing) {
      if (this.devicePagesNoticed !== shown.path) {
        new Notice(t("view.notice.devicePagesSyncing"), 10000);
      }
      this.devicePagesNoticed = shown.path;
    } else {
      this.devicePagesNoticed = null;
      // Files it points at that moved while it was closed (#14).
      if (this.relinkDoc() > 0) this.requestSave();
      // Pages from other devices: the companion PDF may be behind them.
      this.companion.changed();
    }
    if (!this.mounted) return;
    this.showDocument();
    this.matchPdfResolution();
    this.applyPendingPage();
  }

  /**
   * Write this device's page files for what changed: the pages the changes
   * named, or every page when one did not say, or with `all` (the note is
   * closing: a last look at everything).
   */
  private saveDevicePages(pages: DevicePagesSession, all = false): Promise<void> {
    const changed = all ? null : this.changedPages;
    // Decided now, at the call: what changes next is counted for the next save.
    const saving = pages.save(this.doc, changed);
    this.changedPages = new Set();
    return saving;
  }

  /** Whether the notebook is kept as page files that are still syncing: then it takes no edits. */
  private devicePagesSyncing(): boolean {
    // (A view made without its fields, as some tests make one, has none.)
    return !!this.devicePages && this.devicePages.writer === null;
  }

  /**
   * Move this single-file notebook to one file per page per device, at its
   * first save: the notebook as it is becomes the legacy payload, written
   * once; from then on a save writes only this device's changed pages. Not
   * for a practice sheet (read as training data) or a load that is held.
   */
  private moveToDevicePages(): void {
    const path = this.file?.path;
    if (this.devicePages || this.guard.locked || !path || path !== this.loadedPath) return;
    if (this.doc.practice) return;
    // From the file as read: its payload relabelled, an id from its path and payload,
    // so two devices moving it at once make the same file. What changed since goes
    // to this device's page files.
    const move = this.pendingMove;
    const moved = move ? movedNotebook(path, move.payload) : null;
    let session: DevicePagesSession;
    if (move && moved) {
      session = new DevicePagesSession(
        this.app,
        path,
        moved.payload,
        devicePagesFolderOf(path, moved.id),
        move.clock.device,
        null,
        move.clock,
      );
      session.startWith(move.writer, this.doc);
    } else {
      // Nothing read to move with (a note without ink yet): the notebook as it is.
      const id = randomId();
      session = new DevicePagesSession(
        this.app,
        path,
        legacyPayload(this.doc, id),
        devicePagesFolderOf(path, id),
        deviceIdOf(this.app),
      );
      session.startFresh(this.doc, this.doc);
    }
    this.pendingMove = null;
    this.devicePages = session;
    this.textPanel?.load(this.noteBody);
  }

  /**
   * A file changed: another device's file of the notebook shown is read
   * again, once the sync settles and the pen is up, after this view's own
   * changes are written. This device's own files are only ever its writes.
   */
  private devicePageChanged(path: string): void {
    const shown = this.devicePages;
    if (!shown || !path.startsWith(`${shown.folder}/`)) return;
    const name = path.slice(shown.folder.length + 1);
    if (!readDeviceFileName(name) || shown.isOwn(name)) return;
    window.clearTimeout(this.devicePagesTimer);
    const reread = (): void => {
      this.devicePagesTimer = 0;
      if (this.devicePages !== shown || this.file?.path !== shown.path) return;
      // Never under a pen that is writing: a little later.
      if (this.penIsDown) {
        this.devicePagesTimer = window.setTimeout(reread, DEVICE_PAGES_SETTLE_MS);
        return;
      }
      void this.saveDevicePages(shown).then(() => this.readDevicePages());
    };
    this.devicePagesTimer = window.setTimeout(reread, DEVICE_PAGES_SETTLE_MS);
  }

  /**
   * This view's notebook and note as stored, with the text it last loaded or
   * wrote, when they differ from it: what it has not saved yet. `null` when
   * nothing is unsaved, or nothing is known to measure it against.
   */
  private sinceKnown(): {
    base: InkDocument;
    baseBody: string;
    doc: InkDocument;
    body: string;
    /** Whether anything differs from the known text: not saved yet. */
    unsaved: boolean;
  } | null {
    const known = this.knownText;
    if (known === null) return null;
    const text = this.getViewData();
    const width = this.settings.paperWidth;
    const base = parseInkFile(known, width);
    if (!base.doc) return null;
    if (text === known) {
      // Nothing unsaved, but what this view saved still counts: an older copy
      // of the file must not take it away (mergeReload).
      return {
        base: base.doc,
        baseBody: base.body,
        doc: base.doc,
        body: base.body,
        unsaved: false,
      };
    }
    const local = parseInkFile(text, width);
    if (!local.doc) return null;
    return { base: base.doc, baseBody: base.body, doc: local.doc, body: local.body, unsaved: true };
  }

  /**
   * Relink this note's paths from the plugin's log of moved files, or, for a
   * note that came in from outside with its files, relative to the note
   * itself; how many changed.
   */
  private relinkDoc(): number {
    if (this.guard.locked) return 0;
    const notePath = this.file?.path;
    if (!notePath) return 0;
    const log = this.plugin.fileMoves.log();
    const exists = (path: string): boolean => this.app.vault.getAbstractFileByPath(path) !== null;
    const relinked = relinkDocument(
      this.doc,
      (path) =>
        (log.length > 0 ? this.plugin.fileMoves.relink(path, log) : undefined) ??
        nearbyTarget(notePath, exists, path),
      (path) =>
        (log.length > 0 ? this.plugin.fileMoves.relinkFolder(path, log) : undefined) ??
        nearbyTarget(notePath, exists, path),
    );
    // Paths rewritten in place, on any page: nothing else can tell the save cache.
    if (relinked > 0) this.encoder.touchAll();
    return relinked;
  }

  /**
   * Take the targets Obsidian rewrote in the note's links list (a note or
   * heading renamed, with its links updated) into the notebook itself, so a
   * tap still opens them and the next save keeps them; how many changed.
   */
  private adoptRenamedLinks(body: string): number {
    if (this.guard.locked) return 0;
    const renames = renamedLinkTargets(readTextSection(body), linkTargets(this.doc));
    const renamed = renameLinkTargets(this.doc, renames);
    // Targets rewritten in place, on any page: nothing else can tell the save cache.
    if (renamed > 0) this.encoder.touchAll();
    return renamed;
  }

  /**
   * Take ticks made in the note's checklist since the notebook wrote it (by
   * the Tasks plugin, or by hand) into the notebook, and save them in.
   */
  private adoptTicks(body: string): void {
    if (this.guard.locked) return;
    const pages = adoptTaskStates(this.doc, body);
    if (pages.length > 0) this.requestSaveOf(pages);
  }

  /**
   * Files this note points at were moved or renamed (#14): point at their
   * new places, repaint, and save. Also after undo and redo, which can bring
   * back a page background or picture recorded before the move.
   */
  relinkMovedFiles(): void {
    if (this.relinkDoc() === 0) return;
    this.followTabPaths();
    this.syncPdfTabs();
    this.sidebar?.setDocument(this.surface?.document ?? this.doc);
    this.sidebar?.invalidate();
    this.surface?.repaint();
    this.audio?.syncChrome();
    this.requestSave();
  }

  /** Hand the current notebook to everything that shows it. */
  private showDocument(): void {
    // A new document: back on its notes, every tab's session let go.
    this.dropPdfTabs();
    this.surface?.setDocument(this.doc);
    this.notesSession = this.surface?.activeSession ?? null;
    this.sidebar?.setDocument(this.doc);
    this.syncSingle();
    this.syncPdfTabs();
    // Fonts fetched for this vault that the notebook's boxes need, from the vault.
    void vaultFonts(this.app)
      .use(familiesIn(this.doc.pages))
      .catch(() => undefined);
  }

  /**
   * The leaf moves on to another file. A held load stays held until that
   * file's data arrives: `setViewData` is the only thing that judges a read.
   */
  clear(): void {
    // The page this file was left on, before its document goes.
    this.recordLastPage();
    this.restoredPath = null;
    this.loadedPath = null;
    this.knownText = null;
    this.ownTexts.forget();
    this.devicePages = null;
    this.devicePagesRead++;
    // The worker holds this notebook's pages: let it go with them.
    this.saver.stop();
    this.noteBody = "";
    this.doc = this.blankNotebook();
    if (!this.mounted) return;
    this.showDocument();
    this.audio?.documentReplaced();
  }

  // --- Opening and closing ---------------------------------------------------

  override async onOpen(): Promise<void> {
    this.buildDom();
    this.mounted = true;
    // A font fetched or read from the vault: boxes set in it wrap anew.
    this.register(
      vaultFonts(this.app).onLoad(() => {
        this.surface?.fontsLoaded();
        this.sidebar?.invalidate();
      }),
    );
    // The file loaded before the view opened: put it on its page now.
    if (this.loadedPath !== null) this.applyPendingPage();
    void this.plugin.maybeShowScribbleNotice();
  }

  /**
   * Before the note goes (the tab closes, or opens another file), finish a
   * running recording so it joins *this* note, and save that.
   */
  override async onUnloadFile(file: TFile): Promise<void> {
    // Leaving the scratch page any other way ends the try without going back.
    this.tryHint?.destroy();
    this.tryHint = null;
    // The conversation was about this notebook's pages.
    this.chatPanel?.close();
    this.askWindow?.close();
    this.askSession = null;
    if (await this.audio?.finishForUnload()) {
      this.encoder.touchAll();
      await this.saveNow(false, true);
    }
    // Where the PDF's tab was left goes into this save.
    this.saveTabView();
    await this.companion.close(file);
    await super.onUnloadFile(file);
  }

  /**
   * Obsidian's save, put off while the pen is writing, and then made in the
   * background (background-save.ts): a stall mid-stroke is ink lost on
   * iPadOS before 18.2 (write-hold.ts). `clear` (the note is closing;
   * Obsidian then clears the view) never waits, and is made on the main
   * thread at once, as it always was. A save put off is made once the pen
   * has been up a moment.
   */
  override async save(clear?: boolean): Promise<void> {
    if (!clear && this.writeHold.holdSave(performance.now())) {
      // Obsidian's timer can fire after the pen's quiet timer has run: look again then.
      if (!this.quietTimer) {
        const wait = this.writeHold.saveQuietIn(performance.now());
        this.quietTimer = window.setTimeout(() => this.penQuiet(), wait);
      }
      return;
    }
    await this.saveNow(clear);
  }

  /**
   * Save at once, whatever the pen is doing: in the background, unless the
   * note is closing (`clear`) or `now` says it must be on disk before this
   * returns. A save made now drops any background save still running, whose
   * result would be older.
   */
  private async saveNow(clear?: boolean, now = false): Promise<void> {
    this.writeHold.saved();
    // One file per page per device (#274): a notebook moves there at its first save.
    this.moveToDevicePages();
    const pages = this.devicePages;
    if (pages) {
      // Only this device's changed pages and its meta: small, so on this thread.
      this.saver.supersede();
      if (!this.guard.locked) await this.saveDevicePages(pages, clear === true);
      await this.writeFile(clear);
      return;
    }
    if (clear || now) {
      this.saver.supersede();
      await this.writeFile(clear);
      return;
    }
    await this.saver.save();
  }

  /**
   * "Hide pen options while writing", until the pen lifts: once the pen
   * has rested {@link PEN_OPTIONS_RETURN_MS}, the options a stroke tucked
   * away come back; the next pen-down keeps them away.
   */
  private returnPenOptions(down: boolean): void {
    window.clearTimeout(this.optionsReturnTimer);
    this.optionsReturnTimer = 0;
    if (down || !returnsAfterLift(this.settings.tuckPenOptionsOnWrite)) return;
    this.optionsReturnTimer = window.setTimeout(() => {
      this.optionsReturnTimer = 0;
      this.toolbar?.showTuckedOptions();
    }, PEN_OPTIONS_RETURN_MS);
  }

  /**
   * The page in view changed (or the notebook opened): its PDF text, and the
   * neighbouring pages', are read now, so scanned pages are read by OCR in
   * the right order (page in view, neighbours, then the rest while idle).
   */
  private focusPdfText(index: number): void {
    const cache = this.pdfText;
    const pages = this.surface?.document.pages;
    if (!cache || !pages) return;
    const backdrops = [index, index + 1, index - 1].flatMap((i) => {
      const backdrop = pages[i]?.backdrop;
      return backdrop?.kind === "pdf" ? [backdrop] : [];
    });
    const [here, ...near] = backdrops;
    if (here && pages[index]?.backdrop === here) cache.focus(here, near);
    else if (here) near.forEach((b) => cache.request(b));
  }

  /** "Re-read scanned pages of this PDF": forget what OCR read of the PDF in view and read it again. */
  async rereadScannedPages(): Promise<void> {
    const pages = this.surface?.document.pages ?? this.doc.pages;
    const index = this.surface?.currentPage ?? 0;
    const here = pages[index]?.backdrop;
    const found =
      here?.kind === "pdf" ? here : pages.map((p) => p.backdrop).find((b) => b.kind === "pdf");
    if (found?.kind !== "pdf") {
      new Notice(t("view.ocr.noPdfPages"));
      return;
    }
    if (!this.plugin.settings.ocrScannedPdfs) {
      new Notice(t("view.ocr.off"));
      return;
    }
    await this.plugin.ocr.dropCache(found.path);
    this.pdfText?.forget(found.path);
    for (const key of [...this.pdfSearchText.keys()]) {
      if (key.startsWith(`${found.path}:`)) this.pdfSearchText.delete(key);
    }
    this.focusPdfText(index);
    new Notice(t("view.ocr.rereading"));
  }

  /** The pen touched the page or left it: hold, or let go of, what would stall it. */
  private penActivity(down: boolean): void {
    this.penIsDown = down;
    window.clearTimeout(this.quietTimer);
    this.quietTimer = 0;
    const t = performance.now();
    if (down) {
      this.calcNotes.penDown();
      this.columnNotes.penDown();
      this.writeHold.penDown(t);
      this.pdfCache?.setHeld(true);
      this.pdfText?.setHeld(true);
      // Should the lift never arrive, let go anyway.
      this.quietTimer = window.setTimeout(() => this.penQuiet(), this.writeHold.quietIn(t));
      return;
    }
    this.writeHold.penUp(t);
    // Waited too long: made now, in the gap between two strokes.
    if (this.writeHold.overdue(t)) void this.saveNow();
    this.quietTimer = window.setTimeout(() => this.penQuiet(), this.writeHold.quietIn(t));
  }

  /**
   * The pen has been up a moment: rasterise what waited, and make the save
   * that did once the pen has rested a little longer (write-hold.ts).
   */
  private penQuiet(): void {
    this.quietTimer = 0;
    this.pdfCache?.setHeld(false);
    this.pdfText?.setHeld(false);
    if (!this.writeHold.savePending) return;
    const wait = this.writeHold.saveQuietIn(performance.now());
    if (wait > 0) this.quietTimer = window.setTimeout(() => this.penQuiet(), wait);
    else void this.saveNow();
  }

  /**
   * A pen menu changed a setting held for every pen: the surface reads
   * "Make shapes" and its curve bar from the tool state, the rest it asks
   * for live.
   */
  syncPenPreferences(): void {
    this.toolState.snapMode = snapModeOf(this.settings);
    this.toolState.snapCurvatureThreshold = snapCurveOf(this.settings.snapCurvatureThreshold);
    // A pen gesture switched from a tip or a search result (feature-index.ts).
    this.toolState.penGestures = penGesturesOf(this.settings.penGestures);
  }

  // --- Try it (try-hint.ts) ---------------------------------------------------

  /** The tip being tried on this scratch page, while it is. */
  private tryHint: TryHint | null = null;

  /** Show a tip's picture over this scratch page until its gesture is done or it is closed. */
  startTry(feature: Feature, onEnd: () => void): void {
    this.tryHint?.destroy();
    const host = this.surface?.surfaceEl ?? this.contentEl;
    this.tryHint = new TryHint(host, feature, () => {
      this.tryHint = null;
      onEnd();
    });
  }

  /** Full screen went on or off (the plugin's, for every notebook): the bar's button follows. */
  showFullScreen(on: boolean): void {
    this.toolbar?.setFullScreen(on);
  }

  /** The options pill was moved in some notebook (the plugin's, per device): this one's follows. */
  showPillDock(dock: PillDock): void {
    this.toolbar?.setPillDock(dock);
  }

  /** The tool bar's place changed in settings (the plugin's, per device): this notebook's follows. */
  showBarDock(dock: BarDock): void {
    this.toolbar?.setBarDock(dock);
  }

  /** "Dock tool options" was switched (the plugin's, per device): this notebook's pill follows. */
  showPillRow(on: boolean): void {
    this.toolbar?.setPillRow(on);
  }

  /** The bar's preset changed (Customize toolbar, here or in another notebook): show its layout. */
  showToolbarPreset(preset: BarPreset, layout: ToolbarLayout): void {
    this.toolbar?.setPreset(preset);
    this.setToolbarItems(layout);
  }

  /**
   * Stylus-only mode was switched here or through the toolbar: its toggle
   * follows in this notebook. The hand and magnifier are ordinary toolbar
   * items now, so the choice of placing them does not change with the mode.
   */
  setOnlyStylusMode(on: boolean): void {
    this.toolbar?.setOnlyStylusMode(on && this.plugin.stylusOnly);
    this.surface?.onlyStylusChanged();
  }

  /**
   * Fingers started or stopped drawing (`input/finger-draw.ts`): the ⋯
   * button is lit while they do, and Stylus only rests meanwhile.
   */
  setFingerDrawing(on: boolean): void {
    this.toolbar?.setFingerDrawing(on);
    this.toolbar?.setOnlyStylusMode(this.plugin.stylusOnly);
    this.surface?.onlyStylusChanged();
  }

  override async onClose(): Promise<void> {
    // onUnloadFile is not reached when the tab closes: its companion is queued here.
    if (this.file) await this.companion.close(this.file);
    this.presenter?.stop();
    window.clearTimeout(this.tabViewTimer);
    this.tabViewTimer = 0;
    window.clearTimeout(this.snippetTimer);
    this.snippetTimer = 0;
    this.snippet = null;
    this.pdfTabsPopover?.close();
    this.pdfTabsPopover = null;
    this.pdfTabs?.destroy();
    this.pdfTabs = null;
    this.tabSessions.clear();
    this.notesSession = null;
    this.activeTab = NOTES_TAB;
    window.clearTimeout(this.sheetInviteTimer);
    this.recordLastPage();
    this.audio?.destroy();
    this.audio = null;
    window.clearTimeout(this.transcribeTimer);
    // Pages written on and not read yet are read when the notebook opens again.
    if (this.loadedPath) this.plugin.keepWaitingPages(this.loadedPath, [...this.autoPages]);
    this.autoPages.clear();
    window.clearTimeout(this.deviceTimer);
    this.deviceTimer = 0;
    window.clearTimeout(this.pdfIndexTimer);
    this.pdfIndexTimer = 0;
    window.clearTimeout(this.wordCheckTimer);
    this.wordCheckTimer = 0;
    this.wordPopover?.close();
    this.wordPopover = null;
    window.clearTimeout(this.quietTimer);
    this.quietTimer = 0;
    window.clearTimeout(this.devicePagesTimer);
    this.devicePagesTimer = 0;
    window.clearTimeout(this.optionsReturnTimer);
    this.optionsReturnTimer = 0;
    this.saver.stop();
    this.calcNotes.dispose();
    this.columnNotes.dispose();
    this.surface?.destroy();
    this.surface = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.unwatchUpdates?.();
    this.unwatchUpdates = null;
    this.sidebar?.destroy();
    this.chatPanel?.destroy();
    this.chatPanel = null;
    this.askWindow?.close();
    this.askWindow = null;
    this.searchPanel?.destroy();
    this.searchPanel = null;
    this.sidebar = null;
    this.morePanel?.close();
    this.morePanel = null;
    this.shortcuts?.close();
    this.shortcuts = null;
    this.addPagePopover?.popover.close();
    this.addPagePopover = null;
    this.coverPopover?.popover.close();
    this.coverPopover = null;
    this.marginPopover?.close();
    this.marginPopover = null;
    this.imageMenu?.popover.close();
    this.imageMenu = null;
    this.aiMenu?.close();
    this.aiMenu = null;
    this.calculator?.close();
    this.calculator = null;
    this.translateWindow?.close();
    this.translateWindow = null;
    this.graphWindow?.close();
    this.graphWindow = null;
    this.equationEditor?.close();
    this.equationEditor = null;
    if (this.transcription) this.transcription.cancelled = true;
    this.pdfCache?.destroy();
    this.pdfCache = null;
    this.pdfText?.destroy();
    this.pdfText = null;
    if (this.pdfWorkerHeld) {
      this.pdfWorkerHeld = false;
      this.pdfWorker = null;
      releasePdfWorker();
    }
    this.backdrops = null;
    this.thumbBackdrops = null;
    this.images?.destroy();
    this.images = null;
    this.textPanel = null;
    this.contentEl.empty();
    this.mounted = false;
  }

  override onResize(): void {
    this.relayout();
  }

  /**
   * Lay the pages out again for the view's size, and put the options pill
   * back inside the page area: it is placed as a fraction of that area, so
   * a resize, an iPad rotation or a theme's different metrics could leave
   * it off-screen.
   */
  private relayout(): void {
    this.surface?.layout();
    this.syncSidebarInset();
  }

  /** Fit the page to the view and go back to the top (the "fit" command). */
  resetView(): void {
    this.surface?.resetView();
  }

  zoomIn(): void {
    this.surface?.zoomIn();
  }

  zoomOut(): void {
    this.surface?.zoomOut();
  }

  /** Show or hide the input debug overlay (the command, and the setting). */
  setDebug(enabled: boolean): void {
    this.showHud = enabled;
    this.surface?.setDebug(enabled);
  }

  /**
   * The cursor over the page for the pens: the ink dot (FineNotes#27), the
   * small crosshair (FineNotes#25) or the arrow. Only on a computer: a
   * finger or the Pencil has no cursor to replace.
   */
  /** Show the tool bar's buttons in their places (Customize toolbar, here or in another notebook). */
  setToolbarItems(layout: ToolbarLayout): void {
    const toolbar = this.toolbar;
    // The bar being customized already shows it: it is where the change came from.
    if (toolbar && !(toolbar.customizing && sameLayout(toolbar.layout, layout))) {
      toolbar.setLayout(layout);
    }
    this.endOffItemEffects(normalizeLayout(layout));
  }

  /** The saved pens changed: the pens on the bar as buttons of their own follow (FineNotes#211). */
  refreshSavedPens(): void {
    this.toolbar?.refreshSavedPens();
  }

  /** The tool bar's layout as the settings hold it. */
  setNewsDot(on: boolean, controls: readonly string[] = this.plugin.newsControlIds()): void {
    this.toolbar?.setHomeDot(on);
    this.toolbar?.setNewsItems(controls, (id) => this.plugin.markNewsControlUsed(id));
  }

  private toolbarLayout(): ToolbarLayout {
    return layoutInUse(
      this.settings.toolbarLayout,
      this.settings.toolbarEssentials,
      this.settings.toolbarPreset,
      this.plugin.pillRow === true,
    );
  }

  /** Open Customize toolbar on this notebook's bar (the command; the More tools menu opens it too). */
  customizeToolbar(): void {
    this.toolbar?.startCustomize();
  }

  /** Whether `item` is shown nowhere: its effect may not be turned on (`isItemOff`). */
  private itemOff(item: BarItemId): boolean {
    return isItemOff(this.toolbarLayout(), item);
  }

  /**
   * An item shown nowhere leaves nothing on (Joost, 2026-10-30): its tool in
   * hand gives way to the pen, the ruler goes away, a recording stops and is
   * saved, a sticky note waiting to be placed is dropped (`effectsOfOffItems`).
   * Stylus-only mode is the plugin's, ended there for every notebook.
   */
  private endOffItemEffects(layout = this.toolbarLayout()): void {
    const surface = this.surface;
    if (!surface) return;
    const end = effectsOfOffItems(layout, {
      tool: this.toolState.tool,
      onlyStylus: false,
      rulerOut: surface.rulerOut,
      recording: this.audio?.isRecording === true,
      stickyArmed: surface.stickyArmed,
    });
    if (end.pen) {
      surface.setTool("pen");
      this.toolbar?.setState(this.toolState);
    }
    if (end.ruler) {
      surface.setRulerOut(false);
      this.toolbar?.setRulerOut(false);
    }
    if (end.recording) this.audio?.toggleRecording();
    if (end.sticky) this.armStickyNote(null);
  }

  /**
   * A sticky note of `color` waits for a tap on a page, which sticks it
   * there (null: it waits no more). The sticky notes button is on meanwhile.
   */
  private armStickyNote(color: string | null): void {
    const surface = this.surface;
    if (!surface || (color !== null && (this.isProtected() || this.refuseOnPdfTab()))) return;
    surface.armStickyNote(
      color === null
        ? null
        : (index, at) => {
            this.toolbar?.setStickyArmed(false);
            this.insertStickyNote(color, index, at);
          },
    );
    this.toolbar?.setStickyArmed(color !== null);
  }

  setPenCursor(style: unknown): void {
    this.surface?.setPenCursor(Platform.isMobile ? "arrow" : penCursorStyleOf(style));
  }

  /** Keep the pen in hand for the next notebook, and the next start (FineNotes#24). */
  private rememberPen(): void {
    const tool = this.toolState.tool;
    if (tool !== "pen" && tool !== "highlighter") return;
    this.plugin.saveLastPen(penOfState(this.toolState));
  }

  /** The highlighter's opacity changed in some notebook's pen menu: redraw the highlights. */
  setHighlighterAlpha(): void {
    this.surface?.setHighlighterAlpha(this.settings.highlighterAlpha);
    this.updateSidebarRendering();
  }

  /** "Free page edges" changed. */
  setFreePageEdges(on: boolean): void {
    this.surface?.setFreePageEdges(on);
  }

  /** "Lock fit to width" changed: the surface reads it at once. */
  setHoldFitWidth(): void {
    this.surface?.refreshScrollExtent();
  }

  /** The pressure setting changed: the pen in hand widens with pressure if it is a pressure pen. */
  setPressureWidth(enabled: boolean): void {
    this.surface?.setPressure(enabled && penTypeFor(this.toolState).pressure);
    this.surface?.setInkPressure(enabled);
    this.updateSidebarRendering();
  }

  /** The paper theme the pages are shown in (`shownPaperTheme`). */
  private shownPaper(): PaperTheme {
    return shownPaperTheme(this.settings, this.containerEl.doc.body.hasClass("theme-dark"));
  }

  /** The dark pages settings or Obsidian's theme changed: show the pages as they now say. */
  syncPaperTheme(): void {
    const surface = this.surface;
    if (!surface) return;
    const theme = this.shownPaper();
    if (surface.paperTheme === theme) return;
    surface.setPaperTheme(theme);
    this.toolbar?.setNight(theme.night === true);
    this.updateSidebarRendering();
  }

  /** The recent strokes and the recogniser's verdicts on them, as JSON, for bug reports. */
  exportDiagnostics(): string | null {
    return (
      this.surface?.exportDiagnostics({
        version: this.plugin.manifest.version,
        file: this.file?.path ?? null,
        // A lag after a cold start, pinned without a console (startup-log.ts).
        startup: this.plugin.startup.report(),
        // The file read again while open, and what became of this view's ink (#273).
        diskReloads: { ...this.diskReloads },
      }) ?? null
    );
  }

  /**
   * `RecognitionTarget`, for the transcribe command and for automatic
   * transcription. The command does the whole notebook; an automatic run
   * only the page in view, so that a background pass can never send a
   * request for every page of a long notebook.
   */
  async recognize(engine: RecognitionProvider, background = false): Promise<void> {
    if (!background) {
      await this.transcribe(engine, "notebook");
      return;
    }
    // Another run is going (the command, or a slow automatic one): the pages
    // stay waiting for the next quiet moment rather than being dropped.
    if (this.transcription) {
      this.scheduleAutoTranscription();
      return;
    }
    // A failure a moment ago (a spent quota, no connection): wait it out.
    const wait = this.plugin.autoTranscriptionWait();
    if (wait > 0) {
      this.scheduleAutoTranscription(undefined, wait);
      return;
    }
    const { now, later } = autoTranscriptionBatch(
      this.autoPages,
      this.doc.pages.map((page) => page.id),
    );
    this.autoPages = new Set(later);
    const pages = this.doc.pages.filter((page) => now.includes(page.id));
    if (pages.length > 0) await this.transcribe(engine, pages, true);
    // A page that failed, or was written on while it was read, waits for the next run.
    const recorded = transcriptHashes(readTextSection(this.noteBody));
    const keys = pageKeys(this.doc.pages);
    for (const page of pages) {
      const index = this.doc.pages.indexOf(page);
      if (index < 0 || !hasTranscribableContent(page) || this.guard.locked) continue;
      if (recorded.get(keys[index]) !== pageContentHash(page)) this.autoPages.add(page.id);
    }
    if (this.autoPages.size > 0) {
      this.scheduleAutoTranscription(
        undefined,
        Math.max(AUTO_RECOGNIZE_IDLE_MS, this.plugin.autoTranscriptionWait()),
      );
    }
  }

  /**
   * Transcribe pages into the text layer, one request per page, in order.
   *
   * Each page's text goes under its own `### Page N` heading inside the
   * managed `<!--goodobsidian-text-->` section and nowhere else, so user prose
   * is never touched (page-transcripts.ts). A page whose content hash matches
   * the one recorded with its transcription is skipped — a repeat costs no
   * request and cannot churn text the user corrected. A page that is now
   * empty loses its entry. Every finished page is written straight away, so
   * stopping (tap the progress notice) or a failure keeps what was done.
   * `auto` mutes everything but failures.
   */
  async transcribe(
    provider: RecognitionProvider,
    scope: "page" | "notebook" | readonly Page[],
    auto = false,
  ): Promise<void> {
    if (this.guard.locked) {
      if (!auto) new Notice(t("view.notice.readOnly"));
      return;
    }
    if (this.transcription) {
      if (!auto) new Notice(t("view.transcribe.running"));
      return;
    }
    if (provider.id === MANUAL_PROVIDER_ID) {
      // Manual: the page in view is typed by hand (FineNotes#265).
      if (!auto) this.typePageTranscript(this.surface?.currentPage ?? 0);
      return;
    }

    const doc = this.doc;
    const current = doc.pages[this.surface?.currentPage ?? 0];
    const pages =
      scope === "page" ? (current ? [current] : []) : scope === "notebook" ? [...doc.pages] : scope;
    const keys = pageKeys(doc.pages);
    const recorded = transcriptHashes(readTextSection(this.noteBody));
    const cleared: TranscriptUpdate[] = [];
    const work: Page[] = [];
    let unchanged = 0;
    for (const page of pages) {
      const key = keys[doc.pages.indexOf(page)];
      if (!hasTranscribableContent(page)) {
        if (recorded.has(key)) cleared.push({ key, text: "", hash: "" });
        continue;
      }
      // Only a network provider is worth skipping: on-device runs are free.
      if (provider.requiresNetwork && recorded.get(key) === pageContentHash(page)) unchanged++;
      else work.push(page);
    }
    if (cleared.length > 0) this.writeTranscripts(cleared);
    if (work.length === 0) {
      if (!auto) {
        new Notice(
          cleared.length > 0
            ? tn("view.transcribe.cleared", cleared.length)
            : unchanged > 0
              ? t("view.transcribe.upToDate")
              : t("view.transcribe.nothing"),
        );
      }
      return;
    }

    const run = { cancelled: false };
    this.transcription = run;
    const progress = auto ? null : new Notice(t("view.transcribe.progress"), 0);
    progress?.messageEl.addEventListener("click", () => {
      run.cancelled = true;
    });
    let done = 0;
    let failure: { page: number; message: string } | null = null;
    try {
      for (const page of work) {
        if (run.cancelled) break;
        const index = this.doc.pages.indexOf(page);
        if (index < 0) continue; // deleted while the others were transcribed
        progress?.setMessage(
          work.length > 1
            ? t("view.transcribe.progressPageOf", {
                page: index + 1,
                n: done + 1,
                total: work.length,
              })
            : t("view.transcribe.progressPage", { page: index + 1 }),
        );
        const hash = pageContentHash(page);
        try {
          const image = provider.requiresNetwork ? await this.renderForTranscription(page) : null;
          const result = await provider.recognize({
            strokes: page.strokes,
            pageImage: image ?? undefined,
            onProgress: (message) => progress?.setMessage(t("view.notice.plain", { message })),
          });
          // The note was closed meanwhile: there is no body left to write into.
          if (!this.mounted) break;
          // A result that arrives after "stop" is kept: it is already paid for.
          this.writeTranscripts([{ page, text: result.text, hash }]);
          done++;
        } catch (error) {
          failure = {
            page: index + 1,
            message: errorMessage(error),
          };
          break;
        }
      }
    } finally {
      progress?.hide();
      this.transcription = null;
    }

    if (done > 0) this.plugin.transcriptionWorked();
    if (failure) {
      // An automatic run says so once, then waits (`auto-backoff.ts`)
      // rather than failing again after every pause in writing.
      if (auto && !this.plugin.autoTranscriptionFailed()) return;
      const failed = { page: failure.page, message: failure.message };
      const said =
        done > 0
          ? tn("view.transcribe.failedSaved", done, failed)
          : t("view.transcribe.failed", failed);
      new Notice(auto ? `${said} ${t("view.transcribe.autoWaits")}` : said, 10000);
      return;
    }
    if (auto) return;
    // Where to read them: the sidebar's Files tab (FineNotes#265), not a
    // panel opened under the page. A page whose text is the person's keeps
    // it; the new one waits there to be compared.
    const views = pageTranscriptViews(readTextSection(this.noteBody), pageKeys(this.doc.pages));
    const waiting = views.filter(
      (view) => view.pending !== undefined && work.includes(this.doc.pages[view.page]),
    ).length;
    const summary =
      run.cancelled && done < work.length
        ? t("view.transcribe.stopped", { done, total: work.length })
        : waiting > 0
          ? tn("view.transcribe.compare", waiting)
          : tn("view.transcribe.ready", done);
    const notice = new Notice(
      unchanged > 0 ? `${summary} ${tn("view.transcribe.skipped", unchanged)}` : summary,
      8000,
    );
    if (done > 0) {
      notice.messageEl.addEventListener("click", () => this.showTranscriptsInSidebar());
    }
  }

  /** Open the sidebar on its Files tab, listing Transcripts. */
  showTranscriptsInSidebar(): void {
    const sidebar = this.sidebar;
    if (!sidebar) return;
    lastFileKind = "transcripts";
    sidebar.setFileKind("transcripts");
    sidebar.showTab("files");
    if (!sidebar.isOpen) this.toggleSidebar();
    else sidebar.refreshFiles();
  }

  /**
   * Type page `index`'s transcript by hand, starting from what it says now.
   * Saved as the person's: no machine transcription replaces it.
   */
  typePageTranscript(index: number): void {
    const page = this.doc.pages[index];
    if (!page) return;
    if (this.guard.locked) {
      new Notice(t("view.notice.readOnly"));
      return;
    }
    const key = pageKeys(this.doc.pages)[index];
    const now = pageTranscriptViews(readTextSection(this.noteBody), pageKeys(this.doc.pages)).find(
      (view) => view.key === key,
    );
    new TranscriptModal(this.app, index + 1, now?.text ?? "", (text) => {
      const at = this.doc.pages.indexOf(page);
      if (at < 0) return;
      this.writeTranscripts([{ page, text, hash: pageContentHash(page), typed: true }]);
      this.sidebar?.refreshFiles();
    }).open();
  }

  /** The Files tab's actions on a page's transcription. */
  private transcriptAction(key: string, action: TranscriptAction): void {
    const keys = pageKeys(this.doc.pages);
    const index = keys.indexOf(key);
    if (index < 0) return;
    if (action === "go") {
      this.surface?.goToPage(index, true);
      return;
    }
    if (action === "edit") {
      this.typePageTranscript(index);
      return;
    }
    if (this.guard.locked) {
      new Notice(t("view.notice.readOnly"));
      return;
    }
    const section = choosePageTranscript(
      readTextSection(this.noteBody),
      keys,
      key,
      action === "use-new" ? "new" : "mine",
    );
    this.noteBody = writeTextSection(this.noteBody, section);
    this.textPanel?.load(this.noteBody);
    this.requestBodySave();
    this.sidebar?.refreshFiles();
  }

  /**
   * Merge page transcriptions into the managed section, in page order. Accepts
   * either a page (resolved to its key now, as pages may have moved during a
   * long run) or a ready key.
   */
  private writeTranscripts(
    updates: ReadonlyArray<
      | TranscriptUpdate
      | { page: Page; text: string; hash: string; device?: boolean; typed?: boolean }
    >,
  ): void {
    const keys = pageKeys(this.doc.pages);
    const resolved: TranscriptUpdate[] = [];
    for (const update of updates) {
      if (!("page" in update)) {
        resolved.push(update);
        continue;
      }
      const index = this.doc.pages.indexOf(update.page);
      if (index >= 0) {
        const { text, hash, device, typed } = update;
        resolved.push({
          key: keys[index],
          text,
          hash,
          ...(device ? { device } : {}),
          ...(typed ? { typed } : {}),
        });
      }
    }
    const section = updatePageTranscripts(readTextSection(this.noteBody), keys, resolved);
    this.noteBody = writeTextSection(this.noteBody, section);
    this.textPanel?.load(this.noteBody);
    this.requestBodySave();
  }

  /** Canvas used only to measure text boxes that grow with their text. */
  private measureCtx: CanvasRenderingContext2D | null = null;

  /** This notebook's Companion PDF (`companion-session.ts`). */
  readonly companion: CompanionSession;

  private companionSession(): CompanionSession {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the host reads the view live
    const view = this;
    return new CompanionSession(
      {
        app: this.app,
        get file() {
          return view.file;
        },
        get noteBody() {
          return view.noteBody;
        },
        set noteBody(body: string) {
          view.noteBody = body;
        },
        get doc() {
          return view.doc;
        },
        get paperWidth() {
          return view.settings.paperWidth;
        },
        snapshot: () => this.encoder.snapshot(this.doc),
        options: () => this.pdfExportSources(),
        crop: (page) => this.boardDrawing(page),
        exportsFolder: () => this.attachmentFolder("exports"),
        saveNow: () => this.saveNow(false, true),
        saveBody: () => {
          this.requestBodySave();
          return this.saveNow(false, true);
        },
        writable: () => !this.guard.locked && !this.devicePagesSyncing(),
        penDown: () => this.writeHold.writing(performance.now()),
        uses: (path) => companionResources(this.doc).includes(path),
        isLeaf: (leaf) => leaf === this.leaf,
        hidden: () => docOf(this.contentEl).visibilityState === "hidden",
      },
      this.plugin.companionPdfs,
    );
  }

  /** The export dialog's switches, as last left, over `preview`. */
  private pdfExportSources(preview = this.previewSources()): PdfExportSources {
    return {
      ...preview,
      plainPaper: this.settings.exportPlainPaper === true,
      withoutTapes: this.settings.exportWithoutTapes === true,
      margins: exportMarginsOf(this.settings.exportMargins),
    };
  }

  /** A text box's height as the page paints it (`paintedTextHeight`). */
  private textHeight(text: TextBoxElement): number {
    this.measureCtx ??= createEl("canvas").getContext("2d");
    return this.measureCtx ? paintedTextHeight(this.measureCtx, text) : textLinesHeight(text);
  }

  /**
   * A board's page cut down to its drawing (`boardDrawing`), or to `area`;
   * its long text boxes measured, so the cut holds all of their text.
   */
  private boardDrawing(
    page: Page,
    area?: { x: number; y: number; width: number; height: number },
  ): Page {
    return boardDrawing(page, area ?? boardDrawingBox(page, (text) => this.textHeight(text)));
  }

  /**
   * The page as the reader sees it, sized for a vision model. A board's
   * drawing alone, or the part of it in `area` (page px): the whole page
   * would shrink its writing past reading.
   */
  private async renderForAi(
    page: Page,
    area?: { x: number; y: number; width: number; height: number },
  ): Promise<RenderedPage | null> {
    if (!this.backdrops) return null;
    const shown = isBoardPage(this.doc, page) ? this.boardDrawing(page, area) : page;
    return renderPageForAi(shown, this.backdrops, {
      usePressure: this.settings.pressureWidth,
      highlighterAlpha: this.settings.highlighterAlpha,
      // Pictures the page shows are part of what the model should see. One
      // not decoded yet (rare: the page being read is on screen) draws as
      // the missing-image box rather than holding the request up.
      ...(this.images ? { images: this.images } : {}),
    });
  }

  /**
   * The AI menu's "Transcribe this page" and the command of that name: the
   * page in view, now, with the AI (also when the recognition setting says
   * Manual: asking for it is asking for a machine transcription), after the
   * one-time consent. Automatic transcription waits until a page is done;
   * this is for when the text is wanted at once.
   */
  async transcribePageNow(): Promise<void> {
    // No AI to ask: the page is typed by hand instead (FineNotes#265).
    if (!transcriptionAvailability(this.plugin.aiSetup()).enabled) {
      this.typePageTranscript(this.surface?.currentPage ?? 0);
      return;
    }
    const config = this.plugin.transcriptionAiConfig();
    const confirmed = await this.plugin.confirmAiSend(
      config,
      t("notebooks.consent.pagesAction"),
      t("notebooks.consent.pagesWhat"),
    );
    if (!confirmed) return;
    await this.transcribe(this.plugin.aiTranscriber(), "page");
  }

  /**
   * Page `index` came into view. Turning away from a page written on means
   * it is done for now: automatic transcription reads it a moment later
   * (AUTO_RECOGNIZE_LEAVE_MS), not after the long quiet wait.
   */
  private pageShown(index: number): void {
    const left = this.shownPageId;
    this.shownPageId = this.doc.pages[index]?.id ?? null;
    if (left && left !== this.shownPageId && this.autoPages.has(left)) {
      this.scheduleAutoTranscription(undefined, AUTO_RECOGNIZE_LEAVE_MS);
    }
  }

  /**
   * Pages left waiting for automatic transcription follow their notebook:
   * when this view moves from `from` to another file they are kept for
   * `from`, and the ones `to` left waiting when it was closed come back.
   */
  private handOverWaitingPages(from: string | null, to: string | null): void {
    if (from === to) return;
    window.clearTimeout(this.transcribeTimer);
    if (from) this.plugin.keepWaitingPages(from, [...this.autoPages]);
    this.autoPages.clear();
    if (!to) return;
    const waiting = this.plugin.takeWaitingPages(to);
    if (waiting.length === 0) return;
    for (const id of waiting) this.autoPages.add(id);
    this.scheduleAutoTranscription(undefined, AUTO_RECOGNIZE_LEAVE_MS);
  }

  /**
   * {@link renderForAi} for a page transcription: down to the lowest
   * writing only (`transcriptionCropHeight`), at the whole page's scale.
   */
  private async renderForTranscription(page: Page): Promise<RenderedPage | null> {
    if (!this.backdrops || isBoardPage(this.doc, page)) return this.renderForAi(page);
    const keep = transcriptionCropHeight(page, (text) => this.textHeight(text));
    if (keep === null) return this.renderForAi(page);
    const { width, height } = page.geometry;
    const cut = boardDrawing(page, { x: 0, y: 0, width, height: keep });
    return renderPageForAi(
      cut,
      this.backdrops,
      {
        usePressure: this.settings.pressureWidth,
        highlighterAlpha: this.settings.highlighterAlpha,
        ...(this.images ? { images: this.images } : {}),
      },
      { width, height },
    );
  }

  // --- AI menu --------------------------------------------------------------

  /** Open the AI menu on `anchor`; a second tap on the same button closes it. */
  private openAiMenu(anchor: HTMLElement): void {
    // The AI reads and writes the notes.
    this.showTab(NOTES_TAB);
    const open = this.aiMenu;
    this.aiMenu = null;
    if (open?.isOpen) {
      open.close();
      if (open.anchorEl === anchor) return;
    }
    const doc = this.doc;
    const current = doc.pages[this.surface?.currentPage ?? 0];
    const items = buildAiMenu({
      setup: this.plugin.aiSetup(),
      pageTranscribable: !!current && hasTranscribableContent(current),
      notebookAskable: doc.pages.some(hasAskableContent),
      multiPage: doc.pages.length > 1,
      recordings: doc.recordings?.length ?? 0,
      device: this.deviceReading(),
      reading: this.handwritingReading(),
      ...(doc.pages.some((p) => p.backdrop.kind === "pdf")
        ? {
            scan: {
              on: this.settings.ocrScannedPdfs !== false,
              ready: this.plugin.ocrReaderReady(),
            },
          }
        : {}),
      transcribing: this.plugin.speech.running?.percent,
    });
    const setup = this.plugin.aiSetup();
    this.aiMenu = new AiMenuPopover(
      anchor,
      items,
      (id) => this.aiActions()[id]?.(),
      aiKeyFolded(setup),
      (id, on) => {
        if (id === "check-words") void this.plugin.setWordChecking(on);
        if (id === "scan-pdf") void this.plugin.setScanning(on);
        if (id === "calc-notes") {
          this.settings.calcNotes = on;
          void this.plugin.saveSettings();
        }
      },
      (id, value) => {
        if (id !== "reader") return;
        void this.plugin.setHandwritingReader(value).then(() => {
          // Off and on change what the section offers: draw it again in place.
          if (this.aiMenu?.isOpen) {
            this.aiMenu.close();
            this.aiMenu = null;
            this.openAiMenu(anchor);
          }
        });
      },
      this.plugin.beautifyNeatness(),
    );
  }

  /** Which model reads handwriting here, for the AI menu's "Read with". */
  private handwritingReading(): HandwritingReading {
    const ownModel = learnedRecord(this.settings, this.plugin.grape.id) !== undefined;
    return { value: handwritingReaderOf(this.settings, ownModel), ownModel };
  }

  /**
   * Open the calculator's window, or close it when it is open: the toolbar's
   * calculator button (or its row in ⋯) toggles it, and its cross closes it.
   */
  /**
   * The Translate window: with selected text (from a selection's
   * Translate), or empty to type into (the Translate tool). One per
   * notebook; opening it again loads the new text, and the tool closes it.
   */
  private openTranslate(target: TranslateTarget | null): void {
    const open = this.translateWindow?.isOpen ? this.translateWindow : null;
    if (!target && open) {
      open.close();
      return;
    }
    const surface = this.surface;
    const first: TranslateTarget = target ?? {
      text: "",
      onInsert: surface ? (text) => void surface.addTextInView(text) : undefined,
    };
    if (open) {
      open.load(first);
      return;
    }
    const settings = this.plugin.settings;
    this.translateWindow = new TranslateWindow(
      {
        container: this.contentEl,
        translator: this.plugin.translator,
        memory: {
          from: () => settings.translateFrom ?? "",
          to: () => settings.translateTo ?? "",
          remember: (from, to) => {
            settings.translateFrom = from;
            settings.translateTo = to;
            void this.plugin.saveSettings();
          },
        },
        ai: this.translateAi() ?? undefined,
        onClosed: () => {
          this.translateWindow = null;
        },
      },
      first,
    );
  }

  /**
   * The Translate window's AI option: the AI service the user set up, or
   * null when there is none (no key, or no endpoint), and then no switch.
   */
  private translateAi(): TranslateAi | null {
    const plugin = this.plugin;
    const config = plugin.textAiConfig();
    try {
      assertConfigured(config);
    } catch {
      return null;
    }
    return {
      label: targetLabel(config),
      on: () => plugin.settings.translateWithAi === true,
      set: (on) => {
        plugin.settings.translateWithAi = on;
        void plugin.saveSettings();
      },
      translate: async (request) => {
        // Read again: the service or key may have changed since the window opened.
        const now = plugin.textAiConfig();
        const agreed = await plugin.confirmAiSend(
          now,
          t("ai.translate.consentAction"),
          t("ai.translate.consentWhat"),
        );
        if (!agreed) return null;
        return translateWithAi(now, request);
      },
    };
  }

  private toggleCalculator(): void {
    const open = this.calculator;
    this.calculator = null;
    if (open?.isOpen) {
      open.close();
      return;
    }
    this.calculator = new CalculatorPopover(this.contentEl, this.calculatorHost());
  }

  /** What the calculator needs from this notebook. */
  private calculatorHost(): CalculatorHost {
    return {
      path: this.file?.path ?? "",
      load: () => parseCalculatorData(this.settings.calculator),
      save: (data) => this.plugin.saveCalculator(data),
      insert: (text) => this.insertCalculation(text),
      insertGraph: (spec) => this.insertGraph(spec),
      popOutGraph: () => this.openGraphWindow(),
    };
  }

  /**
   * The calculator's graph, popped out to float over the notebook
   * (`graph-window.ts`); raised again when it is already open.
   */
  private openGraphWindow(): void {
    if (this.graphWindow?.isOpen) {
      this.graphWindow.raise();
      return;
    }
    const path = this.file?.path ?? "";
    const data = (): ReturnType<typeof parseCalculatorData> =>
      parseCalculatorData(this.settings.calculator);
    this.graphWindow = new GraphWindow({
      container: this.contentEl,
      state: graphStateFor(path),
      angle: () => data().prefs.angle,
      editLine: (id) => this.calculatorOnLine(id),
      insertGraph: (spec) => this.insertGraph(spec),
      drawMath: drawGraphMath,
      place: () => windowOf(data(), path),
      savePlace: (place) => this.plugin.saveCalculator(withWindow(data(), path, place)),
      closed: () => {
        this.graphWindow = null;
      },
    });
  }

  /** The calculator on its keys, typing a line of the graph (from the graph window). */
  private calculatorOnLine(id: string | null): void {
    this.calculator?.close();
    this.calculator = new CalculatorPopover(this.contentEl, this.calculatorHost(), {
      editLine: id,
    });
  }

  /**
   * Edit graph on a selected graph: the calculator opens on its graph pane
   * with this graph's expressions, view and angle, under the toolbar's
   * calculator button; its Done commits the edit as one undo step.
   */
  private editGraph(pageId: string, graph: GraphElement): void {
    if (this.isProtected()) return;
    this.calculator?.close();
    this.calculator = new CalculatorPopover(
      this.contentEl,
      {
        path: this.file?.path ?? "",
        load: () => parseCalculatorData(this.settings.calculator),
        save: (data) => this.plugin.saveCalculator(data),
        insert: (text) => this.insertCalculation(text),
      },
      {
        editGraph: {
          spec: specOfGraph(graph),
          done: (spec) => this.applyGraphEdit(pageId, graph, spec),
        },
      },
    );
  }

  /**
   * A calculation as a text box in the middle of what is in view of the
   * current page, in the Text tool's style, sized to its text: one undo step.
   */
  private insertCalculation(text: string): boolean {
    if (this.refuseOnPdfTab()) return false;
    const surface = this.surface;
    if (!surface || this.isProtected()) return false;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return false;
    const style = textStyleOf(sanitizeTextStyle(this.settings.textStyle));
    // A first guess at the box's size, to centre it; the box fits its text.
    // Steps come as several lines: the widest one sets the width.
    const longest = Math.max(...text.split("\n").map((line) => line.length));
    const w = Math.max(80, longest * style.fontSize * 0.55);
    const at = centredOrigin(
      surface.visiblePageRect(index),
      page.geometry,
      w,
      style.fontSize * 1.4,
    );
    surface.applyCommand(
      new AddTextBoxToPage(page.id, {
        id: nextElementId(surface.document, "t"),
        x: at.x,
        y: at.y,
        w: 80,
        fit: true,
        text,
        ...style,
      }),
    );
    this.requestSave();
    return true;
  }

  /**
   * A graph from the calculator, in the middle of what is in view of the
   * current page, selected so its bar (Explore, Edit) is right there: one
   * undo step.
   */
  insertGraph(spec: GraphSpec): boolean {
    if (this.refuseOnPdfTab()) return false;
    const surface = this.surface;
    if (!surface || this.isProtected()) return false;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return false;
    // The frame takes the view's shape, as the pop-up showed it, within bounds.
    const h = graphFrameHeight(spec, GRAPH_DEFAULT_W, GRAPH_DEFAULT_H);
    const at = centredOrigin(surface.visiblePageRect(index), page.geometry, GRAPH_DEFAULT_W, h);
    const graph = graphFromSpec(nextGraphId(surface.document), at.x, at.y, spec);
    if (graph.spec.expressions.length === 0) return false;
    graph.h = h;
    surface.applyCommand(new AddGraph(page.id, graph));
    surface.selectGraph(page.id, graph.id);
    this.requestSave();
    return true;
  }

  /**
   * Open the equation window (discussion #166): for `equation`, to change
   * its source, or for a new one at page point `at` (its left edge, its
   * middle on the tap), in the Text tool's colour and size. What comes back
   * is measured here, so the frame stored is the one this device draws.
   */
  private openEquation(
    pageId: string,
    at: { x: number; y: number },
    equation: EquationElement | null,
  ): void {
    if (this.isProtected()) return;
    this.equationEditor?.close();
    const style = textStyleOf(sanitizeTextStyle(this.settings.textStyle));
    const color = equation?.color ?? style.color;
    const size = equation?.size ?? style.fontSize;
    this.equationEditor = new EquationEditor({
      container: this.contentEl,
      tex: equation?.tex ?? "",
      color,
      size,
      done: (tex) => {
        this.equationEditor = null;
        this.placeEquation(pageId, at, equation, tex, color, size);
      },
      cancel: () => {
        this.equationEditor = null;
      },
    });
  }

  /** Commit what the equation window gave back: a new equation, or the edited one. One undo step. */
  private placeEquation(
    pageId: string,
    at: { x: number; y: number },
    equation: EquationElement | null,
    tex: string,
    color: string,
    size: number,
  ): void {
    const surface = this.surface;
    if (!surface || this.isProtected()) return;
    const page = surface.document.pages.find((candidate) => candidate.id === pageId);
    this.measureCtx ??= createEl("canvas").getContext("2d");
    if (!page || !this.measureCtx) return;
    const frame = measureEquation(this.measureCtx, tex, size);
    if (equation) {
      if (equation.tex === tex) return;
      surface.applyCommand(new EditEquation(pageId, equation, { tex, ...frame }));
    } else {
      const { width, height } = page.geometry;
      const x = Math.max(0, Math.min(at.x, width - frame.w));
      const y = Math.max(0, Math.min(at.y - frame.h / 2, height - frame.h));
      const placed = makeEquation({
        id: nextEquationId(surface.document),
        x,
        y,
        tex,
        color,
        size,
        ...frame,
      });
      surface.applyCommand(new AddEquation(pageId, placed));
    }
    this.requestSave();
  }

  /** What Edit graph gave back for `graph`: its whole new spec, one undo step. */
  applyGraphEdit(pageId: string, graph: GraphElement, spec: GraphSpec): boolean {
    const surface = this.surface;
    if (!surface || this.isProtected()) return false;
    // Each curve keeps its colour by position; a new one takes the palette's next.
    const edited = graphFromSpec(graph.id, graph.x, graph.y, spec, graph.colors);
    if (edited.spec.expressions.length === 0) return false;
    surface.applyCommand(
      new EditGraph(pageId, graph, { spec: edited.spec, colors: edited.colors }),
    );
    this.requestSave();
    return true;
  }

  /** The on-device reader's state for the AI menu; undefined when it is off. */
  private deviceReading(): DeviceReading | undefined {
    if (this.settings.handwritingOnDevice === false) return undefined;
    const progress = this.plugin.learner.progress;
    return {
      learned: learnedRecord(this.settings, this.plugin.grape.id) !== undefined,
      practiceFiles: practiceFiles(this.plugin.learningHost()).length,
      learning: progress ? (100 * progress.step) / progress.steps : null,
      checkingWords: this.settings.checkHandwrittenWords === true,
      calculating: this.settings.calcNotes === true,
    };
  }

  /**
   * What each AI menu entry does, by the id `buildAiMenu` gave it. A new
   * entry (e.g. "transcribe-recording") is one item there and one line here.
   */
  private aiActions(): Record<string, () => void> {
    return {
      "learn-window": () => this.plugin.openLearnWindow(),
      "scan-pdf-download": () => this.plugin.offerOcrReader(true),
      "device-settings": () => this.plugin.openSettingsTab(),
      "transcribe-page": () => void this.transcribePageNow(),
      "transcribe-recording": () => this.audio?.transcribeFromMenu(),
      "transcribe-device": () => this.audio?.transcribeOnDeviceFromMenu(),
      "transcribe-device-cancel": () => this.plugin.speech.cancel(),
      ask: () => this.openAsk(),
      "generate-image": () => this.openGenerateImage(),
      settings: () => this.plugin.openSettingsTab(),
    };
  }

  // --- Ask AI ---------------------------------------------------------------

  /** What page previews are painted from (the export dialog's, Ask AI's page picker). */
  private previewSources(): PdfExportSources {
    return {
      readPdf: async (path: string) => {
        const file = this.app.vault.getFileByPath(path);
        if (!file) throw new Error(t("view.pdf.missingSource", { path }));
        return this.app.vault.readBinary(file);
      },
      pdf: this.pdfCache,
      images: this.images,
      paper: paperTheme(false),
      usePressure: this.settings.pressureWidth,
      highlighterAlpha: this.settings.highlighterAlpha,
      furniture: (page) =>
        furnitureText(this.doc, this.doc.pages.indexOf(page), this.notebookTitle()),
    };
  }

  /** The notebook's name, as a header's `{title}`. */
  private notebookTitle(): string {
    return this.file ? stripInkSuffix(this.file.basename) : "";
  }

  /**
   * What a page of this notebook is read with on the device: the notebook's
   * own words (its title, and its other pages as read or transcribed,
   * page-words.ts) and the word list (EXP-PCONFIRM). Never throws: without
   * either, the page is read as before.
   */
  private async readingContext(page: Page): Promise<ReadingContext> {
    const context: ReadingContext = {};
    try {
      await this.plugin.wordCheck.load();
      context.lexicon = this.plugin.wordCheck.lexicon();
    } catch {
      // No word list: nothing is read again.
    }
    try {
      const doc = this.doc;
      const key = pageKeys(doc.pages)[doc.pages.indexOf(page)] ?? page.id;
      const title = this.notebookTitle();
      const notes = [this.noteBody, ...(await this.transcriptFiles(title))];
      context.words = pageWords(title, notes, key);
    } catch {
      // No page words: the page is read on its own.
    }
    return context;
  }

  /** The transcript files kept beside this notebook (`Transcripts/<title>.transcript.md`). */
  private async transcriptFiles(title: string): Promise<string[]> {
    const dir = this.file?.parent?.path ?? "";
    if (!title) return [];
    const adapter = this.app.vault.adapter;
    const out: string[] = [];
    for (const rel of [`Transcripts/${title}.transcript.md`, `${title}.transcript.md`]) {
      const path = normalizePath(dir && dir !== "/" ? `${dir}/${rel}` : rel);
      if (await adapter.exists(path)) out.push(await adapter.read(path));
    }
    return out;
  }

  /** Ask, in the layout last chosen: a window, or the sidebar beside the page. */
  private openAsk(): void {
    if (this.isDamaged()) return;
    this.showTab(NOTES_TAB);
    if (this.settings.askLayout === "sidebar" && this.chatPanel) {
      this.setChatPanel(true);
      return;
    }
    // A window over the notebook, moved and sized as the calculator's (ask-window.ts).
    this.askWindow ??= new AskChatWindow(this.app, this.contentEl, {
      host: () => this.askHost(),
      switchLayout: () => {
        this.setAskLayout("sidebar");
        this.setChatPanel(true);
      },
    });
    this.askWindow.open();
  }

  private setAskLayout(layout: "window" | "sidebar"): void {
    if (this.settings.askLayout === layout) return;
    this.settings.askLayout = layout;
    void this.plugin.saveSettings();
  }

  /**
   * Open or close the Ask sidebar. It takes the left of the page, as the page
   * sidebar does, so opening it closes that one; the page glides aside as
   * it does for the page sidebar.
   */
  private setChatPanel(open: boolean): void {
    const panel = this.chatPanel;
    if (!panel || panel.isOpen === open) return;
    const before = this.surface?.pageClientRect() ?? null;
    if (open) {
      if (this.sidebar?.isOpen) this.sidebar.setOpen(false);
      panel.open();
    } else {
      panel.close();
    }
    this.syncSidebarInset();
    this.surface?.layout();
    if (before) this.surface?.glideFrom(before, PANEL_SLIDE_MS);
  }

  /** What the chat needs from this notebook, in either layout. */
  private askHost(): AskAiHost {
    const session = this.askConversation();
    return {
      session,
      sourcePath: this.file?.path ?? "",
      target: targetLabel(this.plugin.textAiConfig()),
      showCost: () => this.settings.askShowCost,
      openAppLink: (url) => this.plugin.openFinenotesLink(url),
      vaultScope: {
        get: () => askVaultScopeOf(this.settings.askVaultScope),
        set: (scope) => {
          this.settings.askVaultScope = scope;
          this.vaultSource = null;
          void this.plugin.saveSettings();
        },
      },
      currentPage: () => (this.surface?.currentPage ?? 0) + 1,
      pageHasContent: (n) => {
        const page = this.doc.pages[n - 1];
        return !!page && hasAskableContent(page);
      },
      paintThumbnail: async (canvas, n, cssWidth) => {
        const page = this.doc.pages[n - 1];
        if (page) {
          await paintPagePreview(
            canvas,
            page,
            this.previewSources(),
            cssWidth,
            winOf(this.contentEl).devicePixelRatio || 1,
          );
        }
      },
      insert: (text) => this.insertAnswer(text),
      changes: {
        state: (id) => (this.surface ? this.askChanges.state(this.surface.document, id) : null),
        toggle: (id) => this.toggleAskChange(id),
        onChange: (listener) => {
          this.askChangeListeners.add(listener);
          return () => this.askChangeListeners.delete(listener);
        },
      },
      insertDrawing: async (svg) => {
        const bytes = new TextEncoder().encode(svg);
        const placed = await this.insertImageBytes(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          "image/svg+xml",
          "Drawing.svg",
        );
        return placed !== null;
      },
      notebookAsPdf: (onProgress) => this.notebookPdfAttachment(onProgress),
      notebookPdfs: () =>
        pdfsBehind(
          this.doc.pages.map((page) => page.backdrop),
          this.doc.pages.map((_, i) => i + 1),
        ),
    };
  }

  /**
   * This notebook's conversation, kept while the notebook is open so closing
   * the dialog loses neither the chat nor the draft. Before anything is
   * asked or attached, it follows the page being read (or picks no page,
   * when the setting says not to attach it).
   */
  private askConversation(): AskSession {
    const current = (this.surface?.currentPage ?? 0) + 1;
    let session = this.askSession;
    if (!session) {
      session = new AskSession(
        {
          notebookPath: () => this.file?.path ?? "",
          confirm: () =>
            this.plugin.confirmAiSend(
              this.plugin.textAiConfig(),
              t("view.ask.consentTitle"),
              t("view.ask.consentWhat"),
            ),
          preparePages: (numbers) =>
            this.collectAskPages(
              numbers.map((n) => n - 1).filter((i) => i >= 0 && i < this.doc.pages.length),
            ),
          ask: (turns, onStatus) => this.askWithTools(turns, onStatus),
          save: (chat, path) => writeChat(this.app, chat, path, this.chatsFolder()),
          unsave: (path) => trashChat(this.app, path),
          readFile: (path) => readAttachment(this.app, path),
          now: () => new Date(),
        },
        {
          page: current,
          totalPages: this.doc.pages.length,
          // Every chat is kept in the AI chats folder, and deleted there.
          save: true,
          // A chat sends a page only when the user picks one (discussion #107).
          attachPage: false,
          screen: this.showingBoard,
        },
      );
      this.askSession = session;
    } else {
      session.setTotalPages(this.doc.pages.length);
      session.follow(current);
    }
    return session;
  }

  /**
   * Ask's answer: the AI may use the notebook's tools on the way
   * (`askAiWithTools`), whichever vendor answers; a self-hosted endpoint
   * that cannot do tools answers from what was sent.
   */
  private askWithTools(
    turns: readonly ChatTurn[],
    onStatus: (status: string) => void,
  ): Promise<AskAnswer> {
    const config = this.plugin.textAiConfig();
    const system = buildAskSystemPrompt();
    // What it can do and which settings to suggest; the same text while the settings stay.
    const abilities = askAbilitiesPrompt(
      askVaultScopeOf(this.settings.askVaultScope),
      this.settings.askShowCost,
      this.file?.path ?? "",
    );
    const prompt = `${system}\n${buildAskToolsPrompt()}\n${abilities}`;
    const turn = { answer: ++this.askAnswers, commands: [] as Command[] };
    this.askTurn = turn;
    // Everything the answer changed is one step of the notebook's undo.
    const finish = (): void => {
      if (this.askTurn === turn) this.askTurn = null;
      this.surface?.groupSteps(turn.commands, t("view.ask.stepLabel"));
    };
    const withTools = askAiWithTools(config, prompt, turns, {
      totalPages: () => this.doc.pages.length,
      run: (call) => this.runAskToolAsAi(call, turn.answer),
      onStatus,
    }).finally(finish);
    if (config.vendor !== "custom") return withTools;
    // A self-hosted server may not do tools: then it answers from what was sent.
    return withTools.catch(() => askAi(config, system, turns));
  }

  /** `search_vault` and `read_note`: the other notes the settings let Ask AI read, as text. */
  private async runVaultTool(
    call: Extract<AskToolCall, { tool: "search_vault" | "read_note" | "linked_notes" }>,
  ): Promise<AskToolOutcome> {
    const scope = askVaultScopeOf(this.settings.askVaultScope);
    const notebook = this.file?.path ?? "";
    if (scope === "off" || !notebook) return { text: VAULT_OFF_TEXT, isError: true };
    if (call.tool === "linked_notes") {
      const { resolvedLinks: links, unresolvedLinks: loose } = this.app.metadataCache;
      const outgoing = Object.keys(links[notebook] ?? {});
      // [[Week 4]] does not resolve to Week 4.notebook.md, but it is a link to it all the same.
      const name = this.file?.basename.replace(/\.(notebook|page|ink)$/i, "").toLowerCase() ?? "";
      const incoming = [
        ...Object.keys(links).filter((from) => links[from]?.[notebook] !== undefined),
        ...Object.keys(loose).filter((from) =>
          Object.keys(loose[from] ?? {}).some(
            (target) => target.split("/").pop()?.toLowerCase() === name,
          ),
        ),
      ];
      const readable = (path: string): boolean =>
        /\.(md|pdf)$/i.test(path) && inScope(path, notebook, scope);
      return {
        text: linkedNotesText(
          call.direction === "from" ? [] : outgoing,
          call.direction === "to" ? [] : incoming,
          readable,
        ),
      };
    }
    this.vaultSource ??= new VaultContextSource(this.app, (file) => this.plugin.isInkFile(file));
    const docs = await this.vaultSource.docs(notebook, scope);
    if (call.tool === "search_vault") {
      return { text: vaultSearchText(docs, call.query, scopeText(notebook, scope)) };
    }
    const found = resolveNotePath(
      call.path,
      docs.map((doc) => doc.path),
    );
    if ("error" in found) {
      const own = resolveNotePath(call.path, [notebook]);
      return {
        text:
          "path" in own
            ? "That is this notebook: use read_pages or search_notebook for it."
            : found.error,
        isError: true,
      };
    }
    const doc = docs.find((d) => d.path === found.path);
    if (!doc) return { text: `${found.path} cannot be read now.`, isError: true };
    return { text: readSlice(doc.path, doc.kind, docText(doc), call.from) };
  }

  /**
   * `create_note`: a new Markdown note beside the notebook, which the
   * answer links to. Never someone's note: a taken name gets a number, and
   * `replace` rewrites only a note Ask itself wrote while this notebook is
   * open (`askNotes`), to correct it.
   */
  private async createAskNote(
    title: string,
    text: string,
    replace: boolean,
  ): Promise<AskToolOutcome> {
    const notebook = this.file?.path ?? "";
    const vault = this.app.vault;
    const name = noteFileName(title);
    const link = (path: string, base: string): string => `[[${path.replace(/\.md$/, "")}|${base}]]`;
    if (replace) {
      const own = this.askNotes.get(name.toLowerCase());
      const file = own ? vault.getFileByPath(own) : null;
      if (!file) {
        return {
          text: `You wrote no note called “${name}” in this chat, so there is nothing to rewrite: notes you did not write are never changed.`,
          isError: true,
        };
      }
      await vault.modify(file, newNoteText(text, notebook));
      return {
        text: `Rewrote ${file.path}. Link to it in your answer as ${link(file.path, file.basename)}.`,
        done: t("view.ask.doneNoteFixed", { name: file.basename }),
      };
    }
    const path = freeNotePath(
      newNoteFolder(notebook),
      name,
      (p) => vault.getAbstractFileByPath(p) !== null,
    );
    const file = await vault.create(path, newNoteText(text, notebook));
    this.askNotes.set(name.toLowerCase(), file.path);
    // Not opened: that would take the tab, or the focus, from the notebook the chat is about.
    return {
      text: `Wrote the new note ${file.path}. Link to it in your answer as ${link(file.path, file.basename)}. To correct it, call create_note again with this title and replace: true.`,
      done: t("view.ask.doneNote", { name: file.basename }),
    };
  }

  /**
   * Run one of the AI's tools, recording what it changed in the notebook
   * (`asAi`) as a numbered change the chat, or the AI, can take back later.
   */
  private async runAskToolAsAi(call: AskToolCall, answer: number): Promise<AskToolOutcome> {
    const context: NonNullable<typeof this.askCall> = {
      before: null,
      set: null,
      record: call.tool !== "undo_changes",
    };
    this.askCall = context;
    let outcome: AskToolOutcome;
    try {
      outcome = await this.runAskTool(call);
    } finally {
      if (this.askCall === context) this.askCall = null;
    }
    const set = context.set;
    if (!set || isEmptyChange(set) || outcome.isError || !outcome.done) return outcome;
    const change = this.askChanges.record(set, outcome.done, answer);
    this.notifyAskChanges();
    return { ...outcome, change, text: `${outcome.text} (This is change ${change}.)` };
  }

  /**
   * Run `edit`, one of the AI's edits, so that its commands join the
   * answer's undo step and what it changed is recorded for the call. It is
   * synchronous, so no edit of the user's can come in between.
   */
  private asAi<T>(edit: () => T): T {
    const surface = this.surface;
    const turn = this.askTurn;
    const call = this.askCall;
    if (!surface || !turn || !call) return edit();
    if (call.record) call.before ??= snapshotPages(surface.document);
    try {
      return surface.recordCommands((command) => turn.commands.push(command), edit);
    } finally {
      if (call.before) call.set = diffPages(call.before, surface.document);
    }
  }

  private notifyAskChanges(): void {
    for (const listener of [...this.askChangeListeners]) listener();
  }

  /**
   * Take back one of Ask AI's changes from the chat, or make it again once
   * taken back: one step of the notebook's undo. Refused, with a notice,
   * when an edit since touched what it changed.
   */
  private toggleAskChange(id: number): void {
    const surface = this.surface;
    if (!surface || this.isProtected()) {
      new Notice(t("view.ask.changeLocked"));
      return;
    }
    const doc = surface.document;
    const redo = this.askChanges.state(doc, id) === "undone";
    const result = this.askChanges.revert(
      doc,
      [id],
      redo ? "redo" : "undo",
      t(redo ? "view.ask.redoStepLabel" : "view.ask.undoStepLabel"),
    );
    if ("reason" in result) {
      if (result.reason === "changed") {
        new Notice(
          result.pages.length > 0
            ? t(redo ? "view.ask.redoRefused" : "view.ask.undoRefused", {
                pages: pagesPhrase(result.pages),
              })
            : t(redo ? "view.ask.redoRefusedOrder" : "view.ask.undoRefusedOrder"),
          8000,
        );
      }
      this.notifyAskChanges();
      return;
    }
    surface.applyCommand(result);
    this.sidebar?.flush();
    this.requestSave();
  }

  /** `read_outline`: the contents, and each PDF behind the pages with its own outline. */
  private async readOutlineForAi(): Promise<AskToolOutcome> {
    const surface = this.surface;
    if (!surface) return { text: "The notebook is not open.", isError: true };
    if (this.onPdfTab) return { text: PDF_TAB_OUTLINE_TEXT, isError: true };
    const doc = surface.document;
    const behind = pdfsBehind(
      doc.pages.map((page) => page.backdrop),
      doc.pages.map((_, i) => i + 1),
    );
    const pdfs: PdfOutlineOf[] = [];
    for (const pdf of behind) {
      const items = await this.readOutline(pdf.path);
      pdfs.push({
        name: pdf.path.slice(pdf.path.lastIndexOf("/") + 1),
        pages: pdf.pages,
        entries: tabOutlineEntries(doc, pdf.path, items),
      });
    }
    return { text: outlineText(doc, pdfs) };
  }

  /** Run one of the AI's notebook tools (`ask-tools.ts`). */
  private async runAskTool(call: AskToolCall): Promise<AskToolOutcome> {
    const surface = this.surface;
    const editRefused = (): AskToolOutcome | null =>
      !surface || this.isProtected()
        ? { text: "The notebook cannot be changed right now.", isError: true }
        : null;
    switch (call.tool) {
      case "read_pages": {
        const pages = await this.collectAskPages(call.pages.map((n) => n - 1));
        if (pages.images.length === 0) return { text: "Those pages are empty." };
        const which = pages.pageNumbers.join(", ");
        return {
          text: `Page${pages.pageNumbers.length === 1 ? "" : "s"} ${which} of ${pages.totalPages}, in that order.`,
          images: pages.images,
        };
      }
      case "search_notebook": {
        const hits = searchPages(await this.notebookTextIndex(), call.query);
        return {
          text: searchResultText(
            call.query,
            hits.map((hit) => ({
              page: hit.pageIndex + 1,
              snippets: hit.snippets.map((s) => `${s.before}${s.match}${s.after}`),
            })),
          ),
        };
      }
      case "search_vault":
      case "read_note":
      case "linked_notes":
        return this.runVaultTool(call);
      case "create_note":
        return this.createAskNote(call.title, call.text, call.replace);
      case "finenotes_help":
        return {
          text: helpText(call.query, helpEntries(call.query, english)),
        };
      case "add_text_box": {
        const refused = editRefused();
        if (refused || !surface) return refused ?? { text: "", isError: true };
        const index = call.page - 1;
        const page = surface.document.pages[index];
        if (!page) return { text: `There is no page ${call.page}.`, isError: true };
        const frame = textBoxFrame(page.geometry, null);
        this.asAi(() =>
          surface.applyCommand(
            new AddTextBoxToPage(page.id, {
              id: nextElementId(surface.document, "t"),
              x: frame.x,
              y: frame.y,
              w: frame.w,
              text: call.text,
              color: "#1a1a1a",
              fontSize: 22,
            }),
          ),
        );
        this.requestSave();
        return {
          text: `Added the text box near the top of page ${call.page}.`,
          done: t("view.ask.doneTextBox", { page: call.page }),
        };
      }
      case "add_page": {
        const refused = editRefused();
        if (refused) return refused;
        if (this.isSinglePage) {
          return { text: "This note is a single page; it cannot have more.", isError: true };
        }
        const before = this.doc.pages.length;
        this.asAi(() => this.addPage(call.after - 1, true));
        if (this.doc.pages.length === before) return { text: "No page was added.", isError: true };
        return {
          text: `Added page ${call.after + 1} after page ${call.after}. Pages after it moved up by one.`,
          done: t("view.ask.doneAddPage", { page: call.after + 1 }),
        };
      }
      case "go_to_page":
        surface?.goToPage(call.page - 1, true);
        return {
          text: `Showing page ${call.page}.`,
          done: t("view.ask.doneGoTo", { page: call.page }),
        };
      case "read_outline":
        return this.readOutlineForAi();
      case "insert_drawing": {
        const refused = editRefused();
        if (refused) return refused;
        const bytes = new TextEncoder().encode(call.svg);
        const placed = await this.insertImageBytes(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          "image/svg+xml",
          `${call.title}.svg`,
          { pageIndex: call.page - 1, select: false, around: (place) => this.asAi(place) },
        );
        if (!placed) return { text: "The drawing could not be placed.", isError: true };
        return {
          text: `Placed the drawing on page ${call.page}, saved as ${placed.path}.`,
          done: t("view.ask.doneDrew", { page: call.page }),
        };
      }
      default:
        return this.runOrganiseTool(call);
    }
  }

  /**
   * The tools that organise or annotate the notebook (`ask-tools.ts`): page
   * titles, contents, bookmarks, page order, tables, practice pages, marks
   * and comments. Each is one undoable step.
   */
  private runOrganiseTool(call: AskToolCall): AskToolOutcome {
    const surface = this.surface;
    if (!surface || this.isProtected()) {
      return { text: "The notebook cannot be changed right now.", isError: true };
    }
    const doc = surface.document;
    const pageAt = (n: number): Page | null => doc.pages[n - 1] ?? null;
    const apply = (command: Command): void => {
      this.asAi(() => surface.applyCommand(command));
      this.requestSave();
    };
    switch (call.tool) {
      case "set_page_title": {
        const page = pageAt(call.page);
        if (!page) break;
        apply(new SetPageTitle(page, call.title || null));
        return call.title
          ? {
              text: `Page ${call.page} is now “${call.title}” in the contents.`,
              done: t("view.ask.doneTitled", { page: call.page, title: call.title }),
            }
          : {
              text: `Page ${call.page} has no title now.`,
              done: t("view.ask.doneUntitled", { page: call.page }),
            };
      }
      case "add_section": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        apply(
          new SetSection(page, nextSectionId(doc), {
            x: width * 0.08,
            y: call.y * height,
            title: call.title,
          }),
        );
        return {
          text: `Added “${call.title}” to the contents, on page ${call.page}.`,
          done: t("view.ask.doneContents", { title: call.title }),
        };
      }
      case "bookmark_page": {
        const page = pageAt(call.page);
        if (!page) break;
        apply(new SetPageBookmark(page, call.bookmarked));
        return call.bookmarked
          ? {
              text: `Bookmarked page ${call.page}.`,
              done: t("view.ask.doneBookmarked", { page: call.page }),
            }
          : {
              text: `Page ${call.page} has no bookmark now.`,
              done: t("view.ask.doneUnbookmarked", { page: call.page }),
            };
      }
      case "set_outline": {
        if (this.onPdfTab) return { text: PDF_TAB_OUTLINE_TEXT, isError: true };
        const contents = placeOutline(doc, call.entries, call.replace);
        if (contents.length === 0) return { text: "The outline is already like that." };
        apply(new SetPagesContents(contents, t("view.ask.outlineLabel")));
        this.sidebar?.flush();
        const count = call.entries.length;
        return {
          text: call.replace
            ? `The outline is now these ${count} entr${count === 1 ? "y" : "ies"}.`
            : `Added ${count} entr${count === 1 ? "y" : "ies"} to the outline.`,
          done: call.replace
            ? tn("view.ask.doneOutline", count)
            : tn("view.ask.doneOutlineAdded", count),
        };
      }
      case "undo_changes":
        return this.undoAskChanges(call.changes);
      case "move_page": {
        if (this.isSinglePage) return { text: "This note is a single page.", isError: true };
        apply(new MovePage(call.page - 1, call.to - 1));
        this.sidebar?.flush();
        return {
          text: `Page ${call.page} is now page ${call.to}; the pages between moved by one.`,
          done: t("view.ask.doneMoved", { page: call.page, to: call.to }),
        };
      }
      case "add_table": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        const rows = call.cells.length;
        const cols = call.cells[0]?.length ?? 1;
        const x = (call.x ?? 0.08) * width;
        const y = (call.y ?? 0.08) * height;
        const w = Math.max(cols * 60, Math.min((call.width ?? 0.84) * width, width - x));
        const table = makeTable({
          id: nextTableId(doc),
          x,
          y,
          w,
          h: rows * 44,
          rows,
          cols,
          color: "#1a1a1a",
          textColor: "#1a1a1a",
          header: call.header,
        });
        call.cells.forEach((row, r) => row.forEach((cell, c) => setCellText(table, r, c, cell)));
        apply(new AddTable(page.id, table));
        return {
          text: `Added a ${rows}×${cols} table on page ${call.page}.`,
          done: t("view.ask.doneTable", { page: call.page }),
        };
      }
      case "add_practice_page": {
        if (this.isSinglePage) return { text: "This note is a single page.", isError: true };
        const insert = pageToInsertAfter(doc, call.after - 1, this.templateNames());
        if (!insert) break;
        const { page } = insert;
        const { width, height } = page.geometry;
        const parts: Command[] = [new AddPage(insert.index, page)];
        if (call.title) parts.push(new SetPageTitle(page, call.title));
        // Ids counted on from the notebook's highest, one per box.
        let next = Number(nextElementId(doc, "t").slice(1));
        const box = (y: number, text: string, fontSize: number, bold = false): TextBoxElement => ({
          id: `t${next++}`,
          x: width * 0.08,
          y,
          w: width * 0.84,
          text,
          color: "#1a1a1a",
          fontSize,
          ...(bold ? { bold: true } : {}),
        });
        let top = height * 0.06;
        if (call.title) {
          parts.push(new AddTextBoxToPage(page.id, box(top, call.title, 30, true)));
          top += 60;
        }
        // Each question gets an even share of what is left, to answer under it.
        const slot = (height * 0.96 - top) / call.questions.length;
        call.questions.forEach((question, i) => {
          parts.push(
            new AddTextBoxToPage(page.id, box(top + i * slot, `${i + 1}. ${question}`, 22)),
          );
        });
        apply(new CompositeCommand(t("view.ask.practiceLabel"), parts));
        surface.goToPage(insert.index, true);
        return {
          text:
            `Added practice page ${insert.index + 1} with ${call.questions.length} ` +
            `question${call.questions.length === 1 ? "" : "s"}, on the same paper as page ${call.after}.`,
          done: t("view.ask.donePractice", { page: insert.index + 1 }),
        };
      }
      case "mark_area": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        const x0 = call.x * width;
        const y0 = call.y * height;
        const x1 = (call.x + call.width) * width;
        const y1 = (call.y + call.height) * height;
        const parts: Command[] = [
          new AddStrokeToPage(page.id, markStroke(doc, call.shape, x0, y0, x1, y1)),
        ];
        if (call.comment) {
          parts.push(new AddComment(page.id, this.aiComment(doc, page, x1, y0, call.comment)));
        }
        apply(new CompositeCommand(t("view.ask.markLabel"), parts));
        const what =
          call.shape === "highlight" ? "Highlighted" : call.shape === "box" ? "Boxed" : "Circled";
        return {
          text: `${what} that part of page ${call.page}${call.comment ? ", with the comment beside it" : ""}.`,
          done: t(
            call.comment
              ? call.shape === "highlight"
                ? "view.ask.doneHighlightedComment"
                : call.shape === "box"
                  ? "view.ask.doneBoxedComment"
                  : "view.ask.doneCircledComment"
              : call.shape === "highlight"
                ? "view.ask.doneHighlighted"
                : call.shape === "box"
                  ? "view.ask.doneBoxed"
                  : "view.ask.doneCircled",
            { page: call.page },
          ),
        };
      }
      case "add_comment": {
        const page = pageAt(call.page);
        if (!page) break;
        const { width, height } = page.geometry;
        apply(
          new AddComment(
            page.id,
            this.aiComment(doc, page, call.x * width, call.y * height, call.text),
          ),
        );
        return {
          text: `Pinned the comment on page ${call.page}; the user opens it by tapping its marker.`,
          done: t("view.ask.doneComment", { page: call.page }),
        };
      }
      default:
        return { text: "That tool is not here.", isError: true };
    }
    return { text: "That page is not in the notebook.", isError: true };
  }

  /**
   * `undo_changes`: take back changes the AI made in this chat (by number,
   * or the latest answer's), as one step, never the user's own edits.
   */
  private undoAskChanges(asked: readonly number[]): AskToolOutcome {
    const surface = this.surface;
    if (!surface || this.isProtected()) {
      return { text: "The notebook cannot be changed right now.", isError: true };
    }
    const doc = surface.document;
    const ids =
      asked.length > 0
        ? asked
        : this.askChanges.latestApplied(doc, this.askTurn?.answer ?? Infinity);
    if (ids.length === 0) {
      return {
        text: "None of your changes to this notebook in this chat is still in place: there is nothing to take back.",
        isError: true,
      };
    }
    const list = ids.join(", ");
    const result = this.askChanges.revert(doc, ids, "undo", t("view.ask.undoStepLabel"));
    if ("reason" in result) {
      switch (result.reason) {
        case "unknown":
          return {
            text: `There is no change ${result.ids.join(", ")} in this chat; your changes are numbered 1 to ${this.askChanges.size}.`,
            isError: true,
          };
        case "already":
          return {
            text: `Change${ids.length === 1 ? "" : "s"} ${list} ${ids.length === 1 ? "is" : "are"} already taken back.`,
          };
        case "changed":
          return {
            text:
              `Nothing was taken back: the user has edited ${result.pages.length > 0 ? `page${result.pages.length === 1 ? "" : "s"} ${result.pages.join(", ")}` : "the page order"} ` +
              `since, where change${ids.length === 1 ? "" : "s"} ${list} made ${ids.length === 1 ? "its" : "their"} edit, and taking ${ids.length === 1 ? "it" : "them"} back would undo theirs. Tell the user, and that they can undo their own edit first.`,
            isError: true,
          };
      }
    }
    // Only those still in place are taken back; say only those.
    const taken = ids.filter((id) => this.askChanges.state(doc, id) !== "undone");
    const what = taken.join(", ");
    this.asAi(() => surface.applyCommand(result));
    this.sidebar?.flush();
    this.requestSave();
    this.notifyAskChanges();
    return {
      text: `Took back change${taken.length === 1 ? "" : "s"} ${what}. The user's own edits are untouched; undo brings ${taken.length === 1 ? "it" : "them"} back.`,
      done: tn("view.ask.doneUndid", taken.length, { list: what }),
    };
  }

  /** A comment by the AI at page point (`x`, `y`), kept on the page. */
  private aiComment(doc: InkDocument, page: Page, x: number, y: number, text: string): PageComment {
    return {
      id: nextCommentId(doc),
      x: Math.min(Math.max(0, x), page.geometry.width),
      y: Math.min(Math.max(0, y), page.geometry.height),
      text: text.slice(0, MAX_COMMENT_LENGTH),
      author: "ai",
      created: Date.now(),
    };
  }

  /**
   * The notebook's text, page by page, for searching: its text boxes, the
   * note's text layer, the transcript sidecar, beside the note first
   * (where the server keeps one) and then in the notebook's Transcripts, and
   * its PDF pages' printed text (#112). With `readPdf` false, only the PDF
   * text already read is in it ({@link readPdfSearchText} reads the rest).
   */
  private async notebookTextIndex(readPdf = true): Promise<PageText[]> {
    const note = this.file;
    let sidecar: string | null = null;
    const sidecarFile = note
      ? ([transcriptSidecarPath(note.path), folderNotebookSidecarPath(note.path)]
          .map((path) => (path ? this.app.vault.getFileByPath(path) : null))
          .find((file) => file !== null) ?? null)
      : null;
    if (sidecarFile) {
      try {
        sidecar = await this.app.vault.cachedRead(sidecarFile);
      } catch {
        // Not synced yet or unreadable: search what the note itself holds.
      }
    }
    const doc = this.surface?.document ?? this.doc;
    if (readPdf) await this.readPdfSearchText(doc.pages);
    return collectPageText(doc.pages, readTextSection(this.noteBody), sidecar, (page) =>
      page.backdrop.kind === "pdf"
        ? this.pdfSearchText.get(`${page.backdrop.path}:${page.backdrop.page}`)
        : undefined,
    );
  }

  /**
   * Read the printed text of every PDF page not read for search yet, in
   * page order; `onProgress` hears every few pages, so an open search list
   * can fill in as they come. Text kept on this device from an earlier
   * read of the same PDF is taken as it is, and what is read is kept
   * (search-store.ts), so Home's search finds it. `gap` pauses between
   * pages read, and waits while the pen writes (the background read);
   * `restore` false reads again what was kept (its OCR text came since).
   */
  private async readPdfSearchText(
    pages: readonly Page[],
    onProgress?: () => void,
    gap = 0,
    restore = true,
  ): Promise<void> {
    const cache = this.pdfText;
    if (!cache) return;
    const vault = vaultKeyOf(this.app);
    if (restore) await this.restorePrinted(vault, pages);
    if (this.pdfText !== cache) return;
    let fresh = 0;
    const kept = new Map<string, KeptPrinted>();
    for (const page of pages) {
      const backdrop = page.backdrop;
      if (backdrop.kind !== "pdf") continue;
      const key = `${backdrop.path}:${backdrop.page}`;
      if (this.pdfSearchText.has(key)) continue;
      if (gap > 0) {
        do await new Promise<void>((resolve) => window.setTimeout(resolve, gap));
        while (this.penIsDown && this.pdfText === cache);
      }
      if (this.pdfText !== cache) return;
      const layout = await cache.layout(backdrop, page.geometry);
      if (this.pdfText !== cache) return;
      const text = layoutPlainText(layout);
      this.pdfSearchText.set(key, text);
      const stamp = this.pdfStamp(backdrop.path);
      if (stamp) kept.set(printedKey(backdrop.path, backdrop.page), { stamp, text });
      if (++fresh % PDF_SEARCH_BATCH === 0) {
        onProgress?.();
        savePrinted(vault, kept);
        kept.clear();
      }
    }
    savePrinted(vault, kept);
    // Also when nothing needed reading: text restored from this device's
    // store joins an open results list too (#112).
    if (fresh === 0 || fresh % PDF_SEARCH_BATCH !== 0) onProgress?.();
  }

  /** PDF pages' text kept on this device from an earlier read, while the PDF is unchanged. */
  private async restorePrinted(vault: string, pages: readonly Page[]): Promise<void> {
    const wanted = new Map<string, string>();
    for (const page of pages) {
      const backdrop = page.backdrop;
      if (backdrop.kind !== "pdf") continue;
      const key = `${backdrop.path}:${backdrop.page}`;
      if (!this.pdfSearchText.has(key)) wanted.set(printedKey(backdrop.path, backdrop.page), key);
    }
    if (wanted.size === 0) return;
    const found = await getPrinted(vault, [...wanted.keys()]);
    for (const [stored, kept] of found) {
      const key = wanted.get(stored);
      const path = stored.slice(0, stored.lastIndexOf("\n"));
      if (key && kept.stamp === this.pdfStamp(path) && !this.pdfSearchText.has(key))
        this.pdfSearchText.set(key, kept.text);
    }
  }

  /** A PDF's version, `mtime:size`; `null` when it is not in the vault. */
  private pdfStamp(path: string): string | null {
    const file = this.app.vault.getFileByPath(path);
    return file ? `${file.stat.mtime}:${file.stat.size}` : null;
  }

  /** This notebook's pages on one PDF page. */
  private pdfPagesOf(path: string, n: number): Page[] {
    return (this.surface?.document.pages ?? []).filter(
      (p) => p.backdrop.kind === "pdf" && p.backdrop.path === path && p.backdrop.page === n,
    );
  }

  /**
   * A while after opening, the printed text of every PDF page is read
   * (or taken from what this device kept), one page at a time, never
   * while the pen writes: Home's search then finds it.
   */
  private async indexPdfText(): Promise<void> {
    this.pdfIndexTimer = 0;
    const pages = this.surface?.document.pages;
    if (!pages || this.guard.locked || !pages.some((p) => p.backdrop.kind === "pdf")) return;
    await this.readPdfSearchText(pages, undefined, PDF_INDEX_GAP_MS);
  }

  /**
   * Where this notebook keeps saved chats: its own setting (a new notebook
   * with its own folder sets it to that folder's AI chats), else "AI chats" beside it.
   */
  private chatsFolder(): string {
    return this.attachmentFolder("chats") ?? chatsFolderFor(this.file?.path ?? "");
  }

  private async collectAskPages(indexes: readonly number[]): Promise<AskPagesResult> {
    const images: ChatImage[] = [];
    const pageNumbers: number[] = [];
    // A board is asked about as the screen shows it (FineNotes#46); another
    // board of the file (discussion #160), as its whole drawing.
    const shown = this.surface?.currentPage ?? 0;
    const seen = this.showingBoard ? this.surface?.visiblePageRect(shown) : null;
    const screen = seen ? { x: seen.x, y: seen.y, width: seen.w, height: seen.h } : undefined;
    for (const index of indexes) {
      const page = this.doc.pages[index];
      if (!page) continue;
      const rendered = await this.renderForAi(page, index === shown ? screen : undefined);
      if (!rendered) continue;
      images.push({ base64: rendered.base64, mimeType: "image/png" });
      pageNumbers.push(index + 1);
    }
    return { images, pageNumbers, totalPages: this.doc.pages.length };
  }

  /** Pin a comment to page `index` at `at`, one undoable step. Resolves to it, or null. */
  private addComment(
    index: number,
    at: { x: number; y: number },
    text: string,
    author: "you" | "ai",
  ): PageComment | null {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected() || !text.trim()) return null;
    const comment: PageComment = {
      id: nextCommentId(surface.document),
      x: Math.min(Math.max(0, at.x), page.geometry.width),
      y: Math.min(Math.max(0, at.y), page.geometry.height),
      text: text.trim().slice(0, MAX_COMMENT_LENGTH),
      author,
      created: Date.now(),
    };
    surface.applyCommand(new AddComment(page.id, comment));
    this.requestSave();
    return comment;
  }

  /** A comment's marker was tapped: read it, edit it, resolve or delete it. */
  private openComment(index: number, comment: PageComment): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page) return;
    const apply = (command: Command): void => {
      if (this.isProtected()) return;
      surface.applyCommand(command);
      this.requestSave();
    };
    new CommentModal(this.app, comment, index + 1, {
      save: (text) => apply(new SetCommentText(page.id, comment, text)),
      resolve: (resolved) => apply(new SetCommentResolved(page.id, comment, resolved)),
      remove: () => apply(new RemoveComment(page.id, comment)),
    }).open();
  }

  /**
   * An answer as a text box near the top of what is in view on the current
   * page; `below` (a pasted transcript) puts it under what is drawn there.
   */
  private insertAnswer(text: string, below = false): boolean {
    if (this.refuseOnPdfTab()) return false;
    const surface = this.surface;
    if (!surface || !text.trim() || this.isProtected()) return false;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return false;
    const view = surface.visiblePageRect(index);
    const frame = below
      ? textBoxBelow(
          page.geometry,
          view,
          drawnBounds(page, (t) => this.textHeight(t))?.maxY ?? null,
        )
      : textBoxFrame(page.geometry, view);
    const box: TextBoxElement = {
      id: nextElementId(surface.document, "t"),
      x: frame.x,
      y: frame.y,
      w: frame.w,
      text,
      color: "#1a1a1a",
      fontSize: 22,
    };
    surface.applyCommand(new AddTextBoxToPage(page.id, box));
    return true;
  }

  // --- Generate image -------------------------------------------------------

  /** Open "Generate image" (the AI menu and the image menu both lead here). */
  openGenerateImage(): void {
    if (this.isProtected()) return;
    const config = this.plugin.imageAiConfig();
    if (!config) {
      new Notice(t("view.image.chooseService"));
      return;
    }
    const target = { vendor: config.vendor, baseUrl: "" };
    new GenerateImageModal(this.app, {
      target: targetLabel(target),
      pageNumber: (this.surface?.currentPage ?? 0) + 1,
      aspect: this.settings.imageAspect,
      generate: async (prompt, aspect) => {
        this.settings.imageAspect = aspect;
        void this.plugin.saveSettings();
        const confirmed = await this.plugin.confirmAiSend(
          target,
          t("view.image.consentTitle"),
          t("view.image.consentWhat"),
        );
        if (!confirmed) return false;
        const picture = await generateImage(config, prompt, aspect);
        await this.placeGeneratedImage(picture, prompt);
        return true;
      },
    }).open();
  }

  /**
   * Save a generated picture and place it on the page being read, through
   * the same `insertImageBytes` every other picture uses (downscaled if it
   * needs to be, saved as an attachment, one undoable `InsertImage`,
   * selected).
   */
  private async placeGeneratedImage(picture: GeneratedPicture, prompt: string): Promise<void> {
    const { bytes } = picture;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const name = generatedImageName(prompt, new Date(), picture.mimeType);
    const placed = await this.insertImageBytes(buffer as ArrayBuffer, picture.mimeType, name);
    if (placed) new Notice(t("view.image.saved", { path: placed.path }));
  }

  /**
   * Read pages on this device for search and the text layer, a moment after
   * writing stops (`device-reading.ts` picks the page): one page at a time,
   * the page in view first, never while the pen is down, never replacing a
   * transcription.
   */
  private scheduleDeviceReading(delay = DEVICE_READ_IDLE_MS): void {
    window.clearTimeout(this.deviceTimer);
    this.deviceTimer = 0;
    if (this.settings.handwritingOnDevice === false || this.guard.locked) return;
    this.deviceTimer = window.setTimeout(() => void this.readNextPageOnDevice(), delay);
  }

  private async readNextPageOnDevice(): Promise<void> {
    this.deviceTimer = 0;
    const guard = this.plugin.readingGuard;
    const path = this.file?.path;
    if (this.deviceBusy || !this.surface || !path || guard.paused) return;
    if (this.penIsDown) {
      this.scheduleDeviceReading();
      return;
    }
    const doc = this.doc;
    const keys = pageKeys(doc.pages);
    const step = nextDeviceStep({
      pages: doc.pages,
      keys,
      entries: transcriptSources(readTextSection(this.noteBody)),
      hashOf: pageContentHash,
      read: this.deviceRead,
      skip: guard.skipped(path),
      current: this.surface.currentPage,
    });
    if (!step) return;
    if (step.kind === "clear") {
      this.writeTranscripts([{ key: step.key, text: "", hash: "" }]);
      this.scheduleDeviceReading(DEVICE_READ_NEXT_MS);
      return;
    }
    this.deviceBusy = true;
    try {
      await this.plugin.handwriting.model();
    } catch {
      // The model failed to load, which is no fault of the page: try again
      // after the next edit.
      this.deviceBusy = false;
      return;
    }
    // Marked until the reading and the link check are over: a mark left at
    // the next start means this page took the app down (reading-guard.ts).
    const mark = { path, key: step.key, hash: step.hash, page: doc.pages.indexOf(step.page) + 1 };
    guard.begin(mark);
    try {
      let reading: PageReading;
      try {
        // TODO(#46 phase 4): a board is read by area, around what changed;
        // its whole page would make every reading slower as it fills.
        reading = await this.plugin.handwriting.readPage(
          step.page.strokes,
          this.wordsChecked,
          await this.readingContext(step.page),
        );
      } catch {
        // An error or a timeout: skip this page until it changes, and go on.
        guard.fail(mark);
        this.scheduleDeviceReading(DEVICE_READ_NEXT_MS);
        return;
      }
      // The page may have changed, moved or gone, or been transcribed, meanwhile.
      if (this.doc !== doc || !doc.pages.includes(step.page)) return;
      if (pageContentHash(step.page) !== step.hash) {
        this.scheduleDeviceReading();
        return;
      }
      this.deviceRead.set(step.key, step.hash);
      const entry = transcriptSources(readTextSection(this.noteBody)).get(step.key);
      if (!entry || entry.device) {
        const text = readingText(reading);
        this.writeTranscripts([{ page: step.page, text, hash: step.hash, device: true }]);
      }
      await this.offerHandwrittenLinks(step.page, reading);
      await this.checkWords(step.page, step.hash, reading);
      this.scheduleDeviceReading(DEVICE_READ_NEXT_MS);
    } finally {
      guard.end();
      this.deviceBusy = false;
    }
  }

  /**
   * Look for `[[links]]` written by hand on a page just read: each line with
   * a bracket in it is read again word by word, and the links found are
   * offered on the page (`handwritten-links.ts`).
   */
  // --- Words it may have misread ------------------------------------------------

  /** Whether misread words are underlined (needs reading on the device). */
  private get wordsChecked(): boolean {
    const settings = this.plugin.settings as GoodObsidianSettings | undefined;
    return settings?.checkHandwrittenWords === true && settings.handwritingOnDevice !== false;
  }

  /**
   * Corrections were switched on or off (the AI menu, the settings): check
   * the page in view now, or take every underline away at once.
   */
  wordCheckingChanged(): void {
    if (this.wordsChecked) {
      this.scheduleWordCheck();
      return;
    }
    window.clearTimeout(this.wordCheckTimer);
    this.wordCheckTimer = 0;
    this.wordPopover?.close();
    for (const id of this.checkedWords.keys()) this.surface?.setWordFlags(id, []);
    this.checkedWords.clear();
  }

  /** Check the page in view once the reader has settled on it. */
  private scheduleWordCheck(): void {
    if (!this.wordsChecked) return;
    window.clearTimeout(this.wordCheckTimer);
    this.wordCheckTimer = window.setTimeout(() => void this.checkPageInView(), WORD_CHECK_WAIT_MS);
  }

  /**
   * Read the page in view and underline its doubtful words, unless it was
   * checked at this content already. Never while the pen is down or the
   * background reader is busy: then it waits for the next settle.
   */
  private async checkPageInView(): Promise<void> {
    this.wordCheckTimer = 0;
    const surface = this.surface;
    const page = surface?.document.pages[surface.currentPage];
    if (!surface || !page || !this.wordsChecked || this.guard.locked) return;
    const hash = pageContentHash(page);
    if (this.checkedWords.get(page.id)?.hash === hash) return;
    if (this.deviceBusy || this.penIsDown) {
      this.scheduleWordCheck();
      return;
    }
    this.deviceBusy = true;
    try {
      const reading = await this.plugin.handwriting.readPage(
        page.strokes,
        true,
        await this.readingContext(page),
      );
      if (this.surface === surface && surface.document.pages.includes(page)) {
        await this.checkWords(page, hash, reading);
      }
    } catch {
      // The model failed to load, or the page could not be read: nothing to underline.
    } finally {
      this.deviceBusy = false;
    }
  }

  /** Underline the words of a page just read that Grape may have misread. */
  private async checkWords(page: Page, hash: string, reading: PageReading): Promise<void> {
    const file = this.file;
    const surface = this.surface;
    if (!file || !surface) return;
    this.keepReading(page, hash, reading);
    if (!this.wordsChecked) {
      // Turned off since this page was checked: take its underlines away.
      if (this.checkedWords.delete(page.id)) surface.setWordFlags(page.id, []);
      return;
    }
    const words = readWords(reading.lines);
    const checked: CheckedPage = { hash, words };
    this.checkedWords.set(page.id, checked);
    // A page in another language is checked against its own pack, if any (word-check.ts flags).
    const language = reading.language ?? "en";
    const flagged = await this.plugin.wordCheck.flags(file.path, page.id, words, language);
    if (this.surface === surface)
      surface.setWordFlags(
        page.id,
        flagged.map((w) => w.strokeIds),
      );
    checked.suggestions = await this.suggestFor(reading, flagged);
  }

  /**
   * The list words each flagged word's ink fits best (lexicon.ts), worked
   * out now so a tap opens its menu at once. Empty when there is no list or
   * the page was not kept.
   */
  private async suggestFor(
    reading: PageReading,
    flagged: readonly ReadWord[],
  ): Promise<Map<string, LexiconSuggestion | null>> {
    const out = new Map<string, LexiconSuggestion | null>();
    const lexicon = this.plugin.wordCheck.lexicon();
    const located = flagged.filter((w) => w.at);
    if (reading.id === undefined || !lexicon || located.length === 0) return out;
    const items = located.map((w) => {
      const at = w.at as NonNullable<ReadWord["at"]>;
      return { line: at.line, text: reading.lines[at.line].text, start: at.start, end: at.end };
    });
    try {
      const results = await this.plugin.handwriting.suggest(reading.id, items, lexicon);
      located.forEach((w, i) => out.set(strokeKey(w.strokeIds), results?.[i] ?? null));
    } catch {
      // No suggestions: the menu offers the other answers.
    }
    return out;
  }

  /** Remember a page's reading, so lassoed ink on it can use its words. */
  private keepReading(page: Page, hash: string, reading: PageReading): PageWords {
    const entry: PageWords = {
      hash,
      words: readWords(reading.lines),
      read: new Set(reading.lines.flatMap((line) => line.strokeIds)),
      lines: reading.lines.map((line) => line.text),
      readLines: reading.lines.map((line) => ({ text: line.text, words: line.words })),
      id: reading.id,
      language: reading.language ?? "en",
    };
    this.pageReadings.set(page.id, entry);
    this.searchAnswered(page.id);
    return entry;
  }

  /**
   * What search finds on a page: its kept reading with the writer's answers
   * in it (answered-reading.ts), for in-note search and, kept on this
   * device, Home's (search-store.ts). Again after each answer, so a
   * correction is found at once.
   */
  private searchAnswered(pageId: string): void {
    const entry = this.pageReadings.get(pageId);
    const path = this.file?.path;
    if (!entry || !path) return;
    const lines = entry.lines.map((text, i) => ({ text, words: entry.readLines[i]?.words ?? [] }));
    const shown = answeredTexts(lines, this.plugin.wordCheck.shownOn(path, pageId));
    entry.readLines = lines.map((line, i) => ({ text: shown[i], words: line.words }));
    saveReading(vaultKeyOf(this.app), path, pageId, { hash: entry.hash, text: shown.join("\n") });
  }

  /** A finger tapped (or a mouse right-clicked) an underlined word: ask what it says. */
  private askAboutWord(index: number, strokeIds: string[], at: { x: number; y: number }): void {
    const file = this.file;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!file || !surface || !page) return;
    const key = strokeKey(strokeIds);
    const word = this.checkedWords.get(page.id)?.words.find((w) => strokeKey(w.strokeIds) === key);
    if (!word) return;
    const suggestion = this.checkedWords.get(page.id)?.suggestions?.get(key) ?? null;
    this.openWordCard(page, word, suggestion, at, false);
  }

  /**
   * The word card (word-check.ts) for `word` on `page`, at `at` (client
   * px); `asked` when opened by hand ("Correct"). Its underline turns red
   * while it is open, and an answer is saved and acted on the same way
   * however the card was opened. `after` hooks its answer and its closing;
   * `after.inHand` false (Beautify asking, which writes the word itself):
   * the card must not also write the word in the hand.
   */
  private openWordCard(
    page: Page,
    word: ReadWord,
    suggestion: LexiconSuggestion | null,
    at: { x: number; y: number },
    asked: boolean,
    after: { done?: () => void; closed?: () => void; inHand?: boolean } = {},
  ): boolean {
    const file = this.file;
    const surface = this.surface;
    if (!file || !surface) return false;
    const ids = new Set(word.strokeIds);
    const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
    surface.setActiveWordFlag(page.id, word.strokeIds);
    const closed = () => {
      if (this.surface === surface) surface.setActiveWordFlag(null);
      after.closed?.();
    };
    this.wordPopover?.close();
    this.wordPopover = this.plugin.wordCheck.ask(
      {
        note: file.path,
        pageId: page.id,
        word,
        strokes,
        suggestion,
        language: this.pageReadings.get(page.id)?.language ?? "en",
      },
      at,
      () => {
        after.done?.();
        // Answered: search finds the answer, and the page is underlined again without it.
        this.searchAnswered(page.id);
        const checked = this.checkedWords.get(page.id);
        if (!checked || this.surface !== surface) return;
        void this.plugin.wordCheck.flags(file.path, page.id, checked.words).then((flagged) =>
          surface.setWordFlags(
            page.id,
            flagged.map((w) => w.strokeIds),
          ),
        );
      },
      closed,
      asked,
      // Beautify's own cards (inHand: false) write the word themselves: no second offer here.
      after.inHand === false
        ? undefined
        : wordInHand(
            this.plugin.writeInHand,
            surface,
            page.id,
            word.strokeIds,
            at,
            (card) => {
              this.wordPopover = card;
            },
            // Read-only or damaged: the card answers, but nothing is rewritten (no notice from here).
            () => this.isDamaged() || isReadOnly(this.doc) || isReadOnly(surface.document),
          ),
    );
    return true;
  }

  /**
   * The word card for ink on page `pageId`, as Correct opens it, for
   * Beautify's question about its unsure words (`beautify-ask.ts`): null
   * when the ink is in no word the page's reading has.
   */
  private wordCards(pageId: string): WordCardHost {
    return {
      open: async (strokeIds, after) => {
        const surface = this.surface;
        const file = this.file;
        const index = surface?.document.pages.findIndex((p) => p.id === pageId) ?? -1;
        const page = surface?.document.pages[index];
        if (!surface || !file || !page) return false;
        const hash = pageContentHash(page);
        const found = await this.readWordAt(page, hash, strokeIds).catch(() => null);
        // Closed, another file, or written on while it was read: the card would be about other ink.
        const moved =
          this.surface !== surface ||
          this.file !== file ||
          !surface.document.pages.includes(page) ||
          pageContentHash(page) !== hash;
        const at = found && !moved ? surface.wordInk(index, found.word.strokeIds) : null;
        if (!found || !at) return false;
        const opened = this.openWordCard(page, found.word, found.suggestion, at, true, {
          ...after,
          inHand: false,
        });
        // A row or a chip tapped: an answer is coming, however long its save takes.
        activeDocument
          .querySelector(".goodobsidian-wordcheck")
          ?.addEventListener("click", () => after.chosen(), { capture: true });
        return opened;
      },
      dialogOpen: () => activeDocument.querySelector(".modal-container") !== null,
    };
  }

  /**
   * "Correct" on lassoed or held ink: the card an underlined word opens,
   * for the word that ink is in, underlined or not (`wordToCorrect` picks
   * one when it is in several). The page is read on this device first when
   * its reading is not of its content now; meanwhile the picked ink is
   * underlined, so the wait shows.
   */
  private async correctWord(index: number, strokeIds: string[]): Promise<void> {
    const file = this.file;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!file || !surface || !page) return;
    this.wordPopover?.close();
    surface.setActiveWordFlag(page.id, strokeIds);
    const gone = () => this.surface !== surface || !surface.document.pages.includes(page);
    const hash = pageContentHash(page);
    let found: { entry: PageWords; word: ReadWord; suggestion: LexiconSuggestion | null } | null =
      null;
    try {
      found = await this.readWordAt(page, hash, strokeIds);
    } catch (error) {
      if (!gone()) surface.setActiveWordFlag(null);
      const missing = error instanceof Error && error.name === "ModelNotDownloadedError";
      new Notice(
        missing
          ? t("view.notice.plain", { message: errorMessage(error) })
          : t("view.word.unreadable"),
        8000,
      );
      return;
    }
    // Written on, scrolled away or closed while it was read: the card would be about other ink.
    if (gone() || pageContentHash(page) !== hash) {
      if (!gone()) surface.setActiveWordFlag(null);
      return;
    }
    // Several words lassoed: the whole sentence, in one field.
    const words = found ? selectionWords(found.entry.words, found.entry.read, strokeIds) : null;
    if (found && words && words.length > 1) {
      surface.setActiveWordFlag(null);
      this.correctWords(page, found.entry, words);
      return;
    }
    const at = found ? surface.wordInk(index, found.word.strokeIds) : null;
    if (!found || !at) {
      surface.setActiveWordFlag(null);
      new Notice(t("view.word.none"));
      return;
    }
    this.openWordCard(page, found.word, found.suggestion, at, true);
  }

  /**
   * "Correct" on a lassoed sentence: what the page's reading says of
   * `words`, a line for each line, to correct in one field; each word
   * changed is recorded as a misread of its ink (`recordEdits`).
   */
  private correctWords(page: Page, entry: PageWords, words: ReadWord[]): void {
    const modal = new InkTextModal(
      this.app,
      (text) => {
        if (this.file && this.surface?.document.pages.includes(page)) {
          this.recordEdits(page, words, text, true);
        }
      },
      true,
    );
    modal.open();
    const text = wordsByLine(words);
    modal.suggest(text);
    void this.spellingFixes(page, entry, words).then((fixes) => {
      if (fixes.length > 0) modal.suggest(text, fixes);
    });
  }

  /**
   * The read word for "Correct" and its list words: from the page's kept
   * reading when it is of `hash`, else from reading it now (kept, so the
   * worker can suggest). Null when the ink is in no read word.
   */
  private async readWordAt(
    page: Page,
    hash: string,
    strokeIds: readonly string[],
  ): Promise<{ entry: PageWords; word: ReadWord; suggestion: LexiconSuggestion | null } | null> {
    const file = this.file;
    if (!file) return null;
    let entry = this.pageReadings.get(page.id);
    let fresh = false;
    for (;;) {
      if (!entry || entry.hash !== hash) {
        entry = this.keepReading(
          page,
          hash,
          await this.plugin.handwriting.readPage(
            page.strokes,
            true,
            await this.readingContext(page),
          ),
        );
        fresh = true;
      }
      await this.plugin.wordCheck.load();
      // Of several words, the one the word check underlines comes first.
      const flagged = this.wordsChecked
        ? await this.plugin.wordCheck.flags(file.path, page.id, entry.words)
        : [];
      const word = wordToCorrect(
        entry.words,
        strokeIds,
        new Set(flagged.map((w) => strokeKey(w.strokeIds))),
      );
      if (!word) return null;
      const suggestion = await this.listWordsFor(page, entry, word);
      // The worker no longer keeps this reading: read the page again, once.
      if (suggestion === undefined && !fresh) {
        entry = undefined;
        continue;
      }
      return { entry, word, suggestion: suggestion ?? null };
    }
  }

  /**
   * The list words `word`'s ink fits best (lexicon.ts): the underline's
   * own when its page was checked at this reading, else asked of the
   * worker. Null without a word list or a place in the reading; undefined
   * when the worker no longer keeps the reading.
   */
  private async listWordsFor(
    page: Page,
    entry: PageWords,
    word: ReadWord,
  ): Promise<LexiconSuggestion | null | undefined> {
    const key = strokeKey(word.strokeIds);
    const checked = this.checkedWords.get(page.id);
    const cached = checked?.hash === entry.hash ? checked.suggestions?.get(key) : undefined;
    if (cached !== undefined) return cached;
    const lexicon = this.plugin.wordCheck.lexicon();
    // A page in another language: the worker answers from its pack's list, or with nothing.
    if (!lexicon || !word.at) return null;
    if (entry.id === undefined) return undefined;
    const { line, start, end } = word.at;
    try {
      const results = await this.plugin.handwriting.suggest(
        entry.id,
        [{ line, text: entry.lines[line], start, end }],
        lexicon,
      );
      return results === null ? undefined : (results[0] ?? null);
    } catch {
      // No list words: the card offers the other answers.
      return null;
    }
  }

  private async offerHandwrittenLinks(page: Page, reading: PageReading): Promise<void> {
    const surface = this.surface;
    if (!surface) return;
    const bracketed = reading.lines.filter(
      (line) => line.text.includes("[") || line.greedy.includes("["),
    );
    const found: HandwrittenLink[] = [];
    if (bracketed.length > 0) {
      // The worker found the words: finding them again here would block the
      // main thread for as long as a dense page takes to segment.
      const ink = new Map(inkForReading(page.strokes).map((s) => [s.id, s]));
      for (const read of bracketed) {
        const groups = read.words
          .map((word) => word.flatMap((id) => ink.get(id) ?? []))
          .filter((group) => group.length > 0);
        if (groups.length === 0) continue;
        try {
          const words = await this.plugin.handwriting.readGroups(groups);
          found.push(
            ...findHandwrittenLinks(
              words.map((w, i) => ({
                text: w.text,
                greedy: w.greedy,
                strokeIds: groups[i].map((s) => s.id),
              })),
            ),
          );
        } catch {
          return;
        }
      }
    }
    if (this.surface === surface && this.doc.pages.includes(page)) {
      surface.setLinkSuggestions(page.id, found);
    }
  }

  /**
   * Automatic transcription, a setting that is off by default: every change
   * to the ink restarts a wait of AUTO_RECOGNIZE_IDLE_MS, and when the wait
   * runs out the pages written on since the last run are transcribed (a few
   * at a time, `autoTranscriptionBatch`), wherever the view has scrolled to
   * meanwhile. It cannot ask for consent, so it is only armed for an engine
   * that needs the network once the user has agreed to send to the chosen
   * vendor's kind of destination: a cloud service and the user's own
   * endpoint are agreed to separately. A page whose content has not changed
   * since its last transcription costs nothing (see `transcribe`).
   *
   * `changed` is the ids of the pages an edit touched; without them (an
   * edit that does not say), the page in view.
   */
  private scheduleAutoTranscription(
    changed?: readonly string[],
    delay = AUTO_RECOGNIZE_IDLE_MS,
  ): void {
    window.clearTimeout(this.transcribeTimer);
    const { autoRecognize, llmVendor, transcribeVendor } = this.settings;
    const armed =
      autoRecognize &&
      this.plugin.activeProvider().requiresNetwork &&
      this.plugin.consentedTo(resolveTranscribeVendor(transcribeVendor, llmVendor));
    if (!armed) {
      this.autoPages.clear();
      return;
    }
    if (changed && changed.length > 0) {
      for (const id of changed) this.autoPages.add(id);
    } else if (changed) {
      const current = this.doc.pages[this.surface?.currentPage ?? 0];
      if (current) this.autoPages.add(current.id);
    }
    if (this.autoPages.size === 0) return;
    const transcribeNow = (): void => void this.plugin.runRecognition(this, true);
    this.transcribeTimer = window.setTimeout(transcribeNow, delay);
  }

  /**
   * Open or close the text layer. Opening shows the body as it is now and
   * puts the cursor in it; the pages then lay out in the height that is left.
   */
  /**
   * "Export notebook as one file" (#274): a copy of the notebook as it is
   * shown, in the single-file layout, beside it, for a device whose
   * FineNotes cannot read page files yet. A copy, not a mode: the notebook
   * itself stays as it is.
   */
  async exportOneFile(): Promise<void> {
    const file = this.file;
    if (!file || this.guard.locked) return;
    const suffix = inkFileSuffix(file.name) ?? ".md";
    // Beside a notebook's own folder, not in it: that folder holds one notebook.
    const own = file.parent?.name === stripInkSuffix(file.name) ? file.parent : null;
    const parent = own ? own.parent : file.parent;
    const folder = parent?.path ?? "";
    const taken = new Set(parent?.children.map((child) => child.name) ?? []);
    const base = t("notebooks.exportOneFile.name", { title: stripInkSuffix(file.basename) });
    const name = uniqueFileName(base, suffix, taken);
    const path = normalizePath(folder && folder !== "/" ? `${folder}/${name}` : name);
    try {
      await this.app.vault.create(path, buildInkFile(this.syncedBody(), this.doc));
      new Notice(t("notebooks.export.savedOne", { path }));
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  toggleTextPanel(): void {
    this.textPanelOpen = !this.textPanelOpen;
    const panel = this.textPanel;
    if (!panel) return;
    panel.setOpen(this.textPanelOpen);
    if (this.textPanelOpen) {
      panel.load(this.noteBody);
      panel.field.focus();
    }
    this.surface?.layout();
  }

  // --- Building the view -----------------------------------------------------

  private buildDom(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("goodobsidian-view");

    // Ink colours are absolute: pages are paper-white whatever Obsidian's
    // theme, so the default ink must not follow the theme either (dark ink
    // turned white on a dark theme would vanish on the page). How dark the
    // paper is, is chosen per notebook, in the toolbar.
    const palette = [...PALETTE, ...this.settings.customColors];
    this.toolbar = new Toolbar(
      root,
      palette,
      SIZES,
      this.toolState,
      {
        returnToPenOnReselect: () => this.settings.returnToPenOnReselect === true,
        onToolChange: (tool) => {
          this.surface?.setTool(tool);
          if (tool === "text" && this.surface) this.plugin.offerTextHint(this.surface);
          // Picked from the bar: the slow way to a lasso or a shape.
          if (tool === "select") this.noteUse("lasso.tool");
          else if (tool === "shape") this.noteUse("shape.tool");
        },
        // The toolbar writes colour and size into the shared tool state,
        // which is where the surface reads them; the pen is remembered for
        // the next notebook (FineNotes#24).
        onColorChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onSizeChange: () => {
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        onLaserColorChange: (color) => {
          this.settings.laserDefaultColor = color;
          void this.plugin.saveSettings();
        },
        onPressureToggle: () => this.updateSidebarRendering(),
        pressureAllowed: () => this.settings.pressureWidth,
        onUndo: () => {
          this.surface?.undo();
          this.noteUse("undo.button");
        },
        onRedo: () => {
          this.surface?.redo();
          this.noteUse("redo.button");
        },
        onClear: () => this.clearPage(),
        onAddPage: (anchor) => {
          this.openAddPage(anchor, this.surface?.currentPage ?? 0, "after");
          this.noteUse("page.button");
        },
        onPenTypeChange: () => {
          this.toolbar?.syncActive();
          this.surface?.refreshPenCursor();
          this.rememberPen();
        },
        savedPens: () => savedPensOf(this.settings.savedPens),
        onReorderPens: (pens) => this.plugin.saveSavedPens(pens),
        onDeletePen: (id) =>
          this.plugin.saveSavedPens(
            savedPensOf(this.settings.savedPens).filter((pen) => pen.id !== id),
          ),
        onSavePen: (pen) =>
          this.plugin.saveSavedPens(addSavedPen(savedPensOf(this.settings.savedPens), pen)),
        onNewPen: (start, onMade) => this.openNewPen(start, onMade),
        onEditPens: () => this.plugin.openSettingsTab(),
        onRuler: () => {
          const surface = this.surface;
          if (!surface) return;
          surface.setRulerOut(!surface.rulerOut);
          this.toolbar?.setRulerOut(surface.rulerOut);
        },
        onRulerChange: (kind, snap) => {
          // Picking a kind or a snapping in the popover means using the ruler.
          this.surface?.setRulerOut(true);
          this.toolbar?.setRulerOut(this.surface?.rulerOut ?? false);
          this.plugin.saveRuler(kind, snap);
        },
        onEraserChange: (mode, size) => this.plugin.saveEraser(mode, size),
        sizePreviewScales: () => this.surface?.sizePreviewScales() ?? { pen: 1, eraser: 1 },
        paintSizePaper: (canvas, width, height) =>
          this.surface?.paintPaperSample(canvas, width, height) ?? false,
        onEraserFilterChange: (filter) => this.plugin.saveEraserFilter(filter),
        onEraserGreyChange: (on) => this.plugin.saveEraserGrey(on),
        onLassoChange: (mode, filter) => {
          this.surface?.refreshLassoChrome();
          this.plugin.saveLasso(mode, filter);
        },
        onToggleThumbnails: () => this.toggleSidebar(),
        onHome: () => void this.plugin.openLibrary(),
        onFullScreen: this.plugin.fullScreenOffered
          ? () => this.plugin.toggleFullScreen()
          : undefined,
        onTextStyle: (patch) => this.surface?.applyTextStyle(patch),
        onTextFieldDone: (to) => this.surface?.textFieldDone(to),
        onTextSizePreview: (fontSize) => this.surface?.previewTextSize(fontSize),
        onTextList: (kind) => void this.surface?.applyTextList(kind),
        onTextDelete: () => void this.surface?.deleteEditingTextBox(),
        onPenGesturesChange: (gestures) => this.plugin.savePenGestures(gestures),
        onShapeColorChange: (color) => {
          this.surface?.refreshPenCursor();
          this.plugin.saveShapeColor(color);
        },
        onShapeStyleChange: (style) => this.plugin.saveShapeStyle(style),
        onFillGapChange: (gap) => this.plugin.saveFillGap(gap),
        onFillColorChange: (color) => this.plugin.saveFillColor(color),
        onTapeChange: (color, height, mode, heights) =>
          this.plugin.saveTape(color, height, mode, heights),
        onTapeSnapTextChange: (on) => this.plugin.saveTapeSnapText(on),
        tapesShown: () => this.surface?.tapesShown() ?? null,
        onShowTapes: (shown) => this.surface?.showTapes(shown),
        onTableHeaderChange: (on) => this.plugin.saveTableHeader(on),
        onRecentColors: (colors) => this.plugin.saveRecentColors(colors),
        onPickFromPage: (done) => {
          if (this.surface) this.surface.pickColorFromPage(done);
          else done(null);
        },
        onPenColors: (colors) => this.plugin.savePenColors(colors),
        onPenTypeOrder: (order) => this.plugin.savePenTypeOrder(order),
        onPenInks: (inks) => this.plugin.savePenInks(inks),
        onWidthPresets: (presets) => this.plugin.saveWidthPresets(presets),
        onEraserPresets: (presets) => this.plugin.saveEraserPresets(presets),
        onPenStabilization: (all) => this.plugin.savePenStabilization(all),
        penPreferences: () => penPreferencesOf(this.settings),
        onPenPreferences: (patch) => this.plugin.savePenPreferences(patch),
        onTextToolChange: (style, pinned, dragSize) =>
          this.plugin.saveTextTool(style, pinned, dragSize),
        onInsertImage: (anchor) => this.openImageMenu(anchor),
        onStickers: () => {
          if (!this.isProtected() && this.file)
            this.plugin.openStickerPicker(this.imageMenuContext());
        },
        onStickyColor: (color) => this.armStickyNote(color),
        onStickyCancel: () => this.armStickyNote(null),
        onLayout: (layout) => this.plugin.saveToolbarLayout(layout),
        onLeavePdfTab: () => this.showTab(NOTES_TAB),
        onSetBarDock: (dock) => this.plugin.setBarDock(dock),
        onSetPillRow: (on) => this.plugin.setPillRow(on),
        onSetPreset: (preset) => this.plugin.setToolbarPreset(preset),
        lookNow: () => ({
          style: lookStyleOf(this.plugin.settings.lookStyle),
          palette: lookPaletteOf(this.plugin.settings.lookPalette),
        }),
        onSetLook: (style, palette) => void this.plugin.setLook(style, palette, false),
        onInsertPdf: (anchor) => this.openImageMenu(anchor, true),
        onAi: (anchor) => this.openAiMenu(anchor),
        onCalculator: () => this.toggleCalculator(),
        onTranslate: () => this.openTranslate(null),
        // Inside the tap: the microphone is only granted from a user gesture.
        onRecord: () => this.audio?.toggleRecording(),
        onSettings: () => this.openNoteSettings(),
        onShare: () => this.exportPdf(),
        onSearch: () => void this.openSearch(),
        onMore: (anchor) => this.toggleMorePanel(anchor),
        onLearnHandwriting: () => this.plugin.openLearnWindow(),
        onPillPlaced: () => this.surface?.placeToasts(),
        onPillDock: (dock) => this.plugin.setPillDock(dock),
        onPillRow: (shift) => this.surface?.followTopShift(shift),
        onOnlyStylusMode: (on) => void this.plugin.setOnlyStylusMode(on),
        onZoomIn: () => this.surface?.zoomIn(),
        onZoomOut: () => this.surface?.zoomOut(),
        onZoomFit: () => this.surface?.resetView(),
        onZoomBox: (on) => {
          this.surface?.setZoomBox(on);
          if (this.settings.magnifierZoomBox !== on) {
            this.settings.magnifierZoomBox = on;
            void this.plugin.saveSettings();
          }
        },
        onZoomBoxOpen: (open) => {
          if (open) this.surface?.openPlacedZoomBox();
          else this.surface?.closeZoomBox(true);
        },
      },
      {
        defaultSize: this.settings.defaultSize,
        reservedColors: [this.settings.defaultColor, ...this.settings.customColors],
        pillDock: this.plugin.pillDock,
        barDock: this.plugin.barDock,
        pillRow: this.plugin.pillRow,
        preset: this.plugin.pillRow === true ? this.settings.toolbarPreset : "own",
        layout: this.toolbarLayout(),
        onlyStylusMode: this.plugin.stylusOnly,
        fingerDrawing: this.plugin.fingerDrawing,
        laserColor: () => this.settings.laserDefaultColor,
      },
    );
    // The PDF tabs, under the bar (above the page), hidden until a PDF is attached.
    this.pdfTabs = new PdfTabStrip(root, {
      onSelect: (id) => this.showTab(id),
      onClose: (id) => this.closeTab(id),
      onRename: (id) => this.renameTabAsked(id),
      onFindFile: (id) => this.findTabFile(id),
      onPlus: (anchor) => this.togglePdfTabsPopover(anchor),
      onCollapse: (collapsed) => {
        this.setDeviceFlag(STRIP_COLLAPSED_KEY, collapsed);
        // The pill and the text bar measure from below the strip (toolbar.ts, pillArea).
        this.toolbar?.applyPosition();
      },
    });
    this.pdfTabs.setCollapsed(this.deviceFlag(STRIP_COLLAPSED_KEY));
    // The pill rests below the strip while it shows.
    this.toolbar.setPageTop(this.pdfTabs.el);
    this.toolbar.setHomeDot(this.plugin.hasNews());
    this.toolbar.setNewsItems(this.plugin.newsControlIds(), (id) =>
      this.plugin.markNewsControlUsed(id),
    );
    this.showFullScreen(this.plugin.fullScreen);
    // The gear's dot while a newer FineNotes is out, and "Update available"
    // under it until it is tapped or closed, again every other day until the
    // update is in (update-notice.ts). A tap goes straight to Obsidian's Update.
    const updates = this.plugin.updates;
    const markUpdate = (): void => {
      this.toolbar?.setUpdateMark(updates.available);
      const version = updates.pendingAnnouncement();
      if (!version) {
        // "Don't show again", or checking switched off, while it showed.
        this.toolbar?.hideUpdateTip();
        return;
      }
      // After the bar is laid out; if it is not yet, the next change or open says it.
      window.setTimeout(() => {
        if (updates.pendingAnnouncement() !== version) return;
        this.toolbar?.showUpdateTip(
          () => {
            updates.announced(version);
            this.plugin.openUpdatePage();
          },
          () => updates.announced(version),
        );
      }, UPDATE_TIP_DELAY_MS);
    };
    markUpdate();
    this.unwatchUpdates?.();
    this.unwatchUpdates = updates.subscribe(markUpdate);

    const pdfCache = new PdfBackdropCache(this.app);
    this.pdfCache = pdfCache;
    // PDF pages render in the shared background worker once it is up (and
    // on this thread until then, or for good if it cannot start here).
    if (!this.pdfWorkerHeld) {
      this.pdfWorkerHeld = true;
      void acquirePdfWorker().then((worker) => {
        if (worker && this.pdfCache === pdfCache) {
          this.pdfWorker = worker;
          pdfCache.setWorker(worker);
          this.pdfText?.setWorker(worker);
          this.surface?.refreshPdfDetail();
        }
      });
    }
    this.backdrops = new VaultBackdropRenderer(this.pdfCache);
    this.thumbBackdrops = new VaultBackdropRenderer(this.pdfCache);
    this.thumbBackdrops.setDeviceScale(
      thumbnailRasterScale(winOf(this.contentEl).devicePixelRatio || 1),
    );
    this.images = new VaultImageCache(this.app);

    const body = root.createDiv({ cls: "goodobsidian-body" });
    this.sidebar = new PageSidebar(
      body,
      {
        // A tapped thumbnail glides to its page, as GoodNotes does; from the
        // overview, which covered the page, it is simply there.
        onSelectPage: (index, fromOverview) => this.surface?.goToPage(index, !fromOverview),
        onPageAction: (action, index, anchor) => this.pageAction(action, index, anchor),
        onSelectSection: (index, section, fromOverview) =>
          this.surface?.goToPagePoint(index, section.y, !fromOverview, section.x),
        onSectionAction: (action, index, section) => this.sectionAction(action, index, section),
        onContentsLevel: (at, delta) => this.shiftContentsLevel(at, delta),
        onMoveContents: (at, gap, level) => this.moveContents(at, gap, level),
        onNewChapter: (index) => this.newChapter(index),
        onChapterAction: (action, index, chapter) => this.chapterAction(action, index, chapter),
        onAddPage: (anchor) => this.openAddPage(anchor, this.doc.pages.length - 1, "last"),
        onClose: () => {
          if (this.sidebar?.isOpen) this.toggleSidebar();
        },
        // A PDF's tab: its slides are the PDF's, shown but not edited.
        canEdit: () => !this.isProtected() && !this.onPdfTab,
        onMovePages: (indexes, gap) => this.movePages(indexes, gap),
        onSelectionAction: (action, indexes) => this.selectionAction(action, indexes),
        // The options pill floats over the page, which the overview covers.
        pageSnapshot: () => this.surface?.snapshotPage() ?? null,
        onOverviewChange: (open) => {
          root.toggleClass("goodobsidian-overview-open", open);
          if (!open) this.closeSidebarAfterOverview();
        },
        listFiles: (kind) => this.listNotebookFiles(kind),
        onOpenFile: (kind, row) => this.openNotebookFile(kind, row),
        onFileKind: (kind) => (lastFileKind = kind),
        pageTranscripts: () =>
          pageTranscriptViews(readTextSection(this.noteBody), pageKeys(this.doc.pages)),
        onTranscript: (key, action) => this.transcriptAction(key, action),
      },
      this.sidebarRendering(this.thumbBackdrops),
    );
    this.sidebar.setFileKind(lastFileKind);
    this.sidebar.setDocument(this.doc);
    // Search's sidebar docks right of the page, once the page is in the body.
    this.searchBody = body;
    // Between the page sidebar and the page, which it pushes aside.
    this.chatPanel = new AskChatPanel(this.app, body, {
      host: () => this.askHost(),
      onClose: () => this.setChatPanel(false),
      switchLayout: () => {
        this.setChatPanel(false);
        this.setAskLayout("window");
        this.openAsk();
      },
    });

    this.surface = new InkSurface(
      body,
      this.doc,
      this.toolState,
      {
        desynchronizedCanvas: this.settings.desynchronizedCanvas,
        highlighterAlpha: this.settings.highlighterAlpha,
        debug: this.showHud,
        palette,
        paper: this.shownPaper(),
        laserColor: () => this.settings.laserDefaultColor,
      },
      {
        onRecentColors: (colors) => this.plugin.saveRecentColors(colors),
        onSaveSticker: (png, width, height) => void this.saveSticker(png, width, height),
        onScreenshot: (png, width, height, at) =>
          at
            ? void this.screenshotSelection({ png, width, height }, at.pageIndex, at.bounds)
            : this.showScreenshot({ png, width, height }),
        onAskAboutSelection: (index, bounds) => void this.askAboutSelection(index, bounds),
        canAskAi: () => textAvailability(this.plugin.aiSetup()).enabled,
        onTranslate: (target) => this.openTranslate(target),
        onRegionScreenshot: (index, bounds) => void this.screenshotRegion(index, bounds),
        // Snippets: an area of a slide dragged from its tab onto the notes.
        onSnippetStart: (index, area, viewScale) => this.startSnippet(index, area, viewScale),
        snippetHintOnce: () => this.deviceFlagOnce(SNIPPET_HINT_KEY),
        onSnippetMove: (x, y) => this.hoverSnippet(x, y),
        onSnippetEnd: (drop) => void this.dropSnippet(drop),
        snippetLanding: (index) => this.snippetLanding(index),
        onOpenSlide: (slide) => this.openSlide(slide),
        slideTabName: (tab) => {
          const beside = findBeside(this.doc, tab);
          return beside ? tabLabel(beside) : "PDF";
        },
        onEditGraph: (pageId, graph) => this.editGraph(pageId, graph),
        onEquation: (pageId, at, equation) => this.openEquation(pageId, at, equation),
        onChange: (pages) => {
          if (this.surface) this.sidebar?.setDocument(this.surface.document);
          // Undoing or redoing "Convert to notebook" flips `single`.
          this.syncSingle();
          // …and undo can take a recording off the note, or bring one back.
          this.audio?.syncChrome();
          this.scheduleAutoTranscription(pages ?? []);
          this.scheduleDeviceReading();
          this.columnNotes.pagesChanged(pages);
          // Ink on a PDF's tab is the notebook's: its pages with marks go in.
          if (this.onPdfTab) this.syncTabMarks();
          this.requestSaveOf(pages);
          this.relinkMovedFiles();
          this.companion.changed();
          // An undo, redo or edit may take Ask AI's changes back, or touch them.
          this.notifyAskChanges();
        },
        // The zoom or the screen changed: keep PDF pages as sharp as the ink.
        onStatus: () => {
          this.matchPdfResolution();
          this.scheduleTabView();
        },
        onZoomBoxChange: (open) => this.toolbar?.setZoomBoxOpen(open),
        onPen: (down) => {
          this.penActivity(down);
          this.returnPenOptions(down);
        },
        onGestureStart: (tool, lent) => {
          if (tucksOnWrite(this.settings.tuckPenOptionsOnWrite, tool, lent)) {
            this.toolbar?.tuckOptions();
          }
        },
        onStrokeDrawn: (pageId) => {
          this.calcNotes.strokeDrawn(pageId);
          this.columnNotes.strokeDrawn(pageId);
        },
        onHistoryStep: (command, redo) => {
          this.calcNotes.historyStep(command, redo);
          this.columnNotes.historyStep(command, redo);
        },
        onPenShape: () => {
          if (this.surface) this.plugin.offerShapeHint(this.surface);
          this.noteUse("shape.hold");
        },
        isLocked: () => this.isProtected(),
        returnToPenOnReselect: () => this.settings.returnToPenOnReselect === true,
        returnToPenAfterUse: () => this.settings.returnToPenAfterUse === true,
        straightenHighlighter: () => this.settings.straightHighlighter !== false,
        highlighterSnapsToText: () => this.settings.highlighterSnapText !== false,
        highlighterTip: () => highlighterTipOf(this.settings.highlighterTip),
        pencilTilt: () => this.settings.pencilTilt === true,
        textDragSize: () => this.settings.textDragSize === true,
        fingerTapUndo: () => this.settings.fingerTapUndo !== false,
        lassoAnyPart: () => this.settings.lassoTouches !== false,
        onlyStylusMode: () => this.plugin.stylusOnly,
        fingerDrawing: () => this.plugin.fingerDrawing,
        onPenReturned: () => this.plugin.setFingerDrawing(false),
        zoomBoxLineStep: () => this.settings.zoomBoxLineStep,
        zoomBoxAutoAdvance: () => this.settings.zoomBoxAutoAdvance === true,
        zoomBoxAutoAdvanceThreshold: () => this.settings.zoomBoxAutoAdvanceThreshold,
        onZoomBoxAutoAdvance: (on) => {
          this.settings.zoomBoxAutoAdvance = on;
          void this.plugin.saveSettings();
        },
        onZoomBoxSettings: ({ lineStep, threshold }) => {
          if (lineStep !== undefined) this.settings.zoomBoxLineStep = lineStep;
          if (threshold !== undefined) this.settings.zoomBoxAutoAdvanceThreshold = threshold;
          void this.plugin.saveSettings();
        },
        onShortcuts: () => this.toggleShortcuts(),
        shortcuts: () => this.plugin.shortcuts.table,
        onShortcutAction: (id) => this.runShortcutAction(id),
        onSavedPen: (index) => {
          const pen = savedPensOf(this.settings.savedPens)[index];
          // On its own button if it has one on the bar, as a tap there (#226).
          if (pen && !this.isProtected()) this.toolbar?.pressPenKey({ saved: pen.id ?? null }, pen);
        },
        barrelAction: () => this.settings.barrelButton,
        // The Apple Pencil has no side button, and a Pencil tap on the tool
        // bar could pass for its click (`stylus-click.ts`).
        stylusClick: () => (Platform.isIosApp ? "none" : this.settings.stylusButtonClick),
        onStylusClick: () => {
          if (this.isProtected()) return;
          if (this.settings.stylusButtonClick === "eraser") this.surface?.stylusEraserClick();
          else this.toolbar?.togglePenMenu();
        },
        onToolChange: (tool) => {
          this.toolbar?.setState(this.toolState);
          if (tool === "text" && this.surface) this.plugin.offerTextHint(this.surface);
        },
        onSizeScale: () => this.toolbar?.refreshSizeMarks(),
        onTapesToggled: () => this.toolbar?.refreshTape(),
        onPageChange: (index) => {
          this.pageShown(index);
          this.toolbar?.refreshTape();
          this.sidebar?.setCurrentPage(index);
          this.scheduleLastPage();
          this.scheduleTabView();
          // Words are checked in the notes, not on a PDF's slides.
          if (!this.onPdfTab) this.scheduleWordCheck();
          this.focusPdfText(index);
          this.presenter?.refresh();
        },
        onFlaggedWord: (index, strokeIds, at) => this.askAboutWord(index, strokeIds, at),
        onCorrectWord: (index, strokeIds) => void this.correctWord(index, strokeIds),
        onNeaten: (request) =>
          this.plugin.neaten.run({
            ...request,
            note: this.file?.path,
            ask: (words) => askUnsureWords(this.wordCards(request.pageId), words, request.stop),
          }),
        canNeaten: () => this.plugin.neaten.available(),
        onWriteInHand: (pageId, boxId) =>
          this.surface
            ? this.plugin.writeInHand.turnTextBox(this.surface, pageId, boxId, () =>
                this.isProtected(),
              )
            : Promise.resolve(),
        canWriteInHand: (box) =>
          this.settings.handwritingOnDevice !== false && this.plugin.writeInHand.canTurn(box),
        canCorrectWords: () => this.settings.handwritingOnDevice !== false,
        onReadingPoint: (index, y) => {
          this.sidebar?.setReadingPoint(index, y);
          this.scheduleTabView();
          // A board never changes page: where it was left is where it was scrolled.
          if (this.showingBoard) this.scheduleLastPage();
        },
        onAddSection: (index, at, strokeIds) => this.addSection(index, at, strokeIds),
        onAddRegion: (index, bounds, strokeIds) => this.addRegion(index, bounds, strokeIds),
        onTapRegion: (shown, anchor) => this.regionMenu(shown, anchor),
        onLinkStrokes: (index, strokeIds, current) => this.linkInk(index, strokeIds, current),
        onMakeTask: (index, strokeIds) => this.makeInkTask(index, strokeIds),
        onTurnIntoText: (index, strokeIds) => this.turnIntoText(index, strokeIds),
        onOpenLink: (target) => this.openInkLink(target),
        onTapComment: (index, comment) => this.openComment(index, comment),
        onAddComment: (index, at) => {
          if (this.isProtected() || this.refuseOnPdfTab()) return;
          new CommentModal(this.app, null, index + 1, {
            save: (text) => this.addComment(index, at, text, "you"),
          }).open();
        },
        onSuggestedLink: (index, strokeIds, target) => this.linkInk(index, strokeIds, null, target),
        onHistoryChange: (canUndo, canRedo) => {
          this.toolbar?.setHistoryState(canUndo, canRedo);
          // A line copied or erased on a practice sheet: its Learn button counts it.
          this.syncLearnButton();
        },
        onAddPageRequested: (afterIndex) => this.addPage(afterIndex, true),
        // Pulled past the last page: a blank page on the last page's paper,
        // then glide onto it, as GoodNotes does.
        onPullAddPage: () => {
          this.addPage(this.doc.pages.length - 1, true);
          this.noteUse("page.pull");
        },
        onUse: (event) => this.noteUse(event),
        onPinchOverview: (snapshot) => this.openOverviewFromPinch(snapshot),
        onZoomMotion: (moving) => this.pdfCache?.setHeld(moving, "zoom"),
        onTextEditing: (style) => this.toolbar?.setTextTarget(style),
        onTextAnchor: (rect) => this.toolbar?.setTextAnchor(rect),
        textPillState: () => this.toolbar?.textPillState ?? "-",
        diskState: () => {
          const { own, empty, merged, carried, replaced } = this.diskReloads;
          return `own${own}/empty${empty}/merged${merged}+${carried}/replaced${replaced}`;
        },
        // A copied picture also goes to the system clipboard, for other apps;
        // one pasted from there comes in as any other picture does.
        onCopyImage: (image) => copyPictureToSystemClipboard(this.app, image),
        onPasteImage: (file, at) => void this.pastePictureFile(file, at),
        toolOff: (tool) => {
          // A PDF's tab has its own few tools.
          if (this.onPdfTab && !isPdfTabTool(tool)) return true;
          const item = barItemOfTool(tool);
          return item !== null && this.itemOff(item);
        },
        onPenShortcut: (tool) => {
          if (!this.toolbar) return false;
          this.toolbar.pressPenKey(tool);
          return true;
        },
      },
    );
    this.surface.setBackdropPainter(this.backdrops);
    this.toolbar?.setNight(this.surface.paperTheme.night === true);
    this.surface.toastChrome = () => this.toolbar?.chromeSpans() ?? [];
    this.surface.setNotebookTitle(this.notebookTitle());
    this.setPenCursor(this.settings.penCursor);
    this.surface.setInkPressure(this.settings.pressureWidth);
    this.surface.setFreePageEdges(this.settings.freePageEdges);
    this.surface.holdFitWidth = () => this.settings.holdFitWidth;
    this.pdfText?.destroy();
    this.pdfText = new PdfTextCache(this.app, this.plugin.ocr);
    this.pdfText.setWorker(this.pdfWorker);
    // A finger tap on a PDF link that waited for the page to be read; and a
    // page that was read again with its OCR text is searched again.
    this.pdfText.onReady = (path, page) => {
      const known = this.pdfSearchText.delete(`${path}:${page}`);
      this.surface?.pdfTextReady(path, page);
      // Read again (its OCR text came): what Home's search keeps follows it.
      if (known) void this.readPdfSearchText(this.pdfPagesOf(path, page), undefined, 0, false);
    };
    this.surface.setTextSource(this.pdfText);
    // The page the notebook opens on: a scan there is read first.
    const openedText = this.pdfText;
    window.setTimeout(() => {
      if (this.pdfText === openedText) this.focusPdfText(this.surface?.currentPage ?? 0);
    }, OCR_OPEN_DELAY_MS);
    // Audio (0.5). Strokes are stamped on the recorder's clock, so ink and
    // audio share one timeline even if the wall clock jumps mid-recording.
    const audio = new NoteAudio({
      app: this.app,
      plugin: this.plugin,
      file: () => this.file,
      surface: () => this.surface,
      toolbar: () => this.toolbar,
      isLocked: () => this.guard.locked,
      insertText: (text) => this.insertAnswer(text, true),
    });
    this.audio = audio;
    // The recordings live in the page sidebar's Audio tab, as in GoodNotes.
    audio.attachPanel(this.sidebar.audioEl);
    this.surface.setClock(() => audio.now());
    // A tool remembered from before its button was turned off is not taken up.
    this.endOffItemEffects();
    this.bindWindowEvents(root);
    this.register(onWindowMoved(root, () => this.bindWindowEvents(root)));
    this.register(() => this.windowEventsOff?.());
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => this.lastPageFileMoved(oldPath, file.path)),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.lastPageFileMoved(file.path, null)),
    );
    // A file of a notebook kept as one file per page per device synced in or changed.
    this.registerEvent(this.app.vault.on("create", (file) => this.devicePageChanged(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.devicePageChanged(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.devicePageChanged(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.devicePageChanged(file.path);
        this.devicePageChanged(oldPath);
      }),
    );
    // Only what shows the page that landed is redrawn (FineNotes#1).
    this.pdfCache.onReady = (path, page, area) => {
      this.surface?.pdfPageReady(path, page, area);
      if (!area?.region) this.sidebar?.invalidatePdfPage(path, page);
      // My templates' previews in an open template picker or Add page popover.
      if (!area?.region) this.templatePicker?.paperReady(path);
      if (!area?.region) this.addPagePopover?.popover.paperReady(path);
    };
    this.backdrops.setDeviceScale(this.surface.deviceScale);
    this.surface.setImagePainter(this.images);
    // A decoded picture repaints only the tiles and thumbnails that show it.
    this.images.onReady = (path) => {
      this.surface?.imageReady(path);
      this.sidebar?.invalidateImage(path);
    };
    // A picture's file changing under a placed image (synced in, replaced,
    // deleted, renamed away) makes it decode afresh, or show as missing.
    const imageFileChanged = (path: string): void => {
      if (!isImagePath(path) || !this.images?.forget(path)) return;
      this.surface?.imageReady(path);
      this.sidebar?.invalidateImage(path);
    };
    this.registerEvent(this.app.vault.on("create", (file) => imageFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => imageFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => imageFileChanged(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        imageFileChanged(oldPath);
        imageFileChanged(file.path);
      }),
    );
    // Likewise a PDF: one moved back, or synced in, is read again instead
    // of staying "missing".
    const pdfFileChanged = (path: string): void => {
      if (/\.pdf$/i.test(path)) {
        this.pdfText?.forget(path);
        for (const key of [...this.pdfSearchText.keys()])
          if (key.startsWith(`${path}:`)) this.pdfSearchText.delete(key);
      }
      // A PDF's tab turns grey when its file goes, and back when it returns.
      if (/\.pdf$/i.test(path)) this.syncPdfTabs();
      if (!/\.pdf$/i.test(path) || !this.pdfCache?.forget(path)) return;
      this.surface?.repaint();
      this.sidebar?.invalidate();
    };
    this.registerEvent(this.app.vault.on("create", (file) => pdfFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => pdfFileChanged(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => pdfFileChanged(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        pdfFileChanged(oldPath);
        pdfFileChanged(file.path);
      }),
    );

    // The text layer, below the pages. What is typed there becomes the
    // note's body, behind the frontmatter it was loaded with.
    const panel = new TextPanel(root);
    panel.load(this.noteBody);
    panel.setOpen(this.textPanelOpen);
    this.registerDomEvent(panel.field, "input", () => {
      this.noteBody = panel.edited();
      this.requestBodySave();
    });
    this.textPanel = panel;

    // A theme change restyles the chrome, and the pages only when their
    // appearance follows Obsidian's theme; the options pill's size follows
    // the theme's metrics.
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.syncPaperTheme();
        this.relayout();
      }),
    );
    // Keyboard shortcuts on the page (undo, delete a selection, and so on).
    this.scope = notebookKeyScope(
      root,
      this.app.scope,
      () => this.app.workspace.getActiveViewOfType(InkView) === this,
      // The page sidebar first: Escape leaves its overview before anything else.
      (event) => {
        // A key the open calculator types is its own: E is an e there, and
        // ← moves its cursor, not the page.
        if (this.calculator?.takesKey(event)) {
          this.surface?.noteKey(event, "field");
          return false;
        }
        // Customize toolbar is a dialog over the notebook: its arrows move
        // a button, its Escape closes it, and the page stays as it is.
        if (this.toolbar?.customizing) {
          this.surface?.noteKey(event, "modal");
          return false;
        }
        if (this.sidebar?.handleKeyDown(event)) {
          this.surface?.noteKey(event, "taken");
          return true;
        }
        return this.surface?.handleKeyDown(event) ?? false;
      },
      (event, verdict) => this.surface?.noteKey(event, verdict),
    );
    // A key this notebook's scope never heard, while the notebook is the
    // active view: another scope took it first (FineNotes#226). Obsidian's
    // keymap listens on the window in the capture phase and was there
    // first, so this hears the key after the scope has had its turn.
    this.registerDomEvent(
      winOf(this.contentEl),
      "keydown",
      (event) => {
        const surface = this.surface;
        if (!surface || surface.keyNoted(event)) return;
        if (this.app.workspace.getActiveViewOfType(InkView) !== this) return;
        surface.noteKey(event, "unheard");
      },
      { capture: true },
    );
    // The side button's click with the pen over the tool bar or a popover, not
    // the page, and a pen pressed there. Heard on the way down, before the
    // tool bar's own handlers.
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const)
      this.registerDomEvent(this.contentEl, type, (e) => this.surface?.penInView(e), {
        capture: true,
      });

    this.registerDomEvent(root, "dragover", (event) => this.acceptDrag(event));
    this.registerDomEvent(root, "drop", (event) => void this.handleFileDrop(event));

    // First layout pass: the pill has no measured size until the view is in
    // the document, so its restored position can only be applied after a frame.
    winOf(this.contentEl).requestAnimationFrame(() => this.toolbar?.applyPosition());

    // The file may have loaded before the DOM was built (or not yet at all):
    // either way the chrome follows whatever document is here now.
    this.notesSession = this.surface.activeSession;
    this.syncSingle();
    this.syncPdfTabs();
    audio.syncChrome();
    this.matchPdfResolution();
  }

  /**
   * What only the view's own window reports. A tab moved to a new window is
   * listened to there, and no longer in the window it left.
   */
  private bindWindowEvents(root: HTMLElement): void {
    this.windowEventsOff?.();
    const win = winOf(root);
    const doc = docOf(root);
    const offs: (() => void)[] = [];
    const on = <K extends keyof DocumentEventMap>(
      type: K,
      listener: (event: DocumentEventMap[K]) => void,
    ): void => {
      doc.addEventListener(type, listener);
      offs.push(() => doc.removeEventListener(type, listener));
    };
    on("visibilitychange", () => {
      const hidden = doc.visibilityState === "hidden";
      // A page read while the app is away is not blamed if iPadOS ends it.
      this.plugin.readingGuard.setHidden(hidden);
      if (!hidden) return;
      // A key held as the app goes away never sends its key-up.
      this.surface?.setHand(false);
      this.surface?.releaseHeldShortcuts();
      this.audio?.onHidden();
      // iPadOS may end the app from the background: keep the page now, and
      // a save the pen put off or one still in the background, made here
      // on the main thread, as it may not get another chance.
      this.recordLastPage();
      if (this.writeHold.savePending || this.saver.busy) void this.saveNow(false, true);
    });
    // Paste events go to whatever has focus — often the body, outside this
    // view — so they are heard on the document, and taken only while this
    // is the active view. The surface leaves text fields' pastes alone.
    // Space lets go of the hand wherever the key-up lands, and when the
    // window loses focus, which keeps the key-up from arriving at all.
    on("keyup", (e) => this.surface?.handleKeyUp(e));
    on("paste", (e) => {
      if (this.app.workspace.getActiveViewOfType(InkView) !== this) return;
      this.surface?.handlePaste(e);
    });
    // On a tablet the file list is a drawer, and while it is open Obsidian's
    // `.workspace-drawer-backdrop` covers the page, so a file dragged out of
    // it is dropped on the backdrop, outside this view. Take a drop on that
    // backdrop whose point lies over this view; a drop in the drawer itself
    // (moving a file to a folder) is the file list's.
    const overBackdrop = (event: DragEvent): boolean => {
      const target = event.target;
      if (event.defaultPrevented || !isElement(target)) return false;
      if (!target.matches(".workspace-drawer-backdrop")) return false;
      return pointInside(root.getBoundingClientRect(), event.clientX, event.clientY);
    };
    on("dragover", (event) => {
      if (overBackdrop(event)) this.acceptDrag(event);
    });
    on("drop", (event) => {
      if (overBackdrop(event)) void this.handleFileDrop(event);
    });
    const onBlur = (): void => {
      this.surface?.setHand(false);
      this.surface?.releaseHeldShortcuts();
    };
    win.addEventListener("blur", onBlur);
    offs.push(() => win.removeEventListener("blur", onBlur));
    this.windowEventsOff = () => {
      for (const off of offs) off();
      this.windowEventsOff = null;
    };
  }

  // --- Note settings ----------------------------------------------------------

  // --- Save as template ---------------------------------------------------------

  /** "Save notebook as template": the notebook and its pictures as one `.finetemplate` file. */
  saveAsTemplate(): void {
    const note = this.file;
    if (!note || !this.surface) return;
    new SaveTemplateModal(this.app, { name: stripInkSuffix(note.basename) }, (details) => {
      void this.writeTemplate(details);
    }).open();
  }

  private async writeTemplate(details: TemplateDetails): Promise<void> {
    const doc = this.surface?.document;
    if (!doc) return;
    const progress = new Notice(t("view.template.saving"), 0);
    try {
      const paths = new Set<string>();
      for (const page of doc.pages) {
        for (const image of page.images) paths.add(image.path);
        if (page.backdrop.kind === "pdf") paths.add(page.backdrop.path);
      }
      const files = new Map<string, Uint8Array>();
      for (const path of paths) {
        const file = this.app.vault.getFileByPath(path);
        if (file) files.set(path, new Uint8Array(await this.app.vault.readBinary(file)));
      }
      const preview = await this.templatePreview(doc.pages[0]);
      const { bytes, missing } = buildTemplatePackage({
        doc,
        ...details,
        files,
        ...(preview ? { preview } : {}),
      });
      const folder = templateFolderFor(this.settings);
      if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
      const taken = new Set(
        this.app.vault.getFolderByPath(folder)?.children.map((child) => child.name) ?? [],
      );
      const safe = details.name.replace(/[^\w .()-]+/g, " ").trim() || "Template";
      const name = uniqueFileName(safe, `.${TEMPLATE_EXTENSION}`, taken);
      // A buffer of its own: the vault takes an ArrayBuffer, not a view on one.
      const buffer = new Uint8Array(bytes).buffer;
      const file = await this.app.vault.createBinary(normalizePath(`${folder}/${name}`), buffer);
      new Notice(
        missing.length
          ? t("view.template.savedMissing", { path: file.path, count: missing.length })
          : t("view.template.saved", { path: file.path }),
        8000,
      );
    } catch (error) {
      new Notice(t("view.template.saveFailed", { message: errorMessage(error) }), 8000);
    } finally {
      progress.hide();
    }
  }

  /**
   * A lasso drawn round nothing asked for a screenshot (ink-surface.ts,
   * showEmptyLasso): the patch of page `index` inside `bounds`, as the page
   * shows it.
   */
  private async screenshotRegion(index: number, bounds: Bounds): Promise<void> {
    const shot = await this.pagePicture(index, bounds);
    if (shot) this.showScreenshot(shot);
    else new Notice(t("view.screenshot.failed"));
  }

  /**
   * The lasso's Screenshot (ink-surface.ts, showSelectionScreenshot): the
   * patch of page `index` the selection covers, with the page behind it
   * (paper, PDF, everything drawn there); the dialog's choice shows `inkOnly`,
   * the selection on its own (FineNotes discussion #107), or the page behind
   * it without its ink (FineNotes#211), instead.
   */
  private async screenshotSelection(
    inkOnly: ScreenshotPicture,
    index: number,
    bounds: Bounds,
  ): Promise<void> {
    const shot = await this.pagePicture(index, bounds);
    this.showScreenshot(
      shot ?? inkOnly,
      shot ? { selection: inkOnly, page: () => this.pagePicture(index, bounds, true) } : undefined,
    );
  }

  /**
   * The lasso's Ask AI (FineNotes discussion #107): the selection as the
   * page shows it, attached to the chat in place of its page, and the chat
   * opened on it.
   */
  private async askAboutSelection(index: number, bounds: Bounds): Promise<void> {
    if (this.isDamaged()) return;
    const shot = await this.pagePicture(index, bounds);
    const file = shot
      ? attachmentFromBytes("Selection.png", new Uint8Array(await shot.png.arrayBuffer()))
      : null;
    if (!file) {
      new Notice(t("view.screenshot.selectionFailed"));
      return;
    }
    const refusal = this.askConversation().attachInstead(file);
    if (refusal) new Notice(refusal);
    this.openAsk();
  }

  /**
   * The patch of page `index` inside `bounds`, drawn as an export draws it
   * (paper, PDF, ink), sharp at up to three times its size; null when none
   * of it is on the page or it could not be drawn. `withoutInk` leaves the
   * page's strokes out (`pageWithoutInk`).
   */
  private async pagePicture(
    index: number,
    bounds: Bounds,
    withoutInk = false,
  ): Promise<ScreenshotPicture | null> {
    // The page shown: on a PDF's tab, its slide.
    const shown = (this.surface?.document ?? this.doc).pages[index];
    if (!shown) return null;
    const page = withoutInk ? pageWithoutInk(shown) : shown;
    const { width, height } = page.geometry;
    const crop = pageCrop(bounds, width, height);
    if (!crop) return null;
    const png = await this.cropPicture(page, crop);
    return png ? { png, width: Math.round(crop.width), height: Math.round(crop.height) } : null;
  }

  /**
   * The patch `crop` of `page` (page px, drawn at `crop.scale` canvas px per
   * page px) as a PNG, drawn as an export draws it: paper, PDF, ink. Null
   * when it could not be drawn (a PDF that cannot be read).
   */
  private async cropPicture(
    page: Page,
    crop: { x: number; y: number; width: number; height: number; scale: number },
  ): Promise<Blob | null> {
    const { width, height } = page.geometry;
    const sources = this.previewSources();
    // A slide of a PDF's tab is no page of the notebook: no header or footer.
    if (!this.doc.pages.includes(page)) delete sources.furniture;
    const canvas = createEl("canvas");
    const out = createEl("canvas");
    try {
      await paintPagePreview(canvas, page, sources, width, crop.scale);
      out.width = Math.max(1, Math.round(crop.width * crop.scale));
      out.height = Math.max(1, Math.round(crop.height * crop.scale));
      const kx = canvas.width / width;
      const ky = canvas.height / height;
      out
        .getContext("2d")
        ?.drawImage(
          canvas,
          crop.x * kx,
          crop.y * ky,
          crop.width * kx,
          crop.height * ky,
          0,
          0,
          out.width,
          out.height,
        );
      return await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    } catch {
      return null;
    } finally {
      canvas.width = canvas.height = 0;
      out.width = out.height = 0;
    }
  }

  /** The template's first page as a PNG for galleries, drawn as an export draws it. */
  private async templatePreview(page: Page | undefined): Promise<Uint8Array | undefined> {
    if (!page) return undefined;
    const canvas = createEl("canvas");
    try {
      await paintPagePreview(canvas, page, this.previewSources(), 480, 1);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
    } catch {
      return undefined;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  /** Where this note saves new files of `kind`; `undefined` = Obsidian's default. */
  private attachmentFolder(kind: AttachmentKind): string | undefined {
    return resolveAttachmentFolder(this.doc, kind, attachmentDefaults(this.settings));
  }

  /** The toolbar's gear: this notebook's own settings. */
  openNoteSettings(): void {
    // The notebook's settings act on its notes.
    this.showTab(NOTES_TAB);
    const apply = (command: Command): void => {
      // Allowed in a read-only notebook: these are its settings, read-only included.
      if (!this.surface || this.isDamaged()) return;
      // Through the surface's stack, so it saves with the note and undoes.
      this.surface.applyCommand(command);
    };
    new NoteSettingsModal(this.app, {
      single: this.isSinglePage,
      board: this.isBoard,
      companion: this.companion.settings(),
      scrollDirection: () => scrollDirectionOf(this.doc),
      setScrollDirection: (direction) => {
        apply(new SetScrollDirection(direction));
        if (!this.isBoard) this.plugin.rememberScrollDirection(direction);
      },
      joinedPages: () => joinedPagesOf(this.surface?.document ?? this.doc),
      setJoinedPages: (on) => apply(new SetJoinedPages(on)),
      openPluginSettings: () => this.plugin.openSettingsTab(),
      simpleLook: () => this.plugin.settings.simpleLook,
      setSimpleLook: (on) => this.plugin.setSimpleLook(on),
      update: this.plugin.updates.available,
      openUpdate: () => this.plugin.openUpdatePage(),
      updateReminders: () => this.plugin.settings.updateReminders,
      stopUpdateReminders: () => void this.plugin.setUpdateReminders(false),
      furniture: () => ({ ...this.doc.furniture }),
      setFurniture: (furniture) => {
        apply(new SetFurniture(furniture));
        this.sidebar?.setDocument(this.doc);
      },
      readOnly: () => isReadOnly(this.surface?.document ?? this.doc),
      setReadOnly: (on) => apply(new SetReadOnly(on)),
      info: () => this.notebookInfo(),
      rename: (name) => this.renameNotebook(name),
      // The first page as the sidebar shows it: the cover with its title.
      paintCover: async (canvas, cssWidth) => {
        const doc = this.surface?.document ?? this.doc;
        const page = doc.pages[0];
        if (!page || !coverColorOfDocument(doc)) return false;
        await paintPagePreview(
          canvas,
          page,
          this.previewSources(),
          cssWidth,
          winOf(this.contentEl).devicePixelRatio || 1,
        );
        return true;
      },
    }).open();
  }

  /** What the gear's Notebook section shows. */
  private notebookInfo(): NotebookInfo {
    const file = this.file;
    const doc = this.surface?.document ?? this.doc;
    return {
      name: file ? notebookName(file.path) : "",
      pages: doc.pages.length,
      bytes: file?.stat.size ?? 0,
      created: file?.stat.ctime ?? 0,
      modified: file?.stat.mtime ?? 0,
      folder: file?.parent?.path === "/" ? "" : (file?.parent?.path ?? ""),
      cover: coverColorOfDocument(doc),
    };
  }

  /**
   * Rename the notebook from its settings: its own folder when it has one
   * (the notebook follows, main.ts `keepFolderNotebookPaired`), else its file.
   * Through `renameFile`, so links to it follow too.
   */
  private async renameNotebook(name: string): Promise<void> {
    const file = this.file;
    const plan = file ? renamePlan(file.path, name) : undefined;
    if (!plan) return;
    const { vault, fileManager } = this.app;
    const from = vault.getAbstractFileByPath(plan.from);
    if (!from) return;
    if (vault.getAbstractFileByPath(plan.to)) {
      new Notice(t("view.rename.exists", { path: plan.to }));
      return;
    }
    try {
      await fileManager.renameFile(from, plan.to);
    } catch (error) {
      new Notice(t("view.rename.failed", { message: errorMessage(error) }), 8000);
    }
  }

  // --- The Files tab ----------------------------------------------------------------

  /**
   * The page sidebar's rows for one kind of file. Pictures, PDFs and
   * recording transcripts are read from the notebook (no folder is scanned);
   * chats and exports from their folders. Asked only when the tab shows them.
   */
  private async listNotebookFiles(kind: FileKind): Promise<FileRow[]> {
    const note = this.file;
    if (!note) return [];
    const doc = this.surface?.document ?? this.doc;
    const { vault } = this.app;
    const exists = (row: FileRow) => vault.getFileByPath(row.path) !== null;
    switch (kind) {
      case "images":
        return notebookImages(doc);
      case "transcripts": {
        const sidecars = [transcriptSidecarPath(note.path), folderNotebookSidecarPath(note.path)]
          .filter((path): path is string => path !== null)
          .map((path) => ({ path, detail: t("view.files.serverTranscript") }));
        return [...recordingTranscripts(doc), ...sidecars].filter(exists);
      }
      case "chats": {
        const chats = await listChats(this.app, note.path, this.chatsFolder());
        return chats.map((chat) => ({ path: chat.path, detail: chat.title }));
      }
      case "exports": {
        const set = this.attachmentFolder("exports");
        const dir = set === undefined ? note.parent : vault.getFolderByPath(set);
        // Without a folder of their own, exports sit beside the note among
        // other PDFs: keep the ones named after the notebook.
        const title = stripInkSuffix(note.basename).toLowerCase();
        const files = (dir?.children ?? []).filter(
          (child): child is TFile =>
            child instanceof TFile &&
            (set !== undefined || child.name.toLowerCase().startsWith(title)),
        );
        return folderRows(
          files.map((file) => ({
            path: file.path,
            extension: file.extension,
            mtime: file.stat.mtime,
          })),
          ["pdf"],
          (mtime) => new Date(mtime).toLocaleDateString(),
        );
      }
      default:
        return [];
    }
  }

  /** A tapped file row: a picture or PDF turns to its page; anything else opens in a new tab. */
  private openNotebookFile(kind: FileKind, row: FileRow): void {
    if (kind === "images" && row.page !== undefined) {
      this.surface?.goToPage(row.page, true);
      return;
    }
    const file = this.app.vault.getFileByPath(row.path);
    if (!file) {
      new Notice(t("view.files.gone", { path: row.path }));
      return;
    }
    void this.app.workspace.getLeaf("tab").openFile(file);
  }

  // --- Search and links to a page -----------------------------------------------

  /**
   * The toolbar's search: every page's transcription (text layer and the
   * transcript server's sidecar file) and typed text; a tap on a result
   * turns to its page. Read-only, so a protected note may be searched too.
   */
  /** Count a slow or a fast way for the earned hints (model/nudges.ts). */
  private noteUse(event: NudgeEvent): void {
    this.tryHint?.noteUse(event);
    if (this.surface) this.plugin.noteUse(event, this.surface);
  }

  async openSearch(): Promise<void> {
    if (!this.file || !this.surface || !this.searchBody) return;
    // Search finds the notes' pages: it shows them.
    this.showTab(NOTES_TAB);
    const surface = this.surface;
    const pages = await this.notebookTextIndex(false);
    if (this.surface !== surface) return;
    // Whatever arrives later (a PDF's pages not read yet) joins the open list (#112).
    let onIndex: (index: readonly PageText[]) => void;
    if (this.settings.searchLayout === "original") {
      const modal = new NotebookSearchModal(this.app, {
        index: pages,
        initial: this.lastSearch,
        onQuery: (query) => (this.lastSearch = query),
        goTo: (index, query) => void this.showSearchHits(index, query),
        showFeature: (feature) => this.plugin.showFeature(feature),
        features: this.plugin.featureHost(),
        switchToSidebar: (query) => this.switchSearchLayout("sidebar", query),
      });
      modal.open();
      onIndex = (index) => modal.setIndex(index);
    } else {
      this.searchPanel ??= new SearchPanel({
        dock: this.searchBody,
        switchToOriginal: (query) => this.switchSearchLayout("original", query),
        goTo: (result, query) => void this.showSearchHits(result.pageIndex, query, result),
        onQuery: (query) => (this.lastSearch = query),
        onLayout: () => this.relayoutForSearch(),
        onClose: () => this.surface?.setSearchHits(null),
        features: this.plugin.featureHost(),
      });
      this.searchPanel.show(pages, this.lastSearch);
      onIndex = (index) => this.searchPanel?.setIndex(index);
    }
    void this.readPdfSearchText(surface.document.pages, () => {
      void this.notebookTextIndex(false).then(onIndex);
    });
  }

  /**
   * The search's other look, with the query as typed: the sidebar or the
   * original list. One choice for every notebook, as Ask's layout is.
   */
  private switchSearchLayout(layout: "sidebar" | "original", query: string): void {
    this.lastSearch = query;
    if (this.settings.searchLayout !== layout) {
      this.settings.searchLayout = layout;
      void this.plugin.saveSettings();
    }
    void this.openSearch();
  }

  /** Search's sidebar came or went: the page narrows or widens beside it, gliding. */
  private relayoutForSearch(): void {
    const surface = this.surface;
    if (!surface) return;
    const before = surface.pageClientRect();
    surface.keepScaleOnResize();
    surface.layout();
    if (before) surface.glideFrom(before, PANEL_SLIDE_MS);
  }

  /**
   * Turn to page `index` and light up what `query` found there (2.5): the
   * handwritten words, from this device's reading of the page (read now if
   * the one kept is out of date) lined up with the page's transcript, and
   * the text boxes. Without on-device
   * reading only the text boxes light up.
   */
  private async showSearchHits(
    index: number,
    query: string,
    result: SearchResult | null = null,
  ): Promise<void> {
    // On a board, going to its page does nothing: the hits, once lit, take
    // the view to the first of them (`setSearchHits`).
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page) return;
    // A step to the next match on the same page glides there from where it is.
    const sameAsLit = result !== null && surface.currentPage === index;
    if (!sameAsLit) {
      surface.setSearchHits(null);
      surface.goToPage(index, true);
    }
    let lines: ReadLine[] = [];
    const hash = pageContentHash(page);
    const kept = this.pageReadings.get(page.id);
    if (kept && kept.hash === hash) lines = kept.readLines;
    else if (this.settings.handwritingOnDevice !== false && page.strokes.length > 0) {
      try {
        const reading = await this.plugin.handwriting.readPage(
          page.strokes,
          true,
          await this.readingContext(page),
        );
        if (this.surface !== surface || !surface.document.pages.includes(page)) return;
        lines = this.keepReading(page, hash, reading).readLines;
      } catch {
        // No model, or the page could not be read: the text boxes still light up.
      }
    }
    // The page's transcripts find the words this device misread (2.5.2),
    // each lined up with the reading on its own.
    const pageText = (await this.notebookTextIndex(false))[index];
    const transcripts = pageText?.sources.filter((source) => source.kind === "handwriting") ?? [];
    const transcript = transcripts.map((source) => source.text);
    // A page holding the words as typed ("recipe for defining") lights
    // that phrase, wherever it is, and not each word on its own.
    const phrase = holdsPhrase(pageText, query);
    if (this.surface !== surface || !surface.document.pages.includes(page)) return;
    const words = lineHits(query, lines, transcript, phrase);
    const { boxes } = pageHits(query, [], page.textBoxes, phrase);
    // The PDF's printed words, lit as handwriting is (#112).
    const backdrop = page.backdrop;
    const printedGroups =
      backdrop.kind === "pdf" && this.pdfText
        ? pdfHitGroups(query, await this.pdfText.layout(backdrop, page.geometry), phrase)
        : [];
    if (this.surface !== surface || !surface.document.pages.includes(page)) return;
    // The results list's match, among the page's (#112). A transcript's
    // match is lined up with the reading on its own, so the list's nth
    // match is its own ink, wherever the reading found more or fewer words;
    // one that cannot be placed leaves the page's hits lit alike.
    let focus: SearchFocus | null = null;
    if (result?.kind === "pdf" && printedGroups[result.nth]?.length) {
      focus = { printed: printedGroups[result.nth] };
    } else if (result?.kind === "text" && result.boxId) {
      focus = { box: result.boxId };
    } else if (result?.kind === "handwriting") {
      const own = transcriptMatchInk(query, lines, transcripts, phrase)[result.nth];
      if (own?.length) focus = { ink: own };
      else if (words.length === matchesOfKind(pageText, query, phrase, "handwriting")) {
        focus = { words: result.nth };
      }
    }
    // In a text box, the words themselves light, as in the list.
    surface.setSearchHits(
      page.id,
      words,
      boxes,
      printedGroups.flat(),
      (text) => matchText(text, query, phrase),
      focus,
    );
  }

  /**
   * A link with a page in it — `[[Note#Page 3]]`, `#page=3` — opens the
   * notebook at that page. Obsidian hands the link's subpath over here,
   * sometimes before the file's pages have loaded, so it waits for them.
   */
  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const { subpath, pageIndex, match, search } = (state ?? {}) as {
      subpath?: unknown;
      pageIndex?: unknown;
      match?: { content?: unknown; matches?: unknown };
      /** What Home's search found on `pageIndex`, to light up there. */
      search?: unknown;
    };
    // A result of Obsidian's own search: its page, with the words lit up (2.5).
    const found =
      typeof match?.content === "string" && Array.isArray(match.matches)
        ? searchMatchTarget(match.content, match.matches as Array<[number, number]>)
        : null;
    if (found) {
      this.pendingSearch = found;
      this.pendingPageIndex = found.pageIndex;
    } else if (typeof subpath === "string" && subpath) this.pendingSubpath = subpath;
    else if (typeof pageIndex === "number" && Number.isInteger(pageIndex) && pageIndex >= 0) {
      // Back or Forward: the page this note was on then (see getEphemeralState);
      // or a page Home's search found, with its words lit up.
      this.pendingPageIndex = pageIndex;
      if (typeof search === "string" && search.trim())
        this.pendingSearch = { pageIndex, query: search };
    } else return;
    if (this.loadedPath !== null && this.loadedPath === this.file?.path) this.applyPendingPage();
  }

  /** What Back and Forward come back to: the page being read. */
  override getEphemeralState(): Record<string, unknown> {
    const state = super.getEphemeralState();
    // Back and Forward come back to the notes' page, not a slide.
    const index = this.onPdfTab ? undefined : this.surface?.currentPage;
    return index === undefined ? state : { ...state, pageIndex: index };
  }

  /**
   * Put the loaded notebook on its page, once the surface has a size to
   * scroll in: the page a link asked for (`#Page 3`), the page Back returns
   * to, or — the file opened anew here — the page it was left on, at fit
   * zoom, as GoodNotes reopens a notebook (research/goodnotes-smoothness §1).
   */
  private applyPendingPage(attempt = 0): void {
    const surface = this.surface;
    const path = this.loadedPath;
    if (!surface || path === null) return;
    const fresh = path !== this.restoredPath;
    const subpath = this.pendingSubpath;
    const back = this.pendingPageIndex;
    if (!fresh && subpath === null && back === null) return;
    // A board not laid out yet has no view to put a spot in either.
    const unready = surface.surfaceEl.clientHeight === 0 || (this.isBoard && !surface.boardSpot());
    if (unready && attempt < 20) {
      // Not laid out yet (a new tab): goToPage would scroll by a scale of nothing.
      window.setTimeout(() => this.applyPendingPage(attempt + 1), 50);
      return;
    }
    this.pendingSubpath = null;
    this.pendingPageIndex = null;
    const pages = surface.document.pages;
    let index: number | null = null;
    if (subpath !== null) index = pageFromSubpath(subpath, pages.length);
    else if (back !== null) index = back < pages.length ? back : null;
    // `#Krebs cycle`: a named region, centred (discussion #167). A page comes first.
    const name = subpath !== null && index === null ? regionSubpathName(subpath) : null;
    const region = name !== null ? findRegion(pages, name) : null;
    let boardSpots: ReadonlyMap<string, BoardSpot> | null = null;
    if (fresh) {
      // From now on the page being read is worth remembering for this file.
      this.restoredPath = path;
      // A notebook opened anew starts at fit zoom (a board at 100% on its middle),
      // whatever this leaf showed before.
      surface.showHome();
      // A board file goes back to the board it was left on, where it was
      // left, and each of its other boards to where that was (discussion #160).
      const board = hasBoards(this.doc) ? reopenBoards(this.loadLastPages(), path, pages) : null;
      if (board && subpath === null) {
        surface.goToPage(board.index);
        surface.restoreBoardSpots(board.others);
        if (board.spot) surface.showBoardSpot(board.spot);
      } else {
        boardSpots = board?.others ?? null;
        index ??= lastPageIndex(this.loadLastPages(), path, pages);
      }
    }
    if (region) surface.showRegion(region.index, region.region);
    else if (index !== null) surface.goToPage(index);
    // Opened anew, with no page asked for: the PDF's tab it was left on.
    if (fresh && subpath === null && back === null) {
      const tab = this.loadLastTabs()[path];
      if (tab !== undefined && this.offersPdfTab(tab)) this.showTab(tab);
    }
    // After the board is shown: going to it keeps where the first one was.
    if (boardSpots) surface.restoreBoardSpots(boardSpots);
    const search = this.pendingSearch;
    this.pendingSearch = null;
    if (search && search.pageIndex === index) void this.showSearchHits(index, search.query);
  }

  // --- Where each notebook was left ---------------------------------------------

  /** This device's map of where each notebook was left (vault-scoped local storage). */
  private loadLastPages(): LastPages {
    const raw: unknown = this.app.loadLocalStorage(LAST_PAGES_KEY);
    if (typeof raw !== "string") return parseLastPages(null);
    try {
      return parseLastPages(JSON.parse(raw));
    } catch {
      return parseLastPages(null);
    }
  }

  private saveLastPages(map: LastPages): void {
    this.app.saveLocalStorage(LAST_PAGES_KEY, JSON.stringify(map));
  }

  /** The page being read changed: remember it, once the reader settles. */
  private scheduleLastPage(): void {
    window.clearTimeout(this.lastPageTimer);
    this.lastPageTimer = window.setTimeout(() => this.recordLastPage(), LAST_PAGE_DEBOUNCE_MS);
  }

  /**
   * Remember the page being read now. Only once this file has been put on
   * its remembered page: until then the surface reports page 1 of a fresh
   * layout, which must not overwrite where it was left.
   */
  private recordLastPage(): void {
    window.clearTimeout(this.lastPageTimer);
    this.lastPageTimer = 0;
    const path = this.loadedPath;
    const surface = this.surface;
    if (!path || !surface || path !== this.restoredPath || path !== this.file?.path) return;
    // A slide is not a page of the notes: the notes' page was kept on leaving them.
    if (this.onPdfTab) return;
    const index = surface.currentPage;
    const page = surface.document.pages[index];
    if (!page) return;
    const at = surface.boardSpot();
    // A board not laid out yet (a window opened hidden) knows no spot: keep
    // the ones stored rather than writing them away.
    if (this.showingBoard && !at) return;
    const anchor = at ? spotAnchor(page) : undefined;
    const spot = at ? { ...at, ...(anchor ? { anchor } : {}) } : undefined;
    // A board file's other boards (discussion #160), each anchored to its own drawing.
    const boards: Record<string, BoardSpot> = {};
    for (const [id, other] of surface.otherBoardSpots()) {
      const kept = surface.document.pages.find((p) => p.id === id);
      const mark = kept ? spotAnchor(kept) : undefined;
      boards[id] = { ...other, ...(mark ? { anchor: mark } : {}) };
    }
    this.saveLastPages(
      rememberPage(this.loadLastPages(), path, page.id, index, Date.now(), spot, boards),
    );
  }

  /** A note was renamed or deleted: its remembered page follows it, or goes. */
  private lastPageFileMoved(from: string, to: string | null): void {
    const map = this.loadLastPages();
    const next = to === null ? forgetInLastPages(map, from) : renameInLastPages(map, from, to);
    if (next !== map) this.saveLastPages(next);
    const tabs = this.loadLastTabs();
    const nextTabs = to === null ? forgetTab(tabs, from) : renameInLastTabs(tabs, from, to);
    if (nextTabs !== tabs) this.saveLastTabs(nextTabs);
    if (to !== null && this.loadedPath === from) {
      this.loadedPath = to;
      if (this.restoredPath === from) this.restoredPath = to;
    }
  }

  // --- Export --------------------------------------------------------------------

  /**
   * The share button: export the notebook, the page being read, or chosen
   * pages as a PDF or as pictures (PNG, JPG), then open or share them.
   * `chosen` (the overview's selection) exports those pages without asking
   * for them again. Saved in the note's "PDF exports" folder (the gear),
   * created if it is missing, or else next to the note; several pictures go
   * into a new folder there. Read-only on the note, but refused while it is
   * protected: its pages may not be the pages on disk.
   */
  /**
   * The notebook's pages as they export. A board (FineNotes#46), in a board
   * file or among a notebook's pages, exports as one page the size of its
   * drawing, not metres of empty paper.
   */
  private exportablePages(): Pick<InkDocument, "pages"> {
    // The notes, whatever tab is shown: a PDF beside them is a file of its own.
    const open = this.onPdfTab ? this.doc : (this.surface?.document ?? this.doc);
    return hasBoards(open)
      ? {
          pages: open.pages.map((page) =>
            isBoardPage(open, page) ? this.boardDrawing(page) : page,
          ),
        }
      : open;
  }

  /**
   * The whole notebook as one PDF for Ask AI: every page, as the export
   * makes it (a PDF page keeps its own text), at a resolution the AI reads
   * well and no finer.
   */
  private async notebookPdfAttachment(
    onProgress: (done: number, total: number) => void,
  ): Promise<ChatFile | null> {
    const note = this.file;
    const pages = this.exportablePages().pages;
    if (!note || pages.length === 0) return null;
    const title = stripInkSuffix(note.basename);
    try {
      const bytes = await exportPagesToPdf(
        pages,
        // For the AI, not for print: 1024 px wide at 60% (a 69-page notebook:
        // 9.3 MB, where print quality made 16.3 MB and broke the services' limits).
        { ...this.previewSources(), maxPixelScale: 1, jpegQuality: ASK_PDF_QUALITY },
        { title, onProgress },
      );
      return attachmentFromBytes(`${title}.pdf`, bytes);
    } catch {
      return null;
    }
  }

  exportPdf(chosen?: readonly number[]): void {
    const note = this.file;
    if (this.isDamaged() || !note) return;
    const doc = this.exportablePages();
    const total = doc.pages.length;
    if (total === 0) return;
    const exports = this.attachmentFolder("exports");
    const folder = exports ?? note.parent?.path ?? "";
    // Read when needed: the folder may be created, or filled, meanwhile.
    const taken = (): Set<string> => {
      const dir = exports === undefined ? note.parent : this.app.vault.getFolderByPath(exports);
      return new Set((dir?.children ?? []).map((child) => child.name));
    };
    const preview = this.previewSources();
    // Plain paper or with the template, with the tapes or without, as the
    // dialog's switches were last left.
    const exported = (): PdfExportSources => this.pdfExportSources(preview);
    const taped = doc.pages.some((page) => page.strokes.some(isTape));
    new ExportPdfModal(this.app, {
      noun: this.isSinglePage ? "page" : "notebook",
      pageCount: total,
      currentPage: Math.max(0, Math.min(total - 1, this.surface?.currentPage ?? 0)),
      // As the page exports: without its margins when they are left out.
      pageSize: (i) => {
        const page = doc.pages[i];
        if (!page) return { width: 0, height: 0 };
        const margins = exportMarginsOf(this.settings.exportMargins);
        return keepsMargins(page, margins) ? page.geometry : unmarginedGeometry(page);
      },
      folder: exports ?? null,
      chosen,
      format: exportFormatOf(this.settings.exportFormat),
      setFormat: (format) => {
        this.settings.exportFormat = format;
        void this.plugin.saveSettings();
      },
      paintPreview: async (canvas, i, cssWidth) => {
        const page = doc.pages[i];
        if (page) {
          const dpr = winOf(this.contentEl).devicePixelRatio || 1;
          await paintPagePreview(canvas, page, exported(), cssWidth, dpr);
        }
      },
      plainPaper: this.settings.exportPlainPaper === true,
      setPlainPaper: (plain) => {
        this.settings.exportPlainPaper = plain;
        void this.plugin.saveSettings();
      },
      withoutTapes: this.settings.exportWithoutTapes === true,
      ...(doc.pages.some(hasMargin)
        ? {
            margins: exportMarginsOf(this.settings.exportMargins),
            setMargins: (margins: ExportMargins) => {
              this.settings.exportMargins = margins;
              void this.plugin.saveSettings();
            },
          }
        : {}),
      ...(taped
        ? {
            setWithoutTapes: (without: boolean) => {
              this.settings.exportWithoutTapes = without;
              void this.plugin.saveSettings();
            },
          }
        : {}),
      targetFor: (pages, format, typed) => {
        const target = exportTarget(note.basename, pages, total, format, taken());
        return format === "pdf" && target.kind === "file"
          ? { kind: "file", ...pdfName(typed ?? "", target.name, taken()) }
          : target;
      },
      pdfName: exportNamesOf(this.settings.exportNames)[note.path] ?? "",
      setPdfName: (typed) => {
        this.settings.exportNames = rememberPdfName(
          exportNamesOf(this.settings.exportNames),
          note.path,
          typed,
        );
        void this.plugin.saveSettings();
      },
      export: async (pages, format, onProgress, cancelled, typed) => {
        const inFolder = (name: string, dir = folder): string =>
          normalizePath(dir ? `${dir}/${name}` : name);
        const ensureFolder = async (path: string | undefined): Promise<void> => {
          if (path === undefined || this.app.vault.getFolderByPath(path)) return;
          try {
            await this.app.vault.createFolder(path);
          } catch {
            // Created meanwhile.
          }
        };
        const type = mimeTypeOf(format);
        if (format === "pdf") {
          const bytes = await exportPagesToPdf(
            pages.map((i) => doc.pages[i]),
            exported(),
            { title: stripInkSuffix(note.basename), onProgress, cancelled },
          );
          // Named at save time, not when the dialog opened: another export may
          // have taken the name since. A typed name replaces its file (#318),
          // in place, so a link to it or a synced copy stays the same file.
          const free = uniqueFileName(exportBaseName(note.basename, pages, total), ".pdf", taken());
          const { name, replaces } = pdfName(typed ?? "", free, taken());
          const path = inFolder(name);
          await ensureFolder(exports);
          const buffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          const existing = replaces ? this.app.vault.getFileByPath(path) : null;
          if (existing) await this.app.vault.modifyBinary(existing, buffer);
          else await this.app.vault.createBinary(path, buffer);
          // The whole notebook can become its companion PDF (Keep updated).
          const keepUpdated =
            pages.length === total ? this.companion.keepUpdated(path, bytes) : undefined;
          const files = [new File([buffer], name, { type })];
          return { paths: [path], where: path, files, ...(keepUpdated ? { keepUpdated } : {}) };
        }
        // Pictures: one file, or a new folder of them. Named at save time too.
        const target = exportTarget(note.basename, pages, total, format, taken());
        await ensureFolder(exports);
        const dir = target.kind === "folder" ? inFolder(target.folder) : folder;
        if (target.kind === "folder") await ensureFolder(dir);
        const names = target.kind === "folder" ? target.names : [target.name];
        const paths: string[] = [];
        const files: File[] = [];
        await exportPagesToImages(
          pages.map((i) => doc.pages[i]),
          exported(),
          format,
          {
            onProgress,
            cancelled,
            save: async (i, picture) => {
              const path = inFolder(names[i], dir);
              await this.app.vault.createBinary(path, await picture.arrayBuffer());
              paths.push(path);
              files.push(new File([picture], names[i], { type }));
            },
          },
        );
        return { paths, where: target.kind === "folder" ? dir : paths[0], files };
      },
      open: (path) => {
        const file = this.app.vault.getFileByPath(path);
        if (file) void this.app.workspace.getLeaf("tab").openFile(file);
      },
    }).open();
  }

  /** The page in view and its number (1-based), for tools that read its ink. */
  currentPageInk(): { page: Page; number: number } | null {
    const index = this.surface?.currentPage ?? 0;
    const page = this.doc.pages[index];
    return page ? { page, number: index + 1 } : null;
  }

  // --- Single pages -----------------------------------------------------------

  /** Whether the open document is a single page rather than a notebook. */
  /** The notebook as it is now, unsaved changes included. */
  get document(): InkDocument {
    return this.doc;
  }

  get isSinglePage(): boolean {
    return this.doc.single === true;
  }

  /**
   * Whether the open document is an endless board file (FineNotes#46): one
   * board or several (discussion #160). It is a single page too, for builds
   * that know no boards.
   */
  get isBoard(): boolean {
    return isBoard(this.doc);
  }

  /** Whether the view shows a board: a board file, or a board among a notebook's pages. */
  get showingBoard(): boolean {
    const page = this.doc.pages[this.surface?.currentPage ?? 0];
    return page !== undefined && isBoardPage(this.doc, page);
  }

  /** A handwriting practice file: kept to writing, its pages and paper fixed. */
  get isPractice(): boolean {
    return this.doc.practice !== undefined;
  }

  /**
   * Make the chrome match the document: a single page shows no "Add page"
   * in the toolbar or the page panel. Called whenever the document is
   * replaced or changed, because one leaf can load a single page and then a
   * notebook, and "Convert to notebook" (or its undo) flips it in place.
   */
  private syncSingle(): void {
    const single = this.isSinglePage;
    const practice = this.isPractice;
    this.toolbar?.setAddPageVisible(!single && !practice);
    // A single page takes no more pages, and a protected note takes no edits.
    this.surface?.setPullToAddPage(!single && !practice && !this.guard.locked);
    // The overview needs pages to show, as its ⤢ does.
    this.surface?.setPinchToOverview(!single && !practice);
    // A board file's panel adds, drags and deletes boards (discussion #160).
    // A PDF's tab: its slides are fixed, as a practice file's pages are.
    this.sidebar?.setSingle(single && !this.isBoard, practice || this.onPdfTab);
    // A board's panel is Contents and Files; its ⋯ has no page items (`toggleMorePanel`).
    this.sidebar?.setBoard(this.isBoard);
    // A practice file has the pen and the eraser, and nothing else.
    this.toolbar?.setPractice(practice);
    // Another document in this view: its first count is not "finishing" it.
    this.practiceFull = null;
    if (practice) void this.loadLearnElsewhere();
    // A PDF's pages become pages: a board has none to add.
    this.toolbar?.setInsertPdfVisible(!this.isBoard);
    // Nor does it take pages sent from another notebook (`transferTargets`).
    if (this.file) this.plugin.noteBoard(this.file.path, this.isBoard);
    this.toolbar?.setBoard(this.isBoard);
    this.surface?.setPractice(practice ? deviceKind() : null);
    if (single || practice) {
      this.addPagePopover?.popover.close();
      this.addPagePopover = null;
    }
  }

  /**
   * What the other practice sheets and the corrected words hold toward
   * learning, read when a practice sheet opens; this sheet's own lines are
   * counted live ({@link syncLearnButton}).
   */
  private learnElsewhere = { lines: 0, corrections: 0 };

  private async loadLearnElsewhere(): Promise<void> {
    const host = this.plugin.learningHost();
    const [sheets, corrections] = await Promise.all([practiceSheets(host), readCorrections(host)]);
    const here = this.file?.path;
    this.learnElsewhere = {
      lines: sheets.filter((s) => s.path !== here).reduce((sum, s) => sum + s.written, 0),
      corrections: corrections.corrections.length,
    };
    this.syncLearnButton();
  }

  /**
   * Whether every line of this practice sheet was copied, as of the last
   * count; null until the sheet's first count, so opening a finished sheet
   * is not "finishing" it.
   */
  private practiceFull: boolean | null = null;
  private sheetInviteTimer = 0;

  /** The practice sheet's Learn button: lines copied here and elsewhere, against the 10 needed. */
  private syncLearnButton(): void {
    if (!this.isPractice) return;
    const here = practiceLines(this.doc).length;
    const full = here >= promptCount(this.doc);
    // The last line just went down: the moment to ask about sharing. A line
    // counts from its first stroke, so wait until the pen has rested, and
    // ask only if the sheet is still full then (not erased again).
    if (full && this.practiceFull === false) {
      window.clearTimeout(this.sheetInviteTimer);
      this.sheetInviteTimer = window.setTimeout(() => {
        if (this.practiceFull) this.plugin.sharing?.inviteAfterSheet();
      }, SHEET_INVITE_DELAY_MS);
    }
    this.practiceFull = full;
    const lines = here + this.learnElsewhere.lines;
    const { count, ready } = sheetButton(lines, this.learnElsewhere.corrections);
    this.toolbar?.setLearnCount(count, ready);
  }

  /** A practice file says no to anything but writing; true when it did. */
  private refusePractice(): boolean {
    if (!this.isPractice) return false;
    new Notice(t("view.practice.penOnly"));
    return true;
  }

  /** "Convert to notebook": the single page becomes a notebook that takes more pages. Undoable. */
  convertToNotebook(): void {
    // A board stays a board (FineNotes#46): its page is not a sheet to add sheets to.
    if (!this.surface || this.isProtected() || !this.isSinglePage || this.isBoard) return;
    // Through the surface's stack, so Cmd/Ctrl+Z makes it a single page again;
    // its onChange re-syncs the chrome and saves.
    this.surface.applyCommand(new SetSingle(false));
    new Notice(t("view.single.converted"));
  }

  /**
   * Every path that adds a page asks this first. The controls are hidden on
   * a single page, so this only speaks up if something reached one anyway.
   */
  private refuseSinglePage(): boolean {
    if (this.refuseOnPdfTab()) return true;
    if (this.isPractice) {
      new Notice(t("view.practice.fixedPages"));
      return true;
    }
    if (!this.isSinglePage) return false;
    // A board grows by itself as it is written on (FineNotes#46).
    if (this.isBoard) new Notice(t("view.single.board"));
    else new Notice(t("view.single.page"));
    return true;
  }

  // --- Pages ----------------------------------------------------------------

  // --- PDF tabs beside the notes --------------------------------------------------

  /** Whether a PDF's tab is shown, not the notes. */
  private get onPdfTab(): boolean {
    return this.activeTab !== NOTES_TAB;
  }

  /** Whether this notebook takes PDF tabs: not a single page, a board or a practice file. */
  private get takesPdfTabs(): boolean {
    return !this.isSinglePage && !this.isBoard && !this.isPractice;
  }

  /** Whether `id` names a PDF tab this notebook has, not closed, that can be shown. */
  private offersPdfTab(id: string): boolean {
    const beside = findBeside(this.doc, id);
    return this.takesPdfTabs && beside !== null && beside.hidden !== true;
  }

  /**
   * On a PDF's tab, say no to what belongs to the notes (text, pictures,
   * pages): true when it did. Said once every few seconds at most.
   */
  private refuseOnPdfTab(): boolean {
    if (!this.onPdfTab) return false;
    const now = Date.now();
    if (now - this.pdfTabNoticeAt > 3000) {
      this.pdfTabNoticeAt = now;
      new Notice(t("view.pdfTabs.pdfOnly"));
    }
    return true;
  }

  /** Whether the PDF at `path` is in the vault. */
  private pdfExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  /** The strip as the notebook is now: its tabs, the one shown, shown at all. */
  private syncPdfTabs(): void {
    const strip = this.pdfTabs;
    if (!strip) return;
    const shown = this.takesPdfTabs && showsStrip(this.doc);
    const tabs: StripTab[] = stripTabs(this.doc).map((beside) => ({
      id: beside.id,
      label: tabLabel(beside),
      missing: !this.pdfExists(beside.path),
    }));
    strip.render(tabs, this.activeTab, shown);
    const was = this.contentEl.hasClass("goodobsidian-has-pdf-tabs");
    this.contentEl.toggleClass("goodobsidian-has-pdf-tabs", shown);
    // The strip came or went: the pill moves below it, or back up.
    if (was !== shown) this.toolbar?.applyPosition();
  }

  /**
   * Show tab `id` ({@link NOTES_TAB}: the notes). A PDF's tab is a session of
   * its own on the one surface (`surface-session.ts`): its undo, its view,
   * its few tools; the notes keep theirs meanwhile, and their tool comes
   * back with them. A closed tab is opened again.
   */
  showTab(id: string): void {
    const surface = this.surface;
    if (!surface || id === this.activeTab) return;
    if (id === NOTES_TAB) {
      const notes = this.notesSession;
      if (!notes) return;
      this.saveTabView();
      this.activeTab = NOTES_TAB;
      // The notes come back exactly as they were left: their own page,
      // scroll and zoom.
      surface.showSession(notes);
      const tool = this.notesTool;
      this.notesTool = null;
      if (tool !== null && tool !== this.toolState.tool) {
        surface.setTool(tool);
        this.toolbar?.setState(this.toolState);
      }
      this.afterTabChange();
      return;
    }
    const beside = findBeside(this.doc, id);
    if (!beside || !this.takesPdfTabs) return;
    // A closed tab opened from the + list comes back to the strip.
    if (!isReadOnly(this.doc) && showBesideTab(this.doc, id)) this.requestHeadSave();
    if (this.onPdfTab) {
      this.saveTabView();
    } else {
      // Leaving the notes: their page is remembered, and the tool in hand.
      this.recordLastPage();
      this.notesSession = surface.activeSession;
      this.notesTool = this.toolState.tool;
    }
    let session = this.tabSessions.get(id);
    const fresh = session === undefined;
    if (!session) {
      session = surface.createSession(this.tabDocument(beside), { fixedPages: true });
      this.tabSessions.set(id, session);
    }
    this.activeTab = id;
    surface.showSession(session);
    // Shown for the first time since the notebook opened: where it was left.
    // Never a jump to a slide: a tab shows where it was read, always.
    if (fresh && beside.view) this.restoreTabView(id, beside.view);
    this.afterTabChange();
  }

  /** The chrome follows the tab shown: the bar's tools, the pages panel, the strip. */
  private afterTabChange(): void {
    const surface = this.surface;
    if (!surface) return;
    this.toolbar?.setPdfTab(this.onPdfTab);
    this.toolbar?.setState(this.toolState);
    this.sidebar?.setDocument(surface.document);
    this.syncSidebarOutline();
    this.sidebar?.setCurrentPage(surface.currentPage);
    this.syncSingle();
    this.syncPdfTabs();
    this.pdfTabsPopover?.close();
    this.pdfTabsPopover = null;
    this.morePanel?.close();
    this.morePanel = null;
    this.focusPdfText(surface.currentPage);
    this.rememberActiveTab();
  }

  /**
   * PDF outlines read this session, by path: the read, and its entries once
   * in. Made on first use (a view built from its prototype in a test has none).
   */
  private pdfOutlines: Map<string, PdfOutlineRead> | undefined;

  /**
   * The page sidebar's Contents follow the tab: the notebook's own on the
   * notes, the PDF's own outline (its bookmarks) on a PDF's tab, read once
   * per PDF and kept for the session. Never written into the notebook.
   */
  private syncSidebarOutline(): void {
    const sidebar = this.sidebar;
    const surface = this.surface;
    if (!sidebar) return;
    const beside = this.onPdfTab ? findBeside(this.doc, this.activeTab) : undefined;
    if (!beside || !surface) {
      sidebar.setPdfTab(this.onPdfTab);
      return;
    }
    const outlines = (this.pdfOutlines ??= new Map<string, PdfOutlineRead>());
    const path = beside.path;
    const shown = surface.document;
    let known = outlines.get(path);
    if (known?.items) {
      sidebar.setPdfTab(true, tabOutlineEntries(shown, path, known.items));
      return;
    }
    sidebar.setPdfTab(true);
    if (!known) {
      const entry: PdfOutlineRead = {
        read: this.readOutline(path).then((items) => {
          entry.items = items;
        }),
      };
      known = entry;
      outlines.set(path, known);
    }
    void known.read.then(() => {
      // Still that tab: show what came in.
      if (this.onPdfTab && this.activeTab === beside.id && this.surface?.document === shown)
        this.syncSidebarOutline();
    });
  }

  /** The outline of the PDF at `path`; none when it is missing or cannot be read. */
  private async readOutline(path: string): Promise<OutlineItem[]> {
    try {
      const file = this.app.vault.getFileByPath(path);
      return file ? await readPdfOutline(await this.app.vault.readBinary(file)) : [];
    } catch {
      return [];
    }
  }

  /** Back to the notes with every tab's session let go: a new document comes. */
  private dropPdfTabs(): void {
    window.clearTimeout(this.tabViewTimer);
    this.tabViewTimer = 0;
    this.pdfTabsPopover?.close();
    this.pdfTabsPopover = null;
    const surface = this.surface;
    if (surface && this.onPdfTab && this.notesSession) surface.showSession(this.notesSession);
    if (this.onPdfTab) {
      this.activeTab = NOTES_TAB;
      if (surface && this.notesTool !== null) surface.setTool(this.notesTool);
      this.notesTool = null;
      this.toolbar?.setPdfTab(false);
      this.toolbar?.setState(this.toolState);
      this.sidebar?.setPdfTab(false);
    }
    this.tabSessions.clear();
  }

  /** Close a PDF's tab: it leaves the strip, its PDF and its ink stay attached. */
  private closeTab(id: string): void {
    if (this.isProtected()) return;
    const next = tabAfterClosing(this.doc, id);
    if (this.activeTab === id) this.showTab(next);
    if (hideTab(this.doc, id)) this.requestHeadSave();
    this.syncPdfTabs();
  }

  /** Rename a PDF's tab; the file keeps its name. An empty name is the file's again. */
  private renameTabAsked(id: string): void {
    const beside = findBeside(this.doc, id);
    if (!beside || this.isProtected()) return;
    new RenameModal(
      this.app,
      tabLabel(beside),
      (name) => {
        if (renameTab(this.doc, id, name)) this.requestHeadSave();
        this.syncPdfTabs();
      },
      t("view.pdfTabs.renameTitle"),
    ).open();
  }

  /**
   * Find file: point a missing PDF's tab at a PDF in the vault. Its page
   * sizes are read from the new file, and its marks stay on their slides.
   */
  private findTabFile(id: string): void {
    if (this.isProtected()) return;
    new VaultPdfSuggestModal(this.app, (file) => void this.relinkTab(id, file.path)).open();
  }

  private async relinkTab(id: string, path: string): Promise<void> {
    const beside = findBeside(this.doc, id);
    const file = this.app.vault.getFileByPath(path);
    const note = this.file;
    if (!beside || !file || !note) return;
    let sizes: Array<{ width: number; height: number }> | null = null;
    try {
      sizes = await measurePdfPages(await this.app.vault.readBinary(file));
    } catch (error) {
      new Notice(
        t("view.pdfTabs.unreadable", { name: file.basename, message: errorMessage(error) }),
        8000,
      );
      return;
    }
    if (this.file !== note || findBeside(this.doc, id) !== beside) return;
    beside.path = path;
    beside.sizes = sizesToRuns(sizes.map((size) => this.slideGeometry(size)));
    for (const page of beside.marks)
      if (page.backdrop.kind === "pdf") page.backdrop = { ...page.backdrop, path };
    // Its pages are laid out again from the file found.
    const old = this.tabSessions.get(id);
    this.tabSessions.delete(id);
    if (old && this.activeTab === id && this.surface) {
      const session = this.surface.createSession(this.tabDocument(beside), { fixedPages: true });
      this.tabSessions.set(id, session);
      this.surface.showSession(session);
      this.afterTabChange();
    }
    this.requestHeadSave();
    this.syncPdfTabs();
    new Notice(t("view.pdfTabs.relinked", { name: tabLabel(beside) }));
  }

  // --- Snippets: a slide's area dragged onto the notes -----------------------

  /**
   * The lasso on a PDF's tab carries area `area` of slide `index` off as a
   * snippet (ink-surface.ts, `startSnippetDrag`): its picture is drawn now,
   * as sharp as the view shows it (`viewScale`), for the drag's ghost and
   * for the drop. Null when there is nothing to carry.
   */
  private startSnippet(
    index: number,
    area: Bounds,
    viewScale: number,
  ): Promise<Blob | null> | null {
    const page = this.surface?.document.pages[index];
    if (!this.onPdfTab || !page) return null;
    const crop = snippetCrop(area, page.geometry.width, page.geometry.height, viewScale);
    if (!crop) return null;
    const picture = this.cropPicture(page, crop);
    this.snippet = {
      tab: this.activeTab,
      page: index,
      size: { width: crop.width, height: crop.height },
      slideWidth: page.geometry.width,
      pixels: snippetPixels(crop),
      picture,
      hover: { since: null },
      at: { x: 0, y: 0 },
    };
    return picture;
  }

  /**
   * The snippet's pointer moved to client point (x, y). Resting on the
   * Notes tab lights it, and after `SNIPPET_FLIP_MS` the notes show, the
   * drag going on over them. Once there it stays: a drop on the PDF's tab
   * it came from was never a drop.
   */
  private hoverSnippet(x: number, y: number): boolean {
    const snippet = this.snippet;
    const strip = this.pdfTabs;
    if (!snippet || !strip) return false;
    snippet.at = { x, y };
    window.clearTimeout(this.snippetTimer);
    this.snippetTimer = 0;
    if (this.activeTab !== snippet.tab) {
      strip.setDropTarget(null);
      return false;
    }
    const over = strip.tabAt(x, y) === NOTES_TAB;
    strip.setDropTarget(over ? NOTES_TAB : null);
    const step = stepSnippetHover(snippet.hover, over, Date.now());
    snippet.hover = step.hover;
    if (step.flip) {
      strip.setDropTarget(null);
      this.showTab(NOTES_TAB);
      return false;
    }
    // A pen held still sends no moves: ask again when the wait is up.
    if (over) {
      this.snippetTimer = window.setTimeout(() => {
        if (this.snippet === snippet) this.hoverSnippet(snippet.at.x, snippet.at.y);
      }, SNIPPET_FLIP_MS);
    }
    return over;
  }

  /**
   * The snippet was let go: on page `drop.pageIndex` of the notes at page
   * point (x, y), it lands there as a picture of the slide's area, linked to
   * the slide (`ImageElement.slide`), keeping its share of the slide's width
   * on the notes page (`snippetSize`), saved as an attachment: one undo step on the
   * notes. `null`: it went nowhere, and nothing changes.
   */
  private async dropSnippet(
    drop: { pageIndex: number; x: number; y: number } | null,
  ): Promise<void> {
    window.clearTimeout(this.snippetTimer);
    this.snippetTimer = 0;
    this.pdfTabs?.setDropTarget(null);
    const snippet = this.snippet;
    this.snippet = null;
    const surface = this.surface;
    const note = this.file;
    if (!snippet || !drop || !surface || !note || this.onPdfTab || this.isProtected()) return;
    const beside = findBeside(this.doc, snippet.tab);
    const png = await snippet.picture;
    const { pixels } = snippet;
    if (!png) {
      new Notice(t("view.pdfTabs.snippetFailed"));
      return;
    }
    try {
      const prepared = {
        bytes: await png.arrayBuffer(),
        mime: "image/png",
        ext: "png",
        width: pixels.width,
        height: pixels.height,
      };
      const name = t("view.pdfTabs.snippetName", {
        name: beside ? tabLabel(beside) : "PDF",
        page: snippet.page + 1,
      });
      const file = await saveImageAttachment(
        this.app,
        prepared,
        name,
        note.path,
        this.attachmentFolder("images"),
      );
      // Still the notes it was dropped on.
      if (this.file !== note || this.surface !== surface || this.onPdfTab || this.isProtected())
        return;
      const page = this.doc.pages[drop.pageIndex];
      if (!page) return;
      const image = newImageElement(
        this.doc,
        file.path,
        snippetBox(snippet.size, snippet.slideWidth, drop, page.geometry),
      );
      image.slide = { tab: snippet.tab, page: snippet.page };
      surface.applyCommand(new InsertImage(page.id, image));
      surface.selectImage(page.id, image.id);
    } catch (error) {
      new Notice(t("view.image.addFailed", { message: errorMessage(error) }), 8000);
    }
  }

  /**
   * How large the snippet being dragged lands on notes page `index`, page
   * px (`snippetSize`), for its ghost over the notes; null when there is no
   * snippet or no such page.
   */
  private snippetLanding(index: number): { w: number; h: number } | null {
    const snippet = this.snippet;
    const page = this.surface?.document.pages[index];
    if (!snippet || !page || this.onPdfTab) return null;
    return snippetSize(snippet.size, snippet.slideWidth, page.geometry);
  }

  /**
   * A snippet's link was tapped: its PDF's tab, at its slide. A closed tab
   * opens again; a PDF that is gone shows its grey tab, to find the file.
   */
  private openSlide(slide: SlideRef): void {
    const surface = this.surface;
    if (!surface || !findBeside(this.doc, slide.tab) || !this.takesPdfTabs) return;
    this.showTab(slide.tab);
    if (this.activeTab === slide.tab) surface.goToPage(slide.page);
  }

  /** The + button: every PDF of this notebook, those beside it, and adding more. */
  private togglePdfTabsPopover(anchor: HTMLElement): void {
    const open = this.pdfTabsPopover;
    this.pdfTabsPopover = null;
    if (open?.isOpen) {
      open.close();
      return;
    }
    const note = this.file;
    if (!note) return;
    const besideNote = (note.parent?.children ?? [])
      .filter((child): child is TFile => child instanceof TFile && child.extension === "pdf")
      .map((file) => ({ path: file.path, mtime: file.stat.mtime }));
    this.pdfTabsPopover = new PdfTabsPopover(anchor, {
      list: (query) => plusList(this.doc, note.path, besideNote, query, (p) => this.pdfExists(p)),
      onOpenAttached: (id) => this.showTab(id),
      onAttach: (path) => void this.attachVaultPdf(path),
      onFromVault: () =>
        new VaultPdfSuggestModal(this.app, (file) => void this.attachVaultPdf(file.path)).open(),
      // Inside the tap: a file picker opens only from a user gesture.
      onFromDevice: () =>
        void pickImageFiles(this.contentEl, false, "application/pdf,.pdf", false).then((files) => {
          const file = files[0];
          if (file) void this.keepDevicePdf(file);
        }),
      onClose: () => {
        if (this.pdfTabsPopover?.isOpen === false) this.pdfTabsPopover = null;
      },
    });
  }

  /** Whether a PDF may be attached here now, saying why not. */
  private canAttachPdf(): boolean {
    if (!this.file || !this.surface || this.isProtected() || this.refusePractice()) return false;
    if (this.isBoard) {
      new Notice(t("view.pdf.board"));
      return false;
    }
    if (this.isSinglePage) {
      new Notice(t("view.pdf.singleImport"));
      return false;
    }
    return true;
  }

  /**
   * Keep the PDF at `path` (in the vault) beside the notes, and show its
   * tab. One already attached is shown. Whether it was.
   */
  async keepPdfBeside(path: string): Promise<boolean> {
    return this.attachVaultPdf(path);
  }

  private async attachVaultPdf(path: string): Promise<boolean> {
    if (!this.canAttachPdf()) return false;
    const existing = besideByPath(this.doc, path);
    if (existing) {
      this.showTab(existing.id);
      return true;
    }
    const file = this.app.vault.getFileByPath(path);
    const note = this.file;
    if (!file || !note) return false;
    const progress = new Notice(t("view.pdf.reading"), 0);
    let sizes: Array<{ width: number; height: number }>;
    try {
      sizes = await measurePdfPages(await this.app.vault.readBinary(file));
    } catch (error) {
      new Notice(
        t("view.pdfTabs.unreadable", { name: file.basename, message: errorMessage(error) }),
        8000,
      );
      return false;
    } finally {
      progress.hide();
    }
    if (this.file !== note) return false;
    return this.attachMeasured(path, sizes);
  }

  /** A PDF from this device: saved beside the notebook (as Import PDF saves one), then kept beside it. */
  private async keepDevicePdf(file: File): Promise<boolean> {
    const note = this.file;
    if (!note || !this.canAttachPdf()) return false;
    try {
      const bytes = await file.arrayBuffer();
      const sizes = await measurePdfPages(bytes);
      if (this.file !== note) return false;
      const saved = await saveImageAttachment(
        this.app,
        { bytes, mime: "application/pdf", ext: "pdf", width: 0, height: 0 },
        file.name,
        note.path,
        this.attachmentFolder("images"),
      );
      if (this.file !== note) return false;
      return this.attachMeasured(saved.path, sizes);
    } catch (error) {
      new Notice(t("view.pdf.readFailed", { name: file.name, message: errorMessage(error) }), 8000);
      return false;
    }
  }

  /** A PDF page's size (PDF points) as a slide's (page px), as Import PDF sizes its pages. */
  private slideGeometry(size: { width: number; height: number }): {
    width: number;
    height: number;
  } {
    const paper = this.doc.pages[0]?.geometry ?? {
      width: DEFAULT_PAPER_WIDTH,
      height: DEFAULT_PAGE_HEIGHT,
    };
    return pdfPageGeometry(paper, size);
  }

  /** Attach the PDF at `path`, its pages measured, and show its tab. */
  private attachMeasured(
    path: string,
    sizes: ReadonlyArray<{ width: number; height: number }>,
  ): boolean {
    if (!this.canAttachPdf()) return false;
    const beside = attachPdf(this.doc, path, sizesToRuns(sizes.map((s) => this.slideGeometry(s))));
    this.requestHeadSave();
    this.syncPdfTabs();
    this.showTab(beside.id);
    return true;
  }

  /**
   * A PDF tab as a document of its own (`besideDocument`). In a notebook kept
   * as page files its new ids come from the notebook's clock (#274), so ink
   * written on one PDF on two devices at once never shares an id.
   */
  private tabDocument(beside: BesidePdf): InkDocument {
    const doc = besideDocument(beside);
    const clock = dotClockOf(this.doc);
    if (clock) attachDotClock(doc, clock);
    return doc;
  }

  /** Every tab's pages that gained or lost marks, into the notebook (before a save). */
  private syncTabMarks(): void {
    for (const [id, session] of this.tabSessions) {
      const beside = findBeside(this.doc, id);
      if (beside) syncMarks(beside, session.doc);
    }
  }

  /**
   * A tab's PDF moved (`relinkDoc` moved its path and its marks'): the blank
   * slides of its session follow too, so they draw the file where it is now.
   */
  private followTabPaths(): void {
    for (const [id, session] of this.tabSessions) {
      const beside = findBeside(this.doc, id);
      if (!beside) continue;
      for (const page of session.doc.pages) {
        if (page.backdrop.kind === "pdf" && page.backdrop.path !== beside.path)
          page.backdrop = { ...page.backdrop, path: beside.path };
      }
    }
  }

  /** A change only the head holds (a tab's name, place or view): saved, no page serialised again. */
  private requestHeadSave(): void {
    // A read-only notebook is not written for where its tabs were left.
    if (isReadOnly(this.doc)) return;
    this.encoder.touch([]);
    this.saveRequest();
  }

  /** Remember where the PDF's tab shown is being read, once the reader settles. */
  private scheduleTabView(): void {
    if (!this.onPdfTab) return;
    window.clearTimeout(this.tabViewTimer);
    this.tabViewTimer = window.setTimeout(() => this.saveTabView(), TAB_VIEW_SETTLE_MS);
  }

  /** Where the PDF's tab shown is read now, into the notebook: not an undo step. */
  private saveTabView(): void {
    window.clearTimeout(this.tabViewTimer);
    this.tabViewTimer = 0;
    const surface = this.surface;
    if (!this.onPdfTab || !surface || this.guard.locked) return;
    const view = surface.readingView();
    if (!view) return;
    // Rounded: a scroll of a fraction of a px is not worth a save.
    const kept = {
      page: view.page,
      zoom: Math.round(view.zoom * 1000) / 1000,
      x: Math.round(view.x),
      y: Math.round(view.y),
    };
    if (setTabView(this.doc, this.activeTab, kept)) this.requestHeadSave();
  }

  /** Put a PDF's tab back where it was left, once the pane has a size. */
  private restoreTabView(
    id: string,
    view: { page: number; zoom: number; x: number; y: number },
    attempt = 0,
  ): void {
    if (this.activeTab !== id || !this.surface) return;
    if (this.surface.showReadingView(view)) return;
    if (attempt < 20) window.setTimeout(() => this.restoreTabView(id, view, attempt + 1), 50);
  }

  private loadLastTabs(): LastTabs {
    const raw: unknown = this.app.loadLocalStorage(LAST_TABS_KEY);
    if (typeof raw !== "string") return {};
    try {
      return parseLastTabs(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  private saveLastTabs(map: LastTabs): void {
    this.app.saveLocalStorage(LAST_TABS_KEY, JSON.stringify(map));
  }

  /** A yes/no this device keeps (`storedFlag`); no when storage cannot be read. */
  private deviceFlag(key: string): boolean {
    try {
      return storedFlag(this.app.loadLocalStorage(key));
    } catch {
      return false;
    }
  }

  private setDeviceFlag(key: string, on: boolean): void {
    try {
      this.app.saveLocalStorage(key, flagToStore(on));
    } catch {
      // Storage refused: it is asked again next time.
    }
  }

  /** True the first time on this device, and never again. */
  private deviceFlagOnce(key: string): boolean {
    if (this.deviceFlag(key)) return false;
    this.setDeviceFlag(key, true);
    return true;
  }

  /** This device remembers the tab the notebook is on (not the file: it would change it). */
  private rememberActiveTab(): void {
    const path = this.file?.path;
    if (!path || path !== this.loadedPath) return;
    const map = this.loadLastTabs();
    const next = rememberTab(map, path, this.activeTab);
    if (next !== map) this.saveLastTabs(next);
  }

  // --- Page sidebar ---------------------------------------------------------

  private toggleSidebar(): void {
    if (!this.sidebar) return;
    // Where the page is now, so it can glide from there to its new place.
    const before = this.surface?.pageClientRect() ?? null;
    // The pages take the left of the page from the Ask sidebar.
    if (!this.sidebar.isOpen) this.chatPanel?.close();
    const open = this.sidebar.toggle(true);
    if (open) this.sidebar.setCurrentPage(this.surface?.currentPage ?? 0);
    this.syncSidebarInset();
    // The surface narrows as the panel opens; its ResizeObserver would catch
    // that a frame late, so lay out now and the page never flashes clipped.
    this.surface?.keepScaleOnResize();
    this.surface?.layout();
    // The panel slides in (or out) while the page glides beside it, both
    // GoodNotes' 200 ms `ease`, instead of everything jumping in one frame.
    if (before) this.surface?.glideFrom(before, PANEL_SLIDE_MS);
  }

  /**
   * A pinch closed well past the fit: every page, in the sidebar's overview.
   * A shut sidebar opens under it, without its slide (the overview covers
   * it), and shuts again when the overview closes.
   */
  private openOverviewFromPinch(snapshot: PageSnapshot | null): void {
    const sidebar = this.sidebar;
    if (!sidebar || sidebar.isOverview) return;
    if (!sidebar.isOpen) {
      this.chatPanel?.close();
      sidebar.setOpen(true);
      sidebar.setCurrentPage(this.surface?.currentPage ?? 0);
      this.syncSidebarInset();
      this.surface?.layout();
      this.sidebarForOverview = true;
    }
    sidebar.setOverview(true, true, snapshot);
  }

  /** The overview closed: shut the sidebar a pinch opened for it. */
  private closeSidebarAfterOverview(): void {
    if (!this.sidebarForOverview) return;
    this.sidebarForOverview = false;
    // After the sidebar's own call returns: closing the sidebar also closes
    // the overview, and calls back here halfway through.
    queueMicrotask(() => {
      if (!this.sidebar?.isOpen || this.sidebar.isOverview) return;
      this.sidebar.setOpen(false);
      this.syncSidebarInset();
      this.surface?.layout();
    });
  }

  /** Keep the floating options pill over the page area, right of the sidebar. */
  private syncSidebarInset(): void {
    const open = this.sidebar?.isOpen ?? false;
    this.toolbar?.setThumbnailsOpen(open, open ? (this.sidebar?.el.offsetWidth ?? 0) : 0);
    if (this.chatPanel?.isOpen) this.toolbar?.setLeftInset(this.chatPanel.el.offsetWidth);
  }

  private sidebarRendering(painter: VaultBackdropRenderer): PageSidebarRenderOptions {
    return {
      painter,
      images: this.images ?? undefined,
      // The thumbnails follow the pages: dark with dark pages.
      paper: this.surface?.paperTheme ?? this.shownPaper(),
      usePressure: this.settings.pressureWidth,
      highlighterAlpha: this.settings.highlighterAlpha,
      notebookTitle: this.notebookTitle(),
    };
  }

  private updateSidebarRendering(): void {
    if (this.thumbBackdrops) {
      this.sidebar?.setRenderOptions(this.sidebarRendering(this.thumbBackdrops));
    }
  }

  /**
   * "Link to…" on lassoed ink: pick a note, a heading or a web address, and
   * link those strokes to it as one undo step; or remove their link.
   */
  private linkInk(
    index: number,
    strokeIds: string[],
    current: string | null,
    suggestion?: string,
  ): void {
    if (this.refuseOnPdfTab()) return;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const picker = new LinkSuggestModal(this.app, {
      notes: this.linkableNotes(),
      current,
      chosenFrom: (query) => {
        if (read) this.recordEdits(page, read.words, query);
      },
      choose: (target) => {
        // By identity: the page may move or go while the list is open.
        if (this.isProtected() || this.surface !== surface) return;
        if (!surface.document.pages.includes(page)) return;
        const commands = linkStrokes(surface.document, page, touchedInk(strokeIds, read), target);
        if (commands.length === 0) return;
        const label = target === null ? t("view.link.removeLabel") : t("view.link.label");
        surface.applyCommand(new CompositeCommand(label, commands));
        this.requestSave();
      },
    });
    picker.open();
    // A handwritten [[link]] starts from its name; other new links from what
    // the ink says, read on this device.
    if (suggestion) picker.suggest(suggestion);
    else if (current === null) {
      void this.readSelection(page, strokeIds).then((found) => {
        read = found;
        if (found.text) picker.suggest(found.text, found.fixes);
      });
    }
  }

  /**
   * Turn into › Task (2.5): ask what the ink says, starting from what this
   * device reads in it, and make it a checklist item.
   */
  private makeInkTask(index: number, strokeIds: string[]): void {
    if (this.refuseOnPdfTab()) return;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const modal = new TaskModal(this.app, undefined, (text) => {
      // By identity: the page may move or go while the dialog is open.
      if (this.isProtected() || this.surface !== surface) return;
      if (!surface.document.pages.includes(page)) return;
      if (read) this.recordEdits(page, read.words, text);
      const commands = makeTask(surface.document, page, touchedInk(strokeIds, read), text);
      if (commands.length === 0) return;
      surface.applyCommand(new CompositeCommand(t("view.task.label"), commands));
      this.requestSave();
    });
    modal.open();
    void this.readSelection(page, strokeIds).then((found) => {
      read = found;
      if (found.text) modal.suggest(found.text, found.fixes);
    });
  }

  /**
   * The lasso's Screenshot: the picture in a small dialog, to copy, or to
   * share through the system's share sheet (or save into the notebook's
   * pictures folder where the platform cannot share a file). With `others`,
   * a choice in it shows the selection alone or the page alone instead.
   */
  private showScreenshot(shot: ScreenshotPicture, others?: ScreenshotOthers): void {
    const note = this.file;
    new ScreenshotModal(
      this.app,
      shot,
      "Screenshot.png",
      {
        copy: (picture) => writePngToClipboard(Promise.resolve(picture)),
        save: async ({ png, width, height }) => {
          if (!note) return null;
          try {
            const prepared = { bytes: await png.arrayBuffer(), mime: "image/png", ext: "png" };
            const folder = this.attachmentFolder("images");
            // "Biology.notebook" names the notebook "Biology".
            const name = `${note.basename.replace(/\.[^.]*$/, "")} screenshot.png`;
            return (
              await saveImageAttachment(
                this.app,
                { ...prepared, width, height },
                name,
                note.path,
                folder,
              )
            ).path;
          } catch {
            return null;
          }
        },
        tell: (text) => new Notice(text),
      },
      others,
    ).open();
  }

  /**
   * Turn into › Text (FineNotes#42): ask what the ink says, starting from
   * what this device reads in it, line by line, and replace the ink with a
   * text box saying that. Undo brings the ink back.
   */
  private turnIntoText(index: number, strokeIds: string[]): void {
    if (this.refuseOnPdfTab()) return;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const modal = new InkTextModal(this.app, (text) => {
      // By identity: the page may move or go while the dialog is open.
      if (this.isProtected() || this.surface !== surface) return;
      if (read) this.recordEdits(page, read.words, text);
      if (surface.turnInkIntoText(page, touchedInk(strokeIds, read), text)) this.requestSave();
    });
    modal.open();
    void this.readSelection(page, strokeIds, true).then((found) => {
      read = found;
      if (found.text) modal.suggest(found.text, found.fixes);
    });
  }

  /** Whether the lasso holds ink that "Turn selection into text" can act on. */
  get hasInkSelected(): boolean {
    return !this.isProtected() && (this.surface?.selectedInk() ?? null) !== null;
  }

  /** The "Turn selection into text" command: Turn into › Text on the lasso selection. */
  turnSelectionIntoText(): void {
    const ink = this.surface?.selectedInk();
    if (ink) this.turnIntoText(ink.index, ink.strokeIds);
  }

  /**
   * A shortcut whose action belongs to the view rather than the page: full
   * screen, the ruler, the sticker and sticky-note pickers, recording, and
   * stylus only mode. False when the action is not one of these.
   */
  private runShortcutAction(id: string): boolean {
    // An item shown nowhere cannot be turned on from a key either: it would be
    // on with no button to show it. Taken, so the key does nothing else.
    const item = id.startsWith("bar.") ? (id.slice(4) as BarItemId) : null;
    if (item && this.itemOff(item)) return true;
    switch (id) {
      case "view.fullscreen":
        if (!this.plugin.fullScreenOffered) return false;
        this.plugin.toggleFullScreen();
        return true;
      case "edit.turn-into-text":
        this.turnSelectionIntoText();
        return true;
      case "bar.ruler": {
        const surface = this.surface;
        if (!surface) return false;
        surface.setRulerOut(!surface.rulerOut);
        this.toolbar?.setRulerOut(surface.rulerOut);
        return true;
      }
      case "bar.sticker":
        if (this.isProtected()) return false;
        this.plugin.openStickerPicker(this.imageMenuContext());
        return true;
      case "bar.sticky":
        this.armStickyNote(DEFAULT_STICKY_COLOR);
        return true;
      case "bar.image":
        this.openImageMenu(this.containerEl);
        return true;
      case "bar.pdf":
        this.openImageMenu(this.containerEl, true);
        return true;
      case "bar.record":
        this.audio?.toggleRecording();
        return true;
      case "bar.stylus":
        void this.plugin.setOnlyStylusMode(!this.plugin.stylusOnly);
        return true;
      default:
        return false;
    }
  }

  /** The vault's notes for the link picker, most recently changed first. */
  private linkableNotes(): LinkableNote[] {
    const from = this.file?.path ?? "";
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path !== from)
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .map((file) => ({
        path: file.path,
        basename: file.basename,
        linktext: this.app.metadataCache.fileToLinktext(file, from, true),
        headings: (this.app.metadataCache.getFileCache(file)?.headings ?? []).map((h) => h.heading),
      }));
  }

  /**
   * Open where linked ink or a text box's link leads: a page of this
   * notebook by scrolling to it, a note or heading in a new tab, or a web
   * address.
   */
  private openInkLink(target: string): void {
    if (isExternalTarget(target)) {
      window.open(externalUrl(target));
      return;
    }
    const from = this.file?.path ?? "";
    const surface = this.surface;
    if (surface) {
      const index = pageInThisNotebook(
        target,
        surface.document.pages.length,
        (path) => this.app.metadataCache.getFirstLinkpathDest(path, from)?.path === from,
      );
      if (index !== null) {
        surface.goToPage(index, true);
        return;
      }
    }
    void this.app.workspace.openLinkText(target, from, true);
  }

  /**
   * "Add to contents" on a lasso selection: ask for the heading's title and
   * list it in the contents with its page (FineNotes#20).
   */
  private addSection(index: number, at: { x: number; y: number }, strokeIds: string[]): void {
    if (this.refuseOnPdfTab()) return;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    let read: SelectionText | null = null;
    const modal = new ContentsTitleModal(
      this.app,
      index,
      undefined,
      (title) => {
        // By identity: the page may move or go while the dialog is open.
        if (this.isProtected() || this.surface !== surface) return;
        if (!surface.document.pages.includes(page)) return;
        const id = nextSectionId(surface.document);
        surface.applyCommand(new SetSection(page, id, { x: at.x, y: at.y, title }));
        this.requestSave();
        if (read) this.recordEdits(page, read.words, title);
      },
      "section",
    );
    modal.open();
    // The heading's ink, read on this device, fills the title once it is read.
    void this.readSelection(page, strokeIds).then((found) => {
      read = found;
      if (found.text) modal.suggest(found.text, found.fixes);
    });
  }

  /**
   * Turn into › Frame to embed (discussion #167): ask for a name, pre-filled
   * from the ink as a contents heading is, and frame the selection with it,
   * so a Markdown note can embed that part alone. A name another frame of
   * this page already has moves that frame here (its embeds keep working);
   * one a frame on another page has is numbered. The embed link is copied.
   */
  private addRegion(index: number, bounds: Bounds, strokeIds: string[]): void {
    if (this.refuseOnPdfTab()) return;
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    const rect = regionRect(bounds, page.geometry);
    if (!rect) return;
    let read: SelectionText | null = null;
    const modal = new ContentsTitleModal(
      this.app,
      allRegions(surface.document.pages).length,
      undefined,
      (title) => {
        // By identity: the page may move or go while the dialog is open.
        if (this.isProtected() || this.surface !== surface) return;
        if (!surface.document.pages.includes(page)) return;
        const same = page.regions?.find((r) => regionKey(r.name) === regionKey(title));
        const id = same?.id ?? nextRegionId(surface.document);
        const name = same ? title : uniqueRegionName(surface.document.pages, title);
        surface.applyCommand(new SetRegion(page, id, { name, ...rect }));
        this.requestSave();
        if (read) this.recordEdits(page, read.words, title);
        this.copyRegionLink(name);
      },
      "region",
    );
    modal.open();
    void this.readSelection(page, strokeIds).then((found) => {
      read = found;
      if (found.text) modal.suggest(found.text, found.fixes);
    });
  }

  /** A tap on a frame's name: copy its embed link, rename it, or delete it. */
  private regionMenu(shown: ShownRegion, anchor: HTMLElement): void {
    const surface = this.surface;
    const page = surface?.document.pages[shown.index];
    const { region } = shown;
    if (!surface || !page) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("view.region.copyLink"))
        .setIcon("link")
        .onClick(() => this.copyRegionLink(region.name)),
    );
    if (!this.isProtected()) {
      menu.addItem((item) =>
        item
          .setTitle(t("view.region.rename"))
          .setIcon("pencil")
          .onClick(() => this.renameRegion(page, region.id)),
      );
      menu.addItem((item) =>
        item
          .setTitle(t("view.region.delete"))
          .setIcon("trash-2")
          .setWarning(true)
          .onClick(() => {
            if (this.isProtected() || this.surface !== surface) return;
            surface.applyCommand(new SetRegion(page, region.id, null));
            this.requestSave();
          }),
      );
    }
    const r = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
    // A tap anywhere else closes it, the page included (menu-dismiss.ts).
    const surfaceEl = surface.surfaceEl;
    closeMenuOnPressOutside(menu, anchor.ownerDocument, (target) => surfaceEl.contains(target));
  }

  private renameRegion(page: Page, id: string): void {
    const surface = this.surface;
    const region = page.regions?.find((r) => r.id === id);
    if (!surface || !region || this.isProtected()) return;
    new ContentsTitleModal(
      this.app,
      0,
      region.name,
      (title) => {
        if (this.isProtected() || this.surface !== surface) return;
        const now = page.regions?.find((r) => r.id === id);
        if (!now || !surface.document.pages.includes(page)) return;
        const name = uniqueRegionName(surface.document.pages, title, id);
        surface.applyCommand(new SetRegion(page, id, { ...now, name }));
        this.requestSave();
      },
      "region",
    ).open();
  }

  /** Copy the embed that shows frame `name` of this notebook in a note, in the vault's link style. */
  private copyRegionLink(name: string): void {
    const file = this.file;
    if (!file) return;
    const link = this.app.fileManager.generateMarkdownLink(file, "", `#${name}`);
    void writeSystemText(link.startsWith("!") ? link : `!${link}`).then(
      () => new Notice(t("view.region.linkCopied")),
      () => new Notice(t("view.clipboardUnavailable")),
    );
  }

  /**
   * What lassoed ink says, read on this device; "" when on-device reading is
   * off, there is no ink, or it cannot be read. Never throws: a suggestion
   * that does not come is no error.
   *
   * When the selection is whole words of the page's latest reading (at the
   * page's content now), their text is used: read alone, a word loses the
   * line around it. Those words are then checked against the word list.
   */
  private async readSelection(
    page: Page,
    strokeIds: readonly string[],
    keepLines = false,
  ): Promise<SelectionText> {
    const none: SelectionText = { text: "", fixes: [], words: [] };
    if (this.settings.handwritingOnDevice === false || strokeIds.length === 0) return none;
    const entry = this.pageReadings.get(page.id);
    if (entry && entry.hash === pageContentHash(page)) {
      const words = selectionWords(entry.words, entry.read, strokeIds);
      if (words) {
        const text = keepLines ? wordsByLine(words) : words.map((w) => w.text).join(" ");
        return { text, fixes: await this.spellingFixes(page, entry, words), words };
      }
    }
    const ids = new Set(strokeIds);
    const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
    if (strokes.length === 0) return none;
    try {
      const text = await this.plugin.handwriting.readInk(strokes, keepLines);
      return { text, fixes: [], words: [] };
    } catch {
      return none;
    }
  }

  /**
   * "Did you mean …?" for the words of a lassoed selection that would be
   * underlined, from the list words their kept frames fit (lexicon.ts):
   * only below `SUGGEST_MARGIN`, cased like the word as read. When the
   * worker no longer keeps the page, it is read once more to keep it.
   */
  private async spellingFixes(
    page: Page,
    entry: PageWords,
    words: readonly ReadWord[],
    retried = false,
  ): Promise<SpellingFix[]> {
    const file = this.file;
    const lexicon = this.plugin.wordCheck.lexicon();
    if (!file || !lexicon) return [];
    try {
      const flagged = (
        await this.plugin.wordCheck.flags(file.path, page.id, words, entry.language)
      ).filter((w) => w.at);
      if (flagged.length === 0) return [];
      // The underlines' own suggestions, when this reading was checked already.
      const checked = this.checkedWords.get(page.id);
      const cached = checked?.hash === entry.hash ? checked.suggestions : undefined;
      const found = new Map<string, LexiconSuggestion | null>();
      const missing = flagged.filter((w) => {
        const hit = cached?.get(strokeKey(w.strokeIds));
        if (hit !== undefined) found.set(strokeKey(w.strokeIds), hit);
        return hit === undefined;
      });
      if (missing.length > 0) {
        const items = missing.map((w) => {
          const at = w.at as NonNullable<ReadWord["at"]>;
          return { line: at.line, text: entry.lines[at.line], start: at.start, end: at.end };
        });
        const results =
          entry.id === undefined
            ? null
            : await this.plugin.handwriting.suggest(entry.id, items, lexicon);
        if (results === null) {
          // Not kept (or never was): read the page again, keeping it, once.
          if (retried || this.deviceBusy) return [];
          this.deviceBusy = true;
          let reading: PageReading;
          try {
            reading = await this.plugin.handwriting.readPage(
              page.strokes,
              true,
              await this.readingContext(page),
            );
          } finally {
            this.deviceBusy = false;
          }
          if (pageContentHash(page) !== entry.hash) return [];
          const again = this.keepReading(page, entry.hash, reading);
          const keys = new Set(words.map((w) => strokeKey(w.strokeIds)));
          const same = again.words.filter((w) => keys.has(strokeKey(w.strokeIds)));
          return this.spellingFixes(page, again, same, true);
        }
        missing.forEach((w, i) => found.set(strokeKey(w.strokeIds), results[i] ?? null));
      }
      const fixes: SpellingFix[] = [];
      for (const word of flagged) {
        const hit = found.get(strokeKey(word.strokeIds));
        if (!hit || hit.margin >= SUGGEST_MARGIN || hit.words.length === 0) continue;
        const { cs, ce } = wordCore({ text: word.text, start: 0, end: word.text.length });
        const core = word.text.slice(cs, ce);
        const offered = [...new Set(hit.words.map((w) => matchCase(core, w)))];
        fixes.push({ token: word.text, words: offered.map((w) => replaceCore(word.text, w)) });
      }
      return fixes;
    } catch {
      return [];
    }
  }

  /**
   * The field a lassoed selection filled was confirmed: each read word it
   * corrects (`editedWords`) is recorded as a misread of that word's ink.
   */
  private recordEdits(
    page: Page,
    words: readonly ReadWord[],
    final: string,
    correcting = false,
  ): void {
    const file = this.file;
    // A title edited without Correct may fix a misread or the writer's own spelling, and
    // nothing tells which (RESEARCH-LOG 2026-11-25): only Correct teaches Grape.
    if (!file || words.length === 0 || !correcting) return;
    const phrase = editedPhrase(words, final);
    // Words joined or split: the whole selection is one labelled line.
    const edits = phrase
      ? [{ word: { text: phrase.read, strokeIds: phrase.strokeIds }, text: phrase.text }]
      : editedWords(words, final, correcting);
    for (const { word, text } of edits) {
      const ids = new Set(word.strokeIds);
      const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
      void this.plugin.wordCheck
        .record({ note: file.path, pageId: page.id, word, strokes }, "misread", text)
        .then(() => this.searchAnswered(page.id));
    }
  }

  /**
   * Indent (`+1`) or outdent (`-1`) contents entry `at`, the entries inside
   * it with it (discussion #185). One undo step; nothing when it cannot move.
   */
  private shiftContentsLevel(at: number, delta: 1 | -1): void {
    const surface = this.surface;
    if (!surface || this.isProtected()) return;
    const changes = levelShift(surface.document, at, delta);
    if (!changes) return;
    const label = delta > 0 ? t("view.contents.indent") : t("view.contents.outdent");
    surface.applyCommand(new SetContentsLevels(changes, label));
    this.sidebar?.flush();
    this.requestSave();
  }

  /** A contents entry was dragged: it and what it stands for, as one undo step. */
  private moveContents(at: number, gap: number, level: ContentsLevel): void {
    const surface = this.surface;
    if (!surface || this.isProtected()) return;
    const drop = planContentsDrop(surface.document, at, gap, level);
    if (!drop) return;
    surface.applyCommand(new MoveContents(drop, t("view.contents.moved")));
    this.sidebar?.flush();
    this.requestSave();
  }

  /** Name a new chapter of its own and stand it before page `index`. */
  private newChapter(index: number): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    new ContentsTitleModal(
      this.app,
      index,
      undefined,
      (title) => {
        if (this.isProtected() || this.surface !== surface) return;
        if (!surface.document.pages.includes(page)) return;
        surface.applyCommand(new SetChapter(page, nextSectionId(surface.document), title));
        this.sidebar?.flush();
        this.requestSave();
      },
      "chapter",
    ).open();
  }

  private chapterAction(action: SectionAction, index: number, chapter: PageChapter): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    if (action === "remove") {
      surface.applyCommand(new SetChapter(page, chapter.id, null));
      this.sidebar?.flush();
      this.requestSave();
      return;
    }
    new ContentsTitleModal(
      this.app,
      index,
      chapter.title,
      (title) => {
        if (this.isProtected() || this.surface !== surface) return;
        // By id: dragging may have stood it by another page since.
        const holder = surface.document.pages.find((each) =>
          each.chapters?.some((c) => c.id === chapter.id),
        );
        if (!holder) return;
        surface.applyCommand(new SetChapter(holder, chapter.id, title));
        this.sidebar?.flush();
        this.requestSave();
      },
      "chapter",
    ).open();
  }

  /**
   * After a PDF's pages went in: its outline (bookmarks) as contents entries
   * on those pages, and a notice saying so with Undo (discussion #185). Quiet
   * when the PDF has no outline, or none of it lands on these pages.
   */
  private async addPdfOutline(
    surface: InkSurface,
    path: string,
    bytes: ArrayBuffer | Uint8Array,
    pages: Page[],
  ): Promise<void> {
    const items = await readPdfOutline(bytes);
    if (items.length === 0 || this.surface !== surface || this.isProtected()) return;
    const here = pages.filter((page) => surface.document.pages.includes(page));
    const contents = outlineContents(surface.document, path, items, here);
    const count = addedEntries(contents);
    if (count === 0) return;
    const command = new SetPagesContents(contents, t("view.contents.fromPdf"));
    surface.applyCommand(command);
    this.sidebar?.flush();
    this.requestSave();
    this.offerContentsUndo(count, () => {
      if (this.surface !== surface || this.isProtected()) return;
      if (surface.isLatest(command)) surface.undo();
      else
        surface.applyCommand(
          new SetPagesContents(clearedContents(here), t("view.contents.remove")),
        );
      this.sidebar?.flush();
      this.requestSave();
    });
  }

  /**
   * A notebook just made from a PDF arrives with the PDF's outline in its
   * contents (`main.ts`); this is its notice, whose Undo takes every entry
   * out again as one step of this notebook's undo.
   */
  offerPdfContentsUndo(count: number): void {
    const surface = this.surface;
    if (!surface) return;
    this.offerContentsUndo(count, () => {
      if (this.surface !== surface || this.isProtected()) return;
      const cleared = clearedContents(surface.document.pages);
      if (cleared.length === 0) return;
      surface.applyCommand(new SetPagesContents(cleared, t("view.contents.remove")));
      this.sidebar?.flush();
      this.requestSave();
    });
  }

  private offerContentsUndo(count: number, undo: () => void): void {
    const notice = new Notice(
      createFragment((fragment) => {
        fragment.createSpan({ text: tn("view.contents.addedFromPdf", count) });
        const button = fragment.createEl("button", {
          cls: "goodobsidian-notice-action clickable-icon",
          text: t("common.undo"),
        });
        button.addEventListener("click", () => {
          notice.hide();
          undo();
        });
      }),
      10000,
    );
  }

  /** Rename or remove a section, from its menu in the Contents tab. */
  private sectionAction(action: SectionAction, index: number, section: PageSection): void {
    const surface = this.surface;
    const page = surface?.document.pages[index];
    if (!surface || !page || this.isProtected()) return;
    if (action === "remove") {
      surface.applyCommand(new SetSection(page, section.id, null));
      this.requestSave();
      return;
    }
    new ContentsTitleModal(
      this.app,
      index,
      section.title,
      (title) => {
        if (this.isProtected() || this.surface !== surface) return;
        const now = page.sections?.find((s) => s.id === section.id);
        if (!surface.document.pages.includes(page) || !now) return;
        surface.applyCommand(new SetSection(page, section.id, { x: now.x, y: now.y, title }));
        this.requestSave();
      },
      "section",
    ).open();
  }

  /**
   * One entry of a thumbnail's "…" menu. Each is a single undoable command on
   * the surface's stack, like every other edit.
   */
  private pageAction(action: PageAction, index: number, anchor: HTMLElement): void {
    // A PDF's slides are the PDF's: only the marks on one can be cleared.
    if (action !== "clear" && this.refuseOnPdfTab()) return;
    // Not an edit: a protected note can still be linked to.
    if (action === "copy-link") {
      this.copyPageLink(index);
      return;
    }
    if (this.isProtected()) return;
    const surface = this.surface;
    if (!surface) return;
    const doc = surface.document;
    const page = doc.pages[index];
    if (!page) return;
    switch (action) {
      case "add-before":
      case "add-after":
        this.openAddPage(anchor, index, action === "add-before" ? "before" : "after");
        return;
      case "change-template":
        this.openTemplatePicker("change", index, "after");
        return;
      case "change-cover":
        this.openCoverPicker(anchor, index);
        return;
      case "convert-to-notebook":
        this.convertToNotebook();
        return;
      case "bookmark":
        surface.applyCommand(new SetPageBookmark(page, page.bookmarked !== true));
        break;
      case "tab":
        surface.applyCommand(
          new SetPageTab(page, page.tab ? null : nextTabColor(surface.document)),
        );
        break;
      case "contents":
        // By identity: the page may move or go while the dialog is open.
        new ContentsTitleModal(this.app, index, page.title, (title) => {
          if (this.isProtected() || this.surface !== surface) return;
          if (!surface.document.pages.includes(page)) return;
          surface.applyCommand(new SetPageTitle(page, title));
          this.requestSave();
        }).open();
        return;
      case "contents-remove":
        if (page.title === undefined) return;
        surface.applyCommand(new SetPageTitle(page, null));
        break;
      case "duplicate": {
        if (this.refuseSinglePage()) return;
        const copy = duplicatePageAfter(doc, index);
        if (!copy) return;
        surface.applyCommand(new AddPage(copy.index, copy.page));
        surface.goToPage(copy.index, true);
        break;
      }
      case "move-up":
      case "move-down": {
        const to = action === "move-up" ? index - 1 : index + 1;
        if (to < 0 || to >= doc.pages.length) return;
        surface.applyCommand(new MovePage(index, to));
        surface.goToPage(to, true);
        break;
      }
      case "clear":
        if (page.strokes.length === 0) return;
        surface.applyCommand(new ClearPage(page.id));
        break;
      case "delete":
        if (doc.pages.length <= 1) return;
        surface.applyCommand(new RemovePage(index));
        surface.goToPage(Math.min(index, doc.pages.length - 1));
        new Notice(
          this.isBoard
            ? t("view.deleteBoard.done", { board: index + 1 })
            : t("view.deletePage.done", { page: index + 1 }),
        );
        break;
    }
    this.requestSave();
  }

  /**
   * Pages dragged in the sidebar or its overview: `indexes` (page order) to
   * gap `gap`. One page is a `MovePage`, as its menu's Move up and down are;
   * several are one `MovePages`. Either way one undo step, and the page being
   * read stays the page being read (`keepsReading`).
   */
  private movePages(indexes: readonly number[], gap: number): void {
    const surface = this.surface;
    if (!surface || this.isProtected() || (this.isSinglePage && !this.isBoard)) return;
    const doc = surface.document;
    const total = doc.pages.length;
    if (indexes.length === 1) {
      const to = moveIndexForGap(indexes[0], gap, total);
      if (to === null) return;
      surface.applyCommand(new MovePage(indexes[0], to));
    } else {
      if (indexes.length === 0 || isNoOpBlockMove(total, indexes, gap)) return;
      surface.applyCommand(new MovePages(this.pagesAt(indexes), gap));
    }
    // Show the new order at once, not after the edit debounce.
    this.sidebar?.flush();
    this.requestSave();
  }

  /** The pages at `indexes`, by identity, for commands that must outlive a reorder. */
  private pagesAt(indexes: readonly number[]): Page[] {
    const pages = this.surface?.document.pages ?? [];
    return indexes.map((i) => pages[i]).filter((page): page is Page => page !== undefined);
  }

  /** Ask where the pages at `indexes` should go: another notebook (FineNotes#33). */
  private chooseNotebookFor(indexes: readonly number[]): void {
    const surface = this.surface;
    const file = this.file;
    if (!surface || !file || this.isDamaged()) return;
    const pages = this.pagesAt(indexes);
    if (pages.length === 0) return;
    let copyOnly: string | null = null;
    if (isReadOnly(surface.document)) {
      copyOnly = t("view.transfer.readOnly");
    } else if (pages.length >= surface.document.pages.length) {
      copyOnly = t("view.transfer.allPages");
    }
    new MovePagesModal(this.app, {
      count: pages.length,
      targets: this.plugin.transferTargets(),
      recent: this.plugin.recentTransferTargets(),
      exclude: file.path,
      copyOnly,
      onChoose: (choice) => void this.sendPages(surface, pages, choice),
    }).open();
  }

  /**
   * Copy `pages` into the notebook chosen, then (unless it is a copy) take
   * them out of this one as one undoable step. The copy is made first, so a
   * failure never costs a page. The notice's Undo takes both back.
   */
  private async sendPages(
    surface: InkSurface,
    pages: readonly Page[],
    { destination, copy }: MoveChoice,
  ): Promise<void> {
    if (this.surface !== surface) return;
    const here = pages.filter((page) => surface.document.pages.includes(page));
    if (here.length === 0) return;
    const receipt: TransferReceipt | string =
      destination.kind === "new"
        ? await this.plugin.sendPagesToNewNotebook(destination.title, here)
        : await this.plugin.sendPages(destination.target.path, here);
    if (typeof receipt === "string") {
      new Notice(t("view.notice.plain", { message: receipt }), 8000);
      return;
    }
    this.plugin.rememberTransferTarget(receipt.path);
    let removal: RemovePages | null = null;
    if (
      !copy &&
      this.surface === surface &&
      !isReadOnly(surface.document) &&
      here.length < surface.document.pages.length
    ) {
      removal = new RemovePages(here);
      surface.applyCommand(removal);
      this.sidebar?.flush();
      this.requestSave();
    }
    const moved = removal;
    const message = transferNotice(here.length, receipt.title, moved === null);
    const notice = new Notice(
      createFragment((fragment) => {
        fragment.createSpan({ text: message });
        const undo = fragment.createEl("button", {
          cls: "goodobsidian-notice-action clickable-icon",
          text: t("common.undo"),
        });
        undo.addEventListener("click", () => {
          notice.hide();
          void this.undoTransfer(surface, moved, receipt);
        });
      }),
      10000,
    );
  }

  /** Put the pages back here (if they were moved) and take them out of where they went. */
  private async undoTransfer(
    surface: InkSurface,
    removal: RemovePages | null,
    receipt: TransferReceipt,
  ): Promise<void> {
    if (removal) {
      // Here first: the copy over there is the only other copy of these pages.
      if (this.surface !== surface || !surface.isLatest(removal)) {
        new Notice(t("view.transfer.changedSince", { title: receipt.title }), 10000);
        return;
      }
      surface.undo();
      this.sidebar?.flush();
      this.requestSave();
    }
    try {
      await receipt.undo();
    } catch (error) {
      new Notice(
        t("view.transfer.undoFailed", { title: receipt.title, message: errorMessage(error) }),
        8000,
      );
    }
  }

  /**
   * Pages arriving from another notebook (FineNotes#33): added at the end as
   * one undoable step. Returns how to take them out again, or why they cannot
   * come.
   */
  receivePages(pages: readonly Page[]): { undo: () => Promise<void> } | string {
    const surface = this.surface;
    if (!surface) return t("view.transfer.notReady");
    if (this.isDamaged()) return t("view.transfer.damaged");
    const refusal = transferRefusal(surface.document);
    if (refusal) return refusal;
    const command = new ReceivePages(pages);
    surface.applyCommand(command);
    this.sidebar?.flush();
    this.requestSave();
    return {
      undo: () => {
        if (this.surface === surface) {
          surface.applyCommand(new RemovePages(command.added));
          this.sidebar?.flush();
          this.requestSave();
        }
        return Promise.resolve();
      },
    };
  }

  /** An action from the overview's selection bar, on the pages at `indexes`. */
  private selectionAction(action: SelectionAction, indexes: readonly number[]): void {
    if (action === "export") {
      this.exportPdf(indexes);
      return;
    }
    if (action === "move-to") {
      this.chooseNotebookFor(indexes);
      return;
    }
    const surface = this.surface;
    if (!surface || this.isProtected()) return;
    const pages = this.pagesAt(indexes);
    if (pages.length === 0) return;
    switch (action) {
      case "move-start":
        this.movePages(indexes, 0);
        return;
      case "move-end":
        this.movePages(indexes, surface.document.pages.length);
        return;
      case "duplicate":
        if (this.refuseSinglePage()) return;
        surface.applyCommand(new DuplicatePages(pages));
        break;
      case "bookmark": {
        // Like the page menu: all bookmarked already takes the bookmarks off.
        const on = !pages.every((page) => page.bookmarked === true);
        const label = on ? t("view.bookmarkPages") : t("view.removeBookmarks");
        surface.applyCommand(
          new CompositeCommand(
            label,
            pages.map((page) => new SetPageBookmark(page, on)),
          ),
        );
        break;
      }
      case "delete": {
        const n = pages.length;
        if (n >= surface.document.pages.length) return;
        void ConfirmModal.confirm(this.app, {
          title: tn("view.deletePages.title", n),
          message: tn("view.deletePages.message", n),
          cta: t("common.delete"),
        }).then((yes) => {
          if (!yes || this.surface !== surface || this.isProtected()) return;
          surface.applyCommand(new RemovePages(pages));
          this.sidebar?.flush();
          this.requestSave();
          new Notice(tn("view.deletePages.done", n));
        });
        return;
      }
    }
    this.sidebar?.flush();
    this.requestSave();
  }

  /** Copy the PDF text under the highlights on the page in view. */
  copyHighlightedText(): void {
    this.surface?.copyHighlightedText();
  }

  /**
   * Copy a link that opens this notebook on page `index` (0-based), in the
   * vault's own link style: `[[Physics.ink#page=3|Physics, page 3]]`.
   * GoodNotes' address bar always holds one; here `setEphemeralState` reads
   * it back. Defaults to the page being read.
   */
  copyPageLink(index = this.surface?.currentPage ?? 0): void {
    const file = this.file;
    if (!file) return;
    const page = index + 1;
    const link = this.app.fileManager.generateMarkdownLink(
      file,
      "",
      `#page=${page}`,
      pageLinkLabel(file.basename, page),
    );
    void writeSystemText(link).then(
      () => new Notice(t("view.link.pageCopied", { page })),
      () => new Notice(t("view.clipboardUnavailable")),
    );
  }

  // --- The ⋯ panel -----------------------------------------------------------

  /**
   * GoodNotes' ⋯ sheet, for the page being read. A second tap on ⋯ closes it.
   * Everything it offers goes through `pageAction`, so it is undoable and
   * refused on a protected note exactly as the sidebar's page menu is.
   */
  private toggleMorePanel(anchor: HTMLElement): void {
    const open = this.morePanel;
    this.morePanel = null;
    if (open?.isOpen) {
      open.close();
      if (open.anchorEl === anchor) return;
    }
    const surface = this.surface;
    if (!surface) return;
    const doc = surface.document;
    const index = Math.max(0, Math.min(doc.pages.length - 1, surface.currentPage));
    const page = doc.pages[index];
    if (!page) return;
    const act = (action: PageAction, at: number, button: HTMLElement = anchor): void =>
      this.pageAction(action, at, button);
    this.morePanel = new MorePanel(
      anchor,
      {
        index,
        total: doc.pages.length,
        bookmarked: page.bookmarked === true,
        titled: page.title !== undefined,
        cover: page.backdrop.kind !== "pdf" && isCoverRuling(page.backdrop.kind),
        single: this.isSinglePage,
        board: this.showingBoard,
        // A PDF's slides are fixed, as a practice file's pages are.
        fixed: this.isPractice || this.onPdfTab,
        clearable: page.strokes.length > 0,
        ...(page.backdrop.kind !== "pdf" && isCoverRuling(page.backdrop.kind)
          ? {}
          : {
              margin: { side: marginSideOf(marginOf(page)), percent: marginPercentOf(page) },
            }),
        darkPages: surface.paperTheme.night === true,
        darkPdf: this.settings.invertPdfPages !== false,
        desk: {
          choice: deskChoiceOf(this.settings.desk),
          color:
            deskColorOf({ desk: "custom", deskColor: this.settings.deskColor }) ?? LIGHT_PAPER.desk,
        },
        folded: this.toolbar?.foldedItems() ?? [],
        fingerDrawing: this.plugin.fingerDrawing,
        freePageEdges: this.settings.freePageEdges,
        lockFitWidth: this.settings.holdFitWidth,
      },
      {
        paintThumbnail: (canvas, at, width) => this.sidebar?.paintThumbnail(canvas, at, width),
        toggleBookmark: (at) => act("bookmark", at),
        editTitle: (at) => act("contents", at),
        copyLink: (at) => act("copy-link", at),
        duplicate: (at) => act("duplicate", at),
        // A cover opens its picker on ⋯ itself: the row it was chosen from is gone.
        saveAsTemplate: (at) => void this.savePageAsTemplate(at),
        openMargin: (at) => this.openMarginPopover(at, anchor),
        changeTemplate: (at) => {
          const target = doc.pages[at];
          const cover =
            !!target && target.backdrop.kind !== "pdf" && isCoverRuling(target.backdrop.kind);
          act(cover ? "change-cover" : "change-template", at);
        },
        goToPage: (at) => surface.goToPage(at, true),
        clear: (at) => act("clear", at),
        remove: (at) => act("delete", at),
        toggleDarkPages: () =>
          void this.plugin.setPageAppearance(surface.paperTheme.night ? "light" : "dark"),
        setDarkPdf: (dark) => {
          this.plugin.settings.invertPdfPages = dark;
          void this.plugin.applyPageAppearance();
        },
        setDesk: (choice, color) => {
          this.plugin.settings.desk = choice;
          if (color !== undefined) this.plugin.settings.deskColor = color;
          void this.plugin.applyPageAppearance();
        },
        present:
          this.showingBoard || this.isPractice || this.onPdfTab
            ? undefined
            : () => this.startPresenting(),
        showShortcuts: () => this.toggleShortcuts(),
        shortcutsKey: () =>
          Platform.isMobile
            ? null
            : fastKeys("shortcuts", this.plugin.shortcuts.table, Platform.isMacOS),
        copyHomeLink: () => this.copyHomeLink(),
        // Where touch exists: on a desktop the mouse draws already.
        setFreePageEdges: (on) => void this.plugin.setFreePageEdges(on),
        setLockFitWidth: (on) => void this.plugin.setHoldFitWidth(on),
        setFingerDrawing:
          navigator.maxTouchPoints > 0 ? (on) => this.plugin.setFingerDrawing(on) : undefined,
      },
    );
  }

  /**
   * ⋯ › Present: the notebook as slides (`presenter.ts`). The laser is put
   * in hand and each page is fitted to the screen; on an iPad, where the
   * page cannot take the screen, Obsidian's chrome is hidden for the while.
   * Leaving puts the tool, the full screen setting and the zoom back.
   */
  startPresenting(): void {
    const surface = this.surface;
    if (!surface || this.presenter?.active) return;
    const tool = surface.toolInHand;
    const root = this.contentEl;
    const screen = docOf(root).fullscreenEnabled && typeof root.requestFullscreen === "function";
    const hideChrome = !screen && this.plugin.fullScreenOffered && !this.plugin.fullScreen;
    if (hideChrome) this.plugin.toggleFullScreen();
    surface.takeTool("laser");
    const fit = (): void => {
      if (this.surface !== surface) return;
      const index = surface.currentPage;
      surface.resetView();
      surface.goToPage(index);
    };
    this.presenter = new Presenter({
      root,
      next: () => surface.nextPage(),
      previous: () => surface.previousPage(),
      first: () => surface.goToPage(0, true),
      last: () => surface.goToPage(surface.document.pages.length - 1, true),
      page: () => ({ index: surface.currentPage, total: surface.document.pages.length }),
      onEnd: () => {
        this.presenter = null;
        if (this.surface === surface && surface.toolInHand === "laser") surface.takeTool(tool);
        if (hideChrome && this.plugin.fullScreen) this.plugin.toggleFullScreen();
        window.setTimeout(fit, PRESENT_SETTLE_MS);
      },
    });
    // The chrome went and the screen grew: fit once the pane has its new size.
    window.setTimeout(fit, PRESENT_SETTLE_MS);
  }

  /**
   * The `obsidian://open` link to this notebook, for a home-screen shortcut
   * (the Shortcuts app's "Open URLs" on an iPad) or a bookmark.
   */
  copyHomeLink(): void {
    const file = this.file;
    if (!file) return;
    const link = obsidianOpenUri(this.app.vault.getName(), file.path);
    void writeSystemText(link).then(
      () => new Notice(t("view.link.homeCopied"), 8000),
      () => new Notice(t("view.clipboardUnavailable")),
    );
  }

  /**
   * The keyboard and stylus shortcuts in a pop-up (? on the page, the
   * command, the ⋯ panel); asked again while it shows, it closes.
   */
  toggleShortcuts(): void {
    const open = this.shortcuts;
    this.shortcuts = null;
    if (open?.shown) {
      open.close();
      return;
    }
    const modal = new ShortcutsModal(
      this.app,
      Platform.isMacOS || Platform.isIosApp,
      boundShortcutGroups(this.plugin.shortcuts.table, SHORTCUT_GROUPS),
    );
    modal.open();
    this.shortcuts = modal;
  }

  // --- Templates ------------------------------------------------------------

  /**
   * Open GoodNotes' "Add Page" popover on `anchor`, for page `ref`. A second
   * tap on the same control closes it.
   */
  private openAddPage(anchor: HTMLElement, ref: number, position: InsertPosition): void {
    // A board file's "Add board": an empty board, no template to pick (discussion #160).
    if (this.isBoard) {
      this.addBoard();
      return;
    }
    const open = this.addPagePopover;
    this.addPagePopover = null;
    if (open?.popover.isOpen) {
      open.popover.close();
      if (open.anchor === anchor) return;
    }
    if (this.isProtected() || this.refuseSinglePage()) return;
    const at = Math.max(0, Math.min(this.doc.pages.length - 1, ref));
    // Its size: next to a board among the pages, a page's (discussion #160).
    const page = shapePageFor(this.doc.pages, at) ?? blankPage();
    // A cover is not paper: next to one, offer the notebook's paper.
    const paper = paperPageFor(this.doc.pages, at);
    // A page of My templates is repeated in its own shape. Beside a page with
    // a margin, a new page takes the page's first size, not the margin.
    const shapeOf = (backdrop: Backdrop): PageGeometry =>
      backdrop.kind === "pdf" && paper ? unmarginedGeometry(paper) : unmarginedGeometry(page);
    const popover = new AddPagePopover(anchor, {
      current: withoutFrame(paper?.backdrop ?? { kind: "blank" }),
      geometry: unmarginedGeometry(page),
      recent: this.loadRecentTemplates(),
      templateNames: this.templateNames(),
      position,
      paintPaper: (canvas, backdrop, cssWidth) =>
        this.paintPaperThumbnail(canvas, backdrop, shapeOf(backdrop), cssWidth),
      onPick: (backdrop, at) => this.addTemplatePage(backdrop, shapeOf(backdrop), at, ref),
      onMore: (at) => this.openTemplatePicker("add", ref, at),
      onBoard: (at, ruling) => this.addBoardPage(at, ref, ruling),
    });
    this.addPagePopover = { popover, anchor };
  }

  /**
   * The Margin popover for page `at`, from the ⋯ panel, on ⋯ itself. Every
   * choice reaches the page at once, and the whole visit is one undo step:
   * each change takes back the last one and makes the new one in its place.
   */
  private openMarginPopover(at: number, anchor: HTMLElement): void {
    if (this.marginPopover?.isOpen) {
      this.marginPopover.close();
      return;
    }
    const surface = this.surface;
    if (!surface || this.isProtected() || this.refusePractice()) return;
    const doc = surface.document;
    const page = doc.pages[at];
    if (!page) return;
    // A cover is not paper: it never gets a margin, not even with All pages.
    const pages = doc.pages.filter(
      (p) => p.backdrop.kind === "pdf" || !isCoverRuling(p.backdrop.kind),
    );
    const pdfPages = pages.filter((p) => p.backdrop.kind === "pdf");
    const reach = (scope: MarginScope): Page[] =>
      scope === "all" ? pages : scope === "pdf" ? pdfPages : [page];
    const stateOf = (
      p: Page,
    ): { margin: PageMargin; paper: MarginPaperChoice; spacing: number | null } => ({
      margin: marginOf(p),
      paper: marginPaperOf(p),
      spacing: marginSpacingOf(p) ?? null,
    });
    const before = new Map(pages.map((p) => [p, stateOf(p)] as const));
    const same = (a: PageMargin, b: PageMargin): boolean =>
      a.left === b.left && a.right === b.right;
    const here = marginOf(page);
    const floors = new Map(pages.map((p) => [p, marginFloor(p)] as const));
    const floor = (scope: MarginScope): { left: boolean; right: boolean; percent: number } => {
      let left = false;
      let right = false;
      let percent = 0;
      for (const p of reach(scope)) {
        // As it was when the popover opened: a deletion earlier in the visit
        // is taken back by the next choice, and its ink with it.
        const f = floors.get(p) ?? marginFloor(p);
        const width = frameWidth(p);
        left ||= f.left > 0;
        right ||= f.right > 0;
        if (width > 0)
          percent = Math.max(percent, Math.ceil((Math.max(f.left, f.right) / width) * 100));
      }
      return { left, right, percent };
    };
    let step: SetPageMargin | null = null;
    const apply = (choice: MarginChoice): void => {
      const scope = new Set(reach(choice.scope));
      const targets = pages.map((p) => {
        const was = before.get(p) ?? stateOf(p);
        if (!scope.has(p)) {
          return { page: p, margin: was.margin, paper: was.paper, spacing: was.spacing };
        }
        // A pitch set here reaches every page in scope; one equal to what the page draws anyway is not stored.
        const typed = choice.spacingMm === undefined ? was.spacing : mmToPage(choice.spacingMm);
        const spacing = typed === null ? null : storedMarginSpacing(p, choice.paper, typed);
        return {
          page: p,
          margin: marginFor(p, choice.side, choice.percent),
          paper: choice.paper,
          spacing,
        };
      });
      const unchanged = targets.every(({ page: p, margin, paper, spacing }) => {
        const was = before.get(p);
        return (
          !was ||
          (same(margin, was.margin) &&
            (choice.side === "none" || (paper === was.paper && spacing === was.spacing)))
        );
      });
      const next = unchanged ? null : new SetPageMargin(targets, choice.drop === true);
      const took = surface.replaceCommand(step, next);
      if (!next && step && !took) {
        // Something else was done meanwhile: put the margins back as a step of its own.
        const back = new SetPageMargin(
          pages.map((p) => ({ page: p, ...(before.get(p) ?? stateOf(p)) })),
        );
        surface.applyCommand(back);
        step = back;
      } else {
        step = next;
      }
      this.requestSave();
    };
    // A slider sends many inputs a frame; each one relays out every page. Only
    // the newest choice of a frame is applied (it felt laggy, Joost 2026-11-02).
    let pending: MarginChoice | null = null;
    let frame = 0;
    const flush = (): void => {
      if (frame) winOf(this.contentEl).cancelAnimationFrame(frame);
      frame = 0;
      const next = pending;
      pending = null;
      if (next) apply(next);
    };
    const change = (choice: MarginChoice): void => {
      pending = choice;
      if (!frame) frame = winOf(this.contentEl).requestAnimationFrame(flush);
    };
    // "PDF pages" only where it differs from both other choices.
    const scopes: MarginScope[] = [
      "page",
      ...(pdfPages.length > 1 && pdfPages.length < pages.length ? (["pdf"] as const) : []),
      ...(pages.length > 1 ? (["all"] as const) : []),
    ];
    this.marginPopover = new MarginPopover(anchor, {
      initial: {
        side: marginSideOf(here),
        percent: marginPercentOf(page) || MARGIN_DEFAULT_PERCENT,
        paper: marginPaperOf(page),
        // Slides want one margin and the handwritten pages between them none.
        scope:
          page.backdrop.kind === "pdf" && pdfPages.length > 1
            ? scopes.includes("pdf")
              ? "pdf"
              : "all"
            : "page",
      },
      scopes,
      paintPaper: (canvas, paper) => this.paintMarginSwatch(canvas, paper),
      spacingMm: (paper) => {
        // The page's own pitch, as it was when the popover opened.
        if (paper === "plain") return null;
        const px = before.get(page)?.spacing ?? defaultMarginSpacing(page, paper);
        return px === null ? null : Math.round(pageToMm(px) * 10) / 10;
      },
      floor,
      cut: (scope) => {
        let items = 0;
        let pagesCut = 0;
        for (const p of reach(scope)) {
          const n = contentCutBy(p, { left: 0, right: 0 });
          items += n;
          if (n > 0) pagesCut++;
        }
        return { items, pages: pagesCut };
      },
      onChange: change,
      onClose: () => {
        flush();
        this.marginPopover = null;
      },
    });
  }

  /** The full template picker, to add a page or to change page `ref`'s template. */
  private openTemplatePicker(mode: "add" | "change", ref: number, position: InsertPosition): void {
    if (this.isProtected() || this.refusePractice()) return;
    if (mode === "add" && this.refuseSinglePage()) return;
    const here = this.doc.pages[ref];
    if (!here) return;
    // Adding next to a board among the pages takes a page's size (discussion #160).
    const page = mode === "add" ? (shapePageFor(this.doc.pages, ref) ?? blankPage()) : here;
    // Adding next to a cover preselects the notebook's paper, never the cover.
    const reference = mode === "add" ? paperTemplateFor(this.doc.pages, ref) : page.backdrop;
    const picker = new TemplatePickerModal(this.app, {
      mode,
      initial: reference.kind === "pdf" ? { kind: "blank" } : withoutFrame(reference),
      geometry: unmarginedGeometry(page),
      papers: this.paperLibrary(),
      onApplyPaper: (entry) => void this.applyPaper(entry, mode, position, ref),
      onApply: ({ backdrop, geometry }) => {
        if (mode === "add") {
          this.addTemplatePage(backdrop, geometry ?? unmarginedGeometry(page), position, ref);
          return;
        }
        if (!this.surface || this.isProtected()) return;
        // The same size keeps the page's margin: the new paper goes in its frame.
        const frame = geometry ? undefined : page.backdrop.frame;
        const marginPaper = page.backdrop.marginPaper;
        const marginSpacing = marginSpacingOf(page);
        const next = frame
          ? {
              ...withoutFrame(backdrop),
              frame,
              ...(marginPaper ? { marginPaper } : {}),
              ...(marginSpacing !== undefined ? { marginSpacing } : {}),
            }
          : withoutFrame(backdrop);
        this.surface.applyCommand(new SetPageTemplate(page, next, geometry ?? undefined));
        this.rememberTemplate(backdrop);
        this.requestSave();
      },
    });
    this.templatePicker = picker;
    picker.open();
  }

  /**
   * "Save page as template": the page as it looks (paper, ink, text and
   * pictures) made into a PDF by the export, kept in My templates, named
   * after its title in the contents or the notebook and page number.
   */
  async savePageAsTemplate(index: number): Promise<void> {
    const note = this.file;
    const page = this.surface?.document.pages[index];
    const library = this.paperLibrary();
    if (!note || !page || !library) return;
    const name = page.title?.trim() || `${stripInkSuffix(note.basename)} page ${index + 1}`;
    const progress = new Notice(t("view.template.savingPage"), 0);
    try {
      const bytes = await exportPagesToPdf([page], this.previewSources(), { title: name });
      await library.addPdf(bytes, name);
    } catch (error) {
      new Notice(t("view.template.savePageFailed", { message: errorMessage(error) }), 8000);
    } finally {
      progress.hide();
    }
  }

  /** The template picker open now, for its previews to follow PDF pages as they render. */
  private templatePicker: TemplatePickerModal | null = null;

  /** My templates (`model/paper-library.ts`), drawn by the thumbnails' painter. */
  private paperLibrary(): VaultPaperLibrary | undefined {
    if (!this.thumbBackdrops) return undefined;
    return new VaultPaperLibrary(
      this.app,
      () => templateFolderFor(this.settings),
      (canvas, backdrop, geometry, cssWidth) =>
        this.paintPaperThumbnail(canvas, backdrop, geometry, cssWidth),
      () => this.plugin.openTemplateGallery(),
      (path) => void this.plugin.openShareTemplate(path),
    );
  }

  /** The names in My templates now, which tell an older notebook's template pages apart. */
  private templateNames(): Set<string> {
    return templateNamesIn(this.app, templateFolderFor(this.settings));
  }

  /** An empty page with paper `backdrop` (a PDF page or a designed paper), as a thumbnail `cssWidth` wide. */
  private paintPaperThumbnail(
    canvas: HTMLCanvasElement,
    backdrop: Backdrop,
    geometry: PageGeometry,
    cssWidth: number,
  ): void {
    const painter = this.thumbBackdrops;
    if (!painter) return;
    const page: Page = {
      id: "paper",
      kind: "ink",
      geometry,
      backdrop,
      strokes: [],
      images: [],
      textBoxes: [],
    };
    renderPageThumbnail(
      canvas,
      page,
      painter,
      cssWidth,
      winOf(this.contentEl).devicePixelRatio || 1,
      {
        usePressure: false,
        highlighterAlpha: this.settings.highlighterAlpha,
      },
    );
  }

  /** A Margin popover swatch: a patch of the margin paper, drawn as the page draws it. */
  private paintMarginSwatch(canvas: HTMLCanvasElement, paper: MarginPaperChoice): void {
    const kind = marginRuling(paper) ?? "blank";
    this.paintPaperThumbnail(canvas, { kind }, { width: 150, height: 90 }, MARGIN_SWATCH_CSS_WIDTH);
  }

  /**
   * Put a paper from My templates on a new page (`add`) or on page `ref`
   * (`change`). The notebook gets its own copy of the paper's PDF beside it,
   * once (`existingCopy`), and the page takes the paper's shape at the
   * notebook's width.
   */
  private async applyPaper(
    entry: PaperEntry,
    mode: "add" | "change",
    position: InsertPosition,
    ref: number,
  ): Promise<void> {
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface || this.isProtected()) return;
    if (mode === "add" && this.refuseSinglePage()) return;
    const source = this.app.vault.getFileByPath(entry.path);
    if (!source) {
      new Notice(t("view.template.gone"));
      return;
    }
    let path: string;
    try {
      const name = paperName(entry.path);
      const shown = [
        ...new Set(
          surface.document.pages.flatMap((p) =>
            p.backdrop.kind === "pdf" ? [p.backdrop.path] : [],
          ),
        ),
      ].map((shownPath) => ({
        path: shownPath,
        size: this.app.vault.getFileByPath(shownPath)?.stat.size ?? -1,
      }));
      path =
        existingCopy(shown, name, source.stat.size) ??
        (
          await saveImageAttachment(
            this.app,
            {
              bytes: await this.app.vault.readBinary(source),
              mime: "application/pdf",
              ext: "pdf",
              width: 0,
              height: 0,
            },
            `${PAPER_COPY_PREFIX}${name}`,
            note.path,
            this.attachmentFolder("images"),
          )
        ).path;
    } catch (error) {
      new Notice(t("view.template.useFailed", { message: errorMessage(error) }), 8000);
      return;
    }
    // The view may have changed while the copy saved.
    if (this.surface !== surface || this.file !== note || this.isProtected()) return;
    const page = surface.document.pages[ref];
    if (!page) return;
    const backdrop = paperBackdrop(path, entry.page);
    const geometry = paperGeometry(entry, page.geometry.width);
    if (mode === "add") {
      const doc = surface.document;
      const insert = pageFromTemplate(
        doc,
        insertIndexFor(position, ref, doc.pages.length),
        backdrop,
        geometry,
      );
      surface.applyCommand(new AddPage(insert.index, insert.page));
      surface.goToPage(insert.index, true);
    } else {
      surface.applyCommand(new SetPageTemplate(page, backdrop, geometry));
    }
    this.requestSave();
  }

  /**
   * "Change cover" for cover page `index`: the design × colour picker, hung
   * from the thumbnail's "…" button. Each tap is one undoable `changeCover`
   * (the backdrop through `SetBackdrop`, the title recoloured to match). A
   * second tap on the same button closes it.
   */
  private openCoverPicker(anchor: HTMLElement, index: number): void {
    const open = this.coverPopover;
    this.coverPopover = null;
    if (open?.popover.isOpen) {
      open.popover.close();
      if (open.anchor === anchor) return;
    }
    if (this.isProtected()) return;
    const page = this.doc.pages[index];
    if (!page || page.backdrop.kind === "pdf" || !isCoverRuling(page.backdrop.kind)) return;
    const popover = new CoverPopover(anchor, {
      backdrop: page.backdrop,
      geometry: page.geometry,
      onPick: (backdrop) => {
        if (!this.surface || this.isProtected()) return;
        const now = page.backdrop;
        const same =
          now.kind !== "pdf" &&
          now.kind === backdrop.kind &&
          now.paperColor === backdrop.paperColor;
        if (same) return;
        const command = changeCover(page, backdrop);
        if (command) this.surface.applyCommand(command);
      },
    });
    this.coverPopover = { popover, anchor };
  }

  private addTemplatePage(
    backdrop: Backdrop,
    geometry: PageGeometry,
    position: InsertPosition,
    ref: number,
  ): void {
    if (!this.surface || this.isProtected() || this.refuseSinglePage()) return;
    const doc = this.surface.document;
    const index = insertIndexFor(position, ref, doc.pages.length);
    // A page made from a page with a margin is a page of its own, not framed.
    const insert = pageFromTemplate(doc, index, withoutFrame(backdrop), geometry);
    this.surface.applyCommand(new AddPage(insert.index, insert.page));
    // Glide onto the new page, as GoodNotes does after "Add page".
    this.surface.goToPage(insert.index, true);
    if (backdrop.kind !== "pdf") this.rememberTemplate(backdrop);
    this.requestSave();
  }

  // --- Images ---------------------------------------------------------------

  /**
   * The toolbar's image menu, on `anchor`. A second tap on the button closes
   * it. Entries come from `imageMenuEntries()`, so a feature that registered
   * one (see image-menu.ts) appears here without this view knowing of it.
   */
  private openImageMenu(anchor: HTMLElement, pdf = false): void {
    if (this.refuseOnPdfTab()) return;
    const open = this.imageMenu;
    this.imageMenu = null;
    if (open?.popover.isOpen) {
      open.popover.close();
      if (open.anchor === anchor) return;
    }
    if (this.isProtected() || !this.file) return;
    const entries = pdf
      ? [
          {
            id: "files",
            icon: "file-text",
            label: t("view.pdf.fromFiles"),
            run: () => this.importPdf(),
          },
          {
            id: "vault",
            icon: "folder-open",
            label: t("view.pdf.fromVault"),
            run: () => this.importPdf(true),
          },
        ]
      : imageMenuEntries();
    const popover = new ImageMenuPopover(
      anchor,
      entries,
      this.imageMenuContext(),
      pdf ? t("view.pdf.insert") : t("view.image.insert"),
    );
    this.imageMenu = { popover, anchor };
  }

  private imageMenuContext(): ImageMenuContext {
    return {
      app: this.app,
      notePath: this.file?.path ?? "",
      host: this.contentEl,
      insertBytes: (bytes, mime, name, options) =>
        this.insertImageBytes(bytes, mime, name, options),
      insertManyBytes: (pictures) => this.insertImagesBytes(pictures),
      insertVaultFile: (path, options) => this.insertImageFromVault(path, options),
    };
  }

  /**
   * Several pictures chosen at once (FineNotes#211): each saved as an
   * attachment as {@link insertImageBytes} saves one, then all placed side
   * by side on the page in view (`placeImageGrid`) as **one** undo step. A
   * picture that cannot be read is skipped with a notice; the rest go in.
   */
  private async insertImagesBytes(
    pictures: readonly { bytes: ArrayBuffer; mime: string; name: string }[],
  ): Promise<void> {
    if (this.isProtected()) return;
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface) return;
    const progress = new Notice(t("view.image.adding"), 0);
    const saved: { path: string; width: number; height: number }[] = [];
    try {
      for (const picture of pictures) {
        try {
          const prepared = await prepareImageBytes(picture.bytes, picture.mime);
          const file = await saveImageAttachment(
            this.app,
            prepared,
            picture.name,
            note.path,
            this.attachmentFolder("images"),
          );
          saved.push({ path: file.path, width: prepared.width, height: prepared.height });
        } catch (error) {
          new Notice(t("view.image.addFailed", { message: errorMessage(error) }), 8000);
        }
        if (this.file !== note || this.surface !== surface || this.isProtected()) return;
      }
    } finally {
      progress.hide();
    }
    if (saved.length === 0) return;
    const doc = surface.document;
    const index = Math.max(0, Math.min(doc.pages.length - 1, surface.currentPage));
    const page = doc.pages[index];
    if (!page) return;
    const boxes = placeImageGrid(saved, page.geometry, surface.visibleRegion(index));
    const images = newImageElements(
      doc,
      saved.map((each) => each.path),
      boxes,
    );
    surface.applyCommand(
      new CompositeCommand(
        t("surface.command.insertImage"),
        images.map((image) => new InsertImage(page.id, image)),
      ),
    );
  }

  /**
   * Stick a note of `color` on page `index`, centred on page point `at`
   * and kept on the page (one `InsertImage`, so Undo takes it back). Unlike
   * a picture it is not selected: the next thing done with a note is
   * writing on it, and a selected one would move under the pen. The paper
   * is painted, so nothing is saved to the vault.
   */
  private insertStickyNote(color: string, index: number, at: { x: number; y: number }): void {
    if (this.refuseOnPdfTab()) return;
    const surface = this.surface;
    if (!surface || this.isProtected()) return;
    const doc = surface.document;
    const page = doc.pages[index];
    if (!page) return;
    const box = stickyBoxAt(at, STICKY_SIDE, page.geometry.width, page.geometry.height);
    const note = newStickyNote(nextImageId(doc), box, color);
    surface.applyCommand(new InsertImage(page.id, note));
  }

  /**
   * Save picture bytes as an attachment of this note and place them on a
   * page, selected — the one call every way of getting a picture in goes
   * through (Photos, the camera, and later scanning and AI generation).
   *
   * The bytes are decoded and, where it helps, downscaled to 2048 px and
   * re-encoded (JPEG 0.85; PNG when transparent; GIF and SVG untouched — see
   * `prepareImageBytes`). The file lands where the user's attachment setting
   * says, named after `suggestedName` (or "Image <timestamp>" when that is
   * generic). The placement is one `InsertImage`, so Undo takes it back; the
   * attachment file stays in the vault, as Obsidian's own pasted images do.
   *
   * Resolves with the placed element, or `null` when nothing was placed —
   * the note is protected, the view closed, or the bytes are not a picture
   * (a notice tells the user which).
   */
  async insertImageBytes(
    bytes: ArrayBuffer,
    mime: string,
    suggestedName: string,
    options: InsertImageOptions = {},
  ): Promise<ImageElement | null> {
    if (this.isProtected()) return null;
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface) return null;
    const progress = new Notice(t("view.image.adding"), 0);
    try {
      const prepared = await prepareImageBytes(bytes, mime);
      const file = await saveImageAttachment(
        this.app,
        prepared,
        suggestedName,
        note.path,
        this.attachmentFolder("images"),
      );
      if (this.file !== note || this.surface !== surface || this.isProtected()) return null;
      const place = () => this.placeImage(file.path, prepared.width, prepared.height, options);
      return options.around ? options.around(place) : place();
    } catch (error) {
      const message = errorMessage(error);
      new Notice(t("view.image.addFailed", { message }), 8000);
      return null;
    } finally {
      progress.hide();
    }
  }

  /**
   * A picture pasted from the system clipboard (Cmd/Ctrl+V, or the press
   * menu's Paste, centred on `at`): saved as an attachment and placed like
   * one from Photos. Errors end in a notice.
   */
  private async pastePictureFile(
    file: File,
    at?: { pageIndex: number; x: number; y: number },
  ): Promise<void> {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch (error) {
      const message = errorMessage(error);
      new Notice(t("view.image.pasteFailed", { message }), 8000);
      return;
    }
    const options = at ? { pageIndex: at.pageIndex, center: { x: at.x, y: at.y } } : {};
    await this.insertImageBytes(bytes, file.type, file.name || "Pasted image", options);
  }

  /**
   * Place a picture that is already in the vault, by its path — nothing is
   * copied, so two notes (or two spots on one page) can show one file.
   * Resolves with the placed element, or `null` (see {@link insertImageBytes}).
   */
  async insertImageFromVault(
    path: string,
    options: InsertImageOptions = {},
  ): Promise<ImageElement | null> {
    if (this.isProtected() || this.refuseOnPdfTab()) return null;
    const file = this.app.vault.getFileByPath(path);
    const note = this.file;
    const surface = this.surface;
    if (!file || !surface) return null;
    try {
      const bytes = await this.app.vault.readBinary(file);
      const size = await measureImage(bytes, mimeForExtension(file.extension) ?? "");
      if (this.file !== note || this.surface !== surface || this.isProtected()) return null;
      return this.placeImage(file.path, size.width, size.height, options);
    } catch (error) {
      const message = errorMessage(error);
      new Notice(t("view.image.placeFailed", { name: file.name, message }), 8000);
      return null;
    }
  }

  /**
   * Put an image of natural size `width × height` on a page through the
   * surface's undo stack, and select it. By default: the page in view,
   * centred in its visible part, fitted inside 60 % of the page.
   */
  private placeImage(
    path: string,
    width: number,
    height: number,
    options: InsertImageOptions,
  ): ImageElement | null {
    const surface = this.surface;
    if (!surface || this.isProtected()) return null;
    const doc = surface.document;
    const index = Math.max(
      0,
      Math.min(doc.pages.length - 1, options.pageIndex ?? surface.currentPage),
    );
    const page = doc.pages[index];
    if (!page) return null;
    // Centred on a point: the "visible area" is a speck around it.
    const c = options.center;
    const around = c ? { minX: c.x - 1, minY: c.y - 1, maxX: c.x + 1, maxY: c.y + 1 } : null;
    const box =
      options.box ??
      placeImageBox({ width, height }, page.geometry, around ?? surface.visibleRegion(index));
    const image = newImageElement(doc, path, box);
    surface.applyCommand(new InsertImage(page.id, image));
    if (options.select !== false) surface.selectImage(page.id, image.id);
    return image;
  }

  /**
   * File a sticker saved from a selection in the stickers folder's "My
   * stickers" collection, under a free name, and say where it went.
   */
  private async saveSticker(png: ArrayBuffer, width: number, height: number): Promise<void> {
    const note = this.file;
    if (!note) return;
    const folder = `${stickerFolderFor(this.settings)}/${SAVED_STICKERS_COLLECTION}`;
    try {
      const prepared = { bytes: png, mime: "image/png", ext: "png", width, height };
      const file = await saveImageAttachment(this.app, prepared, "Sticker", note.path, folder);
      new Notice(t("view.sticker.saved", { folder, name: file.basename }));
    } catch (error) {
      new Notice(t("view.sticker.saveFailed", { message: errorMessage(error) }), 8000);
    }
  }

  /** Import an unchanged PDF attachment or reference an existing vault PDF. */
  importPdf(fromVault = false): void {
    if (this.isProtected() || !this.file || !this.surface || this.refusePractice()) return;
    this.showTab(NOTES_TAB);
    if (this.isBoard) {
      new Notice(t("view.pdf.board"));
      return;
    }
    if (this.isSinglePage) {
      new Notice(t("view.pdf.singleImport"));
      return;
    }
    if (fromVault) {
      new VaultPdfSuggestModal(this.app, (file) => void this.importVaultPdf(file.path)).open();
    } else {
      // Several at once (FineNotes#211): every page of each, in the order chosen.
      void pickImageFiles(this.contentEl, false, "application/pdf,.pdf", true).then((files) => {
        if (files.length === 1) void this.importPdfFile(files[0]);
        else if (files.length > 1) void this.importPdfFiles(files);
      });
    }
  }

  /**
   * Several PDFs chosen at once (FineNotes#211): every page of each, after
   * the last page, in the order the picker gave them, as **one** undo step
   * (`insertScans`). No page picker: that is one PDF's choice. A PDF that
   * cannot be read is skipped with a notice.
   */
  private async importPdfFiles(files: readonly File[]): Promise<void> {
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface || this.isProtected()) return;
    const progress = new Notice(t("view.pdf.reading"), 0);
    const items: ScanItem[] = [];
    try {
      for (const file of files) {
        try {
          const bytes = await file.arrayBuffer();
          const pages = await measurePdfPages(bytes);
          items.push({
            kind: "pdf",
            bytes,
            name: file.name,
            pages: pages.map((size, page) => ({ ...size, page })),
          });
        } catch (error) {
          new Notice(
            t("view.pdf.readFailed", { name: file.name, message: errorMessage(error) }),
            8000,
          );
        }
        if (this.file !== note || this.surface !== surface || this.isProtected()) return;
      }
    } finally {
      progress.hide();
    }
    if (items.length === 0) return;
    await this.insertScans(items, t("view.pdf.importLabel"), surface.document.pages.length - 1);
  }

  /**
   * A PDF already in the vault, referenced where it is. `ask` false (a drop)
   * adds every page after the last one, with no page picker.
   */
  async importVaultPdf(path: string, ask = true): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    await this.preparePdfImport(() => this.app.vault.readBinary(file), file.name, path, ask);
  }

  /**
   * A drag over the notebook, or over the tablet drawer's backdrop above
   * it: a page takes files, text and links. A drag from outside Obsidian
   * drops as a copy (`outsideDropEffect`), since Obsidian's mobile drag
   * manager would otherwise make it a move the drag may not allow.
   */
  private acceptDrag(event: DragEvent): void {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    this.noteDrag(transfer);
    if (!takesDrag(Array.from(transfer.types))) return;
    event.preventDefault();
    if (obsidianDragging(this.app)) return;
    const effect = outsideDropEffect(transfer.effectAllowed);
    if (effect) transfer.dropEffect = effect;
  }

  /**
   * A drag over the notebook, on the debug HUD once per drag: a drag from
   * another app that never shows there never reached the page. Every
   * dragover moves `dragSeenAt` on, so only a pause starts a new drag.
   */
  private noteDrag(transfer: DataTransfer): void {
    const now = Date.now();
    const fresh = now - this.dragSeenAt > DRAG_NOTE_GAP_MS;
    this.dragSeenAt = now;
    if (!fresh) return;
    const types = Array.from(transfer.types).join(",") || "-";
    const own = obsidianDragging(this.app) ? " obsidian" : "";
    this.surface?.debugDrop("drag", `types=${types} allowed=${transfer.effectAllowed}${own}`);
  }

  private async handleFileDrop(event: DragEvent): Promise<void> {
    const transfer = event.dataTransfer;
    // A practice file takes handwriting only.
    if (!transfer || this.isPractice) return;
    const isPdf = (file: File) =>
      normalizeMime(file.type) === "application/pdf" || /\.pdf$/i.test(file.name);
    const files = Array.from(transfer.files).filter(
      (file) =>
        isPdf(file) || isImagePath(file.name) || normalizeMime(file.type).startsWith("image/"),
    );
    // A drag from Obsidian's file list: on the iPad, WebKit keeps a drag's
    // text from the page once its types say "Files", so the file comes from
    // Obsidian's drag manager, where Obsidian's own views read it.
    const dragged = draggedVaultFiles(this.app);
    const text = transfer.getData("text/plain") || transfer.getData("text/uri-list");
    const path = dragged.length ? null : vaultPathFromDrop(text);
    const resolved =
      path &&
      (this.app.vault.getFileByPath(path) ??
        this.app.metadataCache.getFirstLinkpathDest(path, this.file?.path ?? ""));
    const vaultFiles = (dragged.length ? dragged : resolved ? [resolved] : []).filter(
      (file) => /\.pdf$/i.test(file.path) || isImagePath(file.path),
    );
    // Text from another app (discussion #288), when no file claims the drop.
    // A text field being typed in keeps its own drop.
    const words =
      files.length || vaultFiles.length || isEditableTarget(event.target)
        ? ""
        : droppedText({
            types: transfer.types,
            plain: transfer.getData("text/plain"),
            html: transfer.getData("text/html"),
            // A bare word that names a note is still words; a link or a
            // path with its extension is the file's.
            vaultFile:
              obsidianDragging(this.app) ||
              (!!resolved && (path !== text.trim() || /\.[a-z0-9]+$/i.test(path ?? ""))),
          });
    // Which element took the drop, what it carried and what it became: on
    // the debug HUD, whether iPadOS hands a drag from another app to the
    // page at all is settled by this line.
    const seen =
      `on=${elementName(event.target)} types=${transfer.types.join(",") || "-"} ` +
      `files=${transfer.files.length} text=${text ? text.length : "no"} ` +
      `vault=${vaultFiles.length} words=${words.length}`;
    if (words) {
      const taken =
        this.isProtected() || !!this.surface?.dropText(event.clientX, event.clientY, words);
      this.surface?.debugDrop("drop", `${seen} -> ${taken ? "text box" : "refused"}`);
      if (taken) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const taken = files.length > 0 || vaultFiles.length > 0;
    this.surface?.debugDrop("drop", `${seen} -> ${taken ? "file" : "nothing"}`);
    if (!taken) return;
    event.preventDefault();
    event.stopPropagation();
    if (vaultFiles.length) {
      for (const file of vaultFiles) {
        // A drop asks too: beside the notes, or written on (`preparePdfImport`).
        if (/\.pdf$/i.test(file.path)) await this.importVaultPdf(file.path);
        else await this.insertImageFromVault(file.path);
      }
      return;
    }
    const note = this.file;
    const surface = this.surface;
    for (const file of files) {
      if (this.file !== note || this.surface !== surface || this.isProtected()) return;
      if (isPdf(file)) await this.importPdfFile(file);
      else if (this.refuseOnPdfTab()) return;
      else {
        try {
          const bytes = await file.arrayBuffer();
          if (this.file !== note || this.surface !== surface || this.isProtected()) return;
          await this.insertImageBytes(bytes, file.type, file.name);
        } catch (error) {
          new Notice(
            t("view.pdf.readFailed", { name: file.name, message: errorMessage(error) }),
            8000,
          );
        }
      }
    }
  }

  private async importPdfFile(file: File, ask = true): Promise<void> {
    await this.preparePdfImport(() => file.arrayBuffer(), file.name, undefined, ask);
  }

  private async preparePdfImport(
    read: () => Promise<ArrayBuffer>,
    name: string,
    savedPath?: string,
    ask = true,
  ): Promise<void> {
    const note = this.file;
    const surface = this.surface;
    if (!note || !surface || this.isProtected()) return;
    if (this.isSinglePage) {
      new Notice(t("view.pdf.singleImport"));
      return;
    }
    const progress = new Notice(t("view.pdf.reading"), 0);
    try {
      const bytes = await read();
      const pages = await measurePdfPages(bytes);
      if (this.file !== note || this.surface !== surface || this.isProtected()) return;
      const item: ScanItem = { kind: "pdf", bytes, name, savedPath, pages: [] };
      // Beside the notes, as a tab: the PDF where it is in the vault, or saved
      // beside the notebook first when it came from the device.
      const keepBeside = this.takesPdfTabs
        ? async (): Promise<boolean> => {
            if (this.file !== note || this.isProtected()) return false;
            item.savedPath ??= (
              await saveImageAttachment(
                this.app,
                { bytes, mime: "application/pdf", ext: "pdf", width: 0, height: 0 },
                name,
                note.path,
                this.attachmentFolder("images"),
              )
            ).path;
            return this.attachMeasured(item.savedPath, pages);
          }
        : undefined;
      if (!ask && !keepBeside) {
        item.pages = pages.map((size, page) => ({ ...size, page }));
        await this.insertScans(
          [item],
          t("view.pdf.importLabel"),
          surface.document.pages.length - 1,
        );
        return;
      }
      new PdfImportModal(
        this.app,
        name,
        pages.length,
        async (indices) => {
          if (this.file !== note || this.surface !== surface || this.isProtected()) return false;
          item.pages = indices.map((page) => ({ ...pages[page], page }));
          return this.insertScans([item], t("view.pdf.importLabel"));
        },
        keepBeside,
      ).open();
    } catch (error) {
      new Notice(t("view.pdf.importFailed", { message: errorMessage(error) }), 8000);
    } finally {
      progress.hide();
    }
  }

  // --- Scanning -------------------------------------------------------------

  /**
   * "Scan document" (the image menu's entry and the command): the scan
   * sheet, and in the same tap the camera — on a desktop, a file picker for
   * a photo taken elsewhere. Must run synchronously inside the user's tap
   * (see `ScanSheet.pickPhoto`); if the picker does not open, the sheet's own
   * Take photo / Choose buttons are a fresh tap.
   */
  scanDocument(): void {
    if (this.isProtected() || !this.file || !this.surface || this.refusePractice()) return;
    this.showTab(NOTES_TAB);
    const sheet = new ScanSheet(this.app, {
      multiPage: !this.isSinglePage,
      insert: (scans) => this.insertScans(scans),
    });
    sheet.open();
    sheet.pickPhoto(Platform.isMobile);
  }

  /**
   * Save finished scans as attachments of this note and put them in as
   * **one** undo step: new pages after the one in view — a photo scan as a
   * page holding its picture, a PDF as PDF-backed pages, one per PDF page
   * (`buildScanInsert`: `AddPage` + `InsertImage` in one `CompositeCommand`).
   * Not through `insertImageBytes`, which would push an undo step per
   * picture and re-encode a scan that is already encoded. A single page
   * takes a photo scan onto itself instead, and no PDF.
   *
   * A file saved before a later one failed keeps its path, so trying Add
   * again does not save it twice.
   */
  private async insertScans(
    items: ScanItem[],
    label?: string,
    /** The page they go after; the one in view unless given. */
    after?: number,
  ): Promise<boolean> {
    const note = this.file;
    if (!note || !this.surface || this.isProtected()) return false;
    // Pages are added to the notes, which are shown for it.
    this.showTab(NOTES_TAB);
    const originalSurface = this.surface;
    const now = new Date();
    const photos = items.filter((item) => item.kind === "image").length;
    const saved: SavedItem[] = [];
    let photo = 0;
    for (const item of items) {
      if (item.kind === "pdf") {
        // A single page cannot take a PDF's pages (the sheet does not offer
        // one there); do not leave its file behind in the vault either.
        if (this.isSinglePage) continue;
        // Saved as it came; the source is only ever read afterwards.
        item.savedPath ??= (
          await saveImageAttachment(
            this.app,
            { bytes: item.bytes, mime: "application/pdf", ext: "pdf", width: 0, height: 0 },
            item.name,
            note.path,
            this.attachmentFolder("images"),
          )
        ).path;
        saved.push({ kind: "pdf", path: item.savedPath, pages: item.pages });
        continue;
      }
      const name = scanFileName(now, photo++, photos);
      item.savedPath ??= (
        await saveImageAttachment(this.app, item, name, note.path, this.attachmentFolder("images"))
      ).path;
      saved.push({ path: item.savedPath, width: item.width, height: item.height });
    }
    // Read the surface again: the view may have closed while the files saved.
    const surface = this.surface;
    if (!surface || surface !== originalSurface || this.file !== note || this.isProtected())
      return false;
    const insert = buildScanInsert(surface.document, after ?? surface.currentPage, saved, label);
    const first = insert?.placed[0];
    if (!insert || !first) {
      if (this.isSinglePage) {
        new Notice(t("view.pdf.singleAdd"));
      }
      return false;
    }
    surface.applyCommand(insert.command);
    if (insert.addedPages) surface.goToPage(first.pageIndex, true);
    if (first.imageId) surface.selectImage(first.pageId, first.imageId);
    this.requestSave();
    if (!insert.addedPages) {
      new Notice(t("view.scan.singlePage"));
    }
    // A PDF's own outline becomes contents on the pages it just added.
    const added = new Set(insert.placed.map((place) => place.pageId));
    for (const item of items) {
      if (item.kind !== "pdf" || !item.savedPath) continue;
      const path = item.savedPath;
      const pages = surface.document.pages.filter(
        (page) => added.has(page.id) && page.backdrop.kind === "pdf" && page.backdrop.path === path,
      );
      if (pages.length > 0) void this.addPdfOutline(surface, path, item.bytes, pages);
    }
    return true;
  }

  /**
   * Whether the notebook may not be changed now, saying why: its ink failed
   * to load (the load guard), or it was made read-only in its settings.
   * Reading it (searching, exporting, asking about it) goes through
   * `isDamaged` instead.
   */
  private isProtected(): boolean {
    if (this.isDamaged()) return true;
    // The notebook's read-only covers its PDF tabs too.
    if (!isReadOnly(this.doc) && !isReadOnly(this.surface?.document ?? this.doc)) return false;
    // Once every few seconds: a pen held down asks on every sample.
    const now = Date.now();
    if (now - this.readOnlyNoticeAt > READ_ONLY_NOTICE_MS) {
      this.readOnlyNoticeAt = now;
      new Notice(t("view.notice.readOnlySetting"));
    }
    return true;
  }

  /**
   * Whether the notebook's ink failed to load, so it must not even be saved
   * over; or it is kept as page files still syncing, so it waits for them.
   */
  private isDamaged(): boolean {
    if (this.devicePagesSyncing()) {
      const now = Date.now();
      if (now - this.syncingNoticeAt > READ_ONLY_NOTICE_MS) {
        this.syncingNoticeAt = now;
        new Notice(t("view.notice.devicePagesSyncing"));
      }
      return true;
    }
    if (!this.guard.locked) return false;
    new Notice(t("view.notice.readOnly"));
    return true;
  }

  private static readonly RECENT_TEMPLATES_KEY = "goodobsidian:recent-templates";

  private loadRecentTemplates(): SyntheticBackdrop[] {
    const raw: unknown = this.app.loadLocalStorage(InkView.RECENT_TEMPLATES_KEY);
    if (typeof raw !== "string") return [];
    try {
      return parseRecent(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  private rememberTemplate(backdrop: SyntheticBackdrop): void {
    const next = pushRecent(this.loadRecentTemplates(), backdrop);
    this.app.saveLocalStorage(InkView.RECENT_TEMPLATES_KEY, JSON.stringify(next));
  }

  /**
   * "Add board" (discussion #160): an empty board after the last one, on the
   * paper of the board being read, shown at once. One undo step.
   */
  addBoard(): void {
    const surface = this.surface;
    if (!surface || !this.isBoard || this.isProtected()) return;
    const doc = surface.document;
    const page = newBoardPage(nextPageId(doc), doc.pages[surface.currentPage]);
    surface.applyCommand(new AddPage(doc.pages.length, page));
    surface.goToPage(doc.pages.length - 1);
    this.sidebar?.flush();
    this.requestSave();
  }

  /**
   * A board among a notebook's pages (discussion #160), from Add page: an
   * empty board at `position` from page `ref`, shown at once. One undo step.
   */
  private addBoardPage(position: InsertPosition, ref: number, ruling?: Ruling): void {
    const surface = this.surface;
    if (!surface || this.isProtected() || this.refuseSinglePage()) return;
    const doc = surface.document;
    const index = insertIndexFor(position, ref, doc.pages.length);
    surface.applyCommand(
      new AddPage(index, newBoardPage(nextPageId(doc), doc.pages[ref], true, ruling)),
    );
    surface.goToPage(index);
    this.sidebar?.flush();
    this.requestSave();
  }

  /** "Go to board" (discussion #160): pick one of the file's boards from a list. */
  goToBoard(): void {
    const surface = this.surface;
    if (!surface || !this.isBoard) return;
    new GoToBoardModal(this.app, surface.document.pages, surface.currentPage, (index) =>
      this.surface?.goToPage(index),
    ).open();
  }

  /**
   * Insert a page after `afterIndex`, with the model's `AddPage` command, on
   * the surface's undo stack — so Cmd/Ctrl+Z removes it again.
   */
  private addPage(afterIndex: number, animate = false): void {
    if (this.isProtected() || this.refuseSinglePage()) return;
    const insert = pageToInsertAfter(this.doc, afterIndex, this.templateNames());
    if (!insert || !this.surface) return;
    this.surface.applyCommand(new AddPage(insert.index, insert.page));
    this.surface.goToPage(insert.index, animate);
    this.requestSave();
  }

  /** Keep PDF pages rasterised at the resolution the surface now draws at. */
  private matchPdfResolution(): void {
    if (this.surface && this.backdrops) this.backdrops.setDeviceScale(this.surface.deviceScale);
  }

  /**
   * The toolbar's "Clear page". The page's transcription goes with its ink,
   * and only that page's: the rest of the text layer and everything the user
   * wrote around it stay. Undo brings the ink back, not the transcription;
   * running it again does.
   */
  private clearPage(): void {
    const surface = this.surface;
    const page = this.doc.pages[surface?.currentPage ?? 0];
    if (!surface?.clearStrokes()) return;
    const transcribed = readTextSection(this.noteBody) !== null;
    if (page && transcribed) this.writeTranscripts([{ page, text: "", hash: "" }]);
    // The whole-note hash from before per-page transcription no longer holds.
    this.doc.recognizedHash = undefined;
    this.requestSave();
  }
}

/**
 * The ink of an AI's mark around page box (`x0`, `y0`)-(`x1`, `y1`): a red
 * circle that leaves the box inside it, a red box a little outside it, or a
 * yellow highlighter stroke across it as tall as it. A snapped shape, so it
 * draws as clean geometry and the eraser and lasso take it as any other.
 */
function markStroke(
  doc: InkDocument,
  shape: "circle" | "box" | "highlight",
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Stroke {
  let max = 0;
  for (const page of doc.pages) {
    for (const stroke of page.strokes) {
      const match = /^s(\d+)$/.exec(stroke.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  const id = `s${max + 1}`;
  if (shape === "highlight") {
    const cy = (y0 + y1) / 2;
    return {
      id,
      color: "#ffd43b",
      size: Math.max(8, y1 - y0),
      tool: "highlighter",
      pts: [x0, cy, 0.5, x1, cy, 0.5],
      shape: "line",
    };
  }
  // A circle through the box's corners would cut them: grow it by √2 about
  // its middle, so the ellipse goes round what it marks.
  const grow = shape === "circle" ? Math.SQRT2 : 1.08;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = ((x1 - x0) / 2) * grow + 4;
  const hh = ((y1 - y0) / 2) * grow + 4;
  const preset = shape === "circle" ? "ellipse" : "rect";
  return {
    id,
    color: "#e03131",
    size: 3,
    tool: "pen",
    pts: presetGeometry(preset, { x: cx - hw, y: cy - hh }, { x: cx + hw, y: cy + hh }, 0.5),
    shape: preset,
  };
}

/**
 * Whether Obsidian's own drag manager is dragging something now (a file, a
 * link, a heading, a tab): such a drop is Obsidian's, never text to write.
 */
function obsidianDragging(app: unknown): boolean {
  return !!(app as { dragManager?: { draggable?: unknown } }).dragManager?.draggable;
}

/**
 * The vault files Obsidian is dragging now (one file, or a selection from its
 * file list), read from its drag manager, which is not in the public API: an
 * empty list when there is none, or when a later Obsidian changes its shape.
 */
function draggedVaultFiles(app: unknown): TFile[] {
  const draggable = (
    app as {
      dragManager?: { draggable?: { type?: unknown; file?: unknown; files?: unknown } | null };
    }
  ).dragManager?.draggable;
  if (!draggable) return [];
  const all: unknown[] =
    draggable.type === "file"
      ? [draggable.file]
      : draggable.type === "files" && Array.isArray(draggable.files)
        ? draggable.files
        : [];
  return all.filter((file): file is TFile => file instanceof TFile);
}

/** Whether an event's target is a field the user types in, which takes its own drops. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  return (
    (target as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  );
}

/** An element as the debug HUD names it: its tag and first class, or `-`. */
function elementName(target: EventTarget | null): string {
  if (!isElement(target)) return "-";
  const cls = target.classList[0];
  return target.tagName.toLowerCase() + (cls ? `.${cls}` : "");
}

/** Whether (x, y) lies inside `rect`; a rect with no size (a hidden view) holds nothing. */
function pointInside(rect: DOMRect, x: number, y: number): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    x >= rect.left &&
    x < rect.right &&
    y >= rect.top &&
    y < rect.bottom
  );
}
