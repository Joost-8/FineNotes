export interface ListedSponsor {
  login: string;
  name: string;
  release: string;
}
export interface FetchedSponsor {
  login: string;
  name: string | null;
}
export const README_START: string;
export const README_END: string;
export function mergeSponsors(list: ListedSponsor[], fetched: FetchedSponsor[]): ListedSponsor[];
export function stampRelease(list: ListedSponsor[], version: string): ListedSponsor[];
export function readmeBlock(list: ListedSponsor[]): string;
export function replaceBlock(readme: string, block: string): string;
