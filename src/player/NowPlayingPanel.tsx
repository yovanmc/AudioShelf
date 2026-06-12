import type { PlaybackContext } from "../lib/api";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { WorkArtwork } from "../components/Cover";
import { Dialog, ProgressBar } from "../components/ui";
import { formatTime } from "./playback";
import { PlaybackButtons, type PlayerControls } from "./PlayerBar";

export function NowPlayingPanel(props: PlayerControls & {
  context: PlaybackContext;
  onClose: () => void;
  onOpenAuthor: (authorId: number) => void;
}) {
  const { context } = props;
  const progress = context.workTotalChapters > 0
    ? Math.round((context.workPlayedChapters / context.workTotalChapters) * 100)
    : 0;
  const isLastChapter = context.chapter.chapterNo >= context.workTotalChapters;
  const stopNote = isLastChapter
    ? "Last chapter — playback stops at the end."
    : "Plays this chapter, then stops.";

  return (
    <Dialog label="Now playing" onClose={props.onClose}>
      <div className="now-playing__layout">
        <WorkArtwork workId={context.workId} title={context.workTitle} size={360} />
        <div>
          <div className="muted">Now playing</div>
          <button
            className="now-playing__work-link"
            onClick={() => props.onOpenAuthor(context.authorId)}
            style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}
          >
            <h1 style={{ margin: 0 }}>{context.workTitle}</h1>
          </button>
          <CreatorIdentity authorId={context.authorId} authorName={context.authorName} size={44} onOpen={() => props.onOpenAuthor(context.authorId)} />
          <p>{context.chapter.title} · Chapter {context.chapter.chapterNo}</p>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Chapter {context.chapter.chapterNo} of {context.workTotalChapters}
          </p>
          <ProgressBar value={progress} label="Work progress" />
          <PlaybackButtons {...props} />
          <div className="player-bar__seek">
            <span>{formatTime(props.currentTime)}</span>
            <input type="range" aria-label="Seek" min={0} max={props.duration || 0} value={Math.min(props.currentTime, props.duration)} onChange={(event) => props.onSeek(Number(event.target.value))} />
            <span>{formatTime(props.duration)}</span>
          </div>
          <label>Volume <input type="range" aria-label="Volume" min={0} max={1} step={.01} value={props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} /></label>
          <label>Sleep <select aria-label="Sleep timer" value={props.sleepMinutes ?? ""} onChange={(event) => props.onSetSleep(event.target.value ? Number(event.target.value) : null)}><option value="">Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></label>
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: "var(--space-3)" }}>{stopNote}</p>
        </div>
      </div>
    </Dialog>
  );
}
