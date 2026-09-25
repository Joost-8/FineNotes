/**
 * `src/model/recording-commands.ts` — the per-page stroke clock and the
 * note's list of recordings. Every command must undo to a
 * `JSON.stringify`-identical document, absent keys included (contracts/api.md
 * §3), and must survive a save/load round trip.
 */

import { describe, expect, it } from "vitest";
import {
  type InkDocument,
  type Page,
  type Recording,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { History } from "../../src/model/history";
import {
  AddRecording,
  RemoveRecording,
  SetPageEpoch,
  SetRecordingTranscript,
  addStrokesTimed,
  strokeTimestamp,
} from "../../src/model/recording-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const snapshot = (doc: InkDocument): string => JSON.stringify(doc);

const EPOCH = Date.UTC(2026, 8, 22, 12, 0, 0);

function stroke(id: string): Stroke {
  return { id, color: "#1a1a1a", size: 3, tool: "pen", pts: [10, 10, 0.5, 20, 20, 0.5] };
}

function recording(id: string, start = EPOCH, duration = 60000): Recording {
  return { id, path: `audio/Recording ${id}.m4a`, start, duration };
}

describe("strokeTimestamp", () => {
  it("starts a page's clock with its first stamped stroke, at t0 = 0", () => {
    expect(strokeTimestamp({}, EPOCH + 0.4)).toEqual({ t0: 0, epoch: EPOCH });
  });

  it("counts later strokes from the page's epoch, in whole ms", () => {
    expect(strokeTimestamp({ epoch: EPOCH }, EPOCH + 1234.6)).toEqual({ t0: 1235 });
    // A stroke on a page started yesterday is still just a (large) offset.
    expect(strokeTimestamp({ epoch: EPOCH }, EPOCH + 86_400_000)).toEqual({ t0: 86_400_000 });
  });

  it("leaves a stroke untimed rather than inventing a time for it", () => {
    for (const penDown of [null, undefined, Number.NaN, Infinity, 0, -5]) {
      expect(strokeTimestamp({ epoch: EPOCH }, penDown), String(penDown)).toBeNull();
    }
    // Before the page's epoch (a clock behind the device that started the
    // page): not clamped onto "the moment the page began".
    expect(strokeTimestamp({ epoch: EPOCH }, EPOCH - 1000)).toBeNull();
  });

  it("treats a nonsense epoch as no epoch", () => {
    expect(strokeTimestamp({ epoch: -1 }, EPOCH)).toEqual({ t0: 0, epoch: EPOCH });
    expect(strokeTimestamp({ epoch: Number.NaN }, EPOCH)).toEqual({ t0: 0, epoch: EPOCH });
  });
});

describe("SetPageEpoch", () => {
  it("sets the clock and undo deletes the key again", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new SetPageEpoch(doc.pages[0], EPOCH);
    command.apply(doc);
    expect(doc.pages[0].epoch).toBe(EPOCH);
    command.invert(doc);
    expect("epoch" in doc.pages[0]).toBe(false);
    expect(snapshot(doc)).toBe(before);
  });

  it("restores a previous epoch rather than deleting it", () => {
    const doc = emptyDocument();
    doc.pages[0].epoch = EPOCH;
    const command = new SetPageEpoch(doc.pages[0], EPOCH + 5);
    command.apply(doc);
    command.invert(doc);
    expect(doc.pages[0].epoch).toBe(EPOCH);
  });

  it("acts on the page it was given, not an earlier page sharing its id", () => {
    const doc = emptyDocument();
    const twin: Page = blankPage("p1");
    doc.pages.push(twin);
    const command = new SetPageEpoch(twin, EPOCH);
    command.apply(doc);
    expect(doc.pages[0].epoch).toBeUndefined();
    expect(twin.epoch).toBe(EPOCH);
    command.invert(doc);
    expect("epoch" in twin).toBe(false);
  });

  it("falls back to the id after a reload, and does nothing for a page that is gone", () => {
    const doc = emptyDocument();
    const stale = blankPage("p1");
    new SetPageEpoch(stale, EPOCH).apply(doc);
    expect(doc.pages[0].epoch).toBe(EPOCH);

    const gone = new SetPageEpoch(blankPage("nope"), EPOCH);
    const before = snapshot(doc);
    gone.apply(doc);
    gone.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });
});

describe("addStrokesTimed", () => {
  it("stamps a page's first stroke and starts its clock, as one undo step", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const history = new History();
    const before = snapshot(doc);
    const s = stroke("s1");
    history.push(doc, addStrokesTimed(page, [s], EPOCH + 0.2));
    expect(page.epoch).toBe(EPOCH);
    expect(page.strokes).toEqual([{ ...stroke("s1"), t0: 0 }]);

    history.undo(doc);
    expect(snapshot(doc)).toBe(before);
    history.redo(doc);
    expect(page.epoch).toBe(EPOCH);
    expect(page.strokes[0].t0).toBe(0);
  });

  it("counts later strokes from the epoch and leaves the epoch alone", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    page.epoch = EPOCH;
    const command = addStrokesTimed(page, [stroke("s1")], EPOCH + 4200);
    command.apply(doc);
    expect(page.strokes[0].t0).toBe(4200);
    command.invert(doc);
    expect(page.strokes).toEqual([]);
    expect(page.epoch).toBe(EPOCH);
  });

  it("gives every stroke of one gesture (a table) the same pen-down", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const before = snapshot(doc);
    const command = addStrokesTimed(
      page,
      [stroke("s1"), stroke("s2"), stroke("s3")],
      EPOCH,
      "Add table",
    );
    expect(command.label).toBe("Add table");
    command.apply(doc);
    expect(page.strokes.map((s) => s.t0)).toEqual([0, 0, 0]);
    expect(page.epoch).toBe(EPOCH);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("adds strokes untimed, exactly as before 0.5, when there is no time", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    const command = addStrokesTimed(page, [stroke("s1")], null);
    expect(command.label).toBe("Add stroke");
    command.apply(doc);
    expect("t0" in page.strokes[0]).toBe(false);
    expect("epoch" in page).toBe(false);
  });

  it("does nothing, and sets no clock, for no strokes", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = addStrokesTimed(doc.pages[0], [], EPOCH, "Add table");
    command.apply(doc);
    expect(snapshot(doc)).toBe(before);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("keeps t0 and epoch through a save and load", () => {
    const doc = emptyDocument();
    const page = doc.pages[0];
    addStrokesTimed(page, [stroke("s1")], EPOCH).apply(doc);
    addStrokesTimed(page, [stroke("s2")], EPOCH + 61_000).apply(doc);
    const loaded = decodeDocument(encodeDocument(doc));
    expect(loaded.pages[0].epoch).toBe(EPOCH);
    expect(loaded.pages[0].strokes.map((s) => s.t0)).toEqual([0, 61_000]);
  });
});

