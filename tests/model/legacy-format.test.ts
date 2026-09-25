/**
 * Notes written before 0.2.0 carry the on-disk names of InkedMark, the project
 * GoodObsidian grew out of: an `inkedmark: true` frontmatter flag, an
 * `inkedmark-version` key, a `%%inkedmark … %%` data block and an
 * `<!--inkedmark-text-->` managed section.
 * Every reader accepts them; every writer emits the current names, so a note
 * migrates the first time it is saved and nothing the user wrote is touched.
 */

import { describe, expect, it } from "vitest";
import { emptyDocument } from "../../src/model/document";
import {
  buildInkFile,
  encodeDocument,
  migrateFrontmatter,
  parseInkFile,
} from "../../src/model/serialize";
import { readTextSection, writeTextSection } from "../../src/recognition/text-layer";

const payload = encodeDocument(emptyDocument(1024));
const legacyBody =
  "---\ninkedmark: true\ninkedmark-version: 2\ntags: [lecture]\n---\n\n# Title\n\n" +
  "Prose the user typed.\n\n<!--inkedmark-text-->\nrecognised text\n<!--/inkedmark-text-->\n";
const legacyNote = `${legacyBody}\n%%inkedmark\n${payload}\n%%\n`;

describe("notes written before 0.2.0 still open", () => {
  it("reads the %%inkedmark data block", () => {
    const parsed = parseInkFile(legacyNote);
    expect(parsed.doc).not.toBeNull();
    expect(parsed.body).not.toContain("%%inkedmark");
    expect(parsed.body).toContain("Prose the user typed.");
  });

  it("saves back with the current names, leaving the user's frontmatter and prose alone", () => {
    const parsed = parseInkFile(legacyNote);
    const saved = buildInkFile(parsed.body, parsed.doc ?? emptyDocument(1024));
    expect(saved).toMatch(
      /^---\ngoodobsidian: true\ngoodobsidian-version: 2\ntags: \[lecture\]\n---\n/,
    );
    expect(saved).toMatch(/%%goodobsidian\nv2:[A-Za-z0-9+/=]+\n%%\n$/);
    expect(saved).toContain("Prose the user typed.");
    // The managed section is left as it was until something writes to it.
    expect(saved).toContain("<!--inkedmark-text-->\nrecognised text\n<!--/inkedmark-text-->");
    expect(saved).not.toContain("%%inkedmark");
    expect(saved).not.toContain("inkedmark: true");
    // Re-reading the saved note works the same way.
    expect(parseInkFile(saved).doc).not.toBeNull();
  });

  it("renames only the two keys, and only inside the leading frontmatter", () => {
    expect(migrateFrontmatter("no frontmatter\ninkedmark: true")).toBe(
      "no frontmatter\ninkedmark: true",
    );
    expect(migrateFrontmatter("---\ninkedmark: true\nnote: inkedmark: kept\n---\nbody")).toBe(
      "---\ngoodobsidian: true\nnote: inkedmark: kept\n---\nbody",
    );
    expect(migrateFrontmatter("---\nunterminated")).toBe("---\nunterminated");
  });

  it("reads and rewrites the managed text section with the current markers", () => {
    expect(readTextSection(legacyBody)).toBe("recognised text");
    const updated = writeTextSection(legacyBody, "new text");
    expect(updated).toContain("<!--goodobsidian-text-->\nnew text\n<!--/goodobsidian-text-->");
    expect(updated).not.toContain("inkedmark-text");
    expect(updated.match(/goodobsidian-text-->/g)).toHaveLength(2);
    expect(updated).toContain("Prose the user typed.");
  });
});
