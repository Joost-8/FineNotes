/**
 * Shaping the export for its trip into Claude Design. Every file goes up as
 * text inside a tool call, and is read back line by line, so:
 *
 * - no line may be long (a reader truncates long lines): HTML is broken
 *   inside tags, where a newline is only whitespace between attributes and
 *   never becomes a text node; CSS gets one declaration per line;
 * - no file may be large (one tool call carries one file): stylesheets and
 *   pages.js are cut into parts at rule / entry boundaries.
 *
 * Nothing here changes what a page renders.
 */

export const MAX_LINE = 1200;
export const MAX_PART = 24_000;

/** Split `text` at `sep` characters that are outside quotes and brackets. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Break a long run of text at spaces, keeping each piece under MAX_LINE. */
function breakAtSpaces(value: string): string {
  if (value.length <= MAX_LINE) return value;
  const out: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    if (line && line.length + word.length + 1 > MAX_LINE) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  out.push(line);
  return out.join("\n");
}

/** A JSON value with newlines between tokens (after commas outside strings). */
function breakJson(json: string): string {
  if (json.length <= MAX_LINE) return json;
  let out = "";
  let line = 0;
  let inStr = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    out += c;
    line++;
    if (inStr) {
      if (c === "\\") {
        out += json[++i];
        line++;
      } else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "," && line > MAX_LINE / 2) {
      out += "\n";
      line = 0;
    }
  }
  return out;
}

/**
 * Long runs of text (a changelog paragraph) break at a space: in normal
 * flow a newline is a space. Never inside <textarea>, <pre>, <style> or
 * <script>, whose text is taken as written.
 */
function breakLongText(html: string): string {
  let out = "";
  let line = 0;
  let verbatim: string | null = null;
  for (const piece of html.split(/(<[^>]*>)/)) {
    if (piece.startsWith("<")) {
      const tag = /^<\/?([a-zA-Z]+)/.exec(piece)?.[1]?.toLowerCase() ?? "";
      if (["textarea", "pre", "style", "script"].includes(tag))
        verbatim = piece.startsWith("</") ? null : tag;
      out += piece;
      const nl = piece.lastIndexOf("\n");
      line = nl < 0 ? line + piece.length : piece.length - nl - 1;
      continue;
    }
    if (verbatim) {
      out += piece;
      line += piece.length;
      continue;
    }
    for (const ch of piece) {
      if (ch === "\n") line = 0;
      if (ch === " " && line > MAX_LINE / 2) {
        out += "\n";
        line = 0;
      } else {
        out += ch;
        line++;
      }
    }
  }
  return out;
}

export function wrapHtml(html: string): string {
  // A newline right after a tag name: `<div\nclass="…">`.
  let out = html.replace(/<([a-zA-Z][\w-]*) /g, "<$1\n");
  // What is still long is an attribute value: path data and styles take a
  // newline anywhere a space is; paint data (JSON) between tokens.
  out = out.replace(
    / (d|points|style)="([^"]{400,})"/g,
    (_m, name: string, v: string) => ` ${name}="${breakAtSpaces(v)}"`,
  );
  out = out.replace(
    /data-gallery-paint='([^']{400,})'/g,
    (_m, v: string) => `data-gallery-paint='${breakJson(v)}'`,
  );
  return breakLongText(out);
}

/** Path data longer than a line, as an array of pieces paper.js joins with spaces. */
export function chunkPaths(ops: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return ops.map((op) => {
    const d = op.d;
    if (typeof d !== "string" || d.length <= 800) return op;
    return { ...op, d: breakAtSpaces(d.replace(/\n/g, " ")).split("\n") };
  });
}

/** `sel {a: 1; b: 2}` one rule per line → one declaration per line. */
export function formatCss(css: string): string {
  return css
    .split("\n")
    .map((line) => {
      const m = /^([^{}]*)\{(.*)\}\s*$/.exec(line);
      if (!m || line.length <= MAX_LINE) return line;
      const decls = splitTopLevel(m[2], ";")
        .map((d) => d.trim())
        .filter(Boolean);
      return `${m[1].trim()} {\n${decls.map((d) => `  ${breakAtSpaces(d)};`).join("\n")}\n}`;
    })
    .join("\n");
}

/** Top-level CSS blocks as exact text slices (comments stay with what follows). */
function cssChunks(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push(src.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  if (start < src.length) out.push(src.slice(start));
  return out;
}

/**
 * One rule too big for a part, as several rules with the same selector and
 * its declarations shared out in order: the cascade reads them the same.
 */
function splitRule(chunk: string): string[] {
  const m = /^([^{]*)\{([\s\S]*)\}\s*$/.exec(chunk);
  if (!m || m[1].trim().startsWith("@")) return [chunk];
  const decls = splitTopLevel(m[2], ";")
    .map((d) => d.trim())
    .filter(Boolean);
  const out: string[] = [];
  let group: string[] = [];
  let size = 0;
  for (const d of decls) {
    if (group.length && size + d.length > MAX_PART / 2) {
      out.push(`\n${m[1].trim()} {\n${group.map((g) => `  ${g};`).join("\n")}\n}`);
      group = [];
      size = 0;
    }
    group.push(d);
    size += d.length + 4;
  }
  if (group.length) out.push(`\n${m[1].trim()} {\n${group.map((g) => `  ${g};`).join("\n")}\n}`);
  return out;
}

/** Cut a stylesheet into parts of at most MAX_PART chars, at rule boundaries. */
export function splitCssParts(src: string): string[] {
  const parts: string[] = [];
  let part = "";
  const chunks = cssChunks(src).flatMap((c) => (c.length > MAX_PART ? splitRule(c) : [c]));
  for (const chunk of chunks) {
    if (part && part.length + chunk.length > MAX_PART) {
      parts.push(part);
      part = "";
    }
    part += chunk;
  }
  if (part) parts.push(part);
  return parts;
}

/** A JS literal of `value` with no long lines: long strings are split into `"…" +` pieces. */
export function jsLiteral(value: unknown, indent = ""): string {
  if (typeof value === "string") {
    const s = JSON.stringify(value);
    if (s.length <= MAX_LINE) return s;
    const pieces: string[] = [];
    for (let i = 0; i < value.length; i += 900)
      pieces.push(JSON.stringify(value.slice(i, i + 900)));
    return pieces.join(` +\n${indent}  `);
  }
  if (Array.isArray(value)) {
    const flat = JSON.stringify(value);
    if (flat.length <= 200) return flat;
    return `[\n${value.map((v) => `${indent}  ${jsLiteral(v, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const flat = JSON.stringify(value);
    if (flat.length <= 200) return flat;
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${indent}  ${JSON.stringify(k)}: ${jsLiteral(v, `${indent}  `)}`,
    );
    return `{\n${entries.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** A table spread over several scripts, each adding its entries to `window[name]`. */
export function splitTableScripts(
  name: string,
  table: Record<string, unknown>,
  header: string,
): string[] {
  const scripts: string[] = [];
  let entries: string[] = [];
  let size = 0;
  const flush = (): void => {
    scripts.push(
      `${header}window.${name} = Object.assign(window.${name} || {}, {\n${entries.join(",\n")}\n});\n`,
    );
    entries = [];
    size = 0;
  };
  for (const [key, value] of Object.entries(table)) {
    const entry = `  ${JSON.stringify(key)}: ${jsLiteral(value, "  ")}`;
    if (entries.length && size + entry.length > MAX_PART) flush();
    entries.push(entry);
    size += entry.length;
  }
  if (entries.length || scripts.length === 0) flush();
  return scripts;
}
