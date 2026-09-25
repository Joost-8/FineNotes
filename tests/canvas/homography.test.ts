import { describe, expect, it } from "vitest";
import {
  type Point,
  type Quad,
  applyHomography,
  cornerAngles,
  detMat3,
  edgeAspect,
  estimateAspect,
  homographyFromQuads,
  invertMat3,
  isConvexQuad,
  isUsableQuad,
  multiplyMat3,
  orderQuad,
  polygonArea,
  scanOutputSize,
  solveLinear,
  warpPerspective,
} from "../../src/canvas/homography";
import { type RgbaImage, createRgba } from "../../src/canvas/scan-raster";
import { rng } from "./scan-synth";

const quad = (...v: number[]): Quad => [
  { x: v[0], y: v[1] },
  { x: v[2], y: v[3] },
  { x: v[4], y: v[5] },
  { x: v[6], y: v[7] },
];

const rect = (w: number, h: number): Quad => quad(0, 0, w, 0, w, h, 0, h);

/**
 * The four corners of a `w × h` rectangle photographed by a pinhole camera:
 * rotated by (ax, ay, az) degrees about x, y, z, `dist` in front of a lens of
 * focal length `f` px, principal point at the photo's centre.
 */
function photograph(
  w: number,
  h: number,
  [ax, ay, az]: [number, number, number],
  f: number,
  photo: { width: number; height: number },
  dist = 420,
): Quad {
  const r = (d: number): number => (d * Math.PI) / 180;
  const [a, b, c] = [r(ax), r(ay), r(az)];
  const Rx = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const Ry = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const Rz = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
  const R = multiplyMat3(Rz, multiplyMat3(Ry, Rx));
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => {
    const X = R[0] * x + R[1] * y + 12;
    const Y = R[3] * x + R[4] * y - 9;
    const Z = R[6] * x + R[7] * y + dist;
    return { x: (f * X) / Z + photo.width / 2, y: (f * Y) / Z + photo.height / 2 };
  });
  return orderQuad(corners);
}

function close(a: Point, b: Point, tol: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

describe("solveLinear", () => {
  it("solves a system that needs a row swap", () => {
    // The first pivot is 0, so this fails without partial pivoting.
    const x = solveLinear(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 1, 3],
      ],
      [7, 6, 13],
    );
    expect(x).not.toBeNull();
    const [a, b, c] = x!;
    expect(a).toBeCloseTo(1, 10);
    expect(b).toBeCloseTo(2, 10);
    expect(c).toBeCloseTo(3, 10);
  });

  it("returns null for a singular or empty system", () => {
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6],
      ),
    ).toBeNull();
    expect(
      solveLinear(
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0],
      ),
    ).toBeNull();
  });
});

