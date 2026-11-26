# On the page

Gestures with the pen, fingers and keys; the lasso and the selection bar; text, shapes, tables, pictures and the tools that act on the page.

Part of FineNotes' guide (see `README.md` here): what Ask AI looks up to answer questions about the app. Edit an entry, then run `npm run guide`.

<!-- area: page -->

### Draw a shape and hold to make it clean (hold to snap)

- **Id:** `holdToSnap`
- **What:** Draw a shape in one stroke and keep the pen still at the end: the wobbly stroke is replaced by a clean line, circle, ellipse, rectangle, triangle, diamond, polygon, star, heart, arc, pie slice (sector), cloud, arrow or bent path. If the recogniser is not confident nothing happens and the ink stays as drawn.
- **Where:** With the Pen or Highlighter (or the Shapes tool), draw the shape and keep the Pencil still for a moment. Switch: pen's options › Pen settings › Pen gestures › "Make shapes" ("When I hold the pen still" / "When I lift the pen, too"), plus "How curved a stroke may be and still snap".
- **Notes:** (any pen, mouse or Pencil; not a finger unless Draw with finger is on)
- **Words:** snap, shape, clean shape, straight line, perfect circle, draw and hold, auto shape, make shapes, tidy shape, square, triangle, star, heart, arc, pie, cloud, polygon, straight lines, draw a straight line, perfect shapes
- **Seen as:** lines turn into shapes, shapes snap by themselves, snaps too fast, shape does not snap
- **Settings:** `snapMode`, `snapCurvatureThreshold`, `drawAndHold`, `penAutoShape`
- **Tip:** `hold`

### Snap shapes when the pen lifts (auto shape)

- **Id:** `snapOnLift`
- **What:** With "When I lift the pen, too", a stroke that reads as a shape also snaps when the pen lifts, without holding still. The Shapes tool's "Auto-shape" button does the same for the Shapes tool.
- **Where:** Pen settings › Pen gestures › Make shapes › "When I lift the pen, too". Shapes tool: "Auto-shape: draw any shape and it snaps clean".
- **Words:** auto shape, snap on lift, shapes without holding, automatic shapes
- **Seen as:** lines turn into shapes when I lift, shapes appear by themselves
- **Settings:** `snapMode`

### Resize and turn a shape while still holding

- **Id:** `holdResize`
- **What:** After a shape snaps, keep the pen down and move it: the clean shape grows, shrinks and turns about its pivot until you lift.
- **Where:** Draw, hold until it snaps, then keep the pen on the glass and move it.
- **Words:** resize while holding, rotate snapped shape, adjust shape, scale shape
- **Settings:** `snapMode`
- **Tip:** `holdResize`

### Arrows and bent arrows in one stroke

- **Id:** `arrowGesture`
- **What:** Draw a line, go back a little along it (or draw a V head) and hold: it snaps to a clean arrow. A path with turns and an arrowhead becomes a clean bent arrow.
- **Where:** Pen: draw the line, retrace a little at the end, hold still.
- **Words:** arrow, draw arrow, arrowhead, bent arrow, path arrow
- **Settings:** `snapMode`
- **Tip:** `arrow`

### Hearts, arcs and pie slices snap too

- **Id:** `moreShapesSnap`
- **What:** Besides lines and polygons, hold-to-snap recognises hearts, arcs, pie slices, stars and clouds.
- **Where:** Draw the shape with the pen and hold still.
- **Words:** heart, arc, pie, sector, semicircle, cloud, star
- **Settings:** `snapMode`, `snapCurvatureThreshold`
- **Tip:** `arcsHearts`

### Shapes snap to other shapes' corners

- **Id:** `shapeSnapTogether`
- **What:** While a shape or line is drawn, its ends and corners land on nearby corners, ends and midpoints of shapes already on the page, with a marker where it snaps.
- **Where:** Draw a line with the Shapes tool (or a snapped shape) near another shape.
- **Words:** snap to corner, connect lines, endpoints snap, midpoint snap, shapes join
- **Tip:** `shapeSnap`

