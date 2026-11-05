/**
 * The Folders sidebar's rows in FineNotes' settings: what the sidebar shows,
 * searching inside notes (with the state of the index), the library's
 * default view, and bringing the tips back. The settings tab shows them
 * under the simple look, which is what puts the sidebar on screen.
 */

import type { Setting, SettingDefinition } from "obsidian";
import type { FolderSidebarData, LibraryViewMode } from "../../model/folder-sidebar-data";
import { t, tn } from "../../i18n/translate";
import type { FolderSidebarController } from "./controller";

type ToggleKey = {
  [K in keyof FolderSidebarData]: FolderSidebarData[K] extends boolean ? K : never;
}[keyof FolderSidebarData];

/** What the rows need of the settings tab. */
export interface FolderSettingsHost {
  controller: FolderSidebarController;
  /** Run `cleanup` when the tab is closed or drawn again. */
  onHide(cleanup: () => void): void;
}

function drawn(
  name: string,
  desc: string,
  render: (setting: Setting) => void,
  aliases: string[],
): SettingDefinition {
  return { name, desc: desc || undefined, aliases, render };
}

/** The line under "Search index": how much is indexed, and what is left to do. */
export function indexStatusText(controller: FolderSidebarController): string {
  const status = controller.searchIndex.getStatus();
  const parts = [
    t("settings.folderSidebar.indexed", {
      docs: status.docs,
      notebooks: status.notebooks,
      pdfs: status.pdfs,
    }),
  ];
  if (status.running) parts.push(tn("settings.folderSidebar.reading", status.queued));
  if (status.unsearchablePdfs > 0) {
    parts.push(tn("settings.folderSidebar.unsearchable", status.unsearchablePdfs));
  }
  if (status.tooLargePdfs > 0) {
    parts.push(tn("settings.folderSidebar.tooLarge", status.tooLargePdfs));
  }
  return `${parts.join(". ")}.`;
}

/** Every row of the section, in order. */
export function folderSidebarRows(host: FolderSettingsHost): SettingDefinition[] {
  const { controller } = host;
  const toggle = (
    key: ToggleKey,
    name: string,
    desc: string,
    aliases: string[],
    after?: (on: boolean) => void,
  ): SettingDefinition =>
    drawn(
      name,
      desc,
      (setting) => {
        setting.addToggle((control) =>
          control.setValue(controller.data[key]).onChange(async (on) => {
            controller.data[key] = on;
            await controller.save();
            after?.(on);
            controller.notifyDataChanged();
          }),
        );
      },
      aliases,
    );
  return [
    toggle(
      "showFilesInSidebar",
      t("settings.folderSidebar.showFiles.name"),
      t("settings.folderSidebar.showFiles.desc"),
      ["folders", "files", "notes", "tree"],
    ),
    toggle(
      "showCounts",
      t("settings.folderSidebar.showCounts.name"),
      t("settings.folderSidebar.showCounts.desc"),
      ["folders", "count", "number of notes"],
    ),
    toggle(
      "showPinned",
      t("settings.folderSidebar.showPinned.name"),
      t("settings.folderSidebar.showPinned.desc"),
      ["folders", "pin", "favorites"],
    ),
    toggle(
      "showRecent",
      t("settings.folderSidebar.showRecent.name"),
      t("settings.folderSidebar.showRecent.desc"),
      ["folders", "last", "history"],
    ),
    toggle(
      "autoColorNewFolders",
      t("settings.folderSidebar.autoColor.name"),
      t("settings.folderSidebar.autoColor.desc"),
      ["folders", "colour", "random"],
    ),
    toggle(
      "hideAttachmentFolders",
      t("settings.folderSidebar.hideAttachments.name"),
      t("settings.folderSidebar.hideAttachments.desc"),
      ["folders", "attachments", "pdf"],
    ),
    toggle(
      "searchInNotes",
      t("settings.folderSidebar.searchNotes.name"),
      t("settings.folderSidebar.searchNotes.desc"),
      ["folders", "search", "find", "text", "pdf", "ocr"],
      (on) => (on ? controller.searchIndex.enable() : controller.searchIndex.disable()),
    ),
    drawn(
      t("settings.folderSidebar.index.name"),
      "",
      (setting) => {
        const show = (): void => {
          setting.setDesc(indexStatusText(controller));
        };
        show();
        setting.addButton((button) =>
          button.setButtonText(t("settings.folderSidebar.index.rebuild")).onClick(async () => {
            await controller.searchIndex.rebuild();
            show();
          }),
        );
        host.onHide(controller.searchIndex.onChange(show));
      },
      ["folders", "search", "rebuild", "index"],
    ),
    drawn(
      t("settings.folderSidebar.defaultView.name"),
      t("settings.folderSidebar.defaultView.desc"),
      (setting) => {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOption("grid", t("view.folders.grid"))
            .addOption("list", t("view.folders.list"))
            .setValue(controller.data.libraryViewMode)
            .onChange((mode) => controller.setLibraryViewMode(mode as LibraryViewMode)),
        );
      },
      ["folders", "library", "grid", "list", "thumbnails"],
    ),
    drawn(
      t("settings.folderSidebar.tips.name"),
      t("settings.folderSidebar.tips.desc"),
      (setting) => {
        setting.addButton((button) =>
          button.setButtonText(t("settings.folderSidebar.tips.reset")).onClick(async () => {
            controller.data.seenIntro = false;
            await controller.save();
            controller.notifyDataChanged();
          }),
        );
      },
      ["folders", "intro", "help", "tips"],
    ),
  ];
}
