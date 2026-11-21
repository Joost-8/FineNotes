import { describe, expect, it } from "vitest";
import { DotClock, attachDotClock, detachDotClock, mintedId } from "../../src/model/dot-ids";
import { blankPage, emptyDocument } from "../../src/model/document";
import { nextPageId } from "../../src/model/page-commands";
import { nextImageId } from "../../src/model/images";
import { nextConnectorId } from "../../src/model/connectors";
import { IdSequence } from "../../src/view/id-sequence";

describe("ids made as dots (#274)", () => {
  it("come from the notebook's clock when it has one, as before when not", () => {
    const doc = emptyDocument(1024);
    doc.pages.push(blankPage("p2"));
    expect(nextPageId(doc)).toBe("p3");
    expect(nextImageId(doc)).toBe("i1");
    const clock = new DotClock("ab12cd34");
    attachDotClock(doc, clock);
    expect(nextPageId(doc)).toBe("ab12cd34.1");
    expect(nextImageId(doc)).toBe("ab12cd34.2");
    expect(nextConnectorId(doc)).toBe("ab12cd34.3");
    const strokes = new IdSequence("s", () => doc);
    expect(strokes.next()).toBe("ab12cd34.4");
    detachDotClock(doc);
    expect(mintedId(doc)).toBeNull();
    expect(strokes.next()).toBe("s1");
  });

  it("count on past every dot of their device they are shown, never back", () => {
    const clock = new DotClock("ab12cd34", 3);
    clock.raise(["ab12cd34.9", "zz.40", "s12", undefined, "ab12cd34.2"]);
    expect(clock.last).toBe(9);
    clock.raiseTo(4);
    expect(clock.next()).toBe("ab12cd34.10");
    expect(() => new DotClock("A.B")).toThrow();
  });
});
