import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NowPlayingPanel } from "./NowPlayingPanel";

const context = {
  chapter: { id: 1, title: "Chapter 2", chapterNo: 2, format: "mp3", durationSecs: 120, filePath: "/audio.mp3", played: false, tags: [] },
  authorId: 1,
  authorName: "Jane Doe",
  workId: 3,
  workTitle: "Cool Story",
  workTotalChapters: 4,
  workPlayedChapters: 2,
};

function props() {
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
});
