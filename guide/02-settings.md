# Settings

Every row of FineNotes' settings tab, section by section, as it is on screen.

Part of FineNotes' guide (see `README.md` here): what Ask AI looks up to answer questions about the app. Edit an entry, then run `npm run guide`.

<!-- area: settings -->

### Language of FineNotes

- **Id:** `settingLanguage`
- **What:** The language of FineNotes' menus, buttons and settings: Follow Obsidian, or one of about 45 languages. The settings change at once; the rest after Obsidian restarts.
- **Where:** Settings › General › Language
- **Words:** language, translate, translation, english, german, dutch, french, spanish, interface language
- **Settings:** `interfaceLanguage`

### Style and colours of FineNotes' bars and menus

- **Id:** `settingLook`
- **What:** Style changes the look of FineNotes' own bars, menus and dialogs (Default, Glass, Material, Fluent, Paper, Brutalist, Soft, Retro, Compact); Colours gives them a palette (Match Obsidian, Nord, Catppuccin, Dracula, Rosé Pine, Gruvbox, Solarized, Tokyo Night, Everforest, High contrast). Pages, ink and the rest of Obsidian stay as they are.
- **Where:** Settings › General › Style and Colours. Also in Customize toolbar, and the commands Look: next style / Look: next colours.
- **Words:** style, theme, look, colours, palette, glass, material, fluent, paper, brutalist, soft, retro, compact, nord, catppuccin, dracula, rose pine, gruvbox, solarized, tokyo night, everforest, high contrast, appearance
- **Settings:** `lookStyle`, `lookPalette`
- **Commands:** `next-look-style`, `next-look-palette`
- **Tip:** `looks`

### Simple look (hide Obsidian's bars)

