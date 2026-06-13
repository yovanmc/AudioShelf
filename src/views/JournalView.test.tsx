import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JournalView } from "./JournalView";
import type { JournalResults } from "../lib/api";

const entries: JournalResults = {
  entries: [
    {
      kind: "note",
      authorId: 1, authorName: "Jane Doe",
      workId: 10, workTitle: "Cool Story",
      chapterId: 5, chapterTitle: "Chapter One",
      positionSecs: 75, body: "An interesting passage",
      createdAt: 1000,
    },
    {
      kind: "bookmark",
      authorId: 1, authorName: "Jane Doe",
      workId: 10, workTitle: "Cool Story",
      chapterId: 5, chapterTitle: "Chapter One",
      positionSecs: 120, body: "key idea",
      createdAt: 2000,
    },
    {
      kind: "summary",
      authorId: 1, authorName: "Jane Doe",
      workId: 10, workTitle: "Cool Story",
      chapterId: 5, chapterTitle: "Chapter One",
      positionSecs: null, body: "This chapter covered X",
      createdAt: null,
    },
    {
      kind: "favorite",
      authorId: 1, authorName: "Jane Doe",
      workId: 10, workTitle: "Cool Story",
      chapterId: 5, chapterTitle: "Chapter One",
      positionSecs: null, body: "Chapter One",
      createdAt: null,
    },
    {
      kind: "note",
      authorId: 2, authorName: "Bob Smith",
      workId: 20, workTitle: "Another Book",
      chapterId: 9, chapterTitle: "Chapter Two",
      positionSecs: 30, body: "Bob's note",
      createdAt: 3000,
    },
  ],
};

function baseProps(over: Partial<React.ComponentProps<typeof JournalView>> = {}) {
  return {
    journal: entries,
    exportStatus: null,
    onSearch: vi.fn(),
    onExport: vi.fn(),
    ...over,
  };
}

describe("JournalView", () => {
  it("renders the Journal header", () => {
    render(<JournalView {...baseProps()} />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("Journal")).toBeInTheDocument();
  });

  it("renders entries grouped by author and work", () => {
    render(<JournalView {...baseProps()} />);
    // Two author groups
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    // Work headings (h3 level)
    expect(screen.getByRole("heading", { name: "Cool Story", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Another Book", level: 3 })).toBeInTheDocument();
  });

  it("shows kind badges for each entry via aria-label", () => {
    render(<JournalView {...baseProps()} />);
    // Two "Note" badges (one for Jane, one for Bob)
    expect(screen.getAllByLabelText("Kind: Note")).toHaveLength(2);
    expect(screen.getByLabelText("Kind: Bookmark")).toBeInTheDocument();
    expect(screen.getByLabelText("Kind: Summary")).toBeInTheDocument();
    expect(screen.getByLabelText("Kind: ★ Favorite")).toBeInTheDocument();
  });

  it("shows position for entries with positionSecs", () => {
    render(<JournalView {...baseProps()} />);
    // Note at 75s → 1:15
    expect(screen.getByText(/1:15/)).toBeInTheDocument();
  });

  it("shows entry body text", () => {
    render(<JournalView {...baseProps()} />);
    expect(screen.getByText("An interesting passage")).toBeInTheDocument();
    expect(screen.getByText("key idea")).toBeInTheDocument();
    expect(screen.getByText("Bob's note")).toBeInTheDocument();
  });

  it("kind filter chips narrow the entries", async () => {
    render(<JournalView {...baseProps()} />);
    // Click 'Bookmarks' chip
    await userEvent.click(screen.getByRole("tab", { name: "Bookmarks" }));
    expect(screen.getByText("key idea")).toBeInTheDocument();
    // Note body should not appear
    expect(screen.queryByText("An interesting passage")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob's note")).not.toBeInTheDocument();
  });

  it("Notes filter shows only note entries", async () => {
    render(<JournalView {...baseProps()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByText("An interesting passage")).toBeInTheDocument();
    expect(screen.getByText("Bob's note")).toBeInTheDocument();
    // Bookmark body should not appear
    expect(screen.queryByText("key idea")).not.toBeInTheDocument();
    // Summary body should not appear
    expect(screen.queryByText("This chapter covered X")).not.toBeInTheDocument();
  });

  it("Favorites filter shows only favorite entries", async () => {
    render(<JournalView {...baseProps()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Favorites" }));
    // Only the ★ Favorite entry remains
    expect(screen.getAllByLabelText("Kind: ★ Favorite")).toHaveLength(1);
    // Note body should not appear
    expect(screen.queryByText("An interesting passage")).not.toBeInTheDocument();
  });

  it("All chip resets the filter", async () => {
    render(<JournalView {...baseProps()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Notes" }));
    await userEvent.click(screen.getByRole("tab", { name: "All" }));
    // All entries visible again
    expect(screen.getByText("An interesting passage")).toBeInTheDocument();
    expect(screen.getByText("key idea")).toBeInTheDocument();
  });

  it("search input fires onSearch after debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSearch = vi.fn();
    const { unmount } = render(<JournalView {...baseProps({ onSearch })} />);
    const input = screen.getByRole("textbox", { name: "Search journal" });
    // Use fireEvent.change to avoid userEvent timer conflicts with fake timers
    act(() => { fireEvent.change(input, { target: { value: "hello" } }); });
    // Advance past debounce
    act(() => { vi.advanceTimersByTime(200); });
    expect(onSearch).toHaveBeenCalledWith("hello");
    unmount();
    vi.useRealTimers();
  });

  it("Export menu fires onExport('markdown') when Markdown is clicked", async () => {
    const onExport = vi.fn();
    render(<JournalView {...baseProps({ onExport })} />);
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Markdown" }));
    expect(onExport).toHaveBeenCalledWith("markdown");
  });

  it("Export menu fires onExport('json') when JSON is clicked", async () => {
    const onExport = vi.fn();
    render(<JournalView {...baseProps({ onExport })} />);
    await userEvent.click(screen.getByRole("button", { name: /Export/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "JSON" }));
    expect(onExport).toHaveBeenCalledWith("json");
  });

  it("shows empty state when journal has no entries", () => {
    render(<JournalView {...baseProps({ journal: { entries: [] } })} />);
    expect(screen.getByText("Your journal is empty")).toBeInTheDocument();
  });

  it("shows export status notice when provided", () => {
    render(<JournalView {...baseProps({ exportStatus: "Exported 5 entries to /tmp/journal.md" })} />);
    expect(screen.getByText("Exported 5 entries to /tmp/journal.md")).toBeInTheDocument();
  });

  it("shows loading state when journal is null", () => {
    render(<JournalView {...baseProps({ journal: null })} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
