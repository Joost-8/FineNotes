import { describe, expect, it, vi } from "vitest";
import { ASK_MAX_PAGES, type ChatTurn } from "../../src/recognition/ai-chat";
import type { SavedChat } from "../../src/recognition/ask-chat-file";
import {
  AskSession,
  type AskSessionDeps,
  pagesPhrase,
  shownText,
} from "../../src/recognition/ask-session";

const img = (page: number) => ({ base64: `P${page}`, mimeType: "image/png" as const });

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(over: Partial<AskSessionDeps> = {}) {
  const asked: ChatTurn[][] = [];
  const saved: Array<{ chat: SavedChat; path: string | null }> = [];
  const deps: AskSessionDeps = {
    notebookPath: () => "N.notebook.md",
    confirm: () => Promise.resolve(true),
    preparePages: vi.fn((pages: readonly number[]) =>
      Promise.resolve({ images: pages.map(img), pageNumbers: [...pages], totalPages: 9 }),
    ),
    ask: (turns) => {
      asked.push([...turns]);
      return Promise.resolve({ text: `answer ${asked.length}` });
    },
    save: (chat, path) => {
      saved.push({ chat, path });
      return Promise.resolve(path ?? "AI chats/c.md");
    },
    unsave: vi.fn(() => Promise.resolve()),
    readFile: vi.fn((path: string) =>
      Promise.resolve(
        path === "gone.pdf"
          ? null
          : { name: path, mimeType: "application/pdf", base64: "AGAIN", path },
      ),
    ),
    now: () => new Date("2026-10-17T13:00:00Z"),
    ...over,
  };
  return { deps, asked, saved };
}

const open = (deps: AskSessionDeps, save = false) =>
  new AskSession(deps, { page: 3, totalPages: 9, save });

describe("AskSession pages", () => {
  it("starts on the page being read and caps the pick at the limit", () => {
    const session = open(setup().deps);
    expect(session.selected).toEqual([3]);
    session.setSelection([9, 2, 2, 0, 12, 5]);
    expect(session.selected).toEqual([2, 5, 9]);
    session.setSelection(Array.from({ length: 9 }, (_, i) => i + 1));
    session.setTotalPages(20);
    for (let p = 10; p <= 20; p++) session.togglePage(p);
    expect(session.selected).toHaveLength(ASK_MAX_PAGES);
    session.togglePage(1);
    expect(session.selected).not.toContain(1);
    session.setTotalPages(4);
    expect(session.selected).toEqual([2, 3, 4]);
  });

  it("sends the picked pages with the first question, and only new ones later", async () => {
    const { deps, asked } = setup();
    const session = open(deps);
    session.draft = "half a thought";
    session.setSelection([2, 3]);
    await session.send("What is this?");
    expect(asked[0][0].images).toEqual([img(2), img(3)]);
    expect(asked[0][0].text).toBe(
      "The images are pages 2, 3 of 9, in that order.\n" +
        "The other pages of the notebook were not sent.\n\nWhat is this?",
    );
    expect(shownText(asked[0][0])).toBe("What is this?");

    await session.send("And this?");
    expect(asked[1][2]).toEqual({ role: "user", text: "And this?", shown: "And this?" });

    session.togglePage(7);
    await session.send("Now with 7?");
    expect(asked[2][4].images).toEqual([img(7)]);
    expect(asked[2][4].text).toBe("Another image: page 7 of 9.\n\nNow with 7?");
    expect([...session.sentPages].sort()).toEqual([2, 3, 7]);
    expect(session.draft).toBe("half a thought");
  });

  it("needs a page with something on it for the first question", async () => {
    const none = setup();
    const a = open(none.deps);
    a.setSelection([]);
    await a.send("x");
    expect(a.outstanding?.error).toMatch(/pick a page/);
    const blank = setup({
      preparePages: () => Promise.resolve({ images: [], pageNumbers: [], totalPages: 9 }),
    });
    const b = open(blank.deps);
    await b.send("x");
    expect(b.outstanding?.error).toMatch(/nothing on these pages/);
  });

  it("names pages in prose", () => {
    expect(pagesPhrase([4])).toBe("page 4");
    expect(pagesPhrase([2, 5, 7])).toBe("pages 2, 5 and 7");
  });
});