describe("AddRecording", () => {
  it("creates the list, and undo deletes the key rather than leaving []", () => {
    const doc = emptyDocument();
    const before = snapshot(doc);
    const command = new AddRecording(recording("r1"));
    command.apply(doc);
    expect(doc.recordings).toEqual([recording("r1")]);
    command.invert(doc);
    expect("recordings" in doc).toBe(false);
    expect(snapshot(doc)).toBe(before);
  });

  it("appends to existing recordings and undo removes only its own", () => {
    const doc = emptyDocument();
    doc.recordings = [recording("r1")];
    const second = recording("r2", EPOCH + 120_000);
    const command = new AddRecording(second);
    command.apply(doc);
    expect(doc.recordings.map((r) => r.id)).toEqual(["r1", "r2"]);
    command.invert(doc);
    expect(doc.recordings.map((r) => r.id)).toEqual(["r1"]);
  });

  it("survives a save and load", () => {
    const doc = emptyDocument();
    new AddRecording({ ...recording("r1"), transcript: "audio/t.md" }).apply(doc);
    expect(decodeDocument(encodeDocument(doc)).recordings).toEqual([
      { ...recording("r1"), transcript: "audio/t.md" },
    ]);
  });

  it("undoes by id and path after a reload replaced the object", () => {
    const doc = emptyDocument();
    const command = new AddRecording(recording("r1"));
    command.apply(doc);
    doc.recordings = [{ ...recording("r1") }];
    command.invert(doc);
    expect("recordings" in doc).toBe(false);
  });
});

describe("RemoveRecording", () => {
  it("removes the entry and undo puts it back in its place", () => {
    const doc = emptyDocument();
    doc.recordings = [recording("r1"), recording("r2"), recording("r3")];
    const before = snapshot(doc);
    const command = new RemoveRecording(doc.recordings[1]);
    command.apply(doc);
    expect(doc.recordings.map((r) => r.id)).toEqual(["r1", "r3"]);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("removing the last one deletes the key; undo brings the list back", () => {
    const doc = emptyDocument();
    doc.recordings = [recording("r1")];
    const before = snapshot(doc);
    const command = new RemoveRecording(doc.recordings[0]);
    command.apply(doc);
    expect("recordings" in doc).toBe(false);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });

  it("is a no-op for a recording the note does not have", () => {
    const doc = emptyDocument();
    doc.recordings = [recording("r1")];
    const before = snapshot(doc);
    const command = new RemoveRecording(recording("r9"));
    command.apply(doc);
    command.invert(doc);
    expect(snapshot(doc)).toBe(before);

    const none = emptyDocument();
    const nothing = new RemoveRecording(recording("r1"));
    nothing.apply(none);
    nothing.invert(none);
    expect("recordings" in none).toBe(false);
  });
});

describe("SetRecordingTranscript", () => {
  it("sets the transcript and undo deletes the key again", () => {
    const doc = emptyDocument();
    doc.recordings = [recording("r1")];
    const before = snapshot(doc);
    const command = new SetRecordingTranscript(doc.recordings[0], "audio/r1 transcript.md");
    command.apply(doc);
    expect(doc.recordings[0].transcript).toBe("audio/r1 transcript.md");
    command.invert(doc);
    expect("transcript" in doc.recordings[0]).toBe(false);
    expect(snapshot(doc)).toBe(before);
  });

  it("replaces an earlier transcript and undo restores it; undefined forgets it", () => {
    const doc = emptyDocument();
    doc.recordings = [{ ...recording("r1"), transcript: "old.md" }];
    const replace = new SetRecordingTranscript(doc.recordings[0], "new.md");
    replace.apply(doc);
    expect(doc.recordings[0].transcript).toBe("new.md");
    replace.invert(doc);
    expect(doc.recordings[0].transcript).toBe("old.md");

    const forget = new SetRecordingTranscript(doc.recordings[0], undefined);
    forget.apply(doc);
    expect("transcript" in doc.recordings[0]).toBe(false);
    forget.invert(doc);
    expect(doc.recordings[0].transcript).toBe("old.md");
  });

  it("finds the entry by id and path in a reloaded document, and ignores a missing one", () => {
    const doc = emptyDocument();
    doc.recordings = [recording("r1")];
    const stale = recording("r1");
    new SetRecordingTranscript(stale, "t.md").apply(doc);
    expect(doc.recordings[0].transcript).toBe("t.md");

    const before = snapshot(doc);
    const missing = new SetRecordingTranscript(recording("r7"), "x.md");
    missing.apply(doc);
    missing.invert(doc);
    expect(snapshot(doc)).toBe(before);
  });
});
