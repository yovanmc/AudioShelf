import { useState } from "react";
import type { PlaybackContext } from "../lib/api";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { WorkArtwork } from "../components/Cover";
import { IconButton } from "../components/ui";
import { formatTime, formatSpeed, formatScrubPreview, timeLabel, type TimeLabelMode, SKIP_BACK_LARGE, SKIP_BACK_SMALL, SKIP_FWD_SMALL, SKIP_FWD_LARGE } from "./playback";
import { Select } from "../components/Select";
import type { SelectOption } from "../components/Select";

const SLEEP_OPTIONS: SelectOption<string>[] = [
  { value: "", label: "Sleep off" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "60 min" },
  { value: "chapter", label: "End of chapter" },
];

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
  const [scrubbing, setScrubbing] = useState(false);
  if (!context) return null;
  const resumeSecs = context.chapter.playbackPositionSecs ?? 0;
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
          <div className="seek-wrap">
            <input
              className="seek-range" type="range" aria-label="Seek"
              min={0} max={props.duration > 0 ? props.duration : 0}
              value={Math.min(props.currentTime, props.duration)}
              onChange={(event) => props.onSeek(Number(event.target.value))}
              onPointerDown={() => setScrubbing(true)}
              onPointerUp={() => setScrubbing(false)}
            />
            {props.duration > 0 && resumeSecs > 0 && resumeSecs < props.duration && (
              <span className="seek-cue seek-cue--resume" style={{ left: `${(resumeSecs / props.duration) * 100}%` }} title="Resume point" />
            )}
            {scrubbing && (
              <span className="seek-bubble" style={{ left: `${props.duration ? (Math.min(props.currentTime, props.duration) / props.duration) * 100 : 0}%` }}>
                {formatScrubPreview(props.currentTime, props.duration)}
              </span>
            )}
          </div>
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
        <Select<string>
          label="Sleep timer"
          value={props.sleepAtChapterEnd ? "chapter" : (props.sleepMinutes != null ? String(props.sleepMinutes) : "")}
          options={SLEEP_OPTIONS}
          onChange={(v) => {
            if (v === "chapter") props.onSetSleep(null, true);
            else props.onSetSleep(v ? Number(v) : null, false);
          }}
        />
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
