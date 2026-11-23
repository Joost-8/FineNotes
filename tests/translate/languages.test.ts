import { describe, expect, it } from "vitest";
import {
  ENGINE_ID,
  catalogLanguage,
  engineAsset,
  filesBytes,
  joinPieces,
  joinRunOnLines,
  pairAsset,
  pairId,
  pairOf,
  pairOfFolder,
  pickSource,
  pickTarget,
  roughGuess,
  routeOf,
  sourceLanguages,
  targetLanguages,
  textPieces,
  translationPairs,
  withContext,
  withoutPrivateUse,
} from "../../src/translate/languages";
import { ENGINE_FILES, MODELS_URL } from "../../src/translate/catalog";

describe("the catalogue", () => {
  const pairs = translationPairs();

  it("pins every file by size and SHA-256 in FineNotes' own release, each once", () => {
    expect(pairs.length).toBeGreaterThan(50);
    expect(MODELS_URL).toBe(
      "https://github.com/Joost-8/FineNotes-templates/releases/download/translate-1/",
    );
    const urls = new Set<string>();
    for (const pair of [...pairs, { files: ENGINE_FILES }]) {
      for (const file of pair.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.url.startsWith(MODELS_URL)).toBe(true);
        expect(urls.has(file.url)).toBe(false);
        urls.add(file.url);
      }
    }
  });

  it("gives every pair a model first and a vocabulary, and no name twice", () => {
    for (const pair of pairs) {
      const names = pair.files.map((f) => f.name);
      expect(names[0]).toBe("model.bin");
      expect(
        names.includes("vocab.spm") ||
          (names.includes("srcvocab.spm") && names.includes("trgvocab.spm")),
      ).toBe(true);
      expect(new Set(names).size).toBe(names.length);
      expect(Number(pair.version.split(".")[0])).toBeLessThanOrEqual(2);
    }
  });

  it("has Dutch both ways, and each pair once", () => {
    expect(pairOf("nl", "en")).not.toBeNull();
    expect(pairOf("en", "nl")).not.toBeNull();
    const keys = pairs.map((p) => `${p.from}-${p.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("expands once", () => {
    expect(translationPairs()).toBe(pairs);
  });
});

describe("languages and routes", () => {
  const pairs = [
    { from: "nl", to: "en", version: "2.0", precision: "int8shiftAlphaAll" as const, files: [] },
    { from: "en", to: "nl", version: "2.1", precision: "int8shiftAlphaAll" as const, files: [] },
    { from: "de", to: "en", version: "2.0", precision: "int8shiftAll" as const, files: [] },
    { from: "en", to: "fr", version: "1.0", precision: "int8shiftAll" as const, files: [] },
  ];

  it("lists English and what goes to or from it", () => {
    expect(sourceLanguages(pairs).sort()).toEqual(["de", "en", "nl"]);
    expect(targetLanguages(pairs).sort()).toEqual(["en", "fr", "nl"]);
  });

  it("takes one model to or from English, two between others, none for the same language", () => {
    expect(routeOf("nl", "en", pairs)?.map(pairId)).toEqual(["translate-nl-en"]);
    expect(routeOf("en", "nl", pairs)?.map(pairId)).toEqual(["translate-en-nl"]);
    expect(routeOf("de", "nl", pairs)?.map(pairId)).toEqual(["translate-de-en", "translate-en-nl"]);
    expect(routeOf("nl", "nl", pairs)).toEqual([]);
  });

  it("says when a route does not exist", () => {
    expect(routeOf("en", "de", pairs)).toBeNull();
    expect(routeOf("fr", "nl", pairs)).toBeNull();
    expect(routeOf("de", "xx", pairs)).toBeNull();
  });

  it("finds a pair by its folder name", () => {
    expect(pairOfFolder("nl-en", pairs)?.to).toBe("en");
    expect(pairOfFolder("engine", pairs)).toBeNull();
  });
});

describe("assets", () => {
  const pair = translationPairs().find((p) => p.from === "nl" && p.to === "en");
  if (!pair) throw new Error("no nl-en");

  it("keeps each model in its own folder under translation/", () => {
    const asset = pairAsset(pair, "Dutch → English", "why");
    expect(asset.id).toBe("translate-nl-en");
    expect(asset.folder).toBe("translation/nl-en");
    expect(asset.files).toBe(pair.files);
    expect(asset.version).toBe(pair.version);
  });

  it("keeps the engine in translation/engine", () => {
    const asset = engineAsset("Engine", "why");
    expect(asset.id).toBe(ENGINE_ID);
    expect(asset.folder).toBe("translation/engine");
    expect(asset.files.map((f) => f.name)).toEqual([
      "bergamot.wasm",
      "fasttext.wasm",
      "lid.176.ftz",
    ]);
  });

  it("adds sizes", () => {
    expect(filesBytes([])).toBe(0);
    expect(filesBytes(pair.files)).toBeGreaterThan(10_000_000);
  });
});

describe("detected language", () => {
  const known = ["en", "nl", "de", "ja", "ko", "zh-Hans", "nb"];

  it("maps fastText's labels to the catalogue's", () => {
    expect(catalogLanguage("__label__nl", known)).toBe("nl");
    expect(catalogLanguage("__label__zh", known)).toBe("zh-Hans");
    expect(catalogLanguage("__label__no", known)).toBe("nb");
    expect(catalogLanguage("__label__ceb", known)).toBeNull();
  });

  it("takes the first guess it can translate", () => {
    expect(
      pickSource(
        "Het is een mooie dag vandaag.",
        [
          ["__label__af", 0.6],
          ["__label__nl", 0.3],
        ],
        known,
        null,
      ),
    ).toEqual({ lang: "nl", p: 0.3 });
  });

  it("trusts kana and Hangul over fastText", () => {
    expect(pickSource("行列の固有値", [["__label__ru", 0.64]], known, null)?.lang).toBe("ja");
    expect(pickSource("안녕하세요", [["__label__zh", 0.9]], known, null)?.lang).toBe("ko");
  });

  it("keeps the last language for short text it is unsure of", () => {
    expect(pickSource("Hola", [["__label__de", 0.3]], known, "nl")?.lang).toBe("nl");
    expect(pickSource("Hola", [["__label__de", 0.3]], known, null)?.lang).toBe("de");
    expect(pickSource("x = 2", [["__label__ceb", 0.4]], known, "de")).toEqual({
      lang: "de",
      p: 0,
    });
    expect(pickSource("x = 2", [], known, null)).toBeNull();
  });

  it("takes the common words over an unsure guess (real: fastText read this as Esperanto)", () => {
    const guesses: [string, number][] = [
      ["__label__eo", 0.157],
      ["__label__es", 0.148],
      ["__label__de", 0.126],
    ];
    expect(pickSource("Morgen leren we samen.", guesses, known, "en", "nl")?.lang).toBe("nl");
    expect(pickSource("Morgen leren we samen.", guesses, known, "en", null)?.lang).toBe("en");
    // A sure guess is not overruled.
    expect(pickSource("Hallo", [["__label__de", 0.9]], known, "en", "nl")?.lang).toBe("de");
  });

  it("believes an unsure guess on long text", () => {
    const long = "Dit is een vrij lange zin met heel veel woorden erin.";
    expect(pickSource(long, [["__label__nl", 0.4]], known, "de")?.lang).toBe("nl");
  });
});

describe("target language", () => {
  const targets = ["en", "nl", "de", "zh-Hans", "nb"];

  it("keeps the last choice", () => {
    expect(pickTarget("nl", "de", "en", targets)).toBe("de");
  });

  it("uses the interface language, then English", () => {
    expect(pickTarget("de", undefined, "nl", targets)).toBe("nl");
    expect(pickTarget("de", undefined, "zh", targets)).toBe("zh-Hans");
    expect(pickTarget("de", undefined, "no", targets)).toBe("nb");
    expect(pickTarget("nl", undefined, "fr", targets)).toBe("en");
  });

  it("does not translate text into its own language when it can help it", () => {
    expect(pickTarget("nl", undefined, "nl", targets)).toBe("en");
    expect(pickTarget("en", undefined, "nl", targets)).toBe("nl");
    expect(pickTarget("en", undefined, "en", targets)).toBe("en");
  });
});

describe("text pieces", () => {
  it("cuts at line breaks and puts them back", () => {
    const cut = textPieces("  Eerste regel.\n\nTweede regel\nderde  ");
    expect(cut.pieces).toEqual(["Eerste regel.", "Tweede regel", "derde"]);
    expect(joinPieces(cut, ["First line.", "Second line", "third"])).toBe(
      "  First line.\n\nSecond line\nthird  ",
    );
  });

  it("handles one line and no text", () => {
    expect(textPieces("Hallo").pieces).toEqual(["Hallo"]);
    const empty = textPieces(" \n ");
    expect(empty.pieces).toEqual([]);
    expect(joinPieces(empty, [])).toBe(" \n ");
  });

  it("round-trips any text when nothing is translated", () => {
    for (const text of ["a\nb", "\n\na  b\n", "x\r\ny", "\ta\n\n\tb\t"]) {
      const cut = textPieces(text);
      expect(joinPieces(cut, cut.pieces)).toBe(text);
    }
  });
});

describe("run-on PDF lines", () => {
  it("joins a sentence broken across lines", () => {
    expect(joinRunOnLines("De eigenwaarden van\neen matrix.")).toBe(
      "De eigenwaarden van een matrix.",
    );
  });

  it("drops a hyphen that split a word", () => {
    expect(joinRunOnLines("karakteris-\ntieke veelterm")).toBe("karakteristieke veelterm");
  });

  it("keeps breaks after a sentence and blank lines", () => {
    expect(joinRunOnLines("Eén.\nTwee")).toBe("Eén.\nTwee");
    expect(joinRunOnLines("Kop\n\nTekst")).toBe("Kop\n\nTekst");
    expect(joinRunOnLines("a -\nb")).toBe("a - b");
  });
});

describe("rough guess, before the detector is downloaded", () => {
  const known = sourceLanguages();

  it("reads the common words of the languages most notes are in", () => {
    expect(roughGuess("Morgen hebben we een tentamen over de stof van het college.", known)).toBe(
      "nl",
    );
    expect(
      roughGuess("Die Eigenwerte einer Matrix sind die Nullstellen und das ist wichtig.", known),
    ).toBe("de");
    expect(
      roughGuess("Les valeurs propres d'une matrice sont les racines du polynôme.", known),
    ).toBe("fr");
    expect(roughGuess("The eigenvalues of a matrix are the roots of this polynomial.", known)).toBe(
      "en",
    );
  });

  it("reads short sentences fastText is unsure of", () => {
    expect(roughGuess("Morgen leren we samen.", known)).toBe("nl");
    expect(roughGuess("Ich lerne heute.", known)).toBe("de");
    expect(roughGuess("We can study tonight.", known)).toBe("en");
  });

  it("goes by script where one says it", () => {
    expect(roughGuess("行列の固有値", known)).toBe("ja");
    expect(roughGuess("Привет, как дела?", known)).toBe("ru");
  });

  it("says nothing for text with no common word or script", () => {
    expect(roughGuess("x^2 + 3 = 7", known)).toBeNull();
  });

  it("only names languages the catalogue has", () => {
    expect(roughGuess("Привет", ["en"])).toBeNull();
    expect(roughGuess("de het een", ["en", "de"])).toBeNull();
  });
});

describe("withContext", () => {
  const nl = { lang: "nl", p: 0.97 };
  it("takes the page's language for a short selection read as another", () => {
    expect(withContext("taken", { lang: "en", p: 0.96 }, nl)).toEqual(nl);
    expect(withContext("De schipper gooit de trossen los.", { lang: "es", p: 0.59 }, nl)).toEqual(
      nl,
    );
  });

  it("keeps a long selection that is sure of another language", () => {
    const en = { lang: "en", p: 0.98 };
    const text = "This sentence is written in English on a Dutch page.";
    expect(withContext(text, en, nl)).toEqual(en);
  });

  it("uses what there is when one side is missing", () => {
    expect(withContext("x", null, nl)).toEqual(nl);
    expect(withContext("x", nl, null)).toEqual(nl);
  });
});

describe("withoutPrivateUse", () => {
  it("drops a PDF font's private-use codes", () => {
    const code = String.fromCharCode(0xe001);
    expect(withoutPrivateUse(`a${code}b`)).toBe("ab");
    expect(withoutPrivateUse("geen")).toBe("geen");
  });
});
