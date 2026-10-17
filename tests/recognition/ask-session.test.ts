import { describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "../../src/recognition/ai-chat";
import type { SavedChat } from "../../src/recognition/ask-chat-file";
import { AskSession, type AskSessionDeps } from "../../src/recognition/ask-session";

const png = { base64: "PAGE", mimeType: "image/png" as const };

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
    prepare: () => Promise.resolve({ images: [png], pageNumbers: [3], totalPages: 9 }),
    preparePages: vi.fn(() => Promise.resolve({ images: [png], pageNumbers: [3], totalPages: 9 })),
    ask: (turns) => {
      asked.push([...turns]);
      return Promise.resolve(`answer ${asked.length}`);
    },
    save: (chat, path) => {
      saved.push({ chat, path });
      return Promise.resolve(path ?? "AI chats/c.md");
    },
    unsave: vi.fn(() => Promise.resolve()),
    now: () => new Date("2026-10-17T13:00:00Z"),
    ...over,
  };
  return { deps, asked, saved };
}

describe("AskSession", () => {
  it("sends the pages with the first question only, and keeps the draft untouched", async () => {
    const { deps, asked } = setup();
    const session = new AskSession(deps, "page", false);
    session.draft = "half a thought";
    await session.send("What is this?");
    await session.send("And this?");
    expect(asked[0][0].images).toEqual([png]);
    expect(asked[1].map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(asked[1][2]).toEqual({ role: "user", text: "And this?" });
    expect(session.turns).toHaveLength(4);
    expect(session.draft).toBe("half a thought");
  });

  it("shows the question while it waits, and reports a failure without keeping it", async () => {
    const answer = deferred<string>();
    const { deps } = setup({ ask: () => answer.promise });
    const session = new AskSession(deps, "page", false);
    const changes = vi.fn();
    session.onChange(changes);
    const sent = session.send("Why?");
    await Promise.resolve();
    expect(session.busy).toBe(true);
    expect(session.outstanding?.question).toBe("Why?");
    answer.reject(new Error("HTTP 529"));
    await sent;
    expect(session.busy).toBe(false);
    expect(session.outstanding).toEqual({ question: "Why?", status: "", error: "HTTP 529" });
    expect(session.turns).toEqual([]);
    expect(changes).toHaveBeenCalled();
    session.dismissError();
    expect(session.outstanding).toBeNull();
  });

  it("refuses an empty page set, and drops a declined question quietly", async () => {
    const empty = setup({
      prepare: () => Promise.resolve({ images: [], pageNumbers: [], totalPages: 2 }),
    });
    const a = new AskSession(empty.deps, "page", false);
    await a.send("x");
    expect(a.outstanding?.error).toMatch(/nothing on these pages/);
    const declined = setup({ confirm: () => Promise.resolve(false) });
    const b = new AskSession(declined.deps, "page", false);
    await b.send("x");
    expect(b.outstanding).toBeNull();
    expect(declined.asked).toHaveLength(0);
  });

  it("saves after every answer when asked to, at the same path", async () => {
    const { deps, saved } = setup();
    const session = new AskSession(deps, "notebook", true);
    await session.send("One");
    await session.send("Two");
    expect(saved.map((s) => s.path)).toEqual([null, "AI chats/c.md"]);
    expect(saved[1].chat).toMatchObject({
      notebook: "N.notebook.md",
      scope: "notebook",
      pageNumbers: [3],
      totalPages: 9,
      created: "2026-10-17T13:00:00.000Z",
    });
    expect(saved[1].chat.turns.map((t) => t.text)).toEqual(["One", "answer 1", "Two", "answer 2"]);
    // The saved text is the question as typed, not the line naming the pages.
    expect(session.savedPath).toBe("AI chats/c.md");
  });

  it("can be switched to saving after the fact, and back off, which removes the file", async () => {
    const { deps, saved } = setup();
    const session = new AskSession(deps, "page", false);
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

  it("drops an answer to a chat that was replaced meanwhile", async () => {
    const answer = deferred<string>();
    const { deps } = setup({ ask: () => answer.promise });
    const session = new AskSession(deps, "page", false);
    const sent = session.send("Old");
    await Promise.resolve();
    session.newChat(); // refused while busy
    expect(session.outstanding?.question).toBe("Old");
    answer.resolve("late");
    await sent;
    session.newChat("notebook");
    expect(session.scope).toBe("notebook");
    expect(session.turns).toEqual([]);
  });

  it("continues a loaded chat, rendering its pages again for the follow-up", async () => {
    const { deps, asked, saved } = setup();
    const session = new AskSession(deps, "page", false);
    session.load(
      {
        notebook: "N.notebook.md",
        scope: "notebook",
        pageNumbers: [2, 5],
        totalPages: 9,
        created: "2026-10-01T10:00:00.000Z",
        turns: [
          { role: "user", text: "Old?" },
          { role: "assistant", text: "Yes." },
        ],
      },
      "AI chats/old.md",
    );
    expect(session.save).toBe(true);
    expect(session.scope).toBe("notebook");
    await session.send("New?");
    expect(deps.preparePages).toHaveBeenCalledWith([2, 5]);
    expect(asked[0][0].images).toEqual([png]);
    // The page line is rebuilt for the model, and stays out of what is shown and saved.
    expect(asked[0][0].text).toBe("The image is page 3 of 9.\n\nOld?");
    expect(saved[0].chat.turns[0].text).toBe("Old?");
    expect(saved[0].path).toBe("AI chats/old.md");
    expect(saved[0].chat.created).toBe("2026-10-01T10:00:00.000Z");
    // Rendered once: the images stay on the first question for the next follow-up.
    await session.send("Again?");
    expect(deps.preparePages).toHaveBeenCalledTimes(1);
  });
});
