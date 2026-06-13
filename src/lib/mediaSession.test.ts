import { describe, it, expect, vi } from "vitest";
import { applyMediaSession, updatePosition, buildMetadata, type NowPlayingMeta, type MediaSessionHandlers } from "./mediaSession";

// A minimal MSLike mock that records setActionHandler calls.
function makeMock() {
  const handlers: Record<string, ((d?: { seekOffset?: number; seekTime?: number }) => void) | null> = {};
  const ms = {
    metadata: undefined as unknown,
    playbackState: "none" as "none" | "paused" | "playing",
    setActionHandler: vi.fn((action: string, handler: ((d?: { seekOffset?: number; seekTime?: number }) => void) | null) => {
      handlers[action] = handler;
    }),
    setPositionState: vi.fn(),
    _handlers: handlers,
  };
  return ms;
}

const meta: NowPlayingMeta = { title: "Chapter One", author: "Jane Doe", work: "Cool Story" };
const metaWithArt: NowPlayingMeta = { ...meta, artwork: "http://example.com/cover.jpg" };

function makeHandlers(): { calls: Record<string, unknown[]>; h: MediaSessionHandlers } {
  const calls: Record<string, unknown[]> = {};
  const h: MediaSessionHandlers = {
    onPlay: vi.fn(() => { calls["onPlay"] = []; }),
    onPause: vi.fn(() => { calls["onPause"] = []; }),
    onPrevChapter: vi.fn(() => { calls["onPrevChapter"] = []; }),
    onNextChapter: vi.fn(() => { calls["onNextChapter"] = []; }),
    onSeekBackward: vi.fn((s: number) => { calls["onSeekBackward"] = [s]; }),
    onSeekForward: vi.fn((s: number) => { calls["onSeekForward"] = [s]; }),
    onSeekTo: vi.fn((pos: number) => { calls["onSeekTo"] = [pos]; }),
  };
  return { calls, h };
}

describe("buildMetadata", () => {
  it("maps title/author/work to title/artist/album with no artwork", () => {
    const result = buildMetadata(meta);
    expect(result.title).toBe("Chapter One");
    expect(result.artist).toBe("Jane Doe");
    expect(result.album).toBe("Cool Story");
    expect(result.artwork).toEqual([]);
  });

  it("includes artwork entry when artwork url is provided", () => {
    const result = buildMetadata(metaWithArt);
    expect(result.artwork).toEqual([{ src: "http://example.com/cover.jpg", sizes: "512x512", type: "image/jpeg" }]);
  });
});

