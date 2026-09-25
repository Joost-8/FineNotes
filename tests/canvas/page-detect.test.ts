import { describe, expect, it } from "vitest";
import { type Quad, isConvexQuad } from "../../src/canvas/homography";
import {
  FALLBACK_INSET,
  MIN_CONFIDENCE,
  boxBlur,
  convexHull,
  detectPage,
  fillHoles,
  initialCorners,
  insetQuad,
  largestRegion,
  maxAreaQuad,
  otsu,
  outlinePoints,
  refineQuad,
  scoreCandidate,
  simplifyHull,
} from "../../src/canvas/page-detect";
import { createRgba } from "../../src/canvas/scan-raster";
import { type SynthOptions, cornerError, synthPhoto } from "./scan-synth";

const quad = (...v: number[]): Quad => [
  { x: v[0], y: v[1] },
  { x: v[2], y: v[3] },
  { x: v[4], y: v[5] },
  { x: v[6], y: v[7] },
];

function rotatedRect(cx: number, cy: number, w: number, h: number, deg: number): Quad {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const at = (x: number, y: number) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  return [at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)];
}

/**
 * Synthetic photos with known corners. Each was printed (corner error and
 * confidence) before these bounds were set; the worst real-page case was
 * 0.94 % of the diagonal, under a soft shadow.
 */
const PAGES: Array<[string, SynthOptions]> = [
  ["frontal", { corners: quad(223, 50, 577, 50, 577, 550, 223, 550) }],
  ["keystone", { corners: quad(260, 70, 540, 70, 610, 560, 190, 560) }],
  ["rotated 12°", { corners: rotatedRect(400, 300, 330, 467, 12) }],
  ["two-axis tilt", { corners: quad(250, 90, 560, 60, 600, 540, 170, 520) }],
  [
    "soft shadow across the page",
    {
      corners: quad(223, 50, 577, 50, 577, 550, 223, 550),
      shadowX: 0.45,
      shadowDepth: 0.45,
      shadowSoftness: 300,
    },
  ],
  ["light falling off", { corners: quad(223, 50, 577, 50, 577, 550, 223, 550), falloff: 0.6 }],
  [
    "white page on a light grey desk",
    { corners: quad(223, 50, 577, 50, 577, 550, 223, 550), desk: [196, 196, 192], grain: 6 },
  ],
  [
    "landscape page filling the frame",
    { corners: quad(12, 8, 790, 10, 788, 592, 10, 590), pageWidth: 297, pageHeight: 210 },
  ],
  [
    "portrait photo",
    { corners: quad(90, 140, 500, 120, 530, 700, 70, 690), width: 600, height: 800 },
  ],
];

describe("detectPage on synthetic photos", () => {
  it.each(PAGES)("finds the page: %s", (_, options) => {
    const { photo, corners } = synthPhoto(options);
    const found = detectPage(photo)!;
    expect(found).not.toBeNull();
    expect(found.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    expect(cornerError(found.quad, corners, photo.width, photo.height)).toBeLessThan(0.012);
    expect(isConvexQuad(found.quad)).toBe(true);
  });

  const REFUSE: Array<[string, SynthOptions]> = [
    [
      "a grey page on a whiter desk",
      {
        corners: quad(223, 50, 577, 50, 577, 550, 223, 550),
        desk: [246, 246, 244],
        paper: [226, 226, 220],
        grain: 3,
      },
    ],
    ["no page at all", { corners: quad(-900, -900, -800, -900, -800, -800, -900, -800) }],
    [
      "a page too small to be the subject",
      { corners: quad(350, 230, 440, 230, 440, 357, 350, 357) },
    ],
  ];

  it.each(REFUSE)("declines rather than guess: %s", (_, options) => {
    const { photo } = synthPhoto(options);
    const found = detectPage(photo);
    expect(found === null || found.confidence < MIN_CONFIDENCE).toBe(true);
    const start = initialCorners(photo);
    expect(start.detected).toBe(false);
    expect(start.quad).toEqual(insetQuad(photo.width, photo.height));
  });

  it("keeps a page that runs off the frame inside the photo", () => {
    const { photo } = synthPhoto({ corners: quad(300, -60, 700, 20, 640, 560, 200, 470) });
    const found = detectPage(photo)!;
    for (const p of found.quad) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(photo.width);
      expect(p.y).toBeLessThanOrEqual(photo.height);
    }
  });

  it("returns corners in the photo's own pixels, whatever its size", () => {
    const { photo, corners } = synthPhoto({
      width: 1600,
      height: 1200,
      corners: quad(446, 100, 1154, 100, 1154, 1100, 446, 1100),
    });
    const start = initialCorners(photo);
    expect(start.detected).toBe(true);
    expect(cornerError(start.quad, corners, 1600, 1200)).toBeLessThan(0.012);
  });

  it("gives up on a picture too small to look at", () => {
    expect(detectPage(createRgba(6, 4))).toBeNull();
  });
});

describe("the fallback", () => {
  it("is a rectangle 6 % in from each edge", () => {
    expect(FALLBACK_INSET).toBe(0.06);
    expect(insetQuad(1000, 500)).toEqual(quad(60, 30, 940, 30, 940, 470, 60, 470));
  });
});

