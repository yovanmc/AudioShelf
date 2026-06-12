import type { PlaybackContext } from "../lib/api";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { WorkArtwork } from "../components/Cover";
import { IconButton } from "../components/ui";
import { formatTime, SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE } from "./playback";

export interface PlayerControls {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  sleepMinutes: number | null;
  onToggle: () => void;
  onSeek: (secs: number) => void;
  onSkip: (delta: number) => void;
  onVolume: (value: number) => void;
  onSetSleep: (minutes: number | null) => void;
}

export interface PlayerBarProps extends PlayerControls {
  context: PlaybackContext | null;
  onExpand: () => void;
  onOpenAuthor: (authorId: number) => void;
}

export function PlaybackButtons(props: Pick<PlayerControls, "isPlaying" | "onToggle" | "onSkip">) {
  return (
    <div className="player-bar__controls">
      <IconButton icon="back30" label="Back 30 seconds" onClick={() => props.onSkip(SKIP_BACK_LARGE)} />
      <IconButton icon="back15" label="Back 15 seconds" onClick={() => props.onSkip(SKIP_BACK_SMALL)} />
      <IconButton icon={props.isPlaying ? "pause" : "play"} label={props.isPlaying ? "Pause" : "Play"} onClick={props.onToggle} />
      <IconButton icon="forward15" label="Forward 15 seconds" onClick={() => props.onSkip(SKIP_FWD_SMALL)} />
      <IconButton icon="forward30" label="Forward 30 seconds" onClick={() => props.onSkip(SKIP_FWD_LARGE)} />
    </div>
  );
}

export function PlayerBar(props: PlayerBarProps) {
  const context = props.context;
  if (!context) return null;
  return (
    <div className="player-bar">
      <div className="player-bar__track">
        <WorkArtwork workId={context.workId} title={context.workTitle} size={58} />
        <div>
          <CreatorIdentity authorId={context.authorId} authorName={context.authorName} size={26} onOpen={() => props.onOpenAuthor(context.authorId)} />
          <div><strong>{context.workTitle}</strong></div>
          <div className="muted">{context.chapter.title}</div>
        </div>
      </div>
      <div>
        <PlaybackButtons {...props} />
        <div className="player-bar__seek">
          <span>{formatTime(props.currentTime)}</span>
          <input type="range" aria-label="Seek" min={0} max={props.duration > 0 ? props.duration : 0} value={Math.min(props.currentTime, props.duration)} onChange={(event) => props.onSeek(Number(event.target.value))} />
          <span>{formatTime(props.duration)}</span>
        </div>
      </div>
      <div className="player-bar__utility">
        <input type="range" aria-label="Volume" min={0} max={1} step={.01} value={props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} />
        <select aria-label="Sleep timer" value={props.sleepMinutes ?? ""} onChange={(event) => props.onSetSleep(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Sleep off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option>
        </select>
        <IconButton icon="expand" label="Expand now playing" onClick={props.onExpand} />
      </div>
    </div>
  );
}
