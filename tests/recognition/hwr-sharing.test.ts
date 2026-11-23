import { describe, expect, it } from "vitest";
import {
  type Correction,
  type CorrectionsFile,
  parseCorrections,
  serializeCorrections,
} from "../../src/recognition/hwr/corrections";
import {
  CONSENT_VERSION,
  MAX_BATCH_BYTES,
  SHARE_FORMAT,
  SHARE_LICENCE,
  type ShareClient,
  type SharingLedger,
  agree,
  buildBatches,
  consentChanges,
  correctionDrafts,
  correctionKind,
  countByKind,
  deleteDone,
  emptyLedger,
  inviteDismissed,
  isEquationLabel,
  itemId,
  markDeclined,
  markSent,
  mergeLedgers,
  parseLedger,
  pendingItems,
  practiceDrafts,
  requestDelete,
  serializeLedger,
  sharingOn,
  stopSharing,
  upgradeDone,
  withIds,
} from "../../src/recognition/hwr/sharing";

const CLIENT: ShareClient = { app: "3.0.0", grape: "grape-2.0", device: "ipad" };

/** Deterministic "random" bytes. */
function bytes(seed: number): (n: number) => Uint8Array {
  let s = seed;
  return (n) =>
    Uint8Array.from({ length: n }, () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s & 0xff;
    });
}

function correction(over: Partial<Correction> = {}): Correction {
  return {
    kind: "misread",
    read: "integets",
    text: "integers",
    note: "Courses/Algebra/Secret lecture.notebook.md",
    page: "p-7f3a",
    strokes: [
      { id: "s12", pts: [310, 520, 0.4, 320, 530, 0.5, 330, 525, 0.5], t0: 18300 },
      { id: "s13", pts: [340, 521, 0.4, 350, 531, 0.6], t0: 18900 },
    ],
    at: 1_700_000_000_000,
    ...over,
  };
}

function file(...corrections: Correction[]): CorrectionsFile {
  return { version: 1, corrections };
}

function onLedger(seed = 1): SharingLedger {
  return agree(emptyLedger(100), 200, bytes(seed));
}

describe("kinds", () => {
  it("tells equations from words", () => {
    for (const text of ["12x4", "3+4=", "(2x+4)", "=", "1/2", "−3", "2^3"]) {
      expect(isEquationLabel(text), text).toBe(true);
    }
    for (const text of ["integers", "Karatsuba", "don't", "", "ab", "the"]) {
      expect(isEquationLabel(text), text).toBe(false);
    }
  });

  it("puts each correction under the kind the user would recognise", () => {
    expect(correctionKind({ kind: "misread", text: "integers" })).toBe("word");
    expect(correctionKind({ kind: "mistake", text: "recieve" })).toBe("word");
    // A word only confirmed as real (mostly names) is never shared.
    expect(correctionKind({ kind: "ignore", text: "Karatsuba" })).toBeNull();
    // A calculation's piece is an equation whatever it says.
    expect(correctionKind({ kind: "ignore", text: "x", source: "calc" })).toBe("equation");
    expect(correctionKind({ kind: "misread", text: "Area", source: "calc" })).toBe("equation");
    // Answers from calculation notes saved before `source` existed.
    expect(correctionKind({ kind: "ignore", text: "1300-252" })).toBe("equation");
  });

  it("keeps a correction's source through the file", () => {
    const back = parseCorrections(serializeCorrections(file(correction({ source: "calc" }))));
    expect(back.corrections[0].source).toBe("calc");
    const plain = parseCorrections(serializeCorrections(file(correction())));
    expect("source" in plain.corrections[0]).toBe(false);
    const odd = parseCorrections(
      JSON.stringify({ version: 1, corrections: [{ ...correction(), source: "elsewhere" }] }),
    );
    expect("source" in odd.corrections[0]).toBe(false);
  });
});

