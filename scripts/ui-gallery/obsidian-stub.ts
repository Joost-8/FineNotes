/**
 * Just enough of Obsidian to run the plugin's views in a plain browser page.
 *
 * The DOM each class builds copies Obsidian's own (read from `app.js` in the
 * installed app: Modal, Menu, Setting and its components, Notice, setIcon), so
 * Obsidian's real `app.css` styles the gallery the way it styles the plugin.
 * Behaviour is only what rendering needs; nothing here talks to a vault.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

// ---------------------------------------------------------------------------
// DOM helpers Obsidian adds to the prototypes and to the global scope.

type Info = {
  cls?: string | string[];
  text?: string | DocumentFragment;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  placeholder?: string;
  href?: string;
};
type InfoArg = Info | string | undefined;
type Cb<T> = ((el: T) => void) | undefined;

function applyInfo(el: HTMLElement | SVGElement, o: InfoArg): void {
  const info: Info = typeof o === "string" ? { cls: o } : (o ?? {});
  if (info.cls) {
    const list = Array.isArray(info.cls) ? info.cls : info.cls.split(" ");
    el.classList.add(...list.filter(Boolean));
  }
  if (info.text !== undefined) {
    if (typeof info.text === "string") el.textContent = info.text;
    else el.appendChild(info.text);
  }
  for (const [k, v] of Object.entries(info.attr ?? {})) {
    if (v === null || v === false) continue;
    el.setAttribute(k, v === true ? "" : String(v));
  }
  if (info.title !== undefined) el.setAttribute("title", info.title);
  if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
  if (info.type !== undefined) (el as HTMLInputElement).type = info.type;
  if (info.placeholder !== undefined) (el as HTMLInputElement).placeholder = info.placeholder;
  if (info.href !== undefined) (el as HTMLAnchorElement).href = info.href;
  if (info.parent) {
    if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
    else info.parent.appendChild(el);
  }
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  o?: InfoArg,
  cb?: Cb<HTMLElementTagNameMap[K]>,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyInfo(el, o);
  cb?.(el);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function makeSvg(tag: string, o?: InfoArg, cb?: Cb<SVGElement>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  applyInfo(el, o);
  cb?.(el);
  return el;
}

function attach<T extends Node>(parent: Node, child: T, o: InfoArg): T {
  const prepend = typeof o === "object" && o?.prepend;
  if (prepend) parent.insertBefore(child, parent.firstChild);
  else parent.appendChild(child);
  return child;
}

const N = Node.prototype as any;
N.createEl = function (this: Node, tag: any, o?: InfoArg, cb?: Cb<any>) {
  return attach(this, make(tag, o, cb), o);
};
N.createDiv = function (this: Node, o?: InfoArg, cb?: Cb<any>) {
  return attach(this, make("div", o, cb), o);
};
N.createSpan = function (this: Node, o?: InfoArg, cb?: Cb<any>) {
  return attach(this, make("span", o, cb), o);
};
N.createSvg = function (this: Node, tag: string, o?: InfoArg, cb?: Cb<any>) {
  return attach(this, makeSvg(tag, o, cb), o);
};
N.empty = function (this: Node) {
  while (this.firstChild) this.removeChild(this.firstChild);
};
N.detach = function (this: Node) {
  this.parentNode?.removeChild(this);
};
N.setChildrenInPlace = function (this: Node, children: Node[]) {
  (this as any).empty();
  for (const c of children) this.appendChild(c);
};
N.instanceOf = function (this: Node, type: any) {
  return this instanceof type;
};
Object.defineProperty(N, "doc", {
  get(this: Node) {
    return this.ownerDocument ?? document;
  },
});
Object.defineProperty(N, "win", {
  get() {
    return window;
  },
});

const E = Element.prototype as any;
E.setText = function (this: Element, t: string | DocumentFragment) {
  if (typeof t === "string") this.textContent = t;
  else {
    this.replaceChildren(t);
  }
};
E.appendText = function (this: Element, t: string) {
  this.appendChild(document.createTextNode(t));
};
E.addClass = function (this: Element, ...c: string[]) {
  this.classList.add(...c.flatMap((x) => x.split(" ")).filter(Boolean));
};
E.addClasses = function (this: Element, c: string[]) {
  this.classList.add(...c);
};
E.removeClass = function (this: Element, ...c: string[]) {
  this.classList.remove(...c.flatMap((x) => x.split(" ")).filter(Boolean));
};
E.removeClasses = function (this: Element, c: string[]) {
  this.classList.remove(...c);
};
E.toggleClass = function (this: Element, c: string | string[], on: boolean) {
  for (const x of Array.isArray(c) ? c : [c]) this.classList.toggle(x, on);
};
E.hasClass = function (this: Element, c: string) {
  return this.classList.contains(c);
};
E.setAttr = function (this: Element, k: string, v: string | number | boolean | null) {
  if (v === null || v === false) this.removeAttribute(k);
  else this.setAttribute(k, v === true ? "" : String(v));
};
E.setAttrs = function (this: Element, o: Record<string, any>) {
  for (const [k, v] of Object.entries(o)) (this as any).setAttr(k, v);
};
E.getAttr = function (this: Element, k: string) {
  return this.getAttribute(k);
};
E.matchParent = function (this: Element, sel: string, last?: Element) {
  const found = this.closest(sel);
  return found && found !== last && (!last || last.contains(found)) ? found : null;
};
E.find = function (this: Element, sel: string) {
  return this.querySelector(sel);
};
E.findAll = function (this: Element, sel: string) {
  return Array.from(this.querySelectorAll(sel));
};
E.getCssPropertyValue = function (this: Element, p: string) {
  return getComputedStyle(this).getPropertyValue(p);
};
E.isShown = function (this: HTMLElement) {
  return this.isConnected && this.style.display !== "none";
};
E.show = function (this: HTMLElement) {
  this.style.display = "";
};
E.hide = function (this: HTMLElement) {
  this.style.display = "none";
};
E.toggle = function (this: HTMLElement, show: boolean) {
  this.style.display = show ? "" : "none";
};
E.toggleVisibility = function (this: HTMLElement, v: boolean) {
  this.style.visibility = v ? "" : "hidden";
};
E.setCssStyles = function (this: HTMLElement, s: Record<string, string>) {
  Object.assign(this.style, s);
};
E.setCssProps = function (this: HTMLElement, s: Record<string, string>) {
  for (const [k, v] of Object.entries(s)) this.style.setProperty(k, v);
};
E.onClickEvent = function (this: HTMLElement, f: (e: MouseEvent) => void, opts?: any) {
  this.addEventListener("click", f, opts);
};
E.trigger = function (this: Element, type: string) {
  this.dispatchEvent(new Event(type));
};

const A = Array.prototype as any;
A.contains ??= function (this: unknown[], x: unknown) {
  return this.includes(x);
};
A.remove ??= function (this: unknown[], x: unknown) {
  const i = this.indexOf(x);
  if (i >= 0) this.splice(i, 1);
};
A.first ??= function (this: unknown[]) {
  return this[0];
};
A.last ??= function (this: unknown[]) {
  return this[this.length - 1];
};
A.unique ??= function (this: unknown[]) {
  return [...new Set(this)];
};
(String.prototype as any).contains ??= function (this: string, s: string) {
  return this.includes(s);
};
(Math as any).clamp ??= (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const G = globalThis as any;
G.createEl = (tag: any, o?: InfoArg, cb?: Cb<any>) => {
  const el = make(tag, o, cb);
  return el;
};
G.createDiv = (o?: InfoArg, cb?: Cb<any>) => make("div", o, cb);
G.createSpan = (o?: InfoArg, cb?: Cb<any>) => make("span", o, cb);
G.createSvg = (tag: string, o?: InfoArg, cb?: Cb<any>) => makeSvg(tag, o, cb);
G.createFragment = (cb?: Cb<DocumentFragment>) => {
  const f = document.createDocumentFragment();
  cb?.(f);
  return f;
};
G.activeDocument = document;
G.activeWindow = window;
G.sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
G.nextFrame = () => new Promise((r) => setTimeout(r, 16));

// ---------------------------------------------------------------------------
// Icons: Obsidian's bundled Lucide table, extracted by extract-obsidian.mjs
// and handed over by the gallery page before the bundle runs.

type IconNode = [number, ...Array<string | number>];
const custom = new Map<string, string>();

function iconSvg(name: string): SVGSVGElement | null {
  const key = name.replace(/^lucide-/, "");
  const svg = document.createElementNS(SVG_NS, "svg");
  const extra = custom.get(name);
  if (extra) {
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "100");
    svg.innerHTML = extra;
    svg.classList.add("svg-icon", name);
    return svg;
  }
  const table = (G.__galleryIcons ?? {}) as Record<string, IconNode[]>;
  const nodes = table[key];
  if (!nodes) return null;
  const attrs: Record<string, string> = {
    xmlns: SVG_NS,
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  svg.classList.add("svg-icon", `lucide-${key}`);
  for (const n of nodes) {
    const [t, ...a] = n;
    const shape: Array<[string, Record<string, unknown>]> = [
      ["line", { x1: a[0], y1: a[1], x2: a[2], y2: a[3] }],
      ["circle", { cx: a[0], cy: a[1], r: a[2] }],
      ["polyline", { points: a[0] }],
      ["polygon", { points: a[0] }],
      ["ellipse", { cx: a[0], cy: a[1], rx: a[2], ry: a[3] }],
      [
        "rect",
        { x: a[0], y: a[1], width: a[2], height: a[3], rx: a[4], ry: a[5], transform: a[6] },
      ],
      ["path", { d: a[0] }],
    ][t] as [string, Record<string, unknown>];
    const el = document.createElementNS(SVG_NS, shape[0]);
    for (const [k, v] of Object.entries(shape[1]))
      if (v !== undefined && v !== 0) el.setAttribute(k, String(v));
    if (shape[0] === "rect") {
      el.setAttribute("x", String(a[0]));
      el.setAttribute("y", String(a[1]));
    }
    svg.appendChild(el);
  }
  return svg;
}

export function setIcon(el: HTMLElement, name: string): void {
  el.replaceChildren();
  const svg = iconSvg(name);
  if (svg) el.appendChild(svg);
  else console.warn("[gallery] unknown icon", name);
}
export function getIcon(name: string): SVGSVGElement | null {
  return iconSvg(name);
}
export function getIconIds(): string[] {
  return [...Object.keys(G.__galleryIcons ?? {}), ...custom.keys()];
}
export function addIcon(name: string, svg: string): void {
  custom.set(name, svg);
}
export function setTooltip(el: HTMLElement, text: string): void {
  el.setAttribute("aria-label", text);
}

// ---------------------------------------------------------------------------
// Platform and small free functions.

export const Platform = {
  isDesktop: false,
  isMobile: true,
  isDesktopApp: false,
  isMobileApp: true,
  isIosApp: true,
  isAndroidApp: false,
  isPhone: false,
  isTablet: true,
  isMacOS: false,
  isWin: false,
  isLinux: false,
  isSafari: true,
  resourcePathPrefix: "",
};
/** The Obsidian the gallery pretends to be: the current public release. */
export const apiVersion = "1.13.7";
export function requireApiVersion(v: string): boolean {
  const a = v.split(".").map(Number);
  const b = apiVersion.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return true;
}
export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}
export function debounce<T extends (...a: any[]) => any>(fn: T, ms = 0): T {
  let t: number | undefined;
  return ((...a: any[]) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...a), ms);
  }) as T;
}
export function loadPdfJs(): Promise<unknown> {
  return Promise.reject(new Error("no pdf.js in the gallery"));
}
export function requestUrl(): Promise<never> {
  return Promise.reject(new Error("no network in the gallery"));
}
export type RequestUrlResponse = unknown;
export function moment(): unknown {
  return { format: () => "2026-09-25" };
}

