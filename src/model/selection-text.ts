/** Text and HTML representations of a lasso selection containing only text boxes. */
import { type TextBoxElement } from "./document";
import { type MdSpan, parseMarkdown } from "./markdown-text";
import type { PageElements } from "./selection-commands";
import { fontFamilyOf, shownCase } from "./text-style";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function spanHtml(span: MdSpan): string {
  let html = escapeHtml(span.text);
  if (span.bold) html = `<strong>${html}</strong>`;
  if (span.italic) html = `<em>${html}</em>`;
  if (span.strike) html = `<s>${html}</s>`;
  if (span.code) html = `<code>${html}</code>`;
  if (span.mark) html = `<mark>${html}</mark>`;
  if (span.target && /^(https?:\/\/|mailto:)/i.test(span.target)) {
    html = `<a href="${escapeHtml(span.target)}">${html}</a>`;
  }
  return html;
}

function boxEmphasis(html: string, box: TextBoxElement): string {
  if (box.bold) html = `<strong>${html}</strong>`;
  if (box.italic) html = `<em>${html}</em>`;
  if (box.underline) html = `<u>${html}</u>`;
  if (box.strike) html = `<s>${html}</s>`;
  return html;
}

function contentOf(box: TextBoxElement): { text: string; html: string } {
  const shown = shownCase(box.text, box);
  if (!box.markdown) {
    return { text: shown, html: boxEmphasis(escapeHtml(shown).replace(/\r\n?|\n/g, "<br>"), box) };
  }

  const blocks = parseMarkdown(shown).map((block) => {
    const marker =
      block.kind === "bullet"
        ? "• "
        : block.kind === "number"
          ? `${block.marker} `
          : block.kind === "task"
            ? block.done
              ? "☑ "
              : "☐ "
            : "";
    const text = marker + block.spans.map((span) => span.text).join("");
    const html = boxEmphasis(escapeHtml(marker) + block.spans.map(spanHtml).join(""), box);
    switch (block.kind) {
      case "heading": {
        const tag = `h${block.level}`;
        return { text, html: `<${tag}>${html}</${tag}>` };
      }
      case "rule":
        return { text: "", html: "<hr>" };
      case "code":
        return { text, html: `<pre><code>${html}</code></pre>` };
      default:
        return {
          text,
          html: block.quote ? `<blockquote>${html}</blockquote>` : `<div>${html || "<br>"}</div>`,
        };
    }
  });
  return {
    text: blocks.map((block) => block.text).join("\n"),
    html: blocks.map((block) => block.html).join(""),
  };
}

function boxStyle(box: TextBoxElement): string {
  const color = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
  const align =
    box.align === "right" || box.align === "center" || box.align === "justify" ? box.align : "left";
  const decoration = [box.underline ? "underline" : "", box.strike ? "line-through" : ""].filter(
    Boolean,
  );
  return [
    "white-space:pre-wrap",
    `font-family:${fontFamilyOf(box)}`,
    `font-size:${box.fontSize}px`,
    `font-weight:${box.bold ? "bold" : "normal"}`,
    `font-style:${box.italic ? "italic" : "normal"}`,
    `text-align:${align}`,
    `line-height:${box.lineHeight ?? 1.25}`,
    decoration.length ? `text-decoration:${decoration.join(" ")}` : "",
    color.test(box.color) ? `color:${box.color}` : "",
    box.fill && color.test(box.fill) ? `background-color:${box.fill}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

/** Mixed selections use the image renderer. Pure text is copied in page reading order. */
export function selectionText(elements: PageElements): { text: string; html: string } | null {
  if (
    !elements.textBoxes.length ||
    elements.strokes.length ||
    elements.images.length ||
    elements.tables?.length ||
    elements.graphs?.length ||
    elements.equations?.length
  )
    return null;

  const boxes = [...elements.textBoxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const parts = boxes.map((box) => {
    const content = contentOf(box);
    return {
      text: content.text,
      html: `<div style="${escapeHtml(boxStyle(box))}">${content.html}</div>`,
    };
  });
  return {
    text: parts.map((part) => part.text).join("\n\n"),
    html: parts.map((part) => part.html).join(""),
  };
}
