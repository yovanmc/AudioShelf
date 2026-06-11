import { formatTime, SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE } from "./playback";

export interface PlayerBarProps {
  title: string;
  hasChapter: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  sleepMinutes: number | null;
  onToggle: () => void;
  onSeek: (secs: number) => void;
  onSkip: (delta: number) => void;
  onVolume: (v: number) => void;
  onSetSleep: (minutes: number | null) => void;
}

export function PlayerBar(props: PlayerBarProps) {
  if (!props.hasChapter) return null;
  const { currentTime, duration } = props;
  return (
    <div className="player-bar">
      <span className="player-title">{props.title}</span>
      <div className="player-controls">
        <button aria-label="Back 30 seconds" onClick={() => props.onSkip(SKIP_BACK_LARGE)}>«30</button>
        <button aria-label="Back 15 seconds" onClick={() => props.onSkip(SKIP_BACK_SMALL)}>«15</button>
        <button aria-label={props.isPlaying ? "Pause" : "Play"} onClick={props.onToggle}>
          {props.isPlaying ? "❚❚" : "▶"}
        </button>
        <button aria-label="Forward 15 seconds" onClick={() => props.onSkip(SKIP_FWD_SMALL)}>15»</button>
        <button aria-label="Forward 30 seconds" onClick={() => props.onSkip(SKIP_FWD_LARGE)}>30»</button>
      </div>
      <input
        className="player-seek"
        type="range"
        aria-label="Seek"
        min={0}
        max={duration > 0 ? duration : 0}
        value={currentTime > duration ? duration : currentTime}
        onChange={(e) => props.onSeek(Number(e.target.value))}
      />
      <span className="player-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
      <input
        className="player-volume"
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={props.volume}
        onChange={(e) => props.onVolume(Number(e.target.value))}
      />
      <label className="player-sleep">
        Sleep
        <select
          aria-label="Sleep timer"
          value={props.sleepMinutes ?? ""}
          onChange={(e) => props.onSetSleep(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Off</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">60 min</option>
        </select>
      </label>
    </div>
  );
}
