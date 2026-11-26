# AI, recordings and maths

Ask AI, reading handwriting, recordings and transcription, the calculator, graphs and handwritten maths.

Part of FineNotes' guide (see `README.md` here): what Ask AI looks up to answer questions about the app. Edit an entry, then run `npm run guide`.

<!-- area: ai -->

### The AI menu (sparkles button)

- **Id:** `aiMenu`
- **What:** One menu for every AI and handwriting-reading feature. Its top section, "Handwriting · on this device", works without a key: Read with, Corrections, Calculations, Learn your handwriting, Transcribe on this device (recordings), Scanned pages. Its second section, "With your own AI key", holds Ask…, Generate image…, Transcribe recording… and AI settings… (or "Set up AI…"). Without any key the key section folds into a single row.
- **Where:** Toolbar › AI (sparkles). In the Essentials preset: toolbar ⋯ › AI.
- **Notes:** The device section needs no key or internet (Grape downloads once). The key section needs an API key (or your own endpoint) and internet.
- **Words:** ai, ai menu, sparkles, artificial intelligence, assistant, chatgpt, claude, gemini, smart features, ai button
- **Settings:** `handwritingOnDevice`, `useLearnedHandwriting`, `checkHandwrittenWords`, `calcNotes`, `ocrScannedPdfs`, `llmVendor`, `imageVendor`, `speechService`

### Set up an AI service (provider, model, API key)

- **Id:** `aiServiceSetup`
- **What:** Pick the AI service that answers questions and transcribes pages: "Anthropic (Claude)" (the default; default model claude-sonnet-5-5), "OpenAI (GPT)" (gpt-4o-mini), "Google (Gemini)" (gemini-3.5-flash), "OpenRouter (any model)" (google/gemini-3.5-flash) or "Custom endpoint (OpenAI-compatible)". Then paste that service's API key, and optionally type a model id in "AI model" (empty uses the default). Each service keeps its own key and remembers its own model when you switch back.
- **Where:** Settings › AI › Service: "AI service", "AI model", "<Service> API key" (Add key / Replace). From a notebook: AI menu › "Set up AI…" or "AI settings…".
- **Notes:** Needs internet and your own paid API key; nothing is bundled.
- **Words:** api key, key, set up ai, provider, openai, anthropic, claude, gpt, gemini, google, openrouter, model, ai service, token, secret, configure ai
- **Settings:** `llmVendor`, `llmModel`, `llmModels`, `apiKeys`, `llmBaseUrl`

### A cheaper model for transcription, and a fallback model

- **Id:** `aiModelChoice`
- **What:** Transcription can use a model of its own: type it in "Page transcription model" (empty uses "AI model"), so automatic transcription can run on a cheap model while Ask AI keeps a stronger one. It can also use another service with its own API key: pick it in "Transcribe pages with" (for example Gemini for transcription while Ask uses Claude), then add that service's key in the row that appears below. "Fallback model" is tried once when the model is turned down for its rate limit or quota (also when OpenRouter credits run out or Claude is overloaded), for transcription and Ask alike; a wrong key or any other error is shown at once. The fallback is a model of the AI service, so it is not used when transcription has a service of its own. Each service remembers its own models.
- **Where:** Settings › AI › Transcribing › "Transcribe pages with", "Page transcription model" and "<Service> API key for transcription". Settings › AI › Service › "Fallback model".
- **Notes:** In Ask AI, the fallback takes over only when the first request of an answer is turned down; once the notebook's tools have run, the answer stays with the model that began it.
- **Words:** transcription model, cheaper model, different model, second model, fallback model, backup model, rate limit, quota, 429, too many requests, out of credits, free model
- **Settings:** `transcribeVendor`, `llmTranscribeModel`, `llmFallbackModel`

### Where API keys are stored

- **Id:** `apiKeyStorage`
- **What:** On Obsidian 1.11.4 and newer, keys are kept in Obsidian's keychain on this device, outside the vault's files, and sent only to that service when you start an AI action. On older Obsidian they sit in the vault's plugin data (a callout warns). Keys typed into plain settings before FineNotes 0.5 are moved into the keychain automatically. Remove a key from its row (it asks first).
- **Where:** Settings › AI › Service › "<Service> API key" row (Add key, Replace, remove). Obsidian Settings › Keychain shows them too.
- **Notes:** The keychain is per device, so each device needs the key entered once.
- **Words:** keychain, api key safe, secret storage, where is my key, key security, remove key, delete key
- **Settings:** `apiKeys`, `llmApiKey`, `llmCustomApiKey`

### Connect OpenRouter without copying a key

