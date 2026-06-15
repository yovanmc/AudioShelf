import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryView } from "./LibraryView";
import type { AuthorRow, SearchResults, LabelType } from "../lib/api";

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
    expect(screen.getByText("No matches for that search")).toBeInTheDocument();
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
    expect(screen.getByText("No creators match those filters")).toBeInTheDocument();
  });

  it("renders all four played-status tabs when not searching", () => {
    render(<LibraryView {...baseProps()} />);
    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Has unplayed" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Fully played" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Not started" })).toBeInTheDocument();
  });

  it("the active tab has aria-selected=true and others have aria-selected=false", () => {
    render(<LibraryView {...baseProps({ filterStatus: "done" })} />);
    expect(screen.getByRole("tab", { name: "Fully played" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Has unplayed" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Not started" })).toHaveAttribute("aria-selected", "false");
  });

  it("clicking a tab calls onFilterStatusChange with the correct value", async () => {
    const onFilterStatusChange = vi.fn();
    render(<LibraryView {...baseProps({ onFilterStatusChange })} />);
    await userEvent.click(screen.getByRole("tab", { name: "Has unplayed" }));
    expect(onFilterStatusChange).toHaveBeenCalledWith("unplayed");
    await userEvent.click(screen.getByRole("tab", { name: "Fully played" }));
    expect(onFilterStatusChange).toHaveBeenCalledWith("done");
    await userEvent.click(screen.getByRole("tab", { name: "Not started" }));
    expect(onFilterStatusChange).toHaveBeenCalledWith("unstarted");
    await userEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(onFilterStatusChange).toHaveBeenCalledWith("all");
  });

  it("tab bar is NOT shown when searching", () => {
    render(<LibraryView {...baseProps({ query: "alice", results: null })} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("Status select is not present in the sort/filter bar (moved to tab bar)", () => {
    render(<LibraryView {...baseProps()} />);
    expect(screen.queryByRole("combobox", { name: "Filter by status" })).not.toBeInTheDocument();
  });

  it("inline save-search works without window.prompt", async () => {
    const onSaveSearch = vi.fn();
    render(
      <LibraryView
        {...baseProps({ scoped: true, onSaveSearch, query: "tag:cozy" })}
      />,
    );
    // Click "Save search" to open the inline form
    await userEvent.click(screen.getByRole("button", { name: "Save search" }));
    // Type a name into the inline input
    const input = screen.getByRole("textbox", { name: "Name this search" });
    await userEvent.type(input, "My cozy list");
    // Submit the form
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveSearch).toHaveBeenCalledWith("My cozy list", "tag:cozy");
  });

  it("Search tips toggle reveals the tag: example", async () => {
    render(<LibraryView {...baseProps()} />);
    // The tag: example should not be visible initially
    expect(screen.queryByText(/tag:cozy/)).not.toBeInTheDocument();
    // Click "Search tips" to expand
    await userEvent.click(screen.getByRole("button", { name: "Search tips" }));
    // Now the tag: example should be visible
    expect(screen.getByText(/tag:cozy/)).toBeInTheDocument();
    // The button text flips to "Hide tips"
    expect(screen.getByRole("button", { name: "Hide tips" })).toBeInTheDocument();
  });

  // ---- saved-search strip (VIS-8) ----

  it("renders one chip per saved search in the strip", () => {
    const savedSearches = [
      { id: 1, name: "Short reads", query: "duration:<15m" },
      { id: 2, name: "Cozy", query: "tag:cozy" },
    ];
    render(<LibraryView {...baseProps({ savedSearches })} />);
    expect(screen.getByText("Short reads")).toBeInTheDocument();
    expect(screen.getByText("Cozy")).toBeInTheDocument();
    // The "Saved:" label is present
    expect(screen.getByText("Saved:")).toBeInTheDocument();
  });

  it("calls onRunSavedSearch with the query when a saved-search chip is clicked", async () => {
    const onRunSavedSearch = vi.fn();
    const savedSearches = [{ id: 1, name: "Short reads", query: "duration:<15m" }];
    render(<LibraryView {...baseProps({ savedSearches, onRunSavedSearch })} />);
    await userEvent.click(screen.getByRole("button", { name: "Short reads" }));
    expect(onRunSavedSearch).toHaveBeenCalledWith("duration:<15m");
  });

  it("calls onDeleteSavedSearch with the id when the delete button is clicked", async () => {
    const onDeleteSavedSearch = vi.fn();
    const savedSearches = [{ id: 5, name: "Cozy", query: "tag:cozy" }];
    render(<LibraryView {...baseProps({ savedSearches, onDeleteSavedSearch })} />);
    await userEvent.click(screen.getByRole("button", { name: 'Delete saved search "Cozy"' }));
    expect(onDeleteSavedSearch).toHaveBeenCalledWith(5);
  });

  it("does not render the saved-search strip when savedSearches is empty", () => {
    render(<LibraryView {...baseProps({ savedSearches: [] })} />);
    expect(screen.queryByText("Saved:")).not.toBeInTheDocument();
  });
});

