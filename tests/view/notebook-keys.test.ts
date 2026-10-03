import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({
  Scope: class {
    callback: ((event: KeyboardEvent) => true | undefined) | null = null;
    constructor(readonly parent: unknown) {}
    register(
      modifiers: unknown,
      key: unknown,
      callback: (event: KeyboardEvent) => true | undefined,
    ) {
      expect(modifiers).toBeNull();
      expect(key).toBeNull();
      this.callback = callback;
    }
  },
}));
const { notebookKeyScope } = await import("../../src/view/notebook-keys");

function setup(noWindow = false) {
  const host = {};
  const body = {};
  let modal = false;
  const doc = {
    body,
    defaultView: noWindow ? null : host,
    querySelector: () => (modal ? {} : null),
    ...host,
  };
  const inside = {};
  const root = { ownerDocument: doc, contains: (target: unknown) => target === inside };
  let active = true;
  const handle = vi.fn(() => true);
  const scope = notebookKeyScope(
    root as unknown as HTMLElement,
    {} as never,
    () => active,
    handle,
  ) as unknown as { callback: (event: KeyboardEvent) => true | undefined };
  const fire = (target: unknown = body, flags = {}) => {
    const event = {
      target,
      key: "z",
      ctrlKey: true,
      defaultPrevented: false,
      isComposing: false,
      stopPropagation: vi.fn(),
      ...flags,
    };
    const result = scope.callback(event as unknown as KeyboardEvent);
    return { ...event, result };
  };
  return {
    fire,
    handle,
    host,
    doc,
    inside,
    scope,
    active: (value: boolean) => {
      active = value;
    },
    modal: () => {
      modal = true;
    },
  };
}
describe("notebook keyboard routing", () => {
  it("claims body and notebook keys in the view scope, preserving browser defaults", () => {
    const s = setup();
    for (const target of [s.doc.body, s.inside, s.host, s.doc])
      expect(s.fire(target).stopPropagation).toHaveBeenCalledOnce();
    expect(s.handle).toHaveBeenCalledTimes(4);
    expect(s.fire().result).toBe(true);
  });
  it("leaves other panes, inactive notebooks, modals, composing and claimed keys alone", () => {
    const s = setup();
    s.fire({});
    s.fire(s.doc.body, { defaultPrevented: true });
    s.fire(s.doc.body, { isComposing: true });
    s.active(false);
    s.fire();
    s.active(true);
    s.modal();
    s.fire();
    expect(s.handle).not.toHaveBeenCalled();
  });
  it("does not stop keys the surface leaves to text fields or other actions", () => {
    const s = setup();
    s.handle.mockReturnValue(false);
    expect(s.fire(s.inside).stopPropagation).not.toHaveBeenCalled();
  });
  it("uses the element's own document if no window is available", () => {
    const s = setup(true);
    s.fire(s.doc);
    expect(s.handle).toHaveBeenCalledOnce();
  });
});
