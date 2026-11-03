# On-device OCR for PDF pages

FineNotes reads text that exists only as pixels in a PDF, on the device, for
search, the highlighter that snaps to text, and Copy text. This document is for
contributors and for users who want to know exactly what it does.

## What it does, and what it does not

- Reads **scanned pages** (a picture of text), **pages with no text at all** that
  have ink (text drawn as outlines), and **the pictures on pages that have text
  of their own** (the labels in an anatomy figure, a chart, a photographed
  form). The last is "image-area OCR".
- Never reads text that is already in the page's text layer. Native text always
  wins: an OCR word that lies over it is dropped.
- **On demand, never the whole vault.** Only PDFs that an open notebook shows
  are looked at: the page in view first, then its neighbours, then the rest of
  that PDF only while idle. A PDF no open notebook uses is dropped from the
  queue. One page (one picture area) at a time; nothing starts while the pen
  writes.
- Nothing downloads without a yes. The model (35.7 MB) is offered only for a page
  with no text of its own and some ink.
- Printed text only. Messy handwriting is left alone (see the filter below).
- Does not: read vertical or rotated text (lines leaning more than about 15
  degrees are dropped), read CJK reliably (the dictionary has it, but it is
  untested), tell double letters reliably, or read pages in the background of
  PDFs nobody has open. No run on a real iPad yet (see Known limits).

Settings (Pages and notebooks): **Read scanned PDF pages (on-device OCR)**
(`ocrScannedPdfs`, default on) and, under it, **Also read text inside figures**
(`ocrFigureText`, default on, only in effect while the first is on). The command
**Re-read scanned pages of this PDF** forgets that PDF's cache and reads it again.

## Page conditions

Every page of a PDF that is looked at is exactly one of five conditions
(`src/recognition/ocr/figures.ts`, pure and unit-tested):

| condition                    | what the page is                                                                                | what is read                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| `TEXT_ONLY`                  | text of its own, no picture worth reading                                                       | nothing: no raster, no model     |
| `TEXT_WITH_FIGURES`          | text of its own and at least one qualifying picture                                             | only the pictures' areas, padded |
| `SCANNED`                    | no or sparse text, one picture over at least 60% of the page (or other ink beside the pictures) | the whole page                   |
| `NO_TEXT_NO_IMAGE_NOT_BLANK` | no text, no qualifying picture, but ink                                                         | the whole page                   |
| `BLANK`                      | nothing on it                                                                                   | nothing                          |

How each is detected:

1. **Text.** The page's text items are laid out (`canvas/pdf-text.ts`). The page is
   _sparse_ when it has fewer than 40 characters or its characters cover less
   than 2% of its area (`isSparse`).
2. **Pictures, from the PDF itself.** pdf.js's operator list (`getOperatorList`,
   `OPS` from the same pdf.js `pdf-text-source.ts` uses) is turned into a short
   list of `save` / `restore` / `transform` / `image` operations (`gfxOpsFrom`;
   form XObjects become save + transform, repeated and grouped images one image
   per placement). `collectImages` follows the current transformation matrix,
   maps the unit square of every `paintImageXObject`, `paintInlineImageXObject`,
   `paintImageXObjectRepeat` and `paintImageMaskXObject` through it and the
   page's viewport (so rotation and an offset origin are right), boxes it
   (rotated and flipped images included), and clips it to the page. Its
   resolution is the stored pixels over the inches it covers. `mergeImages` joins
   boxes that overlap or lie within 3 pt (a picture cut into strips is one);
   `isFigureSized` drops those under 0.5 in on either side or under 1.5% of the
   page. The pdf.js call is a dozen lines (`view/pdf-figures.ts`).
3. **The decision** (`classifyPage`): text and no figure is `TEXT_ONLY`; text and a
   figure is `TEXT_WITH_FIGURES`; sparse with a figure covering at least 60% is
   `SCANNED`; sparse with smaller figures is `TEXT_WITH_FIGURES` _after_ a raster
   of the rest of the page shows no ink outside the figures and the page's own
   text (otherwise the whole page is read as `SCANNED`); sparse with no figure
   is `NO_TEXT_NO_IMAGE_NOT_BLANK` until a raster shows it has no ink at all,
   which makes it `BLANK` (`settledCondition`). When the pictures cannot be
   looked at (the figure setting is off, or the operator list failed) a dense
   page is left alone and a sparse one is read whole, as before, and nothing is
   recorded for it.

