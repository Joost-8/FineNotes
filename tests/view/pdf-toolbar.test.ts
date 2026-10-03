import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");
describe("PDF toolbar button", () => {
  it("places PDF immediately after Image and wires the import action", () => {
    const importPdf = vi.fn();
    const buttons: Array<{
      label: string;
      parent: unknown;
      handler?: (button: unknown) => void;
      addClass: ReturnType<typeof vi.fn>;
    }> = [];
    const state = Object.assign(Object.create(Toolbar.prototype) as object, {
      callbacks: { onInsertImage: vi.fn(), onInsertPdf: importPdf },
      barEl: { createDiv: () => ({}) },
      addToolButton: vi.fn(),
      watchCrowding: vi.fn(),
      barButton: (
        parent: unknown,
        _icon: string,
        label: string,
        handler?: (button: unknown) => void,
      ) => {
        const button = { label, parent, handler, addClass: vi.fn() };
        buttons.push(button);
        return button;
      },
    });
    (state as unknown as { buildBar(): void }).buildBar();
    const image = buttons.findIndex((button) => button.label === "Insert image");
    const pdf = buttons[image + 1];
    expect(pdf.label).toBe("Insert PDF");
    expect(pdf.parent).toBe(buttons[image].parent);
    // Styled like its neighbours: the bar handles the iPad button padding itself.
    expect(pdf.addClass).not.toHaveBeenCalled();
    pdf.handler?.(pdf);
    expect(importPdf).toHaveBeenCalledWith(pdf);
  });
});
