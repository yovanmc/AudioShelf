/**
 * M34 scale test for AuthorDetailView — verifies the virtualized path engages when
 * total chapter count > VIRTUALIZE_THRESHOLD (40), and that collapse/expand still
 * works via the flattenAuthorDetail helper.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthorDetailView } from "./AuthorDetailView";
import type { AuthorDetail, ChapterRow, WorkRow } from "../lib/api";
import { VIRTUALIZE_THRESHOLD } from "../components/VirtualList";
import { flattenAuthorDetail } from "../lib/flattenRows";

const noop = () => {};

/** Build a ChapterRow with the required shape. */
function makeChapter(id: number, no: number): ChapterRow {
  return {
    id,
    title: `Chapter ${no}`,
    chapterNo: no,
    format: "mp3",
    durationSecs: 60,
    filePath: `x/ch${id}.mp3`,
    played: false,
    tags: [],
    labels: [],
    userSummary: "",
    takeaway: "",
    isFavorite: false,
    metadata: [],
    playbackPositionSecs: 0,
    hasJournal: false,
  };
}

/** Build an AuthorDetail with one work containing `chapterCount` chapters. */
function makeDetail(chapterCount: number): AuthorDetail {
  const chapters = Array.from({ length: chapterCount }, (_, i) =>
    makeChapter(100 + i, i + 1),
  );
  const work: WorkRow = {
    id: 1,
    baseTitle: "Scale Work",
    tags: [],
    labels: [],
    reEntryNote: "",
    completionRating: "",

    metadata: [],
    chapters,
  };
  return {
    id: 1,
    name: "Scale Author",
    tags: [],
    labels: [],
    metadata: [],
    works: [work],
  };
}

describe("AuthorDetailView scale (M34)", () => {
  it("virtualizes above threshold: only a window of chapter rows is in the DOM", () => {
    const chapterCount = VIRTUALIZE_THRESHOLD + 20; // 60 chapters — well above threshold
    render(
      <AuthorDetailView
        detail={makeDetail(chapterCount)}
        onTogglePlayed={noop}
        onPlayChapter={noop}
        onSetTags={noop}
        onSetGrouping={noop}
        onClearGrouping={noop}
        onSetWorkTags={noop}
        onSetChapterTags={noop}
        allTags={[]}
        onBack={noop}
        workSort="az"
        onWorkSortChange={vi.fn()}
      />,
    );
    // VirtualList only renders the windowed subset + overscan, not all chapters.
    const rows = screen.getAllByTestId("ad-chapter-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(chapterCount);
  });

  // --- flattenAuthorDetail collapse behaviour (pure helper test) ---

  it("flattenAuthorDetail: collapsed work omits its chapter rows", () => {
    const work1: WorkRow = {
      id: 1,
      baseTitle: "Work 1",
      tags: [],
      labels: [],
      reEntryNote: "",
      completionRating: "",
  
      metadata: [],
      chapters: [makeChapter(10, 1), makeChapter(11, 2)],
    };
    const work2: WorkRow = {
      id: 2,
      baseTitle: "Work 2",
      tags: [],
      labels: [],
      reEntryNote: "",
      completionRating: "",
  
      metadata: [],
      chapters: [makeChapter(20, 1), makeChapter(21, 2)],
    };

    // Collapse work2 only.
    const rows = flattenAuthorDetail([work1, work2], new Set([2]));

    // Expected order: work1, chapter 10, chapter 11, work2 (no chapters)
    expect(rows[0]).toMatchObject({ kind: "work", work: work1, collapsed: false });
    expect(rows[1]).toMatchObject({ kind: "chapter", chapter: work1.chapters[0] });
    expect(rows[2]).toMatchObject({ kind: "chapter", chapter: work1.chapters[1] });
    expect(rows[3]).toMatchObject({ kind: "work", work: work2, collapsed: true });
    expect(rows).toHaveLength(4); // no chapter rows for work2
  });

  it("flattenAuthorDetail: expanding a collapsed work adds its chapter rows", () => {
    const work: WorkRow = {
      id: 1,
      baseTitle: "Work",
      tags: [],
      labels: [],
      reEntryNote: "",
      completionRating: "",
  
      metadata: [],
      chapters: [makeChapter(10, 1), makeChapter(11, 2)],
    };

    const collapsedRows = flattenAuthorDetail([work], new Set([1]));
    expect(collapsedRows).toHaveLength(1); // only the work row

    const expandedRows = flattenAuthorDetail([work], new Set());
    expect(expandedRows).toHaveLength(3); // work + 2 chapters
    expect(expandedRows[0]).toMatchObject({ kind: "work", collapsed: false });
    expect(expandedRows[1]).toMatchObject({ kind: "chapter" });
    expect(expandedRows[2]).toMatchObject({ kind: "chapter" });
  });
});
