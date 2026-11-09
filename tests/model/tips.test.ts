import { describe, expect, it } from "vitest";
import { EN } from "../../src/i18n/en";
import { detectScribble } from "../../src/ink/scribble";
import {
  BIOLOGY,
  LETTERS,
  SCENE_IDS,
  type SceneShape,
  motionKeyframes,
  penPresence,
  sampleTrack,
  handwrite,
  scrawl,
  tipScene,
  zigzag,
} from "../../src/model/tip-scenes";
import {
  MAX_HIGHLIGHTS,
  RELEASE_HIGHLIGHTS,
  type ReleaseHighlights,
  TIP_COLLECTIONS,
  type Tip,
  highlightsSince,
  homeCardKind,
  latestHighlighted,
  nextNewsSince,
  simpleOfferDue,
} from "../../src/model/tips";

const english: Record<string, string> = EN;
const fake = (id: string): Tip => ({
  id,
  scene: "hold",
  title: "notebooks.tips.title",
  body: "notebooks.tips.title",
});
const RELEASES: ReleaseHighlights[] = [
  { version: "3.0.0", tips: [fake("c"), fake("a")] },
  { version: "2.5.0", tips: [fake("b")] },
  { version: "2.0.0", tips: [fake("a"), fake("old")] },
];

function everyShape(shapes: readonly SceneShape[]): SceneShape[] {
  return shapes.flatMap((s) => (s.kind === "group" ? [s, ...everyShape(s.children)] : [s]));
}

describe("the catalogue", () => {
  const all = [
    ...TIP_COLLECTIONS.flatMap((c) => c.tips),
    ...RELEASE_HIGHLIGHTS.flatMap((r) => r.tips),
  ];

  it("has every text in English", () => {
    for (const tip of all) {
      expect(english[tip.title], tip.title).toBeTruthy();
      expect(english[tip.body], tip.body).toBeTruthy();
    }
    for (const c of TIP_COLLECTIONS) expect(english[c.title], c.title).toBeTruthy();
  });

  it("lists a tip once, and starts with the simple ones that help most", () => {
    const ids = TIP_COLLECTIONS.flatMap((c) => c.tips.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 3)).toEqual(["hold", "scribble", "undo"]);
  });

  it("keeps a body to what fits under a picture", () => {
    for (const tip of all) expect(english[tip.body].length, tip.id).toBeLessThanOrEqual(110);
  });

  it("uses every picture", () => {
    const used = new Set(all.map((t) => t.scene));
    expect(SCENE_IDS.filter((id) => !used.has(id))).toEqual([]);
  });

  it("offers Try it only on the gestures with a recogniser", () => {
    expect(all.filter((t) => t.tryIt).map((t) => t.id)).toEqual(["hold", "scribble"]);
  });
});

describe("the pictures", () => {
  it.each(SCENE_IDS)("%s: tracks ascend, stay in the loop, and rest inside it", (id) => {
    const scene = tipScene(id);
    expect(scene.rest).toBeGreaterThan(0);
    expect(scene.rest).toBeLessThan(1);
    for (const shape of everyShape(scene.shapes)) {
      for (const track of Object.values(shape.motion ?? {})) {
        let last = -1;
        for (const [at] of track) {
          expect(at).toBeGreaterThanOrEqual(last);
          expect(at).toBeLessThanOrEqual(1);
          last = at;
        }
      }
      for (const frames of motionKeyframes(shape.motion ?? {})) {
        expect(frames[0].offset).toBe(0);
        expect(frames[frames.length - 1].offset).toBe(1);
      }
    }
  });

  it("merges position, turn and size into one transform", () => {
    const lists = motionKeyframes({
      x: [
        [0, 0],
        [1, 10],
      ],
      rotate: [
        [0, 0],
        [0.5, 20],
        [1, 20],
      ],
    });
    expect(lists).toHaveLength(1);
    expect(lists[0][1]).toEqual({
      offset: 0.5,
      transform: "translate(5px, 0px) rotate(20deg) scale(1)",
    });
  });

  it("turns an amount drawn into a dash offset", () => {
    const [frames] = motionKeyframes({
      draw: [
        [0, 0],
        [1, 1],
      ],
    });
    expect(frames.map((f) => f.strokeDashoffset)).toEqual([1, 0]);
  });

  it("samples a track, holding its ends", () => {
    const track = [
      [0.2, 1],
      [0.4, 3],
    ] as const;
    expect(sampleTrack(track, 0)).toBe(1);
    expect(sampleTrack(track, 0.3)).toBeCloseTo(2);
    expect(sampleTrack(track, 1)).toBe(3);
    expect(sampleTrack([], 0.5)).toBe(0);
  });

  it("shows a pen only while it rides", () => {
    const track = penPresence(0.2, 0.6);
    expect(sampleTrack(track, 0.1)).toBe(0);
    expect(sampleTrack(track, 0.4)).toBe(1);
    expect(sampleTrack(track, 0.9)).toBe(0);
  });

  it("has a letter for every character of the sample notes", () => {
    for (const phrase of BIOLOGY) {
      for (const letter of phrase) expect(LETTERS[letter], `${phrase}: ${letter}`).toBeDefined();
    }
  });

  it("writes real words, the same each time, about as wide as asked", () => {
    expect(scrawl(10, 50, 100, 4)).toBe(scrawl(10, 50, 100, 4));
    expect(handwrite("mitosis", 0, 0, 80)).not.toBe(handwrite("meiosis", 0, 0, 80));
    const xs = [...handwrite("mitosis", 10, 50, 80).matchAll(/[MLC]([\d.-]+) /g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...xs)).toBeLessThan(100);
  });
});

