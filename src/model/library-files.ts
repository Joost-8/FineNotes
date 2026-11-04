/**
 * What the library's Move, Duplicate and Delete act on. A notebook with a
 * folder of its own (`X/X.notebook.md` beside `Images/`, `Recordings/`,
 * `Transcripts/`, `AI chats/` and `Exports/`, see `notebookPaths`) is that
 * folder: it moves whole, a copy gets a folder of its own, and a delete takes
 * the folder with it, so the two never part. Files of the user's own that
 * share a folder with notebooks are never deleted with them.
 *
 * Pure: the view lists the vault's files and does the moving.
 */

import { baseName, isFolderNotebook, parentPath } from "./folder-notebook";
import { t, tn } from "../i18n/translate";
import { freeName } from "./library-style";
import { NOTEBOOK_FILE_SUFFIX } from "../constants";
import { OWN_FOLDERS, inkFileSuffix, stripInkSuffix } from "./new-notebook";

/** Whether `path` lies below `folder`. */
function under(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

function join(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/**
 * What goes where the notebook at `notePath` goes: its own folder, when it
 * is in one that holds no other notebook, else the note itself. `files` is
 * every file in the vault.
 */
export function notebookUnit(
  notePath: string,
  files: readonly string[],
  isNotebook: (path: string) => boolean,
): string {
  if (!isFolderNotebook(notePath)) return notePath;
  const folder = parentPath(notePath);
  const other = files.some((p) => p !== notePath && under(p, folder) && isNotebook(p));
  return other ? notePath : folder;
}

/**
 * Whether `path`, in `folder`, the own folder of the notebook at `notePath`,
 * is the notebook's: the note, what its own sub-folders hold, and its
 * sidecars beside it (`X.transcript.md`).
 */
function ownedBy(path: string, folder: string, notePath: string): boolean {
  if (path === notePath) return true;
  const rest = path.slice(folder.length + 1).toLowerCase();
  const slash = rest.indexOf("/");
  if (slash >= 0) {
    const sub = rest.slice(0, slash);
    return OWN_FOLDERS.some((name) => name.toLowerCase() === sub);
  }
  return rest.startsWith(`${stripInkSuffix(baseName(notePath)).toLowerCase()}.`);
}

/** A notebook or a folder picked in the library. */
export interface Picked {
  path: string;
  folder: boolean;
}

/** What a Delete puts in the trash. */
export interface TrashPlan {
  /** Outermost first: whole folders where everything in them goes, else single files. */
  trash: string[];
  /** The notebooks that go. */
  notebooks: string[];
  /** Files of the user's own left where they are, in the picked folders. */
  kept: number;
}

/**
 * Deleting `picked`: every notebook picked, or in a picked folder, with the
 * folder of its own. A folder goes whole only when nothing else is in it;
 * otherwise only the notebooks in it go, and the rest stays.
 */
export function trashPlan(
  picked: readonly Picked[],
  files: readonly string[],
  isNotebook: (path: string) => boolean,
): TrashPlan {
  const notebooks = new Set<string>();
  const roots: string[] = [];
  for (const item of picked) {
    if (item.folder) {
      roots.push(item.path);
      for (const p of files) if (under(p, item.path) && isNotebook(p)) notebooks.add(p);
    } else if (isNotebook(item.path)) {
      notebooks.add(item.path);
    }
  }
  const doomed = new Set<string>();
  for (const note of notebooks) {
    doomed.add(note);
    const unit = notebookUnit(note, files, isNotebook);
    if (unit === note) continue;
    roots.push(unit);
    for (const p of files) if (under(p, unit) && ownedBy(p, unit, note)) doomed.add(p);
  }

  const trash = new Set<string>();
  let kept = 0;
  /** `folder` whole when all it holds goes (the outermost may hold nothing), else what goes in it. */
  const walk = (folder: string, outermost: boolean): void => {
    const inside = files.filter((p) => under(p, folder));
    const going = inside.filter((p) => doomed.has(p));
    if (going.length === inside.length && (outermost || going.length > 0)) {
      trash.add(folder);
      return;
    }
    const subfolders = new Set<string>();
    for (const p of inside) {
      const rest = p.slice(folder.length + 1);
      const slash = rest.indexOf("/");
      if (slash >= 0) subfolders.add(join(folder, rest.slice(0, slash)));
      else if (doomed.has(p)) trash.add(p);
      else kept++;
    }
    for (const sub of subfolders) walk(sub, false);
  };
  const outer = [...new Set(roots)]
    .sort((a, b) => a.length - b.length)
    .filter((root, i, all) => !all.slice(0, i).some((above) => under(root, above)));
  for (const root of outer) walk(root, true);
  for (const p of doomed) if (!outer.some((root) => under(p, root))) trash.add(p);

  return { trash: [...trash], notebooks: [...notebooks], kept };
}

/** The question a Delete asks before it does anything: what goes, and what stays. */
export function trashQuestion(plan: TrashPlan): { title: string; message: string } {
  const names = plan.notebooks
    .map((p) => stripInkSuffix(baseName(p)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((name) => `"${name}"`);
  const count = names.length;
  const shown =
    count > 4
      ? [...names.slice(0, 3), t("notebooks.home.deleteMore", { count: count - 3 })]
      : names;
  const list =
    shown.length > 1
      ? t("ai.list.and", { head: shown.slice(0, -1).join(", "), last: shown.at(-1) ?? "" })
      : (shown[0] ?? "");
  const folders = plan.trash.filter((p) => !inkFileSuffix(baseName(p)));
  const title =
    count === 1
      ? t("notebooks.home.deleteOne", { name: names[0] ?? "" })
      : count > 1
        ? tn("notebooks.home.deleteNotebooks", count)
        : folders.length === 1
          ? t("notebooks.home.deleteFolder", { name: baseName(folders[0] ?? "") })
          : tn("notebooks.home.deleteFolders", folders.length);
  const parts: string[] = [];
  if (count > 0) {
    parts.push(
      t(count === 1 ? "notebooks.home.deleteListOne" : "notebooks.home.deleteListMany", { list }),
    );
  } else parts.push(t("notebooks.home.deleteEmptyFolders"));
  if (plan.kept > 0) parts.push(tn("notebooks.home.keptFiles", plan.kept));
  return { title, message: parts.join(" ") };
}

/** Where a Duplicate of the notebook at `notePath` goes. */
export interface DuplicatePlan {
  /** Folders to make first, outermost first: a copy of an own-folder notebook gets one too. */
  folders: string[];
  /** The copy's path. */
  note: string;
}

/**
 * `X copy` beside the notebook, or `X copy 2`…; a notebook whose own folder
 * is `unit` is copied into an own folder of its own, beside the original's.
 * `taken` says whether a path is in use.
 */
export function duplicatePlan(
  notePath: string,
  unit: string,
  taken: (path: string) => boolean,
): DuplicatePlan {
  const suffix = inkFileSuffix(baseName(notePath)) ?? NOTEBOOK_FILE_SUFFIX;
  const base = t("notebooks.home.copyName", { name: stripInkSuffix(baseName(notePath)) });
  if (unit === notePath) {
    const dir = parentPath(notePath);
    return {
      folders: [],
      note: join(
        dir,
        freeName(base, suffix, (n) => taken(join(dir, n))),
      ),
    };
  }
  const above = parentPath(unit);
  const name = freeName(base, "", (n) => taken(join(above, n)));
  const folder = join(above, name);
  return {
    folders: [folder, ...OWN_FOLDERS.map((sub) => `${folder}/${sub}`)],
    note: `${folder}/${name}${suffix}`,
  };
}