describe("AskSession files", () => {
  const pdf = {
    name: "Week 2.pdf",
    mimeType: "application/pdf",
    base64: "PDF",
    path: "L/Week 2.pdf",
  };
  const note = { name: "notes.md", mimeType: "text/plain", text: "# N" };

  it("sends attached files with the next question only, then clears them", async () => {
    const { deps, asked, saved } = setup();
    const session = open(deps, true);
    expect(session.attach(pdf)).toBeNull();
    expect(session.attach({ ...pdf })).toMatch(/already attached/);
    expect(session.attach(note)).toBeNull();
    session.detach(note);
    expect(session.attachments).toEqual([pdf]);
    const sent = session.send("Explain slide 4");
    expect(session.outstanding?.status).toBe("Reading page 3 and Week 2.pdf…");
    await sent;
    expect(asked[0][0].files).toEqual([pdf]);
    expect(session.attachments).toEqual([]);
    // Already in the chat: not again.
    expect(session.attach(pdf)).toMatch(/already attached/);
    await session.send("And slide 5?");
    expect(asked[1][2].files).toBeUndefined();
    expect(asked[1][0].files).toEqual([pdf]);
    expect(saved[1].chat.turns[0].files).toEqual([{ name: "Week 2.pdf", path: "L/Week 2.pdf" }]);
  });

  it("can ask about a file alone, and keeps the files when the question fails", async () => {
    const fail = setup({ ask: () => Promise.reject(new Error("HTTP 400")) });
    const a = open(fail.deps);
    a.setSelection([]);
    a.attach(note);
    await a.send("Summarise");
    expect(a.outstanding?.error).toBe("HTTP 400");
    expect(a.attachments).toEqual([note]);

    const { deps, asked } = setup();
    const b = open(deps);
    b.setSelection([]);
    b.attach(note);
    await b.send("Summarise");
    expect(asked[0][0]).toEqual({
      role: "user",
      text: "Summarise",
      shown: "Summarise",
      files: [note],
    });
    expect(deps.preparePages).not.toHaveBeenCalled();
  });

  it("reads a reloaded chat's vault files again, and goes on without the rest", async () => {
    const { deps, asked } = setup();
    const session = open(deps);
    session.attach(note);
    session.load(
      {
        notebook: "N.notebook.md",
        totalPages: 9,
        created: "2026-10-01T10:00:00.000Z",
        turns: [
          {
            role: "user",
            text: "Old?",
            files: [{ name: "Week 2.pdf", path: "L/Week 2.pdf" }, { name: "photo.jpg" }],
          },
          { role: "assistant", text: "Yes." },
          { role: "user", text: "Gone?", files: [{ name: "gone.pdf", path: "gone.pdf" }] },
          { role: "assistant", text: "No." },
        ],
      },
      "AI chats/old.md",
    );
    expect(session.attachments).toEqual([]);
    await session.send("New?");
    expect(deps.readFile).toHaveBeenCalledWith("L/Week 2.pdf");
    expect(asked[0][0].files).toEqual([
      { name: "L/Week 2.pdf", mimeType: "application/pdf", base64: "AGAIN", path: "L/Week 2.pdf" },
    ]);
    expect(asked[0][2].files).toEqual([]);
  });
});

describe("AskSession: the page it starts on, and the lasso's picture", () => {
  const picture = { name: "Selection.png", mimeType: "image/png", base64: "SEL" };

  it("starts on no page when the page is not attached (discussion #107)", () => {
    const session = new AskSession(setup().deps, {
      page: 3,
      totalPages: 9,
      save: false,
      attachPage: false,
    });
    expect(session.selected).toEqual([]);
    session.setSelection([5]);
    session.newChat(4);
    expect(session.selected).toEqual([]);
    session.attachPage = true;
    session.newChat(4);
    expect(session.selected).toEqual([4]);
    // Out of range: nothing.
    expect(new AskSession(setup().deps, { page: 12, totalPages: 9, save: false }).selected).toEqual(
      [],
    );
  });

  it("follows the page being read until something is attached or asked", async () => {
    const { deps } = setup();
    const session = open(deps);
    session.follow(5);
    expect(session.selected).toEqual([5]);
    session.attachPage = false;
    session.follow(6);
    expect(session.selected).toEqual([]);
    session.attachPage = true;
    session.attach(picture);
    session.setSelection([2]);
    session.follow(7);
    expect(session.selected).toEqual([2]);
    session.detach(picture);
    await session.send("What is this?");
    session.follow(7);
    expect(session.selected).toEqual([2]);
  });

  it("sends the selection's picture in place of the page", async () => {
    const { deps, asked } = setup();
    const session = open(deps);
    expect(session.attachInstead(picture)).toBeNull();
    expect(session.selected).toEqual([]);
    await session.send("What does this say?");
    expect(deps.preparePages).not.toHaveBeenCalled();
    expect(asked[0][0].files).toEqual([picture]);
    expect(session.attachInstead({ ...picture })).toMatch(/already attached/);
  });

  it("keeps the pages a running chat already has, and drops the ones not yet sent", async () => {
    const { deps, asked } = setup();
    const session = open(deps);
    await session.send("Page 3?");
    session.setSelection([3, 6]);
    expect(session.attachInstead(picture)).toBeNull();
    expect(session.selected).toEqual([3]);
    await session.send("And this?");
    expect(asked[1][2].pages).toBeUndefined();
    expect(asked[1][2].files).toEqual([picture]);
  });
});

describe("AskSession tools", () => {
  it("shows what the tools are doing, and keeps what they did with the answer", async () => {
    const seen: string[] = [];
    const holder: { session?: AskSession } = {};
    const { deps, asked } = setup({
      ask: (turns, onStatus) => {
        asked.push([...turns]);
        onStatus("Reading page 5…");
        seen.push(holder.session?.outstanding?.status ?? "");
        return Promise.resolve({ text: "", actions: ["Added a text box on page 5"] });
      },
    });
    const session = open(deps);
    holder.session = session;
    await session.send("Write a summary on page 5");
    expect(seen).toEqual(["Reading page 5…"]);
    // An answer that is only actions still has words in the history.
    expect(session.turns[1]).toEqual({
      role: "assistant",
      text: "Added a text box on page 5",
      actions: ["Added a text box on page 5"],
    });
  });
});

