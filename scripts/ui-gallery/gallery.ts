/**
 * The UI gallery: every surface of the plugin, rendered by its real code with
 * Obsidian's real stylesheet, one scene at a time.
 *
 *   /                       index of scenes
 *   /?scene=<id>&theme=dark one scene, in a frame at the page origin
 *   gallery.exportAll()     write every scene as a static page to out/export/
 *
 * See README.md for the loop this serves (Claude Design and back).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { pageRegistry, paintOps, resolvedOps } from "./recorder";
import type { Scene } from "./scenes/types";
import { SCENES } from "./scenes/index";
import { exportSurfaces, pagesTable, resetSurfaces } from "./scenes/surface-export";
import {
  chunkPaths,
  formatCss,
  jsLiteral,
  splitCssParts,
  splitTableScripts,
  wrapHtml,
} from "./format";

const G = globalThis as any;
const params = new URLSearchParams(location.search);

// The browser pane stops requestAnimationFrame, and with it intersection
// observations, while it is not painted (ledger, 2026-09-22) — and an export
// usually runs with the pane hidden. Thumbnails paint through both, so the
// gallery drives them from a timer and reports everything as on screen: a
// snapshot has no scroll position to be lazy about.
window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
  window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id: number): void => window.clearTimeout(id);
class SeenIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const entry = {
        target,
        isIntersecting: true,
        intersectionRatio: 1,
        boundingClientRect: rect,
        intersectionRect: rect,
        rootBounds: null,
        time: performance.now(),
      } as unknown as IntersectionObserverEntry;
      this.callback([entry], this as unknown as IntersectionObserver);
    }, 0);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
(window as any).IntersectionObserver = SeenIntersectionObserver;

// --- Frames ----------------------------------------------------------------

const FRAME_THEMES = ["theme-light", "theme-dark"] as const;

function setViewport(width: number, height: number): void {
  // Popover placement reads the window size; a frame is the window here.
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => width });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => height });
}

function makeFrame(scene: Scene, theme: string): HTMLElement {
  document.body.classList.remove(...FRAME_THEMES);
  document.body.classList.add(theme);
  const { width, height } = scene.size ?? { width: 1180, height: 820 };
  setViewport(width, height);
  const frame = document.body.createDiv({ cls: "gallery-frame" });
  frame.dataset.scene = scene.id;
  frame.setCssStyles({ width: `${width}px`, height: `${height}px` });
  G.__galleryMount = frame;
  return frame;
}

async function settle(ms = 120): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function renderScene(scene: Scene, theme: string): Promise<HTMLElement> {
  document.querySelectorAll(".gallery-frame").forEach((f) => f.remove());
  // Leftovers of the last scene that lived on <body> (popovers, body classes).
  for (const el of Array.from(document.body.children)) {
    if (el.tagName !== "SCRIPT") el.remove();
  }
  document.body.classList.remove("goodobsidian-text-editing", "goodobsidian-dialog-typing");
  G.__galleryModals = [];
  G.__galleryMenus = [];
  resetSurfaces();
  const frame = makeFrame(scene, theme);
  await scene.render({ frame, settle });
  await settle(scene.settleMs ?? 150);
  // Popovers attach to <body> (Add Page, More, AI…). They are position:
  // fixed, and the frame sits at the page origin and is their containing
  // block, so moving them in keeps them where they are.
  for (const el of Array.from(document.body.children)) {
    if (el !== frame && el.tagName !== "SCRIPT") frame.appendChild(el);
  }
  return frame;
}

// --- Serialising a frame ----------------------------------------------------

function syncFormState(src: Element, dst: Element): void {
  const a = src.querySelectorAll("input, textarea, select");
  const b = dst.querySelectorAll("input, textarea, select");
  a.forEach((el, i) => {
    const out = b[i];
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") out.toggleAttribute("checked", el.checked);
      else out.setAttribute("value", el.value);
    } else if (el instanceof HTMLTextAreaElement) {
      out.textContent = el.value;
    } else if (el instanceof HTMLSelectElement) {
      out
        .querySelectorAll("option")
        .forEach((o, j) => o.toggleAttribute("selected", j === el.selectedIndex));
    }
  });
}

function averageColour(canvas: HTMLCanvasElement): string {
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const ctx = probe.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? "transparent" : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
  } catch {
    return "transparent";
  }
}

function serialiseCanvases(src: Element, dst: Element): void {
  const a = src.querySelectorAll("canvas");
  const b = dst.querySelectorAll("canvas");
  a.forEach((canvas, i) => {
    const out = b[i] as HTMLCanvasElement;
    const ops = paintOps.get(canvas);
    out.setAttribute("width", String(canvas.width));
    out.setAttribute("height", String(canvas.height));
    if (ops && ops.length) {
      out.setAttribute("data-gallery-paint", JSON.stringify(chunkPaths(resolvedOps(ops))));
    } else if (canvas.width * canvas.height > 0) {
      // Unknown content (a colour wheel, a scan): its average colour, so the
      // layout still reads. Blank canvases stay blank.
      const fill = averageColour(canvas);
      if (fill !== "transparent") out.style.backgroundColor = fill;
    }
  });
}

/** Every icon the snapshots use, by name: [viewBox, inner markup]. icons.js puts them back. */
const iconTable = new Map<string, [string, string]>();

