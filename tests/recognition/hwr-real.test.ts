/**
 * The on-device recogniser against its Python reference on Joost's own
 * copy-sheet ink with the real (research-only) model and LM. Neither is in
 * the repository: both are made on his laptop by
 * research/handwriting-rig/export_hwr.py and export_port_fixtures.py
 * --private, so this suite runs there and is skipped everywhere else.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import { type GoldenLine, type GoldenPage, checkLine, checkPage } from "./hwr-golden";

const FIXTURE = "research/handwriting-rig/out/port-fixtures/real.json";
const present = existsSync(FIXTURE);

interface RealFixture {
  /** Absolute path of the model file the fixture was made with. */
  bundle: string;
  lines: GoldenLine[];
  pages: GoldenPage[];
}

describe.skipIf(!present)("Joost's ink with the real model (local only)", () => {
  const fixture = present ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as RealFixture) : null;
  const bundle =
    fixture && existsSync(fixture.bundle) ? parseBundle(readFileSync(fixture.bundle)) : null;

  it("has the model the fixture was made with", () => {
    expect(bundle?.meta.net).toMatchObject({ layers: 5, hidden: 128, inputs: 4 });
  });

  // The plain JavaScript forward pass is checked on two lines only: it takes
  // about a second a line, ten under coverage.
  (fixture?.lines ?? []).forEach((line, i) => {
    it(`reads a line as the reference: ${line.name}`, () => {
      if (!bundle) return;
      const { featureDiff, logpDiff } = checkLine(bundle, line, 1e-4, i < 2);
      expect(featureDiff).toBeLessThan(1e-6);
      expect(logpDiff).toBeLessThan(1e-4);
    }, 60_000);
  });

  for (const page of fixture?.pages ?? []) {
    it(`finds and reads a page's lines as the reference: ${page.name}`, () => {
      checkPage(bundle, page);
    }, 60_000);
  }
});
