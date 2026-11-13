import type { Modal } from "../fakes/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  changes: [] as Array<(value: string) => void>,
  notices: [] as string[],
}));
vi.mock("obsidian", async () => {
  const fakes = await import("../fakes/obsidian");
  class Dropdown extends fakes.DropdownComponent {
    override onChange(handler: (value: string) => void): this {
      state.changes.push(handler);
      return this;
    }
  }
  return {
    ...fakes,
    Setting: class extends fakes.Setting {
      override addDropdown(build: (dropdown: Dropdown) => void): this {
        build(new Dropdown());
        return this;
      }
    },
    SuggestModal: class extends fakes.Modal {
      limit = 0;
      emptyStateText = "";
      inputEl = {
        value: "",
        inputs: 0,
        dispatchEvent(): void {
          this.inputs++;
        },
      };
      resultContainerEl = { scrollTop: 0 };
      setPlaceholder(): void {}
      selectSuggestion(value: unknown): void {
        this.close();
        (this as unknown as { onChooseSuggestion(v: unknown): void }).onChooseSuggestion(value);
      }
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
    start(): void {}
    end(): void {}
  },
}));
vi.mock("../../src/view/enter-key", () => ({ onEnterKey: () => undefined }));
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
  it("browses the vault's folders that hold PDFs, opens one in place, and takes a PDF", () => {
    const files = [
      { path: "Courses/Lecture.PDF", extension: "PDF" },
      { path: "Courses/notes.md", extension: "md" },
      { path: "scan.pdf", extension: "pdf" },
    ];
    const pick = vi.fn();
    const app = {
      vault: {
        getFiles: () => files,
        getFileByPath: (path: string) => files.find((f) => f.path === path) ?? null,
        getName: () => "Vault",
      },
    };
    const modal = new VaultPdfSuggestModal(app as never, pick);
    const shown = modal as unknown as Modal;
    modal.open();
    const kinds = (rows: Array<{ kind: string }>): string[] => rows.map((r) => r.kind);
    const root = modal.getSuggestions("");
    expect(kinds(root)).toEqual(["folder", "pdf"]);
    // A folder opens in the picker, which stays open, with a way back.
    modal.selectSuggestion(root[0], {} as never);
    expect(shown.isOpen).toBe(true);
    const inside = modal.getSuggestions("");
    expect(kinds(inside)).toEqual(["up", "pdf"]);
    // Typing searches every PDF, wherever it is.
    expect(modal.getSuggestions("scan").map((r) => r.kind === "pdf" && r.pdf.path)).toEqual([
      "scan.pdf",
    ]);
    modal.selectSuggestion(inside[1], {} as never);
    expect(shown.isOpen).toBe(false);
    expect(pick).toHaveBeenCalledWith(files[0]);
    // The next picker starts where this one took its PDF.
    const again = new VaultPdfSuggestModal(app as never, pick);
    expect(kinds(again.getSuggestions(""))).toEqual(["up", "pdf"]);
  });
});