describe("applyMediaSession", () => {
  it("is a safe no-op when ms is undefined", () => {
    const { h } = makeHandlers();
    // Should not throw.
    expect(() => applyMediaSession(undefined, meta, true, h)).not.toThrow();
  });

  it("sets metadata to null and playbackState to 'none' when meta is null", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, null, true, h);
    expect(ms.metadata).toBeNull();
    expect(ms.playbackState).toBe("none");
  });

  it("does not register action handlers when meta is null", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, null, false, h);
    expect(ms.setActionHandler).not.toHaveBeenCalled();
  });

  it("sets metadata (truthy) and playbackState='playing' when isPlaying=true", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    expect(ms.metadata).toBeTruthy();
    expect(ms.playbackState).toBe("playing");
  });

  it("sets metadata (truthy) and playbackState='paused' when isPlaying=false", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, false, h);
    expect(ms.metadata).toBeTruthy();
    expect(ms.playbackState).toBe("paused");
  });

  it("registers all seven action handlers", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    expect(ms.setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
    expect(ms.setActionHandler).toHaveBeenCalledWith("pause", expect.any(Function));
    expect(ms.setActionHandler).toHaveBeenCalledWith("previoustrack", expect.any(Function));
    expect(ms.setActionHandler).toHaveBeenCalledWith("nexttrack", expect.any(Function));
    expect(ms.setActionHandler).toHaveBeenCalledWith("seekbackward", expect.any(Function));
    expect(ms.setActionHandler).toHaveBeenCalledWith("seekforward", expect.any(Function));
    expect(ms.setActionHandler).toHaveBeenCalledWith("seekto", expect.any(Function));
  });

  it("play handler calls onPlay", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["play"]?.();
    expect(h.onPlay).toHaveBeenCalledTimes(1);
  });

  it("pause handler calls onPause", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["pause"]?.();
    expect(h.onPause).toHaveBeenCalledTimes(1);
  });

  it("previoustrack handler calls onPrevChapter", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["previoustrack"]?.();
    expect(h.onPrevChapter).toHaveBeenCalledTimes(1);
  });

  it("nexttrack handler calls onNextChapter", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["nexttrack"]?.();
    expect(h.onNextChapter).toHaveBeenCalledTimes(1);
  });

  it("seekbackward handler with seekOffset calls onSeekBackward(30)", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["seekbackward"]?.({ seekOffset: 30 });
    expect(h.onSeekBackward).toHaveBeenCalledWith(30);
  });

  it("seekbackward handler with no arg defaults to onSeekBackward(15)", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["seekbackward"]?.();
    expect(h.onSeekBackward).toHaveBeenCalledWith(15);
  });

  it("seekforward handler with seekOffset calls onSeekForward(30)", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["seekforward"]?.({ seekOffset: 30 });
    expect(h.onSeekForward).toHaveBeenCalledWith(30);
  });

  it("seekforward handler with no arg defaults to onSeekForward(15)", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["seekforward"]?.();
    expect(h.onSeekForward).toHaveBeenCalledWith(15);
  });

  it("seekto handler with seekTime calls onSeekTo(42)", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["seekto"]?.({ seekTime: 42 });
    expect(h.onSeekTo).toHaveBeenCalledWith(42);
  });

  it("seekto handler with no seekTime does NOT call onSeekTo", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    ms._handlers["seekto"]?.({});
    expect(h.onSeekTo).not.toHaveBeenCalled();
  });

  it("uses buildMetadata result as metadata when MediaMetadata is absent", () => {
    const ms = makeMock();
    const { h } = makeHandlers();
    applyMediaSession(ms, meta, true, h);
    // In the test environment there is no MediaMetadata global — metadata is the plain object.
    expect(ms.metadata).toEqual(buildMetadata(meta));
  });
});

describe("updatePosition", () => {
  it("calls setPositionState for valid duration/position", () => {
    const ms = makeMock();
    updatePosition(ms, 3600, 120);
    expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 3600, position: 120, playbackRate: 1 });
  });

  it("is a no-op when duration <= 0", () => {
    const ms = makeMock();
    updatePosition(ms, 0, 0);
    expect(ms.setPositionState).not.toHaveBeenCalled();
    updatePosition(ms, -1, 0);
    expect(ms.setPositionState).not.toHaveBeenCalled();
  });

  it("is a no-op when position > duration", () => {
    const ms = makeMock();
    updatePosition(ms, 100, 101);
    expect(ms.setPositionState).not.toHaveBeenCalled();
  });

  it("is a no-op when position < 0", () => {
    const ms = makeMock();
    updatePosition(ms, 100, -1);
    expect(ms.setPositionState).not.toHaveBeenCalled();
  });

  it("is a no-op when setPositionState is absent", () => {
    const ms = { ...makeMock(), setPositionState: undefined };
    // Should not throw.
    expect(() => updatePosition(ms, 100, 50)).not.toThrow();
  });

  it("is a no-op when ms is undefined", () => {
    expect(() => updatePosition(undefined, 100, 50)).not.toThrow();
  });

  it("accepts position === 0 (valid)", () => {
    const ms = makeMock();
    updatePosition(ms, 100, 0);
    expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 100, position: 0, playbackRate: 1 });
  });

  it("accepts position === duration (valid)", () => {
    const ms = makeMock();
    updatePosition(ms, 100, 100);
    expect(ms.setPositionState).toHaveBeenCalledWith({ duration: 100, position: 100, playbackRate: 1 });
  });
});