- **Id:** `openRouterConnect`
- **What:** With OpenRouter chosen, "Connect OpenRouter" opens openrouter.ai in the browser; approve there and FineNotes receives and stores the key itself, then selects OpenRouter as the AI service.
- **Where:** Settings › AI › Service › AI service: OpenRouter › "Connect OpenRouter" (later "Reconnect").
- **Notes:** Needs an OpenRouter account and internet.
- **Words:** openrouter, connect, oauth, sign in, login, one click key, any model
- **Settings:** `llmVendor`, `apiKeys`

### Skip compressed OpenRouter providers

- **Id:** `openRouterSkipCompressed`
- **What:** Tells OpenRouter not to route to providers that say they run compressed (fp4) copies of a model, which read handwriting less accurately. A model served only by compressed providers then gives no answer.
- **Where:** Settings › AI › Ask AI › "Skip compressed providers" (shown only when the AI service is OpenRouter).
- **Notes:** OpenRouter only.
- **Words:** openrouter, fp4, quantized, compressed, provider, accuracy
- **Settings:** `openRouterSkipCompressed`

### Use a local or self-hosted AI (Ollama, LM Studio, llama.cpp)

- **Id:** `customEndpoint`
- **What:** Choose "Custom endpoint (OpenAI-compatible)" and enter the server's base URL (with /v1 if it uses it). The endpoint key is optional and is kept apart from cloud keys. For Ask AI to see pages, use a vision model; for it to use notebook tools, the model and server must support tool calling (llama.cpp needs --jinja). If tools fail, Ask answers from what was sent without tools.
- **Where:** Settings › AI › Service › AI service: "Custom endpoint (OpenAI-compatible)" › "Endpoint URL", "Endpoint API key". The repo's SELF_HOSTING.md is referenced from the setting's text.
- **Notes:** Needs the server reachable from the device; no cloud key. Default model qwen2.5vl:7b.
- **Words:** local ai, ollama, lm studio, llama.cpp, vllm, localai, self-hosted, own server, offline ai, openai compatible, endpoint, private ai, tailscale
- **Settings:** `llmVendor`, `llmBaseUrl`, `llmModel`, `customConsentGiven`

### Ask before sending anything (one-time consent)

- **Id:** `aiConsent`
- **What:** The first AI action that would send pages, audio or a question asks "Send to a cloud AI service?" (or the self-hosted variant). After you agree once per vault, later AI actions you start send without asking. Nothing is sent unless you start it. Cloud services and your own endpoint are agreed to separately.
- **Where:** Appears automatically the first time you use Ask, transcription or similar.
- **Words:** privacy, consent, permission, send to cloud, data, what is sent, gdpr, offline
- **Settings:** `cloudConsentGiven`, `customConsentGiven`

### Ask AI about your notes (chat)

- **Id:** `askAi`
- **What:** A chat about the notebook. Pick pages (up to 10) or attach files, then ask. Answers are rendered as Markdown with Copy and "Insert as text box" buttons. Before the first question, suggestions appear, such as "Summarise this page", "Explain this step by step", "Check my work for mistakes" and "Quiz me on this page". A chat starts with no page picked. Closing the window keeps the chat, the draft and the picked pages while the notebook stays open.
- **Where:** Toolbar › AI › "Ask…". Send with the round arrow button or Return; Shift+Return adds a new line.
- **Notes:** Needs an AI service with a key (or your own endpoint) and internet. Greyed out with the reason when not set up, and "This page is empty" / "This notebook is empty" when nothing is on any page.
- **Words:** ask ai, chat, chatgpt, claude, question, explain, summarize, summarise, tutor, help me study, ai chat, ask about my notes, conversation
- **Settings:** `llmVendor`, `llmModel`, `askLayout`, `askVaultScope`, `askShowCost`

### Pick which pages Ask AI sees

- **Id:** `askPagePicker`
- **What:** The page chip at the top left opens a grid of the notebook's pages; tap up to 10 to send. Each question sends only picked pages the chat has not seen yet, so pages can be added mid-conversation. "Only this page" picks just the current one. Empty pages are marked "Page N, empty".
- **Where:** Ask window › top-left page chip ("Pick pages" / "Pages to send").
- **Notes:** needs a key.
- **Words:** pick pages, choose pages, send pages, which pages, page picker, only this page, add pages

### Send the whole notebook as one PDF to Ask AI

- **Id:** `askWholeNotebookPdf`
- **What:** For a notebook with more than 10 pages, the picker offers "Whole notebook" ("N pages, one PDF"): FineNotes renders every page into one PDF ("Making… x/y") and attaches it to the chat.
- **Where:** Ask window › page chip › "Whole notebook" row.
- **Notes:** needs a key.
- **Words:** whole notebook, entire notebook, all pages, pdf, long notebook, more than 10 pages

### Attach a file (PDF, picture, text) to Ask AI

