/**
 * The code behind every tip. PURE.
 *
 * A tip says what a gesture, a key or a menu row does, and twice one was
 * written from the changelog and described something the code did not have.
 * So each tip names the code that does what it claims: `"<file>#<name>"`,
 * the file from the repository's root and the name of a function, method,
 * class, constant or setting key declared in it, or a command's id. The
 * handler of the gesture, not the tip's own picture and not a file nearby.
 *
 * `tests/model/tip-handlers.test.ts` reads each file and fails when a name is
 * no longer declared there: rename or delete the code and the tip that
 * describes it has to be read again. A tip with two claims names both.
 *
 * Before adding a tip: find the handler, read it, and write the tip from what
 * it does.
 */

const SURFACE = "src/view/ink-surface.ts";
const VIEW = "src/view/ink-view.ts";
const TOOLBAR = "src/view/toolbar.ts";
const RECOGNIZER = "src/ink/shape-recognizer.ts";
const SIDEBAR = "src/view/page-sidebar.ts";
const HOME = "src/view/library-view.ts";
const EXPORT = "src/view/export-modal.ts";
const MORE = "src/view/more-panel.ts";
const GRAPH = "src/view/calculator-graph.ts";
const CALCULATOR = "src/view/calculator-popover.ts";
const CALC_NOTES = "src/view/calc-notes.ts";

