import { describe, expect, it } from "vitest";
import {
  type AiMenuContext,
  type AiSetup,
  type DeviceReading,
  aiKeyFolded,
  audioAvailability,
  buildAiMenu,
  imageAvailability,
  resolveImageVendor,
  textAvailability,
} from "../../src/recognition/ai-menu-model";
import type { LlmVendor } from "../../src/recognition/llm-request";

function setup(fields: Partial<AiSetup> & { keys?: LlmVendor[] } = {}): AiSetup {
  const keys = new Set(fields.keys ?? []);
  return {
    vendor: "anthropic",
    baseUrl: "",
    imageVendor: "same",
    hasKey: (slot) => keys.has(slot),
    ...fields,
  };
}

function context(fields: Partial<AiMenuContext> = {}): AiMenuContext {
  return {
    setup: setup({ keys: ["anthropic"] }),
    pageTranscribable: true,
    notebookAskable: true,
    multiPage: true,
    ...fields,
  };
}

const byId = (items: ReturnType<typeof buildAiMenu>) =>
  Object.fromEntries(items.map((item) => [item.id, item]));

describe("availability", () => {
  it("needs the text vendor's own key", () => {
    expect(textAvailability(setup())).toEqual({ enabled: false, reason: "Needs an Anthropic key" });
    expect(textAvailability(setup({ keys: ["anthropic"] })).enabled).toBe(true);
    expect(textAvailability(setup({ vendor: "google", keys: ["anthropic"] })).reason).toBe(
      "Needs a Google key",
    );
  });

  it("needs a usable URL, not a key, for a custom endpoint", () => {
    expect(textAvailability(setup({ vendor: "custom" })).reason).toMatch(/endpoint's URL/);
    expect(textAvailability(setup({ vendor: "custom", baseUrl: "localhost:11434" })).enabled).toBe(
      false,
    );
    expect(
      textAvailability(setup({ vendor: "custom", baseUrl: "http://localhost:11434/v1" })).enabled,
    ).toBe(true);
  });

  it("explains that Claude cannot make images, and names the key an image vendor needs", () => {
    expect(imageAvailability(setup({ keys: ["anthropic"] })).reason).toMatch(
      /Claude cannot make images/,
    );
    expect(imageAvailability(setup({ vendor: "custom" })).reason).toMatch(/OpenAI, Google/);
    const separate = setup({ keys: ["anthropic"], imageVendor: "openai" });
    expect(imageAvailability(separate)).toEqual({
      enabled: false,
      reason: "Needs an OpenAI key for images",
    });
    expect(imageAvailability({ ...separate, hasKey: () => true }).enabled).toBe(true);
    expect(imageAvailability(setup({ vendor: "google", keys: ["google"] })).enabled).toBe(true);
  });

  it("resolves the image vendor", () => {
    expect(resolveImageVendor("same", "openrouter")).toBe("openrouter");
    expect(resolveImageVendor("google", "anthropic")).toBe("google");
  });

  it("gates audio on a vendor that can transcribe it", () => {
    expect(audioAvailability(setup({ keys: ["anthropic"] })).reason).toMatch(/OpenAI or Google/);
    expect(audioAvailability(setup({ vendor: "openrouter", keys: ["openrouter"] })).enabled).toBe(
      false,
    );
    expect(audioAvailability(setup({ vendor: "openai" })).reason).toBe("Needs an OpenAI key");
    expect(audioAvailability(setup({ vendor: "openai", keys: ["openai"] })).enabled).toBe(true);
  });
});

describe("buildAiMenu", () => {
  it("lists every entry in order, settings last below the divider", () => {
    const items = buildAiMenu(context()).filter((i) => i.section !== "device");
    expect(items.map((i) => i.id)).toEqual(["ask", "generate-image", "settings"]);
    expect(byId(items).ask).toMatchObject({ label: "Ask…", enabled: true });
    expect(items.filter((i) => i.footer).map((i) => i.id)).toEqual(["settings"]);
    expect(byId(items).settings.label).toBe("AI settings…");
    expect(byId(items)["generate-image"].enabled).toBe(false);
  });

  it("offers 'Set up AI…' and says what Ask needs when nothing is set up", () => {
    const items = byId(buildAiMenu(context({ setup: setup() })));
    expect(items.settings).toMatchObject({ label: "Set up AI…", enabled: true });
    expect(items.ask).toMatchObject({ enabled: false, reason: "Needs an Anthropic key" });
  });

  it("says when a page or notebook has nothing on it", () => {
    const items = byId(buildAiMenu(context({ notebookAskable: false })));
    expect(items.ask.reason).toBe("This notebook is empty");
    const single = byId(buildAiMenu(context({ multiPage: false, notebookAskable: false })));
    expect(single.ask.reason).toBe("This page is empty");
  });

  it("has no transcription entries; the chat does that", () => {
    const ids = buildAiMenu(context()).map((i) => i.id);
    expect(ids).not.toContain("transcribe-page");
    expect(ids).not.toContain("transcribe-notebook");
  });

  it("offers 'Transcribe recording…' last, after images, only where recording exists", () => {
    expect(buildAiMenu(context()).map((i) => i.id)).not.toContain("transcribe-recording");
    const withAudio = setup({ vendor: "openai", keys: ["openai"] });
    const ids = buildAiMenu(context({ setup: withAudio, recordings: 2 }))
      .filter((i) => i.section !== "device")
      .map((i) => i.id);
    expect(ids).toEqual(["ask", "generate-image", "transcribe-recording", "settings"]);
    const entry = byId(buildAiMenu(context({ setup: withAudio, recordings: 2 })))[
      "transcribe-recording"
    ];
    expect(entry).toMatchObject({ label: "Transcribe recording…", enabled: true, reason: "" });
  });

  it("greys 'Transcribe recording…' out with the reason: no audio vendor, or nothing recorded", () => {
    // Claude reads ink but cannot hear.
    const claude = byId(buildAiMenu(context({ recordings: 1 })))["transcribe-recording"];
    expect(claude.enabled).toBe(false);
    expect(claude.reason).toMatch(/OpenAI or Google/);
    const noKey = byId(buildAiMenu(context({ setup: setup({ vendor: "google" }), recordings: 1 })))[
      "transcribe-recording"
    ];
    expect(noKey).toMatchObject({ enabled: false, reason: "Needs a Google key" });
    const none = byId(
      buildAiMenu(context({ setup: setup({ vendor: "openai", keys: ["openai"] }), recordings: 0 })),
    )["transcribe-recording"];
    expect(none.enabled).toBe(false);
    expect(none.reason).toMatch(/^No recordings in this note yet/);
  });
});

describe("the handwriting section, on this device", () => {
  const device = (fields: Partial<DeviceReading> = {}): DeviceReading => ({
    learned: false,
    practiceFiles: 0,
    learning: null,
    ...fields,
  });
  const deviceIds = (ctx: AiMenuContext) =>
    buildAiMenu(ctx)
      .filter((i) => i.section === "device")
      .map((i) => i.id);

  it("comes first, and works without any key", () => {
    const items = buildAiMenu(context({ setup: setup(), device: device() }));
    expect(items[0]).toMatchObject({ id: "read-page-device", enabled: true, section: "device" });
    expect(items[1]).toMatchObject({ id: "practice", label: "Teach it your handwriting…" });
  });

  it("learns once there is a practice file, again once learned, and shows a run in progress", () => {
    expect(deviceIds(context({ device: device({ practiceFiles: 1 }) }))).toEqual([
      "read-page-device",
      "learn",
      "practice",
    ]);
    const again = byId(
      buildAiMenu(context({ device: device({ practiceFiles: 2, learned: true }) })),
    );
    expect(again.learn.label).toBe("Learn my handwriting again");
    expect(again.practice.label).toBe("Write another practice set");
    const running = byId(
      buildAiMenu(context({ device: device({ practiceFiles: 1, learning: 34.4 }) })),
    );
    expect(running.learn).toMatchObject({
      label: "Learning your handwriting · 34 %",
      enabled: false,
    });
    expect(running.practice).toBeUndefined();
  });

  it("says nothing is written on an empty page", () => {
    const item = byId(buildAiMenu(context({ pageTranscribable: false, device: device() })));
    expect(item["read-page-device"]).toMatchObject({
      enabled: false,
      reason: "Nothing written on this page yet",
    });
  });

  it("points to the setting when the reader is off", () => {
    expect(deviceIds(context())).toEqual(["device-settings"]);
  });
});

describe("aiKeyFolded", () => {
  it("folds the key section only when neither text nor images can run", () => {
    expect(aiKeyFolded(setup())).toBe(true);
    expect(aiKeyFolded(setup({ keys: ["anthropic"] }))).toBe(false);
    // Images alone are enough to show it.
    expect(aiKeyFolded(setup({ imageVendor: "openai", keys: ["openai"] }))).toBe(false);
  });
});
