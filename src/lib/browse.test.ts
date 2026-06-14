import { describe, it, expect } from "vitest";
import type { AuthorRow, WorkRow } from "./api";
import {
  sortAuthors,
  filterAuthors,
  authorPlayedFraction,
  workPlayedFraction,
  sortWorks,
  parseBrowsePrefs,
  DEFAULT_BROWSE_PREFS,
} from "./browse";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAuthor(
  overrides: Partial<AuthorRow> & { id: number; name: string },
): AuthorRow {
  return {
    workCount: 1,
    chapterCount: 4,
    unplayedCount: 2,
    totalSecs: 100,
    tags: [],
    ...overrides,
  };
}

function makeWork(
  baseTitle: string,
  chapters: { durationSecs: number; played: boolean }[],
): WorkRow {
  return {
    id: Math.random(),
    baseTitle,
    tags: [],
    labels: [],
    reEntryNote: "",
    completionRating: "",
    chapterSort: "",
    metadata: [],
    chapters: chapters.map((c, i) => ({
      id: i + 1,
      title: `${baseTitle} ch${i + 1}`,
      chapterNo: i + 1,
      format: "mp3",
      filePath: `x/${baseTitle}_ch${i + 1}.mp3`,
      tags: [],
      labels: [],
      userSummary: "",
      takeaway: "",
      isFavorite: false,
      metadata: [],
      playbackPositionSecs: 0,
      hasJournal: false,
      ...c,
    })),
  };
}

// ---------------------------------------------------------------------------
// authorPlayedFraction
// ---------------------------------------------------------------------------

describe("authorPlayedFraction", () => {
  it("returns 0 when there are no chapters", () => {
    const a = makeAuthor({ id: 1, name: "A", chapterCount: 0, unplayedCount: 0 });
    expect(authorPlayedFraction(a)).toBe(0);
  });

  it("returns 0 when none are played", () => {
    const a = makeAuthor({ id: 1, name: "A", chapterCount: 4, unplayedCount: 4 });
    expect(authorPlayedFraction(a)).toBe(0);
  });

  it("returns 1 when all are played", () => {
    const a = makeAuthor({ id: 1, name: "A", chapterCount: 4, unplayedCount: 0 });
    expect(authorPlayedFraction(a)).toBe(1);
  });

  it("returns partial fraction", () => {
    const a = makeAuthor({ id: 1, name: "A", chapterCount: 4, unplayedCount: 1 });
    expect(authorPlayedFraction(a)).toBeCloseTo(0.75);
  });
});

// ---------------------------------------------------------------------------
// workPlayedFraction
// ---------------------------------------------------------------------------

describe("workPlayedFraction", () => {
  it("returns 0 for empty chapters", () => {
    const w = makeWork("W", []);
    expect(workPlayedFraction(w)).toBe(0);
  });

  it("returns 0 when none played", () => {
    const w = makeWork("W", [
      { durationSecs: 60, played: false },
      { durationSecs: 90, played: false },
    ]);
    expect(workPlayedFraction(w)).toBe(0);
  });

  it("returns 1 when all played", () => {
    const w = makeWork("W", [
      { durationSecs: 60, played: true },
      { durationSecs: 90, played: true },
    ]);
    expect(workPlayedFraction(w)).toBe(1);
  });

  it("returns partial fraction", () => {
    const w = makeWork("W", [
      { durationSecs: 60, played: true },
      { durationSecs: 90, played: false },
      { durationSecs: 30, played: false },
      { durationSecs: 30, played: false },
    ]);
    expect(workPlayedFraction(w)).toBeCloseTo(0.25);
  });
});

// ---------------------------------------------------------------------------
// sortAuthors
// ---------------------------------------------------------------------------

