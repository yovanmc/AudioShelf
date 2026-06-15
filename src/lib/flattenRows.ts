import type { JournalEntry, WorkRow, ChapterRow } from "./api";

// ---------------------------------------------------------------------------
// Row height constants (used by VariableSizeList itemSize at call sites)
// ---------------------------------------------------------------------------

export const ROW_H = {
  journalAuthor: 44,
  journalWork: 32,
  journalEntry: 68, // entries are CSS line-clamped to a fixed height — see Task 3
  adWork: 56,
  adChapter: 44,
} as const;

// ---------------------------------------------------------------------------
// Journal flatten
// ---------------------------------------------------------------------------

/**
 * A flat row type for the virtualized Journal list.
 * Matches the author → work → entry grouping that JournalView builds from JournalResults.
 */
export type JournalRow =
  | { kind: "author"; key: string; label: string }
  | { kind: "work"; key: string; label: string }
  | { kind: "entry"; key: string; entry: JournalEntry };

/**
 * Flatten the author→work→entry grouped structure that JournalView computes into a
 * single flat array, preserving the original iteration order.
 *
 * @param grouped  The `Map<authorName, Map<workTitle, JournalEntry[]>>` that JournalView
 *                 already builds from the filtered entries.
 */
export function flattenJournal(
  grouped: Map<string, Map<string, JournalEntry[]>>,
): JournalRow[] {
  const rows: JournalRow[] = [];
  for (const [authorName, workMap] of grouped.entries()) {
    rows.push({ kind: "author", key: `author:${authorName}`, label: authorName });
    for (const [workTitle, entries] of workMap.entries()) {
      rows.push({ kind: "work", key: `work:${authorName}:${workTitle}`, label: workTitle });
      for (let i = 0; i < entries.length; i++) {
        rows.push({
          kind: "entry",
          key: `entry:${authorName}:${workTitle}:${i}`,
          entry: entries[i],
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// AuthorDetail flatten
// ---------------------------------------------------------------------------

/**
 * A flat row type for the virtualized AuthorDetail works+chapters list.
 */
export type AuthorDetailRow =
  | { kind: "work"; key: string; work: WorkRow; collapsed: boolean }
  | { kind: "chapter"; key: string; chapter: ChapterRow };

/**
 * Flatten the works array + per-work chapters into a single flat array.
 * For each work, emits a `work` row; then — only when `!collapsed.has(work.id)` —
 * emits its `chapter` rows in order.
 *
 * Collapse/expand is a pure recompute: changing `collapsed` produces a new flat array
 * and the VirtualList `useEffect` resets cached sizes automatically.
 *
 * @param works      The sorted works array from AuthorDetailView (already `sortWorks`-d).
 * @param collapsed  The set of work ids whose chapter lists are currently hidden.
 */
export function flattenAuthorDetail(
  works: WorkRow[],
  collapsed: Set<number>,
): AuthorDetailRow[] {
  const rows: AuthorDetailRow[] = [];
  for (const work of works) {
    const isCollapsed = collapsed.has(work.id);
    rows.push({ kind: "work", key: `work:${work.id}`, work, collapsed: isCollapsed });
    if (!isCollapsed) {
      for (const chapter of work.chapters) {
        rows.push({ kind: "chapter", key: `chapter:${chapter.id}`, chapter });
      }
    }
  }
  return rows;
}
