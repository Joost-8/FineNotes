# Notebooks, pages, Home, PDF and files

Making notebooks, Home (the library), the page sidebar, templates and paper, boards, Markdown, PDF, export and import.

Part of FineNotes' guide (see `README.md` here): what Ask AI looks up to answer questions about the app. Edit an entry, then run `npm run guide`.

<!-- area: notebooks -->

### Make a new notebook

- **Id:** `newNotebook`
- **What:** Opens the "New notebook" dialog: a title, a cover, a paper (template, colour, size, orientation) and a folder chip, then Create. A double tap on a paper card creates at once. The dialog remembers the last choices.
- **Where:** Home › New › New notebook; Home with no notebooks › New notebook; Notebooks sidebar (left) › square-pen button "New notebook"; file explorer right-click a folder › New notebook; command palette "New notebook or board…"
- **Words:** new notebook, create notebook, add notebook, start a notebook, blank notebook, new note, Goodnotes new notebook, make a book
- **Settings:** `newNotebookFolder`, `notebookOwnFolder`, `lastNotebookChoices`, `lastNotebookTemplate`, `showNewNotebookInContextMenu`
- **Commands:** `create-handwriting-note`

### Notebook with the last settings, no dialog

- **Id:** `notebookWithLastSettings`
- **What:** Makes a notebook straight away with the cover, paper, size and template chosen last time in the New notebook dialog (always a notebook, even right after a board), in the default folder.
- **Where:** command palette "Create notebook with last settings"; also the link obsidian://finenotes?do=new&last
- **Words:** quick notebook, same settings, last settings, one tap notebook, repeat last notebook, fast new notebook
- **Settings:** `newNotebookFolder`, `notebookOwnFolder`
- **Commands:** `create-notebook-with-last-settings`

### Choose a cover

- **Id:** `notebookCover`
- **What:** The New notebook dialog's Cover row picks a design (Soft gradient, Orb, Duotone split, Contour lines, Glass label, Big type, Accent stripe, Plain cover, Label cover, Spine cover, Linen cover) and one of 16 cover colours, or "No cover". The cover is page 1 with the title on it. An existing notebook's cover is changed from the cover page.
- **Where:** New notebook dialog › Cover; in a notebook: More (⋯) on the cover page › Change cover; page sidebar › a cover thumbnail's ⌄ › Change cover
- **Words:** cover, notebook cover, cover design, cover colour, cover color, no cover, change cover, Goodnotes cover

### Paper for a new notebook (templates, colour, size, orientation)

- **Id:** `notebookPaper`
- **What:** The dialog's Paper row: page size (A4 (Standard), A6, A5, A3, A2, A1, A0, Letter, Legal, Tabloid), paper colour (White, Ivory, Cream, Blush, Mint, Sky, Lavender, Stone, Slate, Charcoal), portrait or landscape, and a template from the grid (Blank, Dotted Paper, Ruled Narrow/Wide, Squared Paper, Cornell, Legal, columns, Wide Margin Left/Right, Title & Date, Graph Paper, Isometric Grid/Dots, Hexagon Grid, Todos, Daily/Weekly/Monthly Planner, Weekly Grid, Habit Tracker, Meeting Notes, Accounting, Handwriting Practice, Storyboard, Music Paper, Guitar Tablature, Score & Tab), or a whole template from My templates.
- **Where:** Home › New › New notebook › Paper
- **Words:** paper, template, lined, ruled, dotted, grid, squared, graph paper, blank, Cornell, planner, A4, A5, letter, landscape, portrait, paper colour, page size

### Where new notebooks are saved

- **Id:** `newNotebookFolder`
- **What:** Sets the folder new notebooks go in; empty means the folder of the note that is open. The dialog's folder chip can change it for one notebook. Notebooks made from PDFs in the FineNotes inbox also go here (or to the vault root when empty).
- **Where:** Settings › Pages › New notebooks › "New notebooks go in"; New notebook dialog › folder chip ("Choose folder")
- **Words:** default folder, save location, where do notebooks go, notebook folder, folder for new notebooks
- **Settings:** `newNotebookFolder`

### New notebook from a template file (.finetemplate)

- **Id:** `newFromTemplate`
- **What:** Pick a .finetemplate file anywhere in the vault; it opens in the import dialog and becomes a new notebook of your own (with its pictures). A template marked personal-use only says so.
- **Where:** command palette "New notebook from template…"
- **Words:** new from template, finetemplate, template file, notebook template, use template, planner template
- **Settings:** `templateFolder`
- **Commands:** `new-from-template`

### Insert a new notebook into a Markdown note

- **Id:** `insertNewNotebook`
- **What:** In an ordinary Markdown note, makes a notebook with the last settings but no cover, named after the note, embeds it at the cursor as ![[…]] and opens it in the same tab, so Back returns to the note. The embed shows its pages and updates as you write.
- **Where:** command palette "Insert a new notebook here" (only while editing a Markdown note that is not itself a notebook)
- **Words:** notebook in note, embed new notebook, handwriting in markdown, insert notebook, drawing in note, inline notebook
- **Settings:** `newNotebookFolder`, `notebookOwnFolder`
- **Commands:** `insert-new-notebook`

### Welcome window and tour notebook

- **Id:** `welcome`
- **What:** The welcome shows on a first install: "Take the tour" (a short notebook that shows the tools), "Bring your notebooks" (Import…), "Start fresh" (Open Home) and "Only here for FineNotes?" (simple look switch).
- **Where:** shown automatically once; command palette "Show the welcome"
- **Words:** welcome, getting started, tour, first launch, onboarding, intro
- **Settings:** `simpleLook`
- **Commands:** `show-welcome`