### Pen rejoin (broken strokes stitched back)

- **Id:** `penRejoin`
- **What:** When the Pencil's contact flickers, a pen-down very soon after a lift and very close to it continues the same stroke instead of starting a new one. Automatic.
- **Where:** Nothing to do.
- **Notes:** (mainly iPad)
- **Words:** broken strokes, gaps in writing, dotted letters, pencil flicker

### Scroll and pinch zoom with fingers

- **Id:** `panPinch`
- **What:** One finger scrolls (with a fling), two fingers pan and pinch to zoom. A third finger is ignored for scrolling.
- **Where:** Use fingers on the page.
- **Notes:** touch only
- **Words:** scroll, pan, move page, pinch, zoom, two fingers
- **Settings:** `onlyStylusMode`
- **Commands:** `zoom-in`, `zoom-out`

### Zoom out past the page to see all pages (pinch in)

- **Id:** `pinchOverview`
- **What:** Pinch the page closed well past the fit (to about half its size) and let go: every page opens as a grid, the same grid as the page sidebar's Show all pages, where you can select pages and tap one to go to it.
- **Where:** Two fingers on a page, pinch in hard, then let go.
- **Notes:** Touch only, and not on a single-page note. The grid is also the page sidebar's Show all pages button.
- **Words:** zoom out, zoom out to see all pages, zoom out past the page, pinch in, pinch to see all pages, overview, all pages, page grid, grid view, thumbnails, see every page

### Double tap to fill the screen

- **Id:** `doubleTapFit`
- **What:** Double tap the page with one finger: the page zooms to the width of the pane; double tap again to see the whole page. On a board it goes to 100% and back to the whole drawing.
- **Where:** One-finger double tap on the page where nothing else takes the tap.
- **Notes:** touch only
- **Words:** double tap zoom, fit width, fill screen, zoom to page, see whole page
- **Settings:** `holdFitWidth`
- **Commands:** `fit-reset-view`
- **Tip:** `fillScreen`

### Lock fit to width

- **Id:** `lockFitWidth`
- **What:** After a double tap fits pages to the width, fingers never move the page sideways. With pages across, a sideways swipe turns to the next page instead.
- **Where:** More (⋯) › "Lock fit to width".
- **Notes:** touch only (mainly iPad)
- **Words:** lock fit, stop sideways scroll, page wobbles sideways, hold page still, swipe turn pages
- **Settings:** `holdFitWidth`
- **Tip:** `lockFit`

### Free page edges

- **Id:** `freePageEdges`
- **What:** Zoomed in on pages that run across, the view may leave the page being read and scroll past the notebook's ends.
- **Where:** More (⋯) › "Free page edges".
- **Words:** scroll past edge, free scroll, page edges, scroll beyond page
- **Settings:** `freePageEdges`

### Pull past the last page for a new page

- **Id:** `pullToAddPage`
- **What:** Keep pulling past the last page until the ring fills ("Pull to add page" / "Release to add page") and let go: a page is added at the end.
- **Where:** Scroll to the last page and keep pulling.
- **Notes:** (finger, and a wheel/trackpad pull too)
- **Words:** add page, new page, pull to add, pull down, overscroll
- **Tip:** `pullPage`

### Two-finger double tap to undo, three to redo

- **Id:** `fingerTapUndo`
- **What:** Double tap with two fingers to undo; with three fingers to redo. A readout says what was undone, or "Nothing to undo".
- **Where:** Anywhere on the page. Settings › "Two-finger double-tap to undo".
- **Notes:** touch only
- **Words:** undo, redo, two finger tap, three finger tap, gesture undo
- **Settings:** `fingerTapUndo`
- **Tip:** `undo`

### Hold a finger for Paste, Text box, Comment, Select all

- **Id:** `fingerHoldMenu`
- **What:** Hold a finger still on the page, with any tool: a small bar opens with Paste, Text box and Select all, and Comment in its "…" menu. Held on handwriting it starts with Correct.
- **Where:** Press and hold one finger on empty page. With a mouse: right-click.
- **Notes:** (finger hold on touch; right-click on desktop)
- **Words:** long press, press and hold, paste, context menu, select all, add text here
- **Tip:** `fingerHoldMenu`

