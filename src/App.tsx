import { useEffect, useRef, useState } from "react";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, markChapterFinished, captureWindow, finishWalkthrough, fileUrl,
  getAllTags, setAuthorTags, getDiscovery, getDiscoveryByTags,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult, type DiscoveryWork,
} from "./lib/api";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { DiscoveryView } from "./views/DiscoveryView";
import { ScanView } from "./views/ScanView";
import { PlayerBar } from "./player/PlayerBar";
import { clampSeek } from "./player/playback";
import { runSteps } from "./harness/runner";
import { browseSteps, playerSteps, discoverySteps } from "./harness/walkthroughs";

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
  | { kind: "author" }
  | { kind: "discovery" };

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: "loading" });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [detail, setDetail] = useState<AuthorDetail | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [forYou, setForYou] = useState<DiscoveryWork[]>([]);
  const [byTags, setByTags] = useState<DiscoveryWork[]>([]);

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

  async function refreshTags() { setAllTags(await getAllTags()); }

  async function setTags(tags: string[]) {
    if (!detailRef.current) return;
    await setAuthorTags(detailRef.current.id, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }

  async function openDiscovery() {
    setForYou(await getDiscovery());
    await refreshTags();
    setByTags([]);
    setRoute({ kind: "discovery" });
  }

  async function pickTags(tags: string[]) {
    setByTags(tags.length === 0 ? [] : await getDiscoveryByTags(tags));
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
      await refreshTags();

      if (args.autostart && args.walkthrough) {
        const openFirstAuthor = async () => {
          const list = await getAuthors();
          if (list.length > 0) await openAuthor(list[0].id);
        };
        const steps =
          args.walkthrough === "player"
            ? playerSteps({ openFirstAuthor, playFirstChapter: async () => {
                const list = await getAuthors();
                if (list.length === 0) return;
                const d = await getAuthorDetail(list[0].id);
                const first = d.works[0]?.chapters[0];
                if (first) playChapter(first);
              } })
            : args.walkthrough === "discovery"
            ? discoverySteps({
                // Seed tags + a play event so For-you and Pick-a-tag have data.
                seed: async () => {
                  const list = await getAuthors();
                  for (const a of list) await setAuthorTags(a.id, ["cozy"]);
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const ch = d.works[0]?.chapters[0];
                    if (ch) { await markChapterFinished(ch.id, Date.now()); }
                  }
                  await refreshTags();
                },
                openDiscovery,
                pickFirstTag: async () => { await pickTags(["cozy"]); },
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
          onSetTags={setTags}
          allTags={allTags}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    if (route.kind === "discovery") {
      return (
        <DiscoveryView
          forYou={forYou}
          allTags={allTags}
          byTags={byTags}
          onPickTags={pickTags}
          onOpenAuthor={openAuthor}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    return <LibraryView authors={authors} onOpenAuthor={openAuthor} onOpenDiscovery={openDiscovery} />;
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
