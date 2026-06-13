import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthorRow, AuthorDetail, DiscoveryWork } from "./api";
import {
  parseHomeShelves,
  serializeHomeShelves,
  loadShelfItems,
  DEFAULT_HOME_SHELVES,
  type HomeShelf,
  type HomeShelvesConfig,
} from "./shelves";

// ---------------------------------------------------------------------------
// Mock ./api — Shelf module is the only place that imports it.
// ---------------------------------------------------------------------------

vi.mock("./api", () => ({
  getAuthors: vi.fn(),
  getAuthorDetail: vi.fn(),
  getDiscoveryByTags: vi.fn(),
}));

// We import after vi.mock so the mocked module is used.
import { getAuthors, getAuthorDetail, getDiscoveryByTags } from "./api";

const mockGetAuthors = vi.mocked(getAuthors);
const mockGetAuthorDetail = vi.mocked(getAuthorDetail);
const mockGetDiscoveryByTags = vi.mocked(getDiscoveryByTags);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAuthor(overrides: Partial<AuthorRow> & { id: number; name: string }): AuthorRow {
  return {
    workCount: 2,
    chapterCount: 4,
    unplayedCount: 2,
    totalSecs: 3600,
    tags: [],
    ...overrides,
  };
}

function makeDiscoveryWork(overrides: Partial<DiscoveryWork> & { workId: number }): DiscoveryWork {
  return {
    baseTitle: "Test Work",
    authorId: 1,
    authorName: "Test Author",
    unplayedCount: 2,
    sharedTags: ["cozy"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseHomeShelves
// ---------------------------------------------------------------------------

describe("parseHomeShelves", () => {
  it("null → { shelves: [] }", () => {
    expect(parseHomeShelves(null)).toEqual({ shelves: [] });
  });

  it("empty string → { shelves: [] }", () => {
    expect(parseHomeShelves("")).toEqual({ shelves: [] });
  });

  it("malformed JSON → { shelves: [] }", () => {
    expect(parseHomeShelves("not json")).toEqual({ shelves: [] });
  });

  it("valid shelf passes filter", () => {
    const shelf: HomeShelf = { id: "s1", title: "Cozy Reads", kind: "tag", tag: "cozy" };
    const config: HomeShelvesConfig = { shelves: [shelf] };
    expect(parseHomeShelves(JSON.stringify(config))).toEqual(config);
  });

  it("keeps only valid shelves and drops malformed ones", () => {
    const valid: HomeShelf = { id: "s1", title: "Valid", kind: "tag", tag: "cozy" };
    // malformed: missing kind / bad kind
    const malformed1 = { id: "s2", title: "Bad" }; // no kind
    const malformed2 = { id: "s3", title: "Bad2", kind: "unknown" }; // invalid kind
    const malformed3 = null; // null
    const raw = JSON.stringify({ shelves: [valid, malformed1, malformed2, malformed3] });
    expect(parseHomeShelves(raw)).toEqual({ shelves: [valid] });
  });

  it("shelves array absent → { shelves: [] }", () => {
    expect(parseHomeShelves(JSON.stringify({ other: "value" }))).toEqual({ shelves: [] });
  });

  it("shelves: [] → { shelves: [] }", () => {
    expect(parseHomeShelves(JSON.stringify({ shelves: [] }))).toEqual({ shelves: [] });
  });

  it("supports all three shelf kinds", () => {
    const tag: HomeShelf = { id: "s1", title: "Tag shelf", kind: "tag", tag: "fantasy" };
    const creator: HomeShelf = { id: "s2", title: "Creator shelf", kind: "creator", authorId: 42 };
    const status: HomeShelf = { id: "s3", title: "Status shelf", kind: "status", status: "unplayed" };
    const config: HomeShelvesConfig = { shelves: [tag, creator, status] };
    expect(parseHomeShelves(JSON.stringify(config))).toEqual(config);
  });
});

// ---------------------------------------------------------------------------
// serializeHomeShelves + round-trip
// ---------------------------------------------------------------------------

describe("serializeHomeShelves", () => {
  it("serializes to JSON string", () => {
    const config: HomeShelvesConfig = { shelves: [{ id: "s1", title: "Test", kind: "status", status: "done" }] };
    const serialized = serializeHomeShelves(config);
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(serialized)).toEqual(config);
  });

  it("round-trip: serialize then parse returns equal config", () => {
    const original: HomeShelvesConfig = {
      shelves: [
        { id: "s1", title: "Cozy", kind: "tag", tag: "cozy" },
        { id: "s2", title: "Author 7", kind: "creator", authorId: 7 },
        { id: "s3", title: "Unstarted", kind: "status", status: "unstarted" },
      ],
    };
    expect(parseHomeShelves(serializeHomeShelves(original))).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_HOME_SHELVES
// ---------------------------------------------------------------------------

describe("DEFAULT_HOME_SHELVES", () => {
  it("has empty shelves array", () => {
    expect(DEFAULT_HOME_SHELVES).toEqual({ shelves: [] });
  });
});

// ---------------------------------------------------------------------------
// loadShelfItems — tag kind
// ---------------------------------------------------------------------------

describe("loadShelfItems — tag", () => {
  it("calls getDiscoveryByTags with the tag and maps to kind:work items", async () => {
    const discovery: DiscoveryWork[] = [
      makeDiscoveryWork({ workId: 10, baseTitle: "Cozy Mystery", authorId: 5, authorName: "Alice", unplayedCount: 3, sharedTags: ["cozy", "mystery"] }),
      makeDiscoveryWork({ workId: 11, baseTitle: "Cozy Nights", authorId: 6, authorName: "Bob", unplayedCount: 0, sharedTags: ["cozy"] }),
    ];
    mockGetDiscoveryByTags.mockResolvedValue(discovery);

    const shelf: HomeShelf = { id: "s1", title: "Cozy", kind: "tag", tag: "cozy" };
    const items = await loadShelfItems(shelf);

    expect(mockGetDiscoveryByTags).toHaveBeenCalledWith(["cozy"]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      kind: "work", workId: 10, title: "Cozy Mystery", authorId: 5,
      authorName: "Alice", unplayedCount: 3, tags: ["cozy", "mystery"],
    });
    expect(items[1]).toEqual({
      kind: "work", workId: 11, title: "Cozy Nights", authorId: 6,
      authorName: "Bob", unplayedCount: 0, tags: ["cozy"],
    });
  });

  it("returns [] for tag shelf with no tag set", async () => {
    const shelf: HomeShelf = { id: "s1", title: "Missing Tag", kind: "tag" };
    const items = await loadShelfItems(shelf);
    expect(items).toEqual([]);
    expect(mockGetDiscoveryByTags).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loadShelfItems — creator kind
// ---------------------------------------------------------------------------

describe("loadShelfItems — creator", () => {
  it("calls getAuthorDetail and computes unplayedCount from chapters", async () => {
    const detail: AuthorDetail = {
      id: 7,
      name: "Jane Author",
      tags: ["fiction"],
      metadata: [],
      works: [
        {
          id: 101,
          baseTitle: "First Work",
          tags: ["fiction"],
          reEntryNote: "",
          completionRating: "",
          chapterSort: "",
          metadata: [],
          chapters: [
            { id: 1, title: "Ch 1", chapterNo: 1, format: "mp3", durationSecs: 300, filePath: "a.mp3", played: true, tags: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [] },
            { id: 2, title: "Ch 2", chapterNo: 2, format: "mp3", durationSecs: 400, filePath: "b.mp3", played: false, tags: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [] },
          ],
        },
        {
          id: 102,
          baseTitle: "Second Work",
          tags: [],
          reEntryNote: "",
          completionRating: "",
          chapterSort: "",
          metadata: [],
          chapters: [
            { id: 3, title: "Ch 1", chapterNo: 1, format: "mp3", durationSecs: 600, filePath: "c.mp3", played: false, tags: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [] },
          ],
        },
      ],
    };
    mockGetAuthorDetail.mockResolvedValue(detail);

    const shelf: HomeShelf = { id: "s2", title: "Jane", kind: "creator", authorId: 7 };
    const items = await loadShelfItems(shelf);

    expect(mockGetAuthorDetail).toHaveBeenCalledWith(7);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      kind: "work", workId: 101, title: "First Work", authorId: 7,
      authorName: "Jane Author", unplayedCount: 1, tags: ["fiction"],
    });
    expect(items[1]).toEqual({
      kind: "work", workId: 102, title: "Second Work", authorId: 7,
      authorName: "Jane Author", unplayedCount: 1, tags: [],
    });
  });

  it("returns [] for creator shelf with no authorId set", async () => {
    const shelf: HomeShelf = { id: "s2", title: "Missing Author", kind: "creator" };
    const items = await loadShelfItems(shelf);
    expect(items).toEqual([]);
    expect(mockGetAuthorDetail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loadShelfItems — status kind
// ---------------------------------------------------------------------------

describe("loadShelfItems — status", () => {
  const allAuthors: AuthorRow[] = [
    makeAuthor({ id: 1, name: "All Played",    chapterCount: 3, unplayedCount: 0, workCount: 1, totalSecs: 1000 }), // done
    makeAuthor({ id: 2, name: "Unstarted One", chapterCount: 3, unplayedCount: 3, workCount: 2, totalSecs: 2000 }), // unstarted
    makeAuthor({ id: 3, name: "In Progress",   chapterCount: 4, unplayedCount: 2, workCount: 1, totalSecs: 1500 }), // unplayed (partial)
    makeAuthor({ id: 4, name: "Empty",         chapterCount: 0, unplayedCount: 0, workCount: 0, totalSecs: 0 }),    // no chapters
  ];

  it("unstarted: keeps only authors with chapters where none are played", async () => {
    mockGetAuthors.mockResolvedValue(allAuthors);
    const shelf: HomeShelf = { id: "s3", title: "Haven't Started", kind: "status", status: "unstarted" };
    const items = await loadShelfItems(shelf);

    expect(mockGetAuthors).toHaveBeenCalled();
    // only id=2 is unstarted (chapterCount=3, unplayedCount=3, played=0)
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      kind: "creator", authorId: 2, authorName: "Unstarted One", workCount: 2, unplayedCount: 3,
    });
  });

  it("done: keeps only authors where all chapters are played", async () => {
    mockGetAuthors.mockResolvedValue(allAuthors);
    const shelf: HomeShelf = { id: "s3", title: "Fully Played", kind: "status", status: "done" };
    const items = await loadShelfItems(shelf);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "creator", authorId: 1, authorName: "All Played" });
  });

  it("unplayed: keeps authors with at least one unplayed chapter", async () => {
    mockGetAuthors.mockResolvedValue(allAuthors);
    const shelf: HomeShelf = { id: "s3", title: "Has Unplayed", kind: "status", status: "unplayed" };
    const items = await loadShelfItems(shelf);

    // id=2 (unstarted) and id=3 (in progress) both have unplayed chapters
    expect(items).toHaveLength(2);
    expect(items.map((i) => (i as { authorId: number }).authorId)).toContain(2);
    expect(items.map((i) => (i as { authorId: number }).authorId)).toContain(3);
  });

  it("maps to kind:creator items with correct fields", async () => {
    mockGetAuthors.mockResolvedValue([allAuthors[0]]); // "All Played" only
    const shelf: HomeShelf = { id: "s3", title: "Done", kind: "status", status: "done" };
    const items = await loadShelfItems(shelf);

    expect(items[0]).toEqual({
      kind: "creator", authorId: 1, authorName: "All Played", workCount: 1, unplayedCount: 0,
    });
  });

  it("returns [] for status shelf with no status set", async () => {
    const shelf: HomeShelf = { id: "s3", title: "Missing Status", kind: "status" };
    const items = await loadShelfItems(shelf);
    expect(items).toEqual([]);
    expect(mockGetAuthors).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loadShelfItems — incomplete / edge cases
// ---------------------------------------------------------------------------

describe("loadShelfItems — edge cases", () => {
  it("returns [] for an unknown/incomplete shelf config", async () => {
    // kind="tag" with no tag — already tested above; confirm default fallthrough
    const shelf = { id: "s99", title: "Broken", kind: "creator" as const };
    const items = await loadShelfItems(shelf);
    expect(items).toEqual([]);
  });
});
