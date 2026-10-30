# Changelog

All notable changes to FineNotes (called GoodObsidian until 0.10.0) are
documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/). The GitHub Release notes for each tag are
extracted from the matching section of this file by `release.yml`.

## [Unreleased]

### Added

- **Your own shortcuts, per device**
  ([#69](https://github.com/Joost-8/FineNotes/pull/69),
  [#79](https://github.com/Joost-8/FineNotes/pull/79)). Settings → Shortcuts
  lists every tool and command with its key. Tap a key to record a new one:
  a keyboard key, a right click, a pen's side button or eraser end, or a
  mouse's middle, back or forward button. A tool can switch on a press or be
  held, back to the tool before when you let go. Each device keeps its own,
  and two actions on one key do nothing until one is changed. A side button
  recorded here wins over the side button settings.
- **Lines snap level or upright**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). A line or
  arrow drawn with its ends within a few pixels of level or upright on
  screen (and at most 4° off) comes out exactly level or upright: a held
  line, an arrow, the Shape tool's line and arrow, and the highlighter's
  straight line. A long line drawn at a slope keeps it, at any zoom.
- **Move a shape's corners and ends**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). Select one
  shape on its own and tap the corner points button in its bar: a ring
  sits on each of its corners or ends, and dragging one moves that point
  alone, as in Goodnotes. A rectangle with a corner moved becomes a
  four-sided shape; an arrow's head turns with its shaft. Circles, ellipses,
  rounded rectangles and clouds have no corner points.
- **Shapes snap to each other**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). While you
  draw a line, an arrow or a rectangle with the Shape tool, or hold a shape
  you drew, its ends and corners snap to the corners, ends and midpoints of
  the shapes already on the page, and a small ring shows where.
- **Lasso takes what it touches** (discussion
  [#51](https://github.com/Joost-8/FineNotes/discussions/51)). The lasso
  now takes a stroke or shape when any part of it is inside the loop, as
  Notability does; Settings › Writing › More brings back Goodnotes' rule
  (at least half of it). While you draw it, the lasso shows only its line.
  Turn into › Text, Task, Link to… and Contents heading read every word the
  lasso touched, whole.
- **Tap a shape with a finger to select it.** With the pen (or another
  drawing tool) in hand, a finger tap on a shape, an arrow or a table
  picks the lasso and selects it with its handles and bar, as a tap on a
  picture does.
- **Screenshot from the lasso.** The lasso's menu has Screenshot for any
  selection: a small window shows what is selected, as drawn on its page's
  paper, with Copy (to the clipboard, to paste into another app or note)
  and Share… (the system's share sheet). Where the device cannot share a
  picture, Save image puts it in the notebook's pictures folder instead.
- **The lasso's menu fits what you selected.** One kind of thing keeps its
  own options (a shape its fill and line, a table Edit table), and
  handwriting counts as one kind however many strokes it is. A mix of
  kinds gets only its ink's colour, and Turn into offers only what fits: a
  shape is not offered Text, Contents heading or Task.
- **Turn a selection with two fingers.** Two fingers on a selection or a
  selected picture, or either side of a small one, turn it about its
  middle, drawn toward the page's 45° steps as the knob is; the lift is one
  undo step. Two fingers elsewhere still zoom the page.
- **Linked shapes**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). Select one
  shape on its own and a dot sits beside each of its sides, as in Goodnotes:
  drag one out, or tap it, for a copy of the shape joined to it by an arrow
  with right-angled bends; drop the arrow on another shape instead and it
  joins the two at the side nearest where you let go, with no copy. Arrows
  are drawn thin, one width for all. The arrow stays joined when either
  shape moves.
  Right after, a bar beside the new shape turns it into a rectangle, circle,
  triangle, diamond or rounded rectangle. Notebooks with linked shapes open
  read-only in older versions of FineNotes, so update FineNotes on every
  device first.
- **Paste a transcript onto the page.** A transcribed recording in the
  sidebar's Recordings list has a paste button beside Transcript: it puts
  the transcript's text, as you left it in its note and without the
  times, onto the page in view as a text box, under what is drawn there.
  Undo takes it off again.
- **Stylus-only mode, the Hand and the Magnifier.** Stylus-only mode makes
  the page listen to the stylus alone: a palm, a finger or a mouse resting on
  the glass moves neither the ink nor the page, and a finger's scroll, pinch
  and taps are off. Its toolbar button, Stylus only, switches the mode on and
  off, and the command "Turn Stylus-only mode on or off" can take a hardware
  key. The Hand tool moves the page (with its fling) and the Magnifier zooms
  it: drag up or down, tap to zoom in a step, or use the pill's zoom out, fit
  page and zoom in. All three wait in the toolbar's More tools menu at first.
- **Hide pen options while writing.** A new choice in the pen menu's Pen
  settings and under Settings › Writing › More: the pen's options (pen
  type, widths and colors) tuck away as soon as the pen or highlighter
  starts writing, wherever they sit, as a second tap on the pen does.
  "Until you tap the pen" keeps them away until you tap it; "Until the pen
  lifts" brings them back by themselves once the pen has been off the page
  for a second. Never by default; the eraser, lasso and other tools keep
  their options.
- **Click the pen's side button for the pen menu.** With the pen held just
  above the page, a click of its side button opens the pen menu, as on a
  Samsung tablet, and the next click closes it. Holding the button while
  you write still erases, lassos or moves the page, as set. A new setting
  in Settings → Pens and shortcuts, **Side button click**, turns the click
  off. Not on iPad: the Apple Pencil has no side button.
- **Grey out while erasing**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). A new
  switch in the eraser's mode list: Whole stroke and By line draw what they
  take grey until the pen lifts, as Notability does, instead of hiding it
  at once. Off by default.
- **The toolbar at any edge**
  ([#50](https://github.com/Joost-8/FineNotes/issues/50)). The Toolbar row
  in a notebook's ⋯ panel puts it along the top (as before) or the bottom,
  or upright at the left or right. The page makes room on that side, up to
  the tab's header, and keeps the spot you were reading. Upright, every tool
  stays on the bar: its buttons shrink to fit, and past their smallest the
  bar scrolls. Its menus open toward the page from every edge, a tool's bar
  resting by the toolbar goes with it, and each device keeps its own place,
  so an iPad and a laptop can differ.
- **Joined pages**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). A notebook
  can join its pages: no gap between them, down or across, and everything
  runs on over the join, as on one sheet. Pen, highlighter, shapes, the
  eraser, the lasso, pictures, sticky notes, text boxes and tables all
  work across it. Choose **Joined pages** in the New notebook dialog, or
  switch it in the notebook's settings under Pages. Each page still stores
  and exports its own part, so the pages stay pages in the page list, in a
  PDF and on every other device. A small mark beside the page shows where
  one page ends. Off by default.

### Fixed

- The notebook could scroll by a few pixels in Obsidian when a tool's bar
  along the bottom was tucked away, which narrowed the page by a scrollbar's
  width and changed its zoom a little.
- **Pencil tilt** (discussion #51). Settings › Advanced › Pencil tilt: hold
  the Pencil flat and the Brush pen paints a wider stroke, up to three times
  its width, for shading. Held as you write, nothing changes. Only shaded
  strokes keep the tilt, so other notes stay as they were; an older FineNotes
  opens a notebook with shaded strokes read-only. The input debug overlay
  shows what the pen reports.

### Changed

- **The page uses the whole view.** Obsidian's padding around the notebook
  (a frame round the toolbar and a band at the foot) is gone, so the page is
  larger. The page counter, the zoom readout and a toolbar along the bottom
  keep clear of the iPad's home indicator and of Obsidian's status bar.
- **New board, named.** The New notebook dialog's ∞ now says "New board".
- **Resize handles on request**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). A lasso
  selection of handwriting, text or several things no longer shows its
  corner handles at once: the corners button in its bar shows them (and
  hides them again). One shape on its own still shows them straight away.
  The bar is now Cut · Copy · Duplicate · Delete · corners · ⋯.
- **Six colours and larger pens in the pen's bar.** The colour row shows six
  colours at a time; the rest, and the +, are a swipe away. The pen types
  are a little larger, each its own button with a border, the pen in hand
  ringed in the accent colour.
- **Hide toolbar tools.** Customize toolbar, at the end of the More tools
  menu, now has three places for every tool: on the bar (drag to reorder,
  the top is leftmost), in the More tools menu, or hidden. A tool in the
  menu hides with its crossed eye, and (+) brings it back.
- **Pen settings in the pen menu.** The pen menu's Pen settings page now
  also holds "Hide pen options while writing" and "Back to the pen", with
  all four choices, and its Pen gestures page holds "Hold to make shapes".
  "Hold to make shapes" and "Back to the pen" are no longer in Settings ›
  Writing; what you had chosen is kept.
- **The pen types as a row, as in Goodnotes.** Every pen type, the
  highlighter included, now sits at the start of the pen's bar, each drawn
  in its own ink: tap one to write with it. Hold a pen and drag it to put
  the row in your order; none can be added or taken away. Four show at a
  time and the fifth is a swipe away; upright at a side the row runs down
  the bar. The ⌄ after the pens (or a tap on the pen in hand) keeps the
  laser pointer, Pen settings and Pen gestures; the Pen type list it used to
  open is gone.
- **Turning a selection or a picture settles**
  ([#51](https://github.com/Joost-8/FineNotes/discussions/51)). The rotate
  knob no longer follows every tremor of the pen: a tap or a wobble turns
  nothing, the turn lands on quarter turns and on level (a tilted shape's
  longest edge, a picture's own tilt) from several degrees away, and rests
  lightly on every 15°, free between. A small readout beside the pen shows
  the angle while you turn.
  knob, and now two fingers, draw the turn gently toward every 45° of the
  page (0°, 45°, 90° …), whatever angle the item started at: it slows near
  a step and goes on through it, never stopping, and let go close to one
  it lands there exactly, so a shape drawn slightly crooked ends level,
  never at 89°. A small readout shows the angle on the page while you turn.

- **Update reminders.** While a newer FineNotes is out, "Update available"
  comes back under the toolbar's gear every other day until you update, and
  tapping it opens FineNotes' page in Community plugins, where Obsidian's
  Update button is. The gear's Notebook settings show the new version with
  an Update button and "Don't show again". Settings › Advanced › Updates
  chooses between Remind me (the default), a dot on the gear only, or no
  checking at all.
- **FineNotes' own folders.** Templates and stickers now live in one folder,
  `FineNotes assets` (as `Templates` and `Stickers`); a vault still using
  the old default folders has them moved there on the next start, and a
  folder you chose yourself stays where it is. New handwriting practice
  sheets go into `FineNotes assets/Handwriting sheets`, and so do your
  corrected words, which were kept in the plugin's own folder, where
  reinstalling FineNotes deleted them.
- **Learning your handwriting again.** After every 50 corrected words, a
  notice offers to learn again. Learning again keeps the new model only if
  it reads your test lines better than the one you have, not just better
  than Grape, so it never makes reading worse. Practice sheets now say to
  keep them: each time FineNotes learns, it learns from every sheet in the
  vault.
- **The tap that closes a popover only closes it.** A pen or mouse press on
  the page while a tool bar menu is open closes the menu and writes
  nothing; the next press writes. A finger still scrolls.

## [2.5.0] - 2026-10-25

### Added

- **Endless boards** ([#46](https://github.com/Joost-8/FineNotes/issues/46)).
  The infinity button in the New notebook dialog makes a board instead of a
  notebook: one page that grows as you write near its edges, on blank,
  dotted or squared white paper. It opens at writing size on the middle of
  your drawing, scrolls freely in every direction, and zooms out until the
  whole drawing fits. A board has no page list, page counter or PDF pages.
  Exporting it, Ask AI, handwriting reading and search still treat it as a
  page and come in a later version. A FineNotes that knows no boards opens
  one as a single page.
- **A ruler to draw along**: a straight ruler, a set square or a protractor.
  The ruler button lays it over the page, level in the middle. One finger
  or the mouse slides it, two fingers turn it with snapping (off, 5°, 15°
  or 45°), and its centimetres are the page's at the zoom you are at. A pen
  or highlighter line started near its edge follows it and is stored
  perfectly straight. The chevron on the button picks the kind and the
  snapping.
- **Sticky notes you write on**, in ten colours. Pick a colour on the
  sticky notes button and tap the page where the note should go. Ink that
  starts on a note belongs to it: it moves, resizes, turns, copies and
  deletes with the note, and the eraser and lasso reach it. Notebooks with
  sticky notes open read-only in older versions of FineNotes, so update
  FineNotes on every device first.
- **Customize the toolbar.** A new toolbox button at the end of the tools
  opens the tools the bar does not show (stickers, sticky notes, the ruler
  and Record audio at first), and Customize toolbar: one list of the bar's
  tools from left to right, where you drag a tool to move it, tap (−) to
  take it off the bar and (+) to put it back. The pen always stays.
  Stickers and sticky notes are tools of their own now, no longer in the
  Insert image menu.
- **Move the tool bar to any side, as in Goodnotes.** Hold the pen,
  eraser, text or shapes bar for a moment and drag it: it shrinks to a
  square showing the tool, and when you let go it springs to the nearest
  place: under the toolbar, along the bottom, or upright along the left or
  right edge. Upright, the pen's bar shows one width button and three
  colours, with the rest behind a ⌄. Its menus open toward the page, and
  the page counter, zoom readout, recording pill and audio player step
  aside for it. Every tool's bar goes there, and each device remembers its
  own place.
- **A pen colour row that grows, as in Goodnotes.** A colour added with
  the pen's + now joins the end of the row and stays there, instead of
  pushing one out; the + moves along after it. The row shows as many
  colours as the bar has room for, up to ten, and you swipe along it for
  the rest (up to 24 for each pen type). To take a colour out, tap it and
  choose Delete in the picker, or hold it and drag it off the bar.
- **Design your own paper.** "Design a paper…" under My templates' + opens
  a designer with a live preview: size (now up to A0) and orientation,
  paper colour, a paper grain, lines, squares or dots in mm and their
  colour, margins, a blank area and margin lines. Saved papers list in My
  templates and work for new pages and new notebooks.
- **Turn handwriting into text** ([#42](https://github.com/Joost-8/FineNotes/issues/42)).
  Lasso some writing and choose Turn into › Text: FineNotes fills in what
  it reads there, a line for each written line, for you to check, and
  Replace swaps the ink for a text box in the ink's colour and size. Undo
  brings the ink back. On a computer, the command "Turn selection into
  text" does the same; give it a hotkey under Settings → Hotkeys. On the
  iPad, confirm with Replace: the keyboard's ✓ does not replace yet.
- **Lasso "One item".** A fourth lasso type: the pen picks up whatever it
  lands on and moves it in the same stroke, with no loop to draw.
- **Tables you can style and shape.** A cell can be bold and have its own
  text colour. Drag any column's or row's border to resize it. The lasso
  picks a table up, and Edit table on its bar starts typing in it. A table
  keeps to its page: it never grows past the page's edge, and typing near
  the bottom lifts it as far as needed.
- **New pages repeat your template**
  ([#39](https://github.com/Joost-8/FineNotes/discussions/39)). In a
  notebook made from a page in My templates, a new page repeats the
  template page it follows, and New notebook starts on the template you
  used last.
- **Double-tap with one finger to fill the screen with the page**, edge to
  edge with nothing around it, and again to see the whole page.
- **Full screen on a tablet.** The new button left of Add page (or its
  row in ⋯ when the toolbar is short of room) hides Obsidian's tab bar
  and title bar above a notebook, so the page gets about 90 px more height.
  The same button brings them back. Switch to a note in another tab and
  Obsidian's bars come back for it. The choice is kept on each device.
- **A dot when a newer FineNotes is out.** Once a day FineNotes reads the
  version of its newest release on GitHub and puts a dot on the toolbar's
  gear, with "Update available" under it until you close it with its ✕
  (once per version). A tap on it, or the line at the top of FineNotes'
  settings, opens FineNotes in Community plugins. It only tells you;
  Obsidian still does the updating. Switch it off under Advanced → Check
  for updates.
- **Calculation notes (for handwriting models that read maths).** Write a
  sum ending in "=" and the answer is offered beside it; a tap writes it
  after the "=", in your own hand if you have written the new symbol
  practice sheet under Learn my handwriting. Off by default, and only
  offered with a model that reads maths: Grape 2.0 does not yet.
- **A way to support FineNotes.** A heart at the end of FineNotes'
  settings, and Obsidian's support button on FineNotes' page in Community
  plugins, open FineNotes' GitHub Sponsors page.

### Changed

- **The eraser's size is the paper's**, like a pen's width: it erases the
  same patch of page at every zoom, and its size marks show it at that
  zoom. The size previews (eraser and pen) draw on the page's own paper
  and lines at the zoom, so a size reads against the lines it will meet.
- **Width marks at their real size.** The pen's width buttons and the
  eraser's sizes are drawn as thick as the line they write, or as large as
  the eraser is, on the page at the zoom you are at.
- **Widths in mm are the ink's.** The highlighter, brush and calligraphy pen
  draw wider than the width you pick (4×, 1.8× and 2.6×), but the width
  field, its presets, saved pens and the default width showed the number
  before that. They now show and take the width of the ink on the page: a
  highlighter that draws a 4.1 mm band reads 4.1 mm, and typing 4 mm gives
  a 4 mm band. Your pens and your ink are unchanged.
- **A clearer card for an underlined word.** What FineNotes read is now
  the card's large heading, so you see at once what to check. The other
  words your ink may say follow right under it without the "Did you mean"
  caption, which read like a spelling check. The rows say what they do:
  "Type what it says…", "It says “…”" (your spelling, kept) and "Add to
  dictionary".

### Fixed

- **Japanese, Chinese and Korean text in PDFs shows again**
  ([#49](https://github.com/Joost-8/FineNotes/issues/49)). Pages whose
  fonts were not embedded in the PDF drew no text, and their text could
  not be read or highlighted.
- **"Transcribe on this device" downloads its speech model again**
  ([#48](https://github.com/Joost-8/FineNotes/issues/48)). 2.4.x looked for
  the models in a place that had not been published, so every download
  failed.
- **Grey and dark paper keep their edges.** A page the colour of the grey
  background around it (Dark Paper, or a grey paper from the paper
  designer) now gets a background in another shade, so you can see where
  the page ends.
- **Right-click an underlined word to correct it, on a computer**
  ([#41](https://github.com/Joost-8/FineNotes/issues/41)). With a mouse
  there was no way to open the card of a word the handwriting check
  underlined: the mouse writes, and a right-click always opened the menu.
  A right-click on an underlined word, or on linked ink, now does what a
  finger tap there does; anywhere else it still opens the menu.
- **On Android, dialogs opened from the lasso menu stay open**
  ([#38](https://github.com/Joost-8/FineNotes/issues/38)). Add to contents
  or Link to… sometimes flashed up and closed at once.
- **The iPad keyboard's ✓ confirms a dialog's one-line field**, even
  while its text is selected, instead of typing a line break over it.
- **Erasing by line no longer takes a whole highlight.** A highlight
  (straightened or not), a shape, or a stroke running over several lines
  used to go whole as soon as the eraser touched its line. Now only its
  part on the stretch of line you erase goes: erase a word, and the
  highlight under it goes with it, while the rest of the highlight stays.
- **The page panel's Add button for contents** hides when there is nothing
  to add.

## [2.4.1] - 2026-10-22

### Added

- **Move or copy pages to another notebook** (FineNotes#33). In the page
  sidebar, tick pages and choose Move, then "To another notebook…": pick a
  notebook (the one you used last comes first, and a search finds the rest)
  or start a new one, and choose Move or Copy. The pages arrive at the end of
  the other notebook, which can be closed or open; a notice offers Undo, which
  takes them back out of both.
- **Select pages in the sidebar itself**, not only in the page overview:
  Ctrl/Cmd-click or Shift-click a page, or choose Select pages in its menu.
  Dragging one ticked page takes every ticked page with it.
- **Checklists that Obsidian's Tasks plugin finds.** A text box can be a
  checklist (the new button next to Bullets and Numbering), and a tap on a
  box ticks it. Handwriting becomes a task too: lasso it, then Turn into ›
  Task. The words are read on the device and you can correct them; a box
  appears beside the ink, and a tap ticks it. Every item is also listed in
  the note as a `- [ ]` task with a link to its page, so Tasks queries and
  Obsidian's own search show it. Tick it there and the notebook is ticked
  too.
- **Search shows what it found on the page.** Opening a search result now
  glides to the first match and lights up the handwritten words and text
  boxes that hold it, until you touch the page. A result of Obsidian's own
  search opens the notebook on the right page with the words lit, instead
  of the last page you read.
- **Ink replay.** While a recording plays, ink you had not written yet at
  that moment is pale and turns to full colour as the recording reaches it,
  as in Notability. Seeking shows that moment at once, and the page being
  written comes into view unless you are using the page. The pen button on
  the player bar turns it off.
- **The calculator solves and shows its working**, as Symbolab does. Type an
  equation in solve( ) and press =: every x, exactly (x = (5 − √13)/2), by
  moving terms, factoring or the quadratic formula; trig equations give every
  solution with k, and what has no exact answer is found in numbers (≈).
  ∫( ) without limits gives the antiderivative + C (substitution, by parts,
  partial fractions and more), and d/dx( ) the derivative. The new list
  button shows the steps, each named (Product rule, Substitute u = x²);
  Insert steps puts them on the page as a text box. ∫ with limits and the
  slope at a point have keys of their own in the Calculus tab.
- **Add and change saved pens in Settings.** Each saved pen now shows its
  stroke, in its ink and at its width, instead of a name and a number. A
  plus button next to Saved pens makes a new one (type, width, colour, with
  a preview); a tap on a saved pen opens it to change.

### Changed

- **A shorter lasso menu.** Cut, Copy, Duplicate and Paste sit across the
  top. Fill, line, corners, arrowheads and flip are one row each instead of
  eleven, and stay open while you try them. Contents heading, Link, Sticker,
  Comment and the new Task are under Turn into ›. A picture's menu gets the
  same tiles, with Arrange, Flip and Opacity as one row each.
- **One settings section for the models on this device.** "Handwriting",
  "Recordings" and "Models" are now **Models on this device**: the voice
  model (Whisper), Grape (handwriting recognizer model) and your learned
  handwriting model, each saying what it is for, whether it is downloaded and
  how big it is, with its choices under it.
- **Learning your handwriting in two steps**: write the practice sheets, then
  learn. The settings list your sheets, how many lines each has, and which
  ones your learned model was built from, and say how much better it reads
  than Grape alone.
- **The graph is laid out as GeoGebra's**: the plot on top and the list
  under it, or the list beside it in a wide window. A tap on a curve selects
  it: it is drawn heavier and only it shows its roots and peaks. A held point
  is pinned as A, B, … with a row of its own; sliders fold their range away
  behind their name; the grid has faint minor lines.
- **solve next to 6** on the calculator's number pad, in place of mod
  (mod is still in the Basic tab).
- **A much smaller download.** `main.js` is 2.3 MB instead of 9.7 MB, so it
  syncs on Obsidian Sync's Standard plan again: the handwriting model is no
  longer built into it. 2.4.0 already saved it next to the plugin; if you
  update from an older version, it is downloaded once when first needed.

### Fixed

- **A learned handwriting model is no longer deleted by "Use Grape".** It is
  now **Read with my learned model**, a switch that keeps the file. The model
  before your last learning is kept, to go back to, and deleting your learned
  model is its own button, which asks first.
- **Search lights the words the handwriting reader got wrong.** A word the
  transcript has right but Grape read otherwise ("Soft ware", "PIVJ" for
  "plus") is now found through the transcript and lit where it is written,
  and a word's neighbours no longer light up with it.
- **The calculator shows a worked answer whole.** A stacked answer (x⁴ over
  12 + C) was cut off at the bottom, and an integral's limits at the top;
  both now fit the display.

## [2.4.0] - 2026-10-21

### Added

- **Zoomed in on a notebook whose pages run across, turn the page by pulling
  past its edge**, as in Goodnotes (FineNotes#34). Zoomed in, the view keeps
  to the page you are on; a pull past its edge shows the next page, and a
  longer one glides there at the same zoom. While you pinch, the pages beside
  it show, and letting go settles on the page in the middle.
- **The calculator is a window** that floats over the notebook like the graph
  window: move it by its title bar, resize it from its corner (the keys grow
  with it), close it with its cross or the toolbar button. It stays open while
  you write and opens where you left it. Typed keys go to it only while it is
  the window in use.
- **The eraser button shows the eraser mode** in use: its own icon for Whole
  stroke and By line, also in the mode menu.
- **Pull past the last page to add one, zoomed in too**, with a placeholder of
  the coming page sliding in, as in Goodnotes. It now takes a deliberate pull,
  and a pinch never adds a page.

- **Grape 2.0**, a new handwriting model, replaces Grape 1.0 and the model
  choice in Settings: it reads faster, is smaller (5.7 MB) and reads small
  note writing and short maths better (on the developer's own notes, 13.4%
  of characters wrong against 21.2%). Learn my handwriting starts from it, so
  what was learned from Grape 1.0 is not used any more; practice again to
  teach it your writing.
- **Handwriting practice now includes maths**: each of the three sets has ten
  lines such as fractions, powers, roots, sums and integrals written in plain
  characters, so Learn my handwriting also learns how you write them. Sets are
  now 30 lines.

- **Stroke stabilization, per pen**, as in Goodnotes: a 0-100% slider in the
  pen menu, under "Pen settings" (tap the pen in the pen pill), steadies a
  shaky hand while you write. Each pen keeps its own setting, and every pen
  starts at 0%, off. Around 5-20% already smooths a wobble without rounding
  small letters; higher settings let the settled ink trail the pen by up to
  ~2 mm and round off small loops. Ink already on the page is never changed.

### Changed

- **The toolbar never scrolls sideways.** When it runs out of room, the least
  used buttons fold into the ⋯ panel (the calculator first, then PDF,
  recording, pictures, and so on); undo, the pen, the eraser and the tool in
  hand always stay.
- **Notebook settings** (the gear) lead with the notebook itself and group the
  rest, and **New notebook** has Create on the left and one round cross on the
  right (by Oskar, #31 and #32).
- Notices such as "Part of this stroke is outside the page" move to the top of
  the page when the text bar sits near the bottom, so they never cover it.
- The page sidebar's header is solid, and the thumbnails fade out under it.
- Dropdown arrows are a little smaller, with a little more room before them.

### Fixed

- Zoomed in, opening or closing the page sidebar or the Ask panel jumped to
  another page when the pages run across.
- Switching to another app and back could show a different page.
- A system gesture (switching apps with four fingers, Control Center, going
  home) no longer moves or turns the page on its way out.
- Small handwriting, such as a 1 with its tick, snapped to a triangle (#36).
- Renaming a notebook in its settings showed the old name in the dialog when
  the notebook has its own folder; a page header with `{title}` and the
  thumbnails also kept the old name until the notebook was reopened.
- Settings: changing a saved pen's width or colour now updates its label and
  the "Save the pen in hand" row; "Write practice page" brings up "Learn now"
  without reopening the settings; Custom colors marks entries that are not
  hex colours instead of dropping them silently.

## [2.3.0] - 2026-10-18

### Changed

- **The toolbar moves like an Apple app.** The selected tool's square slides
  between tools on a spring, and option pills grow out of their button. A
  first tap on a tool picks it; a second tap opens its options, for every
  tool (the Table button too). The pen button is its own preview: the pen in
  hand, its nib in the ink colour, over a mark as thick as it writes.
- **Undo and redo say what they took back**: "Undid: Change shape style",
  "Redid: Add page".
- **Text holds still while zooming.** Text boxes no longer wiggle during a
  pinch, and a notebook with hundreds of text boxes pinches smoothly. A
  lasso resize keeps text sizes to one decimal, and the text size menu has
  a slider over every size from 12 to 400.
- **Ask… is one entry in the AI menu**, in place of the two Transcribe
  entries (transcription stays as commands).
- **Notebook settings (the gear) are this notebook's own.** Pages (scroll
  direction, page numbers, header), a new **Read-only** switch (nothing
  writes, erases or changes the pages; you can still scroll, search and
  export), and the notebook's name (renaming it, and its own folder) with its
  pages, size, dates and folder. Where new files are saved moved to
  FineNotes' settings, Advanced, for every notebook without a folder of its
  own.
- **The More panel scrolls instead of cutting off rows** on a short screen.
- **The Shape tool starts at the square.** Its auto-shape button is gone;
  the pen's Auto shape switch still turns a drawn shape clean.
- **Everything new is a notebook.** The New notebook dialog no longer offers
  a single page. Pages you already have still open, and their page menu can
  still turn one into a notebook.

### Added

- **Correct what Grape misread (test).** Settings → Handwriting → "Underline
  words it may have misread": after a page is read on the device, words not in
  a word list get a wavy underline. Tap one with a finger to type what it says,
  confirm it, or ignore the word. Each answer, ink included, is kept in the
  plugin's handwriting folder, and Learn my handwriting learns from it. Needs a
  word list (`handwriting/words.txt`); off by default.
- **Tables you type in.** Pick Table in the Shape tool and drag one out.
  With the Text tool, tap a cell to type; Tab moves to the next cell (past
  the last, it adds a row). A bar above the table adds and deletes rows and
  columns and turns the header row on or off, and the cell edges drag to
  resize. The lasso takes a table whole (move, resize, turn, copy), and its
  "what to include" list can leave tables out.
- **Shapes with style**: a fill, dashed or dotted lines, rounded corners,
  and open or filled arrowheads on lines.
- **Text styles**: Title, Heading, Subheading, Body, Caption and Label from
  a Style menu in the Text pill; padding inside a box, capitals, and more
  border widths and corner shapes.
- **Stickers.** A built-in pack of 28 (arrows, labels, washi tape, icons,
  doodles) that takes any colour, and your own collections from a stickers
  folder in the vault. "Save as sticker" turns a lasso selection into one.
  A picture, sticker or not, can sit in front of the ink and be made
  see-through.
- **A calligraphy pen**: a flat nib whose line is broad across it and a
  hairline along it, as an italic hand is written.
- **Paper in any colour.** The template picker sets the paper colour, the
  line colour (both from FineNotes' own colour mixer, or a swatch) and the
  line spacing, from Tight to Wide.
- **Page tabs, a header and page numbers.** Add page tab in a page's menu
  puts a coloured tab on the notebook's edge that opens the page. Notebook
  settings prints a header (with the title and page number if you like) and
  page numbers on every page but the cover, in exports too.
- **Comments on pages.** Hold on a page (or use the lasso's ⋯) and pick
  Comment: a note pinned to that spot, to read, edit, resolve or delete.
  Comments stay out of thumbnails and exports.
- **Ask is a chat, beside the page or over it.** Questions and answers in a
  thread, with Copy and Insert as text box under each answer. Pick up to 10
  pages with thumbnails, attach PDFs, pictures and text files (the
  notebook's own PDFs are offered), save a chat to the notebook's AI chats
  folder and open it again later. A chat survives closing it. On the iPad
  the field stays above the keyboard.
- **Ask can work in the notebook.** With Anthropic, OpenAI, Gemini,
  OpenRouter or a custom endpoint that supports tools, the AI can read and
  search the notebook, add text boxes, tables, pages and practice pages,
  draw on a page, title, bookmark and move pages, and mark or comment on
  your work. Each change is one undo step, and the chat lists what it did.
- **Recordings show Transcribe only when your AI set up can transcribe
  speech**, and say what is needed otherwise.
- **Links in PDFs work.** Tap a link on a PDF page with a finger: a
  planner's month tab or index entry goes to the notebook page showing that
  page of the PDF, and a web address opens. Links stay on every page the PDF
  is on, including papers from My templates.
- **Save page as template**, in the ⋯ panel and the command palette: the
  page as it looks becomes a paper in My templates.
- **Popular and new templates.** The gallery shows how often each template
  has been downloaded and sorts by Popular, New or A–Z. Downloads are
  counted by GitHub; nothing about who downloaded is sent anywhere.
- **A gallery to browse, like Goodnotes'.** Covers in a grid, with search and
  categories; a tap opens the template's own page, with every page of it to
  swipe through, its description, tags and licence, and Add to My templates.
- **Delete a template** from My templates: its ⋯ has Delete template (and
  Share…). It goes to the trash; notebooks that use it keep their own copy.
  The New notebook dialog shows every built-in paper section open.
- **Share a template with everyone.** Share… in My templates, Share yours…
  in the gallery, or the command: give it a name, category and licence, and
  the gallery's submission form opens on GitHub filled in. Attach the file
  there; a bot checks it, makes its preview and opens the submission, and
  once reviewed it is in every FineNotes gallery.
- **Community templates where you choose paper.** My templates, in the
  template picker and now also in the New notebook dialog, opens with a
  Community… card for the gallery. In New notebook a template is a whole
  notebook: the cover you chose, then every page of the template, its links
  working.
- **FineNotes' own template gallery**, on GitHub
  ([Joost-8/FineNotes-templates](https://github.com/Joost-8/FineNotes-templates)):
  Browse template gallery opens it unless another gallery is set, with a
  Cornell notes page and a linked weekly planner to start. Anyone can add
  theirs with a pull request; each is checked and reviewed.
- **The template gallery takes papers.** A gallery entry can be a PDF, PNG or
  JPEG paper (added to My templates) or a notebook; it can also link to its
  creator's own shop. Search and categories in the gallery; only PDF and
  picture files are accepted, checked by their contents, 40 MB at most.
- **My templates.** Bring in a PDF or a picture once (From files… or From
  vault… at the top of the template picker) and every page of it is a paper,
  next to the built-in ones: a 12-page planner is twelve papers. A notebook
  that uses one keeps its own copy beside it.
- **A notebook's folder is the notebook.** A new or imported notebook gets
  `Physics/` with the notebook inside, next to Images, Recordings,
  Transcripts, AI chats and Exports (Settings → "Give new notebooks their own
  folder", on by default; the New notebook dialog no longer asks). In the file
  explorer that folder shows as the notebook: tap its name to open it, or
  its arrow to see its files. Renaming the folder renames the notebook, and
  the other way round. Notebooks get a notebook icon, and the folders inside
  one an icon for what they hold (Settings → "Show notebook folders as
  notebooks", on by default).
- **A Files tab in the page sidebar**, in place of Audio. A dropdown picks
  what to list: Recordings (play and transcribe, as before), Pictures and
  PDFs (each with its pages; a tap turns to it), Transcripts, AI chats or
  Exports. Only the kind picked is listed, and only while the tab is open;
  pictures are listed by name, never decoded.
- **A folder for recording transcripts.** Notebook settings has a
  "Recording transcripts" row; empty, a transcript still goes next to its
  recording. Search also reads a transcript-server sidecar from a notebook
  folder's Transcripts.

## [2.2.1] - 2026-10-17

### Added

- **A welcome for new users.** The first time FineNotes runs in a vault with
  no notebooks, it offers a tour notebook, the importer, or a new notebook.
  The tour is made of FineNotes itself: text boxes, shapes, tables and ink
  you can select, move, recolour and erase. A contents page of links leads
  to the essentials (writing, the toolbar, pens, pages) and then a page per
  feature, each with examples and a "Try it" space: loops to erase, a star
  to circle, a house to lasso and turn, and how to bring notebooks over from
  other apps. The command **Show the welcome** brings it back.
  A vault that already has FineNotes settings or notebooks, such as a second
  synced device, is not greeted.

- **Import from more apps (beta).** Besides Goodnotes and Notability, the
  import dialog reads Noteful (`.noteful`), Xournal++ and Xournal (`.xopp`,
  `.xoj`), Saber (`.sbn2`, `.sbn`, `.sba`), reMarkable (`.rmdoc`, `.rm`),
  Supernote (`.note`, each page's handwriting as a picture) and FreeNotes
  (`.freenotes`), and any app's PDF: its pages become the paper, and its ink
  and highlight annotations become ink you can edit. A backup `.zip` may
  hold any mix. Thanks to [@OskarRabenda](https://github.com/OskarRabenda).

- **Copy home screen link**, in the **More** (⋯) panel: a link that opens
  the notebook straight from outside Obsidian. Paste it into a Shortcuts
  shortcut's **Open URLs** on an iPad or iPhone and add the shortcut to the
  Home Screen, or keep it as a bookmark on a computer.

### Changed

- **A new import dialog**: a drop zone with the file picker in it, the
  vault as a second source, what comes over, the folder to save to, and
  "How do I export?" with each app's own steps (Goodnotes' several notebooks
  or whole folders as one .zip, Notability's Auto-backup, and the rest).

- **An ink-coloured cursor on a computer.** Over the page, the pen now
  shows a dot in its ink colour, as wide as it writes at the zoom in use,
  with a thin white rim so it shows on any paper. While you write it
  shrinks to a tiny point, so it never hides the ink. The highlighter shows
  a slim see-through bar in its colour, and the laser pointer a glowing red
  point. The "Crosshair cursor" setting is now "Cursor over the page": Ink
  dot, Crosshair or Arrow. If you had the crosshair on, you get the ink dot;
  if you had it off, you keep the arrow (FineNotes#27).

## [2.2.0] - 2026-10-15

### Added

- **Page names under the thumbnails.** In the page sidebar and the page
  overview, a page shows its title from the contents beside its number,
  or else its topmost heading, cut short when it does not fit. A page with
  more entries in the contents shows how many ("+2"); tap its name to list
  them all and go straight to one.

- **Borders and rounded corners for text boxes.** The Text tool's new
  border button, next to the fill, gives a box a thin, medium or thick
  border in any colour, and rounded corners for its border and fill. The
  text keeps clear of a thick border, and thumbnails, exports and page
  embeds show the box as the page does. Goodnotes notebooks keep their
  bordered and rounded text boxes as one box with its text, instead of an
  outline drawn around a separate box; diamonds and other polygons still
  come over as outlines.

- **Resize a lasso selection by its corners.** Drag a square handle on the
  selection's frame to make everything in it bigger or smaller, with the
  aspect kept and the opposite corner holding still. Handwriting gets
  thicker or thinner with it, pictures keep their turn, and text boxes
  scale their text. One undo puts it all back
  ([#23](https://github.com/Joost-8/FineNotes/discussions/23)).

- **Rotate a lasso selection.** A knob hangs below the selection's frame,
  as below a picture: turn it and everything selected turns about the
  middle, snapping to quarter turns as it passes them. Handwriting and
  shapes turn, pictures turn with their own rotation, and text boxes go
  round with the rest but stay upright, so they still read across the
  page. One undo puts it all back.

- **Flip pictures and selections.** A picture's ⋯ menu has Flip horizontal
  and Flip vertical; the picture mirrors in place, keeping its crop and its
  turn, and the file is never touched. A lasso selection's ⋯ menu has them
  too: ink is mirrored, pictures flip, and text boxes move to their
  mirrored place but still read forwards. Pictures that were flipped in
  Notability now come over flipped.

- **Dark pages, for writing at night** (#25). Settings → Pages and
  notebooks → Page appearance: Light, Dark, or Match Obsidian's theme; the
  notebook's ⋯ menu switches between dark and light pages in one tap. The
  paper turns dark and ink light, keeping its colour: black ink shows
  near-white, dark blue light blue, red stays red, and the highlighter
  still reads as a highlighter. Coloured paper and light covers keep their
  hue, darkened; a page that is already dark, such as a navy cover, is left
  as it is. Pictures are never inverted. PDF pages turn dark too, keeping
  their colours; switch off "Dark PDF pages" for slides that are dark
  already. Only the view changes: your ink is saved, exported and printed
  in its true colour, and the colour picker shows true colours. White ink
  stays the colour of the paper, so it disappears on dark pages as it does
  on white ones. Thumbnails and page embeds in notes follow the setting.

- **Drag pages to reorder them** in the page sidebar. With a mouse or the
  Pencil, press a page and drag; with a finger, rest on it a moment, then
  drag, so a swipe still scrolls. The page lifts and follows you, a bar shows
  where it will land, and the panel scrolls when you near its top or bottom.
  Letting go outside the panel, or Escape, puts it back. One undo step, and
  the page you were reading stays in view. Under "Bookmarks only" a page
  lands next to the bookmarked page you drop it by.
- **See all pages at once.** The new button at the top left of the page
  sidebar grows it into a grid of every page over the whole notebook. Tap a
  page to open it; the button again, or Escape, goes back. Pages drag to
  reorder here too.
- **Work on several pages together** in that grid: tap Select (or
  Shift/Cmd-click on a computer), tick pages, then move them to the start or
  end, duplicate, bookmark, export or delete them, or drag them as one block.
  Deleting asks first, and each action is one undo step.

- **Saved pens.** Keep up to eight pens, each with its own type, colour and
  width (the highlighter too), and pick one from the star in the pen's
  options or with the keys 1 to 8. Change, reorder and delete them in
  Settings → Pens and shortcuts, or save the pen in hand there or from the
  star. A fresh install has blue, red and green, a broader blue, black, a
  fine black, a purple brush and a yellow highlighter (FineNotes#24, #25).
- **Type a stroke width.** The stroke width popover takes a width in mm,
  from 0.20 to 5 mm, to a hundredth (FineNotes#24).
- **Shortcuts for pen tablets and keyboards** (FineNotes#25). A held key
  lasts for that one stroke, and none of them act while you type:
  - hold Shift while writing to erase, with the eraser's own settings;
  - hold Ctrl (Cmd on a Mac or an iPad) while writing to lasso;
  - hold Alt (Option) and draw up to zoom in, down to zoom out, about the pen;
  - Ctrl/Cmd+A selects everything on the page, and Delete then clears it in
    one undo step;
  - W picks the pen, as P does, and L the new laser pointer.
- **Laser pointer.** A red trail that fades behind the pen, for pointing at
  a page; nothing it draws is kept. Press L, or pick it in the pen type
  menu (FineNotes#25).
- **Stylus buttons.** A tablet pen's eraser end erases, and its side button
  erases, lassos, moves the page or does nothing, as set in Settings → Pens
  and shortcuts. Neither opens the right-click menu (FineNotes#25).
- **Move the page from beside it.** With a pen or a mouse, drag in the
  margin or the gutter beside the pages to scroll, with a fling, as a finger
  does (FineNotes#25).
- **A crosshair cursor** over the page while a pen, the highlighter or the
  laser is in hand, on a computer. It can be switched off in the settings
  (FineNotes#25).
- **Pick a colour from the page.** Every colour picker (pen, highlighter,
  shapes, text, a text box's fill, and the lasso's Colour) has an
  eyedropper: tap it, then tap the page with the Pencil, a finger or the
  mouse. A tap on ink, a shape or a text box takes that element's own
  colour; anywhere else (the paper, a picture, a PDF page) the colour under
  the tap. A loupe shows the colour before you lift, and the colour is kept
  with your recent ones. With dark pages on you still get the true colour,
  not the darkened one you see. Escape, ✕ or a tap off the page cancels,
  and a text box being edited stays in editing. On a computer, "From
  screen" picks a colour from anywhere on the screen.
- **See the shortcuts without leaving the notebook.** Press ? (or pick
  "Keyboard shortcuts" in the notebook's ⋯ menu, or the command "Show
  keyboard shortcuts", which can have its own hotkey) for a pop-up with
  every keyboard and stylus shortcut, grouped as in the settings. ?,
  Escape or a tap outside closes it.

### Changed

- **Notebooks open with the pen you last wrote with**, in any notebook and
  after a restart: its type, colour and width (FineNotes#24).
- **Settings sections fold.** Tap a section's heading to fold or unfold it;
  the settings remember which are open, also after a restart. At first only
  "Writing and tools" is open. Search still finds every setting, and opens
  the section of the one you pick.
- **A clearer shortcut list.** "Keyboard and stylus shortcuts" is grouped
  (tools, pens, selection and editing, view and zoom, stylus), with each key
  drawn as a key cap in Obsidian's own style: ⌘, ⌥ and ⇧ on a Mac or an
  iPad, Ctrl, Alt and Shift elsewhere. It starts folded; tap its row to
  show it.
- **The saved-pens star moved to the far right of the pen's options**, after
  the auto-shape switch: the pen, widths and colours come first.
- **A highlight drawn along a line becomes a straight line** when you lift
  the pen, from where you started to where you stopped, however your hand
  wavered, as in GoodNotes. While you draw, the highlighter follows your
  hand like any pen; a curve, a corner or a zigzag over several lines stays
  exactly as drawn. "Straighten highlighter strokes" (on by default).
- **Each pen keeps its own width**, as it keeps its colours: a wide
  highlighter and a fine fountain pen stay that way when you switch between
  them. A pen you have not set a width for starts with the one in hand.
- **The lasso edits text, as in GoodNotes.** Tap a text box with the lasso
  (Pencil or finger), or with a finger whatever pen is in hand (the lasso is
  then picked): the box shows its handles and its text options float beside
  it, with no keyboard. Colour, size, font, fill, border, lists and delete
  act on it straight away. Tap it again to type, the lasso still in hand;
  hiding the keyboard keeps it selected. Tap beside it to let go, and the
  pen comes back if it was the pen you came from. The Text tool is for
  making new boxes.
- **Pens write over text boxes.** With a pen, the eraser or a shape, the
  Pencil no longer opens a box's keyboard, and links in boxes still open on
  a tap.
- **The text options float by their box**, as GoodNotes' text bar does:
  under a selected box, over a box being typed in, and on the other side
  when there is no room, following the box as the page scrolls or zooms.
  Without a box it is back under the tool bar.
- **The box you type in stays in view**: the page scrolls it above the
  keyboard when the keyboard comes up, changes height or the text grows,
  with room for the text options over it. With a floating or small keyboard,
  or a hardware one, it still rises into the top part of the screen.
- **"Drag to size text boxes" moved to Settings** (Writing and tools), out
  of the text pill: it is a way of working, set once, not a style of a box.
- **A finger tap on a picture selects it**, whatever pen is in hand: the
  lasso is picked and the picture shows its handles to move, resize and
  turn it. The Pencil keeps writing over pictures as before.
- **The eyedropper reads more of the page.** On a text box it picks the
  border's colour on the border, the fill's between the letters and the
  text's on the text; ink showing through a box gives the ink's colour.
  Ink of every pen type, the highlighter included, gives its own colour.

### Fixed

- **The pen button picks the highlighter when that is your pen type.**
  Coming back to the pen (from the lasso, text, the eraser) with the
  highlighter chosen wrote ordinary pen ink in the highlighter's colour:
  solid bands that hid the letters, and never straightened. It now writes
  highlighter strokes, which multiply over ink, typed text and PDF pages so
  everything under them stays readable, and straighten on lift.
- **A selected text box's options step aside while the page moves**, as in
  GoodNotes: a real scroll or zoom fades them out, and they fade back in by
  the box once the page has settled, if the box is still in view (at least
  half of it). A nudge (under 24 screen px, or a pinch under 6 %) leaves
  them by the box. With the Text tool pinned they stay, under the tool bar.
- **A text box scrolled out of sight lets go of its frame**, as in GoodNotes:
  once no part of it shows, its frame, its options and the keyboard go, and
  scrolling back does not bring them back. The box is remembered, though:
  tap it again, without changing tools or tapping anything else first, and
  you are typing in it straight away. A tap anywhere else (which also brings
  back the tool you had before the lasso), another tool, an undo, going to
  another page or a reload forgets it, and a tap selects it first again.

## [2.1.0] - 2026-10-13

### Added

- **Feedback and community** in the settings: open Discussions for ideas and
  questions, report a bug, and follow FineNotes on X, Instagram, TikTok and
  YouTube. The links open in your browser; nothing is sent from the plugin.
- **The highlighter snaps to a PDF's text.** Start a highlight on the words
  of a PDF page and it covers whole words, line by line, as neatly as in a
  PDF reader; start it anywhere else and it draws freehand as before. A
  scanned page without text stays freehand.
- **Copy the text you highlighted.** After a highlight snaps, Copy puts its
  words on the clipboard. Lasso any highlight on a PDF page and its menu has
  Copy text, and the command "Copy highlighted text on this page" copies all
  of them at once.
- **Embed a notebook page in any note.** `![[Physics.notebook#page=3]]`
  (or `#Page 3`, `#p3`, as "Copy link to page" writes it) shows that page,
  paper or PDF slide, pictures, text and ink, at the note's width, in reading
  view and live preview. `|300` sets a width. Tap the page to open the
  notebook there. `![[Physics.notebook]]` shows the first page and opens the
  notebook as any link does. It follows the notebook as you write, and a page
  that does not exist shows as a plain link.
- **Hold a finger on the page for Paste, Text box and Select all**, with any
  tool, as in GoodNotes. Paste puts ink you copied with the lasso, a picture
  or text from another app where your finger was. On the iPad, the system
  may ask you to tap its own "Paste" first. On a computer, right-click the
  page; Cmd/Ctrl+V now also pastes copied text as a text box.
- **Import notebooks from Goodnotes and Notability (beta).** "Import from
  another app…" in the New notebook dialog, or "Import notebook (beta)…" in
  a folder's menu, turns a `.goodnotes` or `.note` export, or a backup
  `.zip` of them, into FineNotes notebooks: pages, PDFs, ink, text and
  pictures. You can pick several files at once. The files you import from
  are not changed; check the notebook afterwards, since neither app
  publishes its format.
- **New sliders** for the pen width and the eraser size, with a preview of
  the size.

### Changed

- **Tool options come back the way you left them.** Tuck the pen's options
  away, pick the eraser, and the pen returns with its options still tucked
  away, whether you tap it or it comes back on its own after one use. Each
  tool remembers this for itself.
- **Headings inside a page stay with their page.** In the Contents tab, a
  page added to the contents folds away the headings inside it; headings
  inside a page without a title are listed on their own. Neither nests under
  the title of an earlier page any more.
- **Reading handwriting on the device is marked as a beta**, in Settings,
  in the AI menu and above what it reads: it misreads some words, so check
  the text before relying on it.
- The "Read handwriting on this device" setting names the model it uses:
  Grape (handwriting recognizer model).
- **Saving no longer pauses your writing in long notebooks.** Only the pages
  you changed are prepared again, and the file is compressed in the
  background, so a save costs about the same in a 200-page notebook as in a
  10-page one.
- **Long notebooks are lighter.** They open about twice as fast, the page
  sidebar lets go of thumbnails you have scrolled past, and erasing and
  searching no longer slow down as a notebook grows.

### Fixed

- A notebook of a few hundred pages no longer reopens read-only after it
  saved without trouble.

- Links in a notebook, handwritten or typed in a text box, keep working
  when the note or heading they lead to is renamed or moved. Obsidian
  updated them in the notebook's links list, but the notebook's next save
  put the old name back; now the notebook takes the new name from the list
  when it next opens, or at once if it is open.
- Reading handwriting on the device no longer makes Obsidian restart over
  and over on some iPads. A short level line, such as a minus sign or a
  fraction bar, could take all of the memory (#22).
- A page whose reading took the app down, failed or timed out is no longer
  read again at every start or after every edit; it waits until you change
  it.
- Reading a page with thousands of strokes is much faster.

## [2.0.0] - 2026-10-12

Thank you for all the feedback and support. FineNotes has passed 500
downloads and 100 installations, and this is its biggest update yet.

### Grape: handwriting recognition on your device

FineNotes now includes **Grape**, its own handwriting recognition model. It
runs locally, on your iPad or computer, offline: your handwriting never
leaves the device, and no account or API key is needed.

- **Search finds your handwriting.** A few seconds after you stop writing,
  the page is read and its text goes into the notebook's text layer, so
  notebook search and Obsidian's search find it.
- **Grape gets much better when it learns your handwriting.** Choose "Teach
  it your handwriting" in the AI menu: FineNotes makes a practice file with
  lines to copy (about 8 minutes), then learns from it on your device in a
  few minutes, in the background. It keeps the result only if it reads your
  own test lines better. On the developer's handwriting it went from 18 % to
  6 % of characters wrong. There are three sets of practice lines, and each
  set you write makes it better.
- **Titles and links from your ink.** "Add to contents" and "Link to…" fill
  in the lassoed heading or word as Grape reads it.
- **Handwritten `[[links]]`.** Write `[[Note]]` by hand and it gets a dashed
  underline; tap it with a finger to make it a link.
- **The AI menu starts with it.** The sparkles button now opens on
  "Handwriting · on this device": read this page, and learn your
  handwriting.

Grape is a work in progress. It still needs more training on more real
handwriting, which is now what holds it back most. It is open source under
the Apache License 2.0, and published on its own at
[Joost-8/Grape](https://github.com/Joost-8/Grape). Because the model is built
into the plugin, FineNotes is a larger download than before (about 6 MB).

### Added

- **Tools for lined paper**, after Stylus Labs Write
  ([#20](https://github.com/Joost-8/FineNotes/issues/20)). They work on
  ruled, legal, Cornell, column, margin, to-do, title, handwriting and
  meeting-notes pages; on other pages they fall back to the normal tool and
  say so.
  - **Erase by line**, a third eraser mode. A pass along a line erases
    whole words as far as it goes, with their commas, full stops and i-dots,
    and never touches the line above or below. A pass down the margin
    erases whole lines.
  - **Select by line**, a third lasso type. Drag from one word to another,
    as you select text: the rest of the first line, every line in between,
    and the last line up to the pen. The highlight runs from rule to rule.
  - **Insert space.** With Select by line, a small up-and-down arrow sits
    in the margin of every line. Drag one down to push that line and
    everything below it down by whole lines (pictures, text boxes, shapes
    and highlights included), or up to close empty lines. Ink pushed past
    the bottom flows onto the next page, or onto a new page with the same
    paper. One undo puts it all back.
- **Headings inside a page, in the contents.** Lasso a heading and choose
  "Add to contents" (in the selection's ⋯ menu) to list it in the Contents
  tab, under its page's title; a ribbon marks it at the page's left edge.
  Tap it to go to that line. Headings fold away under their page title.
- **Handwritten links.** Lasso some ink and choose "Link to…": a note, a
  heading in it, or a web address. The ink gets an underline; tap it with a
  finger to open the link. Links show up in Obsidian's backlinks and graph.
  A linked word is erased whole, never in part.
- **Links in text boxes.** Type `[[Note]]`, `[[Note|shown text]]`,
  `[label](https://…)` or a web address in a text box; when you are not
  typing in it, each link shows underlined and opens on a tap.
- **An icon for each pen.** The fountain pen, ballpoint, brush and
  highlighter each have their own icon, with the tip in your ink colour,
  and the width buttons are drawn as that pen writes: tapered for the
  fountain pen, even for the ballpoint, lifting off for the brush, a flat
  band for the highlighter.
- **Five pen colours that stay.** The pen's colour row has five swatches,
  and a colour you pick stays in it. The default ink colour and your own
  colours from the settings keep their place at the front.
- **Any eraser size**, from a fine tip to a wide band, with a slider next
  to the eraser's three sizes. Thanks to
  [@OskarRabenda](https://github.com/OskarRabenda).
- **Double-tap with two fingers to undo, with three to redo.** Switch it off
  under "Double-tap with fingers to undo and redo". Thanks to
  [@OskarRabenda](https://github.com/OskarRabenda).

### Changed

- **FineNotes is now licensed under the GNU General Public License v3.0 or
  later** (it was MIT). The bundled handwriting model, Grape, stays under the
  Apache License 2.0.
- **Settings by theme**: writing and tools, pages and notebooks,
  handwriting, AI with your own key, advanced, and support. The notebook's
  settings (the gear in the toolbar) end with a button to all of
  FineNotes' settings.
- **The AI features that need an API key stay out of the way** until you
  set one up: in the AI menu they fold into one row, and in the settings
  into one "Set up an AI service" row.

### Fixed

- Typing in a text box low on a notebook's cover no longer hides it under
  the iPad's keyboard: the page moves up, as on other pages.

## [1.5.0] - 2026-10-07

### Added

- **A table of contents for notebooks.** Give a page a title with "Add to
  contents" in the ⋯ panel or in a page thumbnail's menu. Titled pages are
  listed in a new Contents tab of the page sidebar, between Pages and
  Audio: tap an entry to go to its page, and the section you are reading is
  marked as you scroll. Titles move and delete with their pages, undo brings
  them back, and a duplicated page starts without one.

### Changed

- **Smoother writing on iPads that round the Pencil's position.** Before
  iPadOS 26.2, an iPad reports the Pencil's position in whole pixels, which
  made lines wobble and loops lumpy. FineNotes now places each point of a
  line using the points on both sides of it, so loops come out round and
  lines straight; the last few millimeters of a line settle a moment after
  you draw them. iPads that report exact positions draw exactly as before.
  ([#1](https://github.com/Joost-8/FineNotes/issues/1))

## [1.4.0] - 2026-10-06

### Added

- **Finer pens.** The stroke width slider now goes down to 0.20 mm for
  the pens and the Shape tool, in 0.05 mm steps below the thinnest preset.
  The highlighter still starts at 0.41 mm. Very fine lines look grey on a
  low-resolution screen until you zoom in.
- **Hold space to move the page.** On a computer, or an iPad with a
  keyboard: while you hold the spacebar, the pen and the mouse move the
  page instead of writing. A stroke you are already drawing finishes first,
  and space still types a space in a text box.

## [1.3.0] - 2026-10-06

### Added

- **New notebook from a PDF.** A PDF's menu in the file explorer has "New
  notebook from PDF": a notebook next to it, one page per page of the PDF,
  to write on. The PDF itself is never changed. Also a command, "New
  notebook from a PDF in the vault…".

### Fixed

- **Notebooks follow the PDFs, pictures and recordings you move.** Moving
  or renaming an imported PDF (or the folder it is in) left its pages blank
  as "Missing PDF source". Notebooks now point at the new place: open ones
  at once, closed ones are updated in the background, so the fix reaches
  your other devices too. Files moved before this update, or outside
  Obsidian, are not followed. A PDF that comes back to its old place, or
  syncs in late, now shows without reopening the notebook.

### Changed

- **Imported PDFs go to the notebook's image folder.** The notebook
  settings row is now called "Images and PDFs", which is where imported
  PDFs were already saved. Left empty, they follow Obsidian's "Default
  location for new attachments".

## [1.2.0] - 2026-10-05

### Added

- **Keyboard shortcuts work after writing.** Writing moved the keyboard's
  focus off the notebook, so Ctrl/Cmd+Z and the other shortcuts stopped
  working until you clicked the page. They now work whenever the notebook
  is the active tab, and Ctrl+Y also redoes. Text fields keep their own
  shortcuts.
- **Drag the scroll indicators.** On a computer, the scroll indicators at
  the right and bottom edge can be dragged to scroll directly. On a tablet
  they stay a readout, so a hand resting on the edge of the page never
  grabs them.
- **Return to the pen.** Two optional settings, both off by default, for
  the eraser, lasso, text and shape tools: picking the active tool again
  goes back to the pen or highlighter you used before, and "Return to pen
  after one use" goes back after one eraser stroke, one shape, one text
  edit, or once you are done with a lasso selection (a click outside it, or
  deleting or cutting it).

### Changed

- **Gentler mouse-wheel zoom.** One notch of a stepped mouse wheel with
  Ctrl/Cmd held zoomed by more than 3x, so two notches went from the
  smallest zoom to the largest. Each notch is now at most 15%, and a notch
  back undoes it exactly. Trackpad pinching is unchanged.
- **Small SVG pictures stay sharp.** An SVG under 64 KB is drawn from its
  vectors, so it stays sharp at any zoom.

### Fixed

- **The page sidebar works while zoomed in.** In a notebook whose pages run
  sideways, tapping another page in the sidebar while zoomed in only moved
  around the page you were on. It now goes to that page, at the same zoom.
- **The lasso's colour menu fits on screen.** With the custom colour picker
  open, the menu ran off the bottom of the screen and its last controls
  could not be reached. It now stays on screen and scrolls.

Thanks to [@Suzkapu](https://github.com/Suzkapu) for the keyboard
shortcuts, the scroll indicators, the return-to-pen settings, the wheel
zoom and the SVG drawing.

## [1.1.0] - 2026-10-03

### Added

- **Insert PDF.** A new toolbar button beside Insert image: pick a PDF from
  your files or from the vault, then import all its pages or a range such as
  `1-3, 5` (in the order you type it). The pages go in after the current
  one, with the PDF as their background, and one undo takes them all out.
  A PDF already in the vault is used as it is, not copied. This replaces
  "Scanned PDF from Files": a PDF from the Files app's Scan Documents goes
  in through Insert PDF now.
- **Drag and drop.** Drop pictures or a PDF onto a notebook, from your
  computer or from Obsidian's file list. Pictures are placed like Insert
  image; a PDF opens the page choice.
- **New notebook from the file explorer.** Right-click (long-press on the
  iPad) a folder and choose New notebook to create one there. An optional
  New notebook button beside New note and New folder can be turned on in
  settings.

### Changed

- **Exported PDFs keep the original PDF.** Pages with a PDF background now
  export with the PDF's own text and graphics, sharp and selectable, with
  your writing on top. Other pages export as before.
- **Sharp PDFs while you move.** PDF pages are now drawn in the background,
  away from the pen and the scrolling, so writing and panning stay smooth
  while a page is being drawn. Zoomed in past 2.5x, the page is drawn sharp
  in small tiles that fill in while you pan, nearest the middle of the screen
  first and a little ahead of where you are going, so small print stays
  crisp instead of going soft until you stop. Where background drawing is
  not available, FineNotes draws as before.

Thanks to [@Suzkapu](https://github.com/Suzkapu) for Insert PDF, drag and
drop, New notebook from the file explorer and the PDF export, and for the
zoomed-in PDF rendering the background tiles grew out of
([#5](https://github.com/Joost-8/FineNotes/pull/5)).

### Fixed

- **Writing over a PDF stays smooth while a page is being drawn.** Drawing
  a PDF page already paused for the pen, but only if it had not started yet;
  one already under way kept interrupting the ink. It now waits until you
  lift the pen.
- **PDF pages no longer go blank while zooming.** After a zoom, a PDF page
  showed as empty white paper until it was drawn again at the new size,
  which takes a second or more on an iPad. It now keeps showing the page as
  it was until the sharper version is ready.
- **Smoother writing on older iPads.** Before iPadOS 26.2, the iPad rounds
  the Pencil's position to a whole screen pixel before Obsidian sees it, so
  lines came out wobbly and loops lumpy. FineNotes now smooths the Pencil's
  path when its positions arrive rounded, as 1.0.1 did. iPads that report
  exact positions draw exactly as before.
  ([#1](https://github.com/Joost-8/FineNotes/issues/1))

## [1.0.3] - 2026-10-01

### Added

- **Clouds.** Draw a bumpy cloud in one stroke and hold the Pencil still: it
  snaps to a clean cloud the same size, with bumps all the way round, the
  biggest on top.

### Changed

- **A star drawn in one stroke becomes a star outline.** Draw a star the
  quick way, with its lines crossing, and hold: it snaps to the star shape,
  without the lines inside. Hand-drawn stars also snap far more reliably:
  before, only the neatest ones did.

### Fixed

- **Short arrows snap.** Drawing a line, going back a little way along it and
  holding now makes an arrow on short lines too. Before, the way back had to
  be at least 40 px, so short arrows stayed as ink, became a plain line, or
  became a thin triangle.
- **Strokes no longer break apart when the Pencil's contact flickers.** Now
  and then the iPad reports a light Pencil as lifting and landing again
  within a few milliseconds. Each flicker started a new stroke, so letters
  got gaps and dots, and a line got a step in it. A pen that lands again that
  quickly, where it lifted, now carries on the same stroke.
- **Writing in a notebook with a long PDF no longer slows down and skips.**
  With the page sidebar open, a PDF notebook kept redrawing its pages and
  thumbnails over and over, even when nobody touched it, and the pen
  stuttered. It now draws each PDF page once, at the size it is shown.
  ([#1](https://github.com/Joost-8/FineNotes/issues/1))
- **No more stutter while you write in a big notebook.** The notebook used to
  be saved every two seconds while you were writing, and saving a big
  notebook takes a moment. It now waits until the pen has been off the page
  for a second, and each save is about twice as fast. Nothing goes unsaved:
  closing the note, switching apps or 20 seconds of non-stop writing still
  saves at once.
- **Smoother writing on iPads with iPadOS 17 or older.** Before iPadOS 18.2,
  the iPad reports the Pencil only once per screen refresh, and any moment
  the app was busy turned into a straight line in the ink. Besides removing
  those busy moments, FineNotes now fills in a smooth curve between the
  Pencil's positions on these iPads. Newer iPads, which report every
  position, draw exactly as before.

## [1.0.2] - 2026-09-30

### Changed

- **Writing is smooth and steady, as in Goodnotes.** Ink used to bend into
  new curves after it was drawn: the end of every stroke was redrawn on each
  frame, and the pen's predicted path, which the iPad guesses wrong at every
  turn, drew hooks and needles that vanished a moment later. Strokes are now
  drawn by a new ink engine that only ever adds to the line, and nothing is
  drawn ahead of the pen. In screen recordings, FineNotes redrew 38% of the
  ink it drew and Goodnotes 1.5%; on test handwriting the new engine redraws
  1.7%.
- **Pressure is now an advanced setting, off by default.** Every pen draws an
  even line, the width you choose. Turn on **Pressure-sensitive pens** in the
  settings for Fountain and Brush pens that widen as you press. Notes written
  with pressure are drawn at the pen's full width while it is off, so they may
  look a little bolder; pick a smaller width if you prefer.

### Fixed

- **Strokes no longer start with a blob, and dots are as wide as the line.**
  At a light Pencil touch every stroke began as a round dot about twice the
  line's width, and an i-dot or full stop stayed that fat.
- **A resting hand no longer leaves the page moved.** If your palm touches
  down before the Pencil and nudges the page, the page goes back where it
  was the moment the pen lands. Fingers scroll and pinch exactly as before.

## [1.0.1] - 2026-09-26

### Fixed

- **The highlighter is back in the pen menu.** Tap the nib at the start of the
  pen options and choose **Highlighter**. Since 0.1.2 the menu offered only
  the three pens, so without a keyboard (press **H**) there was no way to it.

### Changed

- **The README explains how to use FineNotes**, tool by tool, and the plugin's
  description now says what people search for: handwriting, Goodnotes, iPad.
- **Two stylesheet details the plugin review flagged:** the width slider's
  wedge is drawn as a small SVG instead of with a clip path, and the
  reduced-motion rules no longer need `!important`. Nothing looks different.

## [1.0.0] - 2026-09-26

The first public release, as FineNotes.

### Changed

- **GoodObsidian is now FineNotes.** Obsidian's plugin directory does not allow
  "Obsidian" in a plugin's name, so the plugin has a new name and id
  (`finenotes`). Your notes open exactly as before.
  - The first time FineNotes starts, it picks up your settings from GoodObsidian.
  - Custom hotkeys have to be set again: Obsidian ties them to the plugin's id.
  - If you installed GoodObsidian with BRAT, add `Joost-8/FineNotes` instead, and
    remove the old plugin once FineNotes is running.

## [0.10.0] - 2026-09-25

The groundwork for the public release: every part of GoodObsidian that still
came from InkedMark, the plugin it started from, has been rewritten. Notes,
settings and keys carry over unchanged.

### Removed

- **Handwriting blocks inside ordinary notes.** The ` ```goodobsidian `
  blocks (and InkedMark's ` ```inkedmark ` ones) are no longer drawn or
  edited; an existing block now shows as a code block, with its data intact.
  The **Insert inline handwriting** command is gone. Handwriting lives in
  notebooks and single pages, and a link can point straight at a page.
- **The ink preview in embeds.** `![[Notes.notebook]]` now shows as an
  ordinary note embed. The old preview drew every page on top of each other.
- **On-device recognition** (TrOCR), the experimental desktop-only
  recognizer. A vault that had it selected falls back to Manual.
- **Obsidian before 1.13.** GoodObsidian now needs Obsidian 1.13 or later.

### Fixed

- **Transcribing no longer touches your own text.** Writing a transcription
  into a note used to squash every run of blank lines in the rest of the
  note to one; only the transcription block and its edges change now.
- **Automatic transcription with your own server.** It only ever started
  after you had agreed to send pages to a _cloud_ service, so with a
  self-hosted endpoint it never ran. It now asks the same question the
  consent prompt does.

### Changed

- **Clearer wording** for command names, notices, error messages and the
  settings' descriptions, and a reworded transcription prompt. Command ids are unchanged, so your hotkeys
  keep working.
- **Settings follow the plugin through a change of id.** If the plugin is
  ever installed under a new id, its first start picks up the settings saved
  under the old one.

## [0.9.0] - 2026-09-25

A new look, before the public release: GoodNotes' layout with a calmer,
Notability-like finish, in the colours of whatever Obsidian theme you use.

### Changed

- **A quieter toolbar.** The bar is your theme's own surface with a thin
  line under it, not a block of accent colour, and its icons are grey line
  icons. Only the tool you are using lights up in your accent colour.
- **The writing tools sit in the middle.** Pages, search and AI are on the
  left with Undo and Redo; lasso, pen, eraser, text, shapes, image and the
  microphone are centred; Add page, Share, ⋯ and the notebook's settings
  are on the right. On a narrow pane the tools simply follow the left
  group.
- **The options bar slides away.** Tap the active tool again and its
  options slide up behind the toolbar; tap it once more and they slide
  back.
- **Rounder, lighter panels.** Popovers, menus, sheets and dialogs have
  softer corners, a hairline edge and softer shadows; selected controls sit
  in neutral wells, the chosen one ringed in your accent.
- **The page counter reads "2 of 12".**
- **"Pin Text tool" is labelled again** in the text options (the label
  gives way to the icon on a narrow pane).

### Added

- **A new custom colour picker.** Pick the shade from a square and the hue
  from a slider, see its hex value, and add it with one tap. "More colours"
  in the pen options is now a "+".
- **Bookmark from the page sidebar.** Every page shows a ribbon at its top
  right; tap it to bookmark the page, tap it again to remove the bookmark.

### Fixed

- **iPad: toolbar and options at their real size.** Obsidian pads every
  plain button 20 px a side on the iPad, which made each toolbar button
  60 px wide and the pen and eraser options far wider than designed.
- **The audio player's scrubber** was a thin 6 px strip only 100 px wide; it
  now spans the player with a fingertip-tall target.
- **The page sidebar's filter chip** takes your accent colour; it was always
  purple.
- **Colour swatches in the pen options** were ovals; they are discs again.
- **Small buttons are easier to hit:** a thumbnail's ⌄, the sidebar's ✕, a
  recording's remove button and the edit button on handwriting in a note
  now take a fingertip-sized tap without looking bigger.

## [0.8.1] - 2026-09-25

### Added

- **Choose where PDF exports go.** The toolbar's settings button (the
  gear) has a new **PDF exports** row: pick or type a folder and this
  notebook's exports are saved there, the folder made on the first export
  if it is not there yet. Left empty, they go next to the note, as before.
  The Export as PDF dialog says where the file will go.
- **An Exports folder for new notebooks.** "Create a folder for it" in the
  New notebook dialog now makes an **Exports** folder next to Images and
  Recordings, and the notebook's PDF exports go there.

### Fixed

- **Scribble to erase works on longer words.** A scribble with slanted
  strokes moving across a word — the usual way to scribble something out —
  was often left as ink over a longer word ("whats", "chimey" in the test
  recording). It now erases, and so does a sawtooth scribble (up at a
  slant, straight back down), which could be taken for loops.

## [0.8.0] - 2026-09-25

A round of polish after a close look at what makes GoodNotes feel smooth.

### Added

- **Back where you left off.** A notebook reopens on the page you were
  reading, at fit zoom, on each device. Back and Forward return to the page
  you were on too.
- **Page jumps glide.** Going to a page (thumbnails, search, Go to page,
  Page Up/Down) slides there in the same short time however far it is.
- **Undo shows what it undid.** If the change was on a page you cannot see,
  the notebook glides there first. Undo and Redo grey out when there is
  nothing to undo or redo.
- **Quieter page.** The page counter, the zoom level (new: "81%", where
  100% is real paper size) and thin scroll bars appear while you scroll or
  zoom, then fade away.
- **The page sidebar slides** in and out, and the page moves beside it.
- **The toolbar moves.** Buttons dip when pressed, the options bar glides
  to its new width when you change tools, and menus fade in.
- **Text boxes: tapping beside one keeps it selected.** The first tap
  outside stops typing but leaves the box selected, with its handles; the
  next tap lets it go.
- **The lasso keeps its loop.** The selection is outlined by the smoothed
  loop you drew, not only a box, and the outline moves with it.
- **Tap your colour again to change it.** The chosen colour wears a small
  ▾; tapping it opens the colour picker for it.
- **Stroke widths in millimetres,** and **More widths** has a slider over
  the whole range and a reset to your default width.
- **Copy link to page** in a thumbnail's menu, the ⋯ panel and the command
  palette: a link that opens the notebook on that page.
- **Arrow keys** scroll up and down with a keyboard attached.
- **Ink outside the page.** A stroke that runs well off the page (where it
  is kept but cannot be seen) says so, with an Undo button.
- **Frosted controls.** The page counter, zoom level and popovers let the
  page show through, blurred.

### Fixed

- Opening the page sidebar or rotating the iPad while zoomed in no longer
  jumps to a different place in the notebook.

## [0.7.4] - 2026-09-25

### Added

- **Any colour, everywhere.** Every colour choice — pen, highlighter,
  shapes, text colour, a text box's fill and the lasso's recolour — opens
  a picker with 26 common colours, your recent custom colours, and
  **Custom colour…**: mix one from red, green and blue with three sliders
  and tap **Use**. The pen toolbar has a colour wheel next to its three
  quick colours for it.
- **Shape colour.** The Shape toolbar has its own colour (a black disc
  until you pick another), so shapes and tables no longer take the pen's.
- **Auto shape for the pen.** A new toggle at the end of the pen toolbar:
  with it on, a stroke that is plainly a shape (line, rectangle, circle,
  triangle, arrow…) turns into a clean one as you lift the Pencil — no
  need to hold or to switch to the Shape tool.
- **Pen gestures**, as in GoodNotes: open the pen's menu (tap the pen in
  the toolbar) and choose **Pen gestures**.
  - **Scribble to erase**: scribble back and forth over writing with the
    pen and it is erased, scribble and all. One undo brings it back. A
    scribble over empty paper stays as ink.
  - **Erase shapes and highlighter**: the scribble takes shapes, tables
    and highlighting too, not only handwriting. Off by default.
  - **Circle to lasso**: draw round something with the pen, then hold the
    pen on the line you drew. The loop disappears, what it enclosed is
    selected, and you can drag it straight away with the same pen.

### Fixed

- iPad: typing a page number in the ⋯ panel's **Go to page** no longer
  happens under the keyboard, and the notebook behind no longer goes black.
  The panel rises just enough to keep the field above the keyboard.

## [0.7.3] - 2026-09-24

### Fixed

- **No more white line under a notebook cover**, on the page or in its
  thumbnails. The page's shadow was drawn with a white band that showed
  under any coloured page.
- **Shapes when zoomed in.** A small drag with the Shape tool no longer
  turns into a tap that drops a huge shape; a tap places a shape (or a
  table) that looks the same size on screen at any zoom.
- **Shapes have clean corners.** Rectangles, triangles, stars and tables are
  drawn as exact lines, without the notches that showed at their corners
  when zoomed in.
- **Writing when zoomed in.** Strokes no longer end (or start) in a round
  blob: the Pencil's lift was read as a firm press. Small handwriting keeps
  its shape, because the pen is sampled finely on screen rather than on the
  page.
- **Zoomed in, the eraser, hold-to-snap and the Shape tool's recognition
  work as they do at normal zoom.** The eraser stays the size you chose on
  screen instead of growing with the page; slow writing no longer snaps
  into a shape; a shape drawn small on the page while zoomed in is
  recognised.

## [0.7.2] - 2026-09-24

### Changed

- **Export as PDF shows the pages.** All pages shows every page as a
  thumbnail, like the page sidebar, in a grid you can scroll; This page
  shows the page large. Choose pages lets you tap pages to tick or untick
  them (Select all and None too), and **the order you tap them is the
  order they come out in the PDF** — each ticked page shows its number.
  Typing pages still works, in the same order: `5, 1-3` puts page 5 first
  and `3-1` runs backwards. Tapping a page under All pages switches to
  Choose pages without it.

### Added

- **Delete a text box** from the text toolbar: while a box is being edited,
  the red bin at the end of the toolbar deletes it, text and all. Undo
  brings it back.

### Fixed

- The page field in the Export as PDF dialog was three lines tall.

## [0.7.1] - 2026-09-24

### Added

- **Search this notebook** — the search button in the toolbar works now
  (also "Search this notebook…" in the command palette). Type a word and
  every page that has it is listed, with the words around each match; tap
  one to turn to that page. It searches typed text boxes and transcribed
  handwriting: the transcription made with AI → Transcribe, and the
  `.transcript.md` file the transcript server writes next to a note.
  Capitals and accents don't matter, and every word you type must be on
  the page. Handwriting that has not been transcribed cannot be found.
  Searching again starts from your last search.
- **Links to a page.** A link like `[[Biology.notebook#Page 3]]` (or
  `#page=3`) opens the notebook at page 3.

## [0.7.0] - 2026-09-24

### Fixed

- **Erasing part of a shape or a table keeps it straight.** What the eraser
  leaves of a rectangle, line, circle, arrow or table now keeps its sharp
  corners and straight edges; before, the pieces were redrawn as
  handwriting and their corners turned into curves. Shapes already erased
  before this version stay as they are.

### Added

- **Export as PDF**, from the new share button in the toolbar (next to ⋯)
  or the command palette: the whole notebook, the page you are on, or
  pages you choose, typed as `1-3, 5` or `8-`. Pages look exactly as they
  do on screen — paper, PDF slides, pictures, text boxes and ink — at
  about 250 dpi, at their real paper size (an A4 page is A4). The PDF is
  saved next to the notebook, never over an existing file; then Open it,
  or Share it (AirDrop, Mail, Files…) where your device offers a share
  sheet.

## [0.6.3] - 2026-09-24

### Changed

- **New file names.** A new notebook is `Title.notebook.md` and a new single
  page `Title.page.md`, so the file list shows "Title.notebook" and
  "Title.page". Notes made before this version (`Title.ink.md`) still open,
  embed and work as before; nothing is renamed. A page and a notebook with
  the same title in one folder get different names.

### Fixed

- iPad: the ✕ over the Create button in the New notebook dialog is removed
  again whenever it reappears, not only when the dialog opens.

## [0.6.2] - 2026-09-23

### Added

- **Text boxes fit their text**, as in GoodNotes: tap with the Text tool and
  the box starts small, grows sideways as you type, and wraps once it reaches
  the edge of the page. Dragging a box's resize handle gives it a fixed size.
- **Drag to size**, a new toggle in the text toolbar (off by default): with it
  on, a drag with the Text tool draws the new box's size, as before.
- **Create a folder for it**, in the New notebook dialog (off by default): the
  notebook goes in a folder named after it, next to `Images` and `Recordings`
  folders where its pictures and recordings are saved.

### Fixed

- iPad: the New notebook / New page dialog no longer shows a ✕ on top of the
  Create button.
- Reopening a folder picker now shows the folder already chosen in its search
  field, instead of an empty one.

## [0.6.1] - 2026-09-22

### Changed

- **Horizontal notebooks show one page at a time**, as GoodNotes does: the
  next page slides in only while you swipe. Zoomed in, a swipe moves around
  the page you are on and never slides onto the next one; zoom back out (to
  about the whole page) to turn pages again.

### Fixed

- iPad: typing a folder in Notebook settings no longer happens under the
  keyboard. The dialog rises just enough to keep the field above it, the
  matching folders are listed right under the field instead of over the
  toolbar, and the notebook behind the dialog no longer goes black.

## [0.6.0] - 2026-09-22

### Added

- **Bookmarks.** Bookmark a page from the new ⋯ button in the toolbar or from
  a page's ⌄ menu in the sidebar; it gets a red ribbon on its thumbnail. The
  sidebar's "All pages ⌄" chip switches to **Bookmarks only**. A bookmark is
  saved in the note and can be undone; a duplicated page starts without one.
- **A ⋯ panel**, as in GoodNotes, for the page you are on: bookmark, duplicate,
  change template or cover, go to a page by number, clear or delete it. A tap
  or swipe anywhere else closes it.
- **Recordings live in the sidebar**, in a new Audio tab beside Pages, with a
  Record button at its foot. The sidebar also has a header with a ✕.
- **Discard a recording**: the bin on the red recording pill stops it and
  throws the audio away (a recording of 30 s or more asks first).
- **Bullets and numbering** in page text boxes, from a new button in the text
  toolbar. Return continues the list; Return on an empty item ends it.
- A settings gear at the right end of the toolbar. For now it chooses where
  this notebook (or single page) saves its new pictures and its recordings:
  pick any vault folder, or type a new one to be created on the first save.
  An empty row keeps Obsidian's "Default location for new attachments". The
  choice is stored in the note, so it follows it to every device, and it can
  be undone like any other change.
- **Pull past the last page to add one**, as in GoodNotes. Keep dragging past
  the end and a ring fills; let go once it reads "Release to add page" and a
  blank page on the last page's paper is added and scrolled to. One undo
  step. Not on a single page.
- **Horizontal scrolling**, per notebook (the settings gear → Scroll
  direction). Pages sit side by side and turn one at a time: a flick turns
  one page, a slow drag settles on the nearest, and a mouse wheel or trackpad
  settles on a page when it stops. Zoomed in, a page pans freely; zoom back
  out to turn pages again. Pull past the last page sideways to add one.

### Changed

- The text toolbar is smaller (36 px controls, an icon-only pin), and "Text
  styles" is gone from it.
- The lasso's icon sits centred in its button; the recordings ⌄ beside the
  mic is gone (they are in the sidebar's Audio tab now).

### Fixed

- iPad: tapping a text box at fit-to-page zoom no longer shrinks the whole
  page into the strip above the keyboard.
- iPad: the text toolbar's menus no longer open under the keyboard. They fit
  above it, open upwards when there is more room there, and scroll otherwise.
- iPad: a notebook or page created after typing its title in the New
  notebook dialog no longer opens scrolled to the bottom. The dialog now
  guards against the keyboard the way page text boxes do: it lifts
  Obsidian's keyboard-height limit on the app while the title is typed, and
  undoes the scrolling iPadOS does to reveal the field.
- iPad: a swipe on the page no longer opens Obsidian's sidebars or File
  properties. The page now opts out of Obsidian's swipe gestures the way
  Obsidian's own graph view does (`data-ignore-swipe`), which also covers
  swipes that start on a text box.

## [0.5.0] - 2026-09-22

Pictures, typed text that looks like GoodNotes', a real lasso, notebooks with
covers, audio, scanning and AI with your own key. None of it has been tried on
an iPad yet: this release is for exactly that.

### Added

- **A "New notebook" dialog.** The ribbon button and the create command now
  open a sheet like GoodNotes' "Create notebook": name it, choose **Notebook**
  or **Single page**, pick a cover and a paper (size, colour, orientation,
  every template, previewed as they will look) and a folder; Return in the
  title creates it. "Create notebook with last settings" still makes one in a
  single step, and the new setting "Default folder for new notebooks" chooses
  where they go.
- **Notebook covers.** Four designs — plain, label, spine and linen — in
  eight colours. The cover is the first page and the notebook's title sits on
  it as ordinary text you can edit. "Change cover" in the cover thumbnail's
  "…" menu swaps the design or colour and keeps the title readable.
- **Single pages.** A single page offers no "Add page" anywhere; "Convert to
  notebook", in the page menu or the command palette, turns it into a
  notebook when it needs more.
- **Title & Date paper**: ruled paper with printed Title and Date fields
  along the top.
- **Pictures on the page.** The toolbar's image button opens an Insert image
  menu: Photos, Take photo (on the iPad) and From vault. A picture lands on
  the page you are reading, centred in what is on screen, already selected so
  you can place it. It sits above the paper and below the ink, so you can
  write over a photo, and it shows in the page thumbnails. Photos are scaled
  to at most 2048 px and saved where your attachments setting says, so they
  stay small enough to sync. A missing picture keeps its place as a "Missing
  image" box and comes back on its own once the file syncs in.
- **A selected picture handles like GoodNotes.** With the lasso, tap a
  picture: square corners resize it, round handles mid-edge stretch it one
  way, and the knob below rotates it (snapping square near a quarter turn).
  Above it floats Crop | Cut · Duplicate · Delete · "…"; the "…" menu adds
  Front, Back, Copy, Paste, Lock image and Crop image. Each change is one Undo
  step.
- **Crop a picture without touching the file.** Drag the frame's corners or
  edges, or move the frame, then tap Done. Reset brings back the whole
  picture.
- **Cut, Copy and Paste** between pages and notebooks, from the bar or with
  Cmd/Ctrl+C, X and V. Hold the lasso on empty paper to paste right there. A
  copied picture also goes to the system clipboard, and a picture copied in
  another app pastes in.
- **Lock a picture** — a worksheet you write on, say — so the lasso passes
  over it; hold the lasso on it to unlock it. **Front** and **Back** reorder
  overlapping pictures; handwriting and text always stay on top.
- **A GoodNotes text bar.** With the Text tool, the options pill holds colour,
  size, font, bold / italic / underline / strikethrough, alignment (with
  justify), line spacing, box fill, text styles ("Use as default for new text
  boxes", "Reset to default") and **Pin Text tool**. While you type in a box,
  each change applies to that box as its own undo step and is remembered for
  the next box; the keyboard stays up while you tap them. Unpinned, finishing
  a box hands the page back to the tool you had before, as in GoodNotes. The
  fonts are ones every iPad, Mac and PC has, so text wraps the same everywhere.
- **A real lasso.** It is freehand by default — draw round what you want and
  lift — with Rectangular in the lasso's options. One selection can hold
  handwriting, shapes, pictures and text boxes together: drag inside its frame
  to move them all, and one undo puts everything back. Selections get
  GoodNotes' dark action bar: Duplicate, Delete, and "…" for more, including
  recolouring selected ink.
- **Lasso options.** Tap the lasso again for its options: Rectangular or
  Freehand, and switches for Handwriting, Images, Shapes, Arrows and Text
  boxes. Turn Images off to lasso writing on top of a photo without picking up
  the photo.
- **Eraser filters.** The eraser can erase only highlighter, or only pen ink.
  It never erases pictures or text boxes.
- **Stars snap.** Draw a five-point star — as an outline, or in one stroke as
  a pentagram — and hold, or draw it with the Shape tool: it becomes a clean,
  even star the size and angle you drew.
- **Arrows the Apple Notes way.** Draw a straight line, go back a little way
  along it, and hold: it becomes a clean arrow pointing the way you drew. Go
  back a clear distance (at least about 40 px); a short flick at the end of a
  line still leaves a line.
- **More Shape tool shapes**: a star, and GoodNotes' two connectors — a line
  and an arrow you drag from start to end. Tap any of them to drop a
  default-size one.
- **Tables.** Pick Table in the Shape tool, tap a size up to 8 × 8, and drag
  one out on the page, or tap to place a default one. A table is ordinary ink:
  write in it, erase or move its lines, and one undo takes it all back.
- **An AI menu** (the sparkles button), with your own key: transcribe this
  page or the whole notebook, ask about a page or the notebook, generate an
  image, and transcribe a recording. Anything your setup cannot do is shown
  greyed out, with the reason.
- **Ask AI** about your pages, keep asking follow-ups, and copy an answer or
  put it on the page as a text box.
- **Generate an image** with an OpenAI, Google or OpenRouter key — also from
  the image menu. The picture is saved as an attachment and placed on the
  page. Claude users can pick a separate service for images.
- **Scan a document.** "Scan document" in the image menu (or the command
  "Scan document into this notebook") takes a photo of a page. The page is
  found automatically where it can be; otherwise drag the four corners, with a
  magnifier under your finger. It is straightened, cleaned up in Colour,
  Greyscale or Black & white, and lands as a new page after the one you are
  on. "Next page" scans several in one go; one Undo takes the whole scan back.
  On a single page, a photo scan is placed on that page instead.
- **Apple's own scanner, one tap away.** In the Files app, "Scan Documents"
  saves a PDF; "Scanned PDF from Files" in the image menu adds its pages after
  the current one, ready to write on.
- **Record audio while you write.** Tap the mic to record; the recording is
  saved next to the note and listed under the ⌄ beside the mic. Undo takes it
  off the note but never deletes the file. **Recording stops when the iPad
  locks or you leave Obsidian** — a plugin cannot keep the microphone in the
  background — so keep the screen on while recording.
- **Tap your writing to hear it.** Play a recording, then tap any ink written
  during it, on any page, to hear it from five seconds before you wrote it.
- **Transcribe a recording** with an OpenAI or Google key. The transcript is a
  note of its own beside the audio, with the audio embedded and a link back to
  the notebook.
- **Every stroke now remembers when it was written**, which is what replay
  uses.

### Changed

- **Transcription works per page.** Each page gets its own "Page N" heading in
  the text layer, so search lands on the right page; unchanged pages are
  skipped, and a long run can be stopped with a tap. The "Recognize
  handwriting" command now covers the whole notebook.
- **API keys live in Obsidian's keychain** instead of in plain text in your
  vault's plugin data, and your existing keys move there automatically.
  Settings show only whether a key is set, with Replace and Remove. (Needs
  Obsidian 1.11.4; older versions keep the old storage and say so.)
- **Text boxes have their own colour**; new boxes take the Text tool's colour,
  not the pen's. Boxes written before 0.5 now show in the default Sans at 1.25
  line spacing, the same on every device.
- Tapping beside a box you are typing in finishes it; writing with the pen
  finishes typing too.
- Thumbnails show text as it is on the page: font, weight, alignment, line
  spacing, fill and lines.
- New notebooks take their size from the page-size list, so the old "Paper
  width" setting no longer affects them.
- The credit to InkedMark, which GoodObsidian was originally based on, is now
  a short line in the README; its copyright notice stays in LICENSE.

### Fixed

- **Moving a text box puts the keyboard away.** Dragging a box by its handle
  used to leave the iPad keyboard over the page; it now ends editing, and the
  page no longer jumps while the keyboard slides down.
- Clearing one page no longer deletes every page's transcription.
- Undoing a picture's insertion can no longer take away a different picture
  that happens to share its id, and elements saved without an id get one that
  no other element on the page has.

## [0.4.1] - 2026-09-22

### Changed

- **A page opens whole.** The default zoom now shows the entire page,
  centred on the desk, the way GoodNotes opens one; that is also the new
  zoom floor, so pinching out always ends with the whole page in view. On an
  iPad in landscape, 0.4.0 opened at fit-to-width, which showed only the top
  third of a page and could not be zoomed out further.

### Fixed

- **Zooming out quickly no longer drops frames.** While a pinch was in
  flight the renderer kept rasterising tiles at the zoom it was leaving —
  up to 6 ms a frame of work that the settle then threw away — and drew
  dozens of them minified. Mid-zoom it now draws the page's stand-in once
  when that is the closer match, and makes no new tiles until the zoom
  settles. The stand-in is sharper too (1024 px on its long side, was 512).
- **The zoom no longer freezes and snaps after a pinch.** A pinch usually
  ends with one finger still moving, so a fling and the zoom's spring-back
  ran together — except the spring was chained behind the fling and never
  advanced until it stopped, up to two seconds later, then jumped. Both now
  step every frame.

## [0.4.0] - 2026-09-22

Scrolling that moves like the iPad's own.

### Changed

- **A swipe coasts.** Let go mid-swipe and the page keeps moving and slows
  down the way it does in every iPad app, using the same deceleration rate
  as iOS; a harder flick travels further, and touching the page stops it.
  Before, the page stopped dead under the finger, so each swipe moved it
  only a few hundred pixels.
- **Edges stretch and spring back.** Pulling past the top, bottom or a side
  stretches the page a little and lets it snap back, instead of hitting a
  wall. The page can no longer be dragged off the pane.
- **One finger scrolls in any direction** when the page is wider than the
  pane, locking to vertical or horizontal when a swipe starts nearly
  straight, as iOS does. Two fingers still pinch.
- **Scrolling renders at the display's frame rate.** Pages are drawn once
  into cached tiles and scrolled as bitmaps, so a scroll frame no longer
  re-outlines every stroke on screen. The cache is bounded (48 MB, more on
  very large panes) and a tile the frame has no time for is drawn from a
  low-resolution stand-in until the next frame — never as a hole.
- **The page cannot be pinched smaller than the pane.** Pinching past
  fit-to-width (or past 8×) stretches a little and springs back on release.
- **Trackpad and mouse:** the wheel scrolls, Shift+wheel scrolls sideways,
  and Ctrl/Cmd+wheel (a trackpad pinch) zooms about the pointer.
- **Swipes that start on the page stay on the page:** they no longer open
  Obsidian's sidebars or the file-properties pane. (Needs confirming on the
  iPad; see the ledger.)
- The debug HUD now shows the frame rate, paint time, tile cache size and
  scroll velocity, for the next screen recording.

## [0.3.1] - 2026-09-22

The tool-options pill stays put.

### Changed

- **The options pill is pinned directly under the toolbar**, centred over
  the page area, and moves right with the page when the page sidebar opens —
  as in GoodNotes. It is no longer draggable: a dragged-and-remembered
  position (or a stale one) had been leaving it in the middle of the page on
  every device it had once been moved on.
- **The pill is smaller.** Its controls are 36 px instead of 44 px, with
  tighter gaps, so the pen options no longer read as a second tool bar.

## [0.3.0] - 2026-09-21

Triangles, and room for a sloppier hand.

### Added

- **Triangles snap by default.** Skewed quads, pentagons and hexagons stay
  opt-in.

### Changed

- **More wiggle room.** A second recording showed what still refused: lead-in
  ticks and tails of 20–35 px (the pen moving on after a refused hold), a
  square with one corner swung round and a bulging side, a circle with a
  spike in it. The pen-down/lift trimmer now takes up to 30 px (a quarter of
  the stroke) at a 45° turn instead of 70°, and only while the stroke has not
  closed; a rectangle or triangle may have one soft corner beside its sharp
  ones; an edge may bulge up to 11 % of its length; and the confidence floor
  is 0.65. Every stroke from both recordings is a test.
- What stays refused, on purpose: a D or a heavily bowed "sail" (its arc has
  no corner), a trapezoid, and any loop the circle fitter accepts is never
  squared up into a rect.

## [0.2.0] - 2026-09-21

GoodObsidian under its own name everywhere.

### Changed

- **No more InkedMark anywhere in the plugin.** Settings, notices, the
  "What's new" dialog, the support links, the CSS, the icon ids and the
  OpenRouter callback all say GoodObsidian; the support footer now points at
  this project's GitHub issues. The only remaining mention is the MIT
  acknowledgment (README and LICENSE), as that license requires.
- **The note format carries the new name.** New notes are written with a
  `goodobsidian: true` frontmatter flag, a `%%goodobsidian … %%` data block,
  a `<!--goodobsidian-text-->` text section and `goodobsidian` inline
  fences. Notes written by earlier versions (with the `inkedmark` names) still
  open and render; they are moved to the new names the first time they are
  saved, without touching anything else in them. Do not go back to 0.1.x
  after that: it will not recognise the migrated notes.
- The changelog now starts at 0.1.0; earlier history belongs to InkedMark.
  The upstream specification and fork notes were removed from the repository.

## [0.1.9] - 2026-09-21

The recogniser was retuned on the user's own ink, and every basic shape from
the iPad recording now snaps.

### Fixed

- **Circles, rectangles and lines drawn with the Pencil snap.** The ink in
  the iPad recording was traced out of the frames and run through the
  recogniser offline: it refused all of it, including a plain straight line.
  Every tolerance had been set from synthetic strokes, at a quarter of what a
  real hand produces — real circles deviate 6–7 % of their radius, real
  rectangles are slightly trapezoid, a quick line bows 2–3 %. The gates are
  now calibrated on those strokes (kept as a test fixture), a rectangle is
  judged by its four corners rather than by how perfect a box it is, and a
  circle is no longer refused for one pen-down notch.
- **iPadOS Scribble can no longer swallow Pencil strokes** on the page: the
  surface now cancels the underlying touch moves, which is the documented
  way to tell the system a web page owns the stroke.

### Added

- **"Copy shape diagnostics" command.** Saves the last two dozen strokes,
  the pointer stream each one arrived as, whether the hold fired and what
  the recogniser made of the stroke at the hold and at the lift, to a note
  in the vault (and to the clipboard where the platform allows it). Made for
  the iPad, where there is no console: paste the note into a bug report.

### Changed

- The confidence floor is 0.70 (was 0.75). Refusing what is not a shape is
  the fitters' structural gates' job — no non-shape in the test suite
  produces a candidate at any confidence — so the floor only sets how sloppy a
  real shape may be.
- Known limits, now written down: an octagon, and a pentagon or hexagon with
  polygon fitting off, snap to a circle; a rectangle whose corner radius is
  40 % of its short side snaps to an oval.

## [0.1.8] - 2026-09-21

Shapes now snap on real Pencil ink.

### Fixed

- **Shapes drawn with the Apple Pencil snap.** A screen recording showed
  what the tests never modelled: every real stroke starts with a small hook
  where the Pencil lands, and a closed shape runs on past where it started.
  Either one was enough to refuse a circle or a rectangle, so almost nothing
  snapped on the iPad. The recogniser now trims the hook and cuts the
  overshoot before fitting.
- The selected shape in the Shape tool is now clearly marked: the highlight
  was nearly invisible on the dark pill.

## [0.1.7] - 2026-09-21

iPad draw-and-hold, second attempt: the hold itself was being cancelled.

### Fixed

- **iPad: holding the Pencil still no longer cancels the stroke.** iPadOS
  treats a pen that stops moving as a long press and ends the stroke, which
  is the very gesture draw-and-hold asks for. The page now opts out of that,
  and a cancel of a pen that has not moved is taken as the hold it was.
- **Basic shapes only, for now.** Lines, arrows, rectangles, circles and
  ovals snap. Triangles and other polygons are off until they have been
  tuned on real Pencil ink — a square drawn on the iPad came back skewed.

### Changed

- The input debug overlay now reports what the recogniser decided for each
  stroke (kind and score, or the best refused candidate), so an iPad screen
  recording shows whether a hold fired and why a shape was refused.

## [0.1.6] - 2026-09-21

Shapes that actually snap, and a real Shape tool.

### Added

- **Shape tool.** The shapes button in the toolbar is now a tool, after
  GoodNotes: auto-shape, then square, circle, triangle, diamond and rounded
  square. Auto-shape turns whatever you draw into a clean shape when you lift
  the pen. A preset is dragged out corner to corner, or tapped to drop a
  default-size one.
- **More shapes.** Besides lines, arrows, rectangles and circles, ovals,
  triangles, diamonds and other polygons (up to six sides) now snap, with
  their sides straightened and corners made sharp.
- **Resize while holding.** Once a shape snaps, keep the pen down and move it
  to resize and rotate the shape before you let go.

### Fixed

- **Draw and hold now works.** Drawing a shape and holding the pen still at
  the end never snapped it; now it snaps while the pen is still down, as in
  GoodNotes and Apple Notes. It can be turned off in settings ("Draw and hold
  to make shapes"). Undo removes a snapped shape in one step.
- Snapped shapes no longer render with their corners cut off.
- iPad: page sidebar, add-page and template-picker buttons no longer render as
  empty grey boxes or with cut-off names.

## [0.1.5] - 2026-09-21

Page sidebar, templates, and the real iPad text-box fix.

### Added

- **Page sidebar.** The leftmost toolbar button opens a thumbnail panel. Tap a
  page to jump to it; each page's menu adds a page before or after it, changes
  its template, duplicates, moves or deletes it — all undoable.
- **Page templates, after GoodNotes.** Adding a page opens a small sheet
  (before / after / last page, your current and recent templates), and "More
  from templates…" opens the full picker: page size, paper colour, orientation,
  and every template, including planners, to-do lists, ledgers, music staves
  and guitar tab.

### Fixed

- iPad: the screen no longer goes black while you type in a text box. Obsidian
  shrinks its window to make room for the keyboard, and the page was being
  squeezed to zero height. While you edit a text box the keyboard now covers
  the lower part of the page instead, as in GoodNotes, and the box is kept
  above the keyboard.

### Changed

- The **Input debug overlay** also shows the keyboard height and Obsidian's
  window height.

## [0.1.4] - 2026-09-21

iPad text-box fix release.

### Fixed

- iPad: typing in a text box no longer turns the screen black or throws the
  view somewhere else. iPadOS was zooming into the text box because its font
  was under 16px; the box now keeps a 16px font internally and is scaled to
  size, so it looks the same but no longer triggers the zoom.
- The page is redrawn whenever the keyboard opens or closes, so it can no
  longer be left unpainted behind the keyboard.

### Changed

- The **Input debug overlay** now also shows zoom, keyboard viewport, scroll
  positions and canvas size, to diagnose iPad-only view problems from a
  screenshot.

## [0.1.3] - 2026-09-21

Eraser and text-box release.

### Added

- **A real eraser.** The new **Standard** mode rubs out only the ink it passes
  over, splitting strokes where it cuts them. **Whole stroke** mode — the old
  behaviour — is one tap away in the eraser's menu.
- **Eraser sizes.** Small, medium and large. The size is on the page, so zooming
  in erases finer detail, and a circle shows the eraser's footprint while you
  erase. Mode and size are remembered between sessions.
- **Sizable text boxes.** With the Text tool, drag a rectangle to size a new box
  (a tap still makes a default one). Handles move and resize a box, and both
  can be undone.

### Changed

- Text boxes are transparent, showing an outline and handles only while you
  edit them. Empty boxes disappear when you leave them.

### Fixed

- iPad: focusing a text box no longer scrolls the page away from under the
  keyboard.

## [0.1.2] - 2026-09-20

Small iPad-focused writing-tool release.

### Added

- **Page text boxes.** Select the Text tool, tap a page, and type. Text boxes
  are positioned in page space, persist with the note, and their insertion can
  be undone.

### Changed

- **A quieter pen panel.** The active pen now shows one compact control, with
  Fountain, Ball, and Brush pens in its menu; the main panel has three useful
  quick colours and essential widths.
- Tapping an already-selected tool hides its options while keeping that tool
  selected, leaving the page clear for writing.

### Known issues

- Text boxes currently provide plain text only. Formatting, resizing, moving,
  and list controls remain future work.

## [0.1.1] - 2026-09-20

Second test build. Eight bug fixes, a real mobile-compatibility fix, and the
test suite more than doubled.

### Fixed

- **`minAppVersion` was wrong, and it mattered.** The plugin calls
  `App.loadLocalStorage` / `App.saveLocalStorage`, which need Obsidian
  **1.8.7**, while the manifest claimed 1.7.2 — so 0.1.0 would have misbehaved
  for anyone on 1.7.2 through 1.8.6. The manifest now states what the code
  actually requires.
- **Three bugs that lost or corrupted ink**, including `AddPage`'s undo
  resolving a page by first-matching id and deleting the wrong page, plus five
  more found by the same test pass.
- `ToolbarCallbacks` declared its 28 callbacks as method signatures, so reading
  one produced an unbound reference that loses `this`; they are now
  function-typed properties.
- The offscreen PDF raster canvas now uses Obsidian's global `createEl` rather
  than `document.createElement`.

### Changed

- Test suite 221 -> 551 tests, coverage 55% -> 98%.
- Removed upstream's `docs/` website and the Pages workflow that published it,
  and rewrote `SECURITY.md`, which still pointed vulnerability reports at
  upstream's address. `SPECIFICATION.md` is kept but marked as upstream history.

### Known issues

- Still pre-release. See `TASKS.md` for what is in flight.

## [0.1.0] - 2026-09-20

First release, for on-device testing via BRAT. Built on InkedMark 1.3.4
(MIT, (c) Pascal Crausaz); see the acknowledgment in README.md.

### Added

- **Paginated notebooks.** Fixed-geometry pages instead of an infinite canvas,
  so a note renders identically on an iPad, a phone and a laptop. Strokes are
  stored in page space and scaled at render time.
- **Paper backdrops.** Blank, lined, grid and dot rulings, plus PDF pages as a
  backdrop for annotating lecture slides.
- **Shape snapping.** Hold at the end of a stroke to snap it to a line,
  rectangle, circle or arrow.
- **Images** on the page, with move/scale/rotate.

### Known issues

- Pre-release quality: expect rough edges. See `TASKS.md` for what is in flight.
- `npm run lint:review` (the stricter review lint) reports 19 pre-existing
  findings inherited from upstream; they do not affect the built plugin.

Versions before 0.1.0 belong to InkedMark, the project GoodObsidian grew out of.
