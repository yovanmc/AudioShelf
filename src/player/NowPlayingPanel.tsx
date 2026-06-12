import { useEffect, useRef } from "react";
import type { PlaybackContext } from "../lib/api";
import { CreatorIdentity } from "../components/CreatorIdentity";
import { WorkArtwork } from "../components/Cover";
import { IconButton, ProgressBar } from "../components/ui";
import { formatTime } from "./playback";
import { PlaybackButtons, type PlayerControls } from "./PlayerBar";

export function NowPlayingPanel(props: PlayerControls & {
  context: PlaybackContext;
  onClose: () => void;
  onOpenAuthor: (authorId: number) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose.current();
      if (event.key !== "Tab") return;
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])') ?? [])];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous.current?.focus();
    };
  }, []);
  const progress = props.context.workTotalChapters > 0
    ? Math.round((props.context.workPlayedChapters / props.context.workTotalChapters) * 100)
    : 0;
  return (
    <div className="dialog-backdrop">
      <div ref={panel} className="card now-playing" role="dialog" aria-modal="true" aria-label="Now playing">
        <IconButton ref={close} icon="close" label="Close now playing" onClick={props.onClose} />
        <div className="now-playing__layout">
          <WorkArtwork workId={props.context.workId} title={props.context.workTitle} size={360} />
          <div>
            <div className="muted">Now playing</div>
            <h1>{props.context.workTitle}</h1>
            <CreatorIdentity authorId={props.context.authorId} authorName={props.context.authorName} size={44} onOpen={() => props.onOpenAuthor(props.context.authorId)} />
            <p>{props.context.chapter.title} · Chapter {props.context.chapter.chapterNo}</p>
            <ProgressBar value={progress} label="Work progress" />
            <PlaybackButtons {...props} />
            <div className="player-bar__seek">
              <span>{formatTime(props.currentTime)}</span>
              <input type="range" aria-label="Seek" min={0} max={props.duration || 0} value={Math.min(props.currentTime, props.duration)} onChange={(event) => props.onSeek(Number(event.target.value))} />
              <span>{formatTime(props.duration)}</span>
            </div>
            <label>Volume <input type="range" aria-label="Volume" min={0} max={1} step={.01} value={props.volume} onChange={(event) => props.onVolume(Number(event.target.value))} /></label>
            <label>Sleep <select aria-label="Sleep timer" value={props.sleepMinutes ?? ""} onChange={(event) => props.onSetSleep(event.target.value ? Number(event.target.value) : null)}><option value="">Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></label>
          </div>
        </div>
      </div>
    </div>
  );
}
