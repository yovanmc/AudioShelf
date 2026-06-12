import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryView } from "./LibraryView";
import type { AuthorRow, SearchResults } from "../lib/api";

const authors: AuthorRow[] = [
  { id: 1, name: "Alice", workCount: 1, chapterCount: 2, unplayedCount: 1, totalSecs: 0, tags: [] },
  { id: 2, name: "Bob", workCount: 2, chapterCount: 4, unplayedCount: 0, totalSecs: 0, tags: [] },
];

const emptyResults: SearchResults = { authors: [], works: [], chapters: [] };

function baseProps(over: Partial<React.ComponentProps<typeof LibraryView>> = {}) {
  return {
    authors,
    query: "",
    results: null as SearchResults | null,
    sort: "az" as const,
    onSortChange: vi.fn(),
    filterTag: null,
    onFilterTagChange: vi.fn(),
    filterStatus: "all" as const,
    onFilterStatusChange: vi.fn(),
    allTags: [],
    onQueryChange: vi.fn(),
    onOpenAuthor: vi.fn(),
    onOpenHome: vi.fn(),
    onOpenDiscovery: vi.fn(),
    onOpenRename: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
}

describe("LibraryView", () => {
  it("renders the (virtualized) author list with cover initials when query is empty", () => {
    render(<LibraryView {...baseProps()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // Cover swatch initials are present.
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("BO")).toBeInTheDocument();
  });

  it("opens an author when a list row is clicked", async () => {
    const onOpenAuthor = vi.fn();
    render(<LibraryView {...baseProps({ onOpenAuthor })} />);
    await userEvent.click(screen.getByText("Bob"));
    expect(onOpenAuthor).toHaveBeenCalledWith(2);
  });

  it("forwards typing to onQueryChange", async () => {
    const onQueryChange = vi.fn();
    render(<LibraryView {...baseProps({ onQueryChange })} />);
    await userEvent.type(screen.getByPlaceholderText("Search authors, works, chapters"), "x");
    expect(onQueryChange).toHaveBeenCalled();
  });

  it("virtualizes: a huge author list renders only a small DOM window", () => {
    const many: AuthorRow[] = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      name: `Author ${i + 1}`,
      workCount: 1,
      chapterCount: 1,
      unplayedCount: 0,
      totalSecs: 0,
      tags: [],
    }));
    render(<LibraryView {...baseProps({ authors: many })} />);
    // 3 toolbar buttons + at most a windowful of author rows — never 1000.
    expect(screen.getAllByRole("button").length).toBeLessThan(40);
  });

  it("shows grouped search results (authors/works/chapters) when searching", () => {
    const results: SearchResults = {
      authors: [{ authorId: 1, authorName: "Alice" }],
      works: [{ workId: 9, baseTitle: "Cool Story", authorId: 1, authorName: "Alice" }],
      chapters: [
        { chapterId: 7, title: "Cool Story 2", workId: 9, baseTitle: "Cool Story", authorId: 1, authorName: "Alice" },
      ],
    };
    render(<LibraryView {...baseProps({ query: "cool", results })} />);
    expect(screen.getByText("Authors")).toBeInTheDocument();
    expect(screen.getByText("Works")).toBeInTheDocument();
    expect(screen.getByText("Chapters")).toBeInTheDocument();
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    // The plain author list is NOT shown while searching.
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("navigates to the author from a work search hit", async () => {
    const onOpenAuthor = vi.fn();
    const results: SearchResults = {
      authors: [],
      works: [{ workId: 9, baseTitle: "Cool Story", authorId: 42, authorName: "Alice" }],
      chapters: [],
    };
    render(<LibraryView {...baseProps({ query: "cool", results, onOpenAuthor })} />);
    // WorkCard now renders a "View creator" button for work results
    await userEvent.click(screen.getByRole("button", { name: "View creator" }));
    expect(onOpenAuthor).toHaveBeenCalledWith(42);
  });

  it("shows a no-matches message when results are all empty", () => {
    render(<LibraryView {...baseProps({ query: "zzz", results: emptyResults })} />);
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("leaves top-level navigation to the app shell", () => {
    render(<LibraryView {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "Discover" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename tool" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settings/i })).not.toBeInTheDocument();
  });

  it("sort 'length' reorders rows by totalSecs descending", () => {
    const authorsForSort: AuthorRow[] = [
      { id: 10, name: "Short", workCount: 1, chapterCount: 1, unplayedCount: 0, totalSecs: 100, tags: [] },
      { id: 11, name: "Long", workCount: 1, chapterCount: 1, unplayedCount: 0, totalSecs: 9999, tags: [] },
    ];
    render(<LibraryView {...baseProps({ authors: authorsForSort, sort: "length" })} />);
    // Check that "Long" appears before "Short" in the DOM.
    const buttons = screen.getAllByRole("button");
    const longIdx = buttons.findIndex((b) => b.textContent?.includes("Long"));
    const shortIdx = buttons.findIndex((b) => b.textContent?.includes("Short"));
    expect(longIdx).toBeLessThan(shortIdx);
  });

  it("tag filter shows only authors with the matching tag", () => {
    const tagged: AuthorRow[] = [
      { id: 20, name: "Tagged", workCount: 1, chapterCount: 1, unplayedCount: 0, totalSecs: 0, tags: ["x"] },
      { id: 21, name: "Untagged", workCount: 1, chapterCount: 1, unplayedCount: 0, totalSecs: 0, tags: [] },
    ];
    render(<LibraryView {...baseProps({ authors: tagged, filterTag: "x", allTags: ["x"] })} />);
    expect(screen.getByText("Tagged")).toBeInTheDocument();
    expect(screen.queryByText("Untagged")).not.toBeInTheDocument();
  });

  it("status filter 'done' hides authors with unplayedCount > 0", () => {
    const mixed: AuthorRow[] = [
      { id: 30, name: "Finished", workCount: 1, chapterCount: 2, unplayedCount: 0, totalSecs: 0, tags: [] },
      { id: 31, name: "Pending", workCount: 1, chapterCount: 2, unplayedCount: 1, totalSecs: 0, tags: [] },
    ];
    render(<LibraryView {...baseProps({ authors: mixed, filterStatus: "done" })} />);
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("shows empty-filter message when no authors match", () => {
    const noMatch: AuthorRow[] = [
      { id: 40, name: "Someone", workCount: 1, chapterCount: 1, unplayedCount: 1, totalSecs: 0, tags: [] },
    ];
    render(<LibraryView {...baseProps({ authors: noMatch, filterStatus: "done" })} />);
    expect(screen.getByText("No authors match the current filters.")).toBeInTheDocument();
  });
});
