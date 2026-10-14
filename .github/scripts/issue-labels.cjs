// Labels for a new issue, read from the answers in the issue forms
// (.github/ISSUE_TEMPLATE). The body is untrusted text: it is only compared
// against the fixed answers below, and only labels from this file come out.

/* global module */

const AREA = [
  ["Writing, erasing or how the ink looks", "ink"],
  ["Shapes snapping (or not)", "ink"],
  ["Scrolling, zooming or the page jumping", "ui"],
  ["Handwriting recognition", "ink"],
  ["PDFs or pictures", "pdf"],
  ["Text boxes or the keyboard", "ui"],
];

const DEVICE = [
  ["iPad", "ipad"],
  ["iPhone", "ipad"],
  ["Android", "android"],
  ["Desktop", "desktop"],
];

const AREA_HEADING = "What is it about?";
const DEVICE_HEADINGS = ["Device", "Where would you use it?"];

/** The answer under a form's `### Heading`, or "" when it is not there. */
function answer(body, heading) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (start < 0) return "";
  const rest = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("### ")) break;
    rest.push(line);
  }
  return rest.join("\n").trim();
}

function labelsFor(body) {
  const text = typeof body === "string" ? body : "";
  const labels = new Set();
  const area = answer(text, AREA_HEADING);
  for (const [option, label] of AREA) {
    if (area.startsWith(option)) labels.add(label);
  }
  for (const heading of DEVICE_HEADINGS) {
    // A multiple-choice answer is the options joined by ", ".
    const picked = answer(text, heading)
      .split(",")
      .map((part) => part.trim());
    for (const choice of picked) {
      for (const [option, label] of DEVICE) {
        if (choice.startsWith(option)) labels.add(label);
      }
    }
  }
  return [...labels].sort();
}

module.exports = { labelsFor };
