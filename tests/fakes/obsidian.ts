/**
 * Just enough of `obsidian` for the settings tab and the small dialogs to run
 * under Node: elements that remember what was built into them, components
 * that hand their handlers back to the test, and a `Modal` whose open/close
 * call the hooks as Obsidian does. Tests load it with
 * `vi.mock("obsidian", () => import("../fakes/obsidian"))`.
 */

type ElInfo = string | { cls?: string; text?: string; href?: string; type?: string };

export class FakeEl {
  readonly tag: string;
  readonly classes = new Set<string>();
  readonly children: FakeEl[] = [];
  text = "";
  href = "";
  hidden = false;

  constructor(tag = "div", info?: ElInfo) {
    this.tag = tag;
    if (typeof info === "string") this.addClass(...info.split(" "));
    else if (info) {
      if (info.cls) this.addClass(...info.cls.split(" "));
      if (info.text !== undefined) this.text = info.text;
      if (info.href !== undefined) this.href = info.href;
    }
  }

  createEl(tag: string, info?: ElInfo): FakeEl {
    const child = new FakeEl(tag, info);
    this.children.push(child);
    return child;
  }
  createDiv(info?: ElInfo): FakeEl {
    return this.createEl("div", info);
  }
  createSpan(info?: ElInfo): FakeEl {
    return this.createEl("span", info);
  }
  appendText(text: string): void {
    this.children.push(new FakeEl("#text", { text }));
  }
  setText(text: string): void {
    this.children.length = 0;
    this.text = text;
  }
  empty(): void {
    this.children.length = 0;
    this.text = "";
  }
  addClass(...names: string[]): void {
    for (const name of names) if (name) this.classes.add(name);
  }
  removeClass(...names: string[]): void {
    for (const name of names) this.classes.delete(name);
  }
  toggleClass(name: string, on: boolean): void {
    if (on) this.classes.add(name);
    else this.classes.delete(name);
  }
  hasClass(name: string): boolean {
    return this.classes.has(name);
  }
  toggle(show: boolean): void {
    this.hidden = !show;
  }

  /** All text below this element, in document order. */
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  /** Every descendant carrying `cls`, depth first. */
  findAll(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const child of this.children) {
      if (child.hasClass(cls)) out.push(child);
      out.push(...child.findAll(cls));
    }
    return out;
  }
  find(cls: string): FakeEl | undefined {
    return this.findAll(cls)[0];
  }
}

// --- Components -------------------------------------------------------------

export class TextComponent {
  readonly inputEl = new FakeEl("input");
  value = "";
  placeholder = "";
  private handler: ((value: string) => unknown) | null = null;
  setValue(value: string): this {
    this.value = value;
    return this;
  }
  getValue(): string {
    return this.value;
  }
  setPlaceholder(text: string): this {
    this.placeholder = text;
    return this;
  }
  onChange(handler: (value: string) => unknown): this {
    this.handler = handler;
    return this;
  }
  /** What a user typing `value` would cause. */
  async type(value: string): Promise<void> {
    this.value = value;
    await this.handler?.(value);
  }
}

export class ButtonComponent {
  readonly buttonEl = new FakeEl("button");
  text = "";
  cta = false;
  warning = false;
  private handler: (() => unknown) | null = null;
  setButtonText(text: string): this {
    this.text = text;
    return this;
  }
  setCta(): this {
    this.cta = true;
    return this;
  }
  setWarning(): this {
    this.warning = true;
    return this;
  }
  setClass(name: string): this {
    this.buttonEl.addClass(name);
    return this;
  }
  setDisabled(): this {
    return this;
  }
  onClick(handler: () => unknown): this {
    this.handler = handler;
    return this;
  }
  async click(): Promise<void> {
    await this.handler?.();
  }
}

export class Setting {
  readonly settingEl = new FakeEl("div", "setting-item");
  readonly infoEl = this.settingEl.createDiv("setting-item-info");
  readonly nameEl = this.infoEl.createDiv("setting-item-name");
  readonly descEl = this.infoEl.createDiv("setting-item-description");
  readonly controlEl = this.settingEl.createDiv("setting-item-control");
  readonly texts: TextComponent[] = [];
  readonly buttons: ButtonComponent[] = [];

  /** Every row built so far, for code that builds one inside a dialog. */
  static readonly created: Setting[] = [];

  constructor(parent?: unknown) {
    if (parent instanceof FakeEl) parent.children.push(this.settingEl);
    Setting.created.push(this);
  }

  setName(name: string): this {
    this.nameEl.setText(name);
    return this;
  }
  setDesc(desc: string): this {
    this.descEl.setText(desc);
    return this;
  }
  setClass(name: string): this {
    this.settingEl.addClass(name);
    return this;
  }
  setHeading(): this {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }
  addText(build: (text: TextComponent) => unknown): this {
    const text = new TextComponent();
    this.texts.push(text);
    build(text);
    return this;
  }
  addButton(build: (button: ButtonComponent) => unknown): this {
    const button = new ButtonComponent();
    this.buttons.push(button);
    this.controlEl.children.push(button.buttonEl);
    build(button);
    return this;
  }
  find(cls: string): FakeEl | undefined {
    return this.settingEl.find(cls);
  }
  button(text: string): ButtonComponent {
    const found = this.buttons.find((b) => b.text === text);
    if (!found) throw new Error(`no button "${text}" among ${this.buttons.map((b) => b.text)}`);
    return found;
  }
}

// --- Modal, tab and platform -------------------------------------------------

export class Modal {
  readonly modalEl = new FakeEl("div", "modal");
  readonly titleEl = this.modalEl.createDiv("modal-title");
  readonly contentEl = this.modalEl.createDiv("modal-content");
  isOpen = false;
  /** Every modal made so far, newest last. */
  static readonly made: Modal[] = [];
  constructor(readonly app: unknown) {
    Modal.made.push(this);
  }
  open(): void {
    this.isOpen = true;
    this.onOpen();
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
  }
  onOpen(): void {}
  onClose(): void {}
}

export class PluginSettingTab {
  readonly containerEl = new FakeEl("div", "vertical-tab-content");
  /** How often the tab asked Obsidian to rebuild, or to re-check visibility. */
  updates = 0;
  domRefreshes = 0;
  constructor(
    readonly app: unknown,
    _plugin: unknown,
  ) {}
  update(): void {
    this.updates++;
  }
  refreshDomState(): void {
    this.domRefreshes++;
  }
}

export class AbstractInputSuggest {
  constructor(
    readonly app: unknown,
    readonly inputEl: unknown,
  ) {}
}

export class FuzzySuggestModal extends Modal {}

export const Platform = { isIosApp: false, isTablet: false, isMobile: false };

/** The plugin requires Obsidian 1.13, so every version check passes. */
export function requireApiVersion(_version: string): boolean {
  return true;
}

export const MarkdownRenderer = {
  rendered: [] as Array<{ markdown: string; el: FakeEl; component: unknown }>,
  render(_app: unknown, markdown: string, el: FakeEl, _path: string, component: unknown) {
    MarkdownRenderer.rendered.push({ markdown, el, component });
    el.createDiv({ cls: "markdown-rendered", text: markdown });
    return Promise.resolve();
  },
};