describe("3 × 3 matrices", () => {
  it("invert to the identity and refuse a singular matrix", () => {
    const m = [2, 1, 0, 0, 3, 1, 1, 0, 4];
    expect(detMat3(m)).toBe(25);
    const product = multiplyMat3(m, invertMat3(m)!);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(product[i]).toBeCloseTo(v, 12));
    expect(invertMat3([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });
});

describe("homographyFromQuads", () => {
  const cases: Array<[string, Quad, Quad]> = [
    ["identity", rect(100, 80), rect(100, 80)],
    ["pure scale", rect(100, 80), rect(250, 200)],
    ["perspective", rect(1448, 2048), quad(812, 402, 2904, 311, 3310, 2810, 541, 2977)],
    ["a large, far-off quad", quad(3000, 3000, 3100, 2990, 3120, 3200, 2990, 3150), rect(1, 1)],
  ];

  it.each(cases)("maps each corner onto its partner (%s)", (_, from, to) => {
    const h = homographyFromQuads(from, to)!;
    expect(h).not.toBeNull();
    expect(h[8]).toBe(1);
    from.forEach((p, i) => {
      const q = applyHomography(h, p.x, p.y);
      expect(close(q, to[i], 1e-6 * Math.max(1, Math.abs(to[i].x), Math.abs(to[i].y)))).toBe(true);
    });
  });

  it("round-trips arbitrary points to well within a pixel", () => {
    const from = rect(1448, 2048);
    const to = quad(812, 402, 2904, 311, 3310, 2810, 541, 2977);
    const h = homographyFromQuads(from, to)!;
    const back = invertMat3(h)!;
    const reverse = homographyFromQuads(to, from)!;
    const random = rng(3);
    for (let i = 0; i < 200; i++) {
      const p = { x: random() * 1448, y: random() * 2048 };
      const q = applyHomography(h, p.x, p.y);
      expect(close(applyHomography(back, q.x, q.y), p, 1e-6)).toBe(true);
      expect(close(applyHomography(reverse, q.x, q.y), p, 1e-6)).toBe(true);
    }
  });

  it("returns null when three corners are on a line or two coincide", () => {
    expect(homographyFromQuads(rect(10, 10), quad(0, 0, 5, 5, 10, 10, 0, 10))).toBeNull();
    expect(homographyFromQuads(rect(10, 10), quad(0, 0, 0, 0, 10, 10, 0, 10))).toBeNull();
    expect(homographyFromQuads(quad(0, 0, 0, 0, 0, 0, 0, 0), rect(10, 10))).toBeNull();
  });
});

describe("quad helpers", () => {
  it("measures signed area, positive clockwise on screen", () => {
    expect(polygonArea(rect(4, 3))).toBe(12);
    expect(polygonArea([...rect(4, 3)].reverse())).toBe(-12);
  });

  it("knows a convex quad from a bow-tie, a dart and a flat one", () => {
    expect(isConvexQuad(rect(10, 10))).toBe(true);
    expect(isConvexQuad([...rect(10, 10)].reverse())).toBe(true);
    expect(isConvexQuad(quad(0, 0, 10, 10, 10, 0, 0, 10))).toBe(false); // bow-tie
    expect(isConvexQuad(quad(0, 0, 10, 0, 3, 3, 0, 10))).toBe(false); // dart
    expect(isConvexQuad(quad(0, 0, 5, 0, 10, 0, 5, 5))).toBe(false); // three on a line
    expect(isConvexQuad([{ x: 0, y: 0 }])).toBe(false);
  });

  it("orders four loose points as TL, TR, BR, BL", () => {
    const shuffled = [
      { x: 90, y: 110 },
      { x: 5, y: 8 },
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ];
    expect(orderQuad(shuffled)).toEqual(quad(5, 8, 100, 0, 90, 110, 0, 100));
    // A handle dragged past its neighbour just swaps roles: still convex.
    const crossed = orderQuad([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(isConvexQuad(crossed)).toBe(true);
  });

  it("reads corner angles", () => {
    expect(cornerAngles(rect(30, 20))).toEqual([90, 90, 90, 90]);
    const kite = cornerAngles(quad(0, 0, 10, 0, 20, 10, 10, 10));
    expect(kite[0]).toBeCloseTo(45, 6);
    expect(kite.reduce((a, b) => a + b)).toBeCloseTo(360, 6);
  });

  it("accepts a page and refuses a sliver, a speck or a non-convex quad", () => {
    expect(isUsableQuad(quad(100, 80, 700, 90, 690, 560, 90, 540), 800, 600)).toBe(true);
    expect(isUsableQuad(quad(0, 0, 800, 0, 800, 2, 0, 2), 800, 600)).toBe(false); // < 0.5 %
    expect(isUsableQuad(quad(0, 0, 400, 0, 800, 600, 399, 1), 800, 600)).toBe(false); // sliver
    expect(isUsableQuad(quad(0, 0, 10, 10, 10, 0, 0, 10), 20, 20)).toBe(false);
  });
});

describe("estimateAspect", () => {
  const photo = { width: 3024, height: 4032 };
  const a4 = 210 / 297;

  it("is exact on a frontal photo, whatever the focal length", () => {
    for (const f of [0.6, 0.8, 1.2]) {
      const q = photograph(210, 297, [0, 0, 0], f * 4032, photo);
      expect(estimateAspect(q, photo.width, photo.height)).toBeCloseTo(a4, 4);
    }
  });

  it("recovers the page from a two-axis tilt, where the edges are far off", () => {
    for (const tilt of [
      [25, 15, 0],
      [30, 20, 8],
      [40, 10, 5],
      [15, -10, -20],
    ] as Array<[number, number, number]>) {
      for (const f of [0.72, 1.0, 1.3]) {
        const q = photograph(210, 297, tilt, f * 4032, photo);
        const est = estimateAspect(q, photo.width, photo.height);
        expect(Math.abs(est / a4 - 1)).toBeLessThan(0.01);
      }
    }
    const steep = photograph(210, 297, [40, 10, 5], 0.8 * 4032, photo);
    expect(Math.abs(edgeAspect(steep) / a4 - 1)).toBeGreaterThan(0.15);
  });

  it("beats the edge estimate on a one-axis keystone, using a typical focal length", () => {
    // Before the recession gate, rounding noise (n23 ≈ 1e-16) "measured" a
    // focal length inside the plausible band and put this 14 % off.
    for (const f of [0.72, 0.8, 1.0]) {
      for (const tilt of [20, 35]) {
        const q = photograph(210, 297, [tilt, 0, 0], f * 4032, photo);
        const est = Math.abs(estimateAspect(q, photo.width, photo.height) / a4 - 1);
        const edge = Math.abs(edgeAspect(q) / a4 - 1);
        expect(est).toBeLessThan(edge);
        expect(est).toBeLessThan(0.07);
      }
    }
  });

  it("falls back to the edges for a quad no camera could produce", () => {
    // A trapezoid "wider at the top" by more than any tilt implies: the
    // vanishing geometry would need an absurd focal length.
    const odd = quad(0, 0, 1000, 0, 520, 100, 480, 100);
    expect(estimateAspect(odd, 1000, 1000)).toBeCloseTo(edgeAspect(odd), 10);
  });
});

describe("scanOutputSize", () => {
  it("keeps a frontal page at the photo's resolution", () => {
    expect(scanOutputSize(quad(100, 100, 520, 100, 520, 694, 100, 694), 800, 800)).toEqual({
      width: 420,
      height: 594,
    });
  });

  it("caps the long side at 2048 and keeps the aspect", () => {
    const size = scanOutputSize(quad(0, 0, 3000, 0, 3000, 4000, 0, 4000), 3000, 4000);
    expect(size).toEqual({ width: 1536, height: 2048 });
    expect(scanOutputSize(quad(0, 0, 3000, 0, 3000, 4000, 0, 4000), 3000, 4000, 1000)).toEqual({
      width: 750,
      height: 1000,
    });
  });

  it("gives a tilted A4 page its true proportions", () => {
    const photo = { width: 3024, height: 4032 };
    const q = photograph(210, 297, [30, 20, 8], 0.9 * 4032, photo);
    const size = scanOutputSize(q, photo.width, photo.height);
    expect(Math.abs(size.width / size.height / (210 / 297) - 1)).toBeLessThan(0.01);
  });
});

/** A checkerboard of `cell`-px squares, black and white. */
function checkerboard(width: number, height: number, cell: number): RgbaImage {
  const img = createRgba(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 0;
      img.data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return img;
}

describe("warpPerspective", () => {
  it("is the identity for the whole photo at its own size", () => {
    const random = rng(11);
    const img = createRgba(37, 23);
    for (let i = 0; i < img.data.length; i++) img.data[i] = random() * 256;
    const out = warpPerspective(img, rect(37, 23), 37, 23)!;
    expect(out.data).toEqual(img.data);
  });

  it("halves a smooth ramp to the ramp's values at the new pixel centres", () => {
    const img = createRgba(200, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 200; x++) img.data.set([x, x, x, 255], (y * 200 + x) * 4);
    }
    const out = warpPerspective(img, rect(200, 4), 100, 2)!;
    for (let x = 1; x < 99; x++) {
      // Output centre x + ½ maps to source 2x + 1, between pixels 2x and 2x + 1.
      expect(Math.abs(out.data[x * 4] - (2 * x + 0.5))).toBeLessThanOrEqual(0.5);
    }
  });

  it("straightens a checkerboard photographed in perspective", () => {
    const board = checkerboard(320, 240, 40);
    // Photograph it: every photo pixel looks up the board through the
    // inverse map, as a camera would see it.
    const corners = quad(140, 60, 520, 110, 560, 430, 90, 400);
    const photo = createRgba(640, 480);
    const toBoard = homographyFromQuads(corners, rect(320, 240))!;
    for (let y = 0; y < 480; y++) {
      for (let x = 0; x < 640; x++) {
        const p = applyHomography(toBoard, x + 0.5, y + 0.5);
        const inside = p.x >= 0 && p.x < 320 && p.y >= 0 && p.y < 240;
        const v = inside ? ((Math.floor(p.x / 40) + Math.floor(p.y / 40)) % 2 ? 255 : 0) : 128;
        photo.data.set([v, v, v, 255], (y * 640 + x) * 4);
      }
    }
    const out = warpPerspective(photo, corners, 320, 240)!;
    // Away from the squares' edges (where resampling blurs), every pixel is exact.
    let checked = 0;
    let wrong = 0;
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 320; x++) {
        const dx = Math.min(x % 40, 39 - (x % 40));
        const dy = Math.min(y % 40, 39 - (y % 40));
        if (dx < 3 || dy < 3) continue;
        checked++;
        const expected = board.data[(y * 320 + x) * 4];
        if (Math.abs(out.data[(y * 320 + x) * 4] - expected) > 8) wrong++;
      }
    }
    expect(checked).toBeGreaterThan(40000);
    expect(wrong).toBe(0);
  });

  it("paints outside the photo with the background colour when one is given", () => {
    const img = createRgba(10, 10);
    img.data.fill(255);
    const out = warpPerspective(img, quad(-10, -10, 20, -10, 20, 20, -10, 20), 3, 3, {
      background: [1, 2, 3, 4],
    })!;
    expect(Array.from(out.data.slice(0, 4))).toEqual([1, 2, 3, 4]); // top-left: outside
    expect(Array.from(out.data.slice(16, 20))).toEqual([255, 255, 255, 255]); // centre
    // Without one, the edge pixel is repeated.
    const clamped = warpPerspective(img, quad(-10, -10, 20, -10, 20, 20, -10, 20), 3, 3)!;
    expect(Array.from(clamped.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it("returns null for a degenerate quad", () => {
    expect(warpPerspective(createRgba(4, 4), quad(0, 0, 1, 1, 2, 2, 3, 3), 4, 4)).toBeNull();
  });
});