Clip paths other than the page edge are not tracked: a picture cropped by a clip
is taken whole, and the clipped part draws white, so it reads as nothing.

```mermaid
flowchart TD
  A[page's text read by pdf.js] --> B{cached condition?}
  B -- yes --> M[merge cached words, no work]
  B -- no --> C{sparse text?}
  C -- no --> D{figure setting on?}
  D -- no --> T[TEXT_ONLY, nothing recorded]
  D -- yes --> E[operators -> pictures -> merge -> size filter]
  E -- none --> R[TEXT_ONLY recorded in cache]
  E -- some --> F[TEXT_WITH_FIGURES]
  C -- yes --> G[operators -> pictures]
  G -- one over 60% --> S[SCANNED: whole page]
  G -- smaller ones --> H[raster: ink outside figures and text?]
  H -- yes --> S
  H -- no --> F
  G -- none --> I[raster: any ink?]
  I -- no --> BL[BLANK]
  I -- yes --> N[NO_TEXT_NO_IMAGE_NOT_BLANK: whole page]
  F --> Q{model here?}
  S --> Q2{model here?}
  Q -- no, never offered --> W[waiting for model, re-queued when it arrives]
  Q -- yes --> RG[each region: raster, ink check, det+rec, words to page space]
  Q2 -- no, no text at all --> O[offer download]
  Q2 -- no, some text --> W
  Q2 -- yes --> WH[raster whole page, det+rec]
  RG --> X[cache: condition, regions, raw words]
  WH --> X
```

## The pipeline

(`src/recognition/ocr/`, pure; the networks are behind an `OcrBackend`.)

1. **Detection** (`det.ts`, `db.ts`). The image is cut into 800 px tiles with 96 px
   overlap, each run through PP-OCRv5 mobile **DBNet**; the probability maps are
   stitched. DB post-processing thresholds at 0.3, finds 8-connected blobs, fits a
   rectangle along each blob's own direction, scores it (mean probability at least
   0.6), grows it by the unclip distance (area x 1.5 / perimeter), and drops blobs
   that are tiny, unsure, or lean more than 0.26 rad. Boxes go into reading order.
2. **Recognition** (`rec.ts`, `ctc-words.ts`). Each box is cropped to 48 px high
   (`REC_CORE` 1.2: the box is taken to be 1.2x the text's height, so the crop is
   its height/1.2 and the font is not squashed), batched by width (4 per batch,
   widths within 1.35x), and run through the **SVTR** recogniser. **CTC** decoding
   gives characters with their positions and probabilities.
3. **Words** (`ctc-words.ts`, `word-edges.ts`). Characters are grouped into words at
   gaps; each word's box is extended by half the line's median character pitch
   beyond its first and last character (a tenth more on the right), then
   **snapped to the ink** of the crop: the widest ink-free gap between words. Mean
   word IoU against ground truth 0.82 to 0.89 on the noisy synthetic page.
4. Each word keeps its mean confidence and its least character confidence, and a
   line its mean. Words are boxed in the page's points (pixels / scale + the
   region's origin for a picture area).

### The handwriting confidence filter

Words are stored raw and filtered when read, so retuning needs no new reading
(`keptLines`, `OCR_TUNING`): a line is dropped whole when its mean confidence is
below **0.75**; a word is kept when the mean of its characters is at least
**0.85** and the least is at least **0.5**. On the synthetic page with scribbles
and cursive (7 regions) no scribble produced a kept word; the CER of what was kept
against the printed text was 0.36%.

## Mixed pages and the native-text merge

`mergedItems` returns the page's own items plus the kept OCR words that do not lie
over native text (`dropCovered`): an OCR word is dropped when 30% of it lies under
one native word, or under several together (a label read as one word across a line
of text), or when IoU with one native word reaches 30%. A page with sparse text
gets OCR words only while it is still sparse; a `TEXT_WITH_FIGURES` page always
gets its figure words (unless the figure setting is off); `TEXT_ONLY` and `BLANK`
pages never do. Figure captions sit beside the pictures, which is why the overlap
drop is applied to figure words too.

## Image-area OCR

For a `TEXT_WITH_FIGURES` page the service reads each padded region on its own,
one at a time:

