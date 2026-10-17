/**
 * Sharing a template with the community gallery: the address of the
 * gallery's "Submit a template" form on GitHub, filled in from what the
 * user typed in FineNotes. GitHub issue forms take each field's value from
 * a query parameter named after its id, and a dropdown's by its option's
 * label, so these match `.github/ISSUE_TEMPLATE/submit-template.yml` in
 * Joost-8/FineNotes-templates. The file itself is dragged in on GitHub: a
 * web address cannot carry it.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { TEMPLATE_LICENCES, type TemplateLicence } from "../import/template-package";

/** The community gallery's repository. */
export const GALLERY_REPOSITORY = "Joost-8/FineNotes-templates";

/** The categories as the form lists them. */
export const SHARE_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "planner", label: "Planner" },
  { id: "study", label: "Study" },
  { id: "journal", label: "Journal" },
  { id: "work", label: "Work" },
  { id: "paper", label: "Paper" },
  { id: "other", label: "Other" },
];

export interface ShareDetails {
  name: string;
  author: string;
  category: string;
  licence: TemplateLicence;
  description?: string;
  /** Comma-separated words. */
  tags?: string;
}

/** The form's address with `details` filled in. */
export function submissionUrl(details: ShareDetails): string {
  const params = new URLSearchParams();
  params.set("template", "submit-template.yml");
  const name = details.name.trim();
  params.set("title", `Template: ${name}`);
  params.set("name", name);
  params.set("author", details.author.trim());
  const category = SHARE_CATEGORIES.find((c) => c.id === details.category);
  if (category) params.set("category", category.label);
  const licence = TEMPLATE_LICENCES.find((l) => l.id === details.licence);
  if (licence) params.set("licence", licence.label);
  if (details.description?.trim()) params.set("description", details.description.trim());
  if (details.tags?.trim()) params.set("tags", details.tags.trim());
  return `https://github.com/${GALLERY_REPOSITORY}/issues/new?${params.toString()}`;
}

/** What the share form asks before it opens GitHub: what is missing, or nothing. */
export function shareProblems(details: ShareDetails): string[] {
  const problems: string[] = [];
  if (!details.name.trim()) problems.push("Give the template a name.");
  if (!details.author.trim()) problems.push("Add your name, as it should show in the gallery.");
  return problems;
}
