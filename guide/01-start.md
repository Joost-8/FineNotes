# Start here

What FineNotes is, and what Ask AI should say about the things people ask first: devices, sync, setting up AI, where to report a bug.

Part of FineNotes' guide (see `README.md` here): what Ask AI looks up to answer questions about the app. Edit an entry, then run `npm run guide`.

<!-- area: start -->

### What FineNotes is (free and open source)

- **Id:** `aboutFineNotes`
- **What:** FineNotes is an Obsidian plugin for handwritten notebooks with pages, like Goodnotes: write with a pen or Apple Pencil, add pages from templates, annotate PDFs, and keep everything as files in your vault. It is free and open source (GPL-3.0).
- **Where:** Notebooks are made from Home (the notebook library) with +, or the command New notebook or board….
- **Words:** what is finenotes, about, goodnotes for obsidian, handwriting plugin, notebooks, paginated, free, open source, price, cost, is it free
- **Commands:** `open-library`, `create-handwriting-note`

### Which devices FineNotes runs on

- **Id:** `platforms`
- **What:** FineNotes runs everywhere Obsidian runs: iPad, iPhone, Android, Mac, Windows and Linux. It is designed and tested first on the iPad with an Apple Pencil; a few things differ per device (noted on each entry).
- **Where:** Install it from Obsidian's Settings › Community plugins on each device.
- **Words:** ipad, iphone, android, mac, windows, linux, desktop, computer, tablet, phone, platform, device, apple pencil, supported

### Notebooks on another device (sync)

- **Id:** `syncDevices`
- **What:** Notebooks are ordinary files in your vault (Title.notebook.md, and with Each notebook gets its own folder on, a folder beside it with its pictures, recordings and exports). Any way of syncing the vault works: Obsidian Sync, iCloud, Syncthing and others. Let the sync finish before writing on the other device; a notebook whose ink did not load cleanly opens read-only until it has.
- **Where:** Use the vault's own sync; FineNotes needs no setup for it.
- **Notes:** Keyboard shortcuts and AI keys stay on each device; they do not sync.
- **Words:** sync, syncing, icloud, obsidian sync, syncthing, other device, second ipad, laptop, transfer, backup, files, where are my notebooks stored, file format
- **Seen as:** notebook lost after sync, sync conflict, pages missing on other device, notebook empty on iPad, changes gone
- **Settings:** `notebookOwnFolder`

### Apple Pencil double-tap and squeeze

- **Id:** `pencilDoubleTap`
- **What:** Apple Pencil double-tap and squeeze do not work in FineNotes: Obsidian's web view on the iPad does not pass them to plugins. Instead: two-finger double-tap undoes (three fingers redo), Pen gestures (scribble to erase, circle to lasso, hold to snap shapes) save switching tools, and the bar's buttons switch tools in one tap.
- **Where:** Pen gestures: Toolbar › Pen › tap the pen type in hand › Pen gestures. Finger undo: Settings › Writing › Two-finger double-tap to undo.
- **Words:** double tap, double-tap, squeeze, pencil pro, apple pencil 2, switch tool pencil, pencil gesture, barrel roll
- **Settings:** `fingerTapUndo`

### Flashcards and spaced repetition

- **Id:** `flashcards`
- **What:** FineNotes has no flashcard or spaced-repetition feature.
- **Where:** Not in FineNotes.
- **Words:** flashcards, flash cards, spaced repetition, anki, quiz, study cards, memorize

### Report a bug or ask for a feature

- **Id:** `reportBug`
- **What:** Report bugs and ask for features on GitHub: https://github.com/Joost-8/FineNotes/issues (a bug report or a feature request). Report a bug first asks what went wrong and shows what the tips and this guide say about it, so an answer that already exists is found at once; its last row opens GitHub's bug form with the FineNotes and Obsidian versions and the device filled in. Ideas and questions also go to GitHub Discussions. For strokes that go missing or break, turn on the Input debug overlay first and describe what it shows.
- **Where:** Settings › Feedback and community, under the list of sections: Report a bug, Ideas and questions. Also the command Report a bug.
- **Words:** bug, broken, not working, crash, problem, issue, report, feature request, idea, suggestion, missing feature, wish, github, contact, feedback, support
- **Commands:** `report-bug`

### Coming from Goodnotes

- **Id:** `fromGoodnotes`
- **What:** Goodnotes notebooks can be imported (export them from Goodnotes first; the import is in beta, so check the result and keep the originals). Much works as in Goodnotes: the toolbar's pens, highlighter, eraser, lasso, shapes and text; hold the pen still at the end of a stroke to snap a shape; the page thumbnails; templates for new pages; Home as the library of covers. FineNotes also keeps notebooks as files in your Obsidian vault, finds handwriting in search, and can link pages from Markdown notes.
- **Where:** Import: Home › New › Import from another app…. Thumbnails: Toolbar › Page thumbnails. Home: Toolbar › Home.
- **Words:** goodnotes, switching, migrate, move from goodnotes, like goodnotes, notability, difference, compare, where is
- **Tip:** `importBooks`