- **Id:** `settingSimpleLook`
- **What:** Hides Obsidian's title bar, status bar, ribbon and sidebars so FineNotes looks like an app of its own; the tabs stay. While it is on, the buttons under it (or the ⌄ beside Simple look on Home's folder rail) bring back parts one by one: Left sidebar, Right sidebar, Ribbon, Status bar (all off by default; a sidebar brought back starts closed, behind its own button, for other plugins' panels such as a calendar or a timer). With the left sidebar back, Home's folder rail steps aside. Turn the look off to bring everything back.
- **Where:** Settings › General › Simple look, and the buttons under it. Also Home › folder rail › ⌄ beside Simple look, Notebook settings (gear), the Welcome, and the command Simple look: hide or show….
- **Words:** simple look, easy mode, hide obsidian, clean, distraction free, focus, sidebars, right sidebar, other plugins, calendar, pomodoro, ribbon, status bar, title bar, app look, full app
- **Seen as:** left panel disappears, left sidebar gone, side panels disappear, update kills the side panels, sidebars missing after update, panels hidden, cannot open settings, ribbon gone, status bar missing, menus disappeared, file explorer gone
- **Settings:** `simpleLook`, `simpleLookShow`
- **Commands:** `toggle-simple-look`
- **Tip:** `simpleLook`

### Hints for faster ways

- **Id:** `settingGestureHints`
- **What:** After you do something the slow way a few times, FineNotes names the faster way once. Turn off to stop these hints.
- **Where:** Settings › General › Hints for faster ways
- **Words:** hints, nudges, popups, suggestions, hint, stop hints, annoying
- **Seen as:** popups keep appearing, annoying messages, hints will not go away
- **Settings:** `gestureHints`

### Tool, width and colour a notebook opens with

- **Id:** `settingStartWith`
- **What:** The tool (Pen, Highlighter, Eraser or Select), stroke width and colour a notebook opens with.
- **Where:** Settings › Writing › Start with
- **Words:** default tool, default pen, default colour, default width, start with, opens with
- **Settings:** `defaultTool`, `defaultSize`, `defaultColor`

### Saved pens (favourite pens, keys 1–8)

- **Id:** `settingSavedPens`
- **What:** Up to eight pens, each with its own type, colour and width, picked from the star in the pen's options or with keys 1 to 8. Tap one to change it; ↺ restores FineNotes' own eight.
- **Where:** Settings › Writing › Saved pens. Also Toolbar › Pen › star.
- **Words:** saved pens, favourite pens, favorite pens, presets, pen presets, star, quick pens, 1 to 8
- **Settings:** `savedPens`
- **Tip:** `savedPens`

### Two-finger double-tap to undo

- **Id:** `settingFingerUndo`
- **What:** Double-tap with two fingers to undo; with three fingers to redo. On by default.
- **Where:** Settings › Writing › Two-finger double-tap to undo
- **Notes:** Does nothing while the notebook is read-only.
- **Words:** two finger tap, double tap undo, three finger redo, finger undo, gesture undo
- **Seen as:** two finger double tap does not undo, accidental undo
- **Settings:** `fingerTapUndo`
- **Tip:** `undo`

### Lasso takes what it touches

- **Id:** `settingLassoTouches`
- **What:** On (default): the lasso takes every stroke inside or touching the loop, like Notability. Off: at least half of a stroke must be inside, like Goodnotes. Pictures and text boxes go by their middle either way.
- **Where:** Settings › Writing › Lasso takes what it touches
- **Words:** lasso partly, lasso touches, select partly inside, half inside
- **Settings:** `lassoTouches`
- **Tip:** `lassoTouches`

### Drag to size text boxes

- **Id:** `settingTextDragSize`
- **What:** Off (default, as in Goodnotes): every new text box fits its text as you type. On: with the Text tool, drag to draw a box's size; a tap still makes a box.
- **Where:** Settings › Writing › Drag to size text boxes
- **Words:** text box width, drag text box, size text box, resize text box, fixed width text
- **Seen as:** text box will not resize, cannot make a text box bigger
- **Settings:** `textDragSize`
- **Tip:** `textDragSize`

### Stylus side button

- **Id:** `settingStylusButton`
- **What:** What a pen's side button does while you write: Erase (default), Erase, also hovering (the button held with the pen just above the page erases what it passes over), Lasso select, Move the page or Nothing; and what a click above the page does: open the pen menu (default), switch to the eraser, or nothing. A pen's eraser end always erases.
- **Where:** Settings › Writing › Stylus side button
- **Notes:** Apple Pencil has no side button, so the click choice is hidden on iPad and iPhone. Holding the button while writing may not work on Android tablets; Erase, also hovering does.
- **Words:** side button, barrel button, stylus button, pen button, wacom, surface pen, samsung s pen, eraser button
- **Seen as:** side button does not erase, S Pen button not working, barrel button does nothing
- **Settings:** `barrelButton`, `stylusButtonClick`

### Pressure-sensitive pens

- **Id:** `settingPressure`
- **What:** Off by default. On: the fountain pen widens as you press and the brush pen swells and tapers more; the ball pen stays even. Writing can feel a little less smooth with it on.
- **Where:** Settings › Writing › Pressure-sensitive pens
- **Words:** pressure, pressure sensitivity, thickness, line width varies, fountain pen pressure, brush pressure
- **Seen as:** lines all the same thickness, no pressure, pressure not working, strokes too thick
- **Settings:** `pressureWidth`
- **Tip:** `pressure`

### Pencil tilt (shading)

- **Id:** `settingPencilTilt`
- **What:** Off by default. On: hold the Pencil flat and the brush pen paints up to three times wider, for shading. Only pens that report tilt (Apple Pencil does).
- **Where:** Settings › Writing › Pencil tilt
- **Words:** tilt, shading, pencil angle, flat pencil, brush tilt
- **Settings:** `pencilTilt`
- **Tip:** `pencilTilt`

### Cursor over the page

- **Id:** `settingPenCursor`
- **What:** The pointer shown over the page while a pen is in hand: Ink dot (default), Crosshair, Arrow or None.
- **Where:** Settings › Writing › Cursor over the page
- **Notes:** Desktop only: there is no pointer on a tablet.
- **Words:** cursor, pointer, mouse pointer, crosshair, ink dot
- **Seen as:** cursor not showing, arrow instead of pen cursor, no dot under the pen
- **Settings:** `penCursor`

### Custom colours in the pen's colour row

- **Id:** `settingCustomColors`
- **What:** Hex codes with commas (#ff8800, #00ccaa); up to four join the pen's colour row and the colour picker.
- **Where:** Settings › Writing › Custom colors
- **Words:** custom colours, custom colors, hex, own colour, add colour, colour row, palette
- **Settings:** `customColors`

### Page appearance (dark pages)

- **Id:** `settingPageAppearance`
- **What:** Light, Dark or Match Obsidian. Dark turns paper dark and ink light on screen only: saved ink, exports and prints stay in their true colours. Whether PDF pages invert and the desk colour are in the notebook's ⋯ menu.
- **Where:** Settings › Pages › Page appearance
- **Words:** dark mode, dark pages, night mode, black paper, light paper, page colour, theme pages, invert
- **Settings:** `pageAppearance`
- **Tip:** `darkDesk`

### Paper width

- **Id:** `settingPaperWidth`
- **What:** The page's width in pixels before it is fitted to the screen (320 to 4096, default 1024).
- **Where:** Settings › Pages › Paper width
- **Words:** paper width, page width, page size pixels, resolution
- **Settings:** `paperWidth`

### Where new notebooks go

- **Id:** `settingNewNotebookFolder`
- **What:** The folder the New notebook dialog puts notebooks in. Empty: the folder of the note that is open. PDFs shared into the FineNotes inbox also become notebooks here.
- **Where:** Settings › Pages › New notebooks go in
- **Words:** new notebook folder, default folder, location, save location, where notebooks are saved
- **Settings:** `newNotebookFolder`

### Each notebook gets its own folder

- **Id:** `settingOwnFolder`
- **What:** On (default): a new notebook gets a folder named after it, holding it and its pictures, recordings, transcripts, AI chats and exports. Existing notebooks stay as they are.
- **Where:** Settings › Pages › Each notebook gets its own folder
- **Words:** own folder, notebook folder, attachments, pictures folder, tidy vault
- **Settings:** `notebookOwnFolder`

### Apple Shortcuts: Home Screen button and PDFs from the share sheet

- **Id:** `settingShortcutsApp`
- **What:** Two Apple Shortcuts: New notebook (a Home Screen button) and New FineNotes notebook in the share sheet, which saves a shared PDF to the FineNotes inbox and opens it as a notebook.
- **Where:** Settings › Pages › Shortcuts app (Add the New notebook shortcut, Add the PDF to notebook shortcut)
- **Notes:** Apple devices only (iPad, iPhone, Mac).
- **Words:** shortcuts app, siri shortcut, home screen, share sheet, share pdf, open in finenotes, widget, ios shortcut

### FineNotes in Obsidian's file list

- **Id:** `settingFileList`
- **What:** New notebook in the right-click menu (right-click a folder to make a notebook in it), Library button in the file explorer (opens Home), and Show notebook folders as notebooks (a notebook's folder opens the notebook; its arrow shows its files). All on by default.
- **Where:** Settings › Pages › In Obsidian's file list
- **Words:** file explorer, right click, context menu, new notebook in folder, library button, notebook folders
- **Settings:** `showNewNotebookInContextMenu`, `showNewNotebookInExplorer`, `folderNotebooks`

### Changing keyboard shortcuts

- **Id:** `settingShortcuts`
- **What:** Tap a shortcut and press a key, mouse button, pen button or media key to record it. A tool's key can be set to Hold. Two shortcuts on one key both stop until one changes. Reset all shortcuts brings back FineNotes' own. Kept on this device only.
- **Where:** Settings › Shortcuts
- **Words:** change shortcut, record key, rebind, hold key, reset shortcuts, keys clash
- **Tip:** `shortcutSheet`

### Read handwriting with (Grape)

- **Id:** `settingReadHandwriting`
- **What:** Off, Grape (default) or Your model. FineNotes reads your notebooks on the device so search, links and titles find handwriting; nothing leaves the device. Grape (handwriting recognizer model) is FineNotes' own model, downloaded once; Your model is Grape after learning your writing. It is in beta and misreads some words.
- **Where:** Settings › Reading and voice › Read handwriting with
- **Words:** read handwriting, grape, handwriting recognition, on device, search handwriting, ocr handwriting, your model
- **Settings:** `handwritingOnDevice`, `useLearnedHandwriting`

### Underline words it may have misread (experimental)

- **Id:** `settingUnderlineMisread`
- **What:** Experimental, off by default. A dotted underline marks words Grape is unsure of; tap one with a finger to correct, confirm or ignore it, and your answers help it learn.
- **Where:** Settings › Reading and voice › Underline words it may have misread
- **Notes:** Shown only while Read handwriting with is not Off.
- **Words:** underline, misread, correct reading, wrong word, spell check handwriting, correction
- **Settings:** `checkHandwrittenWords`
- **Tip:** `correctWord`

### Calculate lines that end in =

- **Id:** `settingCalcNotes`
- **What:** On by default. Write a calculation such as 12x4 = and lift the pen: the answer appears after the =. x between numbers means times. Tap the answer to write it in, in your own hand once the symbol practice sheet is written. A line above such as a = 5 can be used.
- **Where:** Settings › Reading and voice › Calculate lines that end in =
- **Notes:** Needs Read handwriting with on (Grape), which reads the sum on the device.
- **Words:** calculation, calculate, maths, math, sum, arithmetic, equals, answer, solve, calc notes, handwritten maths
- **Settings:** `calcNotes`
- **Tip:** `calc`

### Add up columns of numbers (experimental)

- **Id:** `settingColumnSums`
- **What:** Experimental, on by default. Draw a line under a column of handwritten amounts: the column glows; tap it to see the amounts and total, and Write puts the total under the line. One line is a subtotal, two a grand total; a leading dash subtracts.
- **Where:** Settings › Reading and voice › Add up columns of numbers
- **Notes:** Needs Read handwriting with on.
- **Words:** column sum, add up, total, sum column, amounts, bookkeeping, subtotal
- **Settings:** `columnSums`
- **Tip:** `sumGlow`

### Learn your handwriting

- **Id:** `settingLearnHandwriting`
- **What:** Write a few practice sheets (at least 10 lines) and FineNotes tunes Grape to your handwriting, on the device. The button names the next step: Write sheet 1, Learn now, or Open.
- **Where:** Settings › Reading and voice › Learn your handwriting. Or the commands Write a handwriting practice set and Learn my handwriting from the practice files.
- **Words:** learn handwriting, train, practice sheet, personal model, improve recognition, your model
- **Commands:** `write-handwriting-practice`, `learn-handwriting`
- **Tip:** `learnWriting`

### Models on this device (download or remove)

- **Id:** `settingModels`
- **What:** The models that run on the device: Voice (Whisper, for transcribing recordings), Handwriting (Grape), your own handwriting model, and Scanned pages (reading printed PDF pages). Each shows its state with Download, or ⋯ to re-download or remove it. Nothing they read or hear leaves the device.
- **Where:** Settings › Reading and voice › Models on this device
- **Words:** download model, models, whisper, voice model, grape download, remove model, storage, disk space, ocr model

### Voice model size and spoken language

- **Id:** `settingVoiceModel`
- **What:** The size of the on-device voice model (tiny is quickest, base the default; bigger reads better and takes longer) and the spoken language (Detect, or one language).
- **Where:** Settings › Reading and voice › Size and language
- **Notes:** Small and turbo are offered on desktop only; an iPad uses base.
- **Words:** whisper size, voice model, spoken language, transcription language, tiny, base, small, turbo, accuracy
- **Settings:** `speechModel`, `speechLanguage`

### AI service, model and key

- **Id:** `settingAiService`
- **What:** Which AI service answers and transcribes with your own key: Anthropic (Claude, default), OpenAI (GPT), Google (Gemini), OpenRouter (any model) or Custom endpoint (any OpenAI-compatible server, such as Ollama or LM Studio). AI model empty means the service's default (Claude Sonnet 5.5 for Anthropic). The key row adds, replaces or removes the key.
- **Where:** Settings › AI › AI service, AI model, and the API key row. Custom endpoint adds Endpoint URL; OpenRouter adds Connect OpenRouter.
- **Notes:** Keys are kept in this device's keychain: enter them on each device. An iPad often refuses plain http:// servers; serve them over https.
- **Words:** ai service, provider, anthropic, openai, google, gemini, openrouter, custom endpoint, ollama, lm studio, model, api key
- **Settings:** `llmVendor`, `llmModel`, `llmBaseUrl`

### Handwriting recognition (transcribe with AI)

- **Id:** `settingRecognitionProvider`
- **What:** What the Transcribe this notebook's handwriting command uses: Manual (default; you type the text yourself in the text layer), Cloud AI (an image of each page goes to your AI service), or Cloud AI by itself after you write (a page once you turn away from it or after 5 minutes without writing, only changed pages).
- **Where:** Settings › AI › Handwriting recognition
- **Notes:** Separate from Grape, which reads on the device for search.
- **Words:** handwriting recognition, transcribe notebook, cloud ai transcription, text layer, automatic transcription
- **Settings:** `recognitionProviderId`, `autoRecognize`
- **Commands:** `recognize-handwriting`

### Transcribe recordings with

- **Id:** `settingSpeechService`
- **What:** This device (default, offline, Whisper) or an online service with your key: Groq, OpenAI, OpenRouter, Google (Gemini) or your own server. An online service shows its model, server URL and key rows.
- **Where:** Settings › AI › Transcribe recordings with
- **Words:** transcribe recordings, speech to text service, groq, whisper online, own transcription server
- **Settings:** `speechService`, `speechServiceModel`, `speechBaseUrl`

### Ask AI can read (other notes)

- **Id:** `settingAskReach`
- **What:** Which other notes Ask AI may search and read: This notebook only, This notebook's folder (default, with its subfolders), or The whole vault. Search runs on the device; only what it reads is sent.
- **Where:** Settings › AI › Ask AI can read. Also the folder button at the top of the Ask AI chat.
- **Words:** ask ai reach, vault access, read other notes, context, folder, whole vault, privacy ai
- **Settings:** `askVaultScope`

### Show what each answer cost

- **Id:** `settingAskCost`
- **What:** Off by default. On: an estimate of each Ask AI answer's cost under it, from its tokens.
- **Where:** Settings › AI › Show what each answer cost
- **Words:** cost, price, tokens, spending, how much, usage
- **Settings:** `askShowCost`

### Skip compressed providers (OpenRouter)

- **Id:** `settingSkipCompressed`
- **What:** Off by default. On: OpenRouter skips providers that run cheaper, less accurate copies of a model.
- **Where:** Settings › AI › Skip compressed providers
- **Notes:** Shown only with OpenRouter.
- **Words:** openrouter quantized, compressed, fp4, accuracy, cheaper providers
- **Settings:** `openRouterSkipCompressed`

### Image generation service

- **Id:** `settingImageService`
- **What:** Who makes pictures for Generate image: Same as the AI service, OpenAI (GPT Image), Google (Gemini) or OpenRouter, with its own model and key rows. Claude and self-hosted servers cannot make pictures.
- **Where:** Settings › AI › Image generation
- **Words:** image generation, generate image, dall-e, gpt image, gemini image, nano banana, picture ai
- **Settings:** `imageVendor`, `imageModel`

### Folders for stickers, templates and the template gallery

- **Id:** `settingAssetsFolders`
- **What:** Your Stickers and Templates folders sit in the Assets folder (FineNotes assets). Template gallery: empty uses FineNotes' own gallery on GitHub, or the address of another gallery.
- **Where:** Settings › Files and folders › Stickers and templates
- **Words:** assets folder, stickers folder, templates folder, template gallery url
- **Settings:** `assetsFolder`, `stickerFolder`, `templateFolder`, `templateGalleryUrl`

### Folders for pictures, recordings, AI chats and exports

- **Id:** `settingAttachmentFolders`
- **What:** For notebooks without their own folder: where inserted pictures and imported PDFs, recordings (with their transcripts), saved AI chats and PDF exports go. Empty uses the default shown. A notebook with its own folder keeps its files there.
- **Where:** Settings › Files and folders › For notebooks without their own folder
- **Words:** attachments folder, pictures folder, recordings folder, chats folder, exports folder, where are files saved
- **Settings:** `imagesFolder`, `recordingsFolder`, `chatsFolder`, `exportsFolder`

### Input debug overlay (missing strokes)

- **Id:** `settingDebugOverlay`
- **What:** Prints the raw pen and touch events over the page. Turn it on when reporting strokes that go missing or break.
- **Where:** Settings › Troubleshooting › Input debug overlay, or the command Show or hide the input debug overlay.
- **Words:** debug, missing strokes, strokes disappear, broken lines, troubleshooting, lag, input problems
- **Seen as:** lag, laggy, slow, choppy, stutter, delay, strokes missing, ink appears late
- **Settings:** `debugHud`
- **Commands:** `toggle-input-debug-overlay`

### iPad Scribble swallows strokes

- **Id:** `scribbleOff`
- **What:** iPadOS Scribble can take a fast Apple Pencil stroke before FineNotes sees it, so strokes go missing. Switch Scribble off in the iPad's Settings › Apple Pencil › Scribble.
- **Where:** iPad Settings › Apple Pencil › Scribble. FineNotes' settings show this as a note on the iPad until dismissed.
- **Notes:** iPad only.
- **Words:** scribble, missing strokes, strokes missing ipad, fast strokes lost, apple scribble, handwriting to text ipad
- **Seen as:** strokes missing, pen skips, strokes disappear, letters dropped, ink cut short, handwriting turns into text
