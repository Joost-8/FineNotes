/**
 * A small stand-in for the DOM, just big enough for the Folders sidebar's
 * views to draw into under Node: elements that remember their classes,
 * attributes, text and children, answer the few selectors the views use, and
 * carry Obsidian's `createDiv`, `createEl`, `empty` and `addClass` helpers.
 *
 * Not a browser: nothing is laid out, and events are only delivered when a
 * test dispatches them.
 */

interface ElInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  type?: string;
}

type Listener = (event: StubEvent) => void;

export interface StubEvent {
  type: string;
  target?: unknown;
  defaultPrevented?: boolean;
  [key: string]: unknown;
}

/** One compound selector: `div.a.b[data-x="y"]`. */
interface Compound {
  tag: string | null;
  classes: string[];
  attrs: { name: string; value: string | null }[];
}

function parseCompound(text: string): Compound {
  const compound: Compound = { tag: null, classes: [], attrs: [] };
  const tag = /^[a-zA-Z][\w-]*/.exec(text);
  let rest = text;
  if (tag) {
    compound.tag = tag[0].toLowerCase();
    rest = text.slice(tag[0].length);
  }
  const part = /\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  for (let m = part.exec(rest); m; m = part.exec(rest)) {
    if (m[1] !== undefined) compound.classes.push(m[1]);
    else compound.attrs.push({ name: m[2] as string, value: m[3] ?? m[4] ?? m[5] ?? null });
  }
  return compound;
}

function parseSelector(selector: string): Compound[][] {
  return selector.split(",").map((one) =>
    one
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((compound) => parseCompound(compound)),
  );
}

export class StubEl {
  readonly children: StubEl[] = [];
  /** Children and text, in order. */
  private nodes: (StubEl | string)[] = [];
  readonly nodeType = 1;
  parentElement: StubEl | null = null;
  readonly classes = new Set<string>();
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly styles: Record<string, string> = {};
  tag: string;
  value = "";
  draggable = false;
  scrollTop = 0;
  scrollLeft = 0;
  scrollWidth = 0;
  clientWidth = 0;
  clientHeight = 0;
  scrollHeight = 0;
  focused = false;