// ---------------------------------------------------------------------------
// Component, Events and the vault types the views import.

export class Events {
  private handlers = new Map<string, Array<(...a: any[]) => void>>();
  on(name: string, cb: (...a: any[]) => void): { name: string } {
    const list = this.handlers.get(name) ?? [];
    list.push(cb);
    this.handlers.set(name, list);
    return { name };
  }
  off(): void {}
  offref(): void {}
  trigger(name: string, ...a: any[]): void {
    for (const cb of this.handlers.get(name) ?? []) cb(...a);
  }
}

export class Component {
  private cleanups: Array<() => void> = [];
  private children: Component[] = [];
  load(): void {
    (this as any).onload?.();
  }
  unload(): void {
    for (const c of this.children) c.unload();
    for (const f of this.cleanups.splice(0)) f();
    (this as any).onunload?.();
  }
  onload(): void {}
  onunload(): void {}
  addChild<T extends Component>(c: T): T {
    this.children.push(c);
    c.load();
    return c;
  }
  removeChild<T extends Component>(c: T): T {
    this.children.remove(c);
    c.unload();
    return c;
  }
  register(f: () => void): void {
    this.cleanups.push(f);
  }
  registerEvent(_ref: unknown): void {}
  registerDomEvent(el: EventTarget, type: string, cb: EventListener, opts?: any): void {
    el.addEventListener(type, cb, opts);
    this.register(() => el.removeEventListener(type, cb, opts));
  }
  registerInterval(id: number): number {
    this.register(() => window.clearInterval(id));
    return id;
  }
  registerScopeEvent(): void {}
}
export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
    super();
  }
}

