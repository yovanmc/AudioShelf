import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { emit as mockEmit, listen as mockListen } from "@tauri-apps/api/event";
import { MiniPlayer, MiniPlayerRemote } from "./MiniPlayer";

// ---- Mock @tauri-apps/api/event ----

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// ---- MiniPlayer (pure presentational) ----

function baseProps(overrides = {}) {
  return {
    title: "Chapter One",
    author: "Jane Doe",
    isPlaying: false,
    position: 30,
    duration: 120,
    onToggle: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
}

describe("MiniPlayer", () => {
  it("renders title and author", () => {
    render(<MiniPlayer {...baseProps()} />);
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("shows Play button when not playing", () => {
    render(<MiniPlayer {...baseProps({ isPlaying: false })} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("shows Pause button when playing", () => {
    render(<MiniPlayer {...baseProps({ isPlaying: true })} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
  });

  it("calls onToggle when play/pause button is clicked", async () => {
    const p = baseProps();
    render(<MiniPlayer {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(p.onToggle).toHaveBeenCalled();
  });

  it("calls onPrev when previous button is clicked", async () => {
    const p = baseProps();
    render(<MiniPlayer {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Previous chapter" }));
    expect(p.onPrev).toHaveBeenCalled();
  });

  it("calls onNext when next button is clicked", async () => {
    const p = baseProps();
    render(<MiniPlayer {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(p.onNext).toHaveBeenCalled();
  });

  it("renders a placeholder when artworkUrl is absent", () => {
    render(<MiniPlayer {...baseProps()} />);
    // The ♪ placeholder span is present
    expect(screen.getByText("♪")).toBeInTheDocument();
  });

  it("renders an img element when artworkUrl is provided", () => {
    const { container } = render(<MiniPlayer {...baseProps({ artworkUrl: "http://example.com/cover.jpg" })} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.src).toContain("example.com/cover.jpg");
  });
});

// ---- MiniPlayerRemote (container) ----

describe("MiniPlayerRemote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: listen returns a cleanup fn; capture the callback so we can drive it.
    (mockListen as ReturnType<typeof vi.fn>).mockResolvedValue(() => {});
  });

  it("shows 'Nothing playing' when no state has arrived", () => {
    render(<MiniPlayerRemote />);
    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
  });

  it("renders track info after receiving a playback:state event", async () => {
    let capturedCallback: ((e: { payload: unknown }) => void) | null = null;
    (mockListen as ReturnType<typeof vi.fn>).mockImplementation(
      (_event: string, cb: (e: { payload: unknown }) => void) => {
        capturedCallback = cb;
        return Promise.resolve(() => {});
      },
    );

    render(<MiniPlayerRemote />);

    // Drive the listener callback with a state payload.
    await act(async () => {
      capturedCallback?.({
        payload: {
          title: "Chapter Two",
          author: "John Smith",
          isPlaying: true,
          position: 60,
          duration: 200,
        },
      });
    });

    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("emits toggle command when toggle button is clicked", async () => {
    let capturedCallback: ((e: { payload: unknown }) => void) | null = null;
    (mockListen as ReturnType<typeof vi.fn>).mockImplementation(
      (_event: string, cb: (e: { payload: unknown }) => void) => {
        capturedCallback = cb;
        return Promise.resolve(() => {});
      },
    );

    render(<MiniPlayerRemote />);

    await act(async () => {
      capturedCallback?.({
        payload: { title: "Ch", author: "A", isPlaying: false, position: 0, duration: 100 },
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(mockEmit).toHaveBeenCalledWith("miniplayer:command", { action: "toggle" });
  });

  it("emits prev command when previous button is clicked", async () => {
    let capturedCallback: ((e: { payload: unknown }) => void) | null = null;
    (mockListen as ReturnType<typeof vi.fn>).mockImplementation(
      (_event: string, cb: (e: { payload: unknown }) => void) => {
        capturedCallback = cb;
        return Promise.resolve(() => {});
      },
    );

    render(<MiniPlayerRemote />);

    await act(async () => {
      capturedCallback?.({
        payload: { title: "Ch", author: "A", isPlaying: false, position: 0, duration: 100 },
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "Previous chapter" }));
    expect(mockEmit).toHaveBeenCalledWith("miniplayer:command", { action: "prev" });
  });

  it("emits next command when next button is clicked", async () => {
    let capturedCallback: ((e: { payload: unknown }) => void) | null = null;
    (mockListen as ReturnType<typeof vi.fn>).mockImplementation(
      (_event: string, cb: (e: { payload: unknown }) => void) => {
        capturedCallback = cb;
        return Promise.resolve(() => {});
      },
    );

    render(<MiniPlayerRemote />);

    await act(async () => {
      capturedCallback?.({
        payload: { title: "Ch", author: "A", isPlaying: false, position: 0, duration: 100 },
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(mockEmit).toHaveBeenCalledWith("miniplayer:command", { action: "next" });
  });
});
