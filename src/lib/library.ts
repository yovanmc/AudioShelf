import type { AuthorRow } from "./api";

export function matchesSearch(author: AuthorRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return author.name.toLowerCase().includes(q);
}

export function summarizeAuthor(a: AuthorRow): string {
  return `${a.workCount} works · ${a.chapterCount} chapters · ${a.unplayedCount} unplayed`;
}
