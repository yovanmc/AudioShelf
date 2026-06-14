import type { PlaybackContext, ChapterRow, ChapterJournal, ChapterBookmark } from "../lib/api";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { WorkArtwork } from "../components/Cover";
import { Button, Dialog, IconButton, ProgressBar, SectionHeading } from "../components/ui";
import { Icon } from "../components/Icon";
import { useState } from "react";
import { formatTime, formatSpeed, formatScrubPreview, endOfChapterPreview, nextChapterLabel, timeLabel, type TimeLabelMode, SPEEDS } from "./playback";
import { PlaybackButtons, type PlayerControls } from "./PlayerBar";
import { Select } from "../components/Select";
import type { SelectOption } from "../components/Select";

const BASE_SLEEP_OPTIONS_NP: SelectOption<string>[] = [
  { value: "", label: "Off" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "60 min" },
];

function makeSleepOptionsNP(duration: number, currentTime: number): SelectOption<string>[] {
  return [
    ...BASE_SLEEP_OPTIONS_NP,
    { value: "chapter", label: duration > 0 ? endOfChapterPreview(duration, currentTime) : "End of chapter" },
  ];
}

/** Formats integer seconds as m:ss. */
function fmtPos(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function NowPlayingPanel(props: PlayerControls & {
  context: PlaybackContext;
  onClose: () => void;
  onOpenAuthor: (authorId: number) => void;
  timeLabelMode?: TimeLabelMode;
  onCycleTimeLabel?: () => void;
  chapters?: ChapterRow[];
  onJumpToChapter?: (c: ChapterRow) => void;
  /** Plain-text transcript for the current chapter, if available. */
  transcript?: string | null;
  /** Journal data for the currently playing chapter. */
  chapterJournal?: ChapterJournal | null;
  /** Called with Math.floor(currentTime) when user clicks "Add note here". */
  onAddNoteHere?: (positionSecs: number) => void;
  /** Called with Math.floor(currentTime) when user clicks "Bookmark this moment". */
  onAddBookmarkHere?: (positionSecs: number) => void;
  /** Toggle favorite for the current chapter. */
  onToggleFavorite?: (isFavorite: boolean) => void;
  /** Jump to a bookmark (seek or load-then-seek). */
  onJumpToBookmark?: (b: ChapterBookmark) => void;
  /** Open the always-on-top mini player window. */
  onPopOut?: () => void;
  // M24 PL-1
  onSetSpeed?: (v: number) => void;
  // M24 PL-2
  onPlayNextChapter?: () => void;
  onMarkComplete?: () => void;
  canPlayNext?: boolean;
  /** Title of the next chapter, for the play-next button label (M29 PL7-7). */
  nextChapterTitle?: string;
}) {
  const { context } = props;
  const [scrubbing, setScrubbing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const progress = context.workTotalChapters > 0
    ? Math.round((context.workPlayedChapters / context.workTotalChapters) * 100)
    : 0;
  const resumeSecs = context.chapter.playbackPositionSecs ?? 0;
  return (
    <Dialog label="Now playing" title="Now playing" onClose={props.onClose}>
      <div className="now-playing__layout">
        <WorkArtwork workId={context.workId} title={context.workTitle} size={360} />
        <div>
          <div className="muted">Now playing</div>
          <button
            className="now-playing__work-link"
            onClick={() => props.onOpenAuthor(context.authorId)}
            style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}
          >
            <h1 className="now-playing__title" dir="auto">{context.workTitle}</h1>
          </button>
          <div className="now-playing__creator">
            <CreatorIdentity authorId={context.authorId} authorName={context.authorName} size={44} onOpen={() => props.onOpenAuthor(context.authorId)} />
          </div>
          <p><span dir="auto">{context.chapter.title}</span> · Chapter {context.chapter.chapterNo}</p>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Chapter {context.chapter.chapterNo} of {context.workTotalChapters}
          </p>
          <ProgressBar value={progress} label="Work progress" />
          <PlaybackButtons {...props} />
          {props.onPopOut && (
            <div style={{ marginTop: "var(--space-2)" }}>
              <Button variant="secondary" onClick={props.onPopOut}>Pop out mini player</Button>
            </div>
          )}
          <div style={{ marginTop: "var(--space-2)" }}>
            <IconButton icon="keyboard" label="Keyboard shortcuts" onClick={() => setShowShortcuts(true)} />
          </div>
          {showShortcuts && (
            <Dialog label="Keyboard shortcuts" title="Keyboard shortcuts" context="Works when the player is focused and you're not typing in a field." onClose={() => setShowShortcuts(false)}>
              <ul className="shortcut-list">
                <li><kbd>Space</kbd><span>Play / pause</span></li>
                <li><kbd>←</kbd> <kbd>→</kbd><span>Skip back / forward</span></li>
                <li><kbd>Ctrl</kbd> <kbd>K</kbd><span>Command palette</span></li>
              </ul>
            </Dialog>
          )}
          <div className="player-bar__seek">
            <button type="button" className="time-label" title="Toggle time display" onClick={props.onCycleTimeLabel}>
              {timeLabel(props.timeLabelMode ?? "elapsed", props.currentTime, props.duration)}
            </button>
            <div className="seek-wrap">
              <input
                className="seek-range" type="range" aria-label="Seek"
                min={0} max={props.duration || 0}
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
          {props.onSetSpeed && (
            <div className="np-row" role="group" aria-label="Playback speed">
              <span className="np-row__label">Speed</span>
              <div className="speed-seg">
                {SPEEDS.map((s) => (
                  <button key={s} type="button"
                    className={`speed-seg__btn${(props.playbackSpeed ?? 1) === s ? " speed-seg__btn--active" : ""}`}
                    aria-pressed={(props.playbackSpeed ?? 1) === s}
                    onClick={() => props.onSetSpeed?.(s)}>{formatSpeed(s)}</button>
                ))}
              </div>
            </div>
          )}
          <div className="np-row">
            <span className="np-row__label">Volume</span>
            {props.onToggleMute && (
              <IconButton icon={props.muted ? "mute" : "volume"} label={props.muted ? "Unmute" : "Mute"} onClick={props.onToggleMute} />
            )}
            <input type="range" aria-label="Volume" min={0} max={1} step={.01} value={props.muted ? 0 : props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} />
          </div>
          <div className="np-row">
            <span className="np-row__label">Sleep</span>
            <Select<string>
              label="Sleep timer"
              value={props.sleepAtChapterEnd ? "chapter" : (props.sleepMinutes != null ? String(props.sleepMinutes) : "")}
              options={makeSleepOptionsNP(props.duration, props.currentTime)}
              onChange={(v) => {
                if (v === "chapter") props.onSetSleep(null, true);
                else props.onSetSleep(v ? Number(v) : null, false);
              }}
            />
            {(props.sleepRemaining != null || props.sleepAtChapterEnd) && (
              <span
                className={`sleep-countdown muted${(props.sleepRemaining != null && props.sleepRemaining <= 60) ? " sleep-countdown--soon" : ""}`}
                aria-live="polite"
              >
                {props.sleepAtChapterEnd ? "until end of chapter" : formatTime(props.sleepRemaining ?? 0)}
              </span>
            )}
          </div>
          <div className="np-endactions" key={props.canPlayNext ? "next" : "last"}>
            {props.canPlayNext && props.onPlayNextChapter ? (
              <>
                <Button variant="primary" onClick={props.onPlayNextChapter}>{nextChapterLabel(props.nextChapterTitle)} →</Button>
                <p className="muted np-endactions__note">Plays this chapter, then stops. Tap to continue when you're ready.</p>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={props.onMarkComplete}>Mark work complete</Button>
                <Button variant="secondary" onClick={() => props.onOpenAuthor(context.authorId)}>More by {context.authorName}</Button>
                <p className="muted np-endactions__note">Last chapter — playback stops at the end.</p>
              </>
            )}
          </div>
          {props.chapters && props.chapters.length > 1 && (
            <section className="now-playing__chapters">
              <SectionHeading title="In this work" />
              <ul className="chapter-jump-list">
                {props.chapters.map((c) => {
                  const isCurrent = c.id === props.context.chapter.id;
                  return (
                    <li key={c.id} className="now-playing__list-row">
                      <button type="button"
                        className={`chapter-jump${isCurrent ? " chapter-jump--current" : ""}`}
                        aria-current={isCurrent ? "true" : undefined}
                        onClick={() => props.onJumpToChapter?.(c)}>
                        <span className={`chapter-jump__dot${c.played ? " chapter-jump__dot--played" : ""}`}>
                          <Icon name={c.played ? "check" : "circle"} className="chapter-jump__dot-icon" />
                          <span className="visually-hidden">{c.played ? "Played" : "Not played"}</span>
                        </span>
                        <span className="chapter-jump__title" dir="auto">Ch {c.chapterNo} — {c.title}</span>
                        {isCurrent
                          ? <span className="chapter-jump__state chapter-jump__state--current">Now playing</span>
                          : c.played
                            ? <span className="chapter-jump__state muted" aria-hidden="true">Played</span>
                            : <span className="chapter-jump__state chapter-jump__state--new">New</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {/* Journal capture controls */}
          <section className="now-playing__journal-capture" aria-label="Journal capture">
            <SectionHeading title="Notes & bookmarks" />
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center", marginBottom: "var(--space-2)" }}>
              <Button
                variant="secondary"
                onClick={() => props.onAddNoteHere?.(Math.floor(props.currentTime))}
              >
                Add note here
              </Button>
              <Button
                variant="secondary"
                onClick={() => props.onAddBookmarkHere?.(Math.floor(props.currentTime))}
              >
                Bookmark this moment
              </Button>
              <button
                type="button"
                className={`chip chip--toggle${props.context.chapter.isFavorite ? " chip--on" : ""}`}
                aria-pressed={props.context.chapter.isFavorite}
                aria-label={props.context.chapter.isFavorite ? "Remove from favorites" : "Mark chapter as favorite"}
                onClick={() => props.onToggleFavorite?.(!props.context.chapter.isFavorite)}
                style={{ fontSize: "1.1rem" }}
              >
                ★ Favorite
              </button>
            </div>

            {/* Bookmark list */}
            {props.chapterJournal && props.chapterJournal.bookmarks.length > 0 && (
              <div>
                <div className="muted" style={{ fontSize: "0.82rem", marginBottom: "var(--space-1)" }}>Bookmarks</div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                  {props.chapterJournal.bookmarks.map((bm: ChapterBookmark) => (
                    <li key={bm.id} className="now-playing__list-row" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      <span className="muted" style={{ minWidth: 36, fontSize: "0.85rem" }}>{fmtPos(bm.positionSecs)}</span>
                      <span style={{ flex: 1, fontSize: "0.88rem" }}>{bm.label || <em className="muted">—</em>}</span>
                      <Button
                        variant="ghost"
                        aria-label={`Jump to bookmark at ${fmtPos(bm.positionSecs)}`}
                        onClick={() => props.onJumpToBookmark?.(bm)}
                      >
                        Jump
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {props.transcript && (
            <section className="now-playing__transcript" aria-label="Transcript">
              <SectionHeading title="Transcript" />
              <div
                className="muted"
                style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap", maxHeight: "200px", overflowY: "auto" }}
              >
                {props.transcript}
              </div>
            </section>
          )}
        </div>
      </div>
    </Dialog>
  );
}