### Home note (Home.md)

- **Id:** `homeFile`
- **What:** In a brand-new vault with no notes, FineNotes makes a Home.md at the root whose opening opens the notebook library. Deleting it changes nothing; a Home.md of your own is left alone.
- **Where:** vault root › Home.md (made automatically once)
- **Words:** Home.md, home note, start note

### New notebook from Shortcuts / a link (obsidian://finenotes)

- **Id:** `finenotesLink`
- **What:** obsidian://finenotes?do=new opens the New notebook window (folder=… picks the folder; last skips the window, name=… names it); do=pdf&file=… makes a notebook from a vault PDF; do=show&feature=… shows a tip. Settings has buttons that add ready-made Apple Shortcuts: "Add the New notebook shortcut" and "Add the PDF to notebook shortcut".
- **Where:** Settings › Pages › New notebooks › "Shortcuts" row (Apple devices only); any link or shortcut that opens obsidian://finenotes?…
- **Notes:** links both; the Shortcuts row only on Apple devices (macOS or iPadOS/iOS), since Shortcuts exists there only
- **Words:** shortcut, Apple Shortcuts, home screen button, URL scheme, obsidian://finenotes, automation, launcher, Siri
- **Settings:** `newNotebookFolder`

### Share a PDF from another app into a notebook (FineNotes inbox)

- **Id:** `pdfInbox`
- **What:** With the "PDF to notebook" shortcut, sharing a PDF from any app saves it in "FineNotes inbox" (a folder at the vault root, hidden in the file list) and it becomes a notebook. A PDF you save into that folder yourself becomes a notebook too; the PDF is moved beside the new notebook.
- **Where:** Settings › Pages › New notebooks › "Add the PDF to notebook shortcut"; then the system share sheet › "New FineNotes notebook"
- **Notes:** iPad/iPhone mainly (share sheet via Apple Shortcuts); the inbox folder watch works on both
- **Words:** share sheet, share PDF to FineNotes, send PDF, inbox, FineNotes inbox, open in FineNotes, from Safari, from Mail
- **Settings:** `newNotebookFolder`

### Open Home (the notebook library)

- **Id:** `openHome`
- **What:** A pinned tab showing every notebook as a cover, with Favorites, Continue, Recent, Folders, Files and All notebooks. Its header has the folder rail button, Up one folder, search, Sort, Tips, New and the gear.
- **Where:** left ribbon › "Notebook library" (books icon); the toolbar's Home button in a notebook; Notebooks sidebar › house button; file explorer bar's library button; an empty tab's "Notebooks" action; command palette "Open the notebook library"
- **Words:** home, library, bookshelf, all notebooks, notebook library, documents, main screen, Goodnotes library
- **Settings:** `showNewNotebookInExplorer`
- **Commands:** `open-library`

### Continue where you left off

- **Id:** `homeContinue`
- **What:** At the top of Home, "Continue" shows the notebook used last with a big picture of the page you were on, "Page N of M", a progress bar and a Continue button that opens it at that page; the next few sit beside it, and older ones under "Recent".
- **Where:** Home (top level) › Continue / Recent
- **Words:** continue, resume, last notebook, recent notebooks, where I left off, reading progress

### Preview a notebook before opening

- **Id:** `homePreview`
- **What:** One tap on a cover shows a preview pane with its facts and its first pages (for long notebooks, the pages its contents and bookmarks point to); tap a page to open the notebook there. A second tap on the cover (or Open) opens it.
- **Where:** Home › tap a cover once
- **Words:** preview, peek, quick look, see pages, tap cover, open notebook at page
- **Tip:** `homePreview`

### Search all notebooks from Home

- **Id:** `homeSearch`
- **What:** Home's search field filters notebooks by title and lists the pages inside notebooks that hold the words (typed text, transcriptions, handwriting read on this device, PDF text); a tap opens the notebook at that page with the words lit. Matching FineNotes features are listed first.
- **Where:** Home › Search field
- **Words:** search, find notebook, search all notebooks, search handwriting everywhere, find page, global search
- **Settings:** `handwritingOnDevice`, `ocrScannedPdfs`
- **Commands:** `open-library`
- **Tip:** `homeSearch`

### Sort, grid or list, notebooks only

- **Id:** `homeSort`
- **What:** The Sort button's menu: Select items, Grid or List, "Notebooks only" (hides other files), and sort by Date created, Last edited, Name or Pages (tap the current one again to reverse).
- **Where:** Home › Sort (up-down arrows icon)
- **Words:** sort, order, by name, by date, last edited, date created, page count, list view, grid view, hide files, notebooks only

### Hide notebooks and files from Home

- **Id:** `homeHide`
- **What:** A cover's or folder's ⌄ menu has "Hide from Home": the item (and all a folder holds) leaves Home, Continue, the folder rail and search; the file stays in the vault. Sort › "Show hidden items" (there only while something is hidden) shows them dimmed, and their ⌄ menu has "Show on Home".
- **Where:** Home › an item's ⌄ › Hide from Home; Home › Sort › Show hidden items
- **Words:** hide, hide notebook, hide file, unhide, show hidden, declutter, archive, take off home, hidden items
- **Settings:** `libraryHidden`

### Favorites (star notebooks and folders)

- **Id:** `homeFavorites`
- **What:** The star on a cover or folder adds it to Favorites, shown at the top of Home. Several can be starred at once from Select.
- **Where:** Home › star on a cover; Home › Sort › Select items › Star
- **Words:** favorite, favourite, star, pin notebook, starred
- **Settings:** `libraryStars`