export const TIP_HANDLERS = {
  // Start here.
  hold: [`${SURFACE}#snapHeldStroke`],
  scribble: [`${SURFACE}#scribbleErase`, "src/ink/scribble.ts#detectScribble"],
  undo: [`${SURFACE}#fingerDoubleTap`],
  redoThree: [`${SURFACE}#fingerDoubleTap`],
  circleLasso: [`${SURFACE}#noteCircleLoop`, `${SURFACE}#watchCircleHold`],
  pullPage: ["src/canvas/page-layout.ts#pullAddAllowed"],
  fillScreen: [`${SURFACE}#zoomOnDoubleTap`],
  lockFit: [`${MORE}#lockFitRow`, "src/canvas/scroll-physics.ts#heldSideways"],
  searchInk: [`${VIEW}#openSearch`],
  tapColour: [`${TOOLBAR}#penSwatch`],
  ribbon: [`${SIDEBAR}#tapThumb`],
  tryGesture: ["src/main.ts#tryFeature"],

  // Pen gestures.
  holdResize: [`${SURFACE}#snapHeldShape`],
  arcsHearts: [
    `${RECOGNIZER}#heartCandidate`,
    `${RECOGNIZER}#arcCandidate`,
    `${RECOGNIZER}#sectorCandidate`,
  ],
  arrow: [`${RECOGNIZER}#retraceArrowCandidate`],
  scribbleFill: [`${SURFACE}#scribbleFill`],
  pathArrow: [`${RECOGNIZER}#pathArrowCandidate`],
  curvedElbow: [`${SURFACE}#traceDrawnArrow`],
  lineUpMoves: ["src/canvas/align-snap.ts#alignMove"],

  // Fingers.
  fingerPick: [
    `${SURFACE}#fingerPicksShape`,
    `${SURFACE}#fingerPicksTable`,
    `${SURFACE}#fingerPicksPicture`,
  ],
  fingerHoldMenu: [`${SURFACE}#fingerHeld`, `${SURFACE}#pressActions`],
  drawFinger: [`${MORE}#fingerDrawRow`, "src/input/finger-draw.ts#fingerDrawRole"],
  stylusOnly: [`${TOOLBAR}#toggleOnlyStylusMode`, "src/input/pointer-controller.ts#onlyStylus"],

  // Selecting.
  pasteHere: [`${SURFACE}#lassoHeld`],
  dragToPage: [`${SURFACE}#endGroupDrag`, `${SURFACE}#stepGroupDragScroll`],
  turnIntoText: [`${VIEW}#turnIntoText`],
  pinchSelection: [`${SURFACE}#stepGroupTurn`],
  turnKnob: [`${SURFACE}#knobGrabbed`],
  lassoFilter: [`${TOOLBAR}#renderLassoOptions`],
  copyStyle: [`${SURFACE}#copyStyle`, `${SURFACE}#paintAlong`],
  oneItem: [`${SURFACE}#pickStart`],
  lassoTray: [`${SURFACE}#groupActions`],
  correctWord: [`${SURFACE}#correctWordAction`],
  screenshotLasso: [`${SURFACE}#showEmptyLasso`],
  saveSticker: [`${SURFACE}#saveSelectionAsSticker`],
  lockPicture: [`${SURFACE}#lockSelectedImage`, `${SURFACE}#unlockImage`],
  pictureFront: [`${SURFACE}#setSelectedImageFront`, `${SURFACE}#setSelectedImageOpacity`],

  // Writing.
  checklist: [`${TOOLBAR}#renderTextLists`, `${SURFACE}#bindTextTask`],
  eyedropper: ["src/view/eyedropper.ts#Eyedropper"],
  widthMm: [`${TOOLBAR}#toggleWidthList`],
  widthPresets: [`${TOOLBAR}#editWidth`, `${TOOLBAR}#resetWidthPresets`],
  typedEquation: ["src/view/equation-editor.ts#EquationEditor"],
  markdownText: ["src/model/markdown-detect.ts#looksLikeMarkdown", `${SURFACE}#paintMarkdownView`],
  zoomBox: [`${SURFACE}#openZoomBox`],
  zoomFrame: [`${SURFACE}#onZoomTargetPointerMove`, `${SURFACE}#moveZoomPinch`],
  zoomAdvance: [`${SURFACE}#scheduleZoomAdvance`],
  insertSpace: [`${SURFACE}#dragSpace`],
  stabilization: [`${TOOLBAR}#renderStabilization`],
  chisel: [`${TOOLBAR}#renderHighlighterTip`],
  hideOptions: ["src/view/tool-return.ts#tucksOnWrite"],
  backToPen: ["src/view/tool-return.ts#toolAfterUse"],

  // Pages and export.
  reorder: ["src/view/page-drag.ts#PageDrag"],
  scan: [`${VIEW}#scanDocument`],
  dropPdf: [`${VIEW}#handleFileDrop`],
  importBooks: [`${HOME}#openNewMenu`, "src/view/import-notebook-modal.ts#openImportNotebookModal"],
  pageGrid: [`${SIDEBAR}#setOverview`, `${SIDEBAR}#setSelecting`],
  moveToNotebook: [`${SIDEBAR}#showMoveMenu`],
  margins: [`${VIEW}#openMarginPopover`],
  darkDesk: [`${MORE}#viewRows`, `${MORE}#deskRow`],
  newBoard: [`${HOME}#openNewMenu`, "src/model/board.ts#boardGrowth"],
  boardsInFile: [`${SIDEBAR}#setBoard`, "src/model/board.ts#newBoardPage"],
  joinedPages: ["src/model/joined-pages.ts#SetJoinedPages"],
  plainExport: [`${EXPORT}#templateSwitch`],
  pictureExport: [`${EXPORT}#formatControl`],
  pageNumbers: ["src/model/furniture.ts#SetFurniture"],
  saveTemplate: [`${VIEW}#savePageAsTemplate`],
  designPaper: ["src/view/template-picker.ts#openDesigner"],
  readOnly: ["src/model/read-only.ts#SetReadOnly"],

  // Organize.
  homePreview: [`${HOME}#showPreview`],
  homeDrag: [`${HOME}#makeDropTarget`],
  folderColour: [`${HOME}#openFolderMenu`],
  foldNote: [`${SURFACE}#foldSelectedNote`, `${SURFACE}#fingerOpensFoldedNote`],
  inkTask: [`${VIEW}#makeInkTask`],
  contentsHeading: [`${VIEW}#addSection`],
  pageTab: ["src/model/page-tabs.ts#SetPageTab"],

  // Cover, listen, highlight.
  coverTape: [`${SURFACE}#toggleTapeAt`],
  tapeEye: [`${SURFACE}#showTapes`],
  snap: ["src/model/text-highlight.ts#textHighlightStrokes"],
  holdWord: [`${SURFACE}#pressSelectsText`],
  hear: ["src/view/note-audio.ts#onStrokeTap"],
  onlineTranscribe: ["src/settings-data.ts#speechService"],
  laser: [`${TOOLBAR}#renderPenMenu`, "src/canvas/laser-trail.ts#LaserTrail"],
  tapeMagnet: [`${SURFACE}#tapeTextAt`],
  tapeExport: [`${EXPORT}#tapesSwitch`],
  copyHighlighted: ["src/main.ts#copy-highlighted-text", `${VIEW}#copyHighlightedText`],
  askSelection: [`${VIEW}#askAboutSelection`],
  pasteTranscript: ["src/view/note-audio.ts#pasteTranscript"],

  // Find and link.
  homeSearch: [`${HOME}#fillPageHits`],
  copyPageLink: [`${VIEW}#copyPageLink`],
  linkTo: [`${VIEW}#linkInk`],
  inkLink: [`${VIEW}#offerHandwrittenLinks`, `${SURFACE}#openLinkAt`],
  embedPages: ["src/view/page-embed.ts#PageEmbeds"],
  frameEmbed: [`${VIEW}#addRegion`, `${VIEW}#copyRegionLink`],
  pdfLinks: [`${SURFACE}#followPdfLink`],
  learnWriting: ["src/main.ts#learn-handwriting", "src/view/learn-window.ts#LearnWindow"],

  // Maths.
  calc: [`${CALC_NOTES}#suggest`],
  sumGlow: ["src/view/calc-glow.ts#CalcGlow", "src/view/calc-card.ts#CalcCard"],
  solveLetter: [`${CALC_NOTES}#equationContent`],
  basicCalc: [`${CALCULATOR}#applyMode`],
  insertGraph: [`${CALCULATOR}#finishGraph`],
  graphFit: [`${GRAPH}#tap`],
  graphPin: [`${GRAPH}#pin`],
  graphPopOut: ["src/view/graph-window.ts#GraphWindow"],

  // Shapes and tables.
  typeInShape: [`${SURFACE}#editShapeLabel`],
  fillTool: [`${SURFACE}#fillAt`],
  linkedShapes: [`${SURFACE}#grabLinkDot`],
  shapeSnap: ["src/ink/shape-snap.ts#snapTargets"],
  cornerPoints: [`${SURFACE}#grabShapePoint`],
  bendCurves: ["src/ink/shape-points.ts#curveHandles"],
  tableTab: [`${SURFACE}#stepCellEdit`],
  tableResize: ["src/view/table-cell-editor.ts#placeGrips"],

  // Rulers and erasers.
  eraseHighlightOnly: [`${TOOLBAR}#toggleEraserFilterList`],
  eraseLine: ["src/canvas/ruled-ink.ts#RuledEraser"],
  rulerUse: ["src/view/ruler-overlay.ts#RulerOverlay"],
  rulerKinds: [`${TOOLBAR}#renderRulerOptions`],

  // Make it yours.
  savedPens: [`${TOOLBAR}#toggleSavedPens`, `${TOOLBAR}#pressPenKey`],
  penOnBar: [`${TOOLBAR}#togglePenSlot`, `${TOOLBAR}#savedPenPin`],
  penOrder: ["src/view/pen-type-drag.ts#bindPenTypeDrag"],
  colourOff: ["src/view/swatch-drag.ts#bindSwatchDrag"],
  pillDock: ["src/view/pill-drag.ts#bindPillDrag"],
  customizeBar: ["src/view/toolbar-edit.ts#ToolbarEditor"],
  looks: ["src/model/look.ts#lookClasses"],
  toolbarEdge: ["src/view/toolbar-edit.ts#barDocks"],
  dockOptions: [`${TOOLBAR}#setPillRow`],
  dockColours: [`${TOOLBAR}#buildPenOptions`],
  shortcutSheet: [`${VIEW}#toggleShortcuts`],
  spaceDrag: [`${SURFACE}#setHand`],
  shiftErase: ["src/input/pen-modifiers.ts#pressOverride"],
  altZoom: ["src/input/pen-modifiers.ts#dragZoom"],

  // Shown in What's new only.
  textTurns: [`${SURFACE}#startTextTurn`],
  lineSpacing: ["src/canvas/paper-style.ts#typedSpacing"],
} as const satisfies Readonly<Record<string, readonly [string, ...string[]]>>;

/** A tip's id: only one with its code named here can be made (`tip` in tips.ts). */
export type TipId = keyof typeof TIP_HANDLERS;