### Setting up AI (service and key)

- **Id:** `aiSetup`
- **What:** AI features use your own account with an AI service: Anthropic (Claude), OpenAI (GPT), Google (Gemini), OpenRouter (any model; Connect OpenRouter gets a key without copying), or any OpenAI-compatible server such as Ollama or LM Studio. Pick one, add its key, and optionally a model (empty uses the service's default). Nothing is sent until you start an AI action, and the first one asks first. On-device features (reading handwriting, transcribing recordings with This device) need no key.
- **Where:** Settings › AI › AI service, then the service's API key row (Add key), and AI model.
- **Notes:** A key is kept in this device's keychain and never syncs: enter it once on each device.
- **Words:** ai setup, api key, key, account, anthropic, claude, openai, chatgpt, gemini, google, openrouter, ollama, local model, lm studio, own server, which ai, configure, connect
- **Settings:** `llmVendor`, `llmModel`, `llmBaseUrl`

### Opening FineNotes' settings

- **Id:** `openSettings`
- **What:** FineNotes' settings have eight sections, one shown at a time: General, Writing, Pages, Shortcuts, Reading and voice, AI, Files and folders, Troubleshooting. Obsidian's search box at the top finds any row.
- **Where:** In a notebook: Toolbar › Notebook settings (gear) › All FineNotes settings. Or Obsidian's Settings › Community plugins › FineNotes.
- **Words:** settings, preferences, options, configure, change setting, where are settings

### Keyboard shortcuts

- **Id:** `keyboardShortcuts`
- **What:** Default keys: P or W pen, H highlighter, E eraser, V lasso, S shapes, T text, L laser pointer, hold Space to move the page; 1–8 saved pens; Mod+Z undo, Mod+Shift+Z or Ctrl+Y redo, Mod+A select everything on the page, Delete or Backspace delete the selection, Mod+C/X/V copy, cut, paste; Page Down/→ next page, Page Up/← previous page; Escape lets go of a selection; ? shows the shortcut sheet. Mod is ⌘ on Mac and iPad, Ctrl elsewhere. Every key can be changed, kept per device; a tool's key can be set to Hold (the tool only while the key is down). Held with the pen: Shift erases, Mod lassoes, Alt zooms.
- **Where:** Settings › Shortcuts (tap a key to record a new one). The sheet: ? in a notebook, or ⋯ › Keyboard shortcuts.
- **Notes:** Shortcuts never act while typing in a text box. Obsidian's own hotkeys can also be set for FineNotes' commands (Settings › Hotkeys); none are set by default.
- **Words:** keyboard, shortcuts, hotkeys, keys, magic keyboard, bluetooth keyboard, key bindings, rebind, shortcut sheet
- **Commands:** `show-keyboard-shortcuts`
- **Tip:** `shortcutSheet`

### Tips, the welcome tour and what's new

- **Id:** `tipsPage`
- **What:** Tips shows short moving pictures of what FineNotes can do, in collections, with a search of every feature and a Try it button for gestures. The welcome offers a tour notebook. After an update nothing pops up: Home shows a What's new card with the release's highlights.
- **Where:** Home › lightbulb (Tips). Tips › Welcome, What's new, Take the tour, All changes. Or the commands Show the tips, Show the welcome, Show what's new on Home, Show the changelog.
- **Words:** tips, help, tutorial, tour, welcome, learn, what's new, whats new, changelog, release notes, new features, how to
- **Commands:** `show-tips`, `show-welcome`, `show-whats-new`, `view-changelog`

### Updating FineNotes

- **Id:** `updates`
- **What:** FineNotes checks once a day whether a newer release exists (nothing about you is sent) and marks the toolbar's gear with a dot; Remind me also says so under the gear. Updating itself is Obsidian's Update button for the plugin.
- **Where:** Obsidian Settings › Community plugins › FineNotes › Update. Reminders: Settings › General › Updates.
- **Words:** update, upgrade, new version, latest version, out of date, version
- **Seen as:** new version not showing, update not available, still on the old version
- **Settings:** `checkForUpdates`, `updateReminders`

### Privacy: what leaves the device

- **Id:** `privacy`
- **What:** Writing, reading handwriting (Grape), reading scanned pages and transcribing recordings with This device all run on the device, offline. Something is sent only when you start an AI action or choose an online service, and only to the service you chose with your key; the first time asks first. The update check reads only the newest version number.
- **Where:** Settings › AI and Settings › Reading and voice.
- **Words:** privacy, private, offline, data, cloud, sent, upload, internet, on device, tracking