### Folders on Home, with colours and icons

- **Id:** `homeFolders`
- **What:** Home shows vault folders as folder tiles; New › New folder makes one (it shows even while empty). A folder's ⌄ menu has Customize color… (Sky, Blue, Violet, Pink, Red, Orange, Yellow, Green, Gray), Set icon… (Study, Reading, Work, Science, Maths, Code, Art, Music, Personal, Home, Travel, Plain), Rename, Move and Delete.
- **Where:** Home › New › New folder; Home › folder tile › ⌄ (or right-click / long press)
- **Words:** folder, new folder, folder colour, folder color, folder icon, organise, organize, subfolder, categories, put notebooks in folders, organise notebooks, sort notebooks into folders
- **Settings:** `libraryFolders`
- **Tip:** `folderColour`

### Drag a notebook into a folder

- **Id:** `homeDrag`
- **What:** Drag a cover (or a folder) onto a folder tile, or onto the Up one folder arrow, to move it there; a notebook with its own folder moves with all its files.
- **Where:** Home › drag a cover onto a folder tile
- **Words:** drag, drop into folder, move notebook, organise by dragging
- **Tip:** `homeDrag`

### Rename, duplicate, move, delete a notebook from Home

- **Id:** `homeCardMenu`
- **What:** A cover's ⌄ menu: Rename, Duplicate, Export as PDF, Move, Open in new tab, Delete. Delete asks once, naming what goes, and moves it (with its own folder's files) to the trash.
- **Where:** Home › ⌄ beside a notebook's name (or right-click / long press the cover)
- **Words:** rename notebook, duplicate notebook, copy notebook, move notebook, delete notebook, trash notebook, open in new tab

### Select several items on Home

- **Id:** `homeSelect`
- **What:** Select items turns taps into ticks; a bar offers Star, Move and Delete for all picked notebooks and folders, and Done.
- **Where:** Home › Sort › Select items
- **Words:** select multiple, bulk move, bulk delete, select notebooks, multi-select

### Folder rail on Home

