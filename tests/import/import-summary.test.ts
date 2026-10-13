import { describe, expect, it } from "vitest";
import { importNotebooks } from "../../src/import/import-notebook";
import {
  describeImport,
  importHeading,
  isImportFileName,
  progressText,
  withPageText,
} from "../../src/import/import-summary";
import { readTextSection } from "../../src/recognition/text-layer";
import { parsePageTranscripts } from "../../src/recognition/page-transcripts";
import { goodnotesFiles, JPEG, PDF, zip } from "./builders";

const PAGE = (n: number): string => `${n}1111111-0000-0000-0000-00000000000A`;

async function notebook(pages: number, pictures: number) {
  const files = zip(
    goodnotesFiles({
      title: "Bio",
      templates: [{ id: "T", size: [834.24, 1078.825], attachment: "A" }],
      pages: Array.from({ length: pages }, (_, i) => ({
        id: PAGE(i),
        template: "T",
        order: String(i),
        images:
          i === 0
            ? Array.from({ length: pictures }, (_, j) => ({
                id: `I${j}`,
                attachment: "P",
                frame: [0, 0, 5, 5] as [number, number, number, number],
              }))
            : [],
      })),
      attachments: { A: PDF, P: JPEG },
    }),
  );
  return importNotebooks(files, "Bio.goodnotes");
}

describe("import summary", () => {
  it("describes a notebook", async () => {
    expect(describeImport((await notebook(1, 0)).results[0])).toBe("1 page · from Goodnotes");
    expect(describeImport((await notebook(3, 2)).results[0])).toBe(
      "3 pages · from Goodnotes · 2 pictures",
    );
    expect(describeImport((await notebook(2, 1)).results[0])).toBe(
      "2 pages · from Goodnotes · 1 picture",
    );
  });

  it("heads the results", async () => {
    expect(importHeading(await notebook(1, 0))).toBe("Imported 1 notebook");
    const two = await notebook(1, 0);
    two.results.push(two.results[0]);
    expect(importHeading(two)).toBe("Imported 2 notebooks");
    expect(importHeading({ results: [], failures: [] })).toBe("Nothing was imported");
  });

  it("recognises importable files", async () => {
    expect(["a.goodnotes", "B.NOTE", "backup.zip"].every(isImportFileName)).toBe(true);
    expect(["a.pdf", "notes.md", "goodnotes"].some(isImportFileName)).toBe(false);
  });

  it("shows progress", async () => {
    expect(progressText(0, 1, "Folder/Bio.goodnotes")).toBe("Importing Bio.goodnotes…");
    expect(progressText(1, 3, "Maths.note")).toBe("Importing 2 of 3: Maths.note…");
  });
});

describe("withPageText", () => {
  it("files another app's recognised text as each page's transcription, read on the device", async () => {
    const { doc } = (await notebook(2, 0)).results[0];
    const body = withPageText("# Bio\n", doc, ["", "What's up"]);
    const parsed = parsePageTranscripts(readTextSection(body));
    expect(parsed.entries).toMatchObject([{ key: "p2", text: "What's up", device: true }]);
    expect(body.startsWith("# Bio\n")).toBe(true);
  });

  it("leaves the body alone when there is no text", async () => {
    const { doc } = (await notebook(1, 0)).results[0];
    expect(withPageText("# Bio\n", doc)).toBe("# Bio\n");
    expect(withPageText("# Bio\n", doc, ["  "])).toBe("# Bio\n");
  });
});
