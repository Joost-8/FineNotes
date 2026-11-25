import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEAD, MIN_EVIDENCE, pageLanguage } from "../../src/recognition/hwr/page-language";
import { parseBundle } from "../../src/recognition/hwr/bundle";
import { readPage } from "../../src/recognition/hwr/recognizer";

/**
 * The language of a page, from Grape's best-path reading. Measured on 160
 * spliced lines a language (RESEARCH-LOG 2026-11-25): English pages were
 * never taken for another language; Dutch, German, French, Portuguese and
 * Spanish pages of five lines were found 28 to 32 times in 32.
 */
describe("pageLanguage", () => {
  it("finds the language of a page of notes, as Grape reads it (accents gone, letters off)", () => {
    expect(
      pageLanguage(
        "Lees hoofdstuk vijf voor het volgende college.\nDe router stuurt elk pakket naar de volgende hop.\nElke knoop houdt een tabel bij",
      ).language,
    ).toBe("nl");
    expect(
      pageLanguage(
        "Die Funktion gibt wahr zuruck, wenn der Schlussel existiert.\nDas Programm ist abgesturzt, weil die Datei fehlte.",
      ).language,
    ).toBe("de");
    expect(
      pageLanguage(
        "Le serveur repond a chaque requete dans l'ordre.\nLa difference entre les deux methodes est petite.",
      ).language,
    ).toBe("fr");
    expect(
      pageLanguage(
        "O resultado depende do valor inicial.\nA diferenca entre os dois metodos e pequena e nao muda.\nCada aluno trabalha numa parte diferente da aula.",
      ).language,
    ).toBe("pt");
    expect(
      pageLanguage(
        "El servidor responde cada solicitud en orden.\nLa diferencia entre los dos metodos es pequena.",
      ).language,
    ).toBe("es");
  });

  it("keeps English, and anything unsure, as English", () => {
    expect(
      pageLanguage(
        "The router sends each packet to the next hop.\nEvery node keeps a table of known routes.",
      ).language,
    ).toBe("en");
    // Too little to go on, and a tie: English (reading English without its model costs more than the reverse saves).
    expect(pageLanguage("de groep").language).toBe("en");
    expect(
      pageLanguage("Armoede = poverty\nis de provincie\nvan de groep\nthe was is to").language,
    ).toBe("en");
    expect(pageLanguage("").language).toBe("en");
    // Lists, notes and maths with few "the" (found by the reviewer: lone letters counted as Portuguese).
    expect(pageLanguage("buy a cake\ndo the dishes\ncall a plumber\nno milk").language).toBe("en");
    expect(pageLanguage("Todo\nwrite a summary\nmake a plan\nbook a room").language).toBe("en");
    expect(
      pageLanguage("Network layer: a packet has a header and a payload; a router reads a header")
        .language,
    ).toBe("en");
    expect(pageLanguage("f(x) = a x2 + b x + c\na = 2\nsolve for a\no o o e").language).toBe("en");
    expect(pageLanguage("3x + 4 = 19\n- - --").language).toBe("en");
  });

  it("splits a word several languages share between them", () => {
    const { scores } = pageLanguage("en");
    expect(scores.nl).toBeCloseTo(0.5);
    expect(scores.es).toBeCloseTo(0.5);
    expect(scores.en).toBe(0);
  });

  it("needs enough evidence and a clear lead over English", () => {
    expect(MIN_EVIDENCE).toBeGreaterThanOrEqual(3);
    expect(LEAD).toBeGreaterThanOrEqual(2);
    // Three Dutch words against two English ones: not twice as many.
    expect(pageLanguage("het een niet the and").language).toBe("en");
    expect(pageLanguage("het een niet voor the").language).toBe("nl");
  });
});

describe("readPage and the page's language", () => {
  const bytes = readFileSync("models/grape-2.0.bin");
  const bundle = parseBundle(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  // Three short strokes: no words, so English.
  const strokes = [0, 1, 2].map((i) => ({
    id: `s${i}`,
    tool: "pen",
    t0: i * 300,
    pts: [i * 40, 0, 0.5, i * 40 + 20, 30, 0.5, i * 40 + 30, 0, 0.5],
  }));

  it("says which language it read a page in, and reads English as before", () => {
    const on = readPage(bundle, strokes);
    const off = readPage(bundle, strokes, { language: false });
    expect(on.language).toBe("en");
    expect(off.language).toBe("en");
    expect(on.lines.map((l) => l.text)).toEqual(off.lines.map((l) => l.text));
  });

  it("times each line's decoding from its own start, not from the end of every line's network", () => {
    // Two lines far apart, so the page has more than one line to time.
    const two = [
      ...strokes,
      ...strokes.map((s) => ({
        ...s,
        id: `${s.id}b`,
        pts: s.pts.map((v, i) => (i % 3 === 1 ? v + 400 : v)),
      })),
    ];
    let tick = 0;
    const reading = readPage(bundle, two, { now: () => tick++ });
    expect(reading.lines.length).toBeGreaterThan(1);
    // Each decode reads the clock twice in a row: its start and its end.
    for (const line of reading.lines) expect(line.timings.beam).toBe(1);
  });

  it("hands each line's log-probabilities over once, by its index", () => {
    const seen: number[] = [];
    readPage(bundle, strokes, { logp: (line) => seen.push(line) });
    expect(seen).toEqual([...seen.keys()]);
  });
});
