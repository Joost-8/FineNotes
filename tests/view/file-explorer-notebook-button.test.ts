import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { FileExplorerNotebookButton } = await import("../../src/view/file-explorer-notebook-button");

class Element {
  parentElement: Element | null = null;
  nodes: Element[] = [];
  attrs: Record<string, string> = {};
  cls = "";
  click = () => {};
  bar: Element | null = null;
  get children() {
    return { item: (index: number) => this.nodes[index] ?? null };
  }
  querySelector() {
    return this.bar;
  }
  createEl(_tag: string, info: { cls: string; attr: Record<string, string> }) {
    const button = new Element();
    button.cls = info.cls;
    button.attrs = info.attr;
    button.parentElement = this;
    this.nodes.push(button);
    return button;
  }
  addEventListener(_type: string, handler: () => void) {
    this.click = handler;
  }
  insertBefore(node: Element, before: Element | null) {
    if (node === before) return;
    node.remove();
    const index = before ? this.nodes.indexOf(before) : this.nodes.length;
    this.nodes.splice(index, 0, node);
    node.parentElement = this;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.nodes = this.parentElement.nodes.filter((node) => node !== this);
      this.parentElement = null;
    }
  }
}
function explorer() {
  const container = new Element();
  const bar = new Element();
  container.bar = bar;
  for (const label of ["New note", "New folder", "Sort", "Collapse"]) {
    bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
  }
  return { container, bar };
}
const containers = (...elements: Element[]) => elements as unknown as HTMLElement[];
const labels = (bar: Element) => bar.nodes.map((node) => node.attrs["aria-label"]);
describe("file explorer notebook button", () => {
  it("adds one accessible button beside the creation buttons and opens the dialog on click", () => {
    const { container, bar } = explorer();
    const create = vi.fn();
    const controller = new FileExplorerNotebookButton(create);
    controller.sync(containers(container), true);
    controller.sync(containers(container), true);
    expect(labels(bar)).toEqual(["New note", "New folder", "New notebook", "Sort", "Collapse"]);
    expect(bar.nodes[2].cls).toContain("clickable-icon");
    expect(bar.nodes[2].attrs.type).toBe("button");
    bar.nodes[2].click();
    expect(create).toHaveBeenCalledOnce();
  });
  it("removes buttons when disabled and restores them when enabled", () => {
    const { container, bar } = explorer();
    const controller = new FileExplorerNotebookButton(vi.fn());
    controller.sync(containers(container), false);
    expect(labels(bar)).not.toContain("New notebook");
    controller.sync(containers(container), true);
    controller.sync(containers(container), false);
    expect(labels(bar)).not.toContain("New notebook");
    controller.sync(containers(container), true);
    expect(labels(bar).filter((label) => label === "New notebook")).toHaveLength(1);
  });
  it("tracks each explorer and cleans up closed leaves and plugin unload", () => {
    const first = explorer();
    const second = explorer();
    const controller = new FileExplorerNotebookButton(vi.fn());
    controller.sync(containers(first.container, second.container), true);
    controller.sync(containers(second.container), true);
    expect(labels(first.bar)).not.toContain("New notebook");
    expect(labels(second.bar)).toContain("New notebook");
    controller.destroy();
    controller.destroy();
    controller.sync(containers(second.container), true);
    expect(labels(second.bar)).not.toContain("New notebook");
  });
  it("tolerates unavailable bars and restores a button removed by an explorer redraw", () => {
    const { container, bar } = explorer();
    const controller = new FileExplorerNotebookButton(vi.fn());
    controller.sync(containers(new Element()), true);
    controller.sync(containers(container), true);
    bar.nodes[2].remove();
    controller.sync(containers(container), true);
    expect(labels(bar).filter((label) => label === "New notebook")).toHaveLength(1);
  });
});
