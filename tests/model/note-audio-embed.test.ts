import { describe, expect, it } from "vitest";
import {
  audioEmbedLine,
  formatAudioLength,
  isAudioPath,
  parseAudioLength,
  readAudioEmbed,
  recordingStartFromName,
} from "../../src/model/note-audio-embed";
import { decodeNote, encodeNote } from "../../src/model/text-note-file";
import { textBlock, type NoteBlock, type TextNote } from "../../src/model/text-note";

let n = 0;
const id = (): string => `t${++n}`;

describe("a recording's line", () => {
  it("writes its length after the bar, and reads it back", () => {
    const line = audioEmbedLine({ path: "Lecture/Recordings/Recording 1.m4a", duration: 83_400 });
    expect(line).toBe("![[Lecture/Recordings/Recording 1.m4a|1:23]]");
    expect(readAudioEmbed(line)).toEqual({
      path: "Lecture/Recordings/Recording 1.m4a",
      duration: 83_000,
    });
  });

  it("leaves the length out when there is none, or it is under a second", () => {
    expect(audioEmbedLine({ path: "a.webm" })).toBe("![[a.webm]]");
    expect(audioEmbedLine({ path: "a.webm", duration: 300 })).toBe("![[a.webm]]");
    expect(readAudioEmbed("![[a.webm]]")).toEqual({ path: "a.webm" });
    expect(readAudioEmbed("![[a.webm|0:00]]")).toEqual({ path: "a.webm" });
  });

  it("formats hours, minutes and seconds", () => {
    expect(formatAudioLength(7000)).toBe("0:07");
    expect(formatAudioLength(725_000)).toBe("12:05");
    expect(formatAudioLength(3_723_000)).toBe("1:02:03");
    expect(formatAudioLength(Number.NaN)).toBe("0:00");
    expect(formatAudioLength(-5)).toBe("0:00");
    expect(parseAudioLength("1:02:03")).toBe(3_723_000);
    expect(parseAudioLength(" 12:05 ")).toBe(725_000);
  });

  it("refuses what is not a length", () => {
    expect(parseAudioLength("1:60")).toBeUndefined();
    expect(parseAudioLength("1:60:00")).toBeUndefined();
    expect(parseAudioLength("lecture")).toBeUndefined();
    expect(parseAudioLength("")).toBeUndefined();
  });

  it("keeps an embed with the user's own text after the bar as text", () => {
    expect(readAudioEmbed("![[a.m4a|my lecture]]")).toBeNull();
    expect(readAudioEmbed("![[photo.png]]")).toBeNull();
    expect(readAudioEmbed("listen: ![[a.m4a]]")).toBeNull();
    expect(readAudioEmbed("![[ |1:00]]")).toBeNull();
  });

  it("reads when a recording started from the name the recorder gave it", () => {
    expect(recordingStartFromName("Recording 2026-11-22 10-30")).toBe(
      new Date(2026, 10, 22, 10, 30).getTime(),
    );
    expect(recordingStartFromName("Recording 2026-11-22 10-30 1")).toBe(
      new Date(2026, 10, 22, 10, 30).getTime(),
    );
    expect(recordingStartFromName("Recording 2026-13-22 10-30")).toBeUndefined();
    expect(recordingStartFromName("Recording 2026-00-22 10-30")).toBeUndefined();
    expect(recordingStartFromName("Recording 2026-11-00 10-30")).toBeUndefined();
    expect(recordingStartFromName("Recording 2026-11-22 24-30")).toBeUndefined();
    expect(recordingStartFromName("Recording 2026-11-22 10-60")).toBeUndefined();
    expect(recordingStartFromName("lecture")).toBeUndefined();
  });

  it("knows audio files by their extension, in any case", () => {
    expect(isAudioPath("x/Rec.M4A")).toBe(true);
    expect(isAudioPath("x/rec.mp3")).toBe(true);
    expect(isAudioPath("x/photo.png")).toBe(false);
    expect(isAudioPath("noext")).toBe(false);
  });
});

describe("a recording in a note's file", () => {
  it("round-trips between paragraphs", () => {
    const note: TextNote = {
      blocks: [
        textBlock(id(), "title", [{ text: "Lecture", marks: 0 }]),
        { type: "audio", id: id(), path: "Lecture/Recordings/r.m4a", duration: 61_000 },
        textBlock(id(), "body", [{ text: "after", marks: 0 }]),
      ],
    };
    const body = encodeNote(note);
    expect(body).toBe("# Lecture\n![[Lecture/Recordings/r.m4a|1:01]]\nafter");
    const back = decodeNote(body, id).blocks;
    expect(back.map((b) => b.type)).toEqual(["text", "audio", "text"]);
    expect(back[1]).toMatchObject({ path: "Lecture/Recordings/r.m4a", duration: 61_000 });
  });

  it("separates a recording from a list above it, as a picture is", () => {
    const blocks: NoteBlock[] = [
      textBlock(id(), "bullet", [{ text: "point", marks: 0 }]),
      { type: "audio", id: id(), path: "r.m4a" },
    ];
    const body = encodeNote({ blocks });
    expect(body).toBe("* point\n\n![[r.m4a]]");
    expect(decodeNote(body, id).blocks.map((b) => b.type)).toEqual(["text", "audio"]);
  });

  it("escapes body text that would read as a recording", () => {
    const blocks = [textBlock(id(), "body", [{ text: "![[r.m4a]]", marks: 0 }])];
    const body = encodeNote({ blocks });
    expect(body).toBe("\\![[r.m4a]]");
    const back = decodeNote(body, id).blocks;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ type: "text", kind: "body" });
  });
});