/**
 * Obsidian inserts icons with setIcon() at run time; the snapshots do the
 * same, from icons.js, so each page carries `<svg data-i="name">` instead of
 * the same markup fifty times over.
 */
function extractIcons(root: Element): void {
  root.querySelectorAll("svg.svg-icon").forEach((svg) => {
    const cls = Array.from(svg.classList).find((c) => c !== "svg-icon");
    if (!cls) return;
    const name = cls.replace(/^lucide-/, "");
    if (!iconTable.has(name))
      iconTable.set(name, [svg.getAttribute("viewBox") ?? "0 0 24 24", svg.innerHTML]);
    for (const attr of Array.from(svg.attributes))
      if (attr.name !== "class") svg.removeAttribute(attr.name);
    svg.replaceChildren();
    svg.setAttribute("data-i", name);
  });
}

function serialiseFrame(frame: HTMLElement): string {
  const clone = frame.cloneNode(true) as HTMLElement;
  syncFormState(frame, clone);
  serialiseCanvases(frame, clone);
  exportSurfaces(frame, clone);
  // What the screen does not show is not shipped: other scenes show those
  // states. (Every page is uploaded as text, so bytes count.)
  clone
    .querySelectorAll(
      'script, audio, input[type="file"], .gallery-omit, .is-hidden, [style*="display: none"], [hidden]',
    )
    .forEach((n) => n.remove());
  extractIcons(clone);
  return (
    clone.innerHTML
      .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")
      // Paint data in single quotes: JSON's double quotes then need no escaping.
      .replace(
        /data-gallery-paint="([^"]*)"/g,
        (_m, v: string) =>
          `data-gallery-paint='${v.replace(/&quot;/g, '"').replace(/'/g, "&#39;")}'`,
      )
  );
}

function iconsScript(): string {
  const table = Object.fromEntries([...iconTable].sort(([a], [b]) => a.localeCompare(b)));
  return `// The icons the snapshots use (Obsidian's Lucide set), put back where a page
// says <svg class="svg-icon" data-i="name">, the way Obsidian's setIcon() does.
(function () {
  var I = ${jsLiteral(table, "  ")};
  var A = { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" };
  document.querySelectorAll("svg[data-i]").forEach(function (svg) {
    var icon = I[svg.getAttribute("data-i")];
    if (!icon) return;
    svg.setAttribute("viewBox", icon[0]);
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    for (var k in A) svg.setAttribute(k, A[k]);
    svg.innerHTML = icon[1];
  });
})();
`;
}

// --- Obsidian CSS actually used by the exported scenes ---------------------

