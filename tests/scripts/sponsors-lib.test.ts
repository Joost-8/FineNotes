import { describe, expect, it } from "vitest";
import {
  README_END,
  README_START,
  mergeSponsors,
  readmeBlock,
  replaceBlock,
  stampRelease,
} from "../../scripts/sponsors-lib.mjs";

describe("mergeSponsors", () => {
  const list = [
    { login: "ann", name: "Ann", release: "2.8.0" },
    { login: "bo", name: "", release: "2.9.0" },
  ];

  it("adds new sponsors at the end, waiting for a release", () => {
    const merged = mergeSponsors(list, [
      { login: "ann", name: "Ann" },
      { login: "cy", name: null },
    ]);
    expect(merged).toEqual([...list, { login: "cy", name: "", release: "" }]);
  });

  it("keeps a sponsor who stopped, and their release", () => {
    expect(mergeSponsors(list, [])).toEqual(list);
  });

  it("takes the profile's name now, matching logins in any case", () => {
    const merged = mergeSponsors(list, [{ login: "BO", name: "Bo Diaz" }]);
    expect(merged[1]).toEqual({ login: "bo", name: "Bo Diaz", release: "2.9.0" });
    expect(merged).toHaveLength(2);
  });
});

describe("stampRelease", () => {
  it("stamps only the sponsors still waiting", () => {
    const list = [
      { login: "ann", name: "", release: "2.8.0" },
      { login: "bo", name: "", release: "" },
    ];
    expect(stampRelease(list, "2.10.0").map((x: { release: string }) => x.release)).toEqual([
      "2.8.0",
      "2.10.0",
    ]);
  });

  it("refuses a beta or a typo", () => {
    expect(() => stampRelease([], "2.10.0-beta.1")).toThrow();
    expect(() => stampRelease([], "v2.10")).toThrow();
  });
});

describe("the README block", () => {
  const readme = `top\n${README_START}\nold\n${README_END}\nbottom\n`;

  it("shows avatars newest first, linked to the profile, names escaped", () => {
    const block = readmeBlock([
      { login: "ann", name: 'Ann "A" <Lee>', release: "2.8.0" },
      { login: "bo", name: "", release: "" },
    ]);
    const lines = block.split("\n");
    expect(lines[2]).toContain('href="https://github.com/bo" title="bo"');
    expect(lines[3]).toContain('title="Ann &quot;A&quot; &lt;Lee&gt;"');
    expect(lines[3]).toContain('src="https://github.com/ann.png?size=96"');
  });

  it("replaces only what sits between the markers, and again the same way", () => {
    const once = replaceBlock(readme, "new");
    expect(once).toBe(`top\n${README_START}\n\nnew\n${README_END}\nbottom\n`);
    expect(replaceBlock(once, "new")).toBe(once);
  });

  it("is empty with no sponsors", () => {
    expect(replaceBlock(readme, readmeBlock([]))).toBe(
      `top\n${README_START}\n${README_END}\nbottom\n`,
    );
  });

  it("refuses a README without the markers", () => {
    expect(() => replaceBlock("no markers", "x")).toThrow();
  });
});