- **Padding.** Each figure box is widened by 6 pt (labels sit at the edge of a
  picture), kept on the page, and boxes that now touch are merged again so nothing is
  read twice.
- **Resolution** (`regionRaster`): about the picture's own stored pixel density,
  between 170 and 300 dpi, and with no side longer than 2200 px. Small figure labels
  (3 to 6 pt) need it.
- **Raster.** The shared PDF worker draws the page at that scale with a transform
  that moves the region's corner to the canvas corner; if the worker cannot run, the
  main-thread pdf.js does the same (`view/ocr-raster.ts`).
- **Ink check.** A region with no ink beyond the page's own text is not sent to the
  model.
- **Read.** det + rec on the region; the worker is told the region's origin so the
  words come back in page space. Same queue, priority, pen hold, cancel and retry
  rules as a whole page; if the pen goes down or the PDF is closed between two
  regions, the page is put back and read again later.
- **Download rule.** A `TEXT_WITH_FIGURES` page is read only when the model is
  already on the device. If it is not, the page waits in the "waiting for model"
  list and joins the queue when the model arrives. It never makes the download be
  offered (only a page with no text at all may).

## Tunables

`OCR_TUNING` (`ocr-words.ts`) and the other constants. "Measured" refers to the
lecture documents below or the synthetic page.

| name                                                          | value                   | meaning, and why                                                                                                                       |
| ------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `wordMean`                                                    | 0.85                    | a word's mean character confidence at least this; the scribble test kept none and the printed page lost none                           |
| `wordMin`                                                     | 0.5                     | the least character at least this                                                                                                      |
| `lineMean`                                                    | 0.75                    | a line below this is dropped whole                                                                                                     |
| `sparseAreaShare`                                             | 0.02                    | native text covering under 2% of the page is sparse                                                                                    |
| `sparseChars`                                                 | 40                      | fewer characters is sparse (a page number, a header)                                                                                   |
| `overlap`                                                     | 0.3                     | share of an OCR word under native text that drops it                                                                                   |
| `figureMinSide`                                               | 36 pt                   | a picture under 0.5 in on either side is an icon, logo, bullet or badge; the smallest figure with labels in the lecture PDFs is 116 pt |
| `figureMinAreaShare`                                          | 0.015                   | under 1.5% of the page is not a figure either                                                                                          |
| `figureMergeGap`                                              | 3 pt                    | pictures this close are one figure (strips)                                                                                            |
| `figurePad`                                                   | 6 pt                    | a label at the picture's edge is still read                                                                                            |
| `scannedShare`                                                | 0.6                     | a sparse page with a picture over 60% of it is a scan                                                                                  |
| `figureMinDpi` / `figureMaxDpi`                               | 170 / 300               | raster resolution follows the picture, clamped; every figure in the lecture PDFs is stored above 300 dpi, so all were read at 300 dpi  |
| `figureMaxEdge`                                               | 2200 px                 | longest side of a region raster (memory on a phone)                                                                                    |
| `OCR_DPI` / `OCR_MAX_EDGE`                                    | 170 / 2200              | whole-page raster                                                                                                                      |
| `DET_TILE_SIDE` / `DET_TILE_OVERLAP`                          | 800 / 96 px             | smaller tiles than 1280 cut peak memory by about 270 MB with the same accuracy                                                         |
| `DB_THRESHOLD`, `DB_BOX_SCORE`, `DB_UNCLIP_RATIO`, `MAX_TILT` | 0.3, 0.6, 1.5, 0.26 rad | PaddleOCR's own post-processing values; tilt is about 15 degrees                                                                       |
| `REC_CORE`                                                    | 1.2                     | see the variant table                                                                                                                  |
| `REC_STRIDE`, `REC_BATCH`                                     | 8, 4                    | pixels per CTC time step; recogniser batches of 4 for memory                                                                           |
| `RIGHT_BIAS`                                                  | 0.1                     | a tenth more on a word's right edge                                                                                                    |
| `CLASSIFY_VERSION`                                            | 1                       | bump when the classification rules change: a `TEXT_ONLY` page recorded under older rules is looked at again                            |
| `IDLE_MS`                                                     | 3000                    | pages away from the one in view wait until nothing happened for this long                                                              |
| `RETRY_MS`, `MAX_FAILURES`                                    | 60 s, 4                 | a failed page is not retried for a minute; four failures in a row and OCR rests for the session                                        |
| `SAVE_MS`                                                     | 2500                    | the cache is written this long after the last page                                                                                     |

