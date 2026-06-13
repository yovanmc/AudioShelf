export interface NowPlayingMeta { title: string; author: string; work: string; artwork?: string; }
export interface MediaSessionHandlers {
  onPlay: () => void; onPause: () => void;
  onPrevChapter: () => void; onNextChapter: () => void;
  onSeekBackward: (s: number) => void; onSeekForward: (s: number) => void;
  onSeekTo: (positionSec: number) => void;
}
type MSLike = {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler: (a: string, h: ((d?: { seekOffset?: number; seekTime?: number }) => void) | null) => void;
  setPositionState?: (s: { duration: number; position: number; playbackRate: number }) => void;
};
export function buildMetadata(m: NowPlayingMeta): { title: string; artist: string; album: string; artwork: { src: string; sizes: string; type: string }[] } {
  return { title: m.title, artist: m.author, album: m.work,
    artwork: m.artwork ? [{ src: m.artwork, sizes: "512x512", type: "image/jpeg" }] : [] };
}
export function applyMediaSession(ms: MSLike | undefined, meta: NowPlayingMeta | null, isPlaying: boolean, h: MediaSessionHandlers): void {
  if (!ms) return;
  if (!meta) { ms.metadata = null; ms.playbackState = "none"; return; }
  // MediaMetadata is a global in the WebView; guard for tests where it's absent.
  const MM = (globalThis as { MediaMetadata?: new (i: unknown) => unknown }).MediaMetadata;
  ms.metadata = MM ? new MM(buildMetadata(meta)) : buildMetadata(meta);
  ms.playbackState = isPlaying ? "playing" : "paused";
  ms.setActionHandler("play", () => h.onPlay());
  ms.setActionHandler("pause", () => h.onPause());
  ms.setActionHandler("previoustrack", () => h.onPrevChapter());
  ms.setActionHandler("nexttrack", () => h.onNextChapter());
  ms.setActionHandler("seekbackward", (d) => h.onSeekBackward(d?.seekOffset ?? 15));
  ms.setActionHandler("seekforward", (d) => h.onSeekForward(d?.seekOffset ?? 15));
  ms.setActionHandler("seekto", (d) => { if (d?.seekTime != null) h.onSeekTo(d.seekTime); });
}
export function updatePosition(ms: MSLike | undefined, duration: number, position: number): void {
  if (ms?.setPositionState && duration > 0 && position <= duration && position >= 0) {
    ms.setPositionState({ duration, position, playbackRate: 1 });
  }
}
