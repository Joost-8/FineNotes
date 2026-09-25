/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The plugin's settings tab: the part of Obsidian's settings window the
 * plugin draws, at the width it gets on an iPad in landscape. The frame grows
 * to the tab's full height.
 */
import { GoodObsidianSettingTab } from "../../../src/settings";
import { LLM_PROVIDER_ID } from "../../../src/recognition/llm-request";
import type { Scene } from "./types";
import { fakeApp } from "./fixtures";
import { fakePlugin } from "./view";
import { Notice } from "obsidian";

async function render(
  frame: HTMLElement,
  settle: (ms?: number) => Promise<void>,
  opts: { aiReady?: boolean; settings?: Record<string, unknown> },
): Promise<void> {
  const app = fakeApp();
  const plugin = fakePlugin(app, opts);
  const tab = new GoodObsidianSettingTab(app, plugin);
  const container = frame.createDiv({ cls: "vertical-tab-content-container" });
  container.setCssStyles({ position: "absolute", inset: "0", overflow: "visible" });
  container.appendChild(tab.containerEl);
  // The stub draws the tab from getSettingDefinitions(), as Obsidian 1.13 does.
  tab.display();
  await settle(100);
  frame.style.height = `${Math.ceil(tab.containerEl.scrollHeight) + 48}px`;
}

export const SETTINGS_SCENES: Scene[] = [
  {
    id: "settings",
    title: "Settings tab",
    group: "Settings",
    note: "Obsidian → Settings → GoodObsidian, top to bottom, at the width the tab gets on an iPad. src/settings.ts",
    size: { width: 880, height: 1200 },
    render: ({ frame, settle }) => render(frame, settle, {}),
  },
  {
    id: "settings-ai",
    title: "Settings — AI with your own key",
    group: "Settings",
    note: "Handwriting recognition set to AI, with a key stored: the AI section in full.",
    size: { width: 880, height: 1200 },
    render: ({ frame, settle }) =>
      render(frame, settle, {
        aiReady: true,
        settings: { recognitionProviderId: LLM_PROVIDER_ID, apiKeys: { anthropic: "sk-ant-…" } },
      }),
  },
  {
    id: "notice-scribble",
    title: "Notice — the iPad Scribble tip",
    group: "Settings",
    note: "The one-time notice on first open on an iPad (Obsidian's own notice).",
    size: { width: 1180, height: 400 },
    render: () => {
      new Notice(
        "GoodObsidian tip: if handwriting drops strokes on iPad, turn off Settings → Apple Pencil → Scribble. iPadOS intercepts fast Pencil strokes before GoodObsidian can see them.",
        0,
      );
    },
  },
];
