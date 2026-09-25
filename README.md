# FineNotes

Handwriting notebooks for Apple Pencil and iPad, inspired by Goodnotes: real pages, paper templates, shapes that snap, PDF annotation and pictures, all kept as plain files in your vault.

Most handwriting plugins for Obsidian give you an infinite canvas. FineNotes
gives you **pages**, as Goodnotes does. A page has a fixed size, so ink stays
exactly where you wrote it on an iPad, a phone and a laptop, whatever the width
of the window.

## Why I made FineNotes

FineNotes started as a personal project because I was tired of all the paid
note-taking apps on the App Store, such as Goodnotes and Notability, combined
with the bad performance of Apple Notes as an alternative. I was also tired of
companies being the ones responsible for keeping your notes in their cloud,
something that Obsidian fixes. Furthermore, I was struggling with compatibility
issues between my PC, which runs Windows, and my Apple devices, which made
synchronization a very arduous task, to say the least.

The purpose of this plugin is to be a complete alternative to those note-taking
apps. It can't have every feature a native App Store app has, because it runs
as TypeScript inside Obsidian, with the memory limits that come with that. But
I think that with future releases and your feedback it can get very close. For
now it has all the essential features; only some extra, handy ones from those
apps are still missing.

Hope you guys enjoy this and give me some
[feedback](https://github.com/Joost-8/FineNotes/issues)!

— Joost

## Features

**Notebooks and pages**

- Notebooks with covers (plain, label, spine or linen, in eight colours), and
  single pages, from a New notebook dialog.
- A page sidebar with thumbnails and bookmarks. Pages can be moved up and down,
  duplicated or deleted.
- Search inside a notebook: typed text, and handwriting you have transcribed.
- "Go to page", and links straight to a page: `[[Biology.notebook#Page 3]]`.
- A notebook reopens on the page you left. Pull past the last page to add
  another.
- Vertical scrolling, or one page at a time sideways.

**Paper**

- Essentials: blank, dotted, ruled (narrow or wide) and squared.
- Writing papers: Cornell, legal, single and three columns, and Title & Date.
- Planners (to-dos, weekly, monthly, accounting), music paper and guitar
  tablature.
- White, yellow or dark paper; A4, A5, A6 and A3 sizes, in portrait or
  landscape.

**Writing**

- Pressure-sensitive pen and highlighter, in any colour, with widths in
  millimetres.
- An eraser that rubs out only what it passes over, or one that removes whole
  strokes. Either can be set to erase only pen ink or only highlighter.
- Pen gestures, as in Goodnotes:
  - scribble over something to erase it;
  - circle something and hold to select it.
- Palm rejection: the Pencil writes, while fingers scroll and pinch.
- Smooth scrolling and zooming, with momentum and a rubber-band edge.

**Shapes**

- Draw a shape and hold the pen still: it snaps to a clean line, arrow,
  rectangle, circle, ellipse, triangle or star. Keep holding to move and resize
  it.
- Or switch on auto shape, and a stroke that is plainly a shape snaps as you
  lift the Pencil.
- A Shape tool with connectors, and tables up to 8 × 8.

**Selecting and arranging**

- A freehand or rectangular lasso, with switches for what it picks up:
  handwriting, pictures, shapes, arrows and text boxes.
- Move, cut, copy, paste and recolour a selection, between pages and between
  notebooks. Pictures and text boxes can be resized, and pictures rotated.

**Text, pictures and PDFs**

- Text boxes with colours, sizes, bold, italic, bullets and numbering.
- Pictures from Photos, the camera or your vault. They can be cropped, rotated
  and locked in place.
- Scan a document with the camera.
- Bring in a PDF, such as lecture slides or a worksheet: every PDF page becomes
  a page you can write on.

**Audio**

- Record while you write.
- Afterwards, tap any word you wrote to hear what was being said at that
  moment.

**Sharing**

- Export a notebook, or chosen pages, as a PDF, into a folder of your choice.

**AI, optional and with your own key**

- Transcribe your handwriting into the note, so Obsidian can search it.
- Ask questions about a page or a whole notebook.
- Generate a picture.
- Transcribe a recording.

## Requirements

- Obsidian **1.13** or later.
- It is built for the iPad with an Apple Pencil. It also works with a mouse, a
  trackpad or a pen on the desktop, and on a phone.
- Android has not been tested.

## Install

- **From Obsidian:** open Settings, then Community plugins, then Browse. Search
  for "FineNotes", install it and enable it. Or open the
  [FineNotes page](https://community.obsidian.md/plugins/finenotes) in the
  Obsidian community directory and choose **Add to Obsidian**.
- **Beta versions:** install the
  [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, and add
  `Joost-8/FineNotes`.
- **By hand:** download `main.js`, `manifest.json` and `styles.css` from the
  [latest release](https://github.com/Joost-8/FineNotes/releases/latest) into
  `<your vault>/.obsidian/plugins/finenotes/`. Then enable the plugin under
  Community plugins.

## Getting started

1. Open a new notebook, with the notebook button in the left ribbon or the
   command **New notebook or page…**. Choose a cover, a paper and a size.
2. Write. The toolbar at the top has:
   - on the left: pages, search, AI, and undo/redo;
   - in the middle: the writing tools;
   - on the right: add page, share, and the notebook's settings.

   A tool's options show in a bar under the toolbar; tap the tool again to
   hide them.

3. Add a page with **+**, or by pulling past the last page.

There is no save button: every change is written to the note as you go.

## How to use

### The toolbar

- **Left:** **Page thumbnails** (the page sidebar), **Search this notebook**,
  **AI** (the sparkles), **Undo** and **Redo**.
- **Middle:** the tools. **Lasso select**, **Pen**, **Eraser**, **Text box**,
  **Shapes**, **Insert image** and **Record audio** (the microphone).
- **Right:** **Add page** (+), **Export as PDF** (share), **More** (⋯) and
  **Notebook settings** (the gear).

A tool's options appear in a bar under the toolbar. Tap the tool again to
slide them away, and once more to bring them back. The lasso has no options
bar: tap it again to open its menu.

### Writing and erasing

- **Pen type:** tap the nib at the start of the pen options. **Fountain pen**
  and **Brush pen** respond to pressure; **Ball pen** draws an even line;
  **Highlighter** draws a wide, see-through stroke.
- **Width:** three widths, and a ⌄ for a slider in millimetres.
- **Colour:** three quick colours. Tap the colour in use again to change it,
  or tap **+** for more. **Custom colour…** mixes any colour: pick the shade
  in the square and the hue on the slider, then tap the round swatch.
- **Highlighter:** choose **Highlighter** as the pen type, or press **H** on a
  keyboard. Choose a pen type again to go back to writing.
- **Eraser:** **Standard** rubs out only what it passes over; **Whole stroke**
  removes every stroke it touches. It has three sizes, and **All ink** can be
  changed to **Erase highlighter only** or **Erase pen only**. Pictures and
  text boxes are never erased. **Clear page** is here too.

### Shapes and pen gestures

- **Draw and hold:** draw a line, arrow, rectangle, circle, ellipse, triangle
  or star in one stroke and hold the Pencil still. It snaps to a clean shape;
  keep the pen down and move it to resize and turn the shape. For an arrow,
  draw the head in the same stroke, or go back a little way along the line,
  then hold. The setting **Draw and hold to make shapes** turns this off.
- **Auto shape**, the last button in the pen options: a stroke that is
  plainly a shape snaps as you lift.
- **Pen gestures**, at the foot of the pen menu, both on at first:
  - **Scribble to erase:** scribble back and forth over writing to erase it.
    A scribble on empty paper stays as ink. **Erase shapes and highlighter**
    lets it take those too.
  - **Circle to lasso:** draw a loop round something and lift, then press and
    hold the Pencil on the loop. What it enclosed is selected, ready to drag.
- **The Shapes tool:** **Auto-shape** snaps whatever you draw. Drag out a
  **Square**, **Circle**, **Triangle**, **Diamond**, **Rounded square** or
  **Star**, or a **Line** or **Arrow**; a tap drops a default-size one.
  **Table**: tap a size up to 8 × 8, then drag it out. The disc at the end
  sets the shapes' colour.

### Selecting with the lasso

Draw round what you want, or tap one thing. Tap the lasso again to choose
**Freehand** or **Rectangular**, and what it picks up: **Handwriting**,
**Images**, **Shapes**, **Arrows** and **Text boxes**.

Drag inside the frame to move the selection. Its bar has **Cut**,
**Duplicate** and **Delete**; **…** adds **Copy**, **Paste** and a colour row
to recolour ink. Paste works across pages and notebooks; hold the lasso on
empty paper for a **Paste** button right there.

### Text

With **Text box**, tap the page and type; the box grows as you type. Tap a box
to edit it, and drag its handles to move or resize it. The options hold
colour, size, font, **B I** (bold, italic, underline, strikethrough),
alignment, line spacing, bullets and numbering, and box fill. **Drag to size
text boxes** lets a drag set a new box's size. **Pin Text tool** keeps Text
chosen after a box is done. While you type, the red bin deletes the box.

### Pictures and PDFs

**Insert image** offers **Photos**, **Take photo**, **From vault**, and:

- **Scan document:** photograph a sheet of paper, drag the corners onto it if
  needed, choose **Colour**, **Greyscale** or **Black & white**, and tap **Add
  page**. **Next page** scans several at once.
- **Scanned PDF from Files:** any PDF, such as lecture slides. Each of its
  pages becomes a page you can write on, after the current one. Notebooks
  only.
- **Generate with AI**, once an image service is set up.

A new picture is selected: drag its corners to resize it and the knob below
to rotate it. To select it later, tap it with the lasso. Its bar has
**Crop**, **Cut**, **Duplicate** and **Delete**; **…** adds **Front**,
**Back**, **Copy**, **Paste** and **Lock image**. The lasso ignores a locked
picture, such as a worksheet you write on; hold the lasso on it and tap
**Unlock** to free it.

### Pages

- **Add a page** with **+**: choose **Before**, **After** or **Last page**,
  and a recent template or **More from templates…**. Or pull past the last
  page until it says **Release to add page**.
- **The page sidebar:** tap a page to go there, or its ribbon to bookmark it;
  **All pages** switches to **Bookmarks only**. A page's ⌄ menu can bookmark,
  copy a link, add, duplicate, move, clear or delete pages, and **Change
  template** (**Change cover** on a cover).
- **More** (⋯) does the same for the page you are on, and has **Go to page**.
- **Notebook settings** (the gear): **Scroll direction** (**Vertical**, or
  **Horizontal** for one page at a time), and folders for this notebook's
  **Images**, **Recordings** and **PDF exports**.
- **A single page** cannot take more pages until you choose **Convert to
  notebook** in its ⌄ menu in the sidebar.

### Search, links and export

- **Search this notebook** finds typed text and transcribed handwriting.
  Handwriting that has not been transcribed cannot be found.
- **Links:** `[[Biology.notebook#Page 3]]` (or `#page=3`) opens a notebook at
  page 3. **Copy link to page** makes one for you.
- **Export as PDF:** all pages, **This page**, or **Choose pages** (tap them in
  the order you want, or type `1-3, 5`), then **Export**. The PDF goes into
  the **PDF exports** folder, or else next to the notebook. Then **Open** or
  **Share…** it.

### Audio

Tap the microphone to record. A red pill shows the time: tap **Stop** to end,
or the bin to throw the recording away. Recording stops if the iPad locks or
you leave Obsidian.

Recordings are in the sidebar's **Audio** tab, with **Play** and
**Transcribe**. While the player is open, tap your writing to hear it from
five seconds before you wrote it. **Transcribe** needs an OpenAI or Google
key, or your own server; the transcript is a note of its own next to the
audio.

### AI (optional)

1. Open Settings → FineNotes → **AI with your own key**.
2. Choose an **AI service**: Anthropic (Claude), OpenAI (GPT), Google
   (Gemini), OpenRouter, or a **Custom endpoint** such as Ollama.
3. Tap **Add key** and paste your API key. For OpenRouter you can tap
   **Connect OpenRouter** and approve in the browser instead. For a custom
   endpoint, fill in **Endpoint URL** (see [SELF_HOSTING.md](SELF_HOSTING.md)).
4. To generate pictures with Claude or a custom endpoint, choose OpenAI,
   Google or OpenRouter under **Image generation** and add that key.

The **AI** button then offers **Transcribe this page**, **Transcribe whole
notebook**, **Transcribe recording…**, **Ask about this page…**, **Ask about
this notebook…** and **Generate image…**. A greyed-out entry says what it
needs. The first request asks once whether to send; tap **Send**.

Transcriptions go into the note's text layer, one heading per page, which
opens under the pages so you can correct it. An answer from **Ask** can be
put on the page with **Insert as text box**.

To transcribe as you go, set **Handwriting recognition** to **Cloud AI** and
switch on **Recognize automatically**: the page you are on is transcribed
about 30 seconds after you stop writing.

### Keyboard shortcuts

| Keys                         | What they do                                  |
| ---------------------------- | --------------------------------------------- |
| Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z | Undo, redo                                    |
| P, H, E, V, S, T             | Pen, highlighter, eraser, lasso, shapes, text |
| Cmd/Ctrl+C, X, V             | Copy, cut, paste                              |
| Delete or Backspace          | Delete the selection                          |
| Escape                       | Close a menu, deselect, cancel a crop         |
| Return                       | Finish a crop                                 |
| Page Up, Page Down           | Previous or next page                         |
| ↑, ↓                         | Scroll                                        |

On a computer, Ctrl/Cmd with the scroll wheel (or a trackpad pinch) zooms.

### Commands

Besides the toolbar's own actions, the command palette has **New notebook or
page…**, **Create notebook with last settings**, **Convert single page to
notebook**, **Scan document into this notebook**, **Show or hide the text
layer**, **Transcribe this notebook's handwriting**, **Switch between notebook
and Markdown view**, **Fit the page and go to the top**, **Zoom in**, **Zoom
out** and **Show the changelog**.

**Transcribe this notebook's handwriting** follows the **Handwriting
recognition** setting. On **Manual**, as it starts, it opens the text layer
for you to type in.

### Tips for the iPad

- **Switch off Scribble** in the iPad's Settings app, under Apple Pencil →
  Scribble. This iPadOS handwriting feature can take a fast Pencil stroke for
  itself before FineNotes sees it, and the stroke goes missing.
- **Keep the screen on while you record.**
- **A notebook that opens read-only** did not load its ink, usually because a
  sync had not finished. Nothing on disk has changed: reopen it once the sync
  is done.
- **Ink looks garbled?** Switch off **Desynchronized canvas** in the settings.
- **Reporting a bug:** run **Show or hide the input debug overlay** and make a
  screen recording. For a shape that will not snap, run **Copy shape
  diagnostics**: it saves a note, "FineNotes shape diagnostics.md", to paste
  into the issue.

## How your notes are stored

- A notebook is a Markdown file in your vault called `Title.notebook.md`. A
  single page is called `Title.page.md`.
- The ink sits in a compressed block inside a `%%` comment, which Obsidian
  hides when reading.
- Transcribed text goes into a marked section of the same file, with one
  heading per page. Obsidian's search, links and backlinks all see it.
- Pictures, recordings, PDFs and exports are ordinary files next to the note.
- Your notes sync with whatever syncs your vault.
- Without the plugin, a notebook still opens as a Markdown file: its text is
  readable, its ink is not.
- Notes made with earlier versions, under the name GoodObsidian (`Title.ink.md`
  included), open as they are.

## Privacy and network use

FineNotes works fully offline. It sends nothing anywhere, and it has no
telemetry, no ads and no account.

The network is only used by the optional AI features, and only after you:

1. choose an AI service in the settings and give it your own API key;
2. agree to a one-time prompt before the first request to that service.

Then:

- **What is sent:**
  - an image of the page, when you transcribe, ask a question, or let a page
    be transcribed automatically;
  - your prompt, when you generate a picture;
  - the audio, when you transcribe a recording.
- **Where it goes:** only to the service you picked:
  - Anthropic (`api.anthropic.com`);
  - OpenAI (`api.openai.com`);
  - Google Gemini (`generativelanguage.googleapis.com`);
  - OpenRouter (`openrouter.ai`);
  - or your own OpenAI-compatible server, such as Ollama or LM Studio. See
    [SELF_HOSTING.md](SELF_HOSTING.md).
- **Why:** these features need a model that reads handwriting, answers
  questions, generates pictures or transcribes speech. The service's own terms
  and pricing apply.
- **Automatic transcription** (the **Recognize automatically** setting): this
  is off by default. When it is on, a page
  is only ever sent after you have agreed to the prompt.
- **Connect OpenRouter:** this opens OpenRouter in your browser to approve the
  plugin, and then collects the key from `openrouter.ai`.
- **API keys:** they are kept in Obsidian's Keychain, not in your vault's
  files, so they do not sync or end up in backups of the vault.

## How it works

A short tour, for the curious and for anyone who wants to contribute.

**Pages have their own coordinates.** Every page has a fixed size in its own
units: an A4 page is 1024 units wide, standing for 210 mm. Strokes are stored
in the coordinates of the page they were written on, and the screen only
decides how large that page is drawn.

That is why a note looks the same on every device, and why ink never drifts
when the window changes width. An infinite canvas has no such anchor.

**Input.** Pointer events tell the Pencil and fingers apart:

- The Pencil writes; one finger scrolls, two pinch, and a palm is ignored.
- FineNotes reads the extra samples the iPad gathers between frames, so fast
  handwriting stays smooth.
- It draws the samples the iPad predicts, so the line keeps up with the pen
  tip.
- iPadOS wants a still pen for itself (long press, Scribble), so FineNotes claims
  those touches first. A still pen that iPadOS cancels counts as the hold it
  was, which is what lets draw-and-hold snap shapes.

**Ink.** Pressure-sensitive strokes are outlined with
[perfect-freehand](https://github.com/steveruiz/perfect-freehand). Shapes are
drawn as exact lines, so their corners stay sharp.

Shape recognition is geometry, not machine learning: it fits lines, polygons,
circles, ellipses and stars. It was tuned on real Apple Pencil strokes traced
from screen recordings, so it accepts the hooks and overshoots a real hand
makes.

**Drawing.** There are three stacked canvases:

- the paper;
- finished ink, drawn from cached tiles, so scrolling is cheap;
- the stroke being written, on a fast layer of its own.

The page is never scrolled as a web page. It is moved by a transform, with
iOS-style momentum and a rubber band at the edges.

**Every edit is undoable.** Each change is a command that knows its own
inverse, so undo and redo are exact, and a moved selection is one step.

**The file.** The note's frontmatter and text are ordinary Markdown. The ink is
one `%%` block: the notebook as JSON, compressed with DEFLATE and stored as
base64. Points are rounded to 1/100 of a unit and pressure to 1/255, which keeps
files small without visible loss.

The format is written down in [`contracts/api.md`](contracts/api.md), and 559
golden files pin its exact bytes. FineNotes writes only its own frontmatter keys,
its ink block and its text section; the rest of your note is never touched.

**AI.** Requests go through Obsidian's own network API, because a web view's
`fetch` to these services is blocked on the iPad. Each key is only used for its
own service, and the key for your own server never goes anywhere else.

**Code layout.**

| Folder             | What it holds                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/model/`       | The notebook, its commands and the file format. Pure TypeScript: no DOM, no Obsidian.                    |
| `src/ink/`         | Stroke building, outlines, shape recognition and pen gestures. Pure.                                     |
| `src/input/`       | Pointer handling, palm rejection, pinch and pan.                                                         |
| `src/canvas/`      | Rendering, tiles, page layout, scroll physics, paper rulings and scanning geometry.                      |
| `src/view/`        | Everything Obsidian-facing: the notebook view, toolbar, sidebar and dialogs.                             |
| `src/recognition/` | The AI services: requests, keys and transcription.                                                       |
| `tests/`           | About 2,450 unit tests, including real Pencil ink traced from screen recordings, and the format goldens. |

The pure modules have enforced test coverage. CI runs Obsidian's own
plugin-review lint rules as well as lint, the type check, the tests and the
build.

## Good to know

- Handwriting lives in its own notebook files; it is not placed inside other
  notes. To refer to it, link to a notebook or to one of its pages.
- Coming from GoodObsidian? Your settings carry over the first time FineNotes
  starts. Custom hotkeys have to be set again, and you can remove the old
  plugin afterwards.
- Do not run InkedMark in the same vault: both open `.ink.md` files.

## Credits

- Strokes are drawn with
  [perfect-freehand](https://github.com/steveruiz/perfect-freehand) by Steve
  Ruiz (MIT).
- Notes are compressed with [fflate](https://github.com/101arrowz/fflate)
  (MIT).
- PDFs are rendered with the PDF.js that Obsidian ships.
- FineNotes began as a fork of
  [InkedMark](https://github.com/pcrausaz/obsidian-inkedmark) by Pascal
  Crausaz, and has since been rewritten; it no longer contains InkedMark's
  code. Thanks for the start.

## Development

```
npm install
npm run dev          # watch-mode build
npm test             # unit tests
npm run lint         # eslint, no warnings allowed
npm run lint:review  # Obsidian's plugin-review rules, as CI runs them
npm run build
```

To try a build in a vault, put the plugin folder's path
(`<vault>/.obsidian/plugins/finenotes`) in a `.deploy-target` file. Every build
is then copied there.

Bug reports and ideas are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md), or go
straight to the
[issues](https://github.com/Joost-8/FineNotes/issues). For an iPad problem, a
screen recording with **Show or hide the input debug overlay** switched on
helps more than anything else.

## License

[MIT](LICENSE)
