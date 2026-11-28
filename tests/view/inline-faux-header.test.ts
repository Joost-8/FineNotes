import { describe, expect, it, vi } from "vitest";
import { blankPage, emptyDocument } from "../../src/model/document";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { EmbedInlineEditor } = await import("../../src/view/embed-inline-editor");

interface FakeEl {
  height: string;
  offsetHeight: number;
  clientWidth: number;
  childElementCount: number;
  classes: Set<string>;
  hasClass(cls: string): boolean;
  setCssStyles(styles: Record<string, string>): void;
  getBoundingClientRect(): { height: number };
  querySelector<T>(sel: string): T | null;
}

function makeFakeEl(opts?: {
  offsetHeight?: number;
  clientWidth?: number;
  childElementCount?: number;
  classes?: string[];
  pill?: FakeEl | null;
}): FakeEl {
  const classes = new Set(opts?.classes ?? []);
  const el: FakeEl = {
    height: "",
    offsetHeight: opts?.offsetHeight ?? 50,
    clientWidth: opts?.clientWidth ?? 600,
    childElementCount: opts?.childElementCount ?? 1,
    classes,
    hasClass: (cls: string) => classes.has(cls),
    setCssStyles(styles: Record<string, string>) {
      if (styles.height !== undefined) el.height = styles.height;
    },
    getBoundingClientRect: () => ({ height: el.offsetHeight }),
    querySelector: <T>() => (opts?.pill ?? null) as T | null,
  };
  return el;
}

function makeEditor(mountedPillRow: boolean, livePillRow: boolean) {
  const pill = makeFakeEl({ offsetHeight: 44, childElementCount: 3 });
  const toolbarHost = makeFakeEl({ offsetHeight: 52, pill });
  const fauxHeader = makeFakeEl();
  const fauxBg = makeFakeEl();
  const stage = makeFakeEl({ clientWidth: 600 });
  const canvas = {
    width: 0,
    height: 0,
    setCssStyles: vi.fn(),
    getContext: () => null,
  };
  const doc = emptyDocument();
  doc.pages = [blankPage("hw-1")];
  const plugin = { pillRow: livePillRow };

  const editor = Object.assign(Object.create(EmbedInlineEditor.prototype), {
    req: {
      plugin,
      slotEl: { clientWidth: 600, ownerDocument: { defaultView: { devicePixelRatio: 2 } } },
    },
    doc,
    mountedPillRow,
    toolbarHostEl: toolbarHost,
    fauxHeaderEl: fauxHeader,
    fauxBgEl: fauxBg,
    fauxCanvasEl: canvas,
    stageEl: stage,
    fauxHeaderPx: 0,
  });
  return { editor, plugin, pill, fauxHeader, fauxBg };
}

describe("EmbedInlineEditor mounted docking spacer consistency", () => {
  it("keeps the floating pill spacer even if docking is enabled elsewhere after mount", () => {
    const { editor, plugin, pill, fauxHeader, fauxBg } = makeEditor(false, false);
    const sync = () =>
      (EmbedInlineEditor.prototype as unknown as { syncFauxHeader(): void }).syncFauxHeader.call(
        editor,
      );

    // Floating pill open at mount -> spacer expands.
    sync();
    expect(fauxHeader.height).toBe("58px");
    expect(fauxBg.height).toBe("111px");

    // User enables docked options in another notebook while this block is open.
    plugin.pillRow = true;
    sync();
    expect(fauxHeader.height).toBe("58px");
    expect(fauxBg.height).toBe("111px");

    // Collapsing the floating pill still collapses the spacer cleanly.
    pill.classes.add("is-collapsed");
    sync();
    expect(fauxHeader.height).toBe("0px");
    expect(fauxBg.height).toBe("52px");
  });

  it("keeps the spacer collapsed for a docked inline toolbar even if docking is disabled elsewhere", () => {
    const { editor, plugin, fauxHeader, fauxBg } = makeEditor(true, true);
    const sync = () =>
      (EmbedInlineEditor.prototype as unknown as { syncFauxHeader(): void }).syncFauxHeader.call(
        editor,
      );

    sync();
    expect(fauxHeader.height).toBe("0px");
    expect(fauxBg.height).toBe("0px");

    // User turns off docked options elsewhere; mounted docked toolbar stays at 0px.
    plugin.pillRow = false;
    sync();
    expect(fauxHeader.height).toBe("0px");
    expect(fauxBg.height).toBe("0px");
  });
});