export class TAbstractFile {
  name: string;
  parent: TFolder | null = null;
  constructor(public path: string) {
    this.name = path.split("/").pop() ?? path;
  }
}
export class TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat = { ctime: 0, mtime: 0, size: 0 };
  constructor(path: string) {
    super(path);
    const dot = this.name.lastIndexOf(".");
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
  }
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean {
    return this.path === "" || this.path === "/";
  }
}

// ---------------------------------------------------------------------------
// Markdown: a tiny renderer, enough for the changelog and help text.

function renderMarkdownInto(md: string, el: HTMLElement): void {
  const inline = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)_(.+?)_(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  let list = false;
  for (const line of md.split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!li && list) {
      out.push("</ul>");
      list = false;
    }
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (li) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  el.insertAdjacentHTML("beforeend", out.join(""));
}
export class MarkdownRenderer {
  static render(_app: unknown, md: string, el: HTMLElement): Promise<void> {
    renderMarkdownInto(md, el);
    return Promise.resolve();
  }
  static renderMarkdown(md: string, el: HTMLElement): Promise<void> {
    renderMarkdownInto(md, el);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Scope, Keymap: registered and ignored.

export class Scope {
  register(): unknown {
    return {};
  }
  unregister(): void {}
}
export const Keymap = { isModEvent: () => false, isModifier: () => false };

// ---------------------------------------------------------------------------
// Modal. The DOM is Obsidian's: container > bg + modal > close, header>title,
// content. `open()` mounts into the gallery's current frame, not <body>.

export function galleryMount(): HTMLElement {
  return (G.__galleryMount as HTMLElement | undefined) ?? document.body;
}

export class Modal {
  app: any;
  containerEl: HTMLElement;
  bgEl: HTMLElement;
  modalEl: HTMLElement;
  headerEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  scope = new Scope();
  shouldRestoreSelection = true;
  constructor(app: any) {
    this.app = app;
    this.containerEl = make("div", "modal-container mod-dim");
    this.bgEl = this.containerEl.createDiv("modal-bg");
    this.bgEl.style.opacity = "0.85";
    this.modalEl = this.containerEl.createDiv("modal");
    const close = this.modalEl.createDiv("modal-close-button mod-raised clickable-icon");
    setIcon(close, "x");
    close.addEventListener("click", () => this.close());
    this.headerEl = this.modalEl.createDiv("modal-header");
    this.titleEl = this.headerEl.createDiv("modal-title");
    this.contentEl = this.modalEl.createDiv("modal-content");
  }
  open(): void {
    galleryMount().appendChild(this.containerEl);
    G.__galleryModals = [...(G.__galleryModals ?? []), this];
    void (this as any).onOpen?.();
  }
  close(): void {
    (this as any).onClose?.();
    this.containerEl.remove();
  }
  onOpen(): void | Promise<void> {}
  onClose(): void {}
  setTitle(t: string): this {
    this.titleEl.setText(t);
    return this;
  }
  setContent(c: string | DocumentFragment): this {
    this.contentEl.setText(c);
    return this;
  }
}

export class SuggestModal<T> extends Modal {
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLElement;
  limit = 100;
  emptyStateText = "No results found.";
  constructor(app: any) {
    super(app);
    this.modalEl.addClass("prompt");
    this.modalEl.empty();
    const inputWrap = this.modalEl.createDiv("prompt-input-container");
    this.inputEl = inputWrap.createEl("input", { cls: "prompt-input", type: "text" });
    this.inputEl.addEventListener("input", () => this.renderResults());
    this.resultContainerEl = this.modalEl.createDiv("prompt-results");
  }
  setPlaceholder(p: string): void {
    this.inputEl.placeholder = p;
  }
  setInstructions(list: Array<{ command: string; purpose: string }>): void {
    const el = this.modalEl.createDiv("prompt-instructions");
    for (const i of list) {
      const row = el.createDiv("prompt-instruction");
      row.createSpan({ cls: "prompt-instruction-command", text: i.command });
      row.createSpan({ text: i.purpose });
    }
  }
  override open(): void {
    super.open();
    this.renderResults();
  }
  protected renderResults(): void {
    const items = (this as any).getSuggestions?.(this.inputEl.value) as T[] | Promise<T[]>;
    void Promise.resolve(items).then((list) => {
      this.resultContainerEl.empty();
      if (!list || list.length === 0) {
        this.resultContainerEl.createDiv({ cls: "suggestion-empty", text: this.emptyStateText });
        return;
      }
      list.slice(0, this.limit).forEach((item, i) => {
        const el = this.resultContainerEl.createDiv("suggestion-item");
        if (i === 0) el.addClass("is-selected");
        (this as any).renderSuggestion?.(item, el);
      });
    });
  }
}

export class FuzzySuggestModal<T> extends SuggestModal<{ item: T; match: unknown }> {
  getSuggestions(q: string): Array<{ item: T; match: unknown }> {
    const items = ((this as any).getItems?.() ?? []) as T[];
    const text = (x: T): string => (this as any).getItemText?.(x) ?? String(x);
    return items
      .filter((x) => text(x).toLowerCase().includes(q.toLowerCase()))
      .map((item) => ({ item, match: { score: 0, matches: [] } }));
  }
  renderSuggestion(v: { item: T }, el: HTMLElement): void {
    el.setText((this as any).getItemText?.(v.item) ?? String(v.item));
  }
  onChooseSuggestion(v: { item: T }, e: Event): void {
    (this as any).onChooseItem?.(v.item, e);
  }
}

export class AbstractInputSuggest<T> {
  limit = 100;
  constructor(
    public app: any,
    public inputEl: HTMLInputElement,
  ) {}
  getSuggestions(_q: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(_v: T, _el: HTMLElement): void {}
  selectSuggestion(_v: T, _e: Event): void {}
  onSelect(cb: (v: T, e: Event) => void): this {
    void cb;
    return this;
  }
  setValue(v: string): void {
    this.inputEl.value = v;
  }
  getValue(): string {
    return this.inputEl.value;
  }
  close(): void {}
  open(): void {}
}

// ---------------------------------------------------------------------------
// Menu: `.menu > .menu-grabber + .menu-scroll > [.menu-group >] .menu-item`.

export class MenuItem {
  dom: HTMLElement;
  iconEl: HTMLElement;
  titleEl: HTMLElement;
  section = "";
  private callback: ((e: Event) => void) | null = null;
  constructor(private menu: Menu) {
    this.dom = make("div", "menu-item tappable");
    this.iconEl = this.dom.createDiv("menu-item-icon");
    this.titleEl = this.dom.createDiv("menu-item-title");
    this.dom.addEventListener("click", (e) => {
      this.callback?.(e);
      this.menu.hide();
    });
  }
  setTitle(t: string | DocumentFragment): this {
    this.titleEl.setText(t);
    return this;
  }
  setIcon(name: string | null): this {
    if (name) setIcon(this.iconEl, name);
    else this.iconEl.empty();
    return this;
  }
  setChecked(on: boolean | null): this {
    if (on) {
      const check = this.dom.createDiv("menu-item-icon mod-checked");
      setIcon(check, "check");
      this.dom.addClass("mod-selected");
    }
    return this;
  }
  setActive(on: boolean): this {
    return this.setChecked(on);
  }
  setDisabled(on: boolean): this {
    this.dom.toggleClass("is-disabled", on);
    return this;
  }
  setIsLabel(on: boolean): this {
    this.dom.toggleClass("is-label", on);
    return this;
  }
  setWarning(on: boolean): this {
    this.dom.toggleClass("is-warning", on);
    return this;
  }
  setDestructive(on: boolean): this {
    return this.setWarning(on);
  }
  setSection(s: string): this {
    this.section = s;
    this.dom.setAttribute("data-section", s);
    return this;
  }
  setSubmenu(): Menu {
    return new Menu();
  }
  onClick(cb: (e: Event) => void): this {
    this.callback = cb;
    return this;
  }
}

export class Menu extends Component {
  dom: HTMLElement;
  scrollEl: HTMLElement;
  private items: Array<MenuItem | "separator"> = [];
  private hideCallbacks: Array<() => void> = [];
  constructor() {
    super();
    this.dom = make("div", "menu");
    this.dom.createDiv("menu-grabber");
    this.scrollEl = this.dom.createDiv("menu-scroll");
  }
  addItem(cb: (item: MenuItem) => void): this {
    const item = new MenuItem(this);
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this {
    this.items.push("separator");
    return this;
  }
  setNoIcon(): this {
    this.dom.addClass("mod-no-icon");
    return this;
  }
  setUseNativeMenu(): this {
    return this;
  }
  private build(): void {
    this.scrollEl.empty();
    let group: HTMLElement | null = null;
    let section: string | null = null;
    for (const it of this.items) {
      if (it === "separator") {
        this.scrollEl.createDiv("menu-separator");
        group = null;
        continue;
      }
      if (!group || it.section !== section) {
        if (group) this.scrollEl.createDiv("menu-separator");
        group = this.scrollEl.createDiv("menu-group");
        section = it.section;
      }
      group.appendChild(it.dom);
    }
  }
  showAtPosition(pos: { x: number; y: number; width?: number; left?: boolean }): this {
    this.build();
    const mount = galleryMount();
    const box = mount.getBoundingClientRect();
    this.dom.style.left = `${pos.x - box.left}px`;
    this.dom.style.top = `${pos.y - box.top}px`;
    mount.appendChild(this.dom);
    G.__galleryMenus = [...(G.__galleryMenus ?? []), this];
    return this;
  }
  showAtMouseEvent(e: MouseEvent): this {
    return this.showAtPosition({ x: e.clientX, y: e.clientY });
  }
  hide(): this {
    this.dom.remove();
    for (const f of this.hideCallbacks) f();
    return this;
  }
  close(): void {
    this.hide();
  }
  onHide(cb: () => void): void {
    this.hideCallbacks.push(cb);
  }
}

// ---------------------------------------------------------------------------
// Notice: `.notice-container > .notice > .notice-message`, in the frame.

export class Notice {
  noticeEl: HTMLElement;
  messageEl: HTMLElement;
  containerEl: HTMLElement;
  constructor(message: string | DocumentFragment, _timeout?: number) {
    const mount = galleryMount();
    let box = mount.querySelector<HTMLElement>(":scope > .notice-container");
    if (!box) box = mount.createDiv("notice-container");
    this.containerEl = box.createDiv("notice");
    this.messageEl = this.noticeEl = this.containerEl.createDiv("notice-message");
    this.messageEl.setText(message);
  }
  setMessage(m: string | DocumentFragment): this {
    this.messageEl.setText(m);
    return this;
  }
  hide(): void {
    this.containerEl.remove();
  }
}

// ---------------------------------------------------------------------------
// Setting and its components.

class BaseComponent {
  disabled = false;
  setDisabled(d: boolean): this {
    this.disabled = d;
    return this;
  }
  then(cb: (c: this) => void): this {
    cb(this);
    return this;
  }
}

class ValueComponent<T> extends BaseComponent {
  protected cb: ((v: T) => void) | null = null;
  onChange(cb: (v: T) => void): this {
    this.cb = cb;
    return this;
  }
  registerOptionListener(): this {
    return this;
  }
}

export class TextComponent extends ValueComponent<string> {
  inputEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    super();
    this.inputEl = parent.createEl("input", { type: "text", attr: { spellcheck: "false" } });
    this.inputEl.addEventListener("input", () => this.cb?.(this.inputEl.value));
  }
  setPlaceholder(p: string): this {
    this.inputEl.placeholder = p;
    return this;
  }
  setValue(v: string): this {
    this.inputEl.value = v;
    return this;
  }
  getValue(): string {
    return this.inputEl.value;
  }
  override setDisabled(d: boolean): this {
    this.inputEl.disabled = d;
    return super.setDisabled(d);
  }
}
export class SearchComponent extends TextComponent {
  constructor(parent: HTMLElement) {
    const wrap = parent.createDiv("search-input-container");
    super(wrap);
    this.inputEl.type = "search";
  }
}
export class TextAreaComponent extends ValueComponent<string> {
  inputEl: HTMLTextAreaElement;
  constructor(parent: HTMLElement) {
    super();
    this.inputEl = parent.createEl("textarea");
    this.inputEl.addEventListener("input", () => this.cb?.(this.inputEl.value));
  }
  setPlaceholder(p: string): this {
    this.inputEl.placeholder = p;
    return this;
  }
  setValue(v: string): this {
    this.inputEl.value = v;
    return this;
  }
  getValue(): string {
    return this.inputEl.value;
  }
}
export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement;
  private on = false;
  constructor(parent: HTMLElement) {
    super();
    this.toggleEl = parent.createEl("label", { cls: "checkbox-container", attr: { tabindex: 0 } });
    this.toggleEl.createEl("input", { type: "checkbox", attr: { tabindex: 0 } });
    this.toggleEl.addEventListener("click", (e) => {
      e.preventDefault();
      this.setValue(!this.on);
    });
  }
  getValue(): boolean {
    return this.on;
  }
  setValue(v: boolean): this {
    if (this.on !== v) {
      this.on = v;
      this.toggleEl.toggleClass("is-enabled", v);
      this.cb?.(v);
    }
    return this;
  }
  setTooltip(t: string): this {
    setTooltip(this.toggleEl, t);
    return this;
  }
  override setDisabled(d: boolean): this {
    this.toggleEl.toggleClass("is-disabled", d);
    return super.setDisabled(d);
  }
}
export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) {
    super();
    this.selectEl = parent.createEl("select", "dropdown");
    this.selectEl.addEventListener("change", () => this.cb?.(this.selectEl.value));
  }
  addOption(v: string, label: string): this {
    this.selectEl.createEl("option", { value: v, text: label });
    return this;
  }
  addOptions(o: Record<string, string>): this {
    for (const [v, l] of Object.entries(o)) this.addOption(v, l);
    return this;
  }
  setValue(v: string): this {
    this.selectEl.value = v;
    return this;
  }
  getValue(): string {
    return this.selectEl.value;
  }
  override setDisabled(d: boolean): this {
    this.selectEl.disabled = d;
    return super.setDisabled(d);
  }
}
export class SliderComponent extends ValueComponent<number> {
  sliderEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    super();
    this.sliderEl = parent.createEl("input", { type: "range", cls: "slider" });
    this.sliderEl.addEventListener("input", () => this.cb?.(Number(this.sliderEl.value)));
  }
  setLimits(min: number | null, max: number | null, step: number | "any"): this {
    if (min !== null) this.sliderEl.min = String(min);
    if (max !== null) this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }
  setValue(v: number): this {
    this.sliderEl.value = String(v);
    return this;
  }
  getValue(): number {
    return Number(this.sliderEl.value);
  }
  setDynamicTooltip(): this {
    return this;
  }
  setInstant(): this {
    return this;
  }
  showTooltip(): void {}
}
export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;
  private cb: ((e: MouseEvent) => void) | null = null;
  constructor(parent: HTMLElement) {
    super();
    this.buttonEl = parent.createEl("button");
    this.buttonEl.addEventListener("click", (e) => this.cb?.(e));
  }
  setButtonText(t: string): this {
    this.buttonEl.setText(t);
    return this;
  }
  setIcon(name: string): this {
    setIcon(this.buttonEl, name);
    return this;
  }
  setTooltip(t: string): this {
    setTooltip(this.buttonEl, t);
    return this;
  }
  setCta(): this {
    this.buttonEl.addClass("mod-cta");
    return this;
  }
  removeCta(): this {
    this.buttonEl.removeClass("mod-cta");
    return this;
  }
  setWarning(): this {
    this.buttonEl.addClass("mod-warning");
    return this;
  }
  setDestructive(): this {
    return this.setWarning();
  }
  setClass(c: string): this {
    this.buttonEl.addClass(c);
    return this;
  }
  override setDisabled(d: boolean): this {
    this.buttonEl.disabled = d;
    return super.setDisabled(d);
  }
  onClick(cb: (e: MouseEvent) => void): this {
    this.cb = cb;
    return this;
  }
}
export class ExtraButtonComponent extends BaseComponent {
  extraSettingsEl: HTMLElement;
  private cb: (() => void) | null = null;
  constructor(parent: HTMLElement) {
    super();
    this.extraSettingsEl = parent.createDiv("clickable-icon extra-setting-button");
    setIcon(this.extraSettingsEl, "settings");
    this.extraSettingsEl.addEventListener("click", () => this.cb?.());
  }
  setIcon(name: string): this {
    setIcon(this.extraSettingsEl, name);
    return this;
  }
  setTooltip(t: string): this {
    setTooltip(this.extraSettingsEl, t);
    return this;
  }
  onClick(cb: () => void): this {
    this.cb = cb;
    return this;
  }
}
export class ColorComponent extends ValueComponent<string> {
  colorPickerEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    super();
    this.colorPickerEl = parent.createEl("input", { type: "color" });
  }
  setValue(v: string): this {
    this.colorPickerEl.value = v;
    return this;
  }
  getValue(): string {
    return this.colorPickerEl.value;
  }
}
export class ProgressBarComponent extends BaseComponent {
  private lineEl: HTMLElement;
  constructor(parent: HTMLElement) {
    super();
    const bar = parent.createDiv("setting-progress-bar");
    this.lineEl = bar.createDiv("setting-progress-bar-inner");
  }
  setValue(v: number): this {
    this.lineEl.style.width = `${Math.clamp(v, 0, 100)}%`;
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: BaseComponent[] = [];
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv("setting-item");
    this.infoEl = this.settingEl.createDiv("setting-item-info");
    this.nameEl = this.infoEl.createDiv("setting-item-name");
    this.descEl = this.infoEl.createDiv("setting-item-description");
    this.controlEl = this.settingEl.createDiv("setting-item-control");
  }
  setName(n: string | DocumentFragment): this {
    this.nameEl.setText(n);
    return this;
  }
  setDesc(d: string | DocumentFragment): this {
    this.descEl.setText(d);
    return this;
  }
  setClass(c: string): this {
    this.settingEl.addClass(c);
    return this;
  }
  setTooltip(t: string): this {
    setTooltip(this.nameEl, t);
    return this;
  }
  setHeading(): this {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }
  setDisabled(d: boolean): this {
    this.settingEl.toggleClass("is-disabled", d);
    return this;
  }
  private add<T extends BaseComponent>(c: T, cb?: (c: T) => unknown): this {
    this.components.push(c);
    cb?.(c);
    return this;
  }
  addText(cb: (c: TextComponent) => unknown): this {
    return this.add(new TextComponent(this.controlEl), cb);
  }
  addSearch(cb: (c: SearchComponent) => unknown): this {
    return this.add(new SearchComponent(this.controlEl), cb);
  }
  addTextArea(cb: (c: TextAreaComponent) => unknown): this {
    return this.add(new TextAreaComponent(this.controlEl), cb);
  }
  addToggle(cb: (c: ToggleComponent) => unknown): this {
    this.settingEl.addClass("mod-toggle");
    return this.add(new ToggleComponent(this.controlEl), cb);
  }
  addDropdown(cb: (c: DropdownComponent) => unknown): this {
    return this.add(new DropdownComponent(this.controlEl), cb);
  }
  addSlider(cb: (c: SliderComponent) => unknown): this {
    return this.add(new SliderComponent(this.controlEl), cb);
  }
  addButton(cb: (c: ButtonComponent) => unknown): this {
    return this.add(new ButtonComponent(this.controlEl), cb);
  }
  addExtraButton(cb: (c: ExtraButtonComponent) => unknown): this {
    return this.add(new ExtraButtonComponent(this.controlEl), cb);
  }
  addColorPicker(cb: (c: ColorComponent) => unknown): this {
    return this.add(new ColorComponent(this.controlEl), cb);
  }
  addProgressBar(cb: (c: ProgressBarComponent) => unknown): this {
    return this.add(new ProgressBarComponent(this.controlEl), cb);
  }
  then(cb: (s: this) => void): this {
    cb(this);
    return this;
  }
}
export type SettingDefinitionItem = unknown;
export type SettingDefinition = unknown;

