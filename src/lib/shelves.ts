import { getAuthors, getAuthorDetail, getDiscoveryByTags } from "./api";
import { filterAuthors, type PlayedStatus } from "./browse";

export type ShelfKind = "tag" | "creator" | "status";

export interface HomeShelf {
  id: string;            // stable unique id (e.g. `s${counter}` minted at add-time)
  title: string;         // user-facing row title
  kind: ShelfKind;
  tag?: string;          // kind === "tag"
  authorId?: number;     // kind === "creator"
  status?: PlayedStatus; // kind === "status"
}

export interface HomeShelvesConfig {
  shelves: HomeShelf[];
}

export const DEFAULT_HOME_SHELVES: HomeShelvesConfig = { shelves: [] };

/** Failsafe parse — mirrors parseBrowsePrefs. Drops malformed shelves; never throws. */
export function parseHomeShelves(raw: string | null): HomeShelvesConfig {
  if (!raw) return { shelves: [] };
  try {
    const o = JSON.parse(raw) as Partial<HomeShelvesConfig>;
    const shelves = Array.isArray(o.shelves) ? o.shelves : [];
    const clean = shelves.filter(
      (s): s is HomeShelf =>
        !!s && typeof s.id === "string" && typeof s.title === "string" &&
        (s.kind === "tag" || s.kind === "creator" || s.kind === "status"),
    );
    return { shelves: clean };
  } catch {
    return { shelves: [] };
  }
}

export function serializeHomeShelves(config: HomeShelvesConfig): string {
  return JSON.stringify(config);
}

/** Normalized shelf item — work shelves yield "work", status shelves yield "creator". */
export type ShelfItem =
  | { kind: "work"; workId: number; title: string; authorId: number; authorName: string; unplayedCount: number; tags: string[] }
  | { kind: "creator"; authorId: number; authorName: string; workCount: number; unplayedCount: number };

/** Fetch a shelf's items using EXISTING commands only (no new Rust). */
export async function loadShelfItems(shelf: HomeShelf): Promise<ShelfItem[]> {
  if (shelf.kind === "tag" && shelf.tag) {
    const works = await getDiscoveryByTags([shelf.tag]);
    return works.map((w) => ({
      kind: "work" as const, workId: w.workId, title: w.baseTitle, authorId: w.authorId,
      authorName: w.authorName, unplayedCount: w.unplayedCount, tags: w.sharedTags,
    }));
  }
  if (shelf.kind === "creator" && shelf.authorId != null) {
    const detail = await getAuthorDetail(shelf.authorId);
    return detail.works.map((w) => ({
      kind: "work" as const, workId: w.id, title: w.baseTitle, authorId: detail.id,
      authorName: detail.name, unplayedCount: w.chapters.filter((c) => !c.played).length,
      tags: w.tags,
    }));
  }
  if (shelf.kind === "status" && shelf.status) {
    const authors = await getAuthors();
    return filterAuthors(authors, { tag: null, status: shelf.status }).map((a) => ({
      kind: "creator" as const, authorId: a.id, authorName: a.name,
      workCount: a.workCount, unplayedCount: a.unplayedCount,
    }));
  }
  return [];
}
