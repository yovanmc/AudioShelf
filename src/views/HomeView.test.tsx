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
  continueListening: [
    {
      authorId: 1,
      authorName: "Alice",
      workId: 3,
      workTitle: "Tale",
      nextChapter,
      remainingUnplayed: 1,
      lastPlayedAt: 1_000,
    },
  ],
  stats: {
    totalSecs: 600,
    chaptersFinished: 2,
    streakDays: 2,
    recent: [
      { chapterId: 7, chapterTitle: "Tale 2", workTitle: "Tale", authorName: "Alice", playedAt: 2_000 },
    ],
  },
};

function baseProps(over: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  return {
    home,
    nowMs: 3_000,
    onPlayChapter: vi.fn(),
    onOpenAuthor: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenDiscovery: vi.fn(),
    onOpenRename: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
}

describe("HomeView", () => {
  it("renders continue-listening and stats", () => {
    render(<HomeView {...baseProps()} />);
    expect(screen.getByText("Jump back in")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/Next: Ch 2 — Tale 2/)).toBeInTheDocument();
    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText(/🔥 2 days/)).toBeInTheDocument();
  });

  it("plays the next chapter when Play is clicked", async () => {
    const onPlayChapter = vi.fn();
    render(<HomeView {...baseProps({ onPlayChapter })} />);
    await userEvent.click(screen.getByText("▶ Play"));
    expect(onPlayChapter).toHaveBeenCalledWith(nextChapter);
  });

  it("shows an empty state when nothing has been played", () => {
    const empty: HomeData = {
      continueListening: [],
      stats: { totalSecs: 0, chaptersFinished: 0, streakDays: 0, recent: [] },
    };
    render(<HomeView {...baseProps({ home: empty })} />);
    expect(screen.getByText(/Nothing played yet/)).toBeInTheDocument();
  });

  it("shows a loading state when home is null", () => {
    render(<HomeView {...baseProps({ home: null })} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
