import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeView } from "./HomeView";
import type { ChapterRow, HomeData } from "../lib/api";
import type { HomeShelf, ShelfItem } from "../lib/shelves";

const nextChapter: ChapterRow = {
  id: 7,
  title: "Tale 2",
  chapterNo: 2,
  format: "mp3",
  durationSecs: 300,
  filePath: "/lib/Alice/Tale 2.mp3",
  played: false,
  tags: [],
  labels: [],
  userSummary: "",
  takeaway: "",
  isFavorite: false,
  metadata: [],
  playbackPositionSecs: 0,
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
    onOpenSettings: vi.fn(),
    onPlayNextOfWork: vi.fn(),
    ...over,
  };
}

describe("HomeView", () => {
  it("renders continue-listening and stats", () => {
    const { container } = render(<HomeView {...baseProps()} />);
    expect(screen.getByText("Keep listening to Alice")).toBeInTheDocument();
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    // Next-chapter title (Tale 2) is now elevated as a <strong dir="auto"> in the hero meta (PL-5)
    expect(container.querySelector("strong[dir='auto']")).toHaveTextContent("Tale 2");
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

  it("triggers onPlayNextOfWork when a recommendation Play button is clicked", async () => {
    const onPlayNextOfWork = vi.fn();
    render(<HomeView {...baseProps({ onPlayNextOfWork })} />);
    // Click the first Play button on the first recommendation card
    const playButtons = screen.getAllByRole("button", { name: "▶ Play" });
    await userEvent.click(playButtons[0]);
    expect(onPlayNextOfWork).toHaveBeenCalledWith(10, 20);
  });

  it("shows first-run welcome and suppresses You May Like when no history", () => {
    const empty: HomeData = {
      keepListening: null,
      recommendations: [],
      stats: { totalSecs: 0, chaptersFinished: 0, streakDays: 0, recent: [] },
    };
    render(<HomeView {...baseProps({ home: empty })} />);
    expect(screen.getByText("Welcome to AudioShelf")).toBeInTheDocument();
    expect(screen.getByText(/organized by creator/)).toBeInTheDocument();
    expect(screen.queryByText("You May Like")).not.toBeInTheDocument();
  });

  it("shows a loading state when home is null", () => {
    render(<HomeView {...baseProps({ home: null })} />);
    expect(screen.getByText("Loading your shelf...")).toBeInTheDocument();
  });

  it("renders a shelf section with cards when shelves and shelfItems are provided", () => {
    const shelf: HomeShelf = { id: "s1_0", title: "Cozy Reads", kind: "tag", tag: "cozy" };
    const items: ShelfItem[] = [
      { kind: "work", workId: 101, title: "A Cozy Tale", authorId: 201, authorName: "Bob", unplayedCount: 2, tags: ["cozy"] },
      { kind: "work", workId: 102, title: "Another Cozy", authorId: 202, authorName: "Carol", unplayedCount: 0, tags: ["cozy"] },
    ];
    render(<HomeView {...baseProps({ shelves: [shelf], shelfItems: { "s1_0": items } })} />);
    expect(screen.getByText("Cozy Reads")).toBeInTheDocument();
    expect(screen.getByText("A Cozy Tale")).toBeInTheDocument();
    expect(screen.getByText("Another Cozy")).toBeInTheDocument();
  });

  it("renders no shelf sections when shelves is empty", () => {
    const { container } = render(<HomeView {...baseProps({ shelves: [], shelfItems: {} })} />);
    expect(container.querySelector(".shelf")).toBeNull();
  });

  it("renders no shelf sections when shelves prop is omitted", () => {
    const { container } = render(<HomeView {...baseProps()} />);
    expect(container.querySelector(".shelf")).toBeNull();
  });

  it("clicking a recently-listened row calls onOpenAuthor with that author id", async () => {
    const onOpenAuthor = vi.fn();
    const { container } = render(<HomeView {...baseProps({ onOpenAuthor })} />);
    // The recent list has one item: authorId=1, authorName="Alice"
    // CreatorIdentity renders a button with the author name when onOpen is provided
    const recentList = container.querySelector(".recent-list")!;
    const creatorButton = recentList.querySelector("button.creator-identity") as HTMLElement;
    expect(creatorButton).not.toBeNull();
    await userEvent.click(creatorButton);
    expect(onOpenAuthor).toHaveBeenCalledWith(1);
  });

  // ---- M16 Task 11: Forgotten shelf ----
  it("renders the Forgotten shelf when dormantWorks are provided", () => {
    const dormant = [
      { workId: 201, baseTitle: "Old Audiobook", authorId: 301, authorName: "Dusty Author", lastPlayedAt: 1000, playedFraction: 0.5 },
    ];
    render(<HomeView {...baseProps({ dormantWorks: dormant })} />);
    expect(screen.getByRole("heading", { name: "Forgotten" })).toBeInTheDocument();
    expect(screen.getByText("Old Audiobook")).toBeInTheDocument();
  });

  it("does not render the Forgotten shelf when dormantWorks is empty", () => {
    render(<HomeView {...baseProps({ dormantWorks: [] })} />);
    expect(screen.queryByRole("heading", { name: "Forgotten" })).not.toBeInTheDocument();
  });

  it("does not render the Forgotten shelf when dormantWorks prop is omitted", () => {
    render(<HomeView {...baseProps()} />);
    expect(screen.queryByRole("heading", { name: "Forgotten" })).not.toBeInTheDocument();
  });

  // CL-2: stats grid visibility tied to listening history
  it("hides 'Your listening' stats grid when there is no history and shows it when there is", () => {
    const noHistory: HomeData = {
      keepListening: null,
      recommendations: [],
      stats: { totalSecs: 0, chaptersFinished: 0, streakDays: 0, recent: [] },
    };
    const { unmount } = render(<HomeView {...baseProps({ home: noHistory })} />);
    expect(screen.queryByRole("heading", { name: "Your listening" })).not.toBeInTheDocument();
    unmount();

    render(<HomeView {...baseProps()} />);
    expect(screen.getByRole("heading", { name: "Your listening" })).toBeInTheDocument();
  });
});