// ---- M26: Unified label filter integration ----

const LABEL_TYPES_LIB: LabelType[] = [
  { name: "tag", display: "Tags", builtin: true, sort: 0 },
  { name: "narrator", display: "Narrator", builtin: true, sort: 1 },
];

const TERMS_BY_TYPE_LIB: Record<string, { value: string; count: number }[]> = {
  tag: [{ value: "fiction", count: 2 }],
  narrator: [{ value: "Jane Doe", count: 1 }],
};

function unifiedBaseProps(over: Partial<React.ComponentProps<typeof LibraryView>> = {}) {
  const base: React.ComponentProps<typeof LibraryView> = {
    authors,
    query: "",
    results: null,
    sort: "az",
    onSortChange: vi.fn(),
    filterTag: null,
    onFilterTagChange: vi.fn(),
    filterStatus: "all",
    onFilterStatusChange: vi.fn(),
    allTags: [],
    onQueryChange: vi.fn(),
    onOpenAuthor: vi.fn(),
    labelTypes: LABEL_TYPES_LIB,
    termsByType: TERMS_BY_TYPE_LIB,
    labelFilter: null,
    onLabelFilterChange: vi.fn(),
    ...over,
  };
  return base;
}

describe("LibraryView — unified label filter (M26)", () => {
  it("renders the unified type and value selects when labelTypes/termsByType/onLabelFilterChange provided", () => {
    render(<LibraryView {...unifiedBaseProps()} />);
    expect(screen.getByRole("button", { name: "Filter by label type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by label value" })).toBeInTheDocument();
    // Legacy single-select not shown
    expect(screen.queryByRole("button", { name: "Filter by tag" })).not.toBeInTheDocument();
  });

  it("labelFilter with tag facet filters the author list by AuthorRow.tags", () => {
    const tagged: AuthorRow[] = [
      { id: 20, name: "Tagged", workCount: 1, chapterCount: 1, unplayedCount: 0, totalSecs: 0, tags: ["fiction"] },
      { id: 21, name: "Untagged", workCount: 1, chapterCount: 1, unplayedCount: 0, totalSecs: 0, tags: [] },
    ];
    render(
      <LibraryView
        {...unifiedBaseProps({
          authors: tagged,
          labelFilter: { facet: "tag", value: "fiction" },
        })}
      />,
    );
    expect(screen.getByText("Tagged")).toBeInTheDocument();
    expect(screen.queryByText("Untagged")).not.toBeInTheDocument();
  });

  it("labelFilter with non-tag facet (e.g. narrator) degrades gracefully — shows empty-state not a crash", () => {
    const tagged: AuthorRow[] = [
      { id: 22, name: "Someone", workCount: 1, chapterCount: 1, unplayedCount: 0, totalSecs: 0, tags: [] },
    ];
    render(
      <LibraryView
        {...unifiedBaseProps({
          authors: tagged,
          // narrator facet: AuthorRow has no narrator field, so no author matches — empty list
          labelFilter: { facet: "narrator", value: "Jane Doe" },
        })}
      />,
    );
    // Empty-state message rendered (not a crash or exception)
    expect(screen.getByText("No creators match those filters")).toBeInTheDocument();
  });

  it("labelFilter null shows all authors (no filter active)", () => {
    render(<LibraryView {...unifiedBaseProps({ labelFilter: null })} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("type select lists all label type display names", async () => {
    render(<LibraryView {...unifiedBaseProps()} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter by label type" }));
    expect(screen.getByRole("option", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Narrator" })).toBeInTheDocument();
  });
});
