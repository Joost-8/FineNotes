import { describe, expect, it } from "vitest";
import {
  assetsFolderOf,
  chosenFolder,
  stickerFolderFor,
  templateFolderFor,
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

describe("one assets folder for stickers and templates (2026-11-11)", () => {
  it("puts both in FineNotes assets until another folder is chosen", () => {
    const fresh = {
      stickerFolder: "FineNotes assets/Stickers",
      templateFolder: "FineNotes assets/Templates",
    };
    expect(stickerFolderFor(fresh)).toBe("FineNotes assets/Stickers");
    expect(templateFolderFor(fresh)).toBe("FineNotes assets/Templates");
    expect(stickerFolderFor({})).toBe("FineNotes assets/Stickers");
    const moved = { ...fresh, assetsFolder: " School\\Assets/ " };
    expect(assetsFolderOf(moved.assetsFolder)).toBe("School/Assets");
    expect(stickerFolderFor(moved)).toBe("School/Assets/Stickers");
    expect(templateFolderFor(moved)).toBe("School/Assets/Templates");
  });

  it("keeps a stickers or templates folder typed before, whatever the assets folder", () => {
    const own = {
      assetsFolder: "Elsewhere",
      stickerFolder: "Art/Stickers/",
      templateFolder: "Paper",
    };
    expect(stickerFolderFor(own)).toBe("Art/Stickers");
    expect(templateFolderFor(own)).toBe("Paper");
  });

  it("counts no default as a folder of the user's, old or new", () => {
    for (const value of [
      "",
      "  ",
      undefined,
      7,
      "FineNotes stickers",
      "FineNotes assets/Stickers",
    ]) {
      expect(chosenFolder(value, "stickers"), String(value)).toBeNull();
    }
    expect(chosenFolder("FineNotes templates", "templates")).toBeNull();
    expect(chosenFolder("FineNotes templates", "stickers")).toBe("FineNotes templates");
  });
});
