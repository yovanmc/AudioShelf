import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryView } from "./LibraryView";
import type { AuthorRow } from "../lib/api";

const authors: AuthorRow[] = [
  { id: 1, name: "Alice", workCount: 1, chapterCount: 2, unplayedCount: 1 },
  { id: 2, name: "Bob", workCount: 2, chapterCount: 4, unplayedCount: 0 },
];

describe("LibraryView", () => {
  it("lists authors and filters by search", async () => {
    render(<LibraryView authors={authors} onOpenAuthor={() => {}} onOpenDiscovery={() => {}} onOpenRename={() => {}} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search authors"), "ali");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("invokes onOpenAuthor when a row is clicked", async () => {
    const onOpen = vi.fn();
    render(<LibraryView authors={authors} onOpenAuthor={onOpen} onOpenDiscovery={() => {}} onOpenRename={() => {}} />);
    await userEvent.click(screen.getByText("Bob"));
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it("opens discovery", async () => {
    const onDisc = vi.fn();
    render(<LibraryView authors={authors} onOpenAuthor={() => {}} onOpenDiscovery={onDisc} onOpenRename={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(onDisc).toHaveBeenCalled();
  });

  it("opens the rename tool", async () => {
    const onOpenRename = vi.fn();
    render(<LibraryView authors={[]} onOpenAuthor={() => {}} onOpenDiscovery={() => {}} onOpenRename={onOpenRename} />);
    await userEvent.click(screen.getByRole("button", { name: "Rename tool" }));
    expect(onOpenRename).toHaveBeenCalled();
  });
});