describe("items", () => {
  it("strips everything but the ink and its text", async () => {
    const [item] = await withIds(correctionDrafts(file(correction())));
    expect(Object.keys(item).sort()).toEqual(["answer", "id", "kind", "read", "strokes", "text"]);
    expect(item.kind).toBe("word");
    expect(item.read).toBe("integets");
    // Moved to start at 0, 0; times relative to the first stroke.
    expect(item.strokes[0].pts.slice(0, 3)).toEqual([0, 0, 0.4]);
    expect(item.strokes.map((s) => s.t0)).toEqual([0, 600]);
    for (const s of item.strokes) expect(Object.keys(s).sort()).toEqual(["pts", "t0"]);
  });

  it("leaves out the reading when it was right", async () => {
    const [item] = await withIds(
      correctionDrafts(file(correction({ kind: "mistake", read: "recieve", text: "recieve" }))),
    );
    expect(item.kind).toBe("word");
    expect("read" in item).toBe(false);
  });

  it("never makes an item of a word only confirmed as real", async () => {
    const items = await withIds(
      correctionDrafts(file(correction({ kind: "ignore", read: "Ottoline", text: "Ottoline" }))),
    );
    expect(items).toEqual([]);
  });

  it("never lets a note path, page id or stroke id into a batch", async () => {
    const secrets = ["Courses/Algebra/Secret lecture", "p-7f3a", "s12", "s13", "Secret"];
    const corrections = file(
      correction(),
      correction({
        source: "calc",
        text: "12x4",
        read: "72x4",
        page: "p-9",
        note: "Private/Taxes.notebook.md",
      }),
      correction({
        kind: "ignore",
        read: "Ottoline",
        text: "Ottoline",
        note: "Diary/2026.notebook.md",
      }),
    );
    const practice = practiceDrafts([
      {
        text: "Meet at 4:30 near platform 7",
        set: 2,
        device: "ipad",
        input: "pen",
        strokes: [
          {
            pts: [10, 900, 0.3, 30, 910, 0.4],
            t0: 5,
            samples: [10, 900, 0.3, 0, 30, 910, 0.4, 16],
          },
        ],
      },
    ]);
    const items = await withIds([...correctionDrafts(corrections), ...practice]);
    const ledger = onLedger();
    const built = buildBatches(pendingItems(items, ledger), ledger, CLIENT);
    const wire = JSON.stringify(built);
    for (const secret of [
      ...secrets,
      "Private/Taxes",
      "Diary/2026",
      "p-9",
      "notebook.md",
      "Ottoline",
    ]) {
      expect(wire.includes(secret), secret).toBe(false);
    }
    // The key never travels in a batch.
    expect(wire.includes(ledger.key as string)).toBe(false);
  });

  it("gives the same ink the same id on any device, and different ink another", async () => {
    const a = await withIds(correctionDrafts(file(correction())));
    // Another device: same ink and label, other page, note, time and stroke ids.
    const b = await withIds(
      correctionDrafts(
        file(
          correction({
            note: "x.notebook.md",
            page: "p-1",
            at: 5,
            strokes: correction().strokes.map((s, i) => ({ ...s, id: `z${i}` })),
          }),
        ),
      ),
    );
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toMatch(/^sha256:[0-9a-f]{64}$/);
    const c = await withIds(correctionDrafts(file(correction({ text: "integer" }))));
    expect(c[0].id).not.toBe(a[0].id);
    const twice = await withIds([
      ...correctionDrafts(file(correction())),
      ...correctionDrafts(file(correction())),
    ]);
    expect(twice).toHaveLength(1);
  });

  it("moves raw practice samples with the ink and keeps their times", async () => {
    const [item] = await withIds(
      practiceDrafts([
        {
          text: "a",
          set: 100,
          strokes: [
            {
              pts: [100, 200, 0.5, 110, 205, 0.5],
              t0: 1000,
              samples: [100, 200, 0.5, 0, 110, 205, 0.5, 16.4],
            },
          ],
        },
      ]),
    );
    expect(item).toMatchObject({ kind: "practice", set: 100, text: "a" });
    expect(item.strokes[0].samples).toEqual([0, 0, 0.5, 0, 10, 5, 0.5, 16]);
  });

  it("drops what is no ink: empty, ragged or poisoned strokes, blank text", async () => {
    const drafts = practiceDrafts([
      { text: "  ", set: 1, strokes: [{ pts: [1, 2, 0.5] }] },
      { text: "b", set: 1, strokes: [] },
      { text: "c", set: null, strokes: [{ pts: [1, 2] }] },
      { text: "d", set: 1, strokes: [{ pts: [1, Number.NaN, 0.5] }, { pts: [5, 6, 0.5, 7] }] },
    ]);
    expect(drafts.map((d) => [d.text, d.strokes.length])).toEqual([["d", 1]]);
    expect(drafts[0].strokes[0].pts).toEqual([0, 0, 0.5]);
    expect(drafts[0].strokes[0].t0).toBeNull();
    expect(
      "set" in practiceDrafts([{ text: "e", set: null, strokes: [{ pts: [0, 0, 1] }] }])[0],
    ).toBe(false);
    expect(await itemId(drafts[0])).toMatch(/^sha256:/);
  });

  it("counts by kind", async () => {
    const items = await withIds([
      ...correctionDrafts(file(correction(), correction({ source: "calc", text: "7" }))),
      ...practiceDrafts([{ text: "x", set: 1, strokes: [{ pts: [0, 0, 1] }] }]),
    ]);
    expect(countByKind(items)).toEqual({ practice: 1, word: 1, equation: 1 });
  });
});

