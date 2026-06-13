import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NowPlayingPanel } from "./NowPlayingPanel";

const context = {
  chapter: { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/audio.mp3", played: false, tags: [], userSummary: "", takeaway: "", isFavorite: false },
  authorId: 1,
  authorName: "Jane Doe",
  workId: 3,
  workTitle: "Cool Story",
  workTotalChapters: 4,
  workPlayedChapters: 2,
};

function props(overrides = {}) {
  return {
    context,
    isPlaying: false,
    currentTime: 30,
    duration: 120,
    volume: 1,
    sleepMinutes: null,
    onClose: vi.fn(),
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onSkip: vi.fn(),
    onVolume: vi.fn(),
    onSetSleep: vi.fn(),
    onOpenAuthor: vi.fn(),
    chapters: [] as import("../lib/api").ChapterRow[],
    onJumpToChapter: vi.fn(),
    timeLabelMode: "elapsed" as const,
    onCycleTimeLabel: vi.fn(),
    ...overrides,
  };
}

describe("NowPlayingPanel", () => {
  it("renders as a dialog and closes on Escape", async () => {
    const p = props();
    render(<NowPlayingPanel {...p} />);
    expect(screen.getByRole("dialog", { name: "Now playing" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(p.onClose).toHaveBeenCalled();
  });

  it("has a close button labeled 'Close Now playing' (top-right via Dialog primitive)", () => {
    render(<NowPlayingPanel {...props()} />);
    expect(screen.getByRole("button", { name: "Close Now playing" })).toBeInTheDocument();
  });

  it("opens the creator and exposes playback controls", async () => {
    const p = props();
    render(<NowPlayingPanel {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Jane Doe" }));
    expect(p.onOpenAuthor).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText("Seek")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
    expect(screen.getByLabelText("Sleep timer")).toBeInTheDocument();
  });

  it("shows Chapter X of Y and the stop note", () => {
    render(<NowPlayingPanel {...props()} />);
    // context has chapterNo: 2, workTotalChapters: 4
    expect(screen.getByText("Chapter 2 of 4")).toBeInTheDocument();
    // Not the last chapter, so shows "then stops" note
    expect(screen.getByText("Plays this chapter, then stops.")).toBeInTheDocument();
  });

  it("shows last-chapter note when on the final chapter", () => {
    const lastContext = {
      ...context,
      chapter: { ...context.chapter, chapterNo: 4 },
      workTotalChapters: 4,
    };
    const p = { ...props(), context: lastContext };
    render(<NowPlayingPanel {...p} />);
    expect(screen.getByText("Chapter 4 of 4")).toBeInTheDocument();
    expect(screen.getByText("Last chapter — playback stops at the end.")).toBeInTheDocument();
  });

  it("tappable work title calls onOpenAuthor", async () => {
    const p = props();
    render(<NowPlayingPanel {...p} />);
    // The work title "Cool Story" is inside a button that calls onOpenAuthor
    await userEvent.click(screen.getByRole("button", { name: "Cool Story" }));
    expect(p.onOpenAuthor).toHaveBeenCalledWith(1);
  });

  it("clicking the time-label button calls onCycleTimeLabel", async () => {
    const p = props();
    render(<NowPlayingPanel {...p} />);
    await userEvent.click(screen.getByTitle("Toggle time display"));
    expect(p.onCycleTimeLabel).toHaveBeenCalled();
  });

  it("shows remaining time when mode is remaining", () => {
    render(<NowPlayingPanel {...props({ timeLabelMode: "remaining", currentTime: 30, duration: 120 })} />);
    expect(screen.getByTitle("Toggle time display")).toHaveTextContent("-1:30");
  });

  it("shows percent when mode is percent", () => {
    render(<NowPlayingPanel {...props({ timeLabelMode: "percent", currentTime: 30, duration: 120 })} />);
    expect(screen.getByTitle("Toggle time display")).toHaveTextContent("25%");
  });

  it("renders chapter list when given more than one chapter", () => {
    const chapters: import("../lib/api").ChapterRow[] = [
      { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/a.mp3", played: false, tags: [], userSummary: "", takeaway: "", isFavorite: false },
      { id: 2, title: "Other Chapter", chapterNo: 3, format: "mp3", durationSecs: 90, filePath: "/b.mp3", played: true, tags: [], userSummary: "", takeaway: "", isFavorite: false },
    ];
    render(<NowPlayingPanel {...props({ chapters })} />);
    expect(screen.getByText("In this work", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Ch 2 — Chapter 2/)).toBeInTheDocument();
    expect(screen.getByText(/Ch 3 — Other Chapter/)).toBeInTheDocument();
    // The current chapter (id=1, matching context.chapter.id=1) has aria-current
    const currentBtn = screen.getByRole("button", { name: /Ch 2 — Chapter 2/ });
    expect(currentBtn).toHaveAttribute("aria-current", "true");
  });

  it("clicking a chapter calls onJumpToChapter with that chapter", async () => {
    const chapters: import("../lib/api").ChapterRow[] = [
      { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/a.mp3", played: false, tags: [], userSummary: "", takeaway: "", isFavorite: false },
      { id: 2, title: "Other Chapter", chapterNo: 3, format: "mp3", durationSecs: 90, filePath: "/b.mp3", played: true, tags: [], userSummary: "", takeaway: "", isFavorite: false },
    ];
    const onJumpToChapter = vi.fn();
    render(<NowPlayingPanel {...props({ chapters, onJumpToChapter })} />);
    await userEvent.click(screen.getByRole("button", { name: /Ch 3 — Other Chapter/ }));
    expect(onJumpToChapter).toHaveBeenCalledWith(chapters[1]);
  });

  it("does not render chapter list for a single-chapter work", () => {
    const chapters: import("../lib/api").ChapterRow[] = [
      { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/a.mp3", played: false, tags: [], userSummary: "", takeaway: "", isFavorite: false },
    ];
    render(<NowPlayingPanel {...props({ chapters })} />);
    expect(screen.queryByText("In this work", { exact: false })).not.toBeInTheDocument();
  });

  // ---- transcript panel tests ----

  it("renders the Transcript section when transcript prop is provided", () => {
    render(<NowPlayingPanel {...props({ transcript: "Hello world transcript text." })} />);
    expect(screen.getByRole("region", { name: "Transcript" })).toBeInTheDocument();
    expect(screen.getByText("Transcript")).toBeInTheDocument();
    expect(screen.getByText("Hello world transcript text.")).toBeInTheDocument();
  });

  it("does not render the Transcript section when transcript prop is absent", () => {
    render(<NowPlayingPanel {...props()} />);
    expect(screen.queryByRole("region", { name: "Transcript" })).not.toBeInTheDocument();
    expect(screen.queryByText("Transcript")).not.toBeInTheDocument();
  });

  it("does not render the Transcript section when transcript prop is null", () => {
    render(<NowPlayingPanel {...props({ transcript: null })} />);
    expect(screen.queryByText("Transcript")).not.toBeInTheDocument();
  });
});