- **Id:** `homeRail`
- **What:** In the simple look (where Obsidian's file list is hidden), Home shows a rail of folders on the left (a drawer on a narrow screen), toggled with the panel button.
- **Where:** Home › panel-left button (only in the simple look)
- **Notes:** but only with the simple look on
- **Words:** folder sidebar, folder list, rail, drawer, folders panel
- **Settings:** `simpleLook`

### Other files on Home

- **Id:** `homeFiles`
- **What:** Home also lists files that are not notebooks (PDFs, pictures, Markdown notes) with a preview cover: at the top under "Files" for the vault root, and among the notebooks inside a folder. They open in Obsidian's own viewer. "Notebooks only" hides them.
- **Where:** Home › Files
- **Words:** PDFs on home, images on home, notes on home, other files

### Pull to refresh Home

- **Id:** `homeRefresh`
- **What:** Pulling the Home list down from the top re-reads the vault's notebooks.
- **Where:** Home › pull down
- **Notes:** (touch, or a touchpad pull)
- **Words:** refresh, reload library, pull down, notebooks missing

### Notebooks list in Obsidian's sidebar

- **Id:** `notebooksSidebar`
- **What:** A "Notebooks" view in Obsidian's left sidebar that lists only notebooks in their folders, like the file explorer, with Home and New notebook buttons. Added once automatically; closed, it stays closed.
- **Where:** Obsidian left sidebar › Notebooks tab; command palette "Show notebooks in the sidebar"
- **Words:** sidebar, notebooks panel, notebook tree, left sidebar, file tree of notebooks
- **Commands:** `show-notebooks-sidebar`

### File explorer extras

- **Id:** `explorerExtras`
- **What:** Right-click a folder › New notebook / Import notebook (beta)…; a library button beside New note and New folder; and a notebook's own folder shown as the notebook (tap its name to open it, its arrow for its files).
- **Where:** Settings › Pages › In Obsidian's file list › "New notebook in the right-click menu", "Library button in the file explorer", "Show notebook folders as notebooks"
- **Words:** file explorer, right-click new notebook, library button, folder notebooks, notebook icon, context menu
- **Settings:** `showNewNotebookInContextMenu`, `showNewNotebookInExplorer`, `folderNotebooks`

### Page sidebar (thumbnails)

- **Id:** `pageSidebar`
- **What:** A panel of page thumbnails with tabs Pages (Boards in a board file), Contents and Files. Tap a thumbnail to go there; each has a ribbon, number and ⌄ menu; "+ Add page" at the end; a filter (All pages / Bookmarks only / In the contents).
- **Where:** Toolbar › leftmost "Page thumbnails" button
- **Words:** thumbnails, page panel, page list, sidebar, pages panel, navigator, Goodnotes thumbnails

### Pull past the last page for a new one

- **Id:** `pullPage`
- **What:** Keep pulling past the last page until the ring fills, and a new page with the same paper is added.
- **Where:** in a notebook, scroll past the last page
- **Notes:** (finger, or wheel/touchpad pull)
- **Words:** pull for page, swipe new page, scroll past end, add page gesture
- **Tip:** `pullPage`

### Choose or change a page's template

- **Id:** `changeTemplate`
- **What:** The template picker sets one page's paper: the template grid, size and orientation, paper colour, line colour, and spacing (Tight / Normal / Roomy / Wide or a typed 2-30 mm), or a page of My templates. Apply changes only that page; a page's margin is kept.
- **Where:** More (⋯) › Change template; page sidebar › ⌄ › Change template
- **Words:** change template, change paper, page background, lined to grid, switch paper, line spacing, paper colour, line colour, page size
- **Tip:** `lineSpacing`

### My templates (your own papers)

- **Id:** `myTemplates`
- **What:** A personal shelf of papers shown in the New notebook dialog and the template picker. Its + adds: "Design a paper…", "Community templates…", "From files…", "From vault…" (PDF, PNG, JPEG or WebP, up to 40 MB; every page is a paper). Each card's ⋯: Edit…, Share…, Delete template (to the trash; notebooks keep their copy).
- **Where:** New notebook dialog › Paper › My templates; template picker › My templates › + / ⋯
- **Words:** my templates, custom template, own paper, import template, PDF as paper, picture as template, planner PDF, template library
- **Settings:** `templateFolder`, `assetsFolder`

### Design your own paper

- **Id:** `designPaper`
- **What:** The paper designer: Paper name, Page size, Portrait/Landscape, paper colour, Texture (Plain/Fine/Heavy), Lines (No lines/Lines/Squares/Dots), Spacing, Margin line (side, colour, inset), Top/Right/Bottom/Left margins and a Blank area. Saved into My templates.
- **Where:** template picker or New notebook dialog › My templates › + › Design a paper…
- **Words:** design paper, custom paper, make template, line spacing, margin line, paper texture, custom lines
- **Tip:** `designPaper`

### Save a page as a template

- **Id:** `savePageTemplate`
- **What:** Turns the page as it looks (paper, ink, text, pictures) into a PDF paper in My templates, named after its contents title or "Notebook page N".
- **Where:** More (⋯) › Save page as template (not on a cover)
- **Words:** save page as template, reuse page, page to template, my own planner page
- **Settings:** `templateFolder`
- **Commands:** `save-page-as-template`
- **Tip:** `saveTemplate`

### Save a whole notebook as a template file

- **Id:** `saveNotebookTemplate`
- **What:** Saves the notebook and its pictures as one .finetemplate file with Name, Author, Description, Version and Licence (Personal use only, Personal and commercial use, CC BY 4.0, CC0). Anyone opening it gets a new notebook of their own.
- **Where:** command palette "Save notebook as template…"
- **Words:** save as template, finetemplate, share notebook template, template package, planner template
- **Settings:** `templateFolder`
- **Commands:** `save-as-template`

### Community template gallery

- **Id:** `templateGallery`
- **What:** Lists free templates shared by FineNotes users (Planners, Study, Journals, Work, Papers, Other), searchable and sortable (Popular, New, A–Z). "Use template" makes a notebook template a new notebook; a paper goes "Add to My templates"; some say "Get it from the creator". Fetched only when opened.
- **Where:** My templates › + › Community templates…; command palette "Browse template gallery…"
- **Notes:** (needs internet)
- **Words:** template gallery, community templates, download templates, free templates, planners, marketplace
- **Settings:** `templateGalleryUrl`
- **Commands:** `template-gallery`

### Share a template with the community

- **Id:** `shareTemplate`
- **What:** Pick one of My templates, fill in name, author, category, tags and licence; FineNotes opens a pre-filled GitHub submission form where you attach the file. Needs a free GitHub account; reviewed before it appears.
- **Where:** My templates › Share a template / card ⋯ › Share…; Template gallery › Share yours…; command palette "Share a template with the community…"
- **Notes:** (needs internet and a GitHub account)
- **Words:** share template, publish template, submit template, upload template, GitHub
- **Commands:** `share-template`

### Reorder pages

- **Id:** `reorderPages`
- **What:** Drag a thumbnail in the page sidebar (mouse or Pencil at once, a finger after resting on it). A page's ⌄ also has Move up / Move down; selected pages can go Move to the start / Move to the end.
- **Where:** page sidebar › hold and drag a thumbnail; page sidebar › ⌄ › Move up / Move down
- **Words:** reorder pages, move page, drag page, rearrange pages, page order, move up, move down
- **Tip:** `reorder`

### Duplicate a page

- **Id:** `duplicatePage`
- **What:** Makes a copy of the page right after it; undoable.
- **Where:** More (⋯) › Duplicate page; page sidebar › ⌄ › Duplicate page; overview › Select › Duplicate
- **Words:** duplicate page, copy page, clone page

### Clear or delete a page

- **Id:** `deletePage`
- **What:** Clear page removes the page's ink; Delete page removes the page. Both undo with Cmd/Ctrl+Z (or two-finger double tap). The last page of a notebook cannot be deleted.
- **Where:** More (⋯) › Clear or delete page › Clear page / Delete page; page sidebar › ⌄ › Clear page / Delete page; overview › Select › Delete
- **Words:** delete page, remove page, clear page, erase page, wipe page, undo delete page

### See all pages (page grid) and select several

- **Id:** `pageGrid`
- **What:** "Show all pages" grows the sidebar into a grid of every page. Select (or Shift/Cmd-click on a computer) picks pages to Move, Duplicate, Bookmark, Export or Delete together, or drag as one block.
- **Where:** page sidebar › expand button "Show all pages" › Select
- **Words:** all pages, page grid, overview, select pages, multiple pages, bulk pages, Goodnotes grid view
- **Tip:** `pageGrid`

### Move or copy pages to another notebook

- **Id:** `moveToNotebook`
- **What:** Pick a notebook (or make a new one) and choose Move or Copy. Move is undoable here (the copy in the other notebook stays until deleted). Read-only notebooks and all-the-pages selections can only be copied; boards, single pages and practice sets refuse pages.
- **Where:** page grid › Select › Move › To another notebook…
- **Words:** move pages to another notebook, copy pages, send page, transfer page, split notebook, merge notebooks
- **Tip:** `moveToNotebook`

### Bookmark a page

- **Id:** `bookmarks`
- **What:** Tap a thumbnail's ribbon to bookmark it; the sidebar filter "Bookmarks only" shows just those. Also in More and the page ⌄ menu.
- **Where:** page sidebar › ribbon on a thumbnail; More (⋯) › Bookmark page; page sidebar › ⌄ › Bookmark page; page sidebar › All pages ⌄ › Bookmarks only
- **Words:** bookmark, ribbon, flag page, mark page, favourite page, bookmarks only
- **Tip:** `ribbon`

### Contents (table of contents, chapters, headings)

- **Id:** `contents`
- **What:** The Contents tab lists every page given a title, with headings lassoed inside pages folding under it, and chapters. Add a page with "Add page N to contents" or Add to contents; New chapter adds a chapter; entries can be renamed, removed, indented/outdented and dragged. Tap an entry to go there.
- **Where:** page sidebar › Contents tab; More (⋯) › Add to contents / Rename in contents; page sidebar › ⌄ › Add to contents
- **Words:** table of contents, TOC, contents, chapter, section, heading, outline, index, title a page
- **Tip:** `contentsHeading`

### Page tabs on the notebook's edge

- **Id:** `pageTabs`
- **What:** A coloured tab on the notebook's edge that opens its page, labelled with the page's contents title or "Page N".
- **Where:** page sidebar › ⌄ › Add page tab / Remove page tab
- **Words:** page tab, tab, divider, sticky tab, post-it tab, binder tab, index tab
- **Tip:** `pageTab`

### Files tab (a notebook's recordings, pictures, exports)

- **Id:** `notebookFiles`
- **What:** The sidebar's Files tab with a "Kind of file" choice: Recordings, Pictures and PDFs, Transcripts, AI chats, Exports. A picture or PDF row turns to its page; others open in a new tab.
- **Where:** page sidebar › Files tab
- **Words:** notebook files, attachments, recordings list, pictures list, exports list, AI chats, transcripts
- **Settings:** `notebookOwnFolder`, `imagesFolder`, `exportsFolder`, `chatsFolder`, `transcriptsFolder`, `recordingsFolder`

### Go to a page number

- **Id:** `goToPage`
- **What:** Type a page number in the More panel to jump there.
- **Where:** More (⋯) › Go to page
- **Words:** go to page, jump to page, page number, page 12

### Fit the page / go to the top

- **Id:** `fitPage`
- **What:** Fits the page to the screen and goes to the top (on a board, fits the whole drawing).
- **Where:** command palette "Fit the page and go to the top" / "Fit the whole drawing on screen"
- **Words:** fit page, reset zoom, fit width, go to top, whole page
- **Commands:** `fit-reset-view`, `fit-board-drawing`
- **Tip:** `fillScreen`

### Page links (link to a page)

- **Id:** `pageLink`
- **What:** Copies a link like [[Physics.notebook#page=3|Physics, page 3]]; pasted in any note, it opens the notebook at that page. #Page 3 and #p3 work too.
- **Where:** More (⋯) › Copy link to page; page sidebar › ⌄ › Copy link to page; command palette "Copy link to current page"
- **Words:** link to page, page link, deep link, copy link, #page=3, jump to page from note, link to a page from a note, link from markdown, link a page
- **Commands:** `copy-page-link`
- **Tip:** `copyPageLink`

### Home Screen link to a notebook

- **Id:** `homeScreenLink`
- **What:** Copies an obsidian://open link to this notebook; on an iPad, paste it into a Shortcuts shortcut's Open URLs and add it to the Home Screen.
- **Where:** More (⋯) › Copy home screen link
- **Notes:** (meant for iPad)
- **Words:** home screen, app icon, shortcut to notebook, obsidian://open, bookmark notebook

### Read-only notebook

- **Id:** `readOnly`
- **What:** Stops the pen, eraser and every edit; scrolling, zoom, search and export still work. Stored in the notebook, so it holds on every device.
- **Where:** Toolbar › gear (Notebook settings) › Read-only
- **Words:** read only, lock notebook, protect notebook, prevent edits, finished notebook, view only
- **Tip:** `readOnly`

### Scroll direction (vertical or horizontal pages)

- **Id:** `scrollDirection`
- **What:** Vertical (pages one under another) or Horizontal (pages side by side, a swipe turns them), per notebook. New notebooks start the way you last chose.
- **Where:** gear (Notebook settings) › Scroll direction
- **Words:** scroll direction, horizontal, vertical, swipe pages, page by page, side by side, book mode, pages across
- **Settings:** `lastNotebookChoices`

### Join pages (write across pages)

- **Id:** `joinedPages`
- **What:** Removes the gap between pages so ink runs over the join; each page keeps its own copy of the ink that crosses.
- **Where:** gear (Notebook settings) › Join pages
- **Words:** join pages, no gap, continuous, seamless, write across pages, infinite scroll pages
- **Tip:** `joinedPages`

### Page numbers and header

- **Id:** `pageNumbers`
- **What:** Page numbers (None, Bottom centre, Bottom right; not on the cover) and a Header text where {title}, {page} and {pages} are filled in; both appear in exports too.
- **Where:** gear (Notebook settings) › Page numbers / Header
- **Words:** page numbers, numbering, header, footer, title on every page
- **Tip:** `pageNumbers`

### Margin beside a page (room beside slides)

- **Id:** `pageMargin`
- **What:** Adds writing space to the left, right or both sides of a page (a percentage), with Plain, Lined, Grid or Dotted paper, for This page, PDF pages or All pages. Covers never get one.
- **Where:** More (⋯) › Margin
- **Words:** margin, note space, room beside slides, wider page, extend page, notes column, lecture slides
- **Tip:** `margins`

### Dark pages, dark PDF pages, desk colour

- **Id:** `darkPages`
- **What:** Dark pages turns paper dark and ink light, for the view only (exports keep true colours). While dark, "Dark PDF pages" decides whether PDFs invert too. Desk sets the colour around the pages: with the pages, light, dark or a colour of your own.
- **Where:** More (⋯) › Dark pages / Light pages, Dark PDF pages, Desk; Settings › Pages › Paper › Page appearance (Light, Dark, Match Obsidian)
- **Words:** dark mode, night mode, dark pages, invert, black paper, desk colour, background colour
- **Settings:** `pageAppearance`, `invertPdfPages`, `desk`, `deskColor`
- **Tip:** `darkDesk`

### Convert a single page to a notebook

- **Id:** `convertToNotebook`
- **What:** An older single page (.page.md) takes no extra pages, PDFs or scans; convert it into a notebook to add them. Undoable.
- **Where:** page sidebar › ⌄ › Convert to notebook (single pages only); command palette "Convert single page to notebook"
- **Words:** single page, convert page, page.md, make notebook, add pages to page
- **Commands:** `convert-to-notebook`

### New board (endless canvas)

- **Id:** `newBoard`
- **What:** A board is one page that grows as you write near its edges. Its paper is Blank, Dotted or Squared.
- **Where:** Home › New › New board; New notebook dialog › ∞ "New board" toggle
- **Words:** board, infinite canvas, endless page, whiteboard, mind map, freeform, canvas, Freeform app
- **Tip:** `newBoard`

### Several boards in one board file

- **Id:** `multipleBoards`
- **What:** A board file can hold several boards: Add board adds an empty one, the sidebar's Boards tab lists them, and Go to board picks one by name. A board's ⌄ has Add to contents, Copy link to page, Move up/down, Clear board, Delete board.
- **Where:** board toolbar › Add page (acts as Add board); page sidebar › Boards tab › + Add board; command palette "Add board", "Go to board"
- **Words:** add board, another board, boards list, go to board, switch board
- **Commands:** `add-board`, `go-to-board`

### A board among a notebook's pages

- **Id:** `boardInNotebook`
- **What:** The Add page popover offers board cards ("Add board: Blank/Dotted/Squared"), putting an endless board between ordinary pages.
- **Where:** Toolbar › Add page › Add board
- **Words:** board in notebook, infinite page in notebook, canvas page

### What a board cannot do

- **Id:** `boardLimits`
- **What:** A board takes no PDF pages ("A board has no pages for a PDF's pages. Pictures can go on it."), no scans, no templates, no page links or Save as template, and is not converted to a notebook.
- **Where:** n/a
- **Words:** board PDF, board scan, board template, board pages

### Switch between notebook and Markdown view

- **Id:** `markdownView`
- **What:** Shows a notebook file as Obsidian Markdown (its frontmatter, title, text layer) or back as the notebook, remembered for the session.
- **Where:** command palette "Switch between notebook and Markdown view"
- **Words:** markdown view, source, raw file, edit markdown, frontmatter, notebook as text
- **Commands:** `toggle-canvas-markdown-view`

### Embed notebook pages in a Markdown note

- **Id:** `embedPages`
- **What:** ![[Name.notebook#page=3]] shows that page read-only in any note; ![[Name.notebook]] shows every page; |300 sets the width. A tap opens the notebook there. A board shows its drawing. Hover previews show up to 9 pages.
- **Where:** type the embed in any Markdown note
- **Words:** embed, transclude, show page in note, ![[ ]], notebook in markdown, page preview in note, hover preview
- **Tip:** `embedPages`

### Frames: embed part of a page

- **Id:** `frames`
- **What:** Lasso something, choose Turn into › Frame to embed and name it; the embed link (![[Notebook#Name]]) is copied. A tap on a frame's name: Copy embed link, Rename frame, Delete frame.
- **Where:** lasso › Turn into › Frame to embed
- **Words:** frame, region, embed part of page, crop embed, snippet, named area

### Import a PDF into a notebook

- **Id:** `importPdf`
- **What:** Adds a PDF's pages after the current page, each with the PDF page as its paper; a dialog picks All pages or a page range ("1-3, 5", in the order typed). Several PDFs chosen at once go in whole, in order, as one undo step. The original PDF is kept; an outline becomes contents entries (with Undo).
- **Where:** Toolbar › PDF ("Insert PDF") › From files / From vault; file explorer right-click a PDF › Import PDF into notebook (with a notebook open); command palette "Import PDF…", "Import PDF from vault…"
- **Words:** import PDF, add PDF, insert PDF, annotate PDF, slides, lecture slides, worksheet, textbook, PDF pages
- **Settings:** `imagesFolder`
- **Commands:** `import-pdf`, `import-vault-pdf`

### Drag a PDF or picture onto a notebook

- **Id:** `dropPdf`
- **What:** Drop a PDF or picture from the file list (or the system) onto an open notebook: a PDF's every page is added at the end without asking; a picture is placed on the page.
- **Where:** drag a file onto an open notebook
- **Words:** drag and drop, drop PDF, drop image, drag from files
- **Commands:** `import-pdf`
- **Tip:** `dropPdf`

### New notebook from a PDF

- **Id:** `notebookFromPdf`
- **What:** Makes a new notebook whose pages are the PDF's, with the last notebook choices (cover included), saved beside the PDF (vault) or with the PDF copied in (device).
- **Where:** Home › New › Import PDF › From files / From vault; New notebook dialog › Paper › Import PDF; file explorer right-click a PDF › New notebook from PDF; command palette "New notebook from a PDF in the vault…"
- **Words:** PDF to notebook, open PDF as notebook, annotate PDF, new from PDF, import PDF as notebook
- **Settings:** `notebookOwnFolder`, `newNotebookFolder`
- **Commands:** `create-notebook-from-pdf`

### New notebook from a picture

- **Id:** `notebookFromImage`
- **What:** Makes a notebook with the chosen picture on its first page, using the last notebook choices.
- **Where:** Home › New › Add image…
- **Words:** image to notebook, photo notebook, picture notebook
- **Settings:** `notebookOwnFolder`

### Read scanned PDF pages (OCR)

- **Id:** `pdfOcr`
- **What:** Scanned PDF pages are read on this device so search, the text-snapping highlighter and Copy text work on them; nothing leaves the device. The command reads a PDF's scanned pages again.
- **Where:** AI menu › Scanned pages (switch); command palette "Re-read scanned pages of this PDF"
- **Notes:** (Most accurate model on desktop only)
- **Words:** OCR, scanned PDF, text recognition, searchable PDF, image PDF
- **Settings:** `ocrScannedPdfs`, `ocrModel`
- **Commands:** `reread-scanned-pages`

### Scan paper into pages

- **Id:** `scanDocument`
- **What:** Take or choose a photo, drag four corners onto the page, choose Colour, Greyscale or Black & white, Rotate or Retake; Next page adds more; Add puts them all in as new pages after the current one (one undo). On an older single page the scan goes onto it.
- **Where:** Toolbar › Image ("Insert image") › Scan document; command palette "Scan document into this notebook"
- **Notes:** camera opens on iPad/phone, a file picker for a photo on a computer
- **Words:** scan, document scanner, camera, photograph page, scan worksheet, CamScanner
- **Settings:** `imagesFolder`
- **Commands:** `scan-document`
- **Tip:** `scan`

### Export as PDF

- **Id:** `exportPdf`
- **What:** The Export dialog: All pages, This page, or Choose pages (tap, or type "1-3, 5"; tap order is the PDF's page order). Saved next to the notebook (or in the exports folder), never over a file; then Open or Share…. PDF pages stay real PDF with selectable text.
- **Where:** Toolbar › Export (share icon); Home › ⌄ › Export as PDF; page grid › Select › Export; command palette "Export…"
- **Notes:** (Share… only where the system share sheet takes files)
- **Words:** export, PDF, save as PDF, print, share notebook, send notebook, download PDF
- **Settings:** `exportsFolder`, `exportFormat`
- **Commands:** `export-pdf`

### Export as pictures (PNG or JPG)

- **Id:** `exportPictures`
- **What:** The Format choice: PNG (sharp, larger) or JPG (smaller), one picture per page; several pages go into a new folder.
- **Where:** Export › Format
- **Words:** PNG, JPG, JPEG, image export, export page as image, picture
- **Settings:** `exportFormat`
- **Commands:** `export-pdf`
- **Tip:** `pictureExport`

### Export without lines (plain paper)

- **Id:** `exportPlain`
- **What:** The Template background button leaves out the paper's lines, grid, dots and texture; remembered for next time.
- **Where:** Export › Template background (grid icon)
- **Words:** export without lines, plain export, no grid, remove template, clean export
- **Settings:** `exportPlainPaper`
- **Commands:** `export-pdf`
- **Tip:** `plainExport`

### Export without cover tapes (answer sheet)

- **Id:** `exportTapes`
- **What:** The Cover tapes button leaves every tape out, so what is under them shows; shown only when the notebook has tapes.
- **Where:** Export › Cover tapes
- **Words:** cover tape export, answer sheet, hide tapes, reveal answers
- **Settings:** `exportWithoutTapes`
- **Commands:** `export-pdf`
- **Tip:** `tapeExport`

### Export margins

- **Id:** `exportMargins`
- **What:** The Margins button cycles: all margins, only those with ink, or none (pages as they were before the margin).
- **Where:** Export › Margins button (when pages have margins)
- **Words:** export margins, margin notes in export, crop margins
- **Settings:** `exportMargins`
- **Commands:** `export-pdf`

### Import notebooks from another app

- **Id:** `importNotebooks`
- **What:** The Import notebooks dialog (Beta) takes notebook files, a .zip or a PDF, several at once, and rebuilds backup folders. Handwriting stays editable; paper, templates and pictures come over. "Save to" picks the folder; "How do I export?" explains each app. A summary lists what could not come over.
- **Where:** Home › New › Import from another app…; New notebook dialog › Import from another app…; file explorer right-click a folder › Import notebook (beta)…; welcome › Import…
- **Notes:** (drop zone on desktop; "Choose notebooks" on iPad)
- **Words:** import, migrate, switch from Goodnotes, move from Notability, bring notebooks, transfer notebooks, backup import
- **Settings:** `notebookOwnFolder`, `newNotebookFolder`
- **Tip:** `importBooks`

### Import from Goodnotes

- **Id:** `importGoodnotes`
- **What:** Goodnotes notebooks or whole folders exported in the Goodnotes format (several come as one .zip, folders kept), or an auto-backup .zip. Shapes come as outlines; comments as text boxes with the author's name; JPEG 2000 pictures need converting.
- **Where:** Import notebooks dialog; in Goodnotes: Select › Export › Goodnotes format
- **Words:** Goodnotes, .goodnotes, Goodnotes backup, Goodnotes zip
- **Tip:** `importBooks`

### Import from Notability

- **Id:** `importNotability`
- **What:** Notes shared or exported as Note (.note) or the new .ntb format, or an Auto-backup. Sticky canvases come as coloured boxes; rotated text upright; dashed lines solid.
- **Where:** Import notebooks dialog
- **Words:** Notability, .note, .ntb, Notability backup
- **Tip:** `importBooks`

### Import from Noteful

- **Id:** `importNoteful`
- **What:** Notebooks exported in the Noteful format, or a backup's files. Some shapes and elements are not brought over yet.
- **Where:** Import notebooks dialog
- **Words:** Noteful, .noteful
- **Tip:** `importBooks`

### Import from reMarkable

- **Id:** `importRemarkable`
- **What:** A notebook exported as .rmdoc (or a single .rm page). Typed text and text highlights are not brought over yet; eraser strokes and hidden layers are left out; a book's own pages are not brought over, only the handwriting.
- **Where:** Import notebooks dialog
- **Words:** reMarkable, .rmdoc, .rm, e-ink tablet
- **Tip:** `importBooks`

### Import from Supernote

- **Id:** `importSupernote`
- **What:** The .note file from the device. Handwriting comes as a picture of each page (written over, not edited stroke by stroke); templates come as blank paper; titles are listed by page.
- **Where:** Import notebooks dialog
- **Words:** Supernote, .note, Ratta
- **Tip:** `importBooks`

### Import from Saber

- **Id:** `importSaber`
- **What:** The note file (.sbn2, .sbn), or a .sba archive to bring pictures over. Typed text comes as plain text.
- **Where:** Import notebooks dialog
- **Words:** Saber, .sbn2, .sbn, .sba
- **Tip:** `importBooks`

### Import from Xournal / Xournal++

- **Id:** `importXournal`
- **What:** The notebook file (.xopp, .xoj). LaTeX and links are not brought over yet.
- **Where:** Import notebooks dialog
- **Words:** Xournal, Xournal++, .xopp, .xoj
- **Tip:** `importBooks`

### Import from FreeNotes

- **Id:** `importFreenotes`
- **What:** A notebook shared as a .freenotes file. Pictures, text and some objects are not brought over yet.
- **Where:** Import notebooks dialog
- **Words:** FreeNotes, .freenotes
- **Tip:** `importBooks`

### Import from any other app via PDF

- **Id:** `importOtherPdf`
- **What:** Any other app: export a PDF and import it. Handwriting saved as real PDF annotations comes over as editable ink; ink an app flattened stays part of the paper (write over it, not edit it).
- **Where:** Import notebooks dialog (a PDF); or New notebook from a PDF
- **Words:** Apple Notes, Noteshelf, Nebo, CollaNote, OneNote, Samsung Notes, export PDF, flattened PDF

### Where pictures, recordings, exports and chats are saved

- **Id:** `attachmentFolders`
- **What:** For notebooks without their own folder: folders for pictures and PDFs, recordings, recording transcripts, AI chats and PDF exports. Empty uses each kind's default (Obsidian's attachment folder, next to the recording, AI chats next to the notebook, next to the notebook).
- **Where:** Settings › Files and folders › For notebooks without their own folder
- **Words:** attachment folder, images folder, exports folder, recordings folder, where are my files, file location
- **Settings:** `imagesFolder`, `recordingsFolder`, `transcriptsFolder`, `chatsFolder`, `exportsFolder`

### Stickers and templates folders

- **Id:** `assetFolders`
- **What:** Your own stickers and templates live in "FineNotes assets" (Stickers, Templates); the Assets folder setting moves both. Stickers are one folder per collection; Turn into › Sticker saves into "My stickers".
- **Where:** Settings › Files and folders › Stickers and templates › Assets folder (and Stickers folder / Templates folder when set)
- **Words:** stickers folder, templates folder, FineNotes assets, my stickers, sticker collection
- **Settings:** `assetsFolder`, `stickerFolder`, `templateFolder`
- **Tip:** `saveSticker`

### Simple look (hide Obsidian's chrome)

- **Id:** `simpleLook`
- **What:** Hides Obsidian's title bar, status bar, left ribbon and sidebars (tabs stay) so FineNotes looks like its own app; Home then shows its folder rail.
- **Where:** Settings › General › Simple look; gear (Notebook settings) › Simple look; Home's card "Only here for FineNotes?"; welcome; command palette "Simple look: hide or show Obsidian's tabs, sidebars and menus"
- **Words:** simple look, hide sidebars, hide ribbon, app-like, distraction free, clean interface, hide Obsidian
- **Seen as:** left panel disappears, side panels gone, sidebars missing, ribbon gone, menus disappeared
- **Settings:** `simpleLook`
- **Commands:** `toggle-simple-look`

### Looks: style and colours of FineNotes' bars

- **Id:** `looks`
- **What:** Restyles FineNotes' own bars, menus and dialogs: Style (Default, Glass, Material, Fluent, Paper, Brutalist, Soft, Retro, Compact) and Colours (Obsidian's, Nord, Catppuccin, Dracula, Rosé Pine, Gruvbox, Solarized, Tokyo Night, Everforest, High contrast). Pages and ink stay as they are.
- **Where:** Settings › General › Style / Colours; command palette "Look: next style", "Look: next colours"
- **Words:** theme, look, style, colours, palette, Nord, Dracula, Catppuccin, glass, material, skin
- **Settings:** `lookStyle`, `lookPalette`
- **Commands:** `next-look-style`, `next-look-palette`
- **Tip:** `looks`
