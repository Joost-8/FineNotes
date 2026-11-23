export function parseCoverageInclude(configText: string): string[];
export function isGlob(entry: string): boolean;
export function globToRegExp(glob: string): RegExp;
export function includeMatcher(include: string[]): (file: string) => boolean;
export interface CoverageGaps {
  missing: string[];
  stale: string[];
  dangling: string[];
}
export function coverageGaps(input: {
  files: string[];
  allFiles: string[];
  include: string[];
  baseline: string[];
}): CoverageGaps;
export function fullyListedDirectories(allFiles: string[], include: string[]): string[];

export function countLines(text: string): number;
export interface OverCap {
  file: string;
  cap: number;
  lines: number;
  over: number;
}
export function overCaps(caps: Record<string, number>, counts: Record<string, number>): OverCap[];

export interface CssRule {
  selector: string;
  context: string[];
  body: string;
}
export function stripCssComments(css: string): string;
export function cssRules(css: string): CssRule[];
export function selectorClasses(selector: string): string[];
export function cssClassNames(css: string): Set<string>;
export function classRules(css: string): Map<string, string[]>;
export interface ClassCollision {
  name: string;
  ours: string[];
  theirs: string[];
}
export function classCollisions(sheets: {
  base: string;
  theirs: string;
  ours: string;
}): ClassCollision[];
