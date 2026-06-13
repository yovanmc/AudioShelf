import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { IconButton } from "../components/ui";

// ---- Types ----------------------------------------------------------------

type MiniState = {
  title: string;
  author: string;
  artworkUrl?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
} | null;

// ---- Pure presentational component ----------------------------------------

interface MiniPlayerProps {
  title: string;
  author: string;
  artworkUrl?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function MiniPlayer({
  title,
  author,
  artworkUrl,
  isPlaying,
  position,
  duration,
  onToggle,
  onPrev,
  onNext,
}: MiniPlayerProps) {
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div className="mini-player">
      {/* Cover art / placeholder */}
      <div className="mini-player__art">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">♪</span>
        )}
      </div>

      {/* Meta + progress */}
      <div className="mini-player__meta">
        <div className="mini-player__title" dir="auto" title={title}>{title}</div>
        <div className="mini-player__author" title={author}>{author}</div>
        <div className="mini-player__progress" role="progressbar" aria-label="Playback progress"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className="mini-player__progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Controls */}
      <div className="mini-player__controls">
        <IconButton icon="chevronLeft" label="Previous chapter" onClick={onPrev} />
        <IconButton icon={isPlaying ? "pause" : "play"} label={isPlaying ? "Pause" : "Play"} onClick={onToggle} />
        <IconButton icon="chevronRight" label="Next chapter" onClick={onNext} />
      </div>
    </div>
  );
}

// ---- Remote container (mounted in the mini-player window) -----------------

export function MiniPlayerRemote() {
  const [state, setState] = useState<MiniState>(null);

  useEffect(() => {
    const unlistenPromise = listen<MiniState>("playback:state", (e) => {
      setState(e.payload);
    });
    return () => {
      void unlistenPromise.then((f) => f());
    };
  }, []);

  function sendCommand(action: "toggle" | "prev" | "next") {
    void emit("miniplayer:command", { action });
  }

  if (!state) {
    return <div className="mini-player__empty">Nothing playing</div>;
  }

  return (
    <MiniPlayer
      title={state.title}
      author={state.author}
      artworkUrl={state.artworkUrl}
      isPlaying={state.isPlaying}
      position={state.position}
      duration={state.duration}
      onToggle={() => sendCommand("toggle")}
      onPrev={() => sendCommand("prev")}
      onNext={() => sendCommand("next")}
    />
  );
}