// ---------------------------------------------------------------------------
// Plugin, views and workspace types: enough to import the modules that
// declare them. The gallery never runs the plugin itself.

export class Plugin extends Component {
  manifest = { id: "finenotes", name: "FineNotes", version: "0.0.0", dir: "" };
  constructor(public app: any) {
    super();
  }
  loadData(): Promise<unknown> {
    return Promise.resolve(null);
  }
  saveData(): Promise<void> {
    return Promise.resolve();
  }
  addCommand(): void {}
  addRibbonIcon(): HTMLElement {
    return make("div");
  }
  addSettingTab(): void {}
  addStatusBarItem(): HTMLElement {
    return make("div");
  }
  registerView(): void {}
  registerExtensions(): void {}
  registerMarkdownPostProcessor(): void {}
  registerMarkdownCodeBlockProcessor(): void {}
  registerObsidianProtocolHandler(): void {}
}
/** Obsidian 1.13's SettingGroup: an optional heading row, then the rows in `.setting-items`. */
export class SettingGroup {
  groupEl: HTMLElement;
  listEl: HTMLElement;
  private headerEl: HTMLElement;
  constructor(parent: HTMLElement) {
    this.groupEl = parent.createDiv("setting-group");
    this.headerEl = make("div", "setting-item setting-item-heading");
    this.headerEl.createDiv("setting-item-name");
    this.headerEl.createDiv("setting-item-control");
    this.listEl = this.groupEl.createDiv("setting-items");
  }
  setHeading(text: string): this {
    (this.headerEl.firstElementChild as HTMLElement).setText(text);
    if (text) this.groupEl.prepend(this.headerEl);
    else this.headerEl.detach();
    return this;
  }
  addClass(...classes: string[]): this {
    this.groupEl.addClass(...classes);
    return this;
  }
  addSetting(build: (setting: Setting) => void): this {
    build(new Setting(this.listEl));
    return this;
  }
}