**REC_CORE variants** (synthetic scan pages, Chromium, real models; CER of all words
on `a-scan`, `a-scan-1col`; double-letter words exact): 1.0: 0.50%, 0.78%, 18/21;
1.1: 0.00%, 0.09%, 21/21; **1.2: 0.14%, 0.44%, 21/21 (chosen)**; 1.3: 0.36%, 0.17%. A horizontal stretch of 1.15 or 1.3 gave no gain (0.07% to 0.61%). 1.2 is
the value with all double letters right and no cost on the clean page.

## Model files

Downloaded on first use into `<plugin>/ocr/ppocrv5/`, never bundled, each pinned by
exact size and SHA-256 (`ocr-model.ts`), over https from jsDelivr:

| file                             | bytes      | SHA-256                | source, licence                                                          |
| -------------------------------- | ---------- | ---------------------- | ------------------------------------------------------------------------ |
| `PP-OCRv5_mobile_det_infer.ort`  | 4,896,928  | `30acfc4e...420abc`    | PaddleOCR weights via npm `pdfmarkdown-ppocrv5-models@1.0.0`, Apache-2.0 |
| `PP-OCRv5_mobile_rec_infer.onnx` | 16,559,278 | `d253c3cb...9d22b3`    | same                                                                     |
| `ppocrv5_dict.txt`               | 74,014     | `9dfc80c5...166ff3`    | same                                                                     |
| `ort-wasm-simd-threaded.wasm`    | 14,239,897 | `3398c10d...78842dee2` | onnxruntime-web 1.30.0, MIT                                              |

Total 35.7 MB. The full hashes are in `src/recognition/ocr/ocr-model.ts` and
`THIRD_PARTY_NOTICES.txt` lists the licences. The OCR worker is started from a Blob
URL, one thread, handed the wasm bytes (no SharedArrayBuffer is needed).

## Cache

One JSON sidecar per PDF: `<plugin>/ocr/<SHA-256 of the PDF's bytes>.json`, so it
syncs with the vault and a PDF moved or renamed keeps it. **Format 2.** Per
zero-based page: the model version, `condition`, `regions` (the page-space rects
read, with their dpi), the page and image sizes, and the raw lines of words with
confidences. A `TEXT_ONLY` or `BLANK` page is recorded too, with no regions and no
words, so reopening a PDF costs nothing: no operators, no raster, no model. Entries
of format 1, of another model version, with an unknown condition, or a `TEXT_ONLY`
entry recorded under other `CLASSIFY_VERSION` rules are misses. The file is read
tolerantly (damaged pages and words are dropped), written a pause after the last
page and never while the pen is held, through a temporary name and then moved, and
merged with what another device may have added (a page read by this model is not
replaced by one read by another). Hashing the PDF reads its bytes once per file
version (cached by modification time and size).

## Scheduling

The queue (`ocr-queue.ts`): the PDF most recently looked at first; within it the
page in view, then pages at most 1 away (both whenever the pen is up), then the rest
nearest first only while idle. While idle, the pages of a PDF that has something to
read are probed (their text read, so they are classified) so the whole PDF is
classified without being drawn. The **pen hold** stops everything and nothing starts
until it has been up a moment. **Cancel:** closing the last notebook that shows a PDF
drops its queue and its worker copy. **Retry/backoff:** a failed page waits 60 s;
four failures in a row rest OCR until "Re-read" or a restart; one notice per session.
The OCR worker is released after 2 minutes idle.

## Measurements

Chromium (Playwright), real PP-OCRv5 models, one-thread wasm, Blob worker as on the iPad.

**Synthetic pages** (`ocr-e2e`, A4 at 170 dpi, 221 words): clean page CER 0.00%;
scan (1 degree rotation, noise, blur) 0.14%; one-column scan 0.44%; 21/21 double-letter
words exact on the two-column pages; about 11 to 12 s per page (detect 3.3 s, recognise
7.5 to 9 s); the Blob worker gave a result identical to the main thread; a merge test
with native "7" over the printed one kept exactly one. **Memory:** peak extra RSS
907 MB with 1280 px tiles and batches of 8, 640 MB with 800 px tiles and batches of 4
(baseline 380 MB).

