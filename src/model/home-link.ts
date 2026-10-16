/**
 * The link that opens a notebook from outside Obsidian: a home-screen
 * shortcut on an iPad (the Shortcuts app's "Open URLs"), a desktop shortcut
 * or a bookmark. Obsidian's own `obsidian://open` URI, which the notebook
 * view routing then opens as a notebook.
 *
 * PURE: no DOM, no Obsidian.
 */

/** `obsidian://open?vault=…&file=…` for `path` (vault-relative) in the vault named `vault`. */
export function obsidianOpenUri(vault: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}`;
}