describe("sortAuthors", () => {
  const alice = makeAuthor({ id: 1, name: "Alice", totalSecs: 300, chapterCount: 4, unplayedCount: 0 });
  const bob   = makeAuthor({ id: 2, name: "Bob",   totalSecs: 500, chapterCount: 4, unplayedCount: 4 });
  const carol = makeAuthor({ id: 3, name: "Carol", totalSecs: 100, chapterCount: 4, unplayedCount: 1 });
  // tie-break pair: same totalSecs, different names
  const dave  = makeAuthor({ id: 4, name: "Dave",  totalSecs: 500, chapterCount: 4, unplayedCount: 2 });

  it("az: sorts A→Z", () => {
    const result = sortAuthors([carol, bob, alice], "az");
    expect(result.map((a) => a.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("az: numeric-aware (Author 2 before Author 10)", () => {
    const a2  = makeAuthor({ id: 10, name: "Author 2" });
    const a10 = makeAuthor({ id: 11, name: "Author 10" });
    const result = sortAuthors([a10, a2], "az");
    expect(result.map((a) => a.name)).toEqual(["Author 2", "Author 10"]);
  });

  it("length: sorts descending by totalSecs, tiebreak by name asc", () => {
    // bob and dave both have totalSecs=500; dave < bob alphabetically
    const result = sortAuthors([alice, carol, dave, bob], "length");
    expect(result.map((a) => a.name)).toEqual(["Bob", "Dave", "Alice", "Carol"]);
  });

  it("played: sorts descending by played fraction, tiebreak by name asc", () => {
    // alice fraction=1, carol fraction=0.75, dave fraction=0.5, bob fraction=0
    const result = sortAuthors([bob, dave, carol, alice], "played");
    expect(result.map((a) => a.name)).toEqual(["Alice", "Carol", "Dave", "Bob"]);
  });

  it("does not mutate the original array", () => {
    const original = [carol, bob, alice];
    sortAuthors(original, "az");
    expect(original.map((a) => a.name)).toEqual(["Carol", "Bob", "Alice"]);
  });
});

// ---------------------------------------------------------------------------
// filterAuthors
// ---------------------------------------------------------------------------

describe("filterAuthors", () => {
  const fiction = makeAuthor({ id: 1, name: "A", tags: ["fiction"], chapterCount: 3, unplayedCount: 3 });
  const scifi   = makeAuthor({ id: 2, name: "B", tags: ["scifi"],   chapterCount: 3, unplayedCount: 0 });
  const both    = makeAuthor({ id: 3, name: "C", tags: ["fiction", "scifi"], chapterCount: 3, unplayedCount: 1 });
  const noTag   = makeAuthor({ id: 4, name: "D", tags: [],           chapterCount: 0, unplayedCount: 0 });

  it("tag=null returns all", () => {
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: null, status: "all" });
    expect(result).toHaveLength(4);
  });

  it("tag filter narrows to authors whose tags include the tag", () => {
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: "fiction", status: "all" });
    expect(result.map((a) => a.id)).toEqual([1, 3]);
  });

  it("status=unplayed keeps authors with at least one unplayed chapter", () => {
    // fiction: unplayedCount=3, both: unplayedCount=1, scifi and noTag have 0 unplayed
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: null, status: "unplayed" });
    expect(result.map((a) => a.id)).toEqual([1, 3]);
  });

  it("status=done keeps authors where all chapters are played", () => {
    // scifi: chapterCount=3, unplayedCount=0 → done
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: null, status: "done" });
    expect(result.map((a) => a.id)).toEqual([2]);
  });

  it("status=unstarted keeps authors where no chapters are played", () => {
    // fiction: chapterCount=3, unplayedCount=3, played=0 → unstarted
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: null, status: "unstarted" });
    expect(result.map((a) => a.id)).toEqual([1]);
  });

  it("status=all returns all (regardless of chapterCount)", () => {
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: null, status: "all" });
    expect(result).toHaveLength(4);
  });

  it("tag + status compose (AND): fiction AND unplayed", () => {
    // fiction (id=1): tag=fiction, unplayed=3 ✓
    // both (id=3): tag=fiction, unplayed=1 ✓
    // scifi (id=2): no 'fiction' tag ✗
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: "fiction", status: "unplayed" });
    expect(result.map((a) => a.id)).toEqual([1, 3]);
  });

  it("tag + status compose (AND): scifi AND done", () => {
    // scifi (id=2): tag=scifi, unplayed=0, chapters=3 → done ✓
    // both (id=3): tag=scifi, unplayed=1 → NOT done ✗
    const result = filterAuthors([fiction, scifi, both, noTag], { tag: "scifi", status: "done" });
    expect(result.map((a) => a.id)).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// sortWorks
// ---------------------------------------------------------------------------

describe("sortWorks", () => {
  const alpha = makeWork("Alpha", [
    { durationSecs: 60, played: true },
    { durationSecs: 60, played: true },
  ]); // total=120, fraction=1.0

  const beta = makeWork("Beta", [
    { durationSecs: 300, played: false },
    { durationSecs: 300, played: false },
  ]); // total=600, fraction=0.0

  const gamma = makeWork("Gamma", [
    { durationSecs: 100, played: true },
    { durationSecs: 100, played: false },
  ]); // total=200, fraction=0.5

  it("az: sorts A→Z", () => {
    const result = sortWorks([gamma, beta, alpha], "az");
    expect(result.map((w) => w.baseTitle)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("length: sorts descending by total duration, tiebreak by title asc", () => {
    const result = sortWorks([alpha, gamma, beta], "length");
    // beta=600, gamma=200, alpha=120
    expect(result.map((w) => w.baseTitle)).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("played: sorts descending by played fraction, tiebreak by title asc", () => {
    const result = sortWorks([beta, alpha, gamma], "played");
    // alpha=1.0, gamma=0.5, beta=0.0
    expect(result.map((w) => w.baseTitle)).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("length: tiebreak by title when totalSecs are equal", () => {
    const w1 = makeWork("Zara", [{ durationSecs: 200, played: false }]);
    const w2 = makeWork("Anna", [{ durationSecs: 200, played: false }]);
    const result = sortWorks([w1, w2], "length");
    expect(result.map((w) => w.baseTitle)).toEqual(["Anna", "Zara"]);
  });

  it("does not mutate the original array", () => {
    const original = [gamma, beta, alpha];
    sortWorks(original, "az");
    expect(original.map((w) => w.baseTitle)).toEqual(["Gamma", "Beta", "Alpha"]);
  });
});

// ---------------------------------------------------------------------------
// parseBrowsePrefs
// ---------------------------------------------------------------------------

describe("parseBrowsePrefs", () => {
  it("null → defaults", () => {
    expect(parseBrowsePrefs(null)).toEqual(DEFAULT_BROWSE_PREFS);
  });

  it("empty string → defaults", () => {
    expect(parseBrowsePrefs("")).toEqual(DEFAULT_BROWSE_PREFS);
  });

  it("malformed JSON → defaults", () => {
    expect(parseBrowsePrefs("{not json}")).toEqual(DEFAULT_BROWSE_PREFS);
  });

  it("valid full JSON → parsed values", () => {
    const prefs = {
      authorSort: "length",
      filterTag: "scifi",
      filterStatus: "unplayed",
      workSort: "played",
    };
    expect(parseBrowsePrefs(JSON.stringify(prefs))).toEqual(prefs);
  });

  it("partial object → fills missing fields with defaults", () => {
    const partial = { authorSort: "played" };
    const result = parseBrowsePrefs(JSON.stringify(partial));
    expect(result).toEqual({
      authorSort: "played",
      filterTag: null,
      filterStatus: "all",
      workSort: "az",
    });
  });

  it("returns a new object (not the DEFAULT_BROWSE_PREFS reference)", () => {
    const result = parseBrowsePrefs(null);
    expect(result).not.toBe(DEFAULT_BROWSE_PREFS);
  });
});
