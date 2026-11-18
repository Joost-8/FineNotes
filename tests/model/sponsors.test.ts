import { describe, expect, it } from "vitest";
import {
  SPONSORS,
  type Sponsor,
  joinNames,
  sponsorName,
  sponsorThanks,
} from "../../src/model/sponsors";

const s = (login: string, release: string, name = ""): Sponsor => ({ login, name, release });

// Oldest first, as sponsors.json keeps them.
const LIST = [s("ann", "2.8.0"), s("bo", "2.9.0"), s("cy", "2.9.0"), s("di", "2.10.0")];

describe("sponsorThanks", () => {
  it("thanks the newest first, then everyone before them, newest first", () => {
    expect(sponsorThanks("2.9.1", "2.10.0", LIST)).toEqual({
      fresh: [LIST[3]],
      earlier: [LIST[2], LIST[1], LIST[0]],
    });
  });

  it("counts every release since the news began", () => {
    const thanks = sponsorThanks("2.8.0", "2.10.0", LIST);
    expect(thanks?.fresh.map((x) => x.login)).toEqual(["di", "cy", "bo"]);
    expect(thanks?.earlier.map((x) => x.login)).toEqual(["ann"]);
  });

  it("thanks nobody when no sponsor joined since", () => {
    expect(sponsorThanks("2.10.0", "2.10.1", LIST)).toBeNull();
  });

  it("thanks nobody when there is no news", () => {
    expect(sponsorThanks("", "2.10.0", LIST)).toBeNull();
  });

  it("leaves out sponsors of a release newer than the one running", () => {
    expect(sponsorThanks("2.8.0", "2.9.0", LIST)?.fresh.map((x) => x.login)).toEqual(["cy", "bo"]);
  });

  it("counts a sponsor no release has stamped yet as new", () => {
    const list = [...LIST, s("ed", "")];
    expect(sponsorThanks("2.10.0", "2.10.1", list)?.fresh.map((x) => x.login)).toEqual(["ed"]);
  });

  it("thanks everyone when the news is shown again from the start", () => {
    expect(sponsorThanks("0.0.0", "2.10.0", LIST)?.fresh).toHaveLength(4);
  });
});

describe("sponsorName", () => {
  it("is the profile's name, or the login without one", () => {
    expect(sponsorName(s("ann", "2.8.0", " Ann Lee "))).toBe("Ann Lee");
    expect(sponsorName(s("ann", "2.8.0", "  "))).toBe("ann");
  });
});

describe("joinNames", () => {
  it("lists names the way the language does", () => {
    expect(joinNames(["A", "B", "C"], "en")).toBe("A, B, and C");
    expect(joinNames(["A", "B"], "nl")).toBe("A en B");
    expect(joinNames(["A"], "en")).toBe("A");
  });
});

describe("sponsors.json", () => {
  it("holds a login, a name and a release or nothing yet for everyone, each once", () => {
    const logins = SPONSORS.map((x) => x.login.toLowerCase());
    expect(new Set(logins).size).toBe(logins.length);
    for (const sponsor of SPONSORS) {
      expect(sponsor.login).toMatch(/^[A-Za-z0-9-]+$/);
      expect(typeof sponsor.name).toBe("string");
      expect(sponsor.release).toMatch(/^(\d+\.\d+\.\d+)?$/);
    }
  });
});
