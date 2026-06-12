import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryView } from "./LibraryView";
import type { AuthorRow, SearchResults } from "../lib/api";

const authors: AuthorRow[] = [
  { id: 1, name: "Alice", workCount: 1, chapterCount: 2, unplayedCount: 1 },
  { id: 2, name: "Bob", workCount: 2, chapterCount: 4, unplayedCount: 0 },
];

const emptyResults: SearchResults = { authors: [], works: [], chapters: [] };

function baseProps(over: Partial<React.ComponentProps<typeof LibraryView>> = {}) {
  return {
    authors,
    query: "",
    results: null as SearchResults | null,
    onQueryChange: vi.fn(),
    onOpenAuthor: vi.fn(),
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
    await userEvent.click(screen.getByText(/Cool Story/));
    expect(onOpenAuthor).toHaveBeenCalledWith(42);
  });

  it("shows a no-matches message when results are all empty", () => {
    render(<LibraryView {...baseProps({ query: "zzz", results: emptyResults })} />);
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("fires the toolbar callbacks", async () => {
    const onOpenDiscovery = vi.fn();
    const onOpenRename = vi.fn();
    const onOpenSettings = vi.fn();
    render(<LibraryView {...baseProps({ onOpenDiscovery, onOpenRename, onOpenSettings })} />);
    await userEvent.click(screen.getByRole("button", { name: "Discover" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename tool" }));
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(onOpenDiscovery).toHaveBeenCalled();
    expect(onOpenRename).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
