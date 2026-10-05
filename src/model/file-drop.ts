/** Vault paths carried by native drag data; external files use DataTransfer.files. */
export function vaultPathFromDrop(text: string): string | null {
  let path = text.trim();
  if (/^obsidian:\/\/open\?/i.test(path)) {
    try {
      path = new URL(path).searchParams.get("file") ?? "";
    } catch {
      return null;
    }
  } else {
    const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(path);
    if (wiki) path = wiki[1].split("|")[0];
    const markdown = /^!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)$/.exec(path);
    if (markdown) {
      try {
        path = decodeURIComponent(markdown[1] ?? markdown[2]);
      } catch {
        return null;
      }
    }
  }
  path = path.split("#")[0];
  if (!path || /[\r\n]/.test(path) || /^[a-z]+:\/\//i.test(path)) return null;
  return path;
}
