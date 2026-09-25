/**
 * The text layer panel against a few fake elements, enough for Obsidian's
 * `createDiv` / `createEl` / `toggle` helpers. The rule it exists for: the
 * frontmatter never reaches the field, and always survives an edit.
 */

import { describe, expect, it } from "vitest";
import { TextPanel } from "../../src/view/text-panel";

class FakeEl {
  readonly children: FakeEl[] = [];
  readonly style = { display: "" };
  value = "";
  text = "";

  constructor(
    readonly tag: string,
    readonly cls = "",
    readonly attr: Record<string, string> = {},
  ) {}

  createDiv(o: { cls?: string; text?: string } = {}): FakeEl {
    return this.createEl("div", o);
  }

  createEl(
    tag: string,
    o: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ): FakeEl {
    const child = new FakeEl(tag, o.cls, o.attr);
    child.text = o.text ?? "";
    this.children.push(child);
    return child;
  }

  toggle(show: boolean): void {
    this.style.display = show ? "" : "none";
  }
}

function panel(): { parent: FakeEl; panel: TextPanel; root: FakeEl; field: FakeEl } {
  const parent = new FakeEl("div");
  const p = new TextPanel(parent as unknown as HTMLElement);
  return {
    parent,
    panel: p,
    root: p.el as unknown as FakeEl,
    field: p.field as unknown as FakeEl,
  };
}

describe("TextPanel", () => {
  it("builds a labelled field with a placeholder, inside its parent", () => {
    const { parent, root, field } = panel();
    expect(parent.children).toEqual([root]);
    expect(root.cls).toBe("goodobsidian-textpanel");
    expect(root.children.map((c) => c.tag)).toEqual(["div", "textarea"]);
    expect(root.children[0].text).not.toBe("");
    expect(field.cls).toBe("goodobsidian-textpanel-input");
    expect(field.attr.placeholder).not.toBe("");
  });

  it("shows the prose and keeps the frontmatter out of the field", () => {
    const { panel: p, field } = panel();
    p.load("---\ntags: [a]\n---\n# Title\n\nWords.\n");
    expect(field.value).toBe("# Title\n\nWords.\n");
  });

  it("puts the frontmatter back in front of an edit, unchanged", () => {
    const { panel: p, field } = panel();
    p.load("---\ntags: [a]\n---\nOld.\n");
    field.value = "New words.\n";
    expect(p.edited()).toBe("---\ntags: [a]\n---\nNew words.\n");
  });

  it("handles a body with no frontmatter", () => {
    const { panel: p, field } = panel();
    p.load("Just prose.");
    expect(field.value).toBe("Just prose.");
    field.value = "Other prose.";
    expect(p.edited()).toBe("Other prose.");
  });

  it("forgets the previous note's frontmatter on the next load", () => {
    const { panel: p, field } = panel();
    p.load("---\na: 1\n---\nOne.");
    p.load("Two.");
    field.value = "Two, edited.";
    expect(p.edited()).toBe("Two, edited.");
  });

  it("opens and closes", () => {
    const { panel: p, root } = panel();
    p.setOpen(false);
    expect(root.style.display).toBe("none");
    p.setOpen(true);
    expect(root.style.display).toBe("");
  });
});
