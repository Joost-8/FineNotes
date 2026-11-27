import { describe, expect, it } from "vitest";
import { keepInPage } from "../../src/view/touch-keeper";

type Node = { parent: FakeHolder | null };

class FakeHolder {
  hidden = false;
  kids: Node[] = [];
  constructor(
    readonly cls: string,
    private readonly body: { children: unknown[] },
  ) {}
  appendChild(node: Node): void {
    node.parent?.kids.splice(node.parent.kids.indexOf(node), 1);
    node.parent = this;
    this.kids.push(node);
  }
  remove(): void {
    this.body.children = this.body.children.filter((c) => c !== this);
  }
}

/** A stand-in element: in the page while its parent is on the body. */
function fakeDom() {
  const body: { children: unknown[]; createDiv: (o: { cls: string }) => FakeHolder } = {
    children: [],
    createDiv: (o) => {
      const holder = new FakeHolder(o.cls, body);
      body.children.push(holder);
      return holder;
    },
  };
  const el = {
    parent: null as FakeHolder | null,
    get isConnected(): boolean {
      return this.parent !== null && body.children.includes(this.parent);
    },
    ownerDocument: { body },
    cloneNode: () => ({ parent: null, copy: true }),
    replaceWith(other: Node): void {
      const parent = this.parent;
      if (!parent) return;
      parent.kids[parent.kids.indexOf(this)] = other;
      other.parent = parent;
      this.parent = null;
    },
  };
  return { body, el };
}

describe("keeping a dragged element in the page (Android sends its touch moves there)", () => {
  it("moves it into a hidden holder on the body, and takes both away once", () => {
    const { body, el } = fakeDom();
    const release = keepInPage(el as unknown as HTMLElement);
    expect(el.isConnected).toBe(true);
    const holder = body.children[0] as FakeHolder;
    expect(holder.hidden).toBe(true);
    expect(holder.cls).toBe("goodobsidian-touch-keeper");
    release();
    release();
    expect(body.children).toHaveLength(0);
    expect(el.isConnected).toBe(false);
  });

  it("leaves a copy where it was, so the menu under the finger does not shift", () => {
    const { body, el } = fakeDom();
    const menu = body.createDiv({ cls: "menu" });
    menu.appendChild(el);
    keepInPage(el as unknown as HTMLElement);
    expect(menu.kids).toHaveLength(1);
    expect(menu.kids[0]).toMatchObject({ copy: true });
    expect((body.children[1] as FakeHolder).kids).toEqual([el]);
  });
});
