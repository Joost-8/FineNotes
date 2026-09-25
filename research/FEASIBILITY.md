# GoodObsidian — Technical Feasibility

**Date of research: 2026-09-20.** Every claim below is tagged:

- **CONFIRMED** — read it in primary documentation, a spec, a licence file, package metadata, or source code.
- **LIKELY** — multiple consistent secondary sources, or one strong primary source plus corroboration.
- **UNVERIFIED** — plausible, single-sourced, or inferred. Do not build on these without testing.

Where the honest answer is "this is a real risk", it says so.

> **Note on scope drift.** `PLAN.md` was edited during this research to promote **PDF
> annotation into v1** (item 5). It turns out to be cheaper than feared —
> `loadPdfJs()` is a public Obsidian API (§2.2) — but it still reshapes the document
> model and it competes for v1 budget with lasso select and shape snapping. Called out
> explicitly rather than quietly absorbed; see the Verdict and "What to cut".

### Read these three things if you read nothing else

1. **§1.6.3 — Spike zero.** One afternoon on Joost's iPad, before any other code,
   settles whether iPadOS Scribble eats Apple Pencil strokes in a dedicated view. It is
   the project's biggest unknown and the only one that cannot be fixed in software.
2. **§2.5 — the format decision.** `PLAN.md`'s `.gnote` extension will **silently not
   sync** on a fresh install, breaking the one v1 item `PLAN.md` itself calls decisive.
   Decide the format before writing format code.
3. **§3.2 — tldraw is ruled out.** Not on taste or weight: on licence, telemetry, and
   the fact that tldraw's own official Obsidian plugin goes blank after five seconds
   on iPad.

---

## 1. Apple Pencil input in a WKWebView on iPadOS