- **Id:** `askAttachFile`
- **What:** The paperclip attaches a PDF, a picture or a text file, "From your vault…" or "From Files…" (the device picker, including Photos on the iPad). The notebook's own PDFs are offered too ("PDFs in this notebook"), so the AI reads their text and not only pictures of the pages. All of a chat's files together can be at most 20 MB, since every question sends them again.
- **Where:** Ask window › paperclip (Attach a file) › From your vault… / From Files…; or the page chip › PDFs in this notebook › Attach.
- **Notes:** needs a key.
- **Words:** attach, paperclip, upload, pdf, picture, photo, image, text file, file, document

### Ask about a lassoed part of the page

- **Id:** `askAboutSelection`
- **What:** Lasso something (or draw a lasso loop around an empty area) and choose "Ask AI": a picture of just that part is attached to the chat in place of a page, and Ask opens on it.
- **Where:** Lasso tool › select › selection bar › "Ask AI". A lasso around nothing shows a small pill with Screenshot and "Ask AI".
- **Notes:** shown only when an AI service is set up.
- **Words:** ask about selection, lasso ask, ask about this, explain this part, selected area, region
- **Tip:** `askSelection`

### Ask AI on a board (sends what is on screen)

- **Id:** `askOnBoard`
- **What:** On a board there are no pages to pick: each question sends what is on screen, and the empty chat says "Ask about what is on screen".
- **Where:** In a board › AI › Ask…
- **Notes:** needs a key.
- **Words:** board, whiteboard, canvas, infinite, on screen, ask board

### Show Ask AI as a sidebar or a window

- **Id:** `askLayout`
- **What:** The chat can be a window over the notebook or a sidebar on the left of the page, which pushes the page aside and closes the page sidebar. The window is moved by its title bar and sized from its bottom-right corner, and opens where it was left on this device. The choice is remembered. In a text note, Ask AI is always the window.
- **Where:** Ask › "Show in the sidebar" / "Show as a window" button in the chat's top bar.
- **Words:** sidebar, side panel, window, dock, layout, beside the page, move, resize, drag
- **Settings:** `askLayout`

### Where Ask AI chats are kept, and deleting one

- **Id:** `askSaveChats`
- **What:** Every Ask AI conversation is kept as a Markdown note in the "AI chats" folder of the notebook or text note it was about, and updates as you go. Open or delete one there, as any file; the chat has no save or history buttons. "New chat" starts fresh.
- **Where:** The notebook's (or note's) "AI chats" folder in the file list. Folder: Settings › Files and folders › "Folder for AI chats".
- **Words:** save chat, chat history, previous chats, conversation history, keep chat, delete chat, AI chats folder
- **Settings:** `chatsFolder`

### What Ask AI can read (this notebook, its folder, the whole vault)

- **Id:** `askVaultScope`
- **What:** Besides the open notebook, Ask AI can search your other notes, notebooks and PDFs and read the ones it needs, as text. The search runs on the device and only what is found and read is sent. Choose "This notebook only", "This notebook's folder" (the default) or "The whole vault". It can also follow this notebook's links.
- **Where:** Ask › top bar › "What Ask AI can read" button (icon changes with the choice); or Settings › AI › Ask AI › "Ask AI can read".
- **Words:** vault, other notes, context, search my notes, read other notes, privacy, folder, whole vault, reach
- **Settings:** `askVaultScope`

### Show what each Ask AI answer cost

- **Id:** `askShowCost`
- **What:** Under each answer, a small estimate of what it cost: list prices for Claude models, OpenRouter's own reported cost, a token count for other models, and nothing for your own server. The tooltip gives tokens in and out. Off by default.
- **Where:** Settings › AI › Ask AI › "Show what each answer cost".
- **Words:** cost, price, tokens, usage, how much, money, billing, spend
- **Settings:** `askShowCost`

### Put an Ask AI answer on the page

- **Id:** `askInsertAnswer`
- **What:** Each answer has "Copy" (Markdown to the clipboard) and "Insert as text box" (plain text as a text box on the page; Undo removes it). A drawing the AI gives as SVG is shown as a picture with "Insert on page".
- **Where:** Ask › under an answer: Copy · Insert as text box; under a drawing: Insert on page.
- **Words:** insert answer, paste answer, answer to page, text box, copy answer

### Ask AI edits the notebook (tools)

- **Id:** `askTools`
- **What:** While answering, the AI can act on the notebook and says what it is doing: add a text box, add a page, go to a page, draw a picture (SVG), title a page, add a contents heading, bookmark or unbookmark a page, move a page, make a table, mark part of a page (circle, box or highlight, optionally with a comment), pin a comment, and add a practice page of exam-style questions (up to 8). Each change is one undo step.
- **Where:** Ask › just ask ("make a table of…", "circle my mistake").
- **Notes:** needs a model with tool calling (a custom endpoint may not support it).
- **Words:** ai writes, ai draws, add page, make table, title page, bookmark, move page, comment, highlight, circle, contents, agent, do it for me

