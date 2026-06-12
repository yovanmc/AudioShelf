import { describe, it, expect } from "vitest";
import { matchesSearch, summarizeAuthor } from "./library";
import type { AuthorRow } from "./api";

const author: AuthorRow = {
  id: 1, name: "Jane Doe", workCount: 3, chapterCount: 7, unplayedCount: 2,
  totalSecs: 0, tags: [],
};

describe("matchesSearch", () => {
  it("is case-insensitive and matches substrings", () => {
    expect(matchesSearch(author, "jane")).toBe(true);
    expect(matchesSearch(author, "DOE")).toBe(true);
    expect(matchesSearch(author, "smith")).toBe(false);
  });
  it("matches everything on empty query", () => {
    expect(matchesSearch(author, "")).toBe(true);
  });
});

describe("summarizeAuthor", () => {
  it("summarizes works/chapters and unplayed", () => {
    expect(summarizeAuthor(author)).toBe("3 works · 7 chapters · 2 unplayed · 71% played · 0:00");
  });
});