### Tap with a finger to pick something up

- **Id:** `fingerPick`
- **What:** With the pen in hand, a finger tap on a shape, connector, table, graph, equation or picture selects it, without switching to the lasso.
- **Where:** Tap the object with a finger.
- **Notes:** touch only
- **Words:** tap to select, select shape, select picture, pick up table, finger select
- **Tip:** `fingerPick`

### Draw with a finger (Pencil away)

- **Id:** `drawWithFinger`
- **What:** A mode for when the Pencil is away: one finger writes with the tool in hand, two fingers pan and pinch. The first event from a pen ends it. Palm rejection is off while it is on.
- **Where:** More (⋯) › "Draw with finger".
- **Notes:** touch only (offered only where the device has touch points)
- **Words:** finger drawing, no pencil, pencil dead, battery, write with finger, disconnect pencil
- **Tip:** `drawFinger`

### Palm rejection

- **Id:** `palmRejection`
- **What:** Anything that is not a finger writes; while a stroke is open, a finger that lands is the writing hand and is ignored. If a palm moved the page just before the pen landed, the page jumps back.
- **Where:** Automatic.
- **Notes:** touch only
- **Words:** palm, hand resting, accidental scroll, stray marks, wrist
- **Seen as:** palm draws lines, hand leaves marks, stray marks, page moves when resting my hand
- **Settings:** `onlyStylusMode`

### Stylus side button while writing

- **Id:** `barrelButton`
- **What:** Holding a tablet pen's side button while writing erases (default), lassos, moves the page, or does nothing. Erase, also hovering erases with the pen held just above the page too, the button held: the way to erase with the S Pen's button on Android.
- **Where:** Settings › "Stylus side button" (Erase, Erase also hovering, Lasso select, Move the page, Nothing).
- **Notes:** desktop/Android pens with a side button (not the Apple Pencil)
- **Words:** side button, barrel button, pen button, s pen, wacom button, erase with button, erase on hover, hover erase
- **Settings:** `barrelButton`

### Side button click in the air

- **Id:** `stylusClick`
- **What:** A click of the side button with the pen held just above the page opens the pen menu (a second click closes it), or switches to the eraser and back.
- **Where:** Settings › "Side button click" (Open the pen menu, Switch to the eraser, Nothing).
- **Notes:** desktop/Android pens with a side button
- **Words:** click pen button, s pen click, pen menu, switch to eraser
- **Settings:** `stylusButtonClick`

### Eraser end of the pen

- **Id:** `eraserEnd`
- **What:** Writing with a tablet pen's eraser end always erases, with the eraser's settings.
- **Where:** Turn the pen round and rub.
- **Notes:** pens that have an eraser end (Surface, Wacom); not the Apple Pencil
- **Words:** flip pen, eraser end, back of pen, surface pen eraser

### Hold Shift to erase, Ctrl/Cmd to lasso, Alt to zoom

- **Id:** `modifierKeys`
- **What:** For one stroke: Shift erases, Ctrl (Cmd on Mac and iPad) lassos, Alt (Option) zooms (drag up zooms in, down zooms out, about the pen).
- **Where:** Hold the key and write or drag.
- **Notes:** (needs a keyboard)
- **Words:** shift erase, ctrl lasso, cmd lasso, alt zoom, keyboard modifiers, temporary eraser
- **Tip:** `shiftErase`

### Drag beside the page to move it

- **Id:** `dragBesidePage`
- **What:** A pen or mouse pressed beside the pages (margin or gutter) moves the page, with a fling.
- **Where:** Drag in the empty area beside the pages.
- **Words:** move page with pen, pan with mouse, drag margin, gutter

### Hold Space to move the page

