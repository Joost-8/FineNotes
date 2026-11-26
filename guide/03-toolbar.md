# The toolbar

Every button on the bar, its options pill, the ⋯ menu and Customize toolbar.

Part of FineNotes' guide (see `README.md` here): what Ask AI looks up to answer questions about the app. Edit an entry, then run `npm run guide`.

<!-- area: toolbar -->

### Pen tool (the pen button)

- **Id:** `penTool`
- **What:** Picks the pen. The button is drawn as the pen in hand (its type, nib in the ink colour, over a mark as thick as its width). The pen button stands for every pen type, the highlighter included; tapping it again shows or hides the pen's options pill.
- **Where:** Toolbar › Pen (centre zone). Keys P or W.
- **Notes:** Pressure-varying width only for Fountain/Brush, and only with Settings › Writing › Pressure-sensitive pens on.
- **Words:** pen, write, ink, draw, fountain pen, ballpoint, brush, calligraphy, marker, pencil, P, W
- **Settings:** `lastPen`, `defaultTool`, `defaultColor`, `defaultSize`, `pressureWidth`, `pencilTilt`

### Pen types (Fountain, Ball, Brush, Calligraphy, Highlighter)

- **Id:** `penTypes`
- **What:** The pen's pill starts with a row of pen types, each drawn in its own ink. Tap one to switch; each type remembers its own colour and width. Tap the type already in hand to open the pen menu. Fountain and Brush can vary with pressure; Calligraphy is a 40° flat nib (width follows direction); Highlighter is a see-through wide nib.
- **Where:** Toolbar › Pen › pen options pill › pen type row
- **Words:** pen type, fountain pen, ball pen, ballpoint, brush pen, calligraphy pen, nib, highlighter, marker, change pen
- **Settings:** `penInks`, `penTypeOrder`, `pressureWidth`, `pencilTilt`

### Reorder pen types

- **Id:** `penTypeReorder`
- **What:** Hold a pen type in the pill's row and drag it to another place; the new order is kept.
- **Where:** Toolbar › Pen › pen options pill › hold a pen type and drag
- **Words:** reorder pens, move pen, rearrange pen types, drag pen type, pen order
- **Settings:** `penTypeOrder`
- **Tip:** `penOrder`

### Highlighter

- **Id:** `highlighter`
- **What:** A pen type that draws see-through wide strokes. Key H puts it in hand. Its own settings (tip shape, opacity, straighten lines, snap to PDF text) are in the pen menu.
- **Where:** Toolbar › Pen › pen type row › Highlighter (or key H)
- **Words:** highlighter, highlight, marker, highlight text, H
- **Settings:** `highlighterAlpha`, `highlighterTip`, `straightHighlighter`, `highlighterSnapText`
- **Tip:** `chisel`

### Pen widths (three presets)

- **Id:** `penWidthPresets`
- **What:** Three width buttons drawn as the stroke they lay down; tap one to use it. Each pen type keeps its own three presets, and a preset keeps whatever width the slider last gave it.
- **Where:** Toolbar › Pen › pen options pill › width buttons
- **Notes:** (on an upright/side pill, or docked along top/bottom, the widths collapse into one button that opens the width popover)
- **Words:** width, thickness, size, stroke width, thin, thick, line weight
- **Settings:** `widthPresets`, `defaultSize`

### Width popover (exact width in mm, slider, reset)

- **Id:** `penWidthPopover`
- **What:** The ⌄ after the widths opens "Stroke width": a slider with a live preview on the page's own paper, a field to type the width in mm, the three presets, and a reset that restores the default widths. Changing the slider changes the preset in use.
- **Where:** Toolbar › Pen › pen options pill › ⌄ after widths ("More widths") › Stroke width
- **Words:** exact width, millimetres, mm, more widths, width slider, reset widths, custom width
- **Settings:** `widthPresets`
- **Tip:** `widthMm`

### Pen colour row

- **Id:** `penColourRow`
- **What:** The pill's colour row (up to ten, the rest scroll). Tap a colour to write in it. Tap the colour already chosen (it shows a ▾) to open the colour picker, and the colour you pick replaces that swatch.
- **Where:** Toolbar › Pen › pen options pill › colour swatches
- **Notes:** (upright/side pill shows three colours plus ⌄ "All colours"; docked at the side shows a scrolling column)
- **Words:** colour, color, ink colour, swatch, palette, change colour, red, blue
- **Settings:** `penColors`, `customColors`, `defaultColor`, `penInks`
- **Tip:** `tapColour`

### Add a colour (+)

- **Id:** `penAddColour`
- **What:** The dashed "+" after the last swatch opens the colour picker; the picked colour joins the end of the row. Hidden once the row is full.
- **Where:** Toolbar › Pen › pen options pill › + ("Add colour")
- **Words:** add colour, new colour, plus, more colours, custom colour
- **Settings:** `penColors`

### Remove a colour from the row

- **Id:** `penRemoveColour`
- **What:** A colour you added can be dragged off the pill to remove it, or deleted with "Delete" in its colour picker. The settings' own colours (default ink, custom palette) cannot be removed this way.
- **Where:** Toolbar › Pen › pen options pill › hold a swatch and drag it off; or tap chosen swatch › Delete
- **Words:** delete colour, remove swatch, drag colour away
- **Settings:** `penColors`
- **Tip:** `colourOff`

### Colour picker

