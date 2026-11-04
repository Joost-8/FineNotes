/**
 * The Home file: a note at the vault's root that opens the notebook library
 * instead of itself. It is made once for a new install, in a vault with no
 * notes yet, so a person who closes the welcome still has something to click;
 * deleting it changes nothing. Only the note FineNotes made, marked by its
 * frontmatter, opens the library: a Home.md of the user's own stays theirs.
 */

export const HOME_FILE = "Home.md";

/** The frontmatter key that marks the Home note as FineNotes' own. */
export const HOME_FILE_FLAG = "finenotes-home";

export const HOME_FILE_TEXT =
  `---\n${HOME_FILE_FLAG}: true\n---\n\n` +
  "# Home\n\n" +
  "Opening this note opens your notebook library: every notebook as a cover, with a New " +
  "button to make one. You can delete this note whenever you like; nothing depends on it. " +
  "The library is also the books icon in the left bar.\n";

/** Whether `text` is the Home note FineNotes made: its frontmatter carries the flag. */
export function isOwnHomeText(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return false;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") return false;
    const [key, ...value] = line.split(":");
    if (key?.trim() === HOME_FILE_FLAG) return value.join(":").trim() === "true";
  }
  return false;
}
