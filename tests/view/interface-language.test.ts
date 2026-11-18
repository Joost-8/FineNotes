import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fetch timeout runs on window's timers, as everywhere in the plugin.
vi.stubGlobal("window", globalThis);
const request = vi.fn();
let obsidianLanguage = "de";
vi.mock("obsidian", () => ({
  getLanguage: () => obsidianLanguage,
  requestUrl: (param: unknown) => request(param) as Promise<unknown>,
  setIcon: () => undefined,
}));

const { InterfaceLanguage } = await import("../../src/view/interface-language");
const { drawLanguageRow } = await import("../../src/view/language-row");
const { currentLanguage, t, useLanguage } = await import("../../src/i18n/translate");
const { INTERFACE_LANGUAGES } = await import("../../src/i18n/languages");

/** An adapter over a map of path to text. */
function fakeAdapter(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));
  return {
    store,
    exists: vi.fn((path: string) =>
      Promise.resolve(store.has(path) || path.endsWith("/languages")),
    ),
    read: vi.fn((path: string) => Promise.resolve(store.get(path) ?? "")),
    write: vi.fn((path: string, text: string) => {
      store.set(path, text);
      return Promise.resolve();
    }),
    mkdir: vi.fn(() => Promise.resolve()),
  };
}

const DIR = ".obsidian/plugins/finenotes";
const CACHE = `${DIR}/languages/de.json`;
const GERMAN = { "common.cancel": "Abbrechen" };

function make(chosen: string | undefined, adapter = fakeAdapter(), version = "2.8.0") {
  const language = new InterfaceLanguage({
    version,
    pluginDir: () => DIR,
    adapter: adapter as never,
    chosen: () => chosen,
  });
  return { language, adapter };
}

beforeEach(() => {
  request.mockReset();
  obsidianLanguage = "de";
});
afterEach(() => useLanguage("en"));

