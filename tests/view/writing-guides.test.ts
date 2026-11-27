import { expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings-data";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { watchWritingGuides, writingGuideHost } = await import("../../src/view/writing-guides");

it("syncs guide changes across surfaces and keeps the enabled toggle independent", () => {
  const settings = { ...DEFAULT_SETTINGS, writingGuidesEnabled: false };
  const save = vi.fn();
  const updateNotebook = vi.fn();
  const updateInline = vi.fn();
  const unwatchNotebook = watchWritingGuides(settings, updateNotebook);
  const unwatchInline = watchWritingGuides(settings, updateInline);
  const host = writingGuideHost(settings, save, () => undefined);

  host.configure({ spacing: 99, style: "dots" });
  expect(host.state()).toMatchObject({ enabled: false, style: { spacing: 99, style: "dots" } });
  expect(updateNotebook).toHaveBeenCalledOnce();
  expect(updateInline).toHaveBeenCalledOnce();
  unwatchInline();

  host.enable(true);
  expect(host.state().enabled).toBe(true);
  expect(updateNotebook).toHaveBeenCalledTimes(2);
  expect(updateInline).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledTimes(2);
  unwatchNotebook();
});