describe("building blocks", () => {
  it("box blur keeps a flat field flat and spreads a spike evenly", () => {
    const flat = new Uint8Array(30).fill(90);
    expect(Array.from(boxBlur(flat, 6, 5, 2))).toEqual(Array.from(flat));
    const spike = new Uint8Array(49);
    spike[24] = 225; // centre of 7 × 7
    const out = boxBlur(spike, 7, 7, 1);
    expect(out[24]).toBe(25);
    expect(out[16]).toBe(25); // a diagonal neighbour
    expect(out[0]).toBe(0);
  });

  it("Otsu splits two tones between them and measures how two-toned they are", () => {
    const values = new Uint8Array(200);
    values.fill(40, 0, 120);
    values.fill(200, 120);
    const split = otsu(values);
    expect(split.threshold).toBeGreaterThanOrEqual(40);
    expect(split.threshold).toBeLessThan(200);
    expect(split.darkMean).toBe(40);
    expect(split.brightMean).toBe(200);
    expect(split.separability).toBeCloseTo(1, 6);
    expect(otsu(new Uint8Array(10).fill(7)).separability).toBe(0);
  });

  it("finds the largest region and fills its holes", () => {
    // 6 × 5: a 4 × 3 ring with a hole, and a single stray pixel.
    const mask = Uint8Array.from([
      0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const { region, area } = largestRegion(mask, 6, 5);
    expect(area).toBe(10);
    expect(region[5]).toBe(0);
    const filled = fillHoles(region, 6, 5);
    expect(filled[14] + filled[15]).toBe(2);
    expect(filled.reduce((a, b) => a + b, 0)).toBe(12);
    expect(largestRegion(new Uint8Array(4), 2, 2).area).toBe(0);
  });

  it("outlines a region along all four sides and hulls it", () => {
    const region = new Uint8Array(10 * 8);
    for (let y = 2; y < 6; y++) for (let x = 3; x < 8; x++) region[y * 10 + x] = 1;
    const hull = convexHull(outlinePoints(region, 10, 8));
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([
      3, 8, 2, 6,
    ]);
    expect(convexHull([{ x: 0, y: 0 }])).toHaveLength(1);
  });

  it("picks the largest inscribed quad, even from a hull with rounded corners", () => {
    // A 100 × 60 rectangle whose corners are rounded with radius 6.
    const hull: Array<{ x: number; y: number }> = [];
    const corners = [
      [94, 6, -90],
      [94, 54, 0],
      [6, 54, 90],
      [6, 6, 180],
    ];
    for (const [cx, cy, start] of corners) {
      for (let k = 0; k <= 6; k++) {
        const a = ((start + k * 15) * Math.PI) / 180;
        hull.push({ x: cx + 6 * Math.cos(a), y: cy + 6 * Math.sin(a) });
      }
    }
    const q = maxAreaQuad(hull)!;
    for (const p of q) {
      const nearest = Math.min(
        Math.hypot(p.x, p.y),
        Math.hypot(p.x - 100, p.y),
        Math.hypot(p.x - 100, p.y - 60),
        Math.hypot(p.x, p.y - 60),
      );
      // The best a corner rounded at r = 6 allows is 2.5 (its 45° point).
      expect(nearest).toBeLessThan(3.5);
    }
    expect(maxAreaQuad(hull.slice(0, 3))).toBeNull();
    expect(simplifyHull(hull, 4)).toHaveLength(4);
  });

  it("simplifies a huge hull before the cubic search", () => {
    const circle = Array.from({ length: 300 }, (_, i) => ({
      x: 100 + 90 * Math.cos((i / 300) * 2 * Math.PI),
      y: 100 + 90 * Math.sin((i / 300) * 2 * Math.PI),
    }));
    const q = maxAreaQuad(circle)!;
    expect(q).toHaveLength(4);
    // The largest quad in a circle is a square: area 2r².
    const area = Math.abs(
      (q[0].x * q[1].y - q[1].x * q[0].y + q[1].x * q[2].y - q[2].x * q[1].y) / 2 +
        (q[2].x * q[3].y - q[3].x * q[2].y + q[3].x * q[0].y - q[0].x * q[3].y) / 2,
    );
    expect(area / (2 * 90 * 90)).toBeGreaterThan(0.97);
  });

  it("refines corners onto the sides' lines, and leaves them when there is no evidence", () => {
    // Outline of a 100 × 60 rectangle; start from a quad with one corner cut in.
    const outline: Array<{ x: number; y: number }> = [];
    for (let x = 0; x <= 100; x += 2) outline.push({ x, y: 0 }, { x, y: 60 });
    for (let y = 0; y <= 60; y += 2) outline.push({ x: 0, y }, { x: 100, y });
    const cut = quad(0, 0, 100, 0, 96, 57, 0, 60);
    const refined = refineQuad(refineQuad(cut, outline), outline);
    expect(Math.hypot(refined[2].x - 100, refined[2].y - 60)).toBeLessThan(0.5);
    expect(refineQuad(cut, [])).toEqual(cut);
  });

  it("scores by the weakest criterion", () => {
    expect(scoreCandidate({ area: 1, fill: 0.2, contrast: 1, angles: 0.9, separability: 1 })).toBe(
      0.2,
    );
  });
});
