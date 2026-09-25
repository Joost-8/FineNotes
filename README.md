# FineNotes

Handwrite with Apple Pencil in real, paginated notebooks: paper templates,
shapes that snap, PDFs and pictures, all kept as plain files in your own vault.

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
- Move, resize, cut, copy and paste, between pages and between notebooks.

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

- **From Obsidian**, once it is listed in the Community plugins directory: open
  Settings, then Community plugins, then Browse. Search for "FineNotes", install
  it and enable it.
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

   Tap the active tool again to show its options.

3. Add a page with **+**, or by pulling past the last page.

There is no save button: every change is written to the note as you go.

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
- **Transcribing automatically:** this is off by default. When it is on, a page
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

Bug reports and ideas are welcome in the
[issues](https://github.com/Joost-8/FineNotes/issues). For an iPad problem, a
screen recording with **Show or hide the input debug overlay** switched on
helps more than anything else.

## License

[MIT](LICENSE)
