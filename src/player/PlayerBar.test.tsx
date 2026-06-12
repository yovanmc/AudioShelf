import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerBar } from "./PlayerBar";

const context = {
  chapter: {
    id: 1,
    title: "Chapter 2",
    chapterNo: 2,
    format: "mp3",
    durationSecs: 120,
    filePath: "/audio.mp3",
    played: false,
    tags: [],
  },
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
    sleepMinutes: null as number | null,
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onSkip: vi.fn(),
    onVolume: vi.fn(),
    onSetSleep: vi.fn(),
    onExpand: vi.fn(),
    onOpenAuthor: vi.fn(),
    ...overrides,
  };
}

describe("PlayerBar", () => {
  it("renders nothing when no chapter is loaded", () => {
    const { container } = render(<PlayerBar {...props({ context: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the title and current/total time", () => {
    render(<PlayerBar {...props()} />);
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Chapter 2")).toBeInTheDocument();
    expect(screen.getByText("0:30")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("opens the expanded player", async () => {
    const p = props();
    render(<PlayerBar {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand now playing" }));
    expect(p.onExpand).toHaveBeenCalled();
  });

  it("toggles play/pause", async () => {
    const p = props();
    render(<PlayerBar {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(p.onToggle).toHaveBeenCalled();
  });

  it("emits the four skip deltas", async () => {
    const p = props();
    render(<PlayerBar {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Back 30 seconds" }));
    await userEvent.click(screen.getByRole("button", { name: "Back 15 seconds" }));
    await userEvent.click(screen.getByRole("button", { name: "Forward 15 seconds" }));
    await userEvent.click(screen.getByRole("button", { name: "Forward 30 seconds" }));
    expect(p.onSkip.mock.calls.map((c) => c[0])).toEqual([-30, -15, 15, 30]);
  });

  it("sets a sleep timer from the selector", async () => {
    const p = props();
    render(<PlayerBar {...p} />);
    await userEvent.selectOptions(screen.getByLabelText("Sleep timer"), "30");
    expect(p.onSetSleep).toHaveBeenCalledWith(30);
  });
});
