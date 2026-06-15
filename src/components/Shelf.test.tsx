import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Shelf, CAP_SHELF_ITEMS } from "./Shelf";
import type { HomeShelf, ShelfItem } from "../lib/shelves";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tagShelf: HomeShelf = { id: "s1", title: "Cozy Reads", kind: "tag", tag: "cozy" };

const workItems: ShelfItem[] = [
  { kind: "work", workId: 10, title: "The First Work", authorId: 1, authorName: "Author One", unplayedCount: 2, tags: ["cozy"] },
  { kind: "work", workId: 11, title: "The Second Work", authorId: 2, authorName: "Author Two", unplayedCount: 0, tags: ["cozy"] },
];

const statusShelf: HomeShelf = { id: "s2", title: "Haven't Started", kind: "status", status: "unstarted" };

const creatorItems: ShelfItem[] = [
  { kind: "creator", authorId: 5, authorName: "Creator Alpha", workCount: 3, unplayedCount: 5 },
  { kind: "creator", authorId: 6, authorName: "Creator Beta", workCount: 1, unplayedCount: 2 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Shelf", () => {
  it("renders nothing when items array is empty", () => {
    const { container } = render(
      <Shelf shelf={tagShelf} items={[]} onOpenAuthor={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders shelf title as a heading (SectionHeading)", () => {
    render(
      <Shelf shelf={tagShelf} items={workItems} onOpenAuthor={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Cozy Reads" })).toBeInTheDocument();
  });

  it("renders both work item titles inside a .card-row", () => {
    const { container } = render(
      <Shelf shelf={tagShelf} items={workItems} onOpenAuthor={vi.fn()} />,
    );
    const row = container.querySelector(".card-row");
    expect(row).toBeInTheDocument();
    expect(screen.getByText("The First Work")).toBeInTheDocument();
    expect(screen.getByText("The Second Work")).toBeInTheDocument();
  });

  it("shows unplayed count meta for work items with unplayed chapters", () => {
    render(
      <Shelf shelf={tagShelf} items={workItems} onOpenAuthor={vi.fn()} />,
    );
    expect(screen.getByText("2 unplayed")).toBeInTheDocument();
    expect(screen.getByText("All played")).toBeInTheDocument();
  });

  it("calls onPlayNextOfWork with (workId, authorId) when Play is clicked", async () => {
    const onPlayNextOfWork = vi.fn();
    render(
      <Shelf
        shelf={tagShelf}
        items={workItems}
        onOpenAuthor={vi.fn()}
        onPlayNextOfWork={onPlayNextOfWork}
      />,
    );
    // The first work card's Play button
    const playButtons = screen.getAllByRole("button", { name: "▶ Play" });
    await userEvent.click(playButtons[0]);
    expect(onPlayNextOfWork).toHaveBeenCalledWith(10, 1);
  });

  it("does not render Play buttons when onPlayNextOfWork is omitted", () => {
    render(
      <Shelf shelf={tagShelf} items={workItems} onOpenAuthor={vi.fn()} />,
    );
    expect(screen.queryAllByRole("button", { name: "▶ Play" })).toHaveLength(0);
  });

  it("renders creator items as CreatorIdentity rows", () => {
    render(
      <Shelf shelf={statusShelf} items={creatorItems} onOpenAuthor={vi.fn()} />,
    );
    expect(screen.getByText("Creator Alpha")).toBeInTheDocument();
    expect(screen.getByText("Creator Beta")).toBeInTheDocument();
  });

  it("shows work/unplayed summary for creator items", () => {
    render(
      <Shelf shelf={statusShelf} items={creatorItems} onOpenAuthor={vi.fn()} />,
    );
    expect(screen.getByText("3 works · 5 unplayed")).toBeInTheDocument();
    expect(screen.getByText("1 works · 2 unplayed")).toBeInTheDocument();
  });

  it("calls onOpenAuthor when a creator item is clicked", async () => {
    const onOpenAuthor = vi.fn();
    render(
      <Shelf shelf={statusShelf} items={creatorItems} onOpenAuthor={onOpenAuthor} />,
    );
    // CreatorIdentity renders a button; its accessible name includes secondary text too.
    // Use getAllByRole to find creator buttons and click the first one.
    const creatorButtons = screen.getAllByRole("button");
    // Filter by buttons that contain "Creator Alpha" (may also include secondary text)
    const alphaButton = creatorButtons.find((btn) => btn.textContent?.includes("Creator Alpha"));
    expect(alphaButton).toBeDefined();
    await userEvent.click(alphaButton!);
    expect(onOpenAuthor).toHaveBeenCalledWith(5);
  });

  it("renders with the correct aria-label on the section", () => {
    const { container } = render(
      <Shelf shelf={tagShelf} items={workItems} onOpenAuthor={vi.fn()} />,
    );
    const section = container.querySelector("section.shelf");
    expect(section).toHaveAttribute("aria-label", "Cozy Reads");
  });

  // ---- M34 Task 5: shelf item cap ----
  it("renders all items when count is at or below CAP_SHELF_ITEMS", () => {
    const items: ShelfItem[] = Array.from({ length: CAP_SHELF_ITEMS }, (_, i) => ({
      kind: "work" as const,
      workId: 100 + i,
      title: `Work ${i}`,
      authorId: i,
      authorName: `Author ${i}`,
      unplayedCount: 1,
      tags: [],
    }));
    render(<Shelf shelf={tagShelf} items={items} onOpenAuthor={vi.fn()} />);
    // All items should be present; no "+N more" affordance
    expect(screen.getByText("Work 0")).toBeInTheDocument();
    expect(screen.getByText(`Work ${CAP_SHELF_ITEMS - 1}`)).toBeInTheDocument();
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it("renders only CAP_SHELF_ITEMS cards and a '+N more' affordance when over the cap", () => {
    const TOTAL = CAP_SHELF_ITEMS + 5;
    const items: ShelfItem[] = Array.from({ length: TOTAL }, (_, i) => ({
      kind: "work" as const,
      workId: 200 + i,
      title: `OverWork ${i}`,
      authorId: i,
      authorName: `Author ${i}`,
      unplayedCount: 1,
      tags: [],
    }));
    render(<Shelf shelf={tagShelf} items={items} onOpenAuthor={vi.fn()} />);
    // Exactly CAP_SHELF_ITEMS item titles should render
    for (let i = 0; i < CAP_SHELF_ITEMS; i++) {
      expect(screen.getByText(`OverWork ${i}`)).toBeInTheDocument();
    }
    // Items beyond the cap should NOT render
    expect(screen.queryByText(`OverWork ${CAP_SHELF_ITEMS}`)).toBeNull();
    // The "+N more" affordance should appear with the correct overflow count
    const overflow = TOTAL - CAP_SHELF_ITEMS;
    expect(screen.getByText(`+${overflow} more`)).toBeInTheDocument();
  });

  it("'+N more' on a creator shelf navigates to the author when clicked", async () => {
    const onOpenAuthor = vi.fn();
    const creatorShelf: HomeShelf = { id: "sc1", title: "By Creator", kind: "creator", authorId: 42 };
    const TOTAL = CAP_SHELF_ITEMS + 3;
    const items: ShelfItem[] = Array.from({ length: TOTAL }, (_, i) => ({
      kind: "creator" as const,
      authorId: 100 + i,
      authorName: `Creator ${i}`,
      workCount: 2,
      unplayedCount: 1,
    }));
    render(<Shelf shelf={creatorShelf} items={items} onOpenAuthor={onOpenAuthor} />);
    const overflow = TOTAL - CAP_SHELF_ITEMS;
    const moreBtn = screen.getByText(`+${overflow} more`);
    await userEvent.click(moreBtn);
    // Should navigate to the shelf's authorId, not the items' authorIds
    expect(onOpenAuthor).toHaveBeenCalledWith(42);
  });

  it("'+N more' on a tag shelf renders a static label (no button)", () => {
    const TOTAL = CAP_SHELF_ITEMS + 2;
    const items: ShelfItem[] = Array.from({ length: TOTAL }, (_, i) => ({
      kind: "work" as const,
      workId: 300 + i,
      title: `TagWork ${i}`,
      authorId: i,
      authorName: `Author ${i}`,
      unplayedCount: 0,
      tags: ["cozy"],
    }));
    render(<Shelf shelf={tagShelf} items={items} onOpenAuthor={vi.fn()} />);
    const overflow = TOTAL - CAP_SHELF_ITEMS;
    // The more affordance exists but is NOT a button (it's a static div)
    const moreEl = screen.getByText(`+${overflow} more`);
    expect(moreEl.tagName).not.toBe("BUTTON");
  });
});
