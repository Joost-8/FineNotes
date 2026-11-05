/** English texts for the settings area. Every key starts with "settings.". See ../README.md. */
export const settings = {
  // --- Section headings, and their folding ---
  "settings.writing.heading": "Writing",
  "settings.shortcuts.heading": "Shortcuts",
  "settings.pages.heading": "Pages and notebooks",
  "settings.models.heading": "Models on this device",
  "settings.ai.heading": "AI and handwriting",
  "settings.advanced.heading": "Advanced",
  "settings.section.fold": "Fold {heading}",
  "settings.section.unfold": "Unfold {heading}",
  "settings.moreAbout": "More about this",

  // --- Callouts ---
  "settings.callout.scribble.title": "iPad: switch off Scribble so no strokes go missing",
  "settings.callout.scribble.detail":
    "Scribble, the iPadOS handwriting feature, can take a fast Apple Pencil stroke for itself before FineNotes sees it. Switch it off in the iPad's Settings app, under Apple Pencil → Scribble.",
  "settings.callout.incompleteUrl.title": "This endpoint URL is not complete",
  "settings.callout.incompleteUrl.detail":
    "Type the whole address, starting with http:// or https://, such as http://localhost:11434/v1 or https://server.your-tailnet.ts.net/v1.",
  "settings.callout.plainHttp.title": "iPhone and iPad often refuse plain HTTP",
  "settings.callout.plainHttp.detail":
    "To reach this server from a phone or tablet, serve it over HTTPS, for instance with “tailscale serve” or a Cloudflare Tunnel (SELF_HOSTING.md shows how). And on an iPad, “localhost” is the iPad itself, not your server.",
  "settings.callout.pressure.title": "Writing is less smooth with pressure on",
  "settings.callout.pressure.detail":
    "A line whose width changes is drawn as short pieces of one width each: slower to draw on a full page, and close up the pieces can show. Switch it off if writing feels less fluid.",
  "settings.callout.noKeychain.title": "API keys are stored in this vault's plugin data",
  "settings.callout.noKeychain.detail":
    "This Obsidian version has no keychain. Obsidian 1.11.4 and newer keep keys outside the vault's files.",

  // --- Update available ---
  "settings.update.out": "FineNotes {version} is out",
  "settings.update.button": "Update",
  "settings.update.tip": "Open FineNotes in Community plugins to update it",

  // --- Writing ---
  "settings.startWith.name": "Start with",
  "settings.startWith.tool": "Tool",
  "settings.startWith.size": "Stroke size",
  "settings.writing.status": "{tool} · {width}",
  "settings.writing.more.mobile": "Text boxes, colors, lasso",
  "settings.writing.more.desktop": "Text boxes, colors, lasso, cursor",
  "settings.tool.pen": "Pen",
  "settings.tool.highlighter": "Highlighter",
  "settings.tool.eraser": "Eraser",
  "settings.tool.select": "Select",
  "settings.savedPens.name": "Saved pens",
  "settings.savedPens.info":
    "Up to eight pens with their own type, colour and width, picked from the star in the pen's toolbar or with the keys 1 to 8. Add one with + here or with that star; tap one to change it. The arrow restores FineNotes' own eight.",
  "settings.savedPens.full": "Saved pens are full ({max})",
  "settings.savedPens.add": "Add a pen",
  "settings.savedPens.restoreTip": "Restore the default pens",
  "settings.savedPens.restoreTitle": "Restore the default pens?",
  "settings.savedPens.restoreMessage": "Your saved pens are replaced by FineNotes' own eight.",
  "settings.savedPens.restore": "Restore",
  "settings.savedPens.penLabel": "Pen {number}: {label}",
  "settings.fingerTapUndo.name": "Two-finger double-tap to undo",
  "settings.fingerTapUndo.desc": "Three fingers redo.",
  "settings.textDragSize.name": "Drag to size text boxes",
  "settings.textDragSize.info":
    "With the Text tool, drag on the page to draw a new text box's size. Off, every new box fits its text as you type. A tap makes a box either way.",
  "settings.customColors.name": "Custom colors",
  "settings.customColors.info":
    "Your own colors, as hex separated by commas, such as #ff8800, #00ccaa. Each keeps a spot in the pen's color row, after the default ink color (four at most), and appears in the color picker.",
  "settings.lassoTouches.name": "Lasso takes what it touches",
  "settings.lassoTouches.info":
    "On (the default), the lasso takes a stroke or shape when any part of it is inside the loop or touches its line, as Notability does. Off, at least half of it must be inside, as in Goodnotes. Pictures and text boxes are taken by their middle either way.",
  "settings.penCursor.name": "Cursor over the page",
  "settings.penCursor.info":
    "On a computer, the pointer over the page while a pen, the highlighter or the laser is in hand: a dot in the ink colour as wide as the pen writes, a small crosshair, the arrow, or none at all (the laser keeps its point).",
  "settings.penCursor.ink": "Ink dot",
  "settings.penCursor.crosshair": "Crosshair",
  "settings.penCursor.arrow": "Arrow",
  "settings.penCursor.none": "None",

  // --- Shortcuts ---
  "settings.shortcuts.title": "Keyboard and stylus shortcuts",
  "settings.shortcuts.hint":
    "Press ? to show or hide this list. None of them act while you type in a text box.",
  "settings.shortcuts.more": "Editing, view, toolbar, saved pens",
  "settings.shortcuts.clash": "Clash",
  "settings.shortcuts.changed": "{count} changed",
  "settings.shortcuts.conflict": "Two shortcuts share a key; neither works",
  "settings.shortcuts.conflictLine": "{keys}: {names}",
  "settings.shortcuts.nameJoin": "{a} and {b}",
  "settings.shortcuts.conflictJoin": "{a}. {b}",
  "settings.shortcuts.conflictDetail": "{conflicts}. Change or reset one of them.",
  "settings.shortcuts.resetTip": "Reset to FineNotes' own key",
  "settings.shortcuts.holdOn": "Only while the key is held",
  "settings.shortcuts.holdOff": "Hold the key to use the tool",
  "settings.shortcuts.slotLabel": "{action}: {keys}",
  "settings.shortcuts.or": "or",
  "settings.shortcuts.recordLabel": "{action}: press the new key",
  "settings.shortcuts.recording": "Press a key or button",
  "settings.shortcuts.resetAll": "Reset all shortcuts",
  "settings.shortcuts.reset": "Reset",
  "settings.shortcuts.resetTitle": "Reset every shortcut on this device?",
  "settings.shortcuts.resetMessage":
    "Every key goes back to FineNotes' own. Other devices keep theirs.",
  "settings.shortcuts.info":
    "Tap a key to record a new one; Escape or a tap anywhere cancels. The keys are kept on this device only, so a laptop and a tablet each have their own. A tool with the hand icon on is in hand only while its key is held, then the tool before it is back. Two shortcuts on one key both stop until one of them changes. None act while you type in a text box; ? in a notebook lists them all.",
  "settings.barrel.name": "Stylus side button",
  "settings.barrel.info":
    "What a pen tablet's side button does while you write with it. The eraser end of the pen always erases.",
  "settings.barrel.erase": "Erase",
  "settings.barrel.lasso": "Lasso select",
  "settings.barrel.pan": "Move the page",
  "settings.barrel.none": "Nothing",
  "settings.stylusClick.name": "Side button click",
  "settings.stylusClick.info":
    "What a click of the side button does with the pen held just above the page, not touching it. A second click closes the menu again.",
  "settings.stylusClick.penMenu": "Open the pen menu",
  "settings.stylusClick.none": "Nothing",

  // --- Pages and notebooks ---
  "settings.pages.status": "{appearance} · {width} px",
  "settings.pages.more": "Folders, templates, file explorer",
  "settings.pageAppearance.name": "Page appearance",
  "settings.pageAppearance.info":
    "Show pages dark for writing at night: the paper turns dark and ink light, keeping its color. Only the view changes: ink is saved, exported and printed in its true color, and pictures are left as they are. Whether PDF pages turn dark too, and the desk around the pages, are in the notebook's ⋯ menu.",
  "settings.pageAppearance.light": "Light",
  "settings.pageAppearance.dark": "Dark",
  "settings.pageAppearance.system": "Match Obsidian",
  "settings.paperWidth.name": "Paper width",
  "settings.paperWidth.desc": "In pixels, before it is fitted to the screen.",
  "settings.paperWidth.error": "Use {min} to {max}; the last valid width is kept until then.",
  "settings.notebookFolder.name": "New notebooks go in",
  "settings.notebookFolder.info":
    "Where the New notebook dialog puts new notebooks and pages. Leave empty to use the folder of the note that is open. Notebooks made from PDFs in the FineNotes inbox go here too, or to the vault's root when this is empty.",
  "settings.notebookFolder.placeholder": "Folder of the open note",
  "settings.shortcutsApp.name": "Shortcuts app",
  "settings.shortcutsApp.info":
    "Two shortcuts for Apple's Shortcuts app. The notebook adds “New notebook”, a button for your Home Screen that opens the New notebook window. The other adds “New FineNotes notebook” to the share sheet: share a PDF from any app and it opens as a notebook. It saves the PDF in the FineNotes inbox, a folder FineNotes keeps at the vault's root and hides in the file list; when Shortcuts asks for a folder, or in the shortcut's Save File step, pick that folder in your vault. A PDF you save there yourself becomes a notebook too.",
  "settings.shortcutsApp.addNotebook": "Add the New notebook shortcut",
  "settings.shortcutsApp.addPdf": "Add the PDF to notebook shortcut",
  "settings.notebookOwnFolder.name": "Each notebook gets its own folder",
  "settings.notebookOwnFolder.info":
    "A folder named after the notebook, holding it and the folders its pictures, recordings, transcripts, AI chats and exports go in. Off: just the notebook file. Notebooks you already have stay as they are.",
  "settings.stickerFolder.name": "Stickers folder",
  "settings.stickerFolder.info":
    "Where your own stickers live, one folder per collection. Stickers you save from a selection go into “My stickers” there.",
  "settings.templateFolder.name": "Templates folder",
  "settings.templateFolder.info":
    "Where Save as template puts .finetemplate files, and New notebook from template looks first.",
  "settings.templateGallery.name": "Template gallery",
  "settings.templateGallery.placeholder": "FineNotes' own gallery",
  "settings.templateGallery.info":
    "Where Browse template gallery looks. Empty: FineNotes' own gallery on GitHub. Or the address of another gallery's index (a JSON file listing templates).",
  "settings.newNotebookContextMenu.name": "New notebook in the right-click menu",
  "settings.newNotebookContextMenu.info":
    "Add New notebook to the file explorer menu. New notebooks start in the selected folder.",
  "settings.libraryExplorer.name": "Library button in the file explorer",
  "settings.libraryExplorer.info":
    "Add a button that opens the notebook library, beside New note and New folder in the file explorer.",
  "settings.simpleLook.name": "Simple look",
  // Superseded by settings.simpleLook.infoFolders (a Folders sidebar is shown). Kept so
  // the locale files, which still name this key, stay valid; no longer shown.
  "settings.simpleLook.info":
    "Hide Obsidian's title bar, status bar, left ribbon and sidebars, and keep the tabs, so FineNotes looks like an app of its own. Turn it off here to bring them back.",
  "settings.folderNotebooks.name": "Show notebook folders as notebooks",
  "settings.folderNotebooks.info":
    "In the file explorer, a notebook with its own folder shows as that folder: tap its name to open the notebook, or its arrow for its pictures, recordings and other files. Renaming one renames the other.",

  // --- Advanced ---
  "settings.advanced.pressureOn": "Pressure on",
  "settings.advanced.tiltOn": "Tilt on",
  "settings.pressure.name": "Pressure-sensitive pens",
  "settings.pressure.info":
    "Turn this on to tell the pens apart: the Fountain pen gets wider the harder you press, the Brush pen swells and tapers much more, and the Ball pen stays even. Off, every pen draws one even width, which is the smoothest to write with.",
  "settings.pencilTilt.name": "Pencil tilt",
  "settings.pencilTilt.info":
    "Hold the Pencil flat and the Brush pen paints a wider stroke, up to three times its width, for shading. Held as you write, nothing changes. Only pens and tablets that report tilt do this (the Apple Pencil does). Shaded strokes keep their width when this is off. An older FineNotes opens a notebook with them read-only.",
  "settings.desynchronized.name": "Desynchronized canvas",
  "settings.desynchronized.info":
    "Asks the browser to draw ink with less delay. Switch it off if ink looks garbled on your device; iOS WebKit has had trouble with it.",
  "settings.updates.name": "Updates",
  "settings.updates.info":
    "Once a day, FineNotes reads the number of its newest release from GitHub (github.com/Joost-8/FineNotes) and puts a dot on the toolbar's gear when it is newer. With Remind me, \"Update available\" also pops up under the gear every other day until you update. Nothing about you or your notes is sent. Updating is still Obsidian's: its Update button, under Community plugins.",
  "settings.updates.remind": "Remind me",
  "settings.updates.dot": "Dot on the gear",
  "settings.debugHud.name": "Input debug overlay",
  "settings.debugHud.info":
    "Print the raw pen and touch events over the page: their order, coalesced samples, gaps in time and stroke counts. Turn it on when reporting strokes that go missing or break.",
  "settings.hwrModelFile.name": "Handwriting model file",
  "settings.hwrModelFile.info":
    "Leave blank to use Grape (handwriting recognizer model). Or give the vault path of another model file, such as one tuned to your handwriting. It is read on this device only.",
  "settings.advanced.more": "Where files are saved",
  "settings.folders.note":
    "For notebooks without a folder of their own; a notebook with its own folder keeps its files there. Leave empty for the default.",
  "settings.folders.info": "{desc} {note}",
  "settings.folders.images.name": "Folder for pictures and PDFs",
  "settings.folders.images.desc":
    "Inserted, pasted, scanned and generated pictures, and imported PDFs.",
  "settings.folders.images.placeholder": "Obsidian's attachment folder",
  "settings.folders.recordings.name": "Folder for recordings",
  "settings.folders.recordings.desc": "Audio recorded with the microphone button.",
  "settings.folders.recordings.placeholder": "Obsidian's attachment folder",
  "settings.folders.transcripts.name": "Folder for recording transcripts",
  "settings.folders.transcripts.desc": "Notes made by transcribing a recording.",
  "settings.folders.transcripts.placeholder": "Next to the recording",
  "settings.folders.chats.name": "Folder for AI chats",
  "settings.folders.chats.desc": "Ask AI conversations you save.",
  "settings.folders.chats.placeholder": "AI chats, next to the notebook",
  "settings.folders.exports.name": "Folder for PDF exports",
  "settings.folders.exports.desc": "PDFs made with the share button.",
  "settings.folders.exports.placeholder": "Next to the notebook",

  // --- AI and handwriting ---
  "settings.ai.status": "{reader} · {service}",
  "settings.ai.notSetUp": "AI not set up",
  "settings.ai.setUp.name": "Set up an AI service",
  "settings.ai.setUp.desc": "Transcribe, ask and make pictures with your own key.",
  "settings.ai.show": "Show",
  "settings.ai.hide": "Hide",
  "settings.ai.service.name": "AI service",
  "settings.ai.service.info":
    "Transcribes pages and answers your questions about them, with your own API key. Nothing is sent until you start an AI action, and the first one asks first.",
  "settings.ai.endpointKey": "Endpoint API key",
  "settings.ai.keyName": "{service} API key",
  "settings.ai.imageKeyName": "{service} API key for images",
  "settings.ai.empty": "Empty: {model}",
  "settings.ai.endpointUrl.name": "Endpoint URL",
  "settings.ai.endpointUrl.info":
    "The base URL of an OpenAI-compatible server, with /v1 if the server uses it. Ollama, LM Studio, llama.cpp, vLLM and LocalAI all work; SELF_HOSTING.md in the plugin's repository walks through the setup. For Ask to read pages, pick a vision model; for it to use the notebook (search, add text boxes and pages, draw), the model and server must support tool calling (llama.cpp: start it with --jinja).",
  "settings.openRouter.name": "Connect OpenRouter",
  "settings.openRouter.connect": "Connect OpenRouter",
  "settings.openRouter.reconnect": "Reconnect",
  "settings.openRouter.info":
    "Get a key for your OpenRouter account from the browser, without copying and pasting it. You approve it on openrouter.ai, and nothing is sent before you do.",
  "settings.aiModel.name": "AI model",
  "settings.aiModel.info":
    "For transcription and questions. Leave empty for the default ({model}). Any model that reads images will do; a cheaper one, such as claude-haiku-4-5, saves money at some cost in accuracy.",
  "settings.recognition.name": "Handwriting recognition",
  "settings.recognition.info":
    "What the “Recognize handwriting” command and automatic recognition use. Manual = you type the transcription; Cloud AI sends an image of each page to the AI service above. The AI menu's Transcribe entries always use AI.",
  "settings.autoRecognize.name": "Recognize automatically",
  "settings.autoRecognize.info":
    "Transcribe the page you are writing on in the background about 30 seconds after you stop, and only when it actually changed. Requires the one-time consent (run a transcription by hand once first).",
  "settings.ai.more.openrouter": "OpenRouter providers; Ask's page; pictures and their key",
  "settings.ai.more.other": "Ask's page; pictures: service, model and key",
  "settings.askAttachPage.name": "Ask AI starts on the open page",
  "settings.askAttachPage.info":
    "A new chat in Ask AI starts with the page you are on picked, so the first question is about it. Off (the default), it starts with no page: pick pages in the chat, attach a file, or select something with the lasso and choose Ask AI.",
  "settings.openRouterSkipCompressed.name": "Skip compressed providers",
  "settings.openRouterSkipCompressed.info":
    "OpenRouter serves a model through several providers. Some run compressed (fp4) versions that are cheaper but read handwriting less accurately. This skips the ones that say they are compressed, and OpenRouter picks among the rest as usual. A model that only compressed providers serve then gives no answer.",
  "settings.imageVendor.name": "Image generation",
  "settings.imageVendor.info":
    "Who makes pictures for “Generate image”. Claude and self-hosted endpoints cannot, so with those pick OpenAI, Google or OpenRouter here and add that service's key.",
  "settings.imageVendor.same": "Same as the AI service",
  "settings.imageModel.name": "Image model",
  "settings.reader.mine": "Your model",
  "settings.readWith.name": "Read handwriting with",
  "settings.readWith.info":
    "Reads your notebooks on this device, so search, links and titles find your handwriting; nothing leaves the device. Grape is FineNotes' own model; your model is Grape after it learned your handwriting from the practice sheets (Learn your handwriting, below). In beta: it misreads some words, more so in small or hurried writing.",
  "settings.checkWords.name": "Underline words it may have misread",
  "settings.checkWords.info":
    "A test. After a page is read, words it is not sure of get a dotted underline. Tap one with a finger to correct the reading, confirm it, or ignore the word; learning your handwriting uses your answers too. Uses the word list built into FineNotes, plus your own words.txt in the plugin's handwriting folder.",
  "settings.calcNotes.name": "Calculate lines that end in =",
  "settings.calcNotes.info":
    "Write a sum ending in = (12x4 =; an x between numbers is times) and lift the pen: FineNotes reads the line on this device and shows what it read and the answer beside it. Tap that to write the answer after the =, at your writing's size, in your own hand once you have written the symbol practice sheet (a command); keep writing to leave the page as it was. A letter set on a line above (a = 5) can be used. Check what it read before you tap: a misread digit gives a wrong answer.",
  "settings.learn.name": "Learn your handwriting",
  "settings.learn.open": "Open",

  // --- API keys ---
  "settings.key.set": "Set",
  "settings.key.notSet": "Not set",
  "settings.key.notSetOptional": "Not set (optional)",
  "settings.key.add": "Add key",
  "settings.key.replace": "Replace",
  "settings.key.usuallyEmpty": "(usually empty)",
  "settings.key.whereKeychain":
    "Saved in Obsidian's keychain on this device, not in the vault's files.",
  "settings.key.whereVault": "Saved in this vault's plugin data.",
  "settings.key.endpointInfo":
    "Optional — most self-hosted servers don't need one. Kept apart from your cloud keys and sent only to your endpoint.",
  "settings.key.image.keychain":
    "Your own {service} key, used only to generate images. Kept in Obsidian's keychain (Settings → Keychain), outside this vault's files; sent only to {service}.",
  "settings.key.image.vault":
    "Your own {service} key, used only to generate images. Stored in this vault's plugin data; sent only to {service}.",
  "settings.key.text.keychain":
    "Your own key. Kept in Obsidian's keychain (Settings → Keychain), outside this vault's files; sent only to {service}, and only when you start an AI action.",
  "settings.key.text.vault":
    "Your own key. Stored in this vault's plugin data; sent only to {service}, and only when you start an AI action.",
  "settings.key.removeTitle": "Remove the {service} key?",
  "settings.key.removeEndpointTitle": "Remove the endpoint key?",
  "settings.key.removeMessage":
    "AI features that need it stop working on this device until you add a key again.",

  // --- Models on this device ---
  "settings.models.intro": "They run here: nothing they read or hear leaves this device.",
  "settings.models.purpose.voice":
    "Whisper (speech recognizer model) turns recordings into text when you pick “Transcribe on this device” on a recording.",
  "settings.models.purpose.grape":
    "Grape (handwriting recognizer model) reads your handwriting: notebook search and Obsidian's search find it, and a lassoed heading or word fills in its title or link.",
  "settings.models.purpose.learned":
    "Grape tuned to your own handwriting, learned on this device from the practice sheets you write (Learn your handwriting, under AI and handwriting).",
  "settings.models.downloadsOnce":
    "It downloads once, the first time it is needed, and runs on this device only.",
  "settings.models.withDownload": "{purpose} {download}",
  "settings.models.voiceRow": "Voice · {voice}",
  "settings.models.grapeRow": "Handwriting · Grape {version}",
  "settings.models.learnedName": "Your handwriting model",
  "settings.models.statusVoice": "Voice",
  "settings.models.statusHandwriting": "Handwriting",
  "settings.speech.name": "Size and language",
  "settings.speech.info.mobile":
    "Tiny is quickest; base is more accurate and the default. Small and large-v3-turbo are offered on desktop only: they need more memory than an iPad has to spare. When a computer chose one, this iPad uses base. A new size downloads the first time you use it. For long lectures an AI key or your own server is faster. Detect finds the language of most recordings; choosing it helps with short ones.",
  "settings.speech.info.desktop":
    "Tiny is quickest; base is more accurate and the default. Small is more accurate and about three times slower than base. Large-v3-turbo is the most accurate and very slow here: a recording takes about seven times its length to transcribe, so it takes recordings up to 20 minutes. It stays on this computer, outside the vault, so it never syncs to an iPad, which uses base instead. A new size downloads the first time you use it. For long lectures an AI key or your own server is faster. Detect finds the language of most recordings; choosing it helps with short ones.",
  "settings.speech.sizeLabel": "Voice model size",
  "settings.speech.languageLabel": "Spoken language",
  "settings.models.redownloadOrRemove": "Re-download or remove",
  "settings.models.redownload": "Re-download",
  "settings.models.looking": "Looking for it…",
  "settings.models.withSize": "{status} · {size}",
  "settings.models.goBack": "Go back to the previous model",
  "settings.models.deleteEllipsis": "Delete…",
  "settings.models.previousOrDelete": "Previous model or delete",
  "settings.models.deleteTitle": "Delete your learned handwriting model?",

  // --- The download card, and what's new ---
  "settings.models.theInternet": "the internet",
  "settings.models.downloading": "Downloading {label}",
  "settings.models.hide": "Hide",
  "settings.models.ready": "{label} is ready",
  "settings.models.readyDetail": "Version {version} is on this device.",
  "settings.models.failed": "{label} did not download",
  "settings.models.notNow": "Not now",
  "settings.models.needsUpdate": "{label} needs an update: a {size} download",
  "settings.models.needsDownload": "{label} needs a one-time {size} download",
  "settings.models.comesFrom": "{purpose} It comes from {host} once.",
  "settings.models.download": "Download",
  "settings.whatsNew.title": "What's new in FineNotes",

  // --- Feedback and community ---
  "settings.feedback.name": "Feedback and community",
  "settings.feedback.ideas": "Ideas and questions",
  "settings.feedback.bug": "Report a bug",
  "settings.feedback.support": "Support FineNotes",
  "settings.download.offline": "Downloads when you're online.",
  "settings.download.http": "GitHub did not send the file ({detail}). Try again later.",
  "settings.download.damaged": "The download arrived damaged. Try again.",
  "settings.download.storage": "The file could not be saved: {detail}",
  "settings.download.checking": "Checking…",
  "settings.download.missing": "Not downloaded yet ({size}).",
  "settings.download.outdated":
    "Version {old} is on this device; {version} is ready to download ({size}).",
  "settings.download.unusable":
    "Version {old} no longer works with this FineNotes: download {version} ({size}).",
  "settings.download.progress": "Downloading… {percent}% of {size}",
  "settings.download.verifying": "Checking the download…",
  "settings.download.ready": "Version {version}, {size}, on this device.",

  // --- Folders sidebar section (view/folder-sidebar/settings-rows.ts) ---
  "settings.folderSidebar.showFiles.name": "Show files in sidebar",
  "settings.folderSidebar.showFiles.desc":
    "List notes in the sidebar tree as well as folders. Off by default: notes are shown in the library.",
  "settings.folderSidebar.showCounts.name": "Show note counts",
  "settings.folderSidebar.showCounts.desc":
    "Show how many notes each folder holds, at the right of its row.",
  "settings.folderSidebar.showPinned.name": "Show pinned folders",
  "settings.folderSidebar.showPinned.desc":
    "Keep folders you pinned in a section at the top of the sidebar.",
  "settings.folderSidebar.showRecent.name": "Show recent folders",
  "settings.folderSidebar.showRecent.desc":
    "List the last few folders you opened under the pinned ones.",
  "settings.folderSidebar.autoColor.name": "Color new folders automatically",
  "settings.folderSidebar.autoColor.desc":
    "Off: new folders start uncolored and you choose a color when you want one. On: each new folder gets a random color.",
  "settings.folderSidebar.hideAttachments.name": "Hide attachment folders",
  "settings.folderSidebar.hideAttachments.desc":
    "Hide folders named Attachments (where imported notebooks keep their PDFs) from the sidebar and the library. They stay in the vault.",
  "settings.folderSidebar.searchNotes.name": "Search inside notes",
  "settings.folderSidebar.searchNotes.desc":
    "Type 3 or more letters in the filter box to also search the text of notes, notebooks and PDFs. Obsidian's own search cannot read inside notebooks or PDFs.",
  "settings.folderSidebar.index.name": "Search index",
  "settings.folderSidebar.index.rebuild": "Rebuild",
  "settings.folderSidebar.indexed": "{docs} files indexed ({notebooks} notebooks, {pdfs} PDFs)",
  "settings.folderSidebar.reading.one": "reading {count} more…",
  "settings.folderSidebar.reading.other": "reading {count} more…",
  "settings.folderSidebar.unsearchable.one":
    "{count} scanned PDF has no text yet (open it in FineNotes so it can read it)",
  "settings.folderSidebar.unsearchable.other":
    "{count} scanned PDFs have no text yet (open them in FineNotes so it can read them)",
  "settings.folderSidebar.tooLarge.one": "{count} PDF is too large to index",
  "settings.folderSidebar.tooLarge.other": "{count} PDFs are too large to index",
  "settings.folderSidebar.defaultView.name": "Default view",
  "settings.folderSidebar.defaultView.desc":
    "Show notes as a grid of thumbnails or as a compact list. You can also switch inside the library.",
  "settings.folderSidebar.tips.name": "Show tips again",
  "settings.folderSidebar.tips.desc": "Bring back the short tips card at the top of the sidebar.",
  "settings.folderSidebar.tips.reset": "Reset tips",
  "settings.simpleLook.infoFolders":
    "Hide Obsidian's title bar, status bar, ribbon, right sidebar and the tab bar of the left sidebar, and show a Folders sidebar on the left, so FineNotes looks like an app of its own. Turn it off here to bring them back.",
} as const;
