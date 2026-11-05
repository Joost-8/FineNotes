/**
 * Small reads of the vault shared by the Folders sidebar, its library and its
 * search: which files are notebooks, how many notes a folder holds.
 */

import { type App, TFile, TFolder } from "obsidian";
import { claimsNotebook, isNotebookName } from "../../model/folder-thumbnail";
import { isAttachmentFolderName, isHiddenName } from "../../model/folder-paths";

/** Whether `file` is a FineNotes notebook or page: named so, or claimed by its frontmatter. */
export function isNotebookFile(app: App, file: TFile): boolean {
  if (file.extension.toLowerCase() !== "md") return false;
  if (isNotebookName(file.name)) return true;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  return claimsNotebook(frontmatter?.goodobsidian);
}

/**
 * How many notes are in `folder`, its subfolders included. Hidden files and
 * folders are not counted, nor, when `hideAttachments`, folders called
 * Attachments.
 */
export function countNotes(folder: TFolder, hideAttachments: boolean): number {
  let count = 0;
  for (const child of folder.children) {
    if (isHiddenName(child.name)) continue;
    if (child instanceof TFile) count++;
    else if (child instanceof TFolder && !(hideAttachments && isAttachmentFolderName(child.name))) {
      count += countNotes(child, hideAttachments);
    }
  }
  return count;
}
