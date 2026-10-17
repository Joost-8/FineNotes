/**
 * A saved Ask AI conversation as a markdown note, in an "AI chats" folder
 * beside the notebook. It reads as a normal note in Obsidian (each turn under
 * "You" or "AI"), links back to its notebook in the properties, and carries
 * what reopening it needs: which pages the conversation is about, so a
 * follow-up can send their images again (the images themselves are not
 * stored).
 *
 * Each turn starts with an HTML comment, invisible when the note is read,
 * which is what `parseChatFile` splits on: an answer's own headings can never
 * be mistaken for the next turn.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import type { AskScope } from "./ai-chat";

/** The folder beside a notebook that its saved chats go in. */
export const ASK_CHATS_FOLDER = "AI chats";

/** Marks a note as a FineNotes chat, and its format version. */
const CHAT_MARK = "finenotes-chat";
const TURN_MARK = (role: "user" | "assistant"): string => `<!-- ${CHAT_MARK}: ${role} -->`;
const TURN_RE = /^<!-- finenotes-chat: (user|assistant) -->$/;
const LABEL = { user: "### You", assistant: "### AI" } as const;

export interface SavedTurn {
  role: "user" | "assistant";
  text: string;
}

export interface SavedChat {
  /** The notebook's vault path, `.md` included. */
  notebook: string;
  scope: AskScope;
  /** 1-based, the pages the first question sent. */
  pageNumbers: number[];
  totalPages: number;
  /** ISO time of the first question. */
  created: string;
  turns: SavedTurn[];
}

/** A chat's title: its first question, on one line, cut at a word near 60 characters. */
export function chatTitle(turns: readonly SavedTurn[]): string {
  const first = turns.find((turn) => turn.role === "user")?.text ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  if (line.length <= 60) return line || "Chat";
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trim()}…`;
}

/**
 * The file name (no folder, `.md` included): the time it started, then its
 * title, so a folder of chats sorts oldest to newest and still says what each
 * is about. Characters no vault allows in a name are dropped.
 */
export function chatFileName(chat: Pick<SavedChat, "created" | "turns">): string {
  const date = new Date(chat.created);
  const stamp = Number.isNaN(date.getTime())
    ? "Chat"
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}.${pad(date.getMinutes())}`;
  const title = chatTitle(chat.turns)
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/…$/, "")
    .trim();
  return `${title ? `${stamp} ${title}` : stamp}.md`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The vault path of the AI chats folder for the notebook at `notebookPath`. */
export function chatsFolderFor(notebookPath: string): string {
  const slash = notebookPath.lastIndexOf("/");
  return slash <= 0 ? ASK_CHATS_FOLDER : `${notebookPath.slice(0, slash)}/${ASK_CHATS_FOLDER}`;
}

/** The note's text. */
export function buildChatFile(chat: SavedChat): string {
  const link = chat.notebook.replace(/\.md$/, "");
  // Every value is written as JSON, which is valid YAML and reads back exactly.
  const front = [
    "---",
    `${CHAT_MARK}: 1`,
    `notebook: ${JSON.stringify(`[[${link}]]`)}`,
    `scope: ${JSON.stringify(chat.scope)}`,
    `pages: ${JSON.stringify(chat.pageNumbers)}`,
    `total-pages: ${chat.totalPages}`,
    `created: ${JSON.stringify(chat.created)}`,
    "---",
  ];
  const body = chat.turns.map((turn) =>
    [TURN_MARK(turn.role), LABEL[turn.role], "", turn.text.trim()].join("\n"),
  );
  return `${front.join("\n")}\n\n# ${chatTitle(chat.turns)}\n\n${body.join("\n\n")}\n`;
}

/**
 * A chat read back from its note, or null when the note is not one. The
 * notebook comes back as the link's target (no `.md`), for the caller to
 * resolve: Obsidian keeps the link right when the notebook is renamed.
 */
export function parseChatFile(text: string): (SavedChat & { notebookLink: string }) | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  const props = new Map<string, unknown>();
  for (const line of lines.slice(1, end)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    try {
      props.set(line.slice(0, colon).trim(), JSON.parse(line.slice(colon + 1).trim()));
    } catch {
      // Edited by hand into something that is not JSON: not ours to read.
    }
  }
  if (props.get(CHAT_MARK) !== 1) return null;
  const notebook = props.get("notebook");
  const link =
    typeof notebook === "string" ? (/^\[\[([^\]|#]+)/.exec(notebook)?.[1]?.trim() ?? "") : "";
  const scope = props.get("scope") === "notebook" ? "notebook" : "page";
  const pages = props.get("pages");
  const pageNumbers = Array.isArray(pages)
    ? pages.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
    : [];
  const total = props.get("total-pages");
  const created = props.get("created");

  const turns: SavedTurn[] = [];
  let current: { role: SavedTurn["role"]; lines: string[] } | null = null;
  const close = (): void => {
    if (!current) return;
    const body = current.lines.slice();
    // The "### You" / "### AI" label under the marker is for reading, not content.
    while (body.length && !body[0].trim()) body.shift();
    if (body[0]?.trim() === LABEL[current.role]) body.shift();
    const text = body.join("\n").trim();
    if (text) turns.push({ role: current.role, text });
  };
  for (const line of lines.slice(end + 1)) {
    const mark = TURN_RE.exec(line.trim());
    if (mark) {
      close();
      current = { role: mark[1] as SavedTurn["role"], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  close();
  if (turns.length === 0 || turns[0].role !== "user") return null;

  return {
    notebook: link ? `${link}.md` : "",
    notebookLink: link,
    scope,
    pageNumbers,
    totalPages: typeof total === "number" && total > 0 ? total : pageNumbers.length,
    created: typeof created === "string" ? created : "",
    turns: alternating(turns),
  };
}

/**
 * Turns that alternate user, assistant, … as the APIs require; a hand edit
 * that put two of one role together is merged, not dropped.
 */
function alternating(turns: readonly SavedTurn[]): SavedTurn[] {
  const out: SavedTurn[] = [];
  for (const turn of turns) {
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.text = `${last.text}\n\n${turn.text}`;
    else out.push({ ...turn });
  }
  return out;
}
