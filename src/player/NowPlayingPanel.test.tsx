import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NowPlayingPanel } from "./NowPlayingPanel";

const context = {
  chapter: { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/audio.mp3", played: false, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
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

  it("shows Chapter X of Y and the end-actions section", () => {
    render(<NowPlayingPanel {...props()} />);
    // context has chapterNo: 2, workTotalChapters: 4
    expect(screen.getByText("Chapter 2 of 4")).toBeInTheDocument();
    // Without canPlayNext/onPlayNextChapter, shows the else branch (last-chapter / complete actions)
    expect(screen.getByText("Last chapter — playback stops at the end.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark work complete" })).toBeInTheDocument();
  });

  it("shows 'Play next chapter' branch when canPlayNext and onPlayNextChapter are set", () => {
    const onPlayNextChapter = vi.fn();
    render(<NowPlayingPanel {...props({ canPlayNext: true, onPlayNextChapter })} />);
    expect(screen.getByRole("button", { name: "Play next chapter →" })).toBeInTheDocument();
    expect(screen.getByText("Plays this chapter, then stops. Tap to continue when you're ready.")).toBeInTheDocument();
  });

  it("shows last-chapter note when on the final chapter (else branch)", () => {
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
      { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/a.mp3", played: false, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
      { id: 2, title: "Other Chapter", chapterNo: 3, format: "mp3", durationSecs: 90, filePath: "/b.mp3", played: true, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
    ];
    render(<NowPlayingPanel {...props({ chapters })} />);
    expect(screen.getByText("In this work", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Ch 2 — Chapter 2/)).toBeInTheDocument();
    expect(screen.getByText(/Ch 3 — Other Chapter/)).toBeInTheDocument();
    // The current chapter (id=1, matching context.chapter.id=1) has aria-current
    const currentBtn = screen.getByRole("button", { name: /Ch 2 — Chapter 2/ });
    expect(currentBtn).toHaveAttribute("aria-current", "true");
  });

  it("shows 'Not played' visually-hidden label and state labels for chapters", () => {
    const chapters: import("../lib/api").ChapterRow[] = [
      { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/a.mp3", played: false, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
      { id: 2, title: "Other Chapter", chapterNo: 3, format: "mp3", durationSecs: 90, filePath: "/b.mp3", played: true, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
    ];
    render(<NowPlayingPanel {...props({ chapters })} />);
    // Unplayed current chapter has "Not played" SR label in the dot and "Now playing" state span
    // "Now playing" also appears as the Dialog title and panel header — 3 total
    expect(screen.getByText("Not played")).toBeInTheDocument();
    expect(screen.getAllByText("Now playing")).toHaveLength(3);
    // Played chapter has "Played" SR label in the dot AND a visible "Played" state span — both present
    expect(screen.getAllByText("Played")).toHaveLength(2);
  });

  it("clicking a chapter calls onJumpToChapter with that chapter", async () => {
    const chapters: import("../lib/api").ChapterRow[] = [
      { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/a.mp3", played: false, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
      { id: 2, title: "Other Chapter", chapterNo: 3, format: "mp3", durationSecs: 90, filePath: "/b.mp3", played: true, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
    ];
    const onJumpToChapter = vi.fn();
    render(<NowPlayingPanel {...props({ chapters, onJumpToChapter })} />);
    await userEvent.click(screen.getByRole("button", { name: /Ch 3 — Other Chapter/ }));
    expect(onJumpToChapter).toHaveBeenCalledWith(chapters[1]);
  });

  it("does not render chapter list for a single-chapter work", () => {
    const chapters: import("../lib/api").ChapterRow[] = [
      { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/a.mp3", played: false, tags: [], labels: [], userSummary: "", takeaway: "", isFavorite: false, metadata: [], playbackPositionSecs: 0, hasJournal: false },
    ];
    render(<NowPlayingPanel {...props({ chapters })} />);
    expect(screen.queryByText("In this work", { exact: false })).not.toBeInTheDocument();
  });

  // ---- journal capture controls ----

  it("renders the Capture section always", () => {
    render(<NowPlayingPanel {...props()} />);
    expect(screen.getByRole("region", { name: "Journal capture" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add note here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bookmark this moment" })).toBeInTheDocument();
  });

  it("'Add note here' fires onAddNoteHere with Math.floor(currentTime)", async () => {
    const onAddNoteHere = vi.fn();
    // currentTime is 30 in the default props — Math.floor(30) = 30
    render(<NowPlayingPanel {...props({ onAddNoteHere, currentTime: 30 })} />);
    await userEvent.click(screen.getByRole("button", { name: "Add note here" }));
    expect(onAddNoteHere).toHaveBeenCalledWith(30);
  });

  it("'Add note here' floors a fractional currentTime", async () => {
    const onAddNoteHere = vi.fn();
    render(<NowPlayingPanel {...props({ onAddNoteHere, currentTime: 45.9 })} />);
    await userEvent.click(screen.getByRole("button", { name: "Add note here" }));
    expect(onAddNoteHere).toHaveBeenCalledWith(45);
  });

  it("'Bookmark this moment' fires onAddBookmarkHere with Math.floor(currentTime)", async () => {
    const onAddBookmarkHere = vi.fn();
    render(<NowPlayingPanel {...props({ onAddBookmarkHere, currentTime: 72.7 })} />);
    await userEvent.click(screen.getByRole("button", { name: "Bookmark this moment" }));
    expect(onAddBookmarkHere).toHaveBeenCalledWith(72);
  });

  it("renders the ★ Favorite toggle with correct aria-pressed state", () => {
    const chapterWithFav = { ...context.chapter, isFavorite: false };
    render(<NowPlayingPanel {...props({ context: { ...context, chapter: chapterWithFav } })} />);
    const btn = screen.getByRole("button", { name: "Mark chapter as favorite" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("★ Favorite toggle shows 'Remove from favorites' when isFavorite is true", () => {
    const chapterFaved = { ...context.chapter, isFavorite: true };
    render(<NowPlayingPanel {...props({ context: { ...context, chapter: chapterFaved } })} />);
    expect(screen.getByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking ★ Favorite fires onToggleFavorite with the toggled value", async () => {
    const onToggleFavorite = vi.fn();
    const chapterNotFaved = { ...context.chapter, isFavorite: false };
    render(<NowPlayingPanel {...props({ context: { ...context, chapter: chapterNotFaved }, onToggleFavorite })} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark chapter as favorite" }));
    expect(onToggleFavorite).toHaveBeenCalledWith(true);
  });

  it("renders the bookmark list when chapterJournal has bookmarks", () => {
    const chapterJournal: import("../lib/api").ChapterJournal = {
      notes: [],
      bookmarks: [
        { id: 1, chapterId: 1, positionSecs: 37, label: "key idea", createdAt: 1000 },
        { id: 2, chapterId: 1, positionSecs: 90, label: "", createdAt: 2000 },
      ],
    };
    render(<NowPlayingPanel {...props({ chapterJournal })} />);
    expect(screen.getByText("key idea")).toBeInTheDocument();
    expect(screen.getByText("0:37")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    // Two Jump buttons
    expect(screen.getAllByRole("button", { name: /Jump to bookmark/ })).toHaveLength(2);
  });

  it("clicking a bookmark Jump fires onJumpToBookmark with the bookmark", async () => {
    const onJumpToBookmark = vi.fn();
    const bookmark: import("../lib/api").ChapterBookmark = { id: 5, chapterId: 1, positionSecs: 45, label: "here", createdAt: 500 };
    const chapterJournal: import("../lib/api").ChapterJournal = { notes: [], bookmarks: [bookmark] };
    render(<NowPlayingPanel {...props({ chapterJournal, onJumpToBookmark })} />);
    await userEvent.click(screen.getByRole("button", { name: /Jump to bookmark at 0:45/ }));
    expect(onJumpToBookmark).toHaveBeenCalledWith(bookmark);
  });

  it("does not render bookmark list when chapterJournal has no bookmarks", () => {
    const chapterJournal: import("../lib/api").ChapterJournal = { notes: [], bookmarks: [] };
    render(<NowPlayingPanel {...props({ chapterJournal })} />);
    expect(screen.queryByText("Bookmarks")).not.toBeInTheDocument();
  });
});