// ---------------------------------------------------------------------------
// Settings tabs as Obsidian 1.13 draws them from `getSettingDefinitions()`:
// each group (and each run of rows outside one) becomes a `.setting-group`,
// each row a `Setting`, and `visible` is re-read on `refreshDomState()`.
// Enough of Obsidian's renderer for the plugin's own tab; pages, lists,
// search and validation are left out.

type Shown = boolean | (() => boolean) | undefined;
const isShown = (v: Shown): boolean => (v === undefined ? true : typeof v === "function" ? v() : v);

function addControl(tab: PluginSettingTab, setting: Setting, control: any): void {
  const value = tab.getControlValue(control.key) ?? control.defaultValue;
  const onChange = async (v: unknown): Promise<void> => {
    await tab.setControlValue(control.key, v);
    tab.refreshDomState();
  };
  switch (control.type) {
    case "toggle":
      setting.addToggle((c) => c.setValue(Boolean(value)).onChange(onChange));
      break;
    case "dropdown":
      setting.addDropdown((c) => c.addOptions(control.options).setValue(value).onChange(onChange));
      break;
    case "text":
    case "folder":
    case "file":
      setting.addText((c) => {
        if (control.placeholder) c.setPlaceholder(control.placeholder);
        c.setValue(value ?? "").onChange(onChange);
      });
      break;
    case "textarea":
      setting.addTextArea((c) => {
        if (control.placeholder) c.setPlaceholder(control.placeholder);
        c.setValue(value ?? "").onChange(onChange);
      });
      break;
    case "slider":
      setting.addSlider((c) =>
        c.setLimits(control.min, control.max, control.step).setValue(value).onChange(onChange),
      );
      break;
    case "color":
      setting.addColorPicker((c) => c.setValue(value).onChange(onChange));
      break;
  }
}

