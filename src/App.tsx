import { useEffect, useRef, useState } from "react";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, markChapterFinished, captureWindow, finishWalkthrough, fileUrl,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult,
} from "./lib/api";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { ScanView } from "./views/ScanView";
import { PlayerBar } from "./player/PlayerBar";
import { clampSeek } from "./player/playback";
import { runSteps } from "./harness/runner";
import { browseSteps, playerSteps } from "./harness/walkthroughs";

// Wait for React to commit and the browser to paint before a harness screenshot.
function settle(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))),
  );
}

type Route =
  | { kind: "loading" }
  | { kind: "scan" }
  | { kind: "library" }
  | { kind: "author" };

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: "loading" });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [detail, setDetail] = useState<AuthorDetail | null>(null);

  // ---- player state ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRef = useRef<AuthorDetail | null>(null);
  detailRef.current = detail;
  const [current, setCurrent] = useState<ChapterRow | null>(null);
  const currentRef = useRef<ChapterRow | null>(null);
  currentRef.current = current;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);

  async function loadAuthors() {
    setAuthors(await getAuthors());
  }

  async function openAuthor(id: number) {
    setDetail(await getAuthorDetail(id));
    setRoute({ kind: "author" });
  }

  async function togglePlayed(chapterId: number, played: boolean) {
    await setChapterPlayed(chapterId, played);
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
    await loadAuthors();
  }

  function playChapter(c: ChapterRow) {
    setCurrent(c);
    const audio = audioRef.current;
    if (audio) {
      audio.src = fileUrl(c.filePath);
      audio.load();
      void audio.play().catch(() => { /* autoplay may be blocked; bar still shows */ });
    }
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }

  function seek(secs: number) {
    if (audioRef.current) audioRef.current.currentTime = secs;
  }

  function skip(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampSeek(audio.currentTime, delta, audio.duration || 0);
  }

  function setVolume(v: number) {
    if (audioRef.current) audioRef.current.volume = v;
    setVolumeState(v);
  }

  function setSleep(minutes: number | null) {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setSleepMinutes(minutes);
    if (minutes) {
      sleepTimerRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setSleepMinutes(null);
      }, minutes * 60_000);
    }
  }

  async function handleEnded() {
    setIsPlaying(false);
    const c = currentRef.current;
    if (!c) return;
    await markChapterFinished(c.id, Date.now());
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
    await loadAuthors();
    // Stop after each chapter — no auto-advance.
  }

  useEffect(() => {
    (async () => {
      const args = await getLaunchArgs();
      if (args.library) {
        setRoute({ kind: "scan" });
        const result = await scanLibrary(args.library);
        setScan(result);
        await loadAuthors();
      } else {
        await loadAuthors();
      }

      if (args.autostart && args.walkthrough) {
        const openFirstAuthor = async () => {
          const list = await getAuthors();
          if (list.length > 0) await openAuthor(list[0].id);
        };
        const steps =
          args.walkthrough === "player"
            ? playerSteps({
                openFirstAuthor,
                playFirstChapter: async () => {
                  // Self-contained: fetch directly rather than reading detailRef,
                  // whose render from the prior step may not have committed yet.
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  const d = await getAuthorDetail(list[0].id);
                  const first = d.works[0]?.chapters[0];
                  if (first) playChapter(first);
                },
              })
            : browseSteps({
                showScanResult: async () => setRoute({ kind: "scan" }),
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              });
        await runSteps(steps, args.shots, async (p) => { await settle(); await captureWindow(p); });
        await finishWalkthrough(args.doneSignal, args.exitWhenDone);
      } else {
        setRoute({ kind: "library" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function routedView() {
    if (route.kind === "loading") return <div>Loading…</div>;
    if (route.kind === "scan") return <ScanView result={scan} />;
    if (route.kind === "author" && detail) {
      return (
        <AuthorDetailView
          detail={detail}
          onTogglePlayed={togglePlayed}
          onPlayChapter={playChapter}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    return <LibraryView authors={authors} onOpenAuthor={openAuthor} onOpenDiscovery={() => {}} />;
  }

  return (
    <div className="app">
      {routedView()}
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={handleEnded}
      />
      <PlayerBar
        title={current?.title ?? ""}
        hasChapter={current !== null}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        sleepMinutes={sleepMinutes}
        onToggle={toggle}
        onSeek={seek}
        onSkip={skip}
        onVolume={setVolume}
        onSetSleep={setSleep}
      />
    </div>
  );
}