- **Id:** `spaceDrag`
- **What:** Hold Space and drag with the pen or mouse to move the page; let go and the tool is back. Not while typing.
- **Where:** Keyboard: hold Space.
- **Notes:** (needs a keyboard)
- **Words:** space bar, hand, pan with keyboard
- **Tip:** `spaceDrag`

### Lasso select

- **Id:** `lasso`
- **What:** The Lasso tool selects ink, shapes, pictures, text boxes, tables and graphs to move, resize, turn, copy or change them.
- **Where:** Toolbar › Lasso (key V).
- **Words:** lasso, select, selection tool, grab, move ink, marquee
- **Settings:** `lassoMode`, `lassoFilter`, `lassoTouches`

### Lasso types: Freehand, Rectangular, By line, One item

- **Id:** `lassoModes`
- **What:** Freehand draws a loop; Rectangular drags a box; By line selects whole lines of writing on lined paper (and shows insert-space arrows); One item picks up what the pen lands on and moves it in one stroke.
- **Where:** Tap the Lasso again › "Lasso type".
- **Words:** rectangle select, box select, select by line, one item, single tap select
- **Settings:** `lassoMode`
- **Tip:** `oneItem`

### Select everything on the page

- **Id:** `selectAll`
- **What:** Selects everything on the page in view, to move or delete as one.
- **Where:** Ctrl/Cmd+A, or hold a finger › "Select all".
- **Words:** select all, ctrl a, everything, clear page

### Move, resize and turn a selection

- **Id:** `moveResizeTurn`
- **What:** Drag the selection to move it. The bar's handles switch ("Show resize handles") puts corner handles and a turn knob on it; turns pull gently towards every 45° on the page. A lone shape shows its handles at once.
- **Where:** Select, then drag; tap the handles button in the bar for resize handles.
- **Words:** move, drag, resize, scale, rotate, turn, handles, knob
- **Tip:** `turnKnob`

### Turn a selection with two fingers

- **Id:** `pinchSelection`
- **What:** Two fingers on a selection turn it about their midpoint.
- **Where:** Select, then put two fingers on it and twist.
- **Notes:** touch only
- **Words:** rotate with fingers, two finger rotate, twist
- **Tip:** `pinchSelection`

### Things line up as they move

- **Id:** `alignSnap`
- **What:** A selection, picture or sticky note moved near a shape or object snaps its edges and centres to theirs, with red guides. Handwriting is never a target.
- **Where:** Drag a selection near other objects.
- **Words:** align, alignment guides, snap to edge, centre, red lines, line up
- **Tip:** `lineUpMoves`

### Move a selection to another page

- **Id:** `dragToPage`
- **What:** Drag a lasso selection over another page and let go; near the screen edge the notebook scrolls.
- **Where:** Drag the selection onto the other page.
- **Words:** move to other page, drag between pages, move to next page
- **Tip:** `dragToPage`

### Paste right here (lasso hold)

- **Id:** `pasteHere`
- **What:** Hold the lasso (or a finger) on empty paper for a bar with Paste: it pastes at that spot. It pastes FineNotes' own clipboard, or a picture or text from the system clipboard as a picture or text box.
- **Where:** Lasso held on empty paper, or finger hold.
- **Words:** paste, paste here, paste at spot, hold lasso
- **Tip:** `pasteHere`

### Selection bar: Copy, Cut, Duplicate, Paste, Delete

- **Id:** `selectionBarEdit`
- **What:** The dark bar over a selection has its colour, Copy, Duplicate, Delete, the handles switch and "…". The "…" menu has Cut, Paste, Screenshot and Copy style across the top, then Ask AI, Correct, Turn into ›, Flip.
- **Where:** Select with the lasso; use the bar or "…".
- **Words:** copy, cut, duplicate, paste, delete, selection menu, lasso menu
- **Tip:** `lassoTray`

### Change the colour of selected ink

- **Id:** `recolourSelection`
- **What:** The first button in the bar is a disc of the ink's colour; it opens the palette, the notebook's colours, recent ones, a custom colour and "Pick from the page". For shapes it also has the fill and its opacity.
- **Where:** Select ink › colour disc in the bar.
- **Words:** change colour, recolour, color, selection colour, eyedropper