### Ask AI writes a new note (summary, to-do, definitions)

- **Id:** `askCreateNote`
- **What:** Ask the AI for a summary, a to-do list or definitions "in a note" and it writes a new Markdown note beside the notebook and links to it in the answer. It never overwrites an existing note; a taken name gets a number. The note is not opened automatically.
- **Where:** Ask › e.g. "write a summary of this page in a note".
- **Notes:** needs a key.
- **Words:** summary note, to-do list, definitions, write a note, export answer, create note

### Ask AI knows FineNotes (how-do-I questions)

- **Id:** `askFinenotesHelp`
- **What:** The AI can look up FineNotes' own handbook (every tip and every setting) and answers how-to questions with links that open that tip or setting in FineNotes. It also knows its own abilities and which settings to suggest.
- **Where:** Ask › ask "how do I…?".
- **Notes:** needs a key.
- **Words:** help, how do i, manual, handbook, can finenotes, feature, where is

### Study with Ask AI: quiz, check my work, practice questions

- **Id:** `askStudy`
- **What:** The suggested prompts include "Quiz me on this page", "Check my work for mistakes", "Make practice questions" and "What should I review?". The AI can pin comments or circle mistakes on the page, and add a practice page of questions with room to answer.
- **Where:** Ask › empty chat suggestions, or type the request.
- **Notes:** needs a key.
- **Words:** quiz, test me, check my work, mistakes, homework, exam, practice questions, revise, review, study

### Generate an image with AI

- **Id:** `generateImage`
- **What:** Describe a picture, pick Square, Landscape or Portrait, and Generate. The picture is saved with the note's images and placed on the current page. It can take up to a minute.
- **Where:** Toolbar › AI › "Generate image…"; or Insert image menu › "Generate with AI" (listed only when an image service is set up).
- **Notes:** Needs an OpenAI, Google or OpenRouter key and internet; Claude and custom endpoints cannot make images.
- **Words:** generate image, ai picture, dall-e, gpt image, nano banana, gemini image, draw for me, illustration, diagram, picture from text
- **Settings:** `imageVendor`, `imageModel`, `imageAspect`

### Choose the image service and model

- **Id:** `imageVendorSetting`
- **What:** "Image generation" is either "Same as the AI service" or a service of its own (OpenAI (GPT Image), Google (Gemini), OpenRouter), with its own optional model and key. Defaults: gpt-image-2.5-flare, gemini-3.1-flash-image, google/gemini-2.5-flash-image.
- **Where:** Settings › AI › Pictures › "Image generation", "Image model", "<Service> API key for images".
- **Words:** image service, image model, picture key, openai images, google images
- **Settings:** `imageVendor`, `imageModel`, `apiKeys`

### Grape: read handwriting on this device

- **Id:** `grapeOnDevice`
- **What:** Grape (handwriting recognizer model), FineNotes' own model, reads your notebooks on this device a moment after you stop writing, one page at a time, so search, Obsidian's search, titles and links find your handwriting. Nothing leaves the device. It is in beta and misreads some words. It downloads once, the first time it is needed.
- **Where:** Settings › Reading and voice › Your handwriting › "Read handwriting with": Off / Grape / Your model. Also AI menu › "Read with" (Off · Grape · Mine).
- **Notes:** No key and no internet after the one download.
- **Words:** grape, handwriting recognition, ocr handwriting, read my writing, offline recognition, on device, recognizer, hwr, convert handwriting
- **Settings:** `handwritingOnDevice`, `useLearnedHandwriting`
- **Tip:** `searchInk`

### Search your handwriting

- **Id:** `searchHandwriting`
- **What:** Once handwriting is read (Grape on the device, or a cloud transcription), notebook search and Obsidian's search find the words you wrote; results are marked "Handwriting".
- **Where:** Toolbar › Search (magnifier); or the command "Search this notebook…".
- **Words:** search handwriting, find written words, search ink, find in notes, searchable handwriting
- **Settings:** `handwritingOnDevice`
- **Commands:** `search-notebook`
- **Tip:** `searchInk`

### Transcribe the whole notebook with cloud AI (text layer)

- **Id:** `transcribeNotebook`
- **What:** Sends an image of each page to your AI service and writes each page's text into the notebook's text layer under "### Page N", where Obsidian search finds it. Unchanged pages are skipped; tap the progress notice to stop. With "Handwriting recognition" set to Manual (the default), the command only opens the text layer for you to type.
- **Where:** Command palette › "Transcribe this notebook's handwriting". Engine: Settings › AI › Transcribing › "Handwriting recognition" (Manual / Cloud AI / "Cloud AI, by itself after you write").
- **Notes:** Cloud AI needs a key and internet.
- **Words:** transcribe, transcription, cloud ocr, handwriting to markdown, recognize handwriting, convert notebook, text layer
- **Settings:** `recognitionProviderId`, `autoRecognize`, `llmVendor`
- **Commands:** `recognize-handwriting`