**Lecture PDFs.** The committed modules (`PdfTextCache`, `OcrService`, `OcrRasteriser`,
figures, pipeline) were run in Chromium over every page, with the real models and
Playwright's pdf.js 4.10 standing in for Obsidian's: each page was focused in turn, the
service read it, and the table is read from the cache and a recomputation from the
page. The harness is not committed. "Time" is raster + OCR for that page.

**57.pdf** (8 pages, 612x866 pt)

| page | native chars | figures (page rects, pt) | skipped small | condition | regions read / rasters / OCR calls | words raw | dropped by confidence | dropped as covered | kept | time (ms) |
| ---- | ------------ | ------------------------ | ------------- | --------- | ---------------------------------- | --------- | --------------------- | ------------------ | ---- | --------- |
| 1    | 1315         | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 2    | 951          | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 3    | 1444         | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 4    | 1642         | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 5    | 1545         | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 6    | 1830         | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 7    | 1754         | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 8    | 1423         | 0                        | 0             | TEXT_ONLY | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |

OCR + raster time: 0.0 s; wall time for all pages (focus each in turn): 2.5 s

**53.pdf** (16 pages, 612x866 pt)

| page | native chars | figures (page rects, pt)                                                                                     | skipped small | condition         | regions read / rasters / OCR calls | words raw | dropped by confidence | dropped as covered | kept | time (ms) |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------ | ------------- | ----------------- | ---------------------------------- | --------- | --------------------- | ------------------ | ---- | --------- |
| 1    | 1326         | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 2    | 913          | 1: [421,444,571,561]                                                                                         | 0             | TEXT_WITH_FIGURES | 1 / 1 / 1                          | 22        | 4                     | 0                  | 18   | 1919      |
| 3    | 778          | 2: [73,454,329,641] [346,454,539,641]                                                                        | 0             | TEXT_WITH_FIGURES | 2 / 2 / 2                          | 67        | 5                     | 0                  | 62   | 5663      |
| 4    | 1152         | 1: [427,392,549,515]                                                                                         | 0             | TEXT_WITH_FIGURES | 1 / 1 / 1                          | 28        | 1                     | 0                  | 27   | 1628      |
| 5    | 1418         | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 6    | 1171         | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 7    | 945          | 2: [176,562,313,696] [330,532,437,684]                                                                       | 0             | TEXT_WITH_FIGURES | 2 / 2 / 2                          | 149       | 17                    | 0                  | 132  | 6061      |
| 8    | 1415         | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 9    | 1219         | 2: [186,487,287,574] [38,624,163,770]                                                                        | 0             | TEXT_WITH_FIGURES | 2 / 2 / 2                          | 12        | 5                     | 0                  | 7    | 997       |
| 10   | 853          | 6: [60,410,268,526] [285,421,410,538] [427,421,552,538] [44,586,260,703] [277,575,394,691] [411,562,569,680] | 0             | TEXT_WITH_FIGURES | 6 / 6 / 6                          | 127       | 8                     | 0                  | 119  | 8425      |
| 11   | 1507         | 2: [59,532,370,637] [387,509,552,626]                                                                        | 0             | TEXT_WITH_FIGURES | 2 / 2 / 2                          | 56        | 27                    | 0                  | 29   | 3097      |
| 12   | 1788         | 1: [434,482,569,617]                                                                                         | 0             | TEXT_WITH_FIGURES | 1 / 1 / 1                          | 6         | 0                     | 0                  | 6    | 796       |
| 13   | 1951         | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 14   | 1889         | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 15   | 1716         | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |
| 16   | 634          | 0                                                                                                            | 0             | TEXT_ONLY         | 0 / 0 / 0                          | 0         | 0                     | 0                  | 0    | 0         |

OCR + raster time: 28.6 s; wall time for all pages (focus each in turn): 32.6 s

Findings:

- 57.pdf has no images: all 8 pages are `TEXT_ONLY`, with 0 rasters and 0 OCR calls
  (2.5 s in all, which is the text reads and the classification).
