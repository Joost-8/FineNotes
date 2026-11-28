import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { HandwriteBlocksModal } = await import("../../src/view/handwrite-modals");

interface FakeNode {
  tag: string;
  cls: string;
  text: string;
  attrs: Record<string, string>;
  classes: Set<string>;
  children: FakeNode[];
  listeners: Map<string, Array<() => void>>;
  addClass(c: string): void;
  toggleClass(c: string, on: boolean): void;
  setAttribute(k: string, v: string): void;
  createDiv(opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeNode;
  createSpan(opts?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeNode;
  createEl(
    tag: string,
    opts?: { cls?: string; text?: string; attr?: Record<string, string> },
  ): FakeNode;
  addEventListener(type: string, fn: () => void): void;
  click(): void;
  focus(): void;
  empty(): void;
}

function makeNode(
  tag: string,
  opts?: { cls?: string; text?: string; attr?: Record<string, string> },
): FakeNode {
  const classes = new Set((opts?.cls ?? "").split(/\s+/).filter(Boolean));
  const listeners = new Map<string, Array<() => void>>();
  const node: FakeNode = {
    tag,
    cls: opts?.cls ?? "",
    text: opts?.text ?? "",
    attrs: { ...(opts?.attr ?? {}) },
    classes,
    children: [],
    listeners,
    addClass(c: string) {
      classes.add(c);
    },
    toggleClass(c: string, on: boolean) {
      if (on) classes.add(c);
      else classes.delete(c);
    },
    setAttribute(k: string, v: string) {
      node.attrs[k] = v;
    },
    createDiv(o) {
      return node.createEl("div", o);
    },
    createSpan(o) {
      return node.createEl("span", o);
    },
    createEl(t, o) {
      const child = makeNode(t, o);
      node.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    click() {
      for (const fn of listeners.get("click") ?? []) fn();
    },
    focus() {},
    empty() {
      node.children.length = 0;
    },
  };
  return node;
}

function findAll(root: FakeNode, cls: string): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    if (n.classes.has(cls)) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

function openModal(onChosen: (mode: "note" | "ask" | "one" | null) => void) {
  const modal = new HandwriteBlocksModal({} as never, onChosen);
  const modalEl = makeNode("div");
  const contentEl = makeNode("div");
  Object.assign(modal, {
    modalEl,
    contentEl,
    setTitle: vi.fn(),
    close: () => modal.onClose(),
  });
  vi.stubGlobal("window", { setTimeout: () => 0 });
  modal.onOpen();
  return { modal, contentEl };
}

describe("HandwriteBlocksModal first-use behavior and copy", () => {
  it("renders intro and per-option descriptions for all three modes", () => {
    const { contentEl } = openModal(() => {});
    const intro = findAll(contentEl, "goodobsidian-hw-blocks-intro");
    const names = findAll(contentEl, "goodobsidian-hw-blocks-name");
    const descs = findAll(contentEl, "goodobsidian-hw-blocks-desc");
    expect(intro).toHaveLength(1);
    expect(intro[0].text).toContain(".notebook.md");
    expect(names.map((n) => n.text)).toEqual([
      "One notebook per note",
      "Ask each time",
      "One notebook for everything",
    ]);
    expect(descs).toHaveLength(3);
    expect(descs.every((d) => d.text.trim().length > 10)).toBe(true);
  });

  it("resolves null when dismissed without pressing Continue", () => {
    const onChosen = vi.fn();
    const { modal, contentEl } = openModal(onChosen);
    // Even if the user clicked a row, dismissing without Continue cancels.
    const rows = findAll(contentEl, "goodobsidian-hw-blocks-row");
    rows[1].click();
    modal.onClose();
    expect(onChosen).toHaveBeenCalledWith(null);
  });

  it("resolves the selected mode when the user clicks Continue", () => {
    const onChosen = vi.fn();
    const { contentEl } = openModal(onChosen);
    const rows = findAll(contentEl, "goodobsidian-hw-blocks-row");
    rows[2].click();
    const cta = findAll(contentEl, "mod-cta")[0];
    cta.click();
    expect(onChosen).toHaveBeenCalledWith("one");
  });
});