function renderDefinitions(tab: PluginSettingTab): () => void {
  const root = tab.containerEl;
  root.empty();
  const groups: any[] = [];
  let loose: any[] | null = null;
  for (const item of tab.settingItems as any[]) {
    if (item.type === "group" || item.type === "list") {
      groups.push(item);
      loose = null;
    } else {
      if (!loose) groups.push({ type: "group", items: (loose = []) });
      loose.push(item);
    }
  }
  const refreshers: Array<() => void> = [];
  for (const def of groups) {
    const group = new SettingGroup(root);
    if (def.heading) group.setHeading(def.heading);
    if (def.cls) group.addClass(...String(def.cls).split(" "));
    const rows: Array<{ item: any; setting: Setting }> = [];
    for (const item of def.items ?? []) {
      if (!(item.name || item.render || item.control || item.action)) continue;
      const setting = new Setting(group.listEl);
      setting.setName(item.name ?? "");
      if (item.desc) setting.setDesc(item.desc);
      if (item.render) item.render(setting, group);
      else if (item.control) addControl(tab, setting, item.control);
      rows.push({ item, setting });
    }
    refreshers.push(() => {
      let any = rows.length === 0;
      for (const { item, setting } of rows) {
        const shown = isShown(item.visible);
        setting.settingEl.toggle(shown);
        any ||= shown;
      }
      group.groupEl.toggle(isShown(def.visible) && any);
    });
  }
  const refresh = (): void => refreshers.forEach((f) => f());
  refresh();
  return refresh;
}

