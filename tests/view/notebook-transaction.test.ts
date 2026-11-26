import type { App, TFile as ObsidianFile } from "obsidian";
import { expect, it, vi } from "vitest";
import { devicePagesFolderOf, readPageFile } from "../../src/model/device-pages";
import { legacyPayload, pageFileName } from "../../src/model/device-pages-writer";
import { dotClockOf } from "../../src/model/dot-ids";
import { emptyDocument } from "../../src/model/document";
import { createInlineSketchPage } from "../../src/model/inline-sketch";
import { inkFileText } from "../../src/model/serialize";
import { IdSequence } from "../../src/view/id-sequence";
import { editClosedNotebook, readClosedNotebook } from "../../src/view/notebook-transaction";
import { TFile, TFolder } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

it("uses one device counter for inline stroke IDs and stamps across saves", async () => {
  const device = "a1b2c3d4";
  const notebookId = "n7k2q9ab";
  const file = new TFile("Physics.notebook.md");
  const folderPath = devicePagesFolderOf(file.path, notebookId);
  const pageId = "hw-test";
  const document = emptyDocument(1024);
  document.pages = [createInlineSketchPage(pageId)];
  const texts = new Map([
    [file.path, inkFileText("# Physics", legacyPayload(document, notebookId))],
  ]);
  const children: TFile[] = [];
  const folder = Object.assign(new TFolder(folderPath), { children });
  const app = {
    loadLocalStorage: () => device,
    workspace: { getLeavesOfType: () => [] },
    vault: {
      getAbstractFileByPath: (path: string) =>
        path === folderPath ? folder : (children.find((child) => child.path === path) ?? null),
      read: async (target: TFile) => texts.get(target.path) ?? "",
      create: async (path: string, text: string) => {
        texts.set(path, text);
        children.push(new TFile(path));
      },
      modify: async (target: TFile, text: string) => {
        texts.set(target.path, text);
      },
    },
  } as unknown as App;
  const notebook = file as unknown as ObsidianFile;
  const inline = await readClosedNotebook(app, notebook, 1024);
  const clock = dotClockOf(inline);
  expect(clock).toBeDefined();
  const ids = new IdSequence("s", () => inline);
  const inkFile = `${folderPath}/${pageFileName(pageId, device)}`;

  for (const counter of [1, 3]) {
    const id = ids.next();
    expect(id).toBe(`${device}.${counter}`);
    await editClosedNotebook(
      app,
      notebook,
      1024,
      (doc) => {
        doc.pages[0].strokes.push({
          id,
          tool: "pen",
          color: "#000",
          size: 4,
          pts: [10, 10, 0.5],
        });
      },
      new Set([pageId]),
      clock,
    );
    const written = readPageFile(texts.get(inkFile) ?? "", device);
    expect(written).toMatchObject({
      lists: {
        strokes: expect.arrayContaining([
          expect.objectContaining({ id, d: `${device}.${counter + 1}` }),
        ]),
      },
      vv: { [device]: counter + 1 },
    });
  }
});