### Transcribe automatically after writing

- **Id:** `autoRecognize`
- **What:** A page you wrote on is transcribed by cloud AI in the background once you are done with it: a few seconds after you turn to another page, or after 5 minutes without writing on it, and only when it changed. A page still waiting when you close the notebook is read when you open it again. To have the page in view transcribed right away, use AI menu › "Transcribe this page" (or the command of that name); without an AI set up, the same entry lets you type the page's transcript yourself. Every page's transcription is listed in the sidebar's Files tab under Transcripts (where it came from: AI, this device, typed or edited by you); tap one to read it, edit it or go to its page. A transcript you typed or edited is never overwritten: a new transcription waits beside it, marked with a dot, and you keep one of the two there. After a failure (a spent quota, a wrong key, no connection) it says so once and waits 10 minutes, then longer, before trying again. It works only after you have agreed to send once (run a transcription by hand first).
- **Where:** Settings › AI › Transcribing › "Handwriting recognition" › "Cloud AI, by itself after you write".
- **Notes:** needs a key and internet.
- **Words:** auto transcribe, automatic recognition, background transcription, recognize automatically, transcribe now, transcribe this page, when does it transcribe, where is my transcript, transcript list, compare transcripts, type transcript, transcribe by hand, manual transcription, overwritten transcript
- **Settings:** `autoRecognize`, `recognitionProviderId`

### The text layer (transcription, links, tags)

- **Id:** `textLayer`
- **What:** A text panel under the pages holding the notebook's transcription, your [[links]] and #tags, all searchable. Transcriptions land here; you can type or correct it.
- **Where:** Command palette › "Show or hide the text layer". It also opens by itself after a transcription.
- **Words:** text layer, markdown, transcription panel, notes text, tags, links, hidden text, type notes
- **Commands:** `toggle-text-layer`

### See what the device read on this page

- **Id:** `readOnDevicePage`
- **What:** Reads the page in view with Grape and shows the text line by line ("Page N, read on this device"), with "Copy text". It also shows a technical summary of the model and timings.
- **Where:** Command palette › "Show this page read on this device" (only while handwriting reading is on).
- **Notes:** no key.
- **Words:** read page, what did it read, recognition result, copy page text, grape result
- **Settings:** `handwritingOnDevice`
- **Commands:** `read-handwriting-on-device`

### Corrections: underline words it may have misread

- **Id:** `wordCorrections`
- **What:** After a page is read, words Grape is unsure of get a dotted underline. Tap one with a finger to correct it, confirm it, "Add to dictionary" or "Never underline it again". Answers help learning. This is a test feature and off by default. You can also correct any word by lassoing it and choosing "Correct".
- **Where:** AI menu › "Corrections" switch; Settings › Reading and voice › Your handwriting › "Underline words it may have misread". Lasso › selection bar › "Correct".
- **Notes:** no key.
- **Words:** corrections, misread, spell check, underline, fix word, wrong word, dictionary, autocorrect
- **Settings:** `checkHandwrittenWords`
- **Tip:** `correctWord`

### Learn your handwriting (personal model)

- **Id:** `learnHandwriting`
- **What:** Copy the grey lines of practice sheets (and correct words) and FineNotes tunes Grape to your writing on this device in a few minutes in the background. It keeps the result only if it reads your test lines better, and shows the before/after mistake rate. It needs at least 10 copied lines or corrected words. After every 50 new corrected words it offers to learn again. The previous model is kept to swap back to; deleting is a separate, confirmed action.
- **Where:** AI menu › "Learn your handwriting…" (opens the Learn your handwriting window with Write sheet N / Learn now / Stop); Settings › Reading and voice › Your handwriting › "Learn your handwriting" › Open; command "Learn my handwriting from the practice files".
- **Notes:** runs on the device, no key. Needs Grape downloaded first.
- **Words:** learn my handwriting, train, personal model, improve recognition, fine-tune, teach, accuracy, practice sheets
- **Settings:** `handwritingModel`, `handwritingModelPrevious`, `useLearnedHandwriting`, `relearnRemindedAt`, `practiceNotebookPath`
- **Commands:** `learn-handwriting`
- **Tip:** `learnWriting`

### Handwriting practice sheets

