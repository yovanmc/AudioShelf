import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock api module before importing the component
vi.mock("../lib/api", () => ({
  queryPlayedInRange: vi.fn(),
}));

import { queryPlayedInRange } from "../lib/api";
import { PlayedRangeView } from "./PlayedRangeView";
import type { ScopedResults } from "../lib/api";

const mockQuery = vi.mocked(queryPlayedInRange);

const filledResults: ScopedResults = {
  works: [
    {
      workId: 1,
      baseTitle: "Dune",
      authorId: 10,
      authorName: "Frank Herbert",
      chapterCount: 8,
      playedCount: 3,
      totalSecs: 3600,
      tags: [],
    },
  ],
  tags: [],
  text: "",
  durationLabel: "",
  statusLabel: "",
};

const emptyResults: ScopedResults = {
  works: [],
  tags: [],
  text: "",
  durationLabel: "",
  statusLabel: "",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlayedRangeView", () => {
  it("renders ScopedResults when the query resolves with works", async () => {
    mockQuery.mockResolvedValue(filledResults);
    render(
      <PlayedRangeView
        startMs={1000}
        endMs={2000}
        label="Tue, Jun 10"
        onOpenAuthor={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByText("Dune"));
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
  });

  it("renders the empty state when the query resolves with no works", async () => {
    mockQuery.mockResolvedValue(emptyResults);
    render(
      <PlayedRangeView
        startMs={1000}
        endMs={2000}
        label="Tue, Jun 10"
        onOpenAuthor={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByText("Nothing played in this period"));
    expect(screen.getByText("Nothing played in this period")).toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", async () => {
    mockQuery.mockResolvedValue(filledResults);
    const onBack = vi.fn();
    render(
      <PlayedRangeView
        startMs={1000}
        endMs={2000}
        label="Tue, Jun 10"
        onOpenAuthor={vi.fn()}
        onBack={onBack}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Insights/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
