import { describe, it, expect } from "vitest";
import { flattenAuthorDetail, flattenJournal } from "./flattenRows";
import type { WorkRow, ChapterRow, JournalEntry } from "./api";

// ---------------------------------------------------------------------------
// Helpers to build minimal fixtures
// ---------------------------------------------------------------------------

function makeChapter(id: number, title: string): ChapterRow {
  return {
    id,
    title,
    chapterNo: id,
    format: "mp3",
    durationSecs: 60,
    filePath: `/audio/${id}.mp3`,
    played: false,
    tags: [],
    userSummary: "",
    takeaway: "",
    isFavorite: false,
    metadata: [],
    playbackPositionSecs: 0,
    labels: [],
    hasJournal: false,
  };
}

function makeWork(id: number, title: string, chapters: ChapterRow[]): WorkRow {
  return {
    id,
    baseTitle: title,
    tags: [],
    chapters,
    reEntryNote: "",
    completionRating: "",
    chapterSort: "",
    metadata: [],
    labels: [],
  };
}

function makeEntry(authorName: string, workTitle: string, body: string): JournalEntry {
  return {
    kind: "note",
    authorId: 1,
    authorName,
    workId: 1,
    workTitle,
    chapterId: null,
    chapterTitle: null,
    positionSecs: null,
    body,
    createdAt: null,
  };
}

// ---------------------------------------------------------------------------
// flattenAuthorDetail tests
// ---------------------------------------------------------------------------

describe("flattenAuthorDetail", () => {
  it("emits work rows and chapter rows for expanded works, omits chapters for collapsed works", () => {
    const chaptersWork1 = [makeChapter(10, "Ch A"), makeChapter(11, "Ch B")];
    const chaptersWork2 = [makeChapter(20, "Ch C"), makeChapter(21, "Ch D")];
    const work1 = makeWork(1, "Work One", chaptersWork1);
    const work2 = makeWork(2, "Work Two", chaptersWork2);

    // work 2 is collapsed; work 1 is expanded
    const rows = flattenAuthorDetail([work1, work2], new Set([2]));

    // Expected: [work#1, chapter#10, chapter#11, work#2]   (work#2 chapters omitted)
    expect(rows).toHaveLength(4);

    expect(rows[0]).toMatchObject({ kind: "work", work: work1, collapsed: false });
    expect(rows[1]).toMatchObject({ kind: "chapter", chapter: chaptersWork1[0] });
    expect(rows[2]).toMatchObject({ kind: "chapter", chapter: chaptersWork1[1] });
    expect(rows[3]).toMatchObject({ kind: "work", work: work2, collapsed: true });
  });

  it("omits all chapter rows when both works are collapsed", () => {
    const work1 = makeWork(1, "Work One", [makeChapter(10, "Ch A")]);
    const work2 = makeWork(2, "Work Two", [makeChapter(20, "Ch C")]);
    const rows = flattenAuthorDetail([work1, work2], new Set([1, 2]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "work", collapsed: true });
    expect(rows[1]).toMatchObject({ kind: "work", collapsed: true });
  });

  it("emits all chapter rows when collapsed set is empty", () => {
    const work1 = makeWork(1, "Work One", [makeChapter(10, "Ch A"), makeChapter(11, "Ch B")]);
    const rows = flattenAuthorDetail([work1], new Set());
    expect(rows).toHaveLength(3); // 1 work + 2 chapters
    expect(rows[0].kind).toBe("work");
    expect(rows[1].kind).toBe("chapter");
    expect(rows[2].kind).toBe("chapter");
  });

  it("handles empty works array", () => {
    const rows = flattenAuthorDetail([], new Set());
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// flattenJournal tests
// ---------------------------------------------------------------------------

describe("flattenJournal", () => {
  it("produces author / work / entry rows in order, every entry exactly once", () => {
    const entry1 = makeEntry("Alice", "Book One", "Great chapter");
    const entry2 = makeEntry("Alice", "Book One", "Another note");
    const entry3 = makeEntry("Alice", "Book Two", "Short read");
    const entry4 = makeEntry("Bob", "Single Work", "Bob's note");

    const grouped: Map<string, Map<string, JournalEntry[]>> = new Map([
      [
        "Alice",
        new Map([
          ["Book One", [entry1, entry2]],
          ["Book Two", [entry3]],
        ]),
      ],
      [
        "Bob",
        new Map([["Single Work", [entry4]]]),
      ],
    ]);

    const rows = flattenJournal(grouped);

    // Expected structure:
    // author:Alice, work:Book One, entry1, entry2, work:Book Two, entry3, author:Bob, work:Single Work, entry4
    expect(rows).toHaveLength(9);

    expect(rows[0]).toMatchObject({ kind: "author", label: "Alice" });
    expect(rows[1]).toMatchObject({ kind: "work", label: "Book One" });
    expect(rows[2]).toMatchObject({ kind: "entry", entry: entry1 });
    expect(rows[3]).toMatchObject({ kind: "entry", entry: entry2 });
    expect(rows[4]).toMatchObject({ kind: "work", label: "Book Two" });
    expect(rows[5]).toMatchObject({ kind: "entry", entry: entry3 });
    expect(rows[6]).toMatchObject({ kind: "author", label: "Bob" });
    expect(rows[7]).toMatchObject({ kind: "work", label: "Single Work" });
    expect(rows[8]).toMatchObject({ kind: "entry", entry: entry4 });

    // Every entry row contains the original entry object
    const entryRows = rows.filter((r) => r.kind === "entry");
    expect(entryRows).toHaveLength(4);
  });

  it("returns an empty array for an empty grouped map", () => {
    const rows = flattenJournal(new Map());
    expect(rows).toHaveLength(0);
  });

  it("gives each row a unique key", () => {
    const entry1 = makeEntry("Alice", "Book One", "Note A");
    const entry2 = makeEntry("Alice", "Book One", "Note B");
    const grouped = new Map([["Alice", new Map([["Book One", [entry1, entry2]]])]]);
    const rows = flattenJournal(grouped);
    const keys = rows.map((r) => r.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
