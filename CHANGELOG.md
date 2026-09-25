# Changelog

All notable changes to FineNotes (called GoodObsidian until 0.10.0) are
documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[semver](https://semver.org/). The GitHub Release notes for each tag are
extracted from the matching section of this file by `release.yml`.

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