- **Id:** `practiceSheets`
- **What:** Creates a practice file ("Handwriting practice N.practice.md") in FineNotes assets/Handwriting sheets: printed grey lines (alphabet, digits, money, maths, punctuation, a link) to copy underneath. Three sets exist. A practice file only allows pen and eraser.
- **Where:** Learn your handwriting window › "Write sheet N" / "Continue sheet N" / "Write another sheet"; command "Write a handwriting practice set".
- **Words:** practice sheet, handwriting practice, copy lines, training data, worksheet
- **Settings:** `practiceNotebookPath`
- **Commands:** `write-handwriting-practice`
- **Tip:** `learnWriting`

### Symbol practice sheet (answers in your own hand)

- **Id:** `symbolPractice`
- **What:** A practice sheet with one digit, operator or sign per line. Besides helping recognition, it lets calculation notes write answers in your own handwriting.
- **Where:** Learn your handwriting window › "+ Symbols sheet"; command "Write the symbol practice sheet (digits, operators, signs)".
- **Words:** symbol sheet, digits, operators, maths symbols, write answers in my handwriting, my handwriting font
- **Commands:** `write-symbol-practice`

### Use another handwriting model file

- **Id:** `hwrModelPath`
- **What:** Reads with a model file from the vault instead of the downloaded Grape (for example one tuned to a writer). Leave blank for Grape.
- **Where:** Settings › Files and folders › Handwriting › "Handwriting model file".
- **Words:** custom model, model file, handwriting model path, own model file
- **Settings:** `hwrModelPath`

### Grape models on this device (download, remove)

- **Id:** `modelsOnDevice`
- **What:** Lists the models that run on the device: Voice (Whisper), Handwriting (Grape), your handwriting model, and the scanned-page (OCR) reader, each with its state, Download while missing and Re-download or remove in its ⋯ menu. Nothing they read or hear leaves the device.
- **Where:** Settings › Reading and voice › "Models on this device".
- **Words:** download model, models, storage, remove model, redownload, offline models, disk space
- **Settings:** `speechModel`, `speechLanguage`, `ocrModel`

### Re-read scanned pages of a PDF

- **Id:** `rereadScannedPages`
- **What:** Forgets what OCR read of the PDF in view and reads it again.
- **Where:** Command palette › "Re-read scanned pages of this PDF".
- **Notes:** needs the OCR switch on.
- **Words:** reread pdf, redo ocr, ocr again, refresh scanned text
- **Settings:** `ocrScannedPdfs`
- **Commands:** `reread-scanned-pages`

### Handwritten links and titles from ink

- **Id:** `handwritingLinksTitles`
- **What:** Because Grape reads ink, writing [[Note]] by hand offers a link (finger-tap the dashed underline and confirm), and a lassoed heading or word can fill in a title or link.
- **Where:** Write [[Name]] in a notebook; lasso › "Link to…" / "Contents heading".
- **Notes:** needs handwriting reading on.
- **Words:** handwritten link, wiki link, [[ ]], page title from ink, heading
- **Settings:** `handwritingOnDevice`
- **Tip:** `inkLink`

### Discard a recording

- **Id:** `discardRecording`
- **What:** The bin on the recording pill stops the recording and throws the audio away (to the trash) after confirming "Discard this recording?".
- **Where:** While recording › red pill › bin ("Discard recording").
- **Words:** delete recording, discard, cancel recording, throw away audio

### Where recordings are kept, and the Recordings list

- **Id:** `recordingsList`
- **What:** A note's recordings are listed in the page sidebar's Files tab under Recordings, newest first, each with play, transcribe, open transcript, paste transcript and remove. Audio files go to the notebook's own folder, else "Folder for recordings", else Obsidian's attachment folder. "Remove from note" leaves the audio file in place.
- **Where:** Toolbar › Page thumbnails (sidebar) › Files tab › Recordings. Folder: Settings › Files and folders › "Folder for recordings".
- **Words:** recordings list, find recording, audio files, where are recordings, recordings folder
- **Settings:** `recordingsFolder`, `transcriptsFolder`

### Play back a recording and replay ink in sync

- **Id:** `playbackReplayInk`
- **What:** Play opens a player bar (play/pause, back 10 seconds, position). While it is open, tapping your writing jumps to just before that ink was written, on any page. "Replay ink" shows ink not yet written at that moment as pale while it plays.
- **Where:** Page sidebar › Files › Recordings › ▶; player bar › "Replay ink" toggle; tap ink while the player is open.
- **Notes:** Ink written before version 0.5 has no time stamp.
- **Words:** play recording, playback, listen, replay, sync audio with notes, audio sync, notability style, hear what was said
- **Settings:** `replayInk`
- **Tip:** `hear`

### Transcribe a recording on this device (Whisper)

