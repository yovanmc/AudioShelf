import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeView } from "./HomeView";
import type { ChapterRow, HomeData } from "../lib/api";

const nextChapter: ChapterRow = {
  id: 7,
  title: "Tale 2",
  chapterNo: 2,
  format: "mp3",
  durationSecs: 300,
  filePath: "/lib/Alice/Tale 2.mp3",
  played: false,
  tags: [],
};

const home: HomeData = {
  keepListening: {
    authorId: 1,
    authorName: "Alice",
    workId: 3,
    workTitle: "Tale",
    nextChapter,
    remainingUnplayed: 1,
    totalChapters: 2,
    playedChapters: 1,
    lastPlayedAt: 1_000,
  },
  recommendations: Array.from({ length: 6 }, (_, index) => ({
    workId: 10 + index,
    baseTitle: `Suggestion ${index + 1}`,
    authorId: 20 + index,
    authorName: `Creator ${index + 1}`,
    totalChapters: 4,
    unplayedCount: 3,
    tags: ["cozy"],
    matchedTags: ["cozy"],
    reason: "Shares cozy",
  })),
  stats: {
    totalSecs: 600,
    chaptersFinished: 2,
    streakDays: 2,
    recent: [
      {
        chapterId: 7,
        chapterTitle: "Tale 2",
        workId: 3,
        workTitle: "Tale",
        authorId: 1,
        authorName: "Alice",
        playedAt: 2_000,
      },
    ],
  },
};

function baseProps(over: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  return {
    home,
    nowMs: 3_000,
    onPlay: vi.fn(),
    onOpenAuthor: vi.fn(),
    onOpenLibrary: vi.fn(),
    ...over,
  };
}

describe("HomeView", () => {
  it("renders continue-listening and stats", () => {
    render(<HomeView {...baseProps()} />);
    expect(screen.getByText("Keep listening to Alice")).toBeInTheDocument();
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText(/Next: Chapter 2, Tale 2/)).toBeInTheDocument();
    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText("2 days")).toBeInTheDocument();
    expect(screen.getByText("You May Like")).toBeInTheDocument();
    expect(screen.getAllByText("Shares cozy")).toHaveLength(6);
  });

  it("plays the next chapter when Play is clicked", async () => {
    const onPlay = vi.fn();
    render(<HomeView {...baseProps({ onPlay })} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep listening" }));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ chapter: nextChapter }));
  });

  it("shows an empty state when nothing has been played", () => {
    const empty: HomeData = {
      keepListening: null,
      recommendations: [],
      stats: { totalSecs: 0, chaptersFinished: 0, streakDays: 0, recent: [] },
    };
    render(<HomeView {...baseProps({ home: empty })} />);
    expect(screen.getByText(/Nothing played yet/)).toBeInTheDocument();
  });

  it("shows a loading state when home is null", () => {
    render(<HomeView {...baseProps({ home: null })} />);
    expect(screen.getByText("Loading your shelf...")).toBeInTheDocument();
  });
});