describe("AskSession conversation", () => {
  it("shows the question while it waits, and reports a failure without keeping it", async () => {
    const answer = deferred<{ text: string }>();
    const { deps } = setup({ ask: () => answer.promise });
    const session = open(deps);
    const changes = vi.fn();
    session.onChange(changes);
    const sent = session.send("Why?");
    await Promise.resolve();
    expect(session.busy).toBe(true);
    expect(session.empty).toBe(false);
    expect(session.outstanding?.question).toBe("Why?");
    answer.reject(new Error("HTTP 529"));
    await sent;
    expect(session.busy).toBe(false);
    expect(session.outstanding).toEqual({ question: "Why?", status: "", error: "HTTP 529" });
    expect(session.turns).toEqual([]);
    expect(changes).toHaveBeenCalled();
    session.dismissError();
    expect(session.empty).toBe(true);
  });

  it("drops a declined question quietly", async () => {
    const { deps, asked } = setup({ confirm: () => Promise.resolve(false) });
    const session = open(deps);
    await session.send("x");
    expect(session.outstanding).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it("saves after every answer when asked to, at the same path, pages per question", async () => {
    const { deps, saved } = setup();
    const session = open(deps, true);
    await session.send("One");
    session.togglePage(5);
    await session.send("Two");
    expect(saved.map((s) => s.path)).toEqual([null, "AI chats/c.md"]);
    expect(saved[1].chat).toEqual({
      notebook: "N.notebook.md",
      totalPages: 9,
      created: "2026-10-17T13:00:00.000Z",
      turns: [
        { role: "user", text: "One", pages: [3] },
        { role: "assistant", text: "answer 1" },
        { role: "user", text: "Two", pages: [5] },
        { role: "assistant", text: "answer 2" },
      ],
    });
    expect(session.savedPath).toBe("AI chats/c.md");
  });

  it("can be switched to saving after the fact, and back off, which removes the file", async () => {
    const { deps, saved } = setup();
    const session = open(deps);
    await session.setSave(true); // nothing to save yet
    await session.setSave(false);
    expect(saved).toHaveLength(0);
    await session.send("Q");
    expect(saved).toHaveLength(0);
    await session.setSave(true);
    expect(saved).toHaveLength(1);
    await session.setSave(false);
    expect(deps.unsave).toHaveBeenCalledWith("AI chats/c.md");
    expect(session.savedPath).toBeNull();
  });

  it("refuses a new chat while busy, and starts the next on the given page", async () => {
    const answer = deferred<{ text: string }>();
    const { deps } = setup({ ask: () => answer.promise });
    const session = open(deps);
    const sent = session.send("Old");
    await Promise.resolve();
    session.newChat(6);
    expect(session.outstanding?.question).toBe("Old");
    answer.resolve({ text: "late" });
    await sent;
    session.newChat(6);
    expect(session.turns).toEqual([]);
    expect(session.selected).toEqual([6]);
    session.newChat(40);
    expect(session.selected).toEqual([]);
  });

  it("continues a loaded chat, rendering each question's pages again once", async () => {
    const { deps, asked, saved } = setup();
    const session = open(deps);
    session.load(
      {
        notebook: "N.notebook.md",
        totalPages: 9,
        created: "2026-10-01T10:00:00.000Z",
        turns: [
          { role: "user", text: "Old?", pages: [2, 5] },
          { role: "assistant", text: "Yes." },
          { role: "user", text: "More?", pages: [8] },
          { role: "assistant", text: "No." },
        ],
      },
      "AI chats/old.md",
    );
    expect(session.save).toBe(true);
    expect(session.selected).toEqual([2, 5, 8]);
    await session.send("New?");
    expect(deps.preparePages).toHaveBeenCalledWith([2, 5]);
    expect(deps.preparePages).toHaveBeenCalledWith([8]);
    expect(asked[0][0].images).toEqual([img(2), img(5)]);
    // The page lines are rebuilt for the model, and stay out of what is shown and saved.
    expect(asked[0][0].text).toBe(
      "The images are pages 2, 5 of 9, in that order.\n" +
        "The other pages of the notebook were not sent.\n\nOld?",
    );
    expect(asked[0][2].text).toBe("Another image: page 8 of 9.\n\nMore?");
    expect(asked[0][4]).toEqual({ role: "user", text: "New?", shown: "New?" });
    expect(saved[0].chat.turns[0]).toEqual({ role: "user", text: "Old?", pages: [2, 5] });
    expect(saved[0].path).toBe("AI chats/old.md");
    expect(saved[0].chat.created).toBe("2026-10-01T10:00:00.000Z");
    await session.send("Again?");
    expect(deps.preparePages).toHaveBeenCalledTimes(2);
  });
});
