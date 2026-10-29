/**
 * The Screenshot dialog's second choice (`screenshotSecond`,
 * `src/view/screenshot-modal.ts`): Share where the platform takes a file
 * through Web Share, Save image where it does not.
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { screenshotSecond } = await import("../../src/view/screenshot-modal");

const file = new File([new Uint8Array([1])], "Screenshot.png", { type: "image/png" });

describe("screenshotSecond", () => {
  it("shares where Web Share takes the file", () => {
    const canShare = vi.fn(() => true);
    expect(screenshotSecond(true, canShare, file)).toBe("share");
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
  });

  it("saves where the platform shares no files, has no Web Share, or throws asking", () => {
    expect(screenshotSecond(true, () => false, file)).toBe("save");
    expect(screenshotSecond(false, () => true, file)).toBe("save");
    expect(screenshotSecond(true, undefined, file)).toBe("save");
    expect(
      screenshotSecond(
        true,
        () => {
          throw new Error("no");
        },
        file,
      ),
    ).toBe("save");
  });
});