- **Id:** `transcribeRecordingOnDevice`
- **What:** Turns a recording into a transcript note with times, using the Whisper speech model on the device; no key, nothing sent. The first time it asks to download the model (Whisper base, about 82 MB, from GitHub). Long recordings warn about time and battery; the limit is 30 minutes on mobile and 3 hours on desktop (20 minutes for large-v3-turbo). You can keep writing and stop it at any time; the AI menu shows the progress.
- **Where:** AI menu › "Transcribe on this device…" (picks a recording if there are several; while running it becomes "Stop transcribing · N %"); or Page sidebar › Files › Recordings › Transcribe.
- **Notes:** Small and large-v3-turbo are desktop only; the iPad uses base when a computer chose those. One model download.
- **Words:** speech to text, transcribe audio, whisper, offline transcription, voice to text, lecture transcript, dictation
- **Settings:** `speechService`, `speechModel`, `speechLanguage`, `transcriptsFolder`

### Transcribe a recording online (Groq, OpenAI, Gemini, OpenRouter, own server)

- **Id:** `transcribeRecordingOnline`
- **What:** Transcribes a recording with an online service and your key instead of the device: Groq (whisper-large-v3-turbo), OpenAI (gpt-4o-mini-transcribe), OpenRouter (openai/whisper-large-v3), Google (Gemini) or your own OpenAI-compatible server. The transcript becomes a note beside the audio or in the transcripts folder. Large files are sent in parts. Transcribing again writes a new note and keeps the old one.
- **Where:** Settings › AI › Recordings › "Transcribe recordings with" (This device / Groq / OpenAI / OpenRouter / Google (Gemini) / Your own server), "Transcription model", "Transcription server URL", key. Then AI menu › "Transcribe recording…", or Recordings › Transcribe.
- **Notes:** needs a key (or a server) and internet.
- **Words:** online transcription, groq, openai whisper, gemini audio, cloud speech to text, fast transcription
- **Settings:** `speechService`, `speechServiceModel`, `speechBaseUrl`, `speechLanguage`, `apiKeys`

### Open or paste a recording's transcript

- **Id:** `recordingTranscript`
- **What:** A transcribed recording shows its transcript in the Recordings list (expand with "Show the whole transcript"; tap a time to play from there). "Open transcript note" opens the note; the paste button puts its text on the page as text.
- **Where:** Page sidebar › Files › Recordings › a recording's buttons.
- **Words:** transcript, paste transcript, transcript to page, open transcript, lecture notes text
- **Settings:** `transcriptsFolder`
- **Tip:** `pasteTranscript`

### Write a sum, get the answer (calculation notes)

- **Id:** `calcNotes`
- **What:** Write a sum ending in = (12x4 =; an x between numbers means times) and lift the pen. FineNotes reads it on the device, the sum glows, and a suggestion shows what it read and the answer. Tap to write the answer after the =, at your writing's size, in your own hand once you have written the symbol sheet. Keep writing to ignore it. A letter set on a line above (a = 5) can be used. On by default.
- **Where:** Just write in a notebook. Switch: AI menu › "Calculations"; Settings › Reading and voice › Your handwriting › "Calculate lines that end in =".
- **Notes:** on the device, no key. Needs handwriting reading on (Grape).
- **Words:** calculate, calculation, math, maths, sum, equals, answer, handwritten math, math notes, apple math notes, solve
- **Settings:** `calcNotes`, `handwritingOnDevice`
- **Tip:** `calc`

### The maths card (fix the reading, fraction, typed equation)

- **Id:** `calcCard`
- **What:** Tapping a glowing sum opens a card: the reading typeset (tap "Fix the reading" to type it), uncertain characters each a tap from their other guesses ("Which did you write?"), the answer "As a fraction" or "As a decimal", Write, and at the foot "Turn into a typed equation", "Copy LaTeX" and "Not maths".
- **Where:** Tap the glow over a sum.
- **Words:** maths card, fix reading, wrong digit, fraction, decimal, latex, copy latex, not maths, misread number
- **Settings:** `calcNotes`
- **Tip:** `sumGlow`

### Solve for x in handwriting

- **Id:** `solveLetter`
- **What:** An equation in one letter written by hand (x + 5 = 7, or x = written under an equation in x) is read and the card offers its solutions.
- **Where:** Write the equation, then x =, and tap the glow.
- **Notes:** on the device.
- **Words:** solve for x, algebra, equation, unknown, solve equation, find x
- **Settings:** `calcNotes`
- **Tip:** `solveLetter`

### Graph a handwritten function

- **Id:** `handwrittenFunctionGraph`
- **What:** A handwritten function such as y = 2x + 1 has no answer; the card offers its graph to place on the page.
- **Where:** Write y = … and tap the glow.
- **Words:** graph y =, plot function, handwritten graph, function graph
- **Settings:** `calcNotes`

### Add up a column of numbers

