import { describe, expect, it } from "vitest";
import {
  type AiMenuContext,
  type AiSetup,
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
    pageAskable: true,
    notebookTranscribable: true,
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
    const items = buildAiMenu(context());
    expect(items.map((i) => i.id)).toEqual([
      "transcribe-page",
      "transcribe-notebook",
      "ask-page",
      "ask-notebook",
      "generate-image",
      "settings",
    ]);
    expect(items.filter((i) => i.footer).map((i) => i.id)).toEqual(["settings"]);
    expect(byId(items).settings.label).toBe("AI settings…");
    expect(byId(items)["transcribe-page"].enabled).toBe(true);
    expect(byId(items)["generate-image"].enabled).toBe(false);
  });

  it("offers 'Set up AI…' and gives every AI entry the same reason when nothing is set up", () => {
    const items = byId(buildAiMenu(context({ setup: setup() })));
    expect(items.settings).toMatchObject({ label: "Set up AI…", enabled: true });
    for (const id of ["transcribe-page", "transcribe-notebook", "ask-page", "ask-notebook"]) {
      expect(items[id], id).toMatchObject({ enabled: false, reason: "Needs an Anthropic key" });
    }
  });

  it("gates transcription on the same setup as questions", () => {
    const items = byId(buildAiMenu(context({ setup: setup() })));
    expect(items["transcribe-page"]).toMatchObject({
      enabled: false,
      reason: "Needs an Anthropic key",
    });
    expect(items["ask-page"].enabled).toBe(false);
  });

  it("says when a page or notebook has nothing on it", () => {
    const items = byId(
      buildAiMenu(
        context({
          pageTranscribable: false,
          pageAskable: false,
          notebookTranscribable: false,
          notebookAskable: false,
        }),
      ),
    );
    expect(items["transcribe-page"].reason).toBe("Nothing written on this page yet");
    expect(items["transcribe-notebook"].reason).toBe("Nothing written in this notebook yet");
    expect(items["ask-page"].reason).toBe("This page is empty");
    expect(items["ask-notebook"].reason).toBe("This notebook is empty");
  });

  it("leaves out the notebook entries for a single page", () => {
    const ids = buildAiMenu(context({ multiPage: false })).map((i) => i.id);
    expect(ids).not.toContain("transcribe-notebook");
    expect(ids).not.toContain("ask-notebook");
  });

  it("offers 'Transcribe recording…' after the ink entries, only where recording exists", () => {
    expect(buildAiMenu(context()).map((i) => i.id)).not.toContain("transcribe-recording");
    const withAudio = setup({ vendor: "openai", keys: ["openai"] });
    const ids = buildAiMenu(context({ setup: withAudio, recordings: 2 })).map((i) => i.id);
    expect(ids).toEqual([
      "transcribe-page",
      "transcribe-notebook",
      "transcribe-recording",
      "ask-page",
      "ask-notebook",
      "generate-image",
      "settings",
    ]);
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
