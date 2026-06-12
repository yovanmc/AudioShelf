import type { AuthorRow, WorkRow } from "./api";

export type AuthorSort = "az" | "length" | "played";
export type WorkSort = "az" | "length" | "played";
export type PlayedStatus = "all" | "unplayed" | "done" | "unstarted";

export interface AuthorFilter {
  tag: string | null; // null = no tag filter
  status: PlayedStatus; // "all" = no status filter
}

export interface BrowsePrefs {
  authorSort: AuthorSort;
  filterTag: string | null;
  filterStatus: PlayedStatus;
  workSort: WorkSort;
}

export const DEFAULT_BROWSE_PREFS: BrowsePrefs = {
  authorSort: "az",
  filterTag: null,
  filterStatus: "all",
  workSort: "az",
};

// Defensive: any malformed/absent stored value falls back to defaults (fail safe).
export function parseBrowsePrefs(raw: string | null): BrowsePrefs {
  if (!raw) return { ...DEFAULT_BROWSE_PREFS };
  try {
    const o = JSON.parse(raw) as Partial<BrowsePrefs>;
    return {
      authorSort: o.authorSort ?? "az",
      filterTag: o.filterTag ?? null,
      filterStatus: o.filterStatus ?? "all",
      workSort: o.workSort ?? "az",
    };
  } catch {
    return { ...DEFAULT_BROWSE_PREFS };
  }
}

// played fraction in [0,1]; 0 when there are no chapters.
export function authorPlayedFraction(a: AuthorRow): number {
  if (a.chapterCount <= 0) return 0;
  return (a.chapterCount - a.unplayedCount) / a.chapterCount;
}

export function workTotalSecs(w: WorkRow): number {
  return w.chapters.reduce((s, c) => s + c.durationSecs, 0);
}

export function workPlayedFraction(w: WorkRow): number {
  const total = w.chapters.length;
  if (total === 0) return 0;
  return w.chapters.filter((c) => c.played).length / total;
}

// Case-insensitive, numeric-aware name compare for stable display ordering.
function nameCmp(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortAuthors(authors: AuthorRow[], key: AuthorSort): AuthorRow[] {
  const copy = authors.slice();
  switch (key) {
    case "length":
      copy.sort((a, b) => b.totalSecs - a.totalSecs || nameCmp(a.name, b.name));
      break;
    case "played":
      copy.sort(
        (a, b) => authorPlayedFraction(b) - authorPlayedFraction(a) || nameCmp(a.name, b.name),
      );
      break;
    case "az":
    default:
      copy.sort((a, b) => nameCmp(a.name, b.name));
      break;
  }
  return copy;
}

export function authorMatchesStatus(a: AuthorRow, status: PlayedStatus): boolean {
  const played = a.chapterCount - a.unplayedCount;
  switch (status) {
    case "unplayed":
      return a.unplayedCount > 0;
    case "done":
      return a.chapterCount > 0 && a.unplayedCount === 0;
    case "unstarted":
      return a.chapterCount > 0 && played === 0;
    case "all":
    default:
      return true;
  }
}

export function filterAuthors(authors: AuthorRow[], filter: AuthorFilter): AuthorRow[] {
  return authors.filter((a) => {
    if (filter.tag && !a.tags.includes(filter.tag)) return false;
    if (!authorMatchesStatus(a, filter.status)) return false;
    return true;
  });
}

export function sortWorks(works: WorkRow[], key: WorkSort): WorkRow[] {
  const copy = works.slice();
  switch (key) {
    case "length":
      copy.sort((a, b) => workTotalSecs(b) - workTotalSecs(a) || nameCmp(a.baseTitle, b.baseTitle));
      break;
    case "played":
      copy.sort(
        (a, b) => workPlayedFraction(b) - workPlayedFraction(a) || nameCmp(a.baseTitle, b.baseTitle),
      );
      break;
    case "az":
    default:
      copy.sort((a, b) => nameCmp(a.baseTitle, b.baseTitle));
      break;
  }
  return copy;
}