const DYNAMIC_PSEUDO =
  /::?(?:hover|active|focus-visible|focus-within|focus|visited|link|before|after|placeholder|selection|marker|backdrop|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)(?:\([^)]*\))?/g;

function selectorMatches(root: Element, sel: string): boolean {
  const s = sel.trim();
  if (/^(:root|body|html|\*|\.theme-(light|dark))$/.test(s)) return true;
  // A state the snapshot is not in (:hover) is taken as possible; a negated
  // one (:not(:hover)) as always true, so both reduce to the static part.
  const stat =
    s
      .replace(/:not\(\s*::?(?:hover|active|focus[-\w]*|visited|link)\s*\)/g, "")
      .replace(DYNAMIC_PSEUDO, "")
      .replace(/:(?:not|is|where|has)\(\s*\)/g, "")
      .replace(/\s*>\s*$/, "") || "*";
  try {
    return root.querySelector(stat) !== null || root.matches(stat);
  } catch {
    return false;
  }
}

/** `body` and `:root` re-declared on each frame, so derived variables resolve per frame theme. */
function frameScoped(selector: string): string {
  return selector
    .split(",")
    .flatMap((part) => {
      const p = part.trim();
      if (p === "body" || p === ":root") return [p, ".gallery-frame"];
      if (/^body\.theme-(light|dark)$/.test(p)) return [p.replace(/^body/, "")];
      return [p.replace(/^body\.theme-(light|dark)\b/, ".theme-$1")];
    })
    .join(", ");
}

/**
 * A block of CSS source split into its top-level rules, as written. The text
 * is kept, never re-serialised from the CSSOM: Chrome drops a var()
 * shorthand that a longhand later overrides (`padding: var(--file-margins);
 * padding-bottom: …` comes back as `padding-top: ;`), which lost the view's
 * margins in the first export.
 */
interface CssBlock {
  prelude: string;
  body: string;
}
function splitCss(src: string): CssBlock[] {
  const out: CssBlock[] = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let open = -1;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const endComment = src.indexOf("*/", i + 2);
      i = endComment < 0 ? src.length : endComment + 2;
      if (depth === 0) start = i;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push({ prelude: src.slice(start, open).trim(), body: src.slice(open + 1, i) });
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) {
      start = i + 1; // an @import / @charset / @layer statement
    }
    i++;
  }
  return out;
}

function subsetCss(src: string, root: Element, keyframes: Set<string>): string {
  const out: string[] = [];
  for (const { prelude, body } of splitCss(src)) {
    if (prelude.startsWith("@")) {
      const at = /^@([\w-]+)/.exec(prelude)?.[1] ?? "";
      if (at === "media" || at === "supports" || at === "container" || at === "layer") {
        if (at === "media" && /\bprint\b/.test(prelude) && !/screen/.test(prelude)) continue;
        const inner = subsetCss(body, root, keyframes);
        if (inner) out.push(`${prelude} {\n${inner}\n}`);
      } else if (at === "property") out.push(`${prelude} {${body}}`);
      // @font-face points at Obsidian's bundled fonts, @keyframes are added below.
      continue;
    }
    const parts = prelude.split(/,(?![^(]*\))/);
    if (!parts.some((p) => selectorMatches(root, p))) continue;
    out.push(`${frameScoped(prelude)} {${body.replace(/\s+/g, " ")}}`);
    for (const m of body.matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)) keyframes.add(m[1]);
  }
  return out.join("\n");
}

async function obsidianSubset(root: Element): Promise<string> {
  const src = await (await fetch(".cache/obsidian-app.css")).text();
  const keyframes = new Set<string>();
  const kept = subsetCss(src, root, keyframes);
  const frames = splitCss(src)
    .filter(
      (b) => /^@(-webkit-)?keyframes\s/.test(b.prelude) && keyframes.has(b.prelude.split(/\s+/)[1]),
    )
    .map((b) => `${b.prelude} {${b.body.replace(/\s+/g, " ")}}`);
  return [
    "/* Obsidian's app.css, cut down to the rules the GoodObsidian snapshots use.",
    "   Extracted from the installed app by scripts/ui-gallery; Obsidian's, not",
    "   ours: never commit it. `body` and `:root` rules are re-declared on",
    "   .gallery-frame so each frame resolves its own theme. */",
    kept,
    ...frames,
  ].join("\n");
}