  constructor(tag = "div", info: ElInfo | string = {}) {
    this.tag = tag;
    const options = typeof info === "string" ? { cls: info } : info;
    const cls = options.cls;
    for (const name of (Array.isArray(cls) ? cls : (cls ?? "").split(/\s+/)).filter(Boolean)) {
      this.classes.add(name);
    }
    if (options.text !== undefined) this.nodes.push(options.text);
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      if (value !== null && value !== false) this.attrs.set(name, String(value));
    }
    if (options.type) this.attrs.set("type", options.type);
  }

  get textContent(): string {
    return this.nodes.map((node) => (typeof node === "string" ? node : node.textContent)).join("");
  }

  set textContent(text: string) {
    this.empty();
    if (text) this.nodes.push(text);
  }

  get tagName(): string {
    return this.tag.toUpperCase();
  }

  get nodeName(): string {
    return this.tagName;
  }

  get childNodes(): (StubEl | string)[] {
    return this.nodes;
  }

  getAttributeNames(): string[] {
    return [...this.attrs.keys()];
  }

  get isConnected(): boolean {
    return this.root().attached;
  }

  /** The root of the tree this element is in. */
  private root(): StubEl {
    return this.lineage().at(-1) as StubEl;
  }

  /** This element, then each ancestor up to the root. */
  private lineage(): StubEl[] {
    const chain: StubEl[] = [this];
    for (let up = this.parentElement; up; up = up.parentElement) chain.push(up);
    return chain;
  }

  attached = false;

  get classList() {
    return {
      contains: (name: string) => this.classes.has(name),
      remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
      add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    };
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get style() {
    return { setProperty: (name: string, value: string) => (this.styles[name] = value) };
  }

  // --- Obsidian's helpers ---

  createEl(tag: string, info: ElInfo | string = {}): StubEl {
    const child = new StubEl(tag, info);
    this.appendChild(child);
    return child;
  }

  createDiv(info: ElInfo | string = {}): StubEl {
    return this.createEl("div", info);
  }

  createSpan(info: ElInfo | string = {}): StubEl {
    return this.createEl("span", info);
  }

  empty(): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.nodes = [];
  }

  addClass(...names: string[]): void {
    for (const name of names) this.classes.add(name);
  }

  removeClass(...names: string[]): void {
    for (const name of names) this.classes.delete(name);
  }

  toggleClass(name: string | string[], on: boolean): void {
    for (const each of Array.isArray(name) ? name : [name]) {
      if (on) this.classes.add(each);
      else this.classes.delete(each);
    }
  }

  hasClass(name: string): boolean {
    return this.classes.has(name);
  }

  setText(text: string): void {
    this.textContent = text;
  }

  appendText(text: string): void {
    this.nodes.push(text);
  }

  setCssProps(props: Record<string, string>): void {
    Object.assign(this.styles, props);
  }

  setCssStyles(props: Record<string, string>): void {
    Object.assign(this.styles, props);
  }

  // --- DOM ---

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  appendChild<T extends StubEl>(child: T): T {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    this.nodes.push(child);
    return child;
  }

  append(...nodes: StubEl[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  remove(): void {
    if (!this.parentElement) return;
    const at = this.parentElement.children.indexOf(this);
    if (at >= 0) this.parentElement.children.splice(at, 1);
    const node = this.parentElement.nodes.indexOf(this);
    if (node >= 0) this.parentElement.nodes.splice(node, 1);
    this.parentElement = null;
  }

  replaceWith(other: StubEl): void {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1, other);
    parent.nodes.splice(parent.nodes.indexOf(this), 1, other);
    other.parentElement = parent;
    this.parentElement = null;
  }

  cloneNode(): StubEl {
    const copy = new StubEl(this.tag);
    for (const name of this.classes) copy.classes.add(name);
    for (const [name, value] of this.attrs) copy.attrs.set(name, value);
    for (const node of this.nodes) {
      if (typeof node === "string") copy.appendText(node);
      else copy.appendChild(node.cloneNode());
    }
    return copy;
  }

  contains(other: unknown): boolean {
    for (let el = other instanceof StubEl ? other : null; el; el = el.parentElement) {
      if (el === this) return true;
    }
    return false;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((each) => each !== listener),
    );
  }

  /** Deliver an event here and to every ancestor, as a bubbling event would. */
  dispatch(type: string, init: Record<string, unknown> = {}): StubEvent {
    const event: StubEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...init,
    };
    for (const el of this.lineage()) {
      for (const listener of el.listeners.get(type) ?? []) listener(event);
    }
    return event;
  }

  click(): void {
    this.dispatch("click");
  }

  focus(): void {
    this.focused = true;
  }

  select(): void {}

  scrollIntoView(): void {}

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  matches(selector: string): boolean {
    return parseSelector(selector).some((chain) => this.matchesChain(chain));
  }

  closest(selector: string): StubEl | null {
    return this.lineage().find((el) => el.matches(selector)) ?? null;
  }

  private matchesCompound(compound: Compound): boolean {
    if (compound.tag && compound.tag !== this.tag) return false;
    if (!compound.classes.every((name) => this.classes.has(name))) return false;
    return compound.attrs.every(({ name, value }) => {
      const actual = this.attrs.get(name);
      return value === null ? actual !== undefined : actual === value;
    });
  }

  private matchesChain(chain: Compound[]): boolean {
    const last = chain[chain.length - 1];
    if (!last || !this.matchesCompound(last)) return false;
    let at: StubEl | null = this.parentElement;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (at && !at.matchesCompound(chain[i] as Compound)) at = at.parentElement;
      if (!at) return false;
      at = at.parentElement;
    }
    return true;
  }

  querySelectorAll(selector: string): StubEl[] {
    const chains = parseSelector(selector);
    const found: StubEl[] = [];
    const walk = (el: StubEl): void => {
      for (const child of el.children) {
        if (chains.some((chain) => child.matchesChain(chain))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector: string): StubEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** What Chromium does when `createDiv` and the like are called on a Document. */
function documentRefuses(): never {
  throw new Error("HierarchyRequestError: Only one element on document allowed.");
}

/** The globals Obsidian gives a plugin that the views reach for, as stand-ins. */
export function installDomGlobals(
  stub: (name: string, value: unknown) => void,
  opts: { hidden?: boolean } = {},
): { document: StubEl & { hidden: boolean } } {
  const body = new StubEl("body");
  body.attached = true;
  const doc = Object.assign(new StubEl("#document"), { hidden: opts.hidden ?? false, body });
  doc.attached = true;
  const win = Object.assign(Object.create(globalThis) as object, {
    devicePixelRatio: 1,
    innerHeight: 800,
    scrollY: 0,
    visualViewport: null,
    getComputedStyle: () => ({ overflowY: "visible" }),
  });
  // The window's own, so `crypto.subtle` is reached with the right `this`.
  Object.defineProperty(win, "crypto", { value: globalThis.crypto });
  class Observer {
    constructor(public callback: unknown) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  stub(
    "activeDocument",
    Object.assign(doc, {
      // Obsidian's helpers append to what they are called on, and a Document takes one root.
      createDiv: documentRefuses,
      createEl: documentRefuses,
      createSpan: documentRefuses,
      createElement: (tag: string) => new StubEl(tag),
      elementFromPoint: () => null,
      querySelector: (selector: string) => body.querySelector(selector),
      querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    }),
  );
  stub("activeWindow", win);
  stub("window", win);
  stub("createDiv", (info?: ElInfo) => new StubEl("div", info));
  stub("createEl", (tag: string, info?: ElInfo) => new StubEl(tag, info));
  stub("createSpan", (info?: ElInfo) => new StubEl("span", info));
  stub("ResizeObserver", Observer);
  stub("IntersectionObserver", Observer);
  stub("HTMLElement", StubEl);
  stub("Element", StubEl);
  stub("MouseEvent", class MouseEventStub {});
  return { document: doc as unknown as StubEl & { hidden: boolean } };
}
