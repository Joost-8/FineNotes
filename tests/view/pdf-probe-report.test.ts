import { describe, expect, it } from "vitest";
import {
  type ProbeResult,
  lateness,
  meanAbsDiff,
  probeReportMarkdown,
} from "../../src/view/pdf-probe-report";

describe("lateness", () => {
  it("measures how late a timer fired, and counts missed frames", () => {
    expect(lateness([5, 6, 30, 5, 71], 5)).toEqual({ worstMs: 66, over16: 2, samples: 5 });
    expect(lateness([4, 5], 5)).toEqual({ worstMs: 0, over16: 0, samples: 2 });
    expect(lateness([], 5)).toEqual({ worstMs: 0, over16: 0, samples: 0 });
  });
});

describe("meanAbsDiff", () => {
  it("is 0 for identical pixels and ignores alpha", () => {
    expect(meanAbsDiff([1, 2, 3, 255], [1, 2, 3, 0])).toBe(0);
  });
  it("averages the channel differences", () => {
    expect(
      meanAbsDiff([0, 0, 0, 255, 255, 255, 255, 255], [30, 0, 0, 255, 255, 255, 255, 255]),
    ).toBe(5);
  });
  it("is NaN for buffers that cannot be compared", () => {
    expect(meanAbsDiff([0, 0, 0, 0], [0, 0, 0])).toBeNaN();
    expect(meanAbsDiff([], [])).toBeNaN();
  });
});

describe("probeReportMarkdown", () => {
  const base: ProbeResult = {
    when: "2026-10-03 20:00",
    file: { name: "Lecture.pdf", pages: 63, megabytes: 4.1 },
    environment: { dpr: 2, crossOriginIsolated: false },
    main: {
      ok: true,
      value: {
        edgePx: 2048,
        pageMs: [120, 80, 100],
        totalMs: 300,
        lateness: { worstMs: 70, over16: 6, samples: 60 },
        blitMs: [1],
      },
    },
    worker: { ok: false, error: "import failed" },
    apple: {
      ok: true,
      value: {
        supported: true,
        naturalSize: "720x540",
        pageMs: 40,
        tileMs: [9.4, 12.6],
        tainted: false,
        diffVsPdfjs: 3.2,
        bitmapMs: "unsupported",
      },
    },
  };

  it("reads as a summary, then carries the raw JSON", () => {
    const md = probeReportMarkdown(base);
    expect(md).toContain("Lecture.pdf (63 pages, 4.1 MB)");
    expect(md).toContain("Pages at 2048 px: 120, 80, 100 ms (median 100, total 300)");
    expect(md).toContain("worst 70 ms late, 6 frames missed");
    expect(md).toContain("Failed: `import failed`");
    expect(md).toContain("512 px tiles at 4x: 9, 13 ms");
    expect(md).toContain("Canvas readable afterwards: yes");
    expect(md).toContain("createImageBitmap: unsupported");
    expect(md).toContain("- crossOriginIsolated: false");
    expect(JSON.parse(md.split("```json\n")[1].split("\n```")[0])).toEqual(base);
  });

  it("says when Apple's engine is not available, or failed", () => {
    expect(
      probeReportMarkdown({ ...base, apple: { ok: true, value: { supported: false } } }),
    ).toContain("- Not available here.");
    expect(probeReportMarkdown({ ...base, apple: { ok: false, error: "timeout" } })).toContain(
      "Failed: `timeout`",
    );
  });

  it("fills in what a run did not measure", () => {
    const md = probeReportMarkdown({
      ...base,
      worker: {
        ok: true,
        value: {
          edgePx: 2048,
          pageMs: [],
          totalMs: 0,
          lateness: { worstMs: 0, over16: 0, samples: 0 },
          diffVsMain: [0.4],
        },
      },
      apple: { ok: true, value: { supported: true, bitmapMs: 12.2 } },
    });
    expect(md).toContain("Pages at 2048 px: – ms");
    expect(md).toContain("Difference from the main-thread render (0-255): 0.4");
    expect(md).toContain("Page 1, drawn and read back: – ms");
    expect(md).toContain("createImageBitmap: 12 ms");
    expect(md).toContain("Canvas readable afterwards: –");
  });
});