describe("InterfaceLanguage.start", () => {
  it("stays English, fetching nothing, when English is wanted", async () => {
    const { language } = make("en");
    await language.start();
    expect(currentLanguage()).toBe("en");
    expect(request).not.toHaveBeenCalled();
  });

  it("uses this version's cached table and fetches nothing", async () => {
    const adapter = fakeAdapter({ [CACHE]: JSON.stringify({ version: "2.8.0", texts: GERMAN }) });
    const { language } = make("auto", adapter);
    await language.start();
    expect(currentLanguage()).toBe("de");
    expect(t("common.cancel")).toBe("Abbrechen");
    expect(request).not.toHaveBeenCalled();
  });

  it("uses an older version's table now, and fetches this version's for next time", async () => {
    const adapter = fakeAdapter({ [CACHE]: JSON.stringify({ version: "2.7.0", texts: GERMAN }) });
    request.mockResolvedValue({ status: 200, json: { "common.cancel": "Abbrechen!" } });
    const { language } = make("de", adapter);
    await language.start();
    expect(t("common.cancel")).toBe("Abbrechen");
    await vi.waitFor(() => expect(adapter.write).toHaveBeenCalled());
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      url: "https://raw.githubusercontent.com/Joost-8/FineNotes/2.8.0/src/i18n/locales/de.json",
    });
    expect(JSON.parse(adapter.store.get(CACHE) ?? "")).toEqual({
      version: "2.8.0",
      texts: { "common.cancel": "Abbrechen!" },
    });
  });

  it("starts in English when nothing is cached, without waiting for the network", async () => {
    request.mockReturnValue(new Promise(() => undefined));
    const { language } = make("de");
    await language.start();
    expect(currentLanguage()).toBe("en");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("InterfaceLanguage.apply", () => {
  it("fetches, caches and uses a language not cached yet", async () => {
    request.mockResolvedValue({ status: 200, json: GERMAN });
    const { language, adapter } = make("de");
    expect(await language.apply()).toBe(true);
    expect(currentLanguage()).toBe("de");
    expect(adapter.store.has(CACHE)).toBe(true);
  });

  it("says so, and keeps the interface as it was, when the table cannot be had", async () => {
    request.mockResolvedValue({ status: 404, json: null });
    const { language } = make("fr");
    expect(await language.apply()).toBe(false);
    expect(currentLanguage()).toBe("en");
  });

  it("takes the table from the main branch when the version's tag has none", async () => {
    request.mockImplementation((param: { url: string }) =>
      Promise.resolve(
        param.url.includes("/main/") ? { status: 200, json: GERMAN } : { status: 404, json: null },
      ),
    );
    const { language, adapter } = make("de");
    expect(await language.apply()).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(currentLanguage()).toBe("de");
    expect(adapter.store.has(CACHE)).toBe(true);
  });

  it("falls back to an older cached table when the fetch fails", async () => {
    const adapter = fakeAdapter({ [CACHE]: JSON.stringify({ version: "2.7.0", texts: GERMAN }) });
    request.mockRejectedValue(new Error("offline"));
    const { language } = make("de", adapter);
    expect(await language.apply()).toBe(true);
    expect(t("common.cancel")).toBe("Abbrechen");
  });

  it("follows Obsidian's own language when the choice is auto", async () => {
    obsidianLanguage = "en";
    const { language } = make("auto");
    expect(language.wanted()).toBe("en");
    expect(await language.apply()).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

/** Just enough of Obsidian's Setting for the row. */
function fakeSetting() {
  const dropdown = {
    options: [] as [string, string][],
    value: "",
    disabled: false,
    label: "",
    change: (_v: string): void => undefined,
    addOption(value: string, text: string) {
      this.options.push([value, text]);
      return this;
    },
    setValue(value: string) {
      this.value = value;
      return this;
    },
    setDisabled(d: boolean) {
      this.disabled = d;
      return this;
    },
    onChange(fn: (v: string) => void) {
      this.change = fn;
      return this;
    },
    selectEl: { setAttribute: (_n: string, v: string) => (dropdown.label = v) },
  };
  const buttons: string[] = [];
  const classes: string[] = [];
  const icons: string[] = [];
  const setting = {
    desc: "",
    dropdown,
    buttons,
    classes,
    icons,
    settingEl: { addClass: (cls: string) => classes.push(cls) },
    nameEl: {
      querySelector: (sel: string) =>
        icons.length > 0 && sel.includes("section-icon") ? {} : null,
      createSpan: ({ cls }: { cls: string }) => (icons.push(cls), {}),
      prepend: () => undefined,
    },
    addDropdown(fn: (d: typeof dropdown) => void) {
      fn(dropdown);
      return this;
    },
    setDesc(text: string) {
      this.desc = text;
      return this;
    },
    addButton(fn: (b: unknown) => void) {
      const b = {
        setButtonText: (text: string) => (buttons.push(text), b),
        setTooltip: () => b,
        setCta: () => b,
        onClick: () => b,
      };
      fn(b);
      return this;
    },
  };
  return setting;
}

describe("the Language row", () => {
  it("offers Follow Obsidian, named for Obsidian's language, then every language in itself", () => {
    const s = fakeSetting();
    drawLanguageRow(s as never, { chosen: () => undefined, choose: vi.fn(), redraw: vi.fn() });
    expect(s.dropdown.options[0]).toEqual(["auto", "Follow Obsidian (Deutsch)"]);
    expect(s.dropdown.options.slice(1)).toEqual(INTERFACE_LANGUAGES.map((l) => [l.code, l.name]));
    expect(s.dropdown.value).toBe("auto");
    expect(s.dropdown.label).toBe("Language");
    expect(s.buttons).toEqual([]);
  });

  it("shows a stored choice, and an unknown one as Follow Obsidian", () => {
    const fr = fakeSetting();
    drawLanguageRow(fr as never, { chosen: () => "fr", choose: vi.fn(), redraw: vi.fn() });
    expect(fr.dropdown.value).toBe("fr");
    const odd = fakeSetting();
    drawLanguageRow(odd as never, { chosen: () => "xx", choose: vi.fn(), redraw: vi.fn() });
    expect(odd.dropdown.value).toBe("auto");
  });

  it("after a failed choice says so; after any choice offers a relaunch", async () => {
    const choose = vi.fn(() => Promise.resolve(false));
    const redraw = vi.fn();
    const s = fakeSetting();
    drawLanguageRow(s as never, { chosen: () => "auto", choose, redraw });
    s.dropdown.change("fr");
    expect(s.dropdown.disabled).toBe(true);
    expect(s.desc).toBe("Getting the language…");
    await vi.waitFor(() => expect(redraw).toHaveBeenCalled());
    expect(choose).toHaveBeenCalledWith("fr");
    const again = fakeSetting();
    drawLanguageRow(again as never, { chosen: () => "fr", choose, redraw });
    expect(again.desc).toBe("Could not get this language. FineNotes stays in English for now.");
    expect(again.buttons).toEqual(["Relaunch"]);
  });
});
