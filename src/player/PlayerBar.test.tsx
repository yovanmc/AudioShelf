import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerBar } from "./PlayerBar";

function props(overrides = {}) {
  return {
    title: "Cool Story",
    hasChapter: true,
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
    ...overrides,
  };
}

describe("PlayerBar", () => {
  it("renders nothing when no chapter is loaded", () => {
    const { container } = render(<PlayerBar {...props({ hasChapter: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the title and current/total time", () => {
    render(<PlayerBar {...props()} />);
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    expect(screen.getByText("0:30 / 2:00")).toBeInTheDocument();
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
