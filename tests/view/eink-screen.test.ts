import { afterEach, describe, expect, it } from "vitest";
import { EINK_CLASS, EinkScreen, type EinkHost } from "../../src/view/eink-screen";
import { prefersReducedMotion, setEinkStill } from "../../src/view/motion";

/** A body that records its classes, as Obsidian's `toggleClass` sets them. */
function body(): HTMLElement & { classes: Set<string> } {
  const classes = new Set<string>();
  return {
    classes,
    toggleClass: (cls: string, on: boolean) => (on ? classes.add(cls) : classes.delete(cls)),
    removeClass: (cls: string) => classes.delete(cls),
  } as unknown as HTMLElement & { classes: Set<string> };
}

function host(stored: unknown = undefined) {
  const bodies = [body()];
  const saved: unknown[] = [];
  const applied: boolean[] = [];
  const h: EinkHost = {
    load: () => stored,
    save: (choice) => saved.push(choice),
    bodies: () => bodies,
    apply: (on) => applied.push(on),
  };
  return { h, bodies, saved, applied };
}

/** Chromium's `userAgentData`, saying the device is `model`. */
function agent(model: string) {
  const answer = Promise.resolve({ model });
  const asked: string[][] = [];
  return {
    asked,
    answered: () => answer.then(() => Promise.resolve()),
    data: {
      getHighEntropyValues: (hints: string[]) => {
        asked.push(hints);
        return answer;
      },
    },
  };
}

/** A window that does not ask for less motion. */
const calm = { matchMedia: () => ({ matches: false }) } as unknown as Window;

afterEach(() => setEinkStill(false));

describe("E-ink screen on this device", () => {
  it("turns on by itself once Chromium says the device is a Boox", async () => {
    const boox = host();
    const screen = new EinkScreen(boox.h);
    const chromium = agent("NoteAir3C");
    screen.start(chromium.data);
    expect(screen.on).toBe(false);
    await chromium.answered();
    expect(chromium.asked).toEqual([["model"]]);
    expect(screen.choice).toBe("auto");
    expect(screen.detected).toBe(true);
    expect(screen.on).toBe(true);
    expect(boox.bodies[0].classes.has(EINK_CLASS)).toBe(true);
    expect(boox.applied).toEqual([false, true]);
    expect(prefersReducedMotion(calm)).toBe(true);
    expect(screen.report()).toEqual({
      choice: "auto",
      on: true,
      model: "NoteAir3C",
      modelApi: true,
    });
  });

  it("stays off on another tablet", async () => {
    const galaxy = host();
    const screen = new EinkScreen(galaxy.h);
    const chromium = agent("SM-X900");
    screen.start(chromium.data);
    await chromium.answered();
    expect(screen.on).toBe(false);
    expect(galaxy.bodies[0].classes.has(EINK_CLASS)).toBe(false);
    expect(prefersReducedMotion(calm)).toBe(false);
  });

  it("stays off where the WebView cannot say, and when it will not", async () => {
    const none = new EinkScreen(host().h);
    none.start(undefined);
    expect(none.on).toBe(false);
    expect(none.report()).toEqual({ choice: "auto", on: false, model: null, modelApi: false });

    const refused = new EinkScreen(host().h);
    const failed = Promise.reject(new Error("denied"));
    refused.start({ getHighEntropyValues: () => failed });
    await failed.catch(() => undefined);
    await Promise.resolve();
    expect(refused.on).toBe(false);
    expect(refused.report().model).toBeNull();

    const blank = new EinkScreen(host().h);
    const empty = agent("");
    blank.start(empty.data);
    await empty.answered();
    expect(blank.report().model).toBeNull();
  });

  it("keeps a stored On or Off over what the device is, and saves a new choice", async () => {
    const off = host("off");
    const screen = new EinkScreen(off.h);
    const chromium = agent("Palma 2");
    screen.start(chromium.data);
    await chromium.answered();
    expect(screen.on).toBe(false);

    screen.set("on");
    expect(off.saved).toEqual(["on"]);
    expect(screen.on).toBe(true);
    expect(off.bodies[0].classes.has(EINK_CLASS)).toBe(true);
    expect(off.applied.at(-1)).toBe(true);

    expect(new EinkScreen(host("on").h).on).toBe(true);
  });

  it("takes everything back when the plugin stops", async () => {
    const boox = host("on");
    const screen = new EinkScreen(boox.h);
    screen.start(undefined);
    expect(boox.bodies[0].classes.has(EINK_CLASS)).toBe(true);
    screen.stop();
    expect(boox.bodies[0].classes.has(EINK_CLASS)).toBe(false);
    expect(prefersReducedMotion(calm)).toBe(false);
  });
});