Obsidian Mobile is a **Capacitor app using WKWebView** on iOS/iPadOS, so the web
platform surface is exactly Safari's for the installed iPadOS version — no more, no
less. **LIKELY** ([obsidian-mobile-debug](https://github.com/chhoumann/obsidian-mobile-debug),
[Capacitor iOS docs](https://capacitorjs.com/docs/ios) confirm Capacitor uses WKWebView).

### 1.1 Which Pointer Event properties exist, and since when

**The single most important version number in this document is Safari 18.2
(released 2024-12-09).** Almost everything that makes web ink feel good landed at once.

| Capability                                                          | Safari / iOS Safari                                  | Confidence |
| ------------------------------------------------------------------- | ---------------------------------------------------- | ---------- |
| Pointer Events at all (`pointerType`, `pressure`, `tiltX`, `tiltY`) | **13.0** (partial), **13.2** full, 2019              | CONFIRMED  |
| `altitudeAngle`, `azimuthAngle`                                     | **18.2**                                             | CONFIRMED  |
| `getCoalescedEvents()`                                              | **18.2**                                             | CONFIRMED  |
| `getPredictedEvents()`                                              | **18.2**                                             | CONFIRMED  |
| `pointerrawupdate` event                                            | **never — not supported in any Safari through 27.2** | CONFIRMED  |

Sources: [WebKit Features in Safari 18.2](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)
(primary — Apple's own release notes), and caniuse for
[getCoalescedEvents](https://caniuse.com/mdn-api_pointerevent_getcoalescedevents),
[getPredictedEvents](https://caniuse.com/mdn-api_pointerevent_getpredictedevents),
[altitudeAngle](https://caniuse.com/mdn-api_pointerevent_altitudeangle),
[pointerrawupdate](https://caniuse.com/mdn-api_element_pointerrawupdate_event),
[Pointer Events](https://caniuse.com/pointer).

WebKit's own words, verbatim:

> "The `getCoalescedEvents()` method returns a sequence of `PointerEvent` instances that were coalesced (merged) into a single `pointermove`."
>
> "The `getPredictedEvents()` method returns a sequence of PointerEvent instances that are estimated future pointer positions, based on past points, current velocity, and trajectory."

**Practical consequences:**

- **`getCoalescedEvents()` IS supported — this de-risks the biggest unknown in the
  brief.** Without it, `pointermove` on iPad delivers at roughly display refresh and
  fast strokes visibly polygonalise. A developer reported exactly this symptom on
  Apple's forums in March 2025 — "the sampling rate for `PointerMoveEvent` appears
  lower than that of `TouchMoveEvent`" — and got no reply
  ([Apple Developer Forums #776468](https://developer.apple.com/forums/thread/776468),
  **CONFIRMED** that the report exists; the likely cause is not using coalesced events).
- **Set `minAppVersion` thinking and a runtime feature check for iPadOS 18.2+.**
  On older iPadOS the plugin will still run but strokes will look faceted. Feature-detect
  `typeof e.getCoalescedEvents === 'function'` and fall back to raw `pointermove`.
  **CONFIRMED** as the correct guard.
- `pointerrawupdate` is **not** available, so the Chrome trick of subscribing to
  pre-coalescing raw updates is off the table. Coalesced events on `pointermove`
  are the whole story on iPad. **CONFIRMED**.
- `tiltX`/`tiltY` and `altitudeAngle`/`azimuthAngle` are mathematically equivalent
  representations of the same tilt ([w3c/pointerevents#274](https://github.com/w3c/pointerevents/issues/274)),
  so on 18.2+ use whichever is convenient. **LIKELY**.

### 1.2 Pressure

`PointerEvent.pressure` is populated for Apple Pencil and has been since Pointer
Events shipped in Safari 13. **LIKELY** — no Apple document states the range explicitly
for Pencil, but the spec range is 0–1, InkedMark ships pressure-variable ink on iPad
built on it, and tldraw advertises "full Pencil support with pressure sensitivity"
on iPad. **CONFIRMED that two shipping products rely on it.**

One caveat worth knowing: for plain finger touch, browsers report a constant
(typically 0.5 for a non-pressure pointer, 1.0 for touch in some paths). Do not treat
`pressure` as a pen/finger discriminator — use `pointerType`. **LIKELY**.

### 1.3 Pen vs finger vs palm

**The web platform gives you no palm flag.** Unlike PencilKit (native) or Android's
tool type, a resting palm arrives as an ordinary `pointerType === 'touch'` pointer.
Rejection must be a heuristic. **CONFIRMED by absence** — nothing in the Pointer
Events spec exposes a palm/contact-size classification you can trust cross-platform.

The strategy that actually works, and is already shipping in an Obsidian plugin, is a
small **pointer-arbitration state machine**. This is InkedMark's `src/input/palm-rejection.ts`
verbatim in behaviour (MIT, so directly reusable):

- A `pen` (or `mouse`) pointer **always draws**, and going down **cancels any
  in-progress finger gesture**.
- **While a pen is down, every `touch` pointer is ignored** — that is the palm rejection.
- With no pen down: one finger pans, two fingers pinch-zoom, further fingers ignored.

Source: [pcrausaz/obsidian-inkedmark `src/input/palm-rejection.ts`](https://github.com/pcrausaz/obsidian-inkedmark/blob/main/src/input/palm-rejection.ts) — **CONFIRMED, source read.**

Two refinements worth adding:

- A short **trailing ignore window after pen-up** (~100–300 ms), so a palm that lifts
  last cannot emit a stray dot. **UNVERIFIED** as a specific duration — tune by hand.
- Excalidraw reached the same conclusion from the other direction and shipped an
  explicit **"pen mode"** toggle that rejects touch until switched off
  ([excalidraw#4202](https://github.com/excalidraw/excalidraw/issues/4202), opened
  2021-11-04, now closed — **CONFIRMED**). A manual override is a cheap safety valve
  when the heuristic misfires.

`touch-action: none` on the canvas element is required so the webview does not steal
the gesture for scroll/zoom. **Apply it to the canvas, not to `body`** — blanket
`touch-action: none` on the page breaks the user's own pinch-zoom and is an
accessibility regression. **LIKELY**.

### 1.4 Latency, and the tricks that reduce it

Native reference point: **PencilKit went from ~20 ms to ~9 ms at WWDC 2019**, and
Apple stated third-party renderers can reach nearly the same, with a residual **~4 ms
gap** from mid-frame event processing that Apple kept for its own frameworks
([9to5Mac](https://9to5mac.com/2019/06/06/pencilkit-apple-wwdc/),
[MacRumors](https://www.macrumors.com/2019/06/21/apple-pencil-latency-ipados-developers/)) — **LIKELY**,
secondary reporting of a WWDC session.

**I found no published measurement of web-canvas ink latency versus PencilKit on
iPad. UNVERIFIED — and this is a genuine gap.** The only evidence that web ink feels
acceptable is qualitative and from interested parties (see below). Plan to measure it
yourself in the first spike.

The stack of tricks, all of which are available:

1. **Wet/dry canvas split.** Two stacked canvases: a _dry_ canvas holding committed
   strokes, repainted on `requestAnimationFrame` with viewport culling; a _wet_ canvas
   holding only the in-progress stroke, drawn **synchronously on every input sample**
   rather than waiting for the next frame. This is the single biggest win and is
   standard practice.
2. **`getContext('2d', { desynchronized: true })`** on the wet canvas, which asks the
   UA to decouple the canvas paint cycle from the event loop and, where supported,
   push the buffer nearer the display controller
   ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext),
   [Chrome's explainer](https://developer.chrome.com/blog/desynchronized)). **It is a
   hint the UA may ignore.** I could **not** confirm Safari's support status from
   caniuse or MDN's compat table — **UNVERIFIED for Safari/WKWebView specifically.**
   Read it back with `ctx.getContextAttributes().desynchronized` to see whether it took,
   and make the renderer correct either way.
3. **`getCoalescedEvents()`** to capture the full Pencil sample rate (~240 Hz on
   Pencil 2/Pro) rather than one point per frame.
4. **`getPredictedEvents()`** to extend the wet stroke ahead of the last real sample,
   discarding the predicted tail on commit. This hides latency without affecting
   stored geometry.

**Corroboration that this combination works on real hardware:** InkedMark's
`SPECIFICATION.md` records a go/no-go spike result — _"Resolved: GO (0.1). On an iPad
Pro 12.9″ 4th-gen (A12Z, Apple Pencil 2) in the Obsidian web view, wet-ink latency and
capture are smooth once the wet layer draws synchronously (desynchronized ctx),
committed strokes render on a synchronized dry layer."_
([SPECIFICATION.md](https://github.com/pcrausaz/obsidian-inkedmark/blob/main/SPECIFICATION.md))
— **CONFIRMED that this claim is written in the repo; LIKELY as a fact.** It is one
developer's measurement on one device, self-reported, with no numbers attached.

### 1.5 Apple Pencil Pro — squeeze, barrel roll, haptics

**None of it is reachable from a webview. CONFIRMED by absence.**

- `rollAngle` (barrel roll) exists on `UITouch` and `UIHoverGestureRecognizer` — native
  UIKit only ([Apple docs](https://developer.apple.com/documentation/uikit/uihovergesturerecognizer/rollangle)).
  Pointer Events has a `twist` property, but I found **no** evidence WebKit maps
  `rollAngle` onto it, and the Safari 18.2 release notes that added altitude/azimuth
  say nothing about twist. **LIKELY not exposed.**
- **Squeeze** is `UIPencilInteraction` — native only. No web equivalent exists in any
  spec. **CONFIRMED.**
- **Haptics** — no web API can drive the Pencil's haptic engine. `navigator.vibrate`
  is not implemented in Safari and would target the device, not the Pencil anyway.
  **CONFIRMED.**
- **Hover** (Pencil 2 on M2 iPads) surfaces as `pointerover`/`pointermove` with
  `pointerType === 'pen'` before contact. **UNVERIFIED** — plausible and widely
  assumed, but I found no primary source and no shipping web app relying on it.

**Design consequence: do not put any v1 feature behind a Pencil Pro gesture.** Tool
switching must be on-screen or a double-tap emulation, not squeeze.

### 1.6 Apple Scribble interference — READ THIS ONE

**This is the most serious problem in the entire project. You cannot disable Scribble
from a webview and you cannot detect when it fires — but two plausible ways to avoid
provoking it do exist (§1.6.1, §1.6.2), and GoodObsidian's design already sits on the
safer side of the better-evidenced one.**

iPadOS Scribble runs at the **system level and intercepts Apple Pencil input before
it reaches the web content process.** When it fires, the strokes it swallows generate
**no events at all** — so the plugin cannot even detect that it happened.

Evidence that it is real, strongest first:

1. **InkedMark measured it.** From `SPECIFICATION.md`, verbatim:

   > "iPadOS Scribble intercepts fast Pencil strokes. With Scribble on, ~20% of fast
   > pen-downs never reach the web view (confirmed via the debug HUD: delivered `dn` <
   > strokes drawn, `cx=0`, `commit==dn`)."

   and on mitigation:

   > "A plugin cannot disable Scribble (native system feature; no web API, and
   > `touch-action:none` is a different layer) nor reliably detect it (dropped strokes
   > produce **no** events). Mitigation: flag it — README/install note, an iPad-only
   > one-time notice, and a settings-tab callout pointing to _Settings → Apple Pencil →
   > Scribble (off)_."

   **CONFIRMED** that this is written in a shipping plugin's spec. **LIKELY** as a
   general fact; the 20% figure is one developer's measurement on one device.

2. **Independent reproduction.** A developer hit the same thing and burned a long
   debugging session on it before finding the cause by accident: rapid
   "vertical-horizontal-vertical" strokes consistently dropped the third stroke; the
   fix was **Settings → Apple Pencil → Scribble → Off**. Nothing in CSS or JS helped —
   the author notes they never found a `touch-action` / `user-select` / `preventDefault`
   workaround because the events never arrive.
   ([dev.to, 2025-07-12](https://dev.to/skyjinxx/ipados-scribble-interfering-with-apple-pencil-canvas-drawing-in-web-browsers-3ba7)) — **CONFIRMED.**

3. **Even tldraw has it.** [tldraw#5813 "Not detecting all pencil strokes in iPad"](https://github.com/tldraw/tldraw/issues/5813)
   (opened 2025-04-03, iPad Air 13 M2 + Pencil Pro, iOS 18.4): _"there is a delay
   between strokes, causing some to be missed—especially when writing."_ Closed with
   **no diagnosis and no fix**, labelled "More Info Needed". **CONFIRMED.** The most
   funded web canvas engine in existence has not solved this, which is the clearest
   possible signal that it is not an application-layer bug.

4. Corroborating older reports: [Apple Developer Forums #662874](https://developer.apple.com/forums/thread/662874)
   and [#664108](https://developer.apple.com/forums/thread/664108) — missing
   PointerEvents in Safari on iPadOS 14 with Scribble; and
   [mikepk.com (2020-10)](https://mikepk.com/2020/10/iOS-safari-scribble-bug/), which
   reports Scribble intermittently swallowing `pointerdown`/`pointerup` from Apple
   Pencil since iPadOS 14. **LIKELY.**

#### 1.6.1 A dedicated full-screen view appears to sidestep Scribble entirely

**This is the most important mitigation found, and GoodObsidian gets it for free
because it is full-screen by nature.**

Ink ships a document on exactly this:
[docs/apple-pencil-scribble.md](https://github.com/daledesilva/obsidian_ink/blob/main/docs/apple-pencil-scribble.md).
Verbatim, **CONFIRMED**:

> "On iPad with **Settings → Apple Pencil → Scribble** enabled, pen strokes in **Live
> Preview ink embeds** can be interpreted as handwriting and inserted as **markdown
> text in the note** instead of ink on the canvas. **The same ink file in dedicated
> (full-screen) view usually works fine.**"
>
> "Dedicated view has no note `contenteditable` in the same pane, so Scribble has no
> markdown target there."

| Context                            | Scribble behaviour                      |
| ---------------------------------- | --------------------------------------- |
| Live Preview inline embed          | Strokes may be converted into note text |
| **Dedicated full-screen ink view** | **Drawing works with Scribble left ON** |

**The mechanism is credible and it explains the conflicting evidence.** Scribble needs
a text-input target. InkedMark is **embed-first** — ink as a block fused into an
ordinary markdown note — so there is always a `contenteditable` in the pane, and that
is plausibly why its author measured ~20% loss. `PLAN.md` specifies a dedicated
`.gnote` view with no editor in the pane, which is the configuration Ink reports as working.

**Do not treat this as solved.** Ink says _"usually works fine"_, not "works". The two
sources genuinely conflict on whether a pane with no text target is fully safe, and
neither tested GoodObsidian's exact layout. **LIKELY, not CONFIRMED.**

**Design rule that follows immediately: keep every drawing surface free of any
`contenteditable` element in the same pane.** If inline ink embeds are ever added, they
must be expected to misbehave with Scribble on. That is an argument for keeping v1
strictly full-screen — which `PLAN.md` already does.

#### 1.6.2 A second possible mitigation: the Touch Events fallback

**Together with §1.6.1 this is the highest-value experiment in the project.**

`signature_pad` (MIT, actively maintained, 5.1.4 released 2026-07-31) **deliberately
refuses to use Pointer Events on iPadOS and falls back to Touch Events**, with this
comment in its current source:

```js
const isIOS = /Macintosh/.test(navigator.userAgent) && "ontouchstart" in document;
// The "Scribble" feature of iOS intercepts point events. So that we can
// lose some of them when tapping rapidly. Use touch events for iOS
// platforms to prevent it. See
// https://developer.apple.com/forums/thread/664108 for more information.
if (window.PointerEvent && !isIOS) {
  this._handlePointerEvents();
} else {
  this._handleMouseEvents();
  if ("ontouchstart" in window) this._handleTouchEvents();
}
```

Source: [szimek/signature_pad `src/signature_pad.ts`](https://raw.githubusercontent.com/szimek/signature_pad/master/src/signature_pad.ts)
— **CONFIRMED, source read.** A nearby comment references "iOS 26", so this file is
being actively maintained against current iOS, which is strong evidence the workaround
is still considered necessary in 2026. **LIKELY** that it still applies.

**The claim is that Scribble eats _Pointer_ Events specifically, while _Touch_ Events
still arrive.** If true, GoodObsidian can have reliable capture with Scribble left on.
The cost: `TouchEvent` has **no `getCoalescedEvents()`**, so you lose full-rate sampling,
and pressure comes from `touch.force` rather than `pointer.pressure`.

**This is unresolved and the sources conflict.** InkedMark's spec says dropped strokes
produce _no_ events at all, which would mean touch events are lost too; signature_pad's
production code says otherwise. **UNVERIFIED — neither source tested inside Obsidian's
specific WKWebView, and I found no 2026 primary source.**

#### 1.6.3 Spike zero — do this before writing any other code

On Joost's actual iPad, **with Scribble ON**, in a **dedicated full-screen custom view
containing no `contenteditable`**, draw N fast strokes and log four counters:
`pointerdown` / `pointermove` / `touchstart` / `touchmove`, plus committed strokes.
Then repeat in a Live Preview embed, and repeat with Scribble OFF. It is a
one-afternoon throwaway and it settles the project's biggest unknown.

Outcomes and what each means:

1. **Dedicated view loses nothing with Scribble on** (Ink's claim holds) → the top risk
   collapses to a documentation note about inline embeds. **Best case, and plausible.**
2. **Pointer events are dropped but touch events survive** → build a **dual input path**
   (Pointer + `getCoalescedEvents()` primary, Touch + `touch.force` iPadOS fallback),
   accepting reduced sample rate on the fallback.
3. **Both are dropped** → Scribble must be turned off; ship an unconditional iPad
   first-run notice and accept the onboarding tax.
4. **Nothing is dropped at all on this hardware** → smaller risk than the sources
   suggest; re-test on every iPadOS major.

**What this means for GoodObsidian, stated plainly:**

- **In the worst case, every iPad user must manually turn off a system feature before
  the app works reliably.** That is a first-run instruction you cannot engineer away,
  and it is a permanent onboarding tax and support burden.
- You **cannot detect** whether they did it, so you cannot warn them adaptively. The
  only honest fallback is an unconditional iPad-only first-run notice plus a settings
  callout, exactly as InkedMark does.
- **But §1.6.1 and §1.6.2 both offer plausible escapes**, and GoodObsidian's
  full-screen-first design already sits on the safer side of the one with the best
  evidence. This is why the verdict below is GO rather than conditional.
- **Verify this yourself on Joost's actual iPad in the first spike, before writing any
  other code** (see §1.6.1 for the exact experiment). If ~20% stroke loss with Scribble
  on reproduces, the touch-event fallback does not help, and Joost finds turning
  Scribble off unacceptable (it is genuinely useful elsewhere in iPadOS), the project's
  premise is damaged and you want to know in week one, not month three.

### 1.7 The `pressure === 0.5` trap

A mouse held down reports `pressure: 0.5`; some Android touch paths report `0`.
Naively multiplying stroke width by `pressure` makes mouse strokes half-width and can
make touch strokes vanish entirely. **Excalidraw's shipped production code uses exactly
this as a sentinel:**

```js
const simulatePressure = event.pressure === 0.5;
```

(`packages/excalidraw/components/App.tsx`) — **CONFIRMED, source read.** This pairs
directly with `perfect-freehand`'s `simulatePressure` option (which derives width from
velocity instead). Copy the heuristic; it is free.

---

## 2. Obsidian plugin API constraints

Reference point: Obsidian desktop/mobile **v1.14.2 (2026-09-15)**
([changelog](https://obsidian.md/changelog/)). All API quotes are from the live
`obsidian.d.ts` on `master`.

### 2.1 Custom file types and custom views — fully supported, public API

**CONFIRMED** from
[obsidian-api/obsidian.d.ts](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts):

```ts
registerView(type: string, viewCreator: ViewCreator): void;        // @since 0.9.7
registerExtensions(extensions: string[], viewType: string): void;  // @since 0.9.7
```

Hierarchy: `View` → `ItemView` → `FileView` → `EditableFileView` → `TextFileView`.
`TextFileView` is what you want for a text-serialisable format:

```ts
export abstract class TextFileView extends EditableFileView {
  data: string; // "In memory data"
  requestSave: () => void; // "Debounced save in 2 seconds from now"
  abstract getViewData(): string;
  abstract setViewData(data: string, clear: boolean): void;
  abstract clear(): void;
}
```

There is **no `BinaryFileView`** — a binary format means extending `FileView`/`ItemView`
and using `vault.readBinary` / `vault.createBinary` / `adapter.readBinary|writeBinary`
yourself. **CONFIRMED.**

Caveats, all **CONFIRMED**:

- The [Views docs](https://docs.obsidian.md/Plugins/User+interface/Views) cover
  `registerView` but say **nothing** about `registerExtensions` or `TextFileView`.
  The clearest tutorial is by Ink's author:
  [designdebt.club/register-a-new-file-type-in-obsidian](https://designdebt.club/register-a-new-file-type-in-obsidian/).
- **You cannot claim `.md`** via `registerExtensions`.
- There is **no de-registration API**.
- Official warning: _"Never manage references to views in your plugin. Obsidian may
  call the view factory function multiple times."_

**How Excalidraw does it — and why you should not copy it.** It uses
`registerExtensions(["excalidraw"], VIEW_TYPE_EXCALIDRAW)` **only for legacy files**
([main.ts](https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/master/src/core/main.ts)).
For real `.excalidraw.md` files it **monkey-patches `WorkspaceLeaf.prototype.setViewState`**
via `monkey-around`, rewriting `state.type` when the frontmatter contains
`excalidraw-plugin`
([MonkeyPatchManager.ts](https://github.com/zsviczian/obsidian-excalidraw-plugin/blob/master/src/core/managers/MonkeyPatchManager.ts)) — **CONFIRMED.**
That is a private-API hack Excalidraw accepted only because it wanted the `.md`
extension. **`registerExtensions` + `TextFileView` is the clean public route, and Ink
uses exactly that in production:** `registerExtensions([DRAW_FILE_V1_EXT], DRAWING_VIEW_V1_TYPE)`,
`TextFileView` subclasses throughout, no monkey-patching. **CONFIRMED.**

### 2.2 pdf.js — **Obsidian bundles it and exposes it publicly. This is the best news in the report.**

**CONFIRMED**, `obsidian.d.ts` line 3865:

```ts
/**
 * Load PDF.js and return a promise to the global pdfjsLib object.
 * Can also use `window.pdfjsLib` after this promise resolves to get the same reference.
 */
export function loadPdfJs(): Promise<any>;
```

Documented at [docs.obsidian.md/.../loadPdfJs](https://docs.obsidian.md/Reference/TypeScript+API/loadPdfJs),
sibling of `loadMathJax()` / `loadMermaid()`. **It carries no "not available on mobile"
caveat** — and `addStatusBarItem` is the _only_ API in the whole `.d.ts` that does.
**CONFIRMED by exhaustive grep**; iPad availability is therefore LIKELY-strong, not proven.

**PDF++ does not bundle pdf.js. CONFIRMED from its build config:** `pdfjs-dist` is a
**devDependency**, listed in esbuild's `external` array beside `obsidian` and `electron`,
imported for **types only**, with the runtime read off `window`:

```ts
interface Window {
  pdfjsLib: typeof import("pdfjs-dist");
  pdfjsViewer: {
    ObsidianViewer?: Constructor<ObsidianViewer>; // Obsidian <= 1.7.7
    createObsidianPDFViewer?: (options: any) => ObsidianViewer; // Obsidian >= 1.8.0
  };
}
```

([esbuild.config.mjs](https://github.com/RyotaUshio/obsidian-pdf-plus/blob/main/esbuild.config.mjs),
[typings.d.ts](https://github.com/RyotaUshio/obsidian-pdf-plus)). Its README:
_"PDF++ is built on top of Obsidian's native PDF viewer powered by Mozilla's PDF.js."_

**Size maths, measured from jsDelivr for `pdfjs-dist@5.4.54`:** `pdf.min.mjs`
374,572 B + `pdf.worker.min.mjs` 1,037,158 B = **~1.41 MB**. Against the effective
5 MB wall (§2.3) that is ~28% of the budget for something Obsidian hands you free.
**Reuse `loadPdfJs()`. CONFIRMED.**

**Correction to the brief:** the PDF viewer shipped in Obsidian **1.3 (May 2023)**, not
1.5/1.6 ([roadmap](https://obsidian.md/roadmap/)). **No PDF API was ever added to the
public API** — grepping the [obsidian-api CHANGELOG](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/CHANGELOG.md)
returns zero PDF entries. `loadPdfJs` is the entire public surface; the viewer,
`ObsidianViewer`, `viewRegistry.getTypeByExtension` are all private. **CONFIRMED.**
Note v1.8.0 silently replaced the `ObsidianViewer` class with a
`createObsidianPDFViewer` factory — a breaking change for anyone patching it.

**The risk in v1's promoted PDF item, stated plainly.** You only need pdf.js to
**render a page to a canvas as a backdrop** (`page.render({ canvasContext, viewport })`),
which is core, stable pdf.js and exactly what `PLAN.md`'s backdrop model requires — the
source PDF is never modified. That part is low risk. What is **UNVERIFIED** is whether
Obsidian's customised build exposes pdf.js's `AnnotationEditorLayer` (PDF++ has **zero**
references to it). You should not need it — but confirm on device before designing
around it.

**Strategically, this is the gap in the market.** PDF++'s issue template says verbatim:
_"Note: for the time being, it is unlikely that PDF++ will support handwritten
annotation"_, and its author repeats it in
[issue #164](https://github.com/RyotaUshio/obsidian-pdf-plus/issues/164). Obsidian's
own roadmap lists PDF annotation as _"Currently waiting for native support in PDF.js"_.
**CONFIRMED.** Ink + PDF as one coherent thing is genuinely unclaimed.

### 2.3 Mobile constraints

**`isDesktopOnly`** — _"Whether the plugin can only be used on the desktop app, for
example because it uses NodeJS or Electron APIs"_
([Manifest reference](https://docs.obsidian.md/Reference/Manifest)). It is an
**install-time gate**, not a runtime one. Set it `false`; Excalidraw, PDF++, Ink and
InkedMark all do. **CONFIRMED.**

**What is unavailable on mobile** — the official list has exactly two entries
([Mobile development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)):
_"The Node.js API, and the Electron API aren't available on mobile devices"_ and
_"Lookbehind in regular expressions is only supported on iOS 16.4 and above"_. **CONFIRMED.**
`fs`, `path`, `child_process` fall under the blanket statement. `addStatusBarItem()` is
the only method in `obsidian.d.ts` doc-commented "Not available on mobile".

`requestUrl` works everywhere and bypasses CORS; plain `fetch()` hits CORS on iOS,
where the WebView origin is `capacitor://localhost` rather than desktop's
`app://obsidian.md`. **LIKELY** (community-sourced).

**`Platform` flags on iPad** (declarations CONFIRMED):

| Flag                      | iPad     | Confidence                                                                                  |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `isMobileApp`, `isIosApp` | true     | CONFIRMED                                                                                   |
| `isMobile`, `isTablet`    | true     | LIKELY-strong                                                                               |
| `isPhone`                 | false    | LIKELY-strong                                                                               |
| **`isMacOS`**             | **true** | **CONFIRMED — trap.** Doc: _"or a device that pretends to be one (like iPhones and iPads)"_ |

**Bundle size: no cap in the guidelines, but a hard 5 MB wall in practice.** Plugins
ship as files in `.obsidian/plugins/`, and **Obsidian Sync Standard caps files at 5 MB**,
so an oversized `main.js` stops syncing. Two real cases, both **CONFIRMED**:
[tasknotes#2336](https://github.com/callumalpass/tasknotes/issues/2336) (_"`main.js` is
5.02 MB — over Obsidian Sync's 5 MB per-file limit… the plugin no longer syncs"_) and
[excalidraw#2349](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/2349).

Measured shipping bundles (**CONFIRMED**, downloaded):

| Plugin              |   `main.js` | Engine                     |
| ------------------- | ----------: | -------------------------- |
| Excalidraw 2.27.x   |     4.66 MB | React + Excalidraw         |
| Ink 0.5.7           |     3.47 MB | tldraw (migrating off)     |
| PDF++ 0.40.31       |     1.09 MB | reuses Obsidian's pdf.js   |
| **InkedMark 1.3.4** |  **687 KB** | perfect-freehand, no React |
| **Pencil 1.0.6**    | **38.6 KB** | hand-rolled                |

**Pencil at 38 KB proves handwriting on iPad is a small-bundle problem if you avoid
React / tldraw / Excalidraw.** Target under 5 MB; aim for under 1 MB.

**Startup cost is a real architectural constraint.** Plugin load is _"synchronous and
blocking… Obsidian loads all plugins before the user can interact with the app"_, and
Obsidian **reopens saved workspace views at startup**, so your custom view's `onOpen`
runs during cold start
([Optimize plugin load time](https://docs.obsidian.md/Plugins/Guides/Optimize+plugin+load+time), **CONFIRMED**).
One reported case: 30 s mobile cold start, **18 s of it re-rendering plugin custom
views** ([obsidian.rocks](https://obsidian.rocks/fixing-slow-startup-on-obsidian-mobile/)).
Keep `onload` to registrations; defer everything to `onLayoutReady`; make the view
render lazily.

**Two warnings from the incumbents, both CONFIRMED as reports:**

- Excalidraw _"completely freezes when you view an excalidraw file with too many
  elements"_ on iPad, around **~2 MB drawings**, and re-freezes on relaunch
  ([#863](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/863)); also
  _"iPad + Apple Pencil has bad lagging"_ with lost strokes
  ([#635](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/635)).
- **Ink's own known-issues text:** _"tldraw is implemented using SVG elements which
  slow down greatly on iOS platforms… significant lag while writing after about
  200-300 strokes on iOS (which is about 3-4 paragraphs)."_ **This is why `PLAN.md`'s
  choice of `<canvas>` over SVG/DOM is correct, and it is not a close call.**

**Debugging warning specific to this laptop: you cannot remote-debug an iPad from
Windows.** Safari Web Inspector requires macOS. `app.emulateMobile(true)` only flips
the UI mode — the Electron process still has Node, so it does not emulate Capacitor.
**CONFIRMED.** Budget for an on-device debug HUD (which is exactly what InkedMark built).

### 2.4 Mobile toolbar — **there is no API. Plan around it.**

The iPad keyboard toolbar is configured by the **user** at Settings → Mobile →
"Manage toolbar options", with "Add global command" at the bottom
([obsidian.md/help/mobile](https://obsidian.md/help/mobile)). **A plugin cannot place
itself there.** A developer thread asking for exactly this got no official answer
([forum #86060](https://forum.obsidian.md/t/is-there-an-api-for-the-mobile-toolbar/86060)),
and grepping `obsidian.d.ts` for toolbar APIs returns nothing. **CONFIRMED by absence.**

- Register commands via `addCommand`; set `Command.icon` or the button renders blank.
- **`Command.mobileOnly?: boolean` has zero documentation** — no doc comment, nothing
  on the generated docs page. Semantics **UNVERIFIED**; gate with `Platform.isMobile`
  yourself.
- `addRibbonIcon` works on mobile but is two taps deep behind "Open menu" — fine for
  "New handwriting note", useless as a pen-tool control.
- The toolbar is **hidden in iPad Slide Over / split view**
  ([forum #81225](https://forum.obsidian.md/t/mobile-toolbar-not-visible-on-split-screen-view-slide-over/81225)) — **LIKELY**, single report.
- **Commander** only rearranges and restyles the existing toolbar; it is not an
  injection API.

**Consequence: build your own DOM toolbar inside your view's `contentEl`.** This is what
`PLAN.md` already assumes and what the shipping iPad plugin Pencil does — it ignores
`ItemView.addAction()` entirely. Copy Pencil's field note verbatim:

> "On some older mobile builds plugin-registered icons can come up blank (no `<svg>`
> child, or an empty one); in that case we fall back to a short text label so the
> button stays usable."

### 2.5 Storage and sync — **this is where v1 item 10 is actually won or lost**

**Obsidian Sync limits** ([obsidian.md/sync](https://obsidian.md/sync)), **CONFIRMED**:

|                                                      | Standard | Plus                                 |
| ---------------------------------------------------- | -------- | ------------------------------------ |
| Max file size                                        | **5 MB** | **200 MB**                           |
| Storage (account-wide, **includes version history**) | 1 GB     | 10 GB                                |
| Version history                                      | 1 month  | 12 months (attachments: **2 weeks**) |

The folklore "100 MB per file" figure is out of date.

#### The conflict-resolution fork in the road

From [help/sync/troubleshoot](https://obsidian.md/help/sync/troubleshoot), **CONFIRMED**:

> Markdown: _"Obsidian Sync merges the changes using Google's diff-match-patch algorithm."_
> _"For all other files, including canvases, Obsidian uses a **'last modified wins'** approach."_

This cuts **both ways**, and neither option is free:

**If the file ends in `.md`** (Excalidraw's and InkedMark's choice):

- Pro: it is a first-class note — indexed, graphed, linked, version-historied, and
  **always synced**.
- **Con: Sync will text-merge it with diff-match-patch.** diff-match-patch has no idea
  that a base64/deflate blob is one atomic stream; interleaving chunks from two devices
  produces a payload that will not decompress. **Excalidraw's own parser carries the
  comment `//this is a workaround in case sync merges two files together`. CONFIRMED.**
  That is the incumbent actively defending against exactly this.

**If the file has a custom extension** (`.gnote`, as `PLAN.md` currently specifies):

- Pro: last-write-wins. You lose one device's session, but you never get an unopenable
  file. For a single-user, one-iPad-at-a-time workflow that is the _safer_ failure mode.
- **Con: Obsidian Sync's selective sync defaults to ON only for Images, Audio, Videos
  and PDFs. A `.gnote` file is silently NOT SYNCED until the user finds and enables
  "Sync all other types".** **CONFIRMED** from
  [help/sync/settings](https://obsidian.md/help/sync/settings) and a real user hitting
  it with `.docx` in
  [forum #108880](https://forum.obsidian.md/t/show-all-file-types-enabled-but-some-file-types-e-g-docx-are-not-synced-between-vaults-using-obsidian-sync/108880)
  (2025-12-10). **This would silently break v1 item 10 on a fresh install.**

**Three ways out, in order of preference:**

1. **A merge-tolerant layout inside a `.md` wrapper.** Append-only, **one stroke per
   line**, each line self-contained (its own base64 chunk). diff-match-patch merges
   line-oriented text well; a lost or duplicated line costs one stroke, not the file.
   This is the unexplored option and it gets the `.md` benefits without the
   catastrophic failure mode. **Untested — UNVERIFIED — but cheap to prototype.**
2. **Ink's SVG-with-embedded-metadata format**, which is the cleverest thing found in
   this research. **CONFIRMED** from
   [docs/file-format-and-conversion.md](https://github.com/daledesilva/obsidian_ink/blob/main/docs/file-format-and-conversion.md):
   > _"Ink files are SVG files with embedded metadata. The visual content and metadata are siblings under the root `<svg>`."_
   ```xml
   <svg …>
     <!-- visual content: paths exported from ink-canvas -->
     <metadata>
       <ink plugin-version="…" file-type="inkDrawing|inkWriting"/>
       <ink-canvas version="0.5.0">JSON InkCanvasSnapshot</ink-canvas>
     </metadata>
   </svg>
   ```
   The file is a **valid SVG that renders natively everywhere** — embeds, file picker,
   other apps — while carrying editable stroke data inside. Whether `.svg` counts as an
   "Image" for selective-sync purposes is **UNVERIFIED and worth checking**; if it does,
   this gets default-on sync _and_ last-write-wins.
3. **Adopt InkedMark's `.ink.md`-style format wholesale** and accept the merge risk
   (which the incumbent has lived with for three months without visible complaint).

**Whatever you pick, `.gnote` as a bare custom extension is the one option that is
actively wrong**, because of the default-off sync. This contradicts `PLAN.md` as
currently written and should be resolved before any format code is committed.

#### Version-history amplification is the real quota killer

Not raw file size. **CONFIRMED** from user reports:

- [forum #102666](https://forum.obsidian.md/t/if-you-use-obsidian-sync-and-excalidraw/102666):
  _"Obsidian Sync saves a complete copy of a file to its version history every few
  seconds you're actively editing."_ One user's remote vault went 700–800 MB → **1.6 GB**
  with ~40 drawings; a 500 KB drawing accrues _"3-5 MB from just 60 seconds of editing."_
- [excalidraw#958](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/958):
  _"Obsidian sync says that I have reached the 10GB limit… but the viewfinder states
  that the files within my vault make up 835 MB."_

**Handwriting saves far more often than diagramming.** Autosave cadence is a
first-class product decision, not an implementation detail.

Ink's
[ink-canvas-large-attachment-performance.md](https://github.com/daledesilva/obsidian_ink/blob/main/docs/ink-canvas-large-attachment-performance.md)
is effectively a free engineering spec, and its three contracts should be adopted
verbatim (**CONFIRMED**):

- Share stroke geometry via a `WeakMap` outline cache.
- Touch only changed strokes; metadata-only saves via regex splice, never re-parsing.
- **Never autosave while a pointer is down.** Quiet-period delay **500 ms desktop /
  2000 ms mobile.**

Their diagnosis is worth quoting: _"Autosave work scaled with the full SVG… and could
land on the input thread while the pen was still down — especially on mobile WebViews
such as older iPads."_

#### iCloud is genuinely unreliable and should not be the recommended path

**CONFIRMED** from
[forum #21208](https://forum.obsidian.md/t/icloud-drive-files-keep-redownloading-after-a-period-of-time-causing-ios-apps-startup-to-be-stuck/21208):
_"After Obsidian iCloud drive files are fully synced in iOS, they unsync again after
some time, and the mobile app keeps getting stuck, loading and indexing."_ Favouriting
the folder did not prevent eviction. Also documented: 10–30 s
_"Waiting for iCloud to synchronize Obsidian configuration files"_ stalls
([#50827](https://forum.obsidian.md/t/ios-icloud-slow-to-start-waiting-for-icloud-to-synchronize-obsidian-configuration-files/50827))
and `(1)` duplicate notes ([#28320](https://forum.obsidian.md/t/icloud-sync-issues/28320)).

### 2.6 The competitive field is more crowded than the brief assumed

**CONFIRMED** from the community directory and GitHub:

| Plugin                          | Downloads | Licence         | Format                                        | PDF?                                         |
| ------------------------------- | --------: | --------------- | --------------------------------------------- | -------------------------------------------- |
| **Ink** (daledesilva)           |     ~198k | **CC-BY-NC-ND** | SVG + `<metadata>`                            | No                                           |
| **Inkplane**                    |       906 | —               | `.inklayer` JSON                              | No                                           |
| **InkedMark**                   |      1.8k | **MIT**         | `.ink.md`                                     | No                                           |
| **Pencil**                      |         — | —               | —                                             | No                                           |
| **jot** (Chadillac12)           | BRAT only | —               | `.jot.json` sidecar next to an unmodified PDF | **Yes**                                      |
| **Handwritten Notes** (FBarrca) |         — | —               | stores as PDFs, punts to an external editor   | Partial                                      |
| **PDF++**                       |         — | —               | —                                             | Yes, but **explicitly declines handwriting** |
| **Official tldraw plugin**      |         — | —               | —                                             | **Broken on iPad** (see §3.2)                |

`jot` is the closest existing thing to GoodObsidian's promoted v1 — Apple Pencil strokes
as a `.jot.json` sidecar beside an unmodified PDF — but it is self-described as "early,
working" and BRAT-only. Worth reading before designing the backdrop model.

**The gap is real:** ink strokes _plus_ PDF backdrops as one coherent document is not
covered by any mature plugin.

---

## 3. The candidate starting points

### 3.1 InkedMark — it is real, it is MIT, and it is further along than expected

**Repository: [github.com/pcrausaz/obsidian-inkedmark](https://github.com/pcrausaz/obsidian-inkedmark).
It exists.** Everything below is **CONFIRMED** from the GitHub API, npm/package
metadata, and reading the source and spec.

| Fact             | Value                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Licence          | **MIT** (`MIT © 2026 liqpil.com`) — confirmed in repo licence metadata and `package.json` |
| Created          | **2026-06-30** — three months old                                                         |
| Last push        | **2026-09-11** (release 1.3.4, 2026-09-11)                                                |
| Repo size        | 2.18 MB; **`src/` is ~225 KB across ~32 TypeScript files**                                |
| Shipped bundle   | **`main.js` 687 KB**, `styles.css` 7.5 KB                                                 |
| Commits / issues | 110 commits; 12 issues (7 closed); 9 PRs                                                  |
| Adoption         | **1,843 downloads, 7 GitHub stars, 0 reviews** — score 43/100 on Obsidian Stats           |
| Maintainer       | One person, trading as liqpil.com; free plugin, Ko-fi donations                           |
| Runtime deps     | `perfect-freehand`, `fflate`, `@huggingface/transformers` (dropped 2026-09-25)            |

Sources: [GitHub API](https://api.github.com/repos/pcrausaz/obsidian-inkedmark),
[releases](https://github.com/pcrausaz/obsidian-inkedmark/releases),
[package.json](https://github.com/pcrausaz/obsidian-inkedmark/blob/main/package.json),
[obsidianstats.com/plugins/inkedmark](https://www.obsidianstats.com/plugins/inkedmark),
[community listing](https://community.obsidian.md/plugins/inkedmark), [inkedmark.com](https://inkedmark.com/).

**What it genuinely already solves** (all CONFIRMED from source/spec, not marketing):

| GoodObsidian v1 item                      | InkedMark status                                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Pressure ink, usable latency           | **Done.** `perfect-freehand`, coalesced + predicted events, wet/dry split, `desynchronized: true`, spatial index + viewport culling.                              |
| 2. Palm rejection                         | **Done.** Unit-testable state machine, 2.1 KB, MIT.                                                                                                               |
| 3. Pen/highlighter/eraser toolbar         | **Partial.** `src/view/toolbar.ts` (5.9 KB) exists; pen + eraser + selection.                                                                                     |
| 4. Discrete pages, lined/grid backgrounds | **Not done.** Open issue [#22 "Lined template for easier handwriting"](https://github.com/pcrausaz/obsidian-inkedmark/issues/22), filed **2026-09-20**.           |
| 5. PDF backdrop annotation                | **Not done. Nothing.**                                                                                                                                            |
| 6. Undo/redo                              | **Done.** `src/model/history.ts`, `commands.ts`.                                                                                                                  |
| 7. Lasso select + move/delete             | **Partial.** Selection marquee + `hit-test.ts` + `spatial-index.ts` exist; lasso specifically unconfirmed.                                                        |
| 8. Hold-to-snap shapes                    | **Not done. Nothing.**                                                                                                                                            |
| 9. Insert image from vault                | **Not done / unconfirmed.**                                                                                                                                       |
| 10. Survives sync unchanged               | **Done, and deliberately designed for it** — see §3.1.1.                                                                                                          |
| Transcription (Later)                     | **Done, three ways.** Manual, BYO-key vision LLM (Anthropic/OpenAI/Google/OpenRouter/custom), and experimental desktop-only on-device TrOCR (dropped 2026-09-25). |

Its `src/` layout maps almost one-to-one onto the architecture GoodObsidian needs:
`canvas/` (renderer, viewport, zoom, hit-test, spatial index), `ink/` (freehand,
stroke-builder), `input/` (pointer-controller, palm-rejection), `model/` (document,
history, commands, serialize, compress), `view/` (ink-view, ink-surface, toolbar,
embed-processor), `recognition/`.

#### 3.1.1 InkedMark's file format — the part worth stealing outright

From `SPECIFICATION.md`, **CONFIRMED by reading it**:

- One file per ink note, extension **`.ink.md`**. It **is** a markdown file, so
  Obsidian indexes, graphs, links, syncs and version-controls it natively.
- Frontmatter carries `inkedmark: true` (the claim flag used to recognise the file —
  the same trick Excalidraw uses) plus a schema version.
- The markdown **body is the text layer** — searchable, graphable, linkable.
- Strokes live in a trailing Obsidian comment `%% … %%` so they do not render, encoded
  as **`v1:` + base64(deflate(JSON))** (hence the `fflate` dependency).
- Coordinates quantised: `x/y` as `round(coord * 100)` integers, pressure as
  `round(p * 255)`, points **tuple-packed** into one flat array
  (`"pts": [12043, 5510, 128, 12090, 5532, 140, …]`). The spec claims this alone is
  ~10× smaller than pretty-printed `{x,y,p}` objects, before deflate.
- Rationale, verbatim: _"Why single-file (not a sibling binary): atomic sync/versioning,
  trivial embeds, portability. The base64 blob is one giant non-word token; Obsidian's
  word-boundary search effectively ignores it, so search noise is negligible."_

This directly contradicts a `PLAN.md` assumption and the choice of a `.gnote` extension.
See §2.5 and the Verdict.

#### 3.1.2 Should you fork it? — opinion

**Yes, fork it — but fork it as a source quarry, not as an upstream.**

Arguments for:

- **MIT.** No friction, no watermark, no licence key, no host validation, no lawyer.
- It has **already paid for the three hardest and least glamorous lessons**: that
  Scribble eats ~20% of fast strokes, that a synchronous wet layer with a
  desynchronized context is what makes ink feel right, and that a markdown-wrapper
  format is what survives Obsidian Sync. Rediscovering those costs weeks.
- `src/` is **~225 KB of TypeScript**, which is small enough to read end to end in a
  day. You will actually understand what you inherit.
- Zero React. Plain DOM + canvas, which matches `PLAN.md`'s stack decision exactly.
- Its dependency list is three packages, two of which are tiny.

Arguments against:

- **It is three months old with 1,843 downloads and 7 stars.** There is no community,
  no battle-testing at scale, and a single maintainer. Treat its code as informed
  prior art, not as a proven foundation.
- It is architecturally committed to **inline ink blocks inside ordinary notes** — ink
  as a _block_ fused with markdown. GoodObsidian wants **a notebook of discrete pages
  with PDF backdrops** — ink as a _document_. Those are different products with the
  same substrate. Roughly `canvas/`, `ink/`, `input/`, and the compression half of
  `model/` transfer cleanly (~60 KB); `view/` and the page/notebook model largely do not.
- Forking a live MIT project and diverging means you get **no upstream fixes** and owe
  nothing back. That is legal and normal, but be honest that it is a hard fork on day one.

**Concretely: do not `git clone` and rename.** Start a clean repo and lift, with
attribution in the README (which Obsidian's submission requirements mandate for
licence compliance):

- `input/palm-rejection.ts` — near-verbatim, it is 60 lines and correct.
- `input/pointer-controller.ts` — as the reference for coalesced/predicted handling.
- `ink/freehand.ts` + `ink/stroke-builder.ts` — the `perfect-freehand` wiring.
- `canvas/renderer.ts`, `spatial-index.ts`, `hit-test.ts` — the wet/dry split and culling.
- `model/compress.ts` + `serialize.ts` — the quantise-pack-deflate-base64 pipeline.
- The whole `%%`-comment-in-markdown format idea.

Write your own `view/`, page model, PDF backdrop, shape snapping and toolbar.

### 3.2 tldraw — the licence is a hard no for this project

**Current version: `tldraw@5.4.2`.** npm `license` field reads
**`"SEE LICENSE IN LICENSE.md"`** — i.e. **not an OSI licence**. **CONFIRMED** from
the [npm registry metadata](https://registry.npmjs.org/tldraw/latest).

**Licence history** (CONFIRMED from [tldraw's own blog](https://tldraw.dev/blog/license-update-for-the-tldraw-sdk), 2023-12-20, and [tldraw.dev/community/license](https://tldraw.dev/community/license)):

| Version                | Licence                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| v1.x                   | **MIT — "will remain licensed under MIT forever"**                                                                                |
| pre-release 2.x alphas | **Apache-2.0 — "will remain licensed under Apache-2.0"**                                                                          |
| v2.0.0-beta.1 onward   | **Non-commercial only**; commercial licence purchasable                                                                           |
| v3.0.0 (2024) onward   | Commercial **and** non-commercial permitted **provided the "Made with tldraw" watermark is visible**; Business Licence removes it |
| **Today (v5.x)**       | **Proprietary. Production use requires a licence key.**                                                                           |

**The current terms, precisely** (CONFIRMED from
[tldraw.dev/community/license](https://tldraw.dev/community/license) and
[tldraw.dev/sdk-features/license-key](https://tldraw.dev/sdk-features/license-key)):

- Default terms permit use **in development only**. Production requires a key.
- Three key types: **trial** (free, 100 days), **commercial** (paid), **hobby** (free,
  non-commercial, **discretionary**).
- **A hobby licence mandates the watermark:** _"the 'made with tldraw' watermark must
  be shown on the canvas."_ There is **no free, watermark-free path**, open source or otherwise.
- The licence **explicitly prohibits** disabling, hiding, removing or altering the
  watermark, and prohibits interfering with the key-validation process.
- **Without a valid key in a production environment, the SDK "logs errors to the
  console and, after five seconds, stops rendering the editor."**
- A key **encodes the allowed hosts** — the domains where it is valid. Wildcards work
  for subdomains. _"If you deploy to an unlicensed domain, the SDK treats it as unlicensed."_
- Commercial pricing is **"value-based pricing" — contact sales**. No public number.
  ([tldraw.dev/pricing](https://tldraw.dev/pricing))
- On open source specifically: _"If including tldraw in open source work, the SDK
  itself remains under its original license. End users would still need their own
  trial, commercial, or hobby license for production use."_

**So: is free personal / open-source use allowed without a watermark? No. CONFIRMED.**

**Why this is disqualifying for an Obsidian plugin specifically:**

1. **The licence enforcement appears to be actively bricking tldraw on iPad in
   Obsidian right now.** This is the single most damning finding in this report.

   tldraw's docs state that in a production environment without a valid key, the SDK
   _"logs errors to the console and, after five seconds, stops rendering the editor."_

   The **official tldraw Obsidian plugin**
   ([tldraw/obsidian-plugin issue #232](https://github.com/tldraw/obsidian-plugin/issues/232),
   opened **2026-09-09, still open, no maintainer response**) reports: the plugin loads
   on iOS/iPadOS, **the canvas disappears roughly five seconds after loading**, and
   reloading brings it back for another few seconds. Reproduced across Insider and
   public Obsidian builds, new vaults, and older plugin versions via BRAT. The reporter
   notes they _cannot access the developer console on iPadOS_, so nobody has read the
   error. **CONFIRMED that this is the report.**

   The five-second timer is an exact match for documented licence-key enforcement.
   **LIKELY-strong.** I originally inferred the opposite — that Obsidian's
   `app://obsidian.md` / `capacitor://localhost` origins would be classified as
   _development_ and tldraw would render happily. **That inference was wrong on iPad.**
   Host validation has no sane answer for a plugin that runs on every user's device
   under an origin you do not control, and tldraw's docs explicitly do not address
   non-HTTP origins.

2. **Obsidian's submission requirements say you "must comply with the original licenses
   of any code your plugin or theme makes use of."**
   ([Submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins),
   [Developer policies](https://docs.obsidian.md/Developer+policies)) — **CONFIRMED.**
   Shipping tldraw to strangers with no key, or with a hobby key and the watermark
   stripped, is non-compliance.
3. **You would be shipping a permanent "Made with tldraw" watermark on every page of
   Joost's lecture notes.** For a GoodNotes clone that is a product-killing indignity.

4. **You would be shipping telemetry into other people's vaults.** LICENSE.md, verbatim:
   _"The Software includes technical measures to verify License Key validity, detect
   deployment environments, enforce usage restrictions based on license type, and ensure
   proper watermark display. **The Software may collect and transmit usage data to
   tldraw.**"_ It also forbids _"disabling, changing, or interfering with the Software's
   License Key enforcement"_, and defines a Production Environment to explicitly include
   _"web applications, or where the software is used to provide functionality to end
   users, customers, or the public."_ Governing law: Delaware.
   **CONFIRMED, [LICENSE.md](https://raw.githubusercontent.com/tldraw/tldraw/main/LICENSE.md) read.**
   This is flatly incompatible with `PLAN.md`'s "no telemetry, no account, no network call".

**The incumbent is already running away from it.** Ink **has migrated off tldraw** to a
custom `ink-canvas` engine, reading legacy tldraw metadata only for lazy upgrade.
Its stated reason (**CONFIRMED**): _"tldraw is implemented using SVG elements which
slow down greatly on iOS platforms… significant lag while writing after about 200-300
strokes on iOS (which is about 3-4 paragraphs)."_ So the most-installed
handwriting plugin in Obsidian evaluated tldraw on iPad in production and left.

**Weight of evidence:** the one substantial tldraw-based Obsidian plugin,
[daledesilva/obsidian_ink](https://github.com/daledesilva/obsidian_ink) ("Ink", 1,380
stars, actively maintained), is **pinned to `@tldraw/tldraw@^2.4.6`** — a version from
before the v3 watermark regime, three majors behind current. **CONFIRMED from its
[package.json](https://github.com/daledesilva/obsidian_ink/blob/main/package.json).**
That plugin's own licence is **CC-BY-NC-ND-4.0** — non-commercial, **no derivatives** —
so **it cannot legally be forked either. CONFIRMED.** (Obsidian does permit
non-commercial and closed-source plugins in the directory; that is not the issue. The
issue is that you cannot build on it.)

**Weight, literally:** Ink's shipped `main.js` is **3,636,804 bytes (3.64 MB)** plus a
**269 KB** stylesheet, against InkedMark's **687 KB**. `tldraw@5.4.2` unpacks to
**14.9 MB across 1,881 files** and peer-depends on **React 18/19 + react-dom**, which
`PLAN.md` explicitly rules out. **CONFIRMED** from GitHub releases and the npm registry.

**Does tldraw work on iPad with Apple Pencil?** Largely yes — tldraw claims "full
Pencil support with pressure sensitivity" and it is clearly the most polished option.
But its own tracker carries unresolved iPad Pencil complaints: missed strokes while
writing ([#5813](https://github.com/tldraw/tldraw/issues/5813), closed undiagnosed),
first-press-not-registering ([#5950](https://github.com/tldraw/tldraw/issues/5950)),
and multi-touch drawing lines between fingers ([v1 #205](https://github.com/tldraw/tldraw-v1/issues/205)).
**LIKELY** — issue titles confirmed, full threads not all read.

**Verdict on tldraw: rule it out on licence grounds alone.** The bundle weight, the
React dependency and the iPad papercuts are three independent confirmations of the
same answer.

### 3.3 Third-party engines

All rows **CONFIRMED** from the npm registry API and the Bundlephobia size API, queried
2026-09-20, unless footnoted.

| Library                    | Version | Published  | Licence          | min+gzip          | Real pressure?             | Notes                                                                               |
| -------------------------- | ------- | ---------- | ---------------- | ----------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| **perfect-freehand**       | 1.2.3   | 2026-02-01 | **MIT**          | **2.0 kB**        | Yes (geometry only)        | Zero deps. Geometry only — no input, no rendering.                                  |
| **atrament**               | 5.1.0   | 2025-09-26 | **MIT** ¹        | **2.6 kB**        | **Yes, documented**        | The sleeper. Input capture + canvas render + stroke model. No undo/layers/hit-test. |
| **simplify-js**            | 1.2.4   | 2020-02-03 | **BSD-2-Clause** | **0.5 kB**        | —                          | RDP. Finished, not abandoned.                                                       |
| **signature_pad**          | 5.1.4   | 2026-07-31 | MIT              | 4.5 kB            | **Captures but ignores** ² | Valuable for its iPadOS Scribble workaround, not as an engine.                      |
| **rough.js**               | 4.6.6   | 2023-11-20 | MIT              | 8.6 kB            | No                         | Sketchy _renderer_ for primitives. Dormant (last push 2024-07-28).                  |
| **Konva**                  | 10.6.0  | 2026-09-19 | MIT              | 52.6 kB           | **No** ³                   | Scene graph, hit-testing, layers, transforms. Very active.                          |
| **paper.js**               | 0.12.18 | 2024-07-17 | MIT              | 82.2 kB           | **No** ³                   | Great boolean path ops (useful for eraser). Dormant.                                |
| **Fabric.js**              | 7.4.0   | 2026-05-18 | MIT              | 89.7 kB           | **No** ³                   | Design-editor object model. Poor fit for ink.                                       |
| **js-draw**                | 1.33.0  | 2025-12-26 | **MIT**          | **133.5 kB** ⁴    | **Yes**                    | **The dark-horse candidate — see below.**                                           |
| **@excalidraw/excalidraw** | 0.18.1  | 2026-04-20 | MIT              | **>1 MB total** ⁵ | Yes (perfect-freehand)     | Peer-deps React. Code-split; 344 kB is only the main chunk.                         |
| **tldraw**                 | 5.4.2   | 2026-09-10 | **Proprietary**  | 512 kB            | Yes                        | Ruled out — see §3.2.                                                               |

¹ npm field says `SEE LICENSE IN LICENSE.md`; the [file](https://raw.githubusercontent.com/jakubfiala/atrament/master/LICENSE.md) is verbatim MIT. **CONFIRMED.**
² `signature_pad` records `event.pressure` / `touch.force` into its data model but `_strokeWidth()` is purely velocity-based. You would have to fork it to draw with pressure. **CONFIRMED, source read.**
³ Source grepped for "pressure": zero hits in Konva's `src/PointerEvents.ts`, Fabric's `PencilBrush.ts`, paper.js's `ToolEvent.js`/`MouseEvent.js`. You read `e.pressure` yourself. **CONFIRMED.**
⁴ **LIKELY** — Bundlephobia rate-limited; measured by downloading the shipped bundle and `gzip -9`. CSS ships separately.
⁵ **CONFIRMED** from the Bundlephobia assets array: 344 kB main chunk + a 735 kB chunk + ~8 more.

**perfect-freehand** is the right primitive: **MIT, zero runtime dependencies, 2.0 kB
gzipped**, accepts `[x, y, pressure]` arrays or `{x, y, pressure}` objects, and has a
`simulatePressure` option (defaults `true`; set `false` for real stylus pressure).
([LICENSE](https://github.com/steveruizok/perfect-freehand/blob/main/LICENSE),
[npm](https://registry.npmjs.org/perfect-freehand/latest)) — **CONFIRMED.**

But be clear about what it is: **it turns points into an outline polygon.** Its README
says so explicitly — it does not capture input and does not render. Everything else is
yours: pointer capture and palm rejection, coalesced-event handling, polygon→canvas
rendering, a wet/dry split (it recomputes the _whole_ outline per call, so long strokes
get slow without one), undo/redo, layers and z-order, hit-testing (tldraw uses `rbush`),
eraser, lasso, transforms, serialisation, viewport pan/zoom, and all shape recognition.

**Worth knowing:** `tldraw@5.4.2` **no longer depends on `perfect-freehand`** — it
vendored and rewrote it into `packages/tldraw/src/lib/shapes/shared/freehand/`.
That vendored code is under the tldraw licence, so **you cannot lift it**; use upstream
MIT `perfect-freehand`. **CONFIRMED** (not among tldraw's 16 dependencies).

#### 3.3.1 js-draw — the candidate nobody mentioned, and it deserves an hour

[personalizedrefrigerator/js-draw](https://github.com/personalizedrefrigerator/js-draw),
**MIT** ("Copyright (c) 2023-2026 Henry Heino"), v1.33.0 (2025-12-26), repo pushed
2026-03-31, **133.5 kB gzipped**. Only 299 stars — but it is **the drawing library used
by Joplin**, i.e. it is battle-tested in a real cross-platform note app.

Out of the box it already ships: pressure-sensitive pen, undo/redo, serialisation,
stylus-vs-touch discrimination, **and a working hold-to-snap shape autocorrect with
accessibility announcements** (see §5). That is a large fraction of GoodObsidian v1
under the same MIT terms as forking InkedMark, and with more maintenance behind it.

**Its gap is the same as everyone's:** `makeShapeFitAutocorrect.ts` handles **line and
rectangle only** — grepped for `circle|ellipse|arc`, **zero hits**. **CONFIRMED.**

It is 133.5 kB against InkedMark's whole 687 kB bundle, so it is not a size problem.
**It was not in the brief, and it should be evaluated before the build starts** — see
the Verdict.

---

## 4. Handwriting recognition / transcription

Out of v1 per `PLAN.md`, so this is a "does the door stay open" assessment. **It does.**

**Headline: exactly one option gives true stroke-data recognition from JS on iPad, and
it is cloud-only and paid. Everything on-device is either raster-only and bad at
cursive, or too large to load in an iPadOS webview.**

| Option                               | Stroke or raster | Offline                | Cost                      | Privacy                      | Works on iPad in Obsidian?                    |
| ------------------------------------ | ---------------- | ---------------------- | ------------------------- | ---------------------------- | --------------------------------------------- |
| **MyScript iinkTS**                  | **Stroke**       | No (web is cloud-only) | 2k free/mo, then ~$10/1k  | Strokes → MyScript           | **Yes — the only stroke option**              |
| Azure Ink Recognizer                 | Stroke           | —                      | —                         | —                            | **No — retired 2021-01-31**                   |
| Google Cloud Vision                  | Raster           | No                     | 1k free/mo, then $1.50/1k | Image → Google               | Yes, but mediocre on cursive                  |
| ML Kit Digital Ink                   | Stroke           | Yes                    | Free                      | On-device                    | **No — no web build**                         |
| Google Input Tools ink               | Stroke           | No                     | —                         | → Google                     | Undocumented + deprecated — **don't**         |
| Chrome Handwriting Recognition API   | **Stroke**       | **Yes**                | Free                      | On-device                    | **No — Chromium/ChromeOS only**               |
| Apple Vision / Scribble              | —                | Yes                    | Free                      | On-device                    | **No — no JS API**                            |
| transformers.js + TrOCR              | Raster           | Yes                    | Free                      | On-device                    | **No — 64–340 MB, exceeds webview memory**    |
| ONNX Runtime Web + TrOCR             | Raster           | Yes                    | Free                      | On-device                    | **No — same wall**                            |
| tesseract.js                         | Raster           | Yes                    | Free                      | On-device                    | Runs, but **no handwriting model — unusable** |
| tensorflow.js                        | Raster           | Yes                    | Free                      | On-device                    | **No credible HTR model exists**              |
| **Rasterize → vision LLM (BYO key)** | Raster           | No                     | ~$0.003–$0.04/page        | Image → provider, user's key | **Yes**                                       |

### 4.1 The notable findings

- **Azure Ink Recognizer is dead, and died earlier than folklore says: preview ended
  2020-08-26, fully retired 2021-01-31.** Microsoft named **no** replacement. It did
  take stroke data. **CONFIRMED** —
  [learn.microsoft.com archived page](https://learn.microsoft.com/en-us/previous-versions/azure/cognitive-services/ink-recognizer/),
  [azure-deprecation tracker](https://github.com/azure-deprecation/dashboard/issues/66).
  Worth remembering as the cautionary tale: the one big-vendor stroke API got killed.

- **MyScript iinkTS is the only real stroke-based option.** Apache-2.0 library, paid
  cloud service, TypeScript, npm-installable, needs `applicationKey` + `hmacKey`.
  `iinkJS` is **archived (2024-01-15)** — use `iinkTS`. **CONFIRMED** —
  [github.com/MyScript/iinkTS](https://github.com/MyScript/iinkTS),
  [iinkJS archived](https://github.com/MyScript/iinkJS),
  [docs](https://developer.myscript.com/doc/interactive-ink/4.1/web/overview/introduction/).
  The **on-device** iink engine exists for iOS/Android/Windows native only — unreachable
  from a plugin. **LIKELY.** Pricing (2k free/month, ~$10 per 1k thereafter) is from
  MyScript's **support forum, not an official pricing page** — **UNVERIFIED, re-check
  before relying on it**
  ([forum](https://developer-support.myscript.com/support/discussions/topics/16000030978)).

- **Apple Vision / `VNRecognizeTextRequest` / Scribble are confirmed unreachable.**
  They are native frameworks with no JS binding; reaching them needs a
  `WKScriptMessageHandler` bridge that **only the host app (Obsidian) could add**. A
  community plugin cannot add native code to Obsidian's iOS binary.
  **CONFIRMED by absence** ([Apple Vision docs](https://developer.apple.com/documentation/vision) —
  every platform listed is native).

- **On-device on iPad is not on the table in 2026, and you do not need to prototype it
  to know.** `Xenova/trocr-small-handwritten` quantised is ~64 MB
  (23.1 MB encoder + 40.5 MB decoder); `trocr-base-handwritten` quantised is ~340 MB
  (88.1 MB + 250 MB) — **CONFIRMED from the Hugging Face repos**. iOS WKWebView memory
  ceilings (~256 MB workable; 2 GB WASM heap fails outright) make the base model
  impossible and the small model marginal — **LIKELY**, from developer reports and a
  [WebKit bug](https://bugs.webkit.org/show_bug.cgi?id=221530), not an Apple-published
  number. **The decisive evidence is empirical: InkedMark shipped this and restricted
  it to desktop, explicitly because mobile webviews cannot run the models. CONFIRMED.**

- **tesseract.js has no handwriting model at all** — Tesseract is a printed-text engine.
  Include it only to rule it out. **CONFIRMED**
  ([tessdoc](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html),
  [tesseract.js#905](https://github.com/naptha/tesseract.js/issues/905)).

- **The standards-track option exists but not for you.** Chrome's
  `navigator.createHandwritingRecognizer()` takes strokes, runs on-device, offline, free
  — and is **Chromium-only with ChromeOS as the sole backend, English only**, a WICG
  proposal with no WebKit implementation and no MDN page. **CONFIRMED** —
  [Chrome docs](https://developer.chrome.com/docs/web-platform/handwriting-recognition),
  [chromestatus](https://chromestatus.com/feature/5263213807534080),
  [Mozilla standards-position](https://github.com/mozilla/standards-positions/issues/507).
  Worth revisiting in ~3 years.

### 4.2 What InkedMark uses — and the recommendation

**InkedMark does not use a stroke recogniser at all. It rasterises the ink to an image
and asks a vision LLM. CONFIRMED** from its README and `src/recognition/` (`render.ts`,
`llm-request.ts`, `llm.ts`, `trocr.ts` (dropped 2026-09-25), `manual.ts`, plus `openrouter-auth.ts`).

Three modes: **Manual** (default, never touches the network), **Cloud AI with BYO key**
(Anthropic / OpenAI / Google / OpenRouter, plus custom OpenAI-compatible endpoints such
as Ollama, LM Studio, llama.cpp, vLLM), and **on-device TrOCR** (experimental, desktop
only, English only, ~250 MB or ~1.3 GB first-run download, explicitly less accurate; dropped 2026-09-25).

**Recommendation for GoodObsidian: rasterize → vision LLM, BYO key, exactly as
InkedMark does.** Reasons:

- **Accuracy on cursive is best-in-class** — frontier VLMs top handwriting benchmarks,
  well ahead of traditional OCR. **LIKELY**, one third-party benchmark
  ([AIMultiple, updated 2026-08-25](https://aimultiple.com/handwriting-recognition)).
- **Cost is sub-cent to a few cents per page.** Rough order of magnitude for a 150-DPI
  A4 render (~2–3k image input tokens + ~0.5–1.5k output): ~$0.008/page on Claude Haiku
  4.5, ~$0.04 on Opus 5, ~$0.003 on a cheap Gemini Flash tier. Anthropic rates
  **CONFIRMED**; other vendors' **LIKELY/UNVERIFIED** — re-check before publishing numbers.
- **CORS is a non-issue**: Obsidian's `requestUrl` makes HTTPS requests _"without any
  CORS restrictions"_ — **CONFIRMED**
  ([docs](https://docs.obsidian.md/Reference/TypeScript+API/requestUrl)). This is
  precisely why BYO-key works in a plugin where it would not in a web page.
- **Privacy is the user's own choice** with their own key, and a local-endpoint option
  (Ollama etc.) covers the rest.

**Architectural note that costs nothing now and preserves everything:** store strokes
as strokes (which `PLAN.md` already mandates) **with timestamps**. Rasterising to an
image is lossy and one-way; keeping stroke order, pressure and timing keeps MyScript
and any future on-device stroke recogniser available later for free.

---

## 5. Shape recognition (hold-to-snap)

**Recommendation up front: write it. ~250–350 lines of core geometry, 400–500 shipped
with interaction and tuning. Do not adopt a shape-recognition library — there is no
maintained MIT one, and the famous one solves a different problem.**

### 5.1 The $-family is the wrong algorithm (this is the key finding)

**Licence first, since the brief asked:** the reference JS implementations are **New
BSD (3-clause)** — freely reusable, commercially, with attribution and a
non-endorsement clause. **CONFIRMED by reading the source headers:**
[`dollar.js`](https://depts.washington.edu/acelab/proj/dollar/dollar.js) (348 lines,
"Copyright (C) 2007-2012, Jacob O. Wobbrock, Andrew D. Wilson and Yang Li"),
[`pdollar.js`](https://depts.washington.edu/acelab/proj/dollar/pdollar.html) (329 lines),
[`qdollar.js`](https://depts.washington.edu/acelab/proj/dollar/qdollar.js) (409 lines).
No ambiguity.

**But they cannot give you what hold-to-snap needs.** $1 is an instance-based
nearest-neighbour classifier. Its pipeline resamples to N points, then **rotates to a
zero indicative angle, scales to a reference square, and translates to the origin** —
it _deliberately discards rotation, scale and position_, which are **exactly the
parameters you must have to draw the snapped shape**.

$1 answers *"this resembles your 'circle' template, score 0.91."* It does not answer
*"centre (412, 208), radius 76."* You would still write every fitter afterwards. It is
also non-uniformly scale-normalised, so it cannot separate a circle from an ellipse or
a square from a rectangle without special-casing — a limitation the authors document.
$P/$Q additionally discard stroke order and direction, which is _more_ invariance than
you want.

**$1 is the right tool for gesture commands** (draw a caret to insert, a pigtail to
delete). **It is the wrong tool for shape beautification.** **CONFIRMED** from the
[project page](https://depts.washington.edu/acelab/proj/dollar/index.html) and source.

### 5.2 The building blocks that do exist

- **RDP simplification — take the library.** `simplify-js` (mourner) v1.2.4,
  **BSD-2-Clause** (not MIT), **509 B gzipped**, zero deps, 123 lines including a
  radial-distance pre-pass. Last published 2020-02-03 — **finished, not abandoned**;
  the algorithm has not changed since 1973. **CONFIRMED**
  ([github](https://github.com/mourner/simplify-js)). Actively-maintained alternative
  if you prefer: `douglas-peucker` v1.1.3 (2025-09-30, MIT).
- **Least-squares circle fitting — write it, ~50 lines.** `circle-fit` (MIT, 123 lines,
  algebraic Kåsa fit, returns centre/radius/residue) exists but was last published
  **2018-02-26** with 14 stars and no types. There is no maintained, small, typed JS
  circle-fit package. The algebraic fit is three summed moment equations and a 2×2
  solve — read it off [lucidar.me](https://lucidar.me/en/mathematics/least-squares-fitting-of-circle/)
  or [Chernov & Lesort](https://arxiv.org/pdf/cs/0301001). **CONFIRMED.**
- **Line fitting — use total least squares (~20 lines),** i.e. the principal axis of
  the covariance matrix, **not** ordinary `y = mx + b`, which breaks on vertical lines.

### 5.3 All-in-one npm shape recognisers: there is nothing good

| Package                         | Published      | Licence                | Verdict                                                                                                                                  |
| ------------------------------- | -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `shape-detector`                | **2015-01-29** | no npm field; repo MIT | Dead 11 years. A $1 wrapper — inherits the wrong-algorithm problem.                                                                      |
| `drawn-shape-recognizer`        | 2021-03-21     | ISC                    | 17.6 kB, unmaintained, description is a demo link.                                                                                       |
| `interactive-shape-recognition` | **2019-06-05** | MIT                    | 4.7 kB. Implements Olsen et al. — **algorithmically the right family** (fits geometry rather than classifying), but a 2019 one-off.      |
| `shapeit`                       | 2022-05-05     | MIT                    | **Name collision** — it is a TypeScript object-validation library. Do not be misled.                                                     |
| `@desert-ant-labs/shapes`       | **2026-09-18** | **commercial**         | Real, current, on-device LiteRT model, <10 ms, offline. But **166 MB unpacked** and not open source. Non-starter for a community plugin. |

**Answer to "are there maintained MIT ones?": effectively no.** Everything MIT is
2015–2021 abandonware; the only current option is proprietary and ships a WASM runtime.
**CONFIRMED** from the npm registry.

### 5.4 What the incumbents actually do

- **Excalidraw does not do freehand shape recognition.** Its "shape switch" (Tab,
  PR #9270, merged 2025-04-30) only converts an _already-placed primitive_.
  Auto-converting a hand-drawn stroke is
  [issue #9227, opened 2025-03-06, **still open** today](https://github.com/excalidraw/excalidraw/issues/9227).
  **CONFIRMED via the GitHub API.**
- **tldraw does not either** — its own blog post is _"Engineering imperfection with
  draw shapes"_; they add deliberate wobble. Its draw tool does have thresholds worth
  stealing: Shift snaps to **15° increments**, snapping to earlier straight segments
  within **8 screen pixels**, and auto-close when the endpoint returns near the start,
  gated on _"path length exceeds 4× the scaled stroke width"_.
  ([tldraw.dev/sdk-features/draw-shape](https://tldraw.dev/sdk-features/draw-shape)) — **CONFIRMED.**
- **js-draw is the only one that does what you want, and it is MIT.** This is the find
  of this section.
  [`makeShapeFitAutocorrect.ts`](https://raw.githubusercontent.com/personalizedrefrigerator/js-draw/main/packages/js-draw/src/components/builders/autocorrect/makeShapeFitAutocorrect.ts)
  is **234 lines**, and `tools/Pen.ts` wires it to a literal hold-to-snap via a
  `StationaryPenDetector`, with a preview render, cancellation on further movement, and
  `announceForAccessibility`. **CONFIRMED, source read.** Its templates are **line and
  rectangle only — no circle.**

  That last fact is the best available calibration for the build estimate: **a shipped,
  accessibility-aware hold-to-snap for two shape types is 234 lines.**

### 5.5 Build estimate

| Component                                   | Lines                              | Note                                                                                                                                    |
| ------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| RDP simplify                                | **0**                              | Use `simplify-js` (509 B, BSD-2). ~35 if inlined.                                                                                       |
| Closed-vs-open detection                    | 10–15                              | `dist(first,last) < k · pathLength` + bbox-diagonal guard. Steal tldraw's 4×-stroke-width gate.                                         |
| Least-squares circle (Kåsa) + ellipse guard | 45–60                              | ~40 for fit + residual; +15 for axis-aligned ellipse (needed to tell circle from oval).                                                 |
| Line fit (total least squares)              | 20–25                              | Covariance principal axis; handles verticals.                                                                                           |
| Rect fit (AABB + rotated min-area)          | 35–50                              | AABB alone ~10 (js-draw stops there); rotating calipers ~40.                                                                            |
| Corner detection for polygons               | 50–70                              | Iterative RDP with adaptive tolerance, turn-angle filtering, near-collinear merging. **The genuinely fiddly part — budget generously.** |
| Scoring / dispatch between candidates       | 30–40                              | Normalised residual per candidate + hysteresis so the preview does not flicker.                                                         |
| Hold detect + preview + cancel + a11y       | 60–90                              | Copy js-draw's `StationaryPenDetector` pattern.                                                                                         |
| **Total**                                   | **~250–350 core, 400–500 shipped** |                                                                                                                                         |

**Why build rather than buy:**

1. No library fits. MIT candidates are 5–11 years stale; the current one is 166 MB and commercial.
2. The $-recognisers structurally cannot give the answer. Even using $1 purely as a
   classifier to pick which fitter to run, you write the fitters anyway — so you have
   added a 348-line dependency to save a ~40-line dispatch function.
3. The geometry is closed-form and genuinely small.
4. **Shape snapping lives or dies on feel.** Every constant — dwell time, residual
   tolerance, minimum size before snapping engages — needs tuning against a real Apple
   Pencil. A library would fight you on exactly these.

**Third-party footprint for the whole ink + snap stack: `perfect-freehand` (2.0 kB) +
`simplify-js` (0.5 kB) = ~2.5 kB gzipped.** Everything else is your own code.

---

## Verdict

**GO on the core approach.** HTML canvas + JavaScript handwriting in Obsidian on iPad
is not merely possible — **four plugins already ship it**, one with ~198k downloads.
The question was never "can a webview do this"; it is "can it do it well enough, and
what does it cost". The answers came back better than expected on the two items that
looked most dangerous:

- **`getCoalescedEvents()` and `getPredictedEvents()` are supported** (Safari 18.2+,
  2024-12-09). The faceted-stroke failure mode has a real fix.
- **`loadPdfJs()` is a public, documented Obsidian API** with no mobile caveat. The
  PDF item that `PLAN.md` promoted into v1 mid-research is a ~1.4 MB saving and a
  handful of lines, not a second application. It is also **the genuine market gap**:
  PDF++ has publicly declined handwriting and Obsidian's roadmap has it parked.

Three things temper the GO, and none of them is a stopper:

1. **Scribble is the one problem you cannot fix in code** — but a dedicated
   full-screen view (which `PLAN.md` already specifies) appears to sidestep it, per
   Ink's own documentation. **Verify in spike zero.**
2. **The storage format as currently written in `PLAN.md` is wrong** and will silently
   break the very item `PLAN.md` calls decisive. See risk #2.
3. **v1 is overloaded.** See "What to cut" below.

**Do not treat this as a green light to start coding features.** Spike zero (§1.6.3)
comes first, and the format decision (§2.5) comes second. Both are cheap; both are
irreversible if got wrong.

## Recommended engine

**Build on `perfect-freehand`, lifting liberally from InkedMark (MIT) — after spending
one hour evaluating js-draw.**

Ranked, with reasoning:

| Option                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **perfect-freehand + InkedMark as a source quarry** | **Recommended.** MIT throughout, 2.0 kB dependency, zero React, matches `PLAN.md`'s stack exactly. InkedMark has already paid for the hard lessons — Scribble, wet/dry split, quantise-pack-deflate — and its `src/` is small enough (~225 KB) to read in a day.                                                                                                                                                    |
| **js-draw**                                         | **Evaluate first, one hour, before committing.** MIT, 133.5 kB, used by Joplin, and it already ships pressure pen, undo, serialisation, stylus-vs-touch discrimination **and a working hold-to-snap** (234 lines, missing only circles). This was not in the brief and it may be the shortest path to v1 items 1, 2, 6, 7 and 8. Risk: you inherit its document model, which may fight the page/PDF-backdrop model. |
| **Fork InkedMark wholesale**                        | **No.** Three months old, 7 stars, 1.8k downloads, one maintainer — informed prior art, not a proven foundation. It is also architecturally committed to _inline ink blocks_, where GoodObsidian wants _a notebook of pages with PDF backdrops_. `canvas/`, `ink/`, `input/` and `model/compress` transfer (~60 KB); `view/` does not. Lift with attribution; do not clone and rename.                              |
| **tldraw**                                          | **Ruled out, decisively.** Proprietary; no free watermark-free path; forbids interfering with enforcement; ships telemetry; requires React; 512 kB gzipped. And its **own official Obsidian plugin's canvas goes blank after five seconds on iPad** — an exact match for its documented unlicensed-production behaviour. The incumbent that used it has migrated away.                                              |
| **Fork Ink**                                        | **Legally impossible.** CC-BY-NC-ND-4.0 — **no derivatives**. Read its excellent docs; you may not take its code.                                                                                                                                                                                                                                                                                                   |

**Concrete stack:** TypeScript + esbuild → `perfect-freehand` (MIT, 2.0 kB) +
`simplify-js` (BSD-2, 0.5 kB) + `fflate` or LZ-String for the payload + Obsidian's
`loadPdfJs()` + your own pointer layer, renderer, page model and shape fitting.
**Third-party runtime footprint under 5 kB gzipped**; target `main.js` well under 1 MB.

**Steal explicitly, with attribution in the README** (Obsidian's submission requirements
mandate licence compliance for bundled code):

- InkedMark (MIT): `input/palm-rejection.ts`, the coalesced/predicted handling in
  `input/pointer-controller.ts`, `ink/freehand.ts`, the wet/dry split in
  `canvas/renderer.ts` + `spatial-index.ts`, and `model/compress.ts`'s
  quantise → tuple-pack → deflate → base64 pipeline.
- Excalidraw (MIT): the `event.pressure === 0.5` sentinel for `simulatePressure`.
- tldraw's **published thresholds** (not its code): 15° angle snapping, 8-screen-pixel
  segment snapping, auto-close gated on "path length > 4× scaled stroke width".
- Ink's **documented engineering contracts** (not its code — CC-BY-NC-ND): `WeakMap`
  outline cache, touch only changed strokes, **never autosave while a pointer is down**,
  quiet period 500 ms desktop / 2000 ms mobile.

## Top risks

**1. iPadOS Scribble silently swallowing Apple Pencil strokes.** _Severity: project-ending
in the worst case. Likelihood: moderate, and lower than it first looked._
No web API can disable or detect it; dropped strokes produce no events. InkedMark
measured ~20% of fast pen-downs lost with Scribble on. **Mitigations exist and are
plausible** (dedicated full-screen view per Ink's docs; Touch Events fallback per
signature_pad), but they are LIKELY, not CONFIRMED, and the sources conflict.
**→ Spike zero, §1.6.3, before any other work.** If it cannot be mitigated, every user
must disable a system feature permanently.

**2. The `.gnote` extension will silently not sync.** _Severity: breaks the item
`PLAN.md` itself calls decisive. Likelihood: near-certain as currently specified._
Obsidian Sync's "Sync all other types" is **off by default**; only Images, Audio,
Videos and PDFs are on. A bare `.gnote` file simply will not reach the other device on
a fresh install, and the user will have no idea why. But the obvious fix — a `.md`
wrapper — buys diff-match-patch text merging, which will happily interleave two
devices' base64 chunks into an undecompressable payload (Excalidraw carries a source
comment about exactly this). **→ Decide the format before writing format code.**
Favoured: a merge-tolerant append-only `.md` layout, one self-contained stroke per line.

**3. v1 is overloaded, and PDF annotation was added to it mid-research.** _Severity:
schedule. Likelihood: high._ Ten definition-of-done items including PDF backdrops,
lasso select and hold-to-snap is a lot for a first release whose riskiest unknowns are
still unmeasured. See "What to cut" below.

**4. Performance collapse at scale.** _Severity: high. Likelihood: moderate._
Excalidraw freezes on iPad around ~2 MB drawings; Ink measured SVG dying at **200–300
strokes** on iOS — three or four paragraphs of handwriting. `PLAN.md`'s canvas choice
is correct and not a close call, but canvas alone does not save you: you need the
wet/dry split, viewport culling, a spatial index, and an outline cache from day one,
not as optimisation later. A lecture is thousands of strokes.

**5. Sync version-history amplification blowing the storage quota.** _Severity: medium.
Likelihood: high if autosave is naive._ Sync stores a full copy every few seconds of
active editing; a 500 KB drawing reportedly accrues 3–5 MB per editing minute, and one
user's vault went 700–800 MB → 1.6 GB. Handwriting saves far more often than
diagramming. **Autosave cadence is a product decision** — never save with the pen down;
2000 ms quiet period on mobile.

**6. No way to debug on device from this laptop.** _Severity: medium. Likelihood:
certain._ Safari Web Inspector needs macOS; `app.emulateMobile(true)` does not emulate
Capacitor. **Build an on-screen debug HUD early** — InkedMark did, and it is how they
measured the Scribble loss in the first place.

**7. Cold-start cost.** _Severity: medium. Likelihood: moderate._ Plugin load is
synchronous and blocking, and Obsidian **reopens saved workspace views at startup**, so
your view's `onOpen` runs during cold start — one reported case had 18 s of a 30 s
mobile start spent re-rendering plugin views. Keep `onload` to registrations; defer to
`onLayoutReady`; render the page lazily.

**8. Private-API drift on the PDF path.** _Severity: low-medium. Likelihood: low if you
stay disciplined._ `loadPdfJs()` is public and stable. Everything else PDF-related is
private and has already broken once (v1.8.0 replaced the `ObsidianViewer` class with a
factory). PDF++'s own README warns it _"may break when Obsidian is updated"_.
**Use `loadPdfJs()` + `page.render()` to a canvas and nothing else.** Whether
Obsidian's build exposes pdf.js's `AnnotationEditorLayer` is UNVERIFIED — you should
not need it.

**9. No mobile-toolbar API.** _Severity: low. Likelihood: certain._ Users must add
commands to the iPad keyboard toolbar by hand. Build your own DOM toolbar in the view's
`contentEl` (which `PLAN.md` already assumes), and fall back to a text label when a
plugin icon renders blank.

### What to cut from v1 — harder than it looks

- **Hold-to-snap shape recognition (item 8).** The best MIT reference implementation in
  existence (js-draw, used by Joplin) ships **line and rectangle only, no circle**, in
  234 lines. Excalidraw has had it as an _open issue since 2025-03-06_. tldraw
  deliberately went the other way. Nobody has shipped good freehand-to-circle snapping
  in a web canvas. Budget 400–500 lines plus real tuning time against an Apple Pencil —
  and the tuning, not the geometry, is the cost. **Cut to Later, or ship
  line-and-rectangle only and call it done.**
- **Lasso select with move/delete (item 7).** Sounds like one feature; is actually
  polygon hit-testing against stroke outlines, a spatial index, a transform model, and
  undo integration for a multi-stroke operation. **Consider shipping
  tap-to-select-one-stroke + delete in v1** and deferring true lasso.
- **PDF annotation (item 5, promoted mid-research).** Rendering a page to a canvas
  backdrop is genuinely cheap thanks to `loadPdfJs()` — but the _rest_ of it is not:
  page-size and DPI matching, re-render on zoom, coordinate mapping between PDF space
  and ink space, what happens when the source PDF changes or moves, and multi-page
  navigation. It reshapes the document model, as `PLAN.md` itself notes. **Keep it if
  Joost genuinely wants it most — he said he does — but then cut items 7 and 8 to pay
  for it.** All three in one v1 is not realistic.
- **Insert image from vault (item 9).** Low risk, low value in a lecture. First thing
  to drop.

**What must stay in v1, non-negotiably:** items 1, 2, 3, 4, 6 and 10 — pressure ink at
usable latency, palm rejection, the toolbar, pages with backgrounds, undo/redo, and
**survives sync unchanged**. Item 10 is the one that quietly decides whether this is
usable, and §2.5 says the currently-specified format will fail it.
