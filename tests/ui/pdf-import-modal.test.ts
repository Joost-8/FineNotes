import type { Modal } from "../fakes/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  changes: [] as Array<(value: string) => void>,
  notices: [] as string[],
}));
vi.mock("obsidian", async () => {
  const fakes = await import("../fakes/obsidian");
  class Dropdown {
    addOption(): this {
      return this;
    }
    onChange(handler: (value: string) => void): this {
      state.changes.push(handler);
      return this;
    }
  }
  return {
    ...fakes,
    Setting: class extends fakes.Setting {
      addDropdown(build: (dropdown: Dropdown) => void): this {
        build(new Dropdown());
        return this;
      }
    },
    FuzzySuggestModal: class extends fakes.Modal {
      setPlaceholder(): void {}
    },
    Notice: class {
      constructor(message: string) {
        state.notices.push(message);
      }
    },
  };
});
vi.mock("../../src/view/dialog-keyboard", () => ({
  DialogKeyboard: class {
    watch(): void {}
    end(): void {}
  },
}));
const { PdfImportModal, VaultPdfSuggestModal } = await import("../../src/view/pdf-import-modal");
const { Setting } = await import("../fakes/obsidian");
beforeEach(() => {
  Setting.created.length = 0;
  state.changes.length = 0;
  state.notices.length = 0;
});
function open(insert = vi.fn(async (_pages: number[]) => true)) {
  const modal = new PdfImportModal({} as never, "Lecture.pdf", 6, insert);
  modal.open();
  return {
    modal: modal as unknown as InstanceType<typeof Modal>,
    insert,
    range: Setting.created[1],
    buttons: Setting.created[2],
  };
}
describe("PDF import dialog", () => {
  it("imports the whole file by default and hides the custom range", async () => {
    const { modal, insert, range, buttons } = open();
    expect(range.settingEl.hidden).toBe(true);
    await buttons.button("Import").click();
    expect(insert).toHaveBeenCalledWith([0, 1, 2, 3, 4, 5]);
    expect(modal.isOpen).toBe(false);
  });
  it("imports selected pages in entered order and deduplicates them", async () => {
    const { insert, range, buttons } = open();
    state.changes[0]("custom");
    expect(range.settingEl.hidden).toBe(false);
    await range.texts[0].type("5, 3-1, 5");
    await buttons.button("Import").click();
    expect(insert).toHaveBeenCalledWith([4, 2, 1, 0]);
  });
  it("rejects an invalid page before saving anything, and allows correction", async () => {
    const { modal, insert, range, buttons } = open();
    state.changes[0]("custom");
    await range.texts[0].type("7");
    await buttons.button("Import").click();
    expect(insert).not.toHaveBeenCalled();
    expect(state.notices[0]).toContain("no page 7");
    expect(modal.isOpen).toBe(true);
    await range.texts[0].type("2-3");
    await buttons.button("Import").click();
    expect(insert).toHaveBeenCalledWith([1, 2]);
  });
  it("cancel changes nothing", async () => {
    const { insert, modal, buttons } = open();
    await buttons.button("Cancel").click();
    expect(insert).not.toHaveBeenCalled();
    expect(modal.isOpen).toBe(false);
  });
  it("prevents duplicate imports while saving, and permits retry on failure", async () => {
    let finish!: (result: boolean) => void;
    const insert = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { modal, buttons } = open(insert);
    const first = buttons.button("Import").click();
    await buttons.button("Import").click();
    expect(insert).toHaveBeenCalledTimes(1);
    finish(false);
    await first;
    expect(modal.isOpen).toBe(true);
    const retry = buttons.button("Import").click();
    expect(insert).toHaveBeenCalledTimes(2);
    finish(true);
    await retry;
    expect(modal.isOpen).toBe(false);
  });
  it("keeps the dialog open and shows an attachment error", async () => {
    const { modal, buttons } = open(
      vi.fn(async () => {
        throw new Error("Disk full");
      }),
    );
    await buttons.button("Import").click();
    expect(modal.isOpen).toBe(true);
    expect(state.notices[0]).toContain("Disk full");
  });
  it("lists only vault PDFs and passes their original path", () => {
    const file = { path: "Lecture.PDF", extension: "PDF" };
    const pick = vi.fn();
    const modal = new VaultPdfSuggestModal(
      { vault: { getFiles: () => [file, { path: "note.md", extension: "md" }] } } as never,
      pick,
    );
    expect(modal.getItems()).toEqual([file]);
    expect(modal.getItemText(file as never)).toBe(file.path);
    modal.onChooseItem(file as never);
    expect(pick).toHaveBeenCalledWith(file);
  });
});
