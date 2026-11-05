/**
 * The reader download dialog (ocr-offer.ts): it closes the moment a choice is
 * made, before the action runs, so it goes even if the action throws.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FakeEl } from "../fakes/obsidian";

vi.mock("obsidian", () => import("../fakes/obsidian"));

const { OcrOfferModal } = await import("../../src/view/ocr-offer");
const { OCR_TIERS } = await import("../../src/recognition/ocr/ocr-model");

/** The dialog open, with actions that log what ran and whether the dialog was still up then. */
function open(download: () => void = () => undefined, notNow: () => void = () => undefined) {
  const log: string[] = [];
  // The fake Modal (tests/fakes/obsidian.ts) knows whether it is open and holds fake elements.
  const modal = new OcrOfferModal({} as never, OCR_TIERS, "fast", {
    download: (id) => {
      log.push(`download ${id}, open ${String(modal.isOpen)}`);
      download();
    },
    notNow: () => {
      log.push(`notNow, open ${String(modal.isOpen)}`);
      notNow();
    },
  }) as unknown as { isOpen: boolean; contentEl: FakeEl; open(): void; close(): void };
  modal.open();
  const button = (text: string): FakeEl => {
    const buttons: FakeEl[] =
      modal.contentEl.querySelector(".modal-button-container")?.children ?? [];
    const found = buttons.find((b) => b.text === text);
    if (!found) throw new Error(`no ${text} button`);
    return found;
  };
  return { modal, log, button };
}

describe("OcrOfferModal", () => {
  it("closes before the download starts, and the download runs", () => {
    const { modal, log, button } = open();
    button("Download").dispatch("click");
    expect(modal.isOpen).toBe(false);
    expect(log).toEqual(["download fast, open false"]);
  });

  it("closes even when the download throws", () => {
    const { modal, button } = open(() => {
      throw new Error("a notebook failed");
    });
    expect(() => button("Download").dispatch("click")).toThrow("a notebook failed");
    expect(modal.isOpen).toBe(false);
  });

  it("closes before Not now runs, and even when it throws, and answers only once", () => {
    const { modal, log, button } = open(undefined, () => {
      throw new Error("nope");
    });
    expect(() => button("Not now").dispatch("click")).toThrow("nope");
    expect(modal.isOpen).toBe(false);
    expect(log).toEqual(["notNow, open false"]);
  });

  it("counts the cross or Escape as Not now", () => {
    const { modal, log } = open();
    modal.close();
    expect(log).toEqual(["notNow, open false"]);
  });

  it("does not count the close after Download as Not now", () => {
    const { log, button } = open();
    button("Download").dispatch("click");
    expect(log).toEqual(["download fast, open false"]);
  });

  it("has a Download button that carries both classes the call-to-action fix selects", () => {
    const { button } = open();
    expect(button("Download").classes.has("mod-cta")).toBe(true);
    expect(button("Download").classes.has("clickable-icon")).toBe(true);
  });
});

describe("the reader download dialog's style (styles.css)", () => {
  const css = readFileSync(join(__dirname, "../../styles.css"), "utf8").replace(
    /\/\*[^]*?\*\//g,
    "",
  );

  /** The selector list of the rule whose last selector is `last`. */
  const selectorsEndingIn = (last: string): string[] => {
    for (const rule of css.matchAll(/([^{}]+)\{/g)) {
      const list = (rule[1] ?? "").split(",").map((s) => s.trim());
      if (list[list.length - 1]?.endsWith(last)) return list;
    }
    return [];
  };

  it("gives its Download button the dialog's call-to-action colours, resting and hovered", () => {
    for (const state of ["", ":hover"]) {
      expect(selectorsEndingIn(`button.mod-cta.clickable-icon${state}`)).toEqual([
        `.goodobsidian-dialog button.mod-cta.clickable-icon${state}`,
        `.goodobsidian-ocr-offer button.mod-cta.clickable-icon${state}`,
      ]);
    }
  });
});
