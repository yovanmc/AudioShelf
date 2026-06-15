import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScopedResults } from "./ScopedResults";
import type { ScopedResults as Results } from "../lib/api";

function makeScopedResults(workCount: number): Results {
  return {
    works: Array.from({ length: workCount }, (_, i) => ({
      workId: i + 1,
      baseTitle: `Work ${i + 1}`,
      authorId: i + 1,
      authorName: `Author ${i + 1}`,
      playedCount: 0,
      chapterCount: 3,
      totalSecs: 600,
      tags: [],
    })),
    tags: [],
    text: "",
    durationLabel: "",
    statusLabel: "",
  };
}

describe("ScopedResults — M34 Task 6c: cap disclosure note", () => {
  it("does NOT show the cap note when fewer than 50 works are returned", () => {
    render(<ScopedResults results={makeScopedResults(49)} onOpenAuthor={vi.fn()} />);
    expect(screen.queryByText(/Showing first 50/i)).toBeNull();
  });

  it("shows the cap note when exactly 50 works are returned", () => {
    render(<ScopedResults results={makeScopedResults(50)} onOpenAuthor={vi.fn()} />);
    expect(screen.getByText(/Showing first 50/i)).toBeInTheDocument();
  });

  it("shows the cap note when more than 50 works are returned (e.g. if backend cap is raised)", () => {
    render(<ScopedResults results={makeScopedResults(55)} onOpenAuthor={vi.fn()} />);
    expect(screen.getByText(/Showing first 50/i)).toBeInTheDocument();
  });
});
