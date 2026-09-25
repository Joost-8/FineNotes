/**
 * A stand-in for the `obsidian` module, just big enough to load the plugin
 * entry (`src/main.ts`) and the notebook view (`src/view/ink-view.ts`) under
 * Node, and to watch what they do: the commands they register, the view
 * states they set, the notices they show and the data they save.
 *
 * Install it with `vi.mock("obsidian", () => import("./fake-obsidian"))`.
 * Classes the code under test only extends (modals, setting tabs, suggest
 * boxes) are empty shells; nothing here draws.
 */

/** Every notice shown since the last `resetFakes()`, as its text. */
export const notices: { message: string; timeout: number | undefined }[] = [];

/** Every call that reached `WorkspaceLeaf.prototype.setViewState` unpatched. */
export const viewStateCalls: { leaf: WorkspaceLeaf; state: ViewState; eState: unknown }[] = [];

export function resetFakes(): void {
  notices.length = 0;
  viewStateCalls.length = 0;
  Object.assign(Platform, PLATFORM_DEFAULTS);
}

const PLATFORM_DEFAULTS = {
  isIosApp: false,
  isAndroidApp: false,
  isTablet: false,
  isPhone: false,
  isMobile: false,
  isMobileApp: false,
  isDesktop: true,
  isDesktopApp: true,
  isSafari: false,
  isMacOS: false,
};

export const Platform = { ...PLATFORM_DEFAULTS };

export interface ViewState {
  type: string;
  state?: Record<string, unknown>;
  active?: boolean;
  [key: string]: unknown;
}

export class Notice {
  readonly messageEl = { addEventListener: (): void => undefined };

  constructor(message: string | DocumentFragment, timeout?: number) {
    notices.push({ message: String(message), timeout });
  }

  setMessage(message: string): this {
    notices.push({ message, timeout: undefined });
    return this;
  }

  hide(): void {}
}

export class Component {
  private readonly cleanups: (() => void)[] = [];

  register(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  registerEvent(_ref: unknown): void {}
  registerDomEvent(..._args: unknown[]): void {}

  registerInterval(id: number): number {
    return id;
  }

  addChild<T>(child: T): T {
    return child;
  }

  load(): void {}

  /** Run every `register`ed clean-up, newest first, as Obsidian does on unload. */
  unload(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}

export interface FakeCommand {
  id: string;
  name: string;
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean | void;
}

export interface FakeManifest {
  id: string;
  name: string;
  version: string;
}

export class Plugin extends Component {
  readonly commands: FakeCommand[] = [];
  readonly views = new Map<string, (leaf: WorkspaceLeaf) => unknown>();
  readonly protocolHandlers = new Map<string, (params: Record<string, string>) => unknown>();
  readonly settingTabs: unknown[] = [];
  readonly ribbon: { icon: string; title: string; callback: () => unknown }[] = [];
  /** What `loadData` resolves to: `null` is a vault with no `data.json` yet. */
  stored: unknown = null;
  /** A copy of everything passed to `saveData`, oldest first. */
  readonly saved: Record<string, unknown>[] = [];

  constructor(
    public app: unknown,
    public manifest: FakeManifest,
  ) {
    super();
  }

  addCommand(command: FakeCommand): FakeCommand {
    this.commands.push(command);
    return command;
  }

  registerView(type: string, factory: (leaf: WorkspaceLeaf) => unknown): void {
    this.views.set(type, factory);
  }

  addRibbonIcon(icon: string, title: string, callback: () => unknown): unknown {
    this.ribbon.push({ icon, title, callback });
    return {};
  }

  addSettingTab(tab: unknown): void {
    this.settingTabs.push(tab);
  }

  registerObsidianProtocolHandler(
    action: string,
    handler: (params: Record<string, string>) => unknown,
  ): void {
    this.protocolHandlers.set(action, handler);
  }

  loadData(): Promise<unknown> {
    return Promise.resolve(this.stored === null ? null : structuredClone(this.stored));
  }

  saveData(data: unknown): Promise<void> {
    const copy = structuredClone(data) as Record<string, unknown>;
    this.saved.push(copy);
    this.stored = structuredClone(copy);
    return Promise.resolve();
  }
}

export class WorkspaceLeaf {
  view: unknown = null;
  state: ViewState = { type: "empty", state: {} };

  constructor(public app?: unknown) {}

  getViewState(): ViewState {
    return this.state;
  }

  setViewState(state: ViewState, eState?: unknown): Promise<void> {
    viewStateCalls.push({ leaf: this, state, eState });
    this.state = state;
    return Promise.resolve();
  }
}

export class TFile {
  readonly name: string;
  readonly basename: string;
  readonly extension: string;
  readonly stat: { size: number; mtime: number; ctime: number };
  parent: unknown = null;

  constructor(
    readonly path: string,
    size = 1,
  ) {
    this.name = path.slice(path.lastIndexOf("/") + 1);
    const dot = this.name.lastIndexOf(".");
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
    this.stat = { size, mtime: 0, ctime: 0 };
  }
}

export class MarkdownView {
  file: TFile | null = null;

  constructor(public leaf?: WorkspaceLeaf) {}
}

export class TextFileView extends Component {
  app: unknown;
  file: TFile | null = null;
  readonly contentEl: unknown = {};
  readonly containerEl: unknown = {};
  /** How many times the view asked for a save. */
  saveRequests = 0;

  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.app = leaf.app;
  }

  requestSave(): void {
    this.saveRequests++;
  }

  save(): Promise<void> {
    return Promise.resolve();
  }

  onUnloadFile(_file: TFile): Promise<void> {
    return Promise.resolve();
  }

  setEphemeralState(_state: unknown): void {}

  getEphemeralState(): Record<string, unknown> {
    return {};
  }
}

class Shell {
  constructor(..._args: unknown[]) {}
}

export class Modal extends Shell {
  open(): void {}
  close(): void {}
}
export class PluginSettingTab extends Shell {
  readonly containerEl = { isConnected: false };
}
export class Setting extends Shell {}
export class Menu extends Shell {}
export class SuggestModal extends Modal {}
export class FuzzySuggestModal extends Modal {}
export class AbstractInputSuggest extends Shell {}
export class ToggleComponent extends Shell {}
export class MarkdownRenderer {
  static render(): Promise<void> {
    return Promise.resolve();
  }
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function requireApiVersion(_version: string): boolean {
  return true;
}

export function setIcon(): void {}

export function loadPdfJs(): Promise<never> {
  return Promise.reject(new Error("no pdf.js under test"));
}

export function requestUrl(): Promise<never> {
  return Promise.reject(new Error("no network under test"));
}
