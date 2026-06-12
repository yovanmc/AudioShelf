import type { AuthorRow } from "./api";
import { formatDuration } from "./time";

export function matchesSearch(author: AuthorRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return author.name.toLowerCase().includes(q);
}

export function summarizeAuthor(a: AuthorRow): string {
  const played = a.chapterCount - a.unplayedCount;
  const pct = a.chapterCount > 0 ? Math.round((played / a.chapterCount) * 100) : 0;
  return `${a.workCount} works · ${a.chapterCount} chapters · ${a.unplayedCount} unplayed · ${pct}% played · ${formatDuration(a.totalSecs)}`;
}
