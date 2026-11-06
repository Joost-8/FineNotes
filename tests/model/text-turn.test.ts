/**
 * A turned text box (`TextBoxElement.rotation`, about its top-left corner):
 * saved and read back, labelled `text-turn` so an older FineNotes holds the
 * notebook read-only instead of saving the box upright, and turned or kept
 * by the frame command.
 */

import { describe, expect, it } from "vitest";
import { inflateFromBase64 } from "../../src/model/compress";
import { type InkDocument, type TextBoxElement, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { SetTextBoxFrame } from "../../src/model/page-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function box(extra: Partial<TextBoxElement> = {}): TextBoxElement {
  return {
    id: "t1",
    x: 100,
    y: 200,
    w: 240,
    text: "Turned",
    color: "#000000",
    fontSize: 22,
    ...extra,
  };
}

function docWith(...boxes: TextBoxElement[]): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages[0].textBoxes.push(...boxes);
  return doc;
}

function stored(payload: string): { requires?: string[] } {
  return JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as {
    requires?: string[];
  };
}

describe("a turned text box, saved", () => {
  it("round-trips its turn and labels the notebook text-turn", () => {
    const payload = encodeDocument(docWith(box({ rotation: 0.5 })));
    expect(payload.startsWith("v2+text-turn:")).toBe(true);
    expect(stored(payload).requires).toEqual(["text-turn"]);
    expect(decodeDocument(payload).pages[0].textBoxes[0].rotation).toBeCloseTo(0.5, 9);
  });

  it("leaves an upright box on the plain label, with no turn stored", () => {
    const payload = encodeDocument(docWith(box()));
    expect(payload.startsWith("v2:")).toBe(true);
    expect("rotation" in decodeDocument(payload).pages[0].textBoxes[0]).toBe(false);
  });

  it("reads a zero or nonsense turn as upright", () => {
    for (const rotation of [0, Number.NaN, "1"]) {
      const doc = docWith(box({ rotation: rotation as number }));
      const back = decodeDocument(encodeDocument(doc)).pages[0].textBoxes[0];
      expect("rotation" in back).toBe(false);
    }
  });
});

describe("SetTextBoxFrame and a turn", () => {
  it("a frame without a turn moves the box and leaves its turn", () => {
    const doc = docWith(box({ rotation: 0.3 }));
    const history = new History();
    history.push(doc, new SetTextBoxFrame(doc.pages[0].id, "t1", { x: 10, y: 20, w: 240 }));
    expect(doc.pages[0].textBoxes[0]).toMatchObject({ x: 10, y: 20, rotation: 0.3 });
  });

  it("turns the box and undoes to exactly the file it was", () => {
    const doc = docWith(box());
    const before = JSON.stringify(doc);
    const history = new History();
    history.push(
      doc,
      new SetTextBoxFrame(doc.pages[0].id, "t1", { x: 90, y: 210, w: 240, rotation: 0.7 }),
    );
    expect(doc.pages[0].textBoxes[0].rotation).toBe(0.7);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("a turn of 0 makes it upright, and undo turns it back", () => {
    const doc = docWith(box({ rotation: 0.7 }));
    const before = JSON.stringify(doc);
    const history = new History();
    history.push(
      doc,
      new SetTextBoxFrame(doc.pages[0].id, "t1", { x: 100, y: 200, w: 240, rotation: 0 }),
    );
    expect("rotation" in doc.pages[0].textBoxes[0]).toBe(false);
    history.undo(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
