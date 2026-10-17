import { describe, expect, it } from "vitest";
import {
  ASK_CHATS_FOLDER,
  type SavedChat,
  buildChatFile,
  chatFileName,
  chatTitle,
  chatsFolderFor,
  parseChatFile,
} from "../../src/recognition/ask-chat-file";

const chat: SavedChat = {
  notebook: "Computer Science/Algebra/Lectures.notebook.md",
  scope: "page",
  pageNumbers: [13],
  totalPages: 20,
  created: "2026-10-17T13:02:00.000Z",
  turns: [
    { role: "user", text: "What is a group homomorphism?" },
    {
      role: "assistant",
      text: "## Definition\n\nA map with $f(ab) = f(a)f(b)$.\n\n### You\n\n- kernel\n- image",
    },
    { role: "user", text: "Give an example\non two lines" },
    { role: "assistant", text: "The determinant." },
  ],
};

describe("chat files", () => {
  it("round-trips a conversation, headings and lookalike labels in answers included", () => {
    const text = buildChatFile(chat);
    const back = parseChatFile(text);
    expect(back).toEqual({
      ...chat,
      notebookLink: "Computer Science/Algebra/Lectures.notebook",
    });
  });

  it("reads as a note: properties, a title, and You / AI under each turn", () => {
    const text = buildChatFile(chat);
    expect(text.startsWith("---\nfinenotes-chat: 1\n")).toBe(true);
    expect(text).toContain('notebook: "[[Computer Science/Algebra/Lectures.notebook]]"');
    expect(text).toContain("\n# What is a group homomorphism?\n");
    expect(text).toContain("### You\n\nWhat is a group homomorphism?");
    expect(text).toContain("### AI\n\nThe determinant.");
  });

  it("is not fooled by notes that are not chats", () => {
    expect(parseChatFile("# Just a note")).toBeNull();
    expect(parseChatFile("---\ntitle: x\n---\nbody")).toBeNull();
    expect(parseChatFile("---\nfinenotes-chat: 1\n")).toBeNull();
    // A chat whose turns were all deleted by hand.
    expect(parseChatFile("---\nfinenotes-chat: 1\n---\n# Empty\n")).toBeNull();
  });

  it("survives hand edits: CRLF, junk properties, two answers in a row", () => {
    const text = buildChatFile(chat)
      .replace('scope: "page"', "scope: not json")
      .replace(
        "<!-- finenotes-chat: user -->\n### You\n\nGive an example",
        "<!-- finenotes-chat: assistant -->\n### AI\n\nAlso this.",
      )
      .replace(/\n/g, "\r\n");
    const back = parseChatFile(text)!;
    expect(back.scope).toBe("page");
    expect(back.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(back.turns[1].text).toContain("Also this.");
  });

  it("names a file by its start time and first question", () => {
    const local = new Date(2026, 9, 17, 15, 2).toISOString();
    expect(chatFileName({ ...chat, created: local })).toBe(
      "2026-10-17 15.02 What is a group homomorphism.md",
    );
    const long = [{ role: "user" as const, text: `Explain ${"very ".repeat(20)}carefully` }];
    expect(chatTitle(long).endsWith("…")).toBe(true);
    expect(chatTitle(long).length).toBeLessThanOrEqual(61);
    expect(chatFileName({ created: "nonsense", turns: long })).not.toContain("…");
    expect(chatTitle([])).toBe("Chat");
  });

  it("puts the folder beside the notebook", () => {
    expect(chatsFolderFor("A/B/N.notebook.md")).toBe(`A/B/${ASK_CHATS_FOLDER}`);
    expect(chatsFolderFor("N.notebook.md")).toBe(ASK_CHATS_FOLDER);
  });
});
