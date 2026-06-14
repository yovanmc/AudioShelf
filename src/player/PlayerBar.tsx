import type { PlaybackContext } from "../lib/api";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { WorkArtwork } from "../components/Cover";
import { IconButton } from "../components/ui";
import { formatTime, formatSpeed, timeLabel, type TimeLabelMode, SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE } from "./playback";

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
  onSetSleep: (minutes: number | null, atChapterEnd?: boolean) => void;
  // M24 additions
  playbackSpeed?: number;
  muted?: boolean;
  onToggleMute?: () => void;
  sleepRemaining?: number | null;
  sleepAtChapterEnd?: boolean;
}

export interface PlayerBarProps extends PlayerControls {
  context: PlaybackContext | null;
  onExpand: () => void;
  onOpenAuthor: (authorId: number) => void;
  timeLabelMode?: TimeLabelMode;
  onCycleTimeLabel?: () => void;
  onCycleSpeed?: () => void;     // M24 (PL-1)
  onOpenChapters?: () => void;   // M24 (PL-6)
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
    <div className="player-bar" role="region" aria-label="Audio player">
      <div className="player-bar__track">
        <WorkArtwork workId={context.workId} title={context.workTitle} size={58} />
        <div role="region" aria-label="Now playing" aria-live="polite">
          <CreatorIdentity authorId={context.authorId} authorName={context.authorName} size={26} onOpen={() => props.onOpenAuthor(context.authorId)} />
          <div><strong dir="auto">{context.workTitle}</strong></div>
          <div className="muted"><span dir="auto">{context.chapter.title}</span> · <span className="player-bar__chapter-pos">Chapter {context.chapter.chapterNo} of {context.workTotalChapters}</span></div>
        </div>
      </div>
      <div>
        <PlaybackButtons {...props} />
        <div className="player-bar__seek">
          <button type="button" className="time-label" title="Toggle time display" onClick={props.onCycleTimeLabel}>
            {timeLabel(props.timeLabelMode ?? "elapsed", props.currentTime, props.duration)}
          </button>
          <input className="seek-range" type="range" aria-label="Seek" min={0} max={props.duration > 0 ? props.duration : 0} value={Math.min(props.currentTime, props.duration)} onChange={(event) => props.onSeek(Number(event.target.value))} />
          <span>{formatTime(props.duration)}</span>
        </div>
      </div>
      <div className="player-bar__utility">
        {props.onCycleSpeed && (
          <button type="button" className="speed-btn" title="Playback speed" aria-label={`Playback speed ${formatSpeed(props.playbackSpeed ?? 1)}`} onClick={props.onCycleSpeed}>
            {formatSpeed(props.playbackSpeed ?? 1)}
          </button>
        )}
        {props.onToggleMute && (
          <IconButton icon={props.muted ? "mute" : "volume"} label={props.muted ? "Unmute" : "Mute"} onClick={props.onToggleMute} />
        )}
        <input className="volume-range" type="range" aria-label="Volume" min={0} max={1} step={.01} value={props.muted ? 0 : props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} />
        <select aria-label="Sleep timer" value={props.sleepAtChapterEnd ? "chapter" : (props.sleepMinutes ?? "")} onChange={(event) => {
          const v = event.target.value;
          if (v === "chapter") props.onSetSleep(null, true);
          else props.onSetSleep(v ? Number(v) : null, false);
        }}>
          <option value="">Sleep off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option><option value="chapter">End of chapter</option>
        </select>
        {(props.sleepRemaining != null || props.sleepAtChapterEnd) && (
          <span className="sleep-countdown muted" aria-live="polite">{props.sleepAtChapterEnd ? "until end" : formatTime(props.sleepRemaining ?? 0)}</span>
        )}
        {props.onOpenChapters && (
          <IconButton icon="list" label="Chapters" onClick={props.onOpenChapters} />
        )}
        <IconButton icon="expand" label="Expand now playing" onClick={props.onExpand} />
      </div>
    </div>
  );
}
