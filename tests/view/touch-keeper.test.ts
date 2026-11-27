import { describe, expect, it } from "vitest";
import { keepIfDropped, keepInPage } from "../../src/view/touch-keeper";

/** A stand-in element: in the page while its parent is, the body always. */
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
  };
  return { body, el };
}

class FakeHolder {
  hidden = false;
  kids: unknown[] = [];
  constructor(
    readonly cls: string,
    private readonly body: { children: unknown[] },
  ) {}
  appendChild(node: { parent: FakeHolder | null }): void {
    node.parent = this;
    this.kids.push(node);
  }
  remove(): void {
    this.body.children = this.body.children.filter((c) => c !== this);
  }
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

  it("keeps an element only once it has left the page", () => {
    const { body, el } = fakeDom();
    const holder = body.createDiv({ cls: "row" });
    holder.appendChild(el);
    expect(keepIfDropped(el as unknown as HTMLElement)).toBeNull();
    holder.remove();
    const release = keepIfDropped(el as unknown as HTMLElement);
    expect(release).not.toBeNull();
    expect(el.isConnected).toBe(true);
  });
});