export class PluginSettingTab {
  containerEl: HTMLElement;
  settingItems: unknown[] = [];
  private refreshRows: (() => void) | null = null;
  constructor(
    public app: any,
    public plugin: any,
  ) {
    this.containerEl = make("div", "vertical-tab-content");
  }
  getSettingDefinitions(): unknown[] {
    return [];
  }
  getControlValue(key: string): unknown {
    return this.plugin?.settings?.[key];
  }
  setControlValue(key: string, value: unknown): void | Promise<void> {
    this.plugin.settings[key] = value;
  }
  /** Draw the tab from its definitions, as Obsidian does when it opens one that has them. */
  display(): void {
    this.settingItems = this.getSettingDefinitions();
    this.refreshRows = renderDefinitions(this);
  }
  update(): void {
    this.settingItems = this.getSettingDefinitions();
    if (this.containerEl.isConnected) this.refreshRows = renderDefinitions(this);
  }
  refreshDomState(): void {
    this.refreshRows?.();
  }
  hide(): void {}
}
export class View extends Component {
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  app: any;
  icon = "";
  navigation = true;
  constructor(public leaf: any) {
    super();
    this.app = leaf?.app;
    this.containerEl = make("div", "workspace-leaf-content");
    const header = this.containerEl.createDiv("view-header");
    header.createDiv("view-header-title-container");
    this.contentEl = this.containerEl.createDiv("view-content");
  }
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  addAction(icon: string, title: string, cb: () => void): HTMLElement {
    const el = make("a", { cls: "view-action clickable-icon", attr: { "aria-label": title } });
    setIcon(el, icon);
    el.addEventListener("click", cb);
    return el;
  }
}
export class ItemView extends View {}
export class FileView extends ItemView {
  file: TFile | null = null;
}
export class TextFileView extends FileView {
  data = "";
  requestSave = (): void => undefined;
}
export class MarkdownView extends TextFileView {}
export class WorkspaceLeaf {
  view: unknown = null;
  constructor(public app: any) {}
}
export type ViewState = unknown;
export type Editor = unknown;
export type MarkdownPostProcessorContext = unknown;
export type App = any;