// --- Export -----------------------------------------------------------------

async function save(path: string, body: string): Promise<void> {
  const res = await fetch(`/save?path=${encodeURIComponent(path)}`, { method: "POST", body });
  if (!res.ok) throw new Error(`save ${path}: ${res.status}`);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Pages link one index per group (obsidian.css and goodobsidian.css
 * @import their parts; pages.js loads its parts), so a change in how many
 * parts there are touches one small file, not every page.
 */
function pageHtml(scene: Scene, inner: string, size: { width: number; height: number }): string {
  const { width, height } = size;
  const css = ["obsidian.css", "goodobsidian.css", "polish.css", "gallery.css"]
    .map((f) => `<link rel="stylesheet" href="${f}">`)
    .join("\n");
  const scripts = ["icons.js", "gallery-twin.js", "pages.js", "paper.js"]
    .map((f) => `<script src="${f}"></script>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(scene.title)} · GoodObsidian</title>
${css}
</head>
<body class="is-mobile is-tablet is-ios show-view-header gallery-page">
<header class="gallery-head">
<a class="gallery-back" href="index.html">All screens</a>
<h1>${esc(scene.title)}</h1>
<p>${esc(scene.note ?? "")}</p>
</header>
<main class="gallery-frames">
<figure class="gallery-shot">
<figcaption>Light theme</figcaption>
<div class="gallery-frame theme-light" data-screen-label="${esc(scene.title)} (light)" style="width: ${width}px; height: ${height}px">
${wrapHtml(inner)}
</div>
</figure>
<figure class="gallery-shot" data-twin-of="light">
<figcaption>Dark theme</figcaption>
</figure>
</main>
${scripts}
</body>
</html>
`;
}

function indexHtml(scenes: Scene[]): string {
  const groups = new Map<string, Scene[]>();
  for (const s of scenes) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  const sections = [...groups]
    .map(
      ([group, list]) =>
        `<section>\n<h2>${esc(group)}</h2>\n<ul>\n${list
          .map(
            (s) =>
              `<li><a href="${s.id}.html">${esc(s.title)}</a><span>${esc(s.note ?? "")}</span></li>`,
          )
          .join("\n")}\n</ul>\n</section>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GoodObsidian UI</title>
<link rel="stylesheet" href="gallery.css">
</head>
<body class="gallery-index">
<header>
<h1>GoodObsidian UI</h1>
<p>Every screen of the plugin as it ships, rendered by its real code with Obsidian's own stylesheet, on an iPad in landscape. Read <a href="BRIEF.md">BRIEF.md</a> before changing anything.</p>
</header>
${sections}
</body>
</html>
`;
}

/**
 * Render every scene, then write the shared files (whose part names the
 * pages link to), then the pages. Always the whole set: icons.js, pages-*.js
 * and obsidian-*.css are built from what every page uses.
 */
async function exportAll(): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  const write = async (name: string, text: string): Promise<void> => {
    await save(`out/export/${name}`, text);
    sizes[name] = text.length;
  };
  pageRegistry.clear();
  iconTable.clear();
  const rendered: Array<{ scene: Scene; inner: string; size: { width: number; height: number } }> =
    [];
  const holder = document.createElement("div");
  for (const scene of SCENES) {
    let frame: HTMLElement;
    try {
      frame = await renderScene(scene, "theme-light");
    } catch (e) {
      console.error(`[gallery] ${scene.id}`, e);
      sizes[`${scene.id}.html`] = -1;
      continue;
    }
    const inner = serialiseFrame(frame);
    // The frame's size as rendered: a scene may grow it to fit (settings).
    rendered.push({ scene, inner, size: { width: frame.offsetWidth, height: frame.offsetHeight } });
    const keep = document.createElement("div");
    keep.innerHTML = inner;
    holder.appendChild(keep);
  }
  document.querySelectorAll(".gallery-frame").forEach((f) => f.remove());

  // The subset is taken over every scene at once, with the theme and the
  // body classes present, so a rule for any of them is kept.
  const probe = document.body.createDiv({ cls: "gallery-frame theme-light gallery-probe" });
  probe.append(...Array.from(holder.childNodes));
  const obsidian = splitCssParts(formatCss(await obsidianSubset(document.body)));
  probe.remove();
  const styles = await (await fetch("/styles.css")).text();
  const goodobsidian = splitCssParts(styles);
  const pages = splitTableScripts(
    "GALLERY_PAGES",
    pagesTable(pageRegistry),
    "// The ink and text of the pages the snapshots show, in page px. paper.js\n" +
      "// paints them wherever a canvas refers to one ({ref, t}).\n",
  );
  const writeParts = async (prefix: string, ext: string, texts: string[]): Promise<string[]> => {
    const names = texts.map((_, i) => `${prefix}-${i + 1}.${ext}`);
    for (let i = 0; i < texts.length; i++) await write(names[i], texts[i]);
    return names;
  };
  const cssIndex = (what: string, names: string[]): string =>
    `/* ${what}, in parts (each is uploaded as text, and must stay small). */\n` +
    names.map((n) => `@import url("${n}");`).join("\n") +
    "\n";
  await write(
    "obsidian.css",
    cssIndex("Obsidian's stylesheet, cut down", await writeParts("obsidian", "css", obsidian)),
  );
  await write(
    "goodobsidian.css",
    cssIndex(
      "The plugin's styles.css, verbatim",
      await writeParts("goodobsidian", "css", goodobsidian),
    ),
  );
  const pageParts = await writeParts("pages", "js", pages);
  await write(
    "pages.js",
    "// Loads the sample notebook's pages (pages-N.js) before paper.js paints them.\n" +
      pageParts.map((n) => `document.write('<script src="${n}"><\\/script>');`).join("\n") +
      "\n",
  );
  // The whole stylesheet as shipped, for diffing against a pulled copy.
  await save("out/goodobsidian.css", styles);
  for (const file of ["gallery.css", "gallery-twin.js", "BRIEF.md", "polish.css"]) {
    await write(file, await (await fetch(file)).text());
  }
  await write("icons.js", iconsScript());
  await write("index.html", indexHtml(SCENES));
  for (const { scene, inner, size } of rendered)
    await write(`${scene.id}.html`, pageHtml(scene, inner, size));
  return sizes;
}

// --- Local pages --------------------------------------------------------------

function showIndex(): void {
  document.body.addClass("gallery-index");
  const root = document.body.createDiv({ cls: "gallery-list" });
  root.createEl("h1", { text: "GoodObsidian UI gallery" });
  const groups = new Map<string, Scene[]>();
  for (const s of SCENES) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  for (const [group, list] of groups) {
    root.createEl("h2", { text: group });
    const ul = root.createEl("ul");
    for (const s of list) {
      const li = ul.createEl("li");
      li.createEl("a", { text: s.title, href: `?scene=${s.id}` });
      li.createEl("a", {
        text: "dark",
        href: `?scene=${s.id}&theme=dark`,
        cls: "gallery-dark-link",
      });
    }
  }
}

async function boot(): Promise<void> {
  G.__galleryIcons = await (await fetch(".cache/lucide.json")).json();
  G.gallery = { scenes: SCENES, renderScene, exportAll, serialiseFrame, pageRegistry };
  const id = params.get("scene");
  if (!id) {
    showIndex();
    return;
  }
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) {
    document.body.setText(`No scene "${id}"`);
    return;
  }
  await renderScene(scene, params.get("theme") === "dark" ? "theme-dark" : "theme-light");
  document.title = `${scene.title} · gallery`;
  G.galleryReady = true;
}

void boot();
