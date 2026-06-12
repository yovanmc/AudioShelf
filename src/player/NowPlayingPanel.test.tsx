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

  it("opens the creator and exposes playback controls", async () => {
    const p = props();
    render(<NowPlayingPanel {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Jane Doe" }));
    expect(p.onOpenAuthor).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText("Seek")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
    expect(screen.getByLabelText("Sleep timer")).toBeInTheDocument();
  });
});
