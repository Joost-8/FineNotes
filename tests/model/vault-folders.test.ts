import { describe, expect, it } from "vitest";
import {
  DEFAULT_STICKER_FOLDER,
  DEFAULT_TEMPLATE_FOLDER,
  correctionsFile,
  folderMoves,
  folderOf,
  legacyCorrectionsFile,
  movedPath,
  templateFolderOf,
} from "../../src/model/vault-folders";

describe("FineNotes' folders", () => {
  it("keeps templates and stickers under FineNotes assets, corrections beside the sheets", () => {
    expect(DEFAULT_TEMPLATE_FOLDER).toBe("FineNotes assets/Templates");
    expect(DEFAULT_STICKER_FOLDER).toBe("FineNotes assets/Stickers");
    expect(correctionsFile()).toBe("FineNotes assets/Handwriting sheets/corrections.json");
    expect(legacyCorrectionsFile("/.obsidian/plugins/finenotes/")).toBe(
      ".obsidian/plugins/finenotes/handwriting/corrections.json",
    );
  });

  it("reads a folder setting, falling back for a blank or odd one", () => {
    expect(templateFolderOf(" My/Templates/ ")).toBe("My/Templates");
    expect(templateFolderOf("")).toBe(DEFAULT_TEMPLATE_FOLDER);
    expect(templateFolderOf(7)).toBe(DEFAULT_TEMPLATE_FOLDER);
    expect(folderOf("/", "x")).toBe("x");
  });

  it("moves a path inside a folder, and nothing outside it", () => {
    const from = "FineNotes templates";
    const to = DEFAULT_TEMPLATE_FOLDER;
    expect(movedPath("FineNotes templates/Papers/Planner.pdf", from, to)).toBe(
      "FineNotes assets/Templates/Papers/Planner.pdf",
    );
    expect(movedPath(from, from, to)).toBe(to);
    expect(movedPath("FineNotes templates old/x.pdf", from, to)).toBeNull();
    expect(movedPath("Notes/x.pdf", from, to)).toBeNull();
  });

  it("moves only folders still at a default, old, new or blank; never one the user chose", () => {
    const both = [
      { key: "templateFolder", from: "FineNotes templates", to: DEFAULT_TEMPLATE_FOLDER },
      { key: "stickerFolder", from: "FineNotes stickers", to: DEFAULT_STICKER_FOLDER },
    ];
    expect(
      folderMoves({ templateFolder: "FineNotes templates", stickerFolder: "FineNotes stickers" }),
    ).toEqual(both);
    expect(folderMoves({ templateFolder: "/FineNotes templates/", stickerFolder: "" })).toEqual(
      both,
    );
    // Already moved: asked again, so an old folder sync brings back still goes.
    expect(
      folderMoves({
        templateFolder: DEFAULT_TEMPLATE_FOLDER,
        stickerFolder: DEFAULT_STICKER_FOLDER,
      }),
    ).toEqual(both);
    expect(folderMoves({ templateFolder: "Planners", stickerFolder: "Art/Stickers" })).toEqual([]);
  });
});
