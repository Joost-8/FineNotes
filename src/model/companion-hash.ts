/**
 * The content hash a Companion PDF carries in its Subject: which notebook
 * content it shows. Made from the pages as they are saved (the save cache's
 * fragments), never from a decoded copy, and the same on every device for
 * the same saved notebook, whatever its pen settings. Pure: the digest is
 * handed in.
 */

/** A saved page: its stored JSON, and the save cache's number for that exact text. */
export interface HashedPage {
  readonly json: string;
  readonly slot: number;
}

export interface CompanionHashSource {
  /** The notebook's name, which headers and footers print. */
  title: string;
  /** The page furniture (headers, numbers) as read, or `undefined` for a board. */
  furniture: unknown;
  pages: readonly HashedPage[];
  /** The files pages are drawn from, by path and size. */
  resources: readonly { path: string; size: number }[];
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortedKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * A page's saved JSON with every object's keys in one order. A command can
 * leave a page's keys in another order than the loader makes (a text box's
 * `bold` added after its `rotation`), so the same page would otherwise hash
 * differently before and after a reload, or on another device.
 */
export function canonicalJson(json: string): string {
  return JSON.stringify(sortedKeys(JSON.parse(json)));
}

/** Hex SHA-256 (or any digest) of a text. */
export type Digest = (text: string) => Promise<string>;

/**
 * Hashes a notebook a page at a time. A page whose saved text has not
 * changed since the last hash (the same slot) is not hashed again, so a
 * check after one edited page costs one page.
 */
export class CompanionHasher {
  private bySlot = new Map<number, string>();

  constructor(private readonly digest: Digest) {}

  async hash(source: CompanionHashSource): Promise<string> {
    const next = new Map<number, string>();
    const parts: string[] = [];
    for (const page of source.pages) {
      let part = next.get(page.slot) ?? this.bySlot.get(page.slot);
      if (part === undefined) part = await this.digest(canonicalJson(page.json));
      next.set(page.slot, part);
      parts.push(part);
    }
    this.bySlot = next;
    const head = JSON.stringify({
      title: source.title,
      furniture: source.furniture ?? null,
      resources: source.resources.map(({ path, size }) => [path, size]),
    });
    return (await this.digest(`${head}\n${parts.join("\n")}`)).slice(0, 16);
  }
}