describe("consent and ledger", () => {
  it("is off until the user agrees, and sends nothing while off", async () => {
    const items = await withIds(correctionDrafts(file(correction())));
    const off = emptyLedger();
    expect(sharingOn(off)).toBe(false);
    expect(buildBatches(items, off, CLIENT)).toBeNull();
    const on = onLedger();
    expect(sharingOn(on)).toBe(true);
    expect(on.contributor).toMatch(/^c_[a-z2-7]{16}$/);
    expect(on.key?.length).toBeGreaterThanOrEqual(32);
    expect(buildBatches(items, stopSharing(on), CLIENT)).toBeNull();
    // Consent to older wording does not count.
    const old = { ...on, consent: { version: CONSENT_VERSION - 1, at: 1 } };
    expect(sharingOn(old)).toBe(false);
  });

  it("states the consent in every batch", async () => {
    const items = await withIds(correctionDrafts(file(correction())));
    const ledger = agree(emptyLedger(), 5, bytes(3));
    const built = buildBatches(items, ledger, CLIENT);
    expect(built?.batches).toHaveLength(1);
    expect(built?.batches[0]).toMatchObject({
      format: SHARE_FORMAT,
      contributor: ledger.contributor,
      consent: { version: CONSENT_VERSION, licence: SHARE_LICENCE },
      client: CLIENT,
    });
  });

  it("is version 4 under the third private licence", () => {
    expect(CONSENT_VERSION).toBe(4);
    expect(SHARE_LICENCE).toBe("finenotes-grape-private-3");
  });

  it("lists only what changed since the terms someone agreed to", () => {
    expect(consentChanges(3)).toEqual(["writer", "madeUp", "used", "cloud"]);
    expect(consentChanges(2)).toEqual(["anthropic", "writer", "madeUp", "used", "cloud"]);
    expect(consentChanges(CONSENT_VERSION)).toEqual([]);
  });

  it("owes the server an upgrade when agreeing after older terms with items sent", () => {
    const old = markSent({ ...onLedger(1), consent: { version: 3, at: 1 } }, ["sha256:a"]);
    const agreed = agree(old, 50, bytes(9));
    expect(sharingOn(agreed)).toBe(true);
    expect(agreed.upgradeOwed).toBe(CONSENT_VERSION);
    // Round trip, and a sync copy that has not heard of it keeps it owed.
    expect(parseLedger(serializeLedger(agreed)).upgradeOwed).toBe(CONSENT_VERSION);
    expect(mergeLedgers(agreed, old).upgradeOwed).toBe(CONSENT_VERSION);
    expect(upgradeDone(agreed, CONSENT_VERSION).upgradeOwed).toBe(0);
    // Nothing sent before, or new terms agreed afresh after stopping: nothing to cover.
    expect(
      agree({ ...onLedger(1), consent: { version: 3, at: 1 } }, 50, bytes(9)).upgradeOwed,
    ).toBe(0);
    expect(agree(stopSharing(old), 50, bytes(9)).upgradeOwed).toBe(0);
    // A delete starts a new contributor, with nothing owed.
    expect(requestDelete(agreed, 60).upgradeOwed).toBe(0);
  });

  it("keeps the contributor when agreeing again", () => {
    const first = onLedger(1);
    const again = agree(stopSharing(first), 900, bytes(99));
    expect(again.contributor).toBe(first.contributor);
    expect(again.key).toBe(first.key);
    expect(again.consent?.at).toBe(900);
  });

  it("offers everything shareable, never sent or declined items", async () => {
    const items = await withIds(
      correctionDrafts(
        file(
          correction(),
          correction({ text: "two" }),
          correction({ kind: "ignore", read: "Ann", text: "Ann" }),
        ),
      ),
    );
    let ledger = onLedger();
    expect(pendingItems(items, ledger).map((i) => i.text)).toEqual(["integers", "two"]);
    ledger = markSent(ledger, [items[0].id]);
    ledger = markDeclined(ledger, [items[1].id]);
    expect(pendingItems(items, ledger)).toEqual([]);
  });

  it("round-trips and survives a broken file by being off", () => {
    const ledger = markSent(onLedger(), ["sha256:ab"]);
    expect(parseLedger(serializeLedger(ledger))).toEqual(ledger);
    for (const raw of [null, "", "{", "[]", '{"consent":{"version":1,"at":1}}']) {
      expect(sharingOn(parseLedger(raw))).toBe(false);
    }
    // Junk ids are dropped, not trusted; a ledger from the first build (kinds, dataset) still reads.
    const junk = parseLedger(
      JSON.stringify({
        ...ledger,
        sent: ["sha256:ab", 4, "nope"],
        kinds: { practice: true },
        consent: { ...ledger.consent, dataset: false },
        invited: "yes",
      }),
    );
    expect(junk.sent).toEqual(["sha256:ab"]);
    expect(sharingOn(junk)).toBe(true);
    expect(junk.invited).toBe(false);
  });

  it("merges two devices without losing a send", () => {
    const base = onLedger();
    const ipad = markSent(base, ["sha256:a"]);
    const mac = markDeclined(markSent(base, ["sha256:b"]), ["sha256:c", "sha256:a"]);
    const merged = mergeLedgers(ipad, mac);
    expect(merged.sent.sort()).toEqual(["sha256:a", "sha256:b"]);
    // Sent on one device wins over declined on the other.
    expect(merged.declined).toEqual(["sha256:c"]);
    expect(merged.contributor).toBe(base.contributor);
    expect(mergeLedgers(mac, ipad).sent.sort()).toEqual(merged.sent.sort());
  });

  it("keeps the newer consent when merging", () => {
    const base = onLedger();
    const later = agree(base, 999, bytes(1));
    expect(mergeLedgers(base, later).consent?.at).toBe(999);
    expect(mergeLedgers(later, base).consent?.at).toBe(999);
    const stopped = stopSharing(base);
    expect(sharingOn(mergeLedgers(stopped, emptyLedger(base.epoch)))).toBe(false);
  });

  it("forgets everything on delete, and a device that missed it cannot bring it back", () => {
    const sent = markSent(onLedger(), ["sha256:a"]);
    const deleted = requestDelete(markDeclined(sent, ["sha256:d"]), 5000);
    expect(sharingOn(deleted)).toBe(false);
    expect(deleted.contributor).toBeNull();
    expect(deleted.sent).toEqual([]);
    // What the user unticked stays unticked.
    expect(deleted.declined).toEqual(["sha256:d"]);
    expect(deleted.pendingDelete).toMatchObject({ contributor: sent.contributor, key: sent.key });
    const stale = markSent(sent, ["sha256:b"]);
    const merged = mergeLedgers(stale, deleted);
    expect(merged.sent).toEqual([]);
    expect(merged.pendingDelete?.contributor).toBe(sent.contributor);
    expect(deleteDone(merged).pendingDelete).toBeNull();
    // Deleting with nothing shared owes nothing.
    expect(requestDelete(emptyLedger(), 1).pendingDelete).toBeNull();
  });

  it("does not bring back a delete the server confirmed (found in the rig)", () => {
    // Saved to disk while owed; confirmed in memory; saving merges with disk.
    const onDisk = requestDelete(markSent(onLedger(), ["sha256:a"]), 7000);
    const confirmed = deleteDone(onDisk);
    expect(confirmed.deletedAt).toBe(7000);
    expect(mergeLedgers(confirmed, onDisk).pendingDelete).toBeNull();
    expect(mergeLedgers(onDisk, confirmed).pendingDelete).toBeNull();
    expect(parseLedger(serializeLedger(mergeLedgers(confirmed, onDisk))).pendingDelete).toBeNull();
    // A file that says both reads as done.
    const both = { ...onDisk, deletedAt: 7000 };
    expect(parseLedger(serializeLedger(both)).pendingDelete).toBeNull();
    // A later delete is still owed.
    const later = requestDelete(agree(confirmed, 8000, bytes(5)), 9000);
    expect(mergeLedgers(later, confirmed).pendingDelete?.at).toBe(9000);
  });

  it("asks with the invite once per vault", () => {
    const fresh = emptyLedger();
    expect(fresh.invited).toBe(false);
    const dismissed = inviteDismissed(fresh);
    expect(dismissed.invited).toBe(true);
    expect(sharingOn(dismissed)).toBe(false);
    // Answered on the iPad, synced to the Mac: the Mac does not ask again.
    expect(mergeLedgers(fresh, dismissed).invited).toBe(true);
    expect(parseLedger(serializeLedger(dismissed)).invited).toBe(true);
    // Agreeing answers it too.
    expect(onLedger().invited).toBe(true);
  });

  it("keeps a delete owed by the older copy", () => {
    const owed = requestDelete(onLedger(), 50);
    const newer = { ...onLedger(2), epoch: 60 };
    expect(mergeLedgers(owed, newer).pendingDelete?.at).toBe(50);
  });
});

describe("batches", () => {
  it("cuts batches under the cap and sets aside an item too big for one", async () => {
    const long = (n: number) => Array.from({ length: n * 3 }, (_, i) => (i % 3 === 2 ? 0.5 : i));
    const items = await withIds(
      practiceDrafts([
        ...Array.from({ length: 12 }, (_, i) => ({
          text: `line ${i}`,
          set: 1,
          strokes: [{ pts: long(2500) }],
        })),
        { text: "huge", set: 1, strokes: [{ pts: long(40000) }] },
      ]),
    );
    const built = buildBatches(items, onLedger(), CLIENT);
    expect(built?.tooBig.map((i) => i.text)).toEqual(["huge"]);
    const sizes =
      built?.batches.map((b) => new TextEncoder().encode(JSON.stringify(b)).length) ?? [];
    expect(sizes.length).toBeGreaterThan(1);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(built?.batches.flatMap((b) => b.items).length).toBe(12);
  });

  it("makes no batch when there is nothing to send", () => {
    expect(buildBatches([], onLedger(), CLIENT)).toEqual({ batches: [], tooBig: [] });
  });
});