- **Id:** `colourPicker`
- **What:** Shared picker for pen, shape, laser, fill and text colours: common colours, "This notebook" (the notebook's palette), "Recent", "Custom colour…" (saturation/brightness square, hue slider, hex), and an eyedropper.
- **Where:** any colour control › (Custom colour…)
- **Words:** colour picker, custom colour, hex, hue, saturation, recent colours, notebook colours
- **Settings:** `recentColors`, `customColors`

### Eyedropper (pick a colour from the page)

- **Id:** `eyedropper`
- **What:** The eyedropper in any colour picker closes it; the next press on the page picks the colour there (a stored element's colour, else the pixels), shown in a loupe. Escape or a press off the page cancels.
- **Where:** Any colour picker › Pick a colour from the page.
- **Notes:** On desktop (Chromium EyeDropper API) the bar also offers "From screen" to pick from anywhere on the screen.
- **Words:** eyedropper, colour picker, pick colour, sample colour, copy colour, match colour
- **Settings:** `recentColors`
- **Tip:** `eyedropper`

### Auto shape button (pen pill)

- **Id:** `autoShapeButton`
- **What:** A button at the end of the pen pill. On: a stroke that plainly is a shape snaps to it when you lift the pen. Off: shapes snap only after you hold the pen still (draw-and-hold). Same setting as Pen gestures › Make shapes.
- **Where:** Toolbar › Pen › pen options pill › Auto shape button
- **Notes:** (hidden on a practice sheet)
- **Words:** auto shape, shape recognition, snap shapes, perfect circle, straight line
- **Settings:** `snapMode`
- **Tip:** `hold`

### Saved pens (star)

- **Id:** `savedPens`
- **What:** The star at the end of the pen pill lists up to 8 saved pens (type, colour, width), each with its number key 1–8. Tap one to write with it; hold and drag to reorder (keys follow). Each row has a pin (put this pen on the toolbar as its own button) and a trash (tap twice to delete). Below: "New pen" (opens the pen dialog starting from the pen in hand) or "Saved pens are full (8)", and "Edit saved pens" (opens settings).
- **Where:** Toolbar › Pen › pen options pill › ★ Saved pens; keys 1–8
- **Words:** saved pens, favourite pens, favorites, presets, star, pen presets, 1-8, number keys
- **Settings:** `savedPens`
- **Tip:** `savedPens`

### Pen menu (⌄ "Pen options")

- **Id:** `penMenu`
- **What:** The ⌄ after the pen type row (or a tap on the type in hand, or a pen's side-button click) opens a menu: "Add to toolbar"/"Remove from toolbar", the highlighter's Tip (when the highlighter is in hand), "Laser pointer" (L), then "Pen settings" and "Pen gestures" pages.
- **Where:** Toolbar › Pen › pen options pill › ⌄ (Pen options)
- **Notes:** (side-button click opens it on desktop/Android pens, never on the iPad — the Apple Pencil has no side button)
- **Words:** pen menu, pen options, pen settings, laser, gestures, add pen to toolbar
- **Settings:** `stylusButtonClick`

### Add a pen to the toolbar (pen as its own button)

- **Id:** `penOnToolbar`
- **What:** Puts the pen type in hand (or a saved pen) on the bar as a button of its own, keeping its own ink and width; "Remove from toolbar" takes it off. Once another pen is on the bar the main Pen button may itself be hidden.
- **Where:** Toolbar › Pen › ⌄ › Add to toolbar; or Saved pens › pin; or Customize toolbar › New pen chip
- **Notes:** (not on practice sheets)
- **Words:** pin pen, pen button, add pen to toolbar, second pen, favourite pen on bar, quick pen
- **Settings:** `toolbarLayout`, `savedPens`

### Highlighter tip (round / chisel)

- **Id:** `highlighterTip`
- **What:** Round or flat chisel tip for new highlighter strokes; each stroke keeps the tip it was drawn with.
- **Where:** Toolbar › Pen (Highlighter in hand) › ⌄ › Tip
- **Words:** chisel tip, round tip, flat highlighter, highlighter shape
- **Settings:** `highlighterTip`
- **Tip:** `chisel`

### Laser pointer

- **Id:** `laserPointer`
- **What:** Draws a trail that fades and is never saved. No bar button: reach it from the pen menu or key L. Its pill holds only its colour (six colours + picker when docked; otherwise a colour disc). Present mode puts it in hand automatically.
- **Where:** Toolbar › Pen › ⌄ › Laser pointer (or key L) › pill › Laser colour
- **Words:** laser, pointer, presentation pointer, temporary ink, fading ink, L
- **Settings:** `laserDefaultColor`
- **Tip:** `laser`

### Pen settings: Stroke stabilization

- **Id:** `strokeStabilization`
- **What:** A 0–100% slider per pen type that steadies a shaky hand; higher settings trail the pen and round off small loops. Affects strokes written next.
- **Where:** Toolbar › Pen › ⌄ › Pen settings › Stroke stabilization
- **Words:** stabilization, smoothing, shaky hand, steady, smooth lines, jitter
- **Settings:** `penStabilization`
- **Tip:** `stabilization`

### Pen settings: Highlighter opacity, Straighten lines, Snap to PDF text

- **Id:** `highlighterLook`
- **What:** With the highlighter in hand: Opacity slider 10–100% (applies to every highlight, existing ones too); "Straighten lines" (highlights become straight runs); "Snap to PDF text" (highlighting on PDF text marks it a line at a time; off draws freehand).
- **Where:** Toolbar › Pen (Highlighter) › ⌄ › Pen settings
- **Words:** highlighter opacity, transparency, straight highlighter, snap to text, PDF highlight
- **Settings:** `highlighterAlpha`, `straightHighlighter`, `highlighterSnapText`
- **Tip:** `snap`

### Pen settings: Hide pen options while writing

- **Id:** `hidePenOptionsWhileWriting`
- **What:** Dropdown: Never / until you tap the pen again / until the pen lifts (the options come back after ~1 s rest). Only for pen and highlighter.
- **Where:** Toolbar › Pen › ⌄ › Pen settings › Hide pen options while writing
- **Words:** hide toolbar while writing, auto hide pill, clear bar, distraction free, tuck options
- **Settings:** `tuckPenOptionsOnWrite`
- **Tip:** `hideOptions`

### Pen settings: Back to the pen

- **Id:** `backToPen`
- **What:** Dropdown: Never / Tap the tool again / After one use / Both. After the eraser, lasso, text, shape, laser, tape or fill tool, go back to the pen or highlighter you had.
- **Where:** Toolbar › Pen › ⌄ › Pen settings › Back to the pen (Never, Tap the tool again, After one use, Both).
- **Words:** return to pen, switch back, auto return, after eraser go back to pen, auto switch back, after erasing
- **Settings:** `returnToPenOnReselect`, `returnToPenAfterUse`
- **Tip:** `backToPen`

### Pen gestures: Make shapes

- **Id:** `makeShapes`
- **What:** Off / When I hold the pen still / When I lift the pen, too. Below it, a bar from "straight lines only" to "looser shapes" sets how curved a stroke may be and still snap.
- **Where:** Toolbar › Pen › ⌄ › Pen gestures › Make shapes
- **Words:** make shapes, draw and hold, shape snap, auto shape, curve tolerance, straight lines only
- **Settings:** `snapMode`, `snapCurvatureThreshold`
- **Tip:** `hold`

### Pen gestures: Scribble to erase

- **Id:** `scribbleErase`
- **What:** Scribble back and forth over handwriting with the pen and the writing under it is erased, the scribble with it. Optionally shapes, tables and highlighter too.
- **Where:** With the pen in hand, scribble over the ink. Switches: Toolbar › Pen › ⌄ › Pen gestures › Scribble to erase, and Erase shapes and highlighter.
- **Notes:** (pen tool only, not the highlighter)
- **Words:** scribble erase, scratch out, scribble delete, erase by scribbling, scribble, cross out, zigzag erase
- **Settings:** `penGestures`, `penGestures.scribbleErase`, `penGestures.scribbleErasesAll`
- **Tip:** `scribble`

### Pen gestures: Scribble to fill

- **Id:** `scribbleFill`
- **What:** Scribble inside a closed outline (over no ink to erase) and the whole area fills with colour.
- **Where:** With the pen in hand, scribble inside the outline. Switch: Toolbar › Pen › ⌄ › Pen gestures › Scribble to fill.
- **Notes:** (pen tool only)
- **Words:** scribble fill, colour in, fill shape by scribbling, fill shape, fill outline
- **Settings:** `penGestures`, `penGestures.scribbleFill`
- **Tip:** `scribbleFill`

### Pen gestures: Circle to lasso

- **Id:** `circleLasso`
- **What:** Draw a loop round something with the pen, then press and hold on the loop: the loop disappears and what it enclosed is selected, ready to move. A loop that is not held stays ink.
- **Where:** With the pen in hand: loop round the ink, lift, then hold the pen on the loop (or keep it down and hold). Switch: Toolbar › Pen › ⌄ › Pen gestures › Circle to lasso.
- **Notes:** (pen tool only)
- **Words:** circle to select, loop select, lasso with pen, hold to select, circle and hold, grab, select without lasso tool
- **Settings:** `penGestures`, `penGestures.circleLasso`
- **Tip:** `circleLasso`

### Eraser tool

- **Id:** `eraserTool`
- **What:** Picks the eraser. Its button icon shows the mode in use.
- **Where:** Toolbar › Eraser (key E)
- **Notes:** (Shift-to-erase and the pen's side button are other ways in, outside the toolbar)
- **Words:** eraser, rubber, erase, delete ink, remove, E
- **Settings:** `eraserMode`, `eraserSize`, `barrelButton`
- **Tip:** `shiftErase`

### Eraser mode (Standard, Whole stroke, By line)

- **Id:** `eraserMode`
- **What:** Standard erases what it passes over; Whole stroke removes entire strokes; By line (lined paper) erases a whole written line. The same popover has "Grey out while erasing" (Whole stroke and By line show what they'll take in grey until the pen lifts).
- **Where:** Toolbar › Eraser › pill › mode button (Standard ⌄)
- **Words:** eraser mode, stroke eraser, pixel eraser, partial eraser, whole stroke, erase line, lined paper
- **Settings:** `eraserMode`, `greyWhileErasing`
- **Tip:** `eraseLine`

### Eraser size

- **Id:** `eraserSize`
- **What:** Three size presets drawn as eraser footprints; the ⌄ opens a slider with preview and a reset to default sizes. A preset keeps the size the slider gave it.
- **Where:** Toolbar › Eraser › pill › size buttons / ⌄ (Eraser size)
- **Words:** eraser size, big eraser, small eraser, eraser width
- **Seen as:** eraser size does not stay, eraser size resets, custom eraser size lost
- **Settings:** `eraserSize`, `eraserPresets`

### What the eraser erases (highlighter only / pen only)

- **Id:** `eraserFilter`
- **What:** Two switches (at most one on): "Erase highlighter only" or "Erase pen only"; both off erases all ink. Pictures and text boxes are never erased.
- **Where:** Toolbar › Eraser › pill › "All ink" ⌄ › What the eraser erases
- **Words:** erase highlighter only, erase pen only, keep highlights, eraser filter
- **Settings:** `eraserFilter`
- **Tip:** `eraseHighlightOnly`

### Clear page (eraser pill)

- **Id:** `eraserClearPage`
- **What:** Removes all ink on the current page in one step (undoable).
- **Where:** Toolbar › Eraser › pill › Clear page (trash)
- **Words:** clear page, erase everything, wipe page, delete all ink

### Lasso tool

- **Id:** `lassoTool`
- **What:** Picks the lasso to select ink and items. The button shows the lasso type in use and carries a chevron; tap it again to open the Lasso tool popover.
- **Where:** Toolbar › Lasso (key V)
- **Words:** lasso, select, selection, move, cut, copy, V
- **Settings:** `lassoMode`, `lassoFilter`, `lassoTouches`
- **Commands:** `turn-selection-into-text`
- **Tip:** `lassoTray`

### Lasso type (Rectangular, Freehand, By line, One item)

- **Id:** `lassoType`
- **What:** Rectangular (drag a box), Freehand (draw a loop), By line (select written lines), One item (grab a single item without a loop).
- **Where:** Toolbar › Lasso › tap again › Lasso tool › Lasso type
- **Words:** rectangle select, freehand lasso, select by line, one item, tap to select, box select
- **Settings:** `lassoMode`
- **Tip:** `oneItem`

### What the lasso selects (filters)

- **Id:** `lassoFilter`
- **What:** Switches for Handwriting, Images, Shapes, Arrows, Text boxes, Tables, Graphs: only switched-on kinds are picked up.
- **Where:** Toolbar › Lasso › tap it again › What to include in the selection.
- **Words:** lasso filter, select only images, select handwriting only, ignore text boxes, only handwriting, skip images, select only shapes
- **Settings:** `lassoFilter`
- **Tip:** `lassoFilter`

### Text tool

- **Id:** `textTool`
- **What:** Tap the page to place a text box. The text pill styles new boxes, or the box being edited (and then floats beside that box).
- **Where:** Toolbar › Text (key T)
- **Words:** text, type, text box, typing, keyboard, T, add text, add a text box, write with keyboard, typed text
- **Settings:** `textStyle`, `textToolPinned`, `textDragSize`
- **Tip:** `checklist`

### Text style presets (Title, Heading, Subheading, Body, Caption, Label, Markdown)

- **Id:** `textStylePresets`
- **What:** Applies a named look to the text box (or new boxes). The button shows the preset the style matches, or "Style".
- **Where:** Toolbar › Text › pill › Style ⌄
- **Words:** text style, heading, title, body text, caption, preset, markdown
- **Settings:** `textStyle`

### Text colour, size and font

- **Id:** `textColourSizeFont`
- **What:** Colour disc (colour picker); size (slider plus a grid of sizes, live preview while dragging); font list: the named family in use, six built-in fonts, then the device's own fonts, with a search field. A family missing on this device is marked; some can be downloaded with a download mark.
- **Where:** Toolbar › Text › pill › colour / size / font
- **Notes:** The font list shows the fonts installed on the device.
- **Words:** font, font size, text colour, typeface, bigger text, system fonts, download font
- **Settings:** `textStyle`

### Text formatting, alignment, line spacing, lists

- **Id:** `textFormatting`
- **What:** B I popover (Bold, Italic, Underline, Strikethrough, All capitals); Alignment; Line spacing; Lists (Bullets, Numbering, Checklist — only while a box is being edited).
- **Where:** Toolbar › Text › pill › B I / alignment / line spacing / lists
- **Words:** bold, italic, underline, strikethrough, all caps, align, centre, line spacing, bullets, numbering, checklist, todo
- **Settings:** `textStyle`
- **Tip:** `checklist`

### Text box fill and border

- **Id:** `textBoxFillBorder`
- **What:** Box fill colour; Border (width, corners, padding, border colour).
- **Where:** Toolbar › Text › pill › Box fill / Box border
- **Words:** text box background, box colour, border, frame, rounded corners, padding
- **Settings:** `textStyle`

### Equation (typed LaTeX)

- **Id:** `textEquation`
- **What:** While the Σ button is on, a tap on the page places a typed equation (LaTeX) instead of a text box. Only with the Text tool in hand and no box being edited.
- **Where:** Toolbar › Text › pill › Σ (Equation)
- **Words:** equation, formula, LaTeX, math, sigma, typed equation
- **Tip:** `typedEquation`

### Pin Text tool

- **Id:** `textPin`
- **What:** Unpinned, finishing a text box hands back the tool used before Text; pinned, Text stays in hand.
- **Where:** Toolbar › Text › pill › Pin
- **Words:** pin text tool, stay on text, keep typing, text tool stays
- **Settings:** `textToolPinned`

### Delete text box

- **Id:** `textDeleteBox`
- **What:** Deletes the box being edited (undo brings it back). Disabled when no box has focus.
- **Where:** Toolbar › Text › pill › trash (Delete text box)
- **Words:** delete text box, remove text

### Shapes tool

- **Id:** `shapesTool`
- **What:** Drag out a Square, Circle, Triangle, Diamond, Rounded square, Star, Heart, Line, Curved arrow or Elbow arrow, or use Auto-shape. Shape style sets fill (none/soft/solid), line (solid/dashed/dotted), rounded corners and arrowheads.
- **Where:** Toolbar › Shapes (key S), then its options pill.
- **Words:** shapes, square, circle, triangle, diamond, rounded square, star, heart, line, arrow, elbow arrow, S, rectangle, insert shape
- **Settings:** `shapeColor`, `shapeStyle`
- **Tip:** `arrow`

### Shape colour and fill

- **Id:** `shapeColourFill`
- **What:** Colour disc opens a panel: colours, a Fill switch and, while on, its opacity. The shape colour is separate from the pen's.
- **Where:** Toolbar › Shapes › pill › colour disc
- **Words:** shape colour, fill shape, shape opacity, filled shape
- **Settings:** `shapeColor`, `shapeStyle`
- **Tip:** `fillTool`

### Shape line style

- **Id:** `shapeLineStyle`
- **What:** Line panel: none / solid / dashed / dotted, width, square or rounded corners, arrow at start/end, filled arrowheads.
- **Where:** Toolbar › Shapes › pill › Line ⌄
- **Words:** dashed line, dotted line, no outline, line width, rounded corners, arrowheads
- **Settings:** `shapeStyle`

### Table

- **Id:** `shapeTable`
- **What:** The Table button shows its size (e.g. 3 × 4); a second tap opens a rows × columns picker with a "Header row" switch. Then drag it out on the page or tap to place it.
- **Where:** Toolbar › Shapes › pill › Table › tap again
- **Words:** table, grid, rows, columns, header row
- **Settings:** `tableHeader`
- **Tip:** `tableTab`

### Hand tool

- **Id:** `handTool`
- **What:** Drag with the pen or mouse to move the page; useful in Stylus only mode.
- **Where:** Toolbar › More tools › Hand, or hold Space.
- **Words:** hand, pan, move page, scroll, drag page, pan tool
- **Tip:** `spaceDrag`

### Magnifier (Page zoom / Zoom box)

- **Id:** `magnifier`
- **What:** Pill: Page zoom or Zoom box mode, then Zoom out / Fit page (Fit drawing on a board) / Zoom in. In Page zoom, drag up or down to zoom. In Zoom box mode, one tap on the Magnifier opens a Zoom box with the pen kept in hand; with the box open a tap picks the Magnifier, another closes it.
- **Where:** Toolbar › More tools › Magnifier, then Page zoom or Zoom box in its pill.
- **Words:** magnifier, zoom, zoom box, zoom window, write big, fit page, zoom in, zoom out, zoom tool, zoom with pen, fit drawing
- **Settings:** `magnifierZoomBox`, `zoomBoxLineStep`, `zoomBoxAutoAdvance`, `zoomBoxAutoAdvanceThreshold`
- **Commands:** `zoom-in`, `zoom-out`, `fit-reset-view`, `fit-board-drawing`
- **Tip:** `zoomBox`

### Fill (paint bucket)

- **Id:** `fillTool`
- **What:** Tap inside an outline to fill it. Pill: its own colour (does not change the pen's) and how far it fills past gaps: closed outlines only / small gaps / wide gaps.
- **Where:** Toolbar › More tools › Fill.
- **Words:** fill, paint bucket, bucket, colour in, flood fill, colour area
- **Settings:** `fillColor`, `fillGap`
- **Tip:** `fillTool`

### Cover tape

- **Id:** `coverTape`
- **What:** Opaque strips over part of a page; tap a tape to peek, tap again to cover. Straight or freehand, narrow/medium/wide or any height; the eye in its bar shows or covers every tape on the page; on a PDF the magnet makes a straight tape cover each text line it crosses. Revealing is never saved.
- **Where:** Toolbar › More tools › Cover tape.
- **Words:** cover tape, tape, hide answers, study, quiz, masking tape, cover, quiz yourself, reveal
- **Settings:** `tapeColor`, `tapeHeight`, `tapeHeights`, `tapeMode`, `tapeSnapText`, `exportWithoutTapes`
- **Tip:** `coverTape`

### Ruler (Ruler, Set square, Protractor)

- **Id:** `ruler`
- **What:** A ruler over the page: one finger slides it, two turn it (snapped), the mouse slides it and Shift+wheel turns it. Pen or highlighter strokes near its edge follow it. Its ⌄ picks Ruler, Set square or Protractor and angle snapping.
- **Where:** Toolbar › More tools › Ruler (its chevron, while it is out, picks the kind).
- **Words:** ruler, straight edge, set square, protractor, angle, draw straight line
- **Settings:** `ruler`
- **Tip:** `rulerUse`

### Stylus only mode

- **Id:** `stylusOnly`
- **What:** Only the pen acts on the page; a resting hand moves neither ink nor page. Button lights while on. Turned off for the while when "Draw with finger" is on.
- **Where:** Toolbar › More tools › Stylus only (the button shows Stylus only: on/off).
- **Notes:** (meant for touch devices)
- **Words:** stylus only, palm rejection, pencil only, ignore fingers, hand on screen, ignore touch, palm, only pencil, disable touch, palm makes marks, stray marks
- **Seen as:** finger draws lines, finger writes instead of scrolling, cannot draw with finger, finger does nothing
- **Settings:** `onlyStylusMode`
- **Commands:** `toggle-only-stylus-mode`
- **Tip:** `stylusOnly`

### Insert image

- **Id:** `insertImage`
- **What:** Opens the image menu: Photos, Take photo, From vault, Scan document, Generate with AI.
- **Where:** Toolbar › Image
- **Notes:** "Take photo" is iPad/phone only; "Scan document" is hidden on a board; "Generate with AI" only when an image AI service is set up.
- **Words:** image, picture, photo, camera, insert image, scan, generate image
- **Settings:** `imagesFolder`, `imageVendor`
- **Commands:** `scan-document`
- **Tip:** `scan`

### Insert PDF

- **Id:** `insertPdf`
- **What:** Imports whole or selected PDF pages as pages: From files, or From vault. Hidden on endless boards and practice sheets.
- **Where:** Toolbar › PDF
- **Words:** insert pdf, import pdf, add pdf pages, pdf from files
- **Commands:** `import-pdf`, `import-vault-pdf`
- **Tip:** `dropPdf`

### Stickers

- **Id:** `stickers`
- **What:** A picker with built-in packs (arrows, labels, tape, icons, doodles) recoloured from one row of swatches, and your own collections from the stickers folder. A tap places one as a picture.
- **Where:** Toolbar › More tools › Stickers.
- **Words:** stickers, emoji, stamp, sticker picker, washi tape, decorations, arrows pack
- **Settings:** `stickerFolder`
- **Tip:** `saveSticker`

### Sticky notes

- **Id:** `stickyNotes`
- **What:** Tap the page to place a sticky note; write or type on it and its ink moves with it. Its bar has Colour, Fold note (folds to an icon a tap opens) and Lock note.
- **Where:** Toolbar › More tools › Sticky notes, then tap the page.
- **Words:** sticky note, post-it, note, memo, note on page, fold note, collapse note
- **Tip:** `foldNote`

### Record audio

- **Id:** `recordAudio`
- **What:** The mic starts and stops a recording; while it runs the mic is tinted and a red pill shows the time (with a bin to discard). Ink you write is time-stamped against the recording. On stop the audio is saved as a file (AAC .m4a, or WebM/Opus where only that is offered) and added to the note's recordings. Undo takes it off the note but keeps the file.
- **Where:** Toolbar › More tools › Record audio (the mic; Customize toolbar can put it on the bar). Page sidebar › Files › Recordings also has Record.
- **Notes:** (microphone permission needed; iOS has its own refusal message)
- **Words:** record, audio, microphone, voice memo, lecture recording, mic, recording, dictaphone, record class
- **Settings:** `recordingsFolder`
- **Tip:** `hear`

### More tools (toolbox) menu

- **Id:** `moreTools`
- **What:** Lists every button not on the bar and not hidden; a tap runs it as its button would. Last row: "Customize toolbar". The toolbox lights while a mode it lists is on (ruler out, sticky note waiting, stylus only).
- **Where:** Toolbar › More tools (toolbox ⌄)
- **Words:** more tools, toolbox, accessories, hidden tools, extra tools
- **Settings:** `toolbarLayout`

### Page thumbnails (sidebar)

- **Id:** `pageThumbnails`
- **What:** Opens or closes the page sidebar.
- **Where:** Toolbar › Page thumbnails (start zone)
- **Words:** thumbnails, page list, sidebar, pages panel, contents, outline
- **Tip:** `reorder`

### Home

- **Id:** `homeButton`
- **What:** Opens Home, the notebook library. Carries a dot when there is news.
- **Where:** Toolbar › Home (start zone)
- **Words:** home, library, all notebooks, back, notebook list
- **Commands:** `open-library`

### Search this notebook

- **Id:** `searchNotebook`
- **What:** Searches the transcribed handwriting, typed text and PDF text of every page; results are a list with snippets, ↑/↓ to step, and the match lit on the page. Opens as a side panel by default; a button switches to the original list.
- **Where:** Toolbar › Search (Search this notebook), or the command Search this notebook….
- **Words:** search, find, find handwriting, search ink, find in notebook, search handwriting, search PDF, Ctrl+F, find word
- **Settings:** `searchLayout`
- **Commands:** `search-notebook`
- **Tip:** `searchInk`

### AI button

- **Id:** `aiButton`
- **What:** Opens the AI menu: on-device handwriting reading (Read with, Corrections, Calculations, Learn your handwriting), then with your own key: Ask…, Generate image…, Transcribe recording…, AI settings…/Set up AI….
- **Where:** Toolbar › AI (sparkles, start zone)
- **Words:** AI, ask AI, transcribe, read handwriting, generate image, chatbot, OCR
- **Settings:** `llmVendor`, `handwritingOnDevice`, `checkHandwrittenWords`, `calcNotes`
- **Commands:** `read-handwriting-on-device`
- **Tip:** `askSelection`

### Calculator

- **Id:** `calculatorButton`
- **What:** Opens or closes the calculator popover.
- **Where:** Toolbar › Calculator (start zone)
- **Words:** calculator, maths, sum, graph, pocket calculator
- **Settings:** `calculator`
- **Tip:** `calc`

### Undo and redo

- **Id:** `undoRedo`
- **What:** Undo/redo buttons, greyed when there is nothing to undo/redo. Keys Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y. They never fold into ⋯.
- **Where:** Toolbar › Undo / Redo; Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y; two-finger double-tap undoes, three-finger redoes.
- **Notes:** (keys on desktop; two-finger/three-finger double tap on touch is a separate gesture)
- **Words:** undo, redo, take back, oops, ctrl z, cmd z, go back, mistake
- **Settings:** `fingerTapUndo`
- **Tip:** `undo`

### Full screen

- **Id:** `fullScreen`
- **What:** Hides Obsidian's chrome around the notebook; the button then shows "Leave full screen".
- **Where:** Toolbar › Full screen (end zone)
- **Notes:** iPad/tablet only; no button on desktop or phone
- **Words:** full screen, fullscreen, hide obsidian, maximise, focus mode, toolbar gone, everything hidden

### Add page

- **Id:** `addPage`
- **What:** The Add page popover: Before / After / Last page, the Recent templates (keep the current page's size), and "More from templates…" for the full picker. Also: "+ Add page" in the sidebar, a page's ⌄ › Add page before / Add page after.
- **Where:** Toolbar › Add page (+); page sidebar › + Add page; page sidebar › a page's ⌄ › Add page before / after.
- **Words:** add page, new page, insert page, blank page, template, extra page, page before, page after, append page
- **Commands:** `add-board`
- **Tip:** `pullPage`

### Export (share)

- **Id:** `exportShare`
- **What:** Exports pages as a PDF (or pictures) and shares it.
- **Where:** Toolbar › Export (share icon, end zone)
- **Words:** export, share, pdf export, save as pdf, print, send
- **Settings:** `exportFormat`, `exportMargins`, `exportPlainPaper`, `exportWithoutTapes`, `exportsFolder`
- **Commands:** `export-pdf`
- **Tip:** `plainExport`

### Notebook settings (gear) and update notice

- **Id:** `notebookSettings`
- **What:** The gear opens Notebook settings (Board settings / Page settings): rename, page count, created/edited dates, folder, and the rows Scroll direction, Join pages, Page numbers, Header, Read-only, Simple look, and "All FineNotes settings".
- **Where:** Toolbar › Notebook settings (the gear, at the end of the bar).
- **Words:** settings, gear, notebook settings, update available, new version, rename notebook, notebook info, page count, created date
- **Settings:** `checkForUpdates`, `updateReminders`, `simpleLook`

### Learn my handwriting (practice sheet button)

- **Id:** `learnHandwritingButton`
- **What:** On a practice sheet only, a button before ⋯ shows lines copied so far and opens the Learn your handwriting window; it fills in once there is enough.
- **Where:** Toolbar (practice sheet) › Learn my handwriting
- **Words:** learn my handwriting, practice sheet, train recognizer, Grape
- **Commands:** `learn-handwriting`
- **Tip:** `learnWriting`

### News dots on buttons

- **Id:** `newsDots`
- **What:** After an update, a dot sits on buttons whose features changed (e.g. settings, calculator, ⋯, tape); it goes after the first tap.
- **Where:** Toolbar buttons
- **Words:** dot, red dot, what's new, new feature marker
- **Settings:** `newsDotsUsed`
- **Commands:** `show-whats-new`

### Buttons fold into ⋯ when the bar is too narrow

- **Id:** `barFolding`
- **What:** A bar along the top or bottom never scrolls sideways: buttons that don't fit move into the ⋯ menu (outer ends first, tools last). Undo, redo, pen, eraser, ⋯ and the tool in hand never fold. A side (upright) bar shrinks its buttons and scrolls instead.
- **Where:** Toolbar › ⋯ (top rows)
- **Notes:** (matters most in Split View / narrow panes)
- **Words:** missing button, where is button, toolbar overflow, narrow window, split view, buttons gone

### Move the tool options bar (pill dock)

- **Id:** `pillDock`
- **What:** Hold the options pill and drag it; it springs to the nearest place: under the bar, along the bottom, or upright at the left or right. Kept per device for every tool.
- **Where:** hold the tool options pill and drag
- **Notes:** (per device)
- **Words:** move toolbar, move options, drag pill, options at bottom, options on side
- **Tip:** `pillDock`

### Text options float beside the text box

- **Id:** `textPillAnchored`
- **What:** While a text box is held or edited, the text pill floats beside it, staying above the on-screen keyboard; it can't be dragged then.
- **Where:** automatic, Text tool
- **Notes:** (keyboard watching matters on iPad)
- **Words:** text toolbar moves, formatting bar near text, keyboard covers toolbar

### Customize toolbar

- **Id:** `customizeToolbar`
- **What:** Edit mode for the bar: drag any button (finger, Pencil or mouse, no hold) to any place in Start/Middle/End, or onto the "More tools" or "Hidden" shelves. A tap on a button gives a menu (Move left/right/up/down, To the start/middle/end, To More tools, Hide; for pen buttons Remove from toolbar / Delete). Arrow keys move the focused button; Enter opens its menu. Pen, toolbox and ⋯ stay on the bar. Tap the page, ✓ or Escape to finish; changes are live and kept in every notebook.
- **Where:** Toolbar › More tools › Customize toolbar
- **Words:** customize toolbar, rearrange toolbar, edit toolbar, move buttons, add button, remove button, hide button, hide tools, hide buttons, remove tools from the toolbar, fewer buttons, toolbar too full, where did my toolbar go, a tool is missing, tool disappeared
- **Settings:** `toolbarLayout`
- **Commands:** `customize-toolbar`
- **Tip:** `customizeBar`

### Hidden buttons stop what they started

- **Id:** `hiddenItemEffects`
- **What:** Hiding a button ends what it had on (its tool goes back to the pen, the ruler goes away, a recording stops and is saved, a waiting sticky note is dropped, stylus-only goes off), and its shortcut can't turn it back on. Items in More tools keep working.
- **Where:** Customize toolbar › drag to Hidden
- **Words:** hidden tool, hide ruler, hide recorder, disabled shortcut
- **Settings:** `toolbarLayout`

### Toolbar position (top, bottom, left, right)

- **Id:** `toolbarEdge`
- **What:** Four buttons at the top of Customize toolbar put the bar along the top, bottom, left or right. Kept per device; a pill resting by the bar moves with it.
- **Where:** Toolbar › More tools › Customize toolbar › Toolbar at the top / bottom / left / right
- **Notes:** (per device)
- **Words:** toolbar position, toolbar at bottom, toolbar on left, vertical toolbar, side toolbar, where is the toolbar, toolbar gone, toolbar disappeared, move the toolbar
- **Tip:** `toolbarEdge`

### Dock tool options

- **Id:** `dockToolOptions`
- **What:** The options pill becomes a row docked by the bar that the page starts below (no longer floating over the page). Along the top or bottom, tool choices show as buttons in the row (e.g. lasso types and filters, laser and fill colour swatches). If they don't fit beside the tools, they take a second bar. Kept per device.
- **Where:** Toolbar › More tools › Customize toolbar › Dock tool options
- **Notes:** (per device)
- **Words:** dock options, options in toolbar, second bar, fixed options bar, options row
- **Tip:** `dockOptions`

### Essentials preset

- **Id:** `essentialsPreset`
- **What:** A preset bar (shown only while Dock tool options is on): page thumbnails, undo, redo, lasso, pen, eraser, text, shapes, toolbox; the end's buttons (full screen, add page, search, calculator, AI, export, settings, Home) live in ⋯. Hand, magnifier, stylus only and fill are hidden. Tools are swapped, never added (drop a tool on a button to swap); adding a pen needs Essentials off. Reset returns to the preset's start.
- **Where:** Toolbar › More tools › Customize toolbar › Essentials (after turning on Dock tool options)
- **Words:** essentials, simple toolbar, minimal toolbar, preset, compact toolbar
- **Settings:** `toolbarPreset`, `toolbarEssentials`

### New pen chip (Customize toolbar)

- **Id:** `customizeNewPen`
- **What:** A chip drawn as the pen in hand: drag it onto the bar to leave that pen as a button there; tap it to open the pen dialog first. Dimmed when no pen can be added (or "Turn off Essentials to add a pen"). While a pen button is carried, a trash beside it deletes that pen.
- **Where:** Toolbar › More tools › Customize toolbar › New pen chip
- **Words:** new pen button, add pen, pen chip
- **Settings:** `savedPens`, `toolbarLayout`

### Look: Style and Colours (in Customize toolbar)

- **Id:** `customizeLook`
- **What:** Two shelves of chips pick the chrome's style and colour palette; Reset also returns the look to default.
- **Where:** Toolbar › More tools › Customize toolbar › Style / Colours
- **Words:** look, theme, toolbar style, colours, palette, skin
- **Settings:** `lookStyle`, `lookPalette`
- **Commands:** `next-look-style`, `next-look-palette`
- **Tip:** `looks`

### Reset toolbar

- **Id:** `customizeReset`
- **What:** Restores the layout the preset in use starts with (default or Essentials) and the default look. Disabled when nothing differs.
- **Where:** Toolbar › More tools › Customize toolbar › Reset
- **Words:** reset toolbar, default toolbar, restore toolbar
- **Settings:** `toolbarLayout`, `toolbarEssentials`

### ⋯ menu overview

- **Id:** `moreMenu`
- **What:** The ⋯ button opens a panel for the page being read: first any bar buttons folded in, then page actions, view rows, and Clear/Delete page. A board shows view rows and "Clear board"; a practice sheet only "Go to page" and "Clear page". ⋯ lights while fingers draw.
- **Where:** Toolbar › ⋯ (end zone)
- **Words:** more, three dots, menu, page menu, options

### Bookmark page

- **Id:** `moreBookmark`
- **What:** Bookmarks the page (or removes it).
- **Where:** Toolbar › ⋯ › Bookmark page / Remove bookmark
- **Words:** bookmark, ribbon, mark page, favourite page
- **Tip:** `ribbon`

### Add to Contents / rename

- **Id:** `moreContentsTitle`
- **What:** Gives the page a title in Contents, or renames it.
- **Where:** Toolbar › ⋯ › Add to contents / Rename in contents
- **Words:** contents, table of contents, page title, rename page, heading
- **Tip:** `contentsHeading`

### Copy link to page

- **Id:** `moreCopyLink`
- **What:** Copies a link that opens this page.
- **Where:** Toolbar › ⋯ › Copy link to page
- **Words:** link to page, page link, copy link, wiki link
- **Commands:** `copy-page-link`
- **Tip:** `copyPageLink`

### Duplicate page

- **Id:** `moreDuplicate`
- **What:** Duplicates the page (not on a single page).
- **Where:** Toolbar › ⋯ › Duplicate page
- **Words:** duplicate, copy page, clone page

### Change template / cover

- **Id:** `moreChangeTemplate`
- **What:** Changes this page's paper template, or the cover's design if it is a cover.
- **Where:** Toolbar › ⋯ › Change template / Change cover
- **Words:** change template, paper, lines, grid, change cover, background
- **Tip:** `designPaper`

### Margin

- **Id:** `moreMargin`
- **What:** Adds room left, right or both beside the page (shows the current setting, e.g. "Right 30 %").
- **Where:** Toolbar › ⋯ › Margin
- **Words:** margin, room beside slides, notes margin, wider page
- **Tip:** `margins`

### Save page as template

- **Id:** `moreSaveTemplate`
- **What:** Saves this page as a template (not for covers).
- **Where:** Toolbar › ⋯ › Save page as template
- **Words:** save template, my template, reuse page
- **Settings:** `templateFolder`
- **Commands:** `save-page-as-template`
- **Tip:** `saveTemplate`

### Go to page

- **Id:** `moreGoToPage`
- **What:** Type a page number to jump to it (with more than one page).
- **Where:** Toolbar › ⋯ › Go to page
- **Words:** go to page, jump to page, page number

### Present

- **Id:** `morePresent`
- **What:** Shows the notebook as slides with the laser pointer in hand, each page fitted; on iPad Obsidian's chrome hides for the while. Not on boards or practice sheets.
- **Where:** Toolbar › ⋯ › Present
- **Notes:** (uses browser full screen where available; iPad hides chrome instead)
- **Words:** present, presentation, slideshow, slides, projector

### Dark pages / Light pages, Dark PDF pages

- **Id:** `moreDarkPages`
- **What:** Quick switch for dark or light pages. While dark, "Dark PDF pages" decides whether PDF pages turn dark too.
- **Where:** Toolbar › ⋯ › Dark pages (› Dark PDF pages)
- **Words:** dark mode, night mode, dark pages, dark paper, invert pdf
- **Settings:** `pageAppearance`, `invertPdfPages`
- **Tip:** `darkDesk`

### Desk colour

- **Id:** `moreDesk`
- **What:** The background around the pages: with the pages, light, dark, or a colour of your own.
- **Where:** Toolbar › ⋯ › Desk
- **Words:** desk, background around page, canvas colour, dark desk
- **Settings:** `desk`, `deskColor`
- **Tip:** `darkDesk`

### Draw with finger

- **Id:** `moreDrawWithFinger`
- **What:** Lets fingers draw (e.g. when the Pencil's battery is flat). Not saved: the Pencil writing again, or closing Obsidian, ends it; stylus-only mode rests meanwhile. ⋯ lights while it is on.
- **Where:** Toolbar › ⋯ › Draw with finger
- **Notes:** touch screens only
- **Words:** draw with finger, finger drawing, pencil battery dead, no stylus
- **Tip:** `drawFinger`

### Keyboard shortcuts sheet

- **Id:** `moreShortcuts`
- **What:** Shows every keyboard and stylus shortcut. On desktop the row shows the key that opens it (?).
- **Where:** Toolbar › ⋯ › Keyboard shortcuts (or ?)
- **Notes:** (key shown only on desktop)
- **Words:** keyboard shortcuts, hotkeys, shortcut list, keys, cheat sheet
- **Commands:** `show-keyboard-shortcuts`
- **Tip:** `shortcutSheet`

### Copy home screen link

- **Id:** `moreHomeLink`
- **What:** Copies an obsidian://open link to this notebook, for a home-screen shortcut (Shortcuts app on iPad) or a bookmark.
- **Where:** Toolbar › ⋯ › Copy home screen link
- **Notes:** (aimed at iPad)
- **Words:** home screen shortcut, obsidian link, bookmark notebook, open notebook link

### Clear page / Delete page (⋯)

- **Id:** `moreClearDelete`
- **What:** Under "Clear or delete page": Clear page (disabled if empty) and Delete page (disabled if it is the only page). On a board: Clear board.
- **Where:** Toolbar › ⋯ › Clear page / Delete page
- **Words:** clear page, delete page, remove page, erase page

### Tool keys

- **Id:** `toolKeys`
- **What:** Single keys pick tools: P or W pen, H highlighter, E eraser, V lasso, S shapes, T text, L laser; 1–8 saved pens. A key presses the pen's own bar button if it has one; it never tucks the options away.
- **Where:** keyboard, with a notebook open
- **Notes:** desktop / iPad with keyboard
- **Words:** shortcuts, keys, hotkeys, P, W, E, V, S, T, L, H, 1-8
- **Settings:** `savedPens`
- **Tip:** `shortcutSheet`

### Pen side-button click

- **Id:** `stylusButtonClick`
- **What:** A click of a tablet pen's side button with the pen in the air opens the pen menu (or switches to the eraser and back, or nothing, per setting).
- **Where:** pen side button
- **Notes:** desktop pens and Android (S Pen); never on iPad (Apple Pencil has no side button)
- **Words:** barrel button, side button, S Pen, stylus button, pen button
- **Settings:** `stylusButtonClick`, `barrelButton`

### Pen cursor (desktop)

- **Id:** `penCursor`
- **What:** Over the page with a pen in hand, the mouse cursor is an ink-coloured dot as wide as the pen writes (or crosshair, arrow, none).
- **Where:** Settings › Cursor over the page
- **Notes:** desktop only
- **Words:** cursor, mouse pointer, crosshair, ink dot
- **Settings:** `penCursor`