### Copy style (format painter)

- **Id:** `copyStyle`
- **What:** Lasso some ink, choose Copy style, then tap or sweep the pen over other ink to give it the same colour, width, pen type and shape style.
- **Where:** Selection "…" › "Copy style".
- **Words:** copy style, format painter, match pen, paste style, same look
- **Tip:** `copyStyle`

### Flip a selection

- **Id:** `flipSelection`
- **What:** Flip the selection horizontally or vertically.
- **Where:** Selection "…" › Flip (Flip horizontal / Flip vertical). Pictures: "…" › Flip.
- **Words:** flip, mirror, flip horizontal, flip vertical

### Screenshot a selection or any patch

- **Id:** `screenshotLasso`
- **What:** Screenshot shows a picture of the selection with Copy and Share (or Save image where sharing a file is not possible). A lasso drawn round nothing, even over a PDF, shows a camera button that copies that patch.
- **Where:** Selection "…" › "Screenshot"; or lasso empty space and tap the camera.
- **Words:** screenshot, copy as picture, image of selection, share picture, snip
- **Tip:** `screenshotLasso`

### Ask AI about a selection

- **Id:** `askAiSelection`
- **What:** With an AI service set up, Ask AI sends a picture of the selection (or of an empty lasso's patch) to Ask AI.
- **Where:** Selection "…" › "Ask AI"; empty lasso › speech-bubble button.
- **Words:** ask ai, explain this, ai question, chatgpt, claude
- **Tip:** `askSelection`

### Turn handwriting into text

- **Id:** `turnIntoText`
- **What:** Lasso your writing and choose Turn into › Text. A dialog shows what the device read, with uncertain words to fix; "Replace" swaps the ink for a text box saying that. Undo brings the ink back. The corrections you make are kept for learning.
- **Where:** Lasso the writing › selection bar › … › Turn into › Text. Or the command Turn selection into text (also a keyboard shortcut you can set).
- **Notes:** The suggestion needs Grape; without it you type the text yourself.
- **Words:** convert to text, handwriting to text, ocr, typed text, transcribe selection, ink to text, turn into text
- **Settings:** `handwritingOnDevice`
- **Commands:** `turn-selection-into-text`
- **Tip:** `turnIntoText`

### Turn handwriting into a task

- **Id:** `inkTask`
- **What:** Lasso a handwritten line, Turn into › Task: a box appears beside it that a tap ticks, and the task is listed in the note for Obsidian's Tasks plugin. "Remove task" undoes it.
- **Where:** Selection "…" › Turn into › "Task".
- **Words:** task, checkbox, to do, tick, checklist from handwriting, tasks plugin
- **Tip:** `inkTask`

### Link any ink

- **Id:** `linkTo`
- **What:** Lasso ink and choose Link to… to make it open a note, a heading (Note#Heading), a notebook page or a web address. Linked ink gets an underline; a finger tap opens it. "Open link", "Change link" and "Remove link" appear for linked ink.
- **Where:** Selection "…" › Turn into › "Link to…".
- **Notes:** (tap with a finger, or right-click with a mouse, to open)
- **Words:** link, hyperlink, link to note, link heading, url, web link on ink
- **Tip:** `linkTo`

### Handwritten [[links]]

- **Id:** `inkLink`
- **What:** Write [[Note]] by hand; once read on the device it gets a dashed underline. A finger tap on it and confirming makes it a real link.
- **Where:** Write [[Name]], finger-tap the dashed underline, confirm.
- **Notes:** (needs on-device handwriting reading)
- **Words:** wikilink by hand, write [[note]], handwritten link
- **Settings:** `handwritingOnDevice`
- **Tip:** `inkLink`

### Correct a misread word

- **Id:** `correctWord`
- **What:** Lasso a word (or hold on it) and choose Correct to tell FineNotes what it says; answers feed handwriting learning. With "Underline words it may have misread" on, doubtful words get an underline that a tap opens.
- **Where:** Selection "…" › "Correct"; finger hold on ink › Correct; Settings › "Underline words it may have misread".
- **Notes:** (needs on-device reading)
- **Words:** correct, fix recognition, wrong word, misread, spelling of handwriting
- **Settings:** `checkHandwrittenWords`
- **Tip:** `correctWord`

### Contents heading from a selection

- **Id:** `contentsHeading`
- **What:** Lasso a handwritten heading and choose Turn into › Contents heading: it is listed in Contents with its page and marked by a ribbon in the margin; the title is pre-filled from the reading of the ink.
- **Where:** Lasso a handwritten title › selection bar › … › Turn into › Contents heading.
- **Words:** table of contents, heading, chapter, outline entry, handwritten heading, lasso heading, section title
- **Settings:** `handwritingOnDevice`
- **Tip:** `contentsHeading`

### Frame to embed

- **Id:** `frameToEmbed`
- **What:** Turn a selection's area into a named frame that can be embedded in a note. Frames show (dashed, with a name tab) only while the Lasso is the tool; their name offers Copy embed link, Rename, Delete.
- **Where:** Selection "…" › Turn into › "Frame to embed".
- **Words:** region, frame, embed part of page, named area, embed link

### Make your own sticker

- **Id:** `saveSticker`
- **What:** Lasso something and Turn into › Sticker: it joins "My stickers" in the Stickers tool.
- **Where:** Selection "…" › Turn into › "Sticker".
- **Words:** sticker, custom sticker, save as sticker, my stickers
- **Settings:** `stickerFolder`
- **Tip:** `saveSticker`

### Copy highlighted PDF text

- **Id:** `copyHighlighted`
- **What:** For highlighter ink over a PDF's text, Copy text copies the words it covers. A command copies all highlighted text on the page.
- **Where:** Select the highlights › … › Copy text; or the command Copy highlighted text on this page.
- **Words:** copy highlights, copy text under highlighter, pdf text, export highlights, highlighted text, extract highlights
- **Settings:** `highlighterSnapText`
- **Commands:** `copy-highlighted-text`
- **Tip:** `copyHighlighted`

### Insert space between lines

- **Id:** `insertSpace`
- **What:** With the lasso on By line, small arrows sit in the margin of lined paper; drag one down to push the writing below down by whole lines (onto the next page, adding pages if needed), or up to close empty lines. On a board, or on paper with no lines (blank, dotted, squared, planners), press anywhere and drag down (or right) to push everything below (or right of) the pen, by whole dots or squares; drag back to close empty space. On a notebook page nothing is pushed off the page.
- **Where:** Lasso › Lasso type "By line", then drag a margin arrow (on a board, drag anywhere).
- **Notes:** (any paper but PDFs; lined paper from the margin)
- **Words:** insert space, make room, push down, push right, add lines, remove empty lines, board
- **Settings:** `lassoMode`
- **Tip:** `insertSpace`

### Text boxes

- **Id:** `textBox`
- **What:** The Text tool places a typed text box with a tap (or a drag, if Drag to size is on). Selected boxes drag to move and tap to type; they have width handles, a scale handle and a turn knob.
- **Where:** Toolbar › Text (key T); or hold a finger › "Text box".
- **Words:** type, text box, typing, keyboard text, add text
- **Settings:** `textDragSize`, `textToolPinned`, `textStyle`

### Text style, fonts, lists and checklists

- **Id:** `textStyle`
- **What:** The text pill has presets (Title, Heading, Subheading, Body, Caption, Label, Markdown), font, size, colour, bold/italic/underline/strike/caps, alignment, line spacing, lists (Bullets, Numbering, Checklist), box fill, border, corners and padding. A tap on a checklist box ticks it.
- **Where:** Text tool's bar while a box is in hand.
- **Words:** bold, italic, font, size, heading, bullet, numbered list, checklist, align, box border, fill
- **Settings:** `textStyle`
- **Tip:** `checklist`

### Typed equations (LaTeX)

- **Id:** `typedEquation`
- **What:** The Text tool's Σ places a typed formula: type LaTeX in the equation window and see it set; ✓ or Return places it. Lasso it alone and choose "Edit equation" to change it. A handwritten sum's card can also turn it into a typed equation or copy its LaTeX.
- **Where:** Toolbar › Text › Σ (Equation), then tap the page. To change one: lasso it › Edit equation.
- **Words:** equation, latex, formula, maths, math, sigma, math typing, typeset, mathjax, katex
- **Tip:** `typedEquation`

### Type inside a shape

- **Id:** `typeInShape`
- **What:** Tap a closed shape to pick it up, tap it again and type: the text sits inside the shape.
- **Where:** Tap shape, tap again, type.
- **Words:** text in shape, label shape, write in box
- **Tip:** `typeInShape`

### Tables

- **Id:** `tables`
- **What:** The Shapes tool's Table picks a size, then drag it out (or tap to place). Tap a cell to type; Tab goes to the next cell and past the last adds a row. Its bar adds rows/columns, toggles the header row, sets bold and colour, deletes a row/column; dragging a border resizes.
- **Where:** Shapes › "Table"; select a table › "Edit table".
- **Words:** table, grid, rows, columns, cells, spreadsheet
- **Settings:** `tableHeader`
- **Tip:** `tableTab`

### Shape style of selected shapes

- **Id:** `shapeStyleSelection`
- **What:** For selected shapes the bar's line panel sets line style (None for filled shapes, Solid, Dashed, Dotted), width, square or rounded corners, and arrowheads; the fill and its opacity are in the colour panel.
- **Where:** Select shapes › line panel / colour disc.
- **Words:** dashed, dotted, no line, rounded corners, arrowheads, fill shape

### Curved and elbow arrows

- **Id:** `curvedElbow`
- **What:** Pick Curved arrow or Elbow arrow in the Shapes tool and drag. A curve's middle dot adds a bend; an elbow's pills slide its runs.
- **Where:** Shapes › Curved arrow / Elbow arrow.
- **Words:** curved arrow, elbow arrow, connector, bend arrow, route
- **Tip:** `curvedElbow`

### Join shapes with arrows (linked shapes)

- **Id:** `linkedShapes`
- **What:** Pick up one shape: dots appear at its sides. Drag a dot for a joined copy (a bar then offers which shape it becomes), or drop it on another shape to join them with an arrow that follows when either moves.
- **Where:** Select a single shape, drag a side dot.
- **Words:** flowchart, diagram, connect shapes, linked shape, connector arrow, mind map
- **Tip:** `linkedShapes`

### Move a single corner; bend a curved shape

- **Id:** `cornerPoints`
- **What:** For one shape, "Edit corner points" puts a ring on each corner to drag; on a circle or heart it puts handles round it to bend it.
- **Where:** Select one shape › corner points button.
- **Words:** corner points, edit points, vertex, bend circle, reshape
- **Tip:** `cornerPoints`

### Insert and arrange pictures

- **Id:** `pictures`
- **What:** Insert image offers Photos, Take photo and From vault; pictures can also be pasted or dropped. A selected picture has its own resize and rotate handles, and a bar: Crop, Copy, Duplicate, Delete, "…".
- **Where:** Toolbar › Insert image; drag and drop; paste.
- **Words:** image, photo, picture, insert image, camera, paste image, drag image
- **Settings:** `imagesFolder`

### Crop a picture

- **Id:** `cropImage`
- **What:** Crop puts a frame on the picture; drag its handles, then Done (Enter), Cancel (Escape) or Reset. The file is never changed.
- **Where:** Select picture › "Crop".
- **Words:** crop, trim, cut image edges

### Lock a picture (worksheet)

- **Id:** `lockImage`
- **What:** A locked picture cannot be moved or selected by accident; write over it freely. To free it, hold the lasso on it and tap Unlock.
- **Where:** Picture "…" › "Lock image"; lasso hold › "Unlock".
- **Words:** lock image, lock worksheet, fix background, can't move picture, unlock
- **Tip:** `lockPicture`

### Picture in front of ink, opacity, front/back

- **Id:** `pictureLayer`
- **What:** A picture's "…" menu has Arrange (Bring to front, Send to back among pictures), Flip, "In front of ink" and Opacity steps.
- **Where:** Picture "…".
- **Words:** bring to front, send to back, opacity, transparent image, in front of ink
- **Tip:** `pictureFront`

### Comments on a page

- **Id:** `comments`
- **What:** Pin a comment to a spot; a marker shows on the page and a tap opens it with Resolve/Reopen, Delete and Save. The AI can leave comments too.
- **Where:** Finger hold › "…" › "Comment"; or selection "…" › Turn into › "Comment".
- **Words:** comment, annotation, note pin, resolve comment, feedback

### Select words on a PDF

- **Id:** `pdfTextSelect`
- **What:** Press and hold a word (or right-click it) to select it; drag the handles to take more; Copy copies it.
- **Where:** Hold a finger on a word of a PDF page › Copy text.
- **Words:** select pdf text, copy pdf text, hold word, text selection, select text, copy text from PDF, PDF words
- **Tip:** `holdWord`

### Highlights snap to PDF text

- **Id:** `highlightSnap`
- **What:** A rough highlighter stroke over a PDF's text lands neatly on the line(s). Off, it always draws freehand.
- **Where:** Highlighter's options › "Snap to PDF text".
- **Words:** highlight pdf, straight highlight, snap to line
- **Settings:** `highlighterSnapText`, `straightHighlighter`
- **Tip:** `snap`

### PDF links work

- **Id:** `pdfLinks`
- **What:** A finger tap on a link in a PDF page follows it: a link to another page goes to the notebook page that shows it; a web address opens.
- **Where:** Tap the link on a PDF page with a finger.
- **Words:** pdf link, click link in pdf, hyperlink in pdf, PDF links, hyperlinks, planner tabs, digital planner, clickable PDF, index links
- **Tip:** `pdfLinks`

### Present mode

- **Id:** `present`
- **What:** The page fills the screen on a dark desk with the laser pointer in hand; arrow keys or a clicker turn pages, and a small ‹ 3 / 12 › ✕ bar shows on a tap.
- **Where:** Toolbar › ⋯ › Present (not on boards or practice sheets).
- **Notes:** (full screen on computers and Android; iPad hides Obsidian's chrome)
- **Words:** present, slides, presentation, clicker, screen share, slideshow, lecture, projector

### Zoom box (write big, land small)

- **Id:** `zoomBox`
- **What:** A frame on the page and a magnified window below: write large in the window and the ink lands small in the frame. Bar: Previous position, Advance, New line, Auto-advance, Zoom in/out, Zoom box settings (Line spacing, Auto-advance zone).
- **Where:** Toolbar › Magnifier › "Zoom box" (or Alt-drag a box).
- **Words:** zoom box, zoom window, write small, magnified writing, zoom writing
- **Settings:** `magnifierZoomBox`, `zoomBoxLineStep`, `zoomBoxAutoAdvance`, `zoomBoxAutoAdvanceThreshold`
- **Tip:** `zoomBox`

### Steer the Zoom box frame

- **Id:** `zoomFrame`
- **What:** Drag the frame on the page to move it, its handles to resize, and pinch the window to change magnification.
- **Where:** On the frame and window.
- **Words:** move zoom box, resize zoom box, zoom frame
- **Tip:** `zoomFrame`

### Erase by line, highlighter only

- **Id:** `eraserModes`
- **What:** Eraser modes Standard, Whole stroke and By line (lined paper); it can erase All ink, Highlighter only or Pen only. Pictures and text boxes are never erased.
- **Where:** Tap the Eraser again.
- **Words:** eraser, whole stroke, by line, erase highlighter only, erase pen only
- **Settings:** `eraserMode`, `eraserFilter`, `eraserSize`, `greyWhileErasing`
- **Tip:** `eraseLine`