- 53.pdf: the 8 pages with images (2, 3, 4, 7, 9, 10, 11, 12) are `TEXT_WITH_FIGURES` and
  only their 17 figure areas were drawn and read; the other 8 are `TEXT_ONLY`. No image-bearing
  page was left without a qualifying image: all 17 images are 116 pt or more on their short
  side and 1.5% or more of the page, and none was skipped as small (the "★ n" badges are
  vector or text, not images). The page-10 operators place six images, all qualifying.
- **No duplicates of native text.** Of 400 kept OCR words none overlaps a native word. Eight
  kept words equal a native word within 20 pt (a figure's own "Vesicovaginal Fistula",
  "Urinary Sphincter" etc. above the native caption that repeats them): they are different
  pixels in a different place, 6 to 19 pt apart, and are not the native text read twice.
- **Search** now finds hits inside the figures (hits with the figure option off to on, in
  this PDF): "Bladder" 59 to 90 (31 inside figures), "sling" 5 to 10 (5), "urethra" 42 to
  54 (12), "Pubic bone" 7 to 13 (6). "Cooper" and "Burch" occur only in native text (1 and 2
  hits both ways). The overlay `overlay-53-p10.png` (kept OCR boxes on page 10) shows each
  box on its label.
- **Figure-label accuracy.** Ground truth was transcribed by eye from 4x and 10x renders of
  all 17 figure areas: 171 labels (230 printed lines, 460 words). Matching is
  case-insensitive, ignores punctuation, and ignores spaces (so "250ml" matches "250 ml").
  Label recall, labels found exactly: **131/171 = 76.6%** (82.2% of lines); with
  near-misses of at most 40% character edits 147/171 = 86.0%; CER over those matched
  labels 2.89%. Of 400 kept words, 390 (97.5%) belong to a real label, 343 (85.8%) to an
  exactly-read one, and 10 are not part of any label (a "2" and "3" from "L2"/"L3", a "9",
  two "X" icons, a few words of misread labels). The misses are, by kind: single letters on
  photographs and panel letters (A. C. E. F. G. I. J. K., a, b, c: 11), vertebra and sacral
  labels crossed by nerve drawings (L2 L3 L4 S3 S4: 5), tiny text in grey table cells
  ("Nil", "Yes", "Coughing", "(circle as appropriate)": 4), "Delta < 30" (2), the italic subtitle
  "Bladder augmentation" (misread "augumentation") and "5 Intestine and". The handwritten
  signature on 3-1 was not kept. Raising the maximum raster to 400 dpi (and the minimum
  to 250) gave 78.9% recall and 98.5% precision (the model's own limit on tiny text,
  not the raster size), so the 170 to 300 range stayed as specified. With the circled
  step numbers of the Cleveland Clinic figure left out of the ground truth (they are icons)
  recall is 137/171 = 80.1%; counting a word split differently from the printed one as a miss
  (strict word boundaries) it is 122/171 = 71.3%. The numbers are reproducible with the
  harness kept outside the repository (scratchpad `lec-e2e`).
- Target check: classification of all 24 pages as described: met. Zero duplicates: met.
  Precision (kept words that are real labels) 97.5% against 95%: met. **Recall 76.6% against
  85%: not met**, for the reasons listed. Nothing was tuned to these two PDFs; the figure
  constants are principled values (0.5 in, 1.5%, 170 to 300 dpi), and the recogniser's
  thresholds are the earlier rounds' values.

A bug found by this run and fixed: pdf.js 4.10 reports `NaN` as the ascent of fonts it has
no metrics for, which made every item of 57.pdf unplaceable (the page then looked
sparse and would have been read whole). `readTextItems` and `layoutText` now ignore a
non-finite ascent or descent.

## Known limits and TODOs

- No run on a real iPad yet. Speed and memory are measured in desktop Chromium; an
  iPad with wasm and no threads will be slower, and a whole-page background image on
  every page of a deck makes each page a whole-page figure read.
- Vertical and rotated text (more than 15 degrees) is dropped; CJK is untested.
- Double letters are right on the test pages but are the recogniser's weakest point,
  and so are single letters and symbols (circled digits, "Delta") on busy backgrounds.
- A circled step number read as a symbol is not matched as a word.
- Clip paths other than the page edge are not tracked.
- Settings changes apply to the next time a page is read; a notebook already open
  keeps the text it has until the page is read again.
- Hashing a PDF to name its cache reads its bytes once; very large PDFs on a phone
  pay for that once per file version.