describe("the scribble picture", () => {
  it("is a stroke the real detector calls a scribble", () => {
    const pts = zigzag(58, 72, 116, 16, 200)
      .slice(1)
      .split("L")
      .flatMap((pair) => [...pair.split(" ").map(Number), 0.5]);
    const dense: number[] = [];
    for (let i = 0; i + 5 < pts.length; i += 3) {
      for (let s = 0; s < 10; s++) {
        dense.push(
          pts[i] + ((pts[i + 3] - pts[i]) * s) / 10,
          pts[i + 1] + ((pts[i + 4] - pts[i + 1]) * s) / 10,
          0.5,
        );
      }
    }
    expect(detectScribble(dense, { minSize: 40 })).not.toBeNull();
  });
});

describe("what's new", () => {
  it("collects newer releases, newest first, each tip once", () => {
    expect(highlightsSince("2.0.0", "3.0.0", RELEASES).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores releases past the running version, and nothing to count from", () => {
    expect(highlightsSince("2.0.0", "2.9.0", RELEASES).map((t) => t.id)).toEqual(["b"]);
    expect(highlightsSince("", "3.0.0", RELEASES)).toEqual([]);
    expect(highlightsSince("3.0.0", "3.0.0", RELEASES)).toEqual([]);
  });

  it("caps what the pager carries", () => {
    const many = [{ version: "2.0.0", tips: [..."abcdefghijklmnopqrst"].map(fake) }];
    expect(highlightsSince("1.0.0", "2.0.0", many)).toHaveLength(MAX_HIGHLIGHTS);
  });

  it("names the newest release covered", () => {
    expect(latestHighlighted("2.0.0", "2.9.0", RELEASES)).toBe("2.5.0");
    expect(latestHighlighted("3.0.0", "3.0.0", RELEASES)).toBeNull();
  });

  it("starts counting at the version updated from", () => {
    const base = { firstInstall: false, pending: "", current: "2.9.0" };
    expect(nextNewsSince({ ...base, lastSeen: "2.8.0" })).toBe("2.8.0");
    expect(nextNewsSince({ ...base, lastSeen: "2.9.0" })).toBe("");
    expect(nextNewsSince({ ...base, lastSeen: "2.8.0", firstInstall: true })).toBe("");
  });

  it("keeps the older start while news is unread", () => {
    expect(
      nextNewsSince({ firstInstall: false, lastSeen: "2.8.0", pending: "2.5.0", current: "2.9.0" }),
    ).toBe("2.5.0");
  });
});

describe("Home's one card", () => {
  it("offers the simple look once, to someone without it", () => {
    expect(simpleOfferDue({ simpleLook: false, simpleLookHinted: false })).toBe(true);
    expect(simpleOfferDue({ simpleLook: true, simpleLookHinted: false })).toBe(false);
    expect(simpleOfferDue({ simpleLook: false, simpleLookHinted: true })).toBe(false);
  });

  it("puts news before the offer", () => {
    expect(homeCardKind(true, true)).toBe("news");
    expect(homeCardKind(false, true)).toBe("simple");
    expect(homeCardKind(false, false)).toBeNull();
  });
});