- **Id:** `columnSums`
- **What:** Write amounts one under another and draw a line under them; the column glows and a tap shows each amount read, lined up, and the total. Write puts the total under the line. One line gives a subtotal, two lines the total of the whole column. Names and dates on the left are ignored, a dash before an amount subtracts it, and 1.234,50, 120,- and 1,234.50 are all read. The total follows when you change an amount.
- **Where:** Just write. Switch: Settings › Reading and voice › Your handwriting › "Add up columns of numbers".
- **Notes:** on the device, needs handwriting reading on.
- **Words:** column sum, add up, total, subtotal, receipt, amounts, budget, line under numbers, addition
- **Settings:** `columnSums`, `handwritingOnDevice`

### The calculator

- **Id:** `calculator`
- **What:** A floating scientific calculator window that stays open while you write; drag it by its title bar and resize it from its corner. Tabs: Basic, Trig, Calculus, Bases, Memory. A long press (or hover) explains a key; functions with several inputs give boxes to fill. It supports fractions, degrees or radians, hardware keyboard input while in use, and a history per notebook ("Use", "Edit", "Clear history").
- **Where:** Toolbar › Calculator. In Essentials: ⋯ › Calculator. Close with its ✕ or a second tap on the button.
- **Notes:** no key, no internet.
- **Words:** calculator, scientific calculator, compute, math, trig, sin, cos, log, calculus, derivative, integral, hex, binary, memory
- **Settings:** `calculator`
- **Tip:** `basicCalc`

### Pocket (Basic) calculator mode

- **Id:** `basicCalculator`
- **What:** Switches the calculator between scientific keys and a Basic calculator laid out like the iPhone's.
- **Where:** Calculator › title bar › "Basic calculator" / "Scientific calculator".
- **Words:** basic calculator, simple calculator, pocket calculator, iphone calculator
- **Settings:** `calculator`
- **Tip:** `basicCalc`

### Steps: see the working (derivatives, integrals, solving)

- **Id:** `calculatorSteps`
- **What:** For d/dx, ∫ and solve(f = g), the Steps pane shows the working (power rule, chain rule, quadratic formula, by parts, partial fractions…). "Insert steps" puts the working and the answer on the page as a text box.
- **Where:** Calculator › "Steps" pane › "Insert steps".
- **Words:** steps, show working, step by step, symbolab, how to solve, derivative steps, integral steps

### Insert a calculation on the page

- **Id:** `calculatorInsert`
- **What:** "Insert" puts the sum and its answer on the page as a text box in the middle of the view; "Insert answer" puts only the answer. One undo step.
- **Where:** Calculator › Insert / Insert answer.
- **Words:** insert answer, put on page, paste result, sum to page
- **Settings:** `textStyle`

### Graphs in the calculator (plot functions)

- **Id:** `calculatorGraph`
- **What:** The Graph pane plots lines: y = …, implicit curves in x and y, inequalities (shaded), polar r = f(θ), parametric curves and restricted domains. Any other letter gets a slider with play. Each line's ⋯ offers Dashed / Thin / Bold, Derivative, Tangent, ∫ Area, Table, Up/Down. Tapping a curve shows roots, max/min, intercepts and crossings. ⚙ sets grid, numbers, 1:1 axes, π ticks and range.
- **Where:** Calculator › "Graph" pane (type a function of x; "Has x: open the graph to plot it").
- **Words:** graph, plot, graphing calculator, desmos, geogebra, function plot, curve, slider, tangent, area under curve, table of values, inequality, polar, parametric
- **Settings:** `calculator`
- **Tip:** `insertGraph`

### Put a graph on the page

- **Id:** `insertGraph`
- **What:** Type a function of x, open Graph and tap "Insert graph": the graph is placed on the page as an object.
- **Where:** Calculator › Graph › "Insert graph".
- **Words:** insert graph, graph on page, add graph, place graph, draw a graph, plot a function, graph of a function
- **Tip:** `insertGraph`

### Edit or explore a graph on the page

- **Id:** `editExploreGraph`
- **What:** Lasso a graph on its own: "Edit graph" opens the calculator on that graph's lines, and Done ("Update graph") saves it as one undo step. "Explore" lays a live canvas over it to drag, pinch and trace the curve, and Done keeps the view.
- **Where:** Lasso a graph › selection bar › "Edit graph" / "Explore".
- **Words:** edit graph, change graph, explore graph, pan graph, zoom graph, trace curve

### Fit, pin and pop out the graph

- **Id:** `graphFitPinPopOut`
- **What:** Double-tap the calculator's graph to fit it to the curves. Tap and hold on a curve to pin that point with a label (A, B, …). "Pop out the graph" moves it into a window that stays open while you write (drag, resize, minimise to a pill); edits show in both.
- **Where:** Calculator › Graph: double tap; tap and hold; "Pop out the graph" button.
- **Words:** fit graph, reset view, pin point, label point, pop out graph, graph window, keep graph open
- **Settings:** `calculator`
- **Tip:** `graphFit`
