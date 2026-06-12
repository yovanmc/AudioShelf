import { useEffect, useRef, useState } from "react";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, markChapterFinished, captureWindow, finishWalkthrough, fileUrl,
  getAllTags, setAuthorTags, getDiscovery, getDiscoveryByTags,
  previewRenames, applyRenames, undoRenames,
  setGroupingOverride, clearGroupingOverride,
  getSetting, setSetting, pickFolder, searchLibrary,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult, type DiscoveryWork,
  type RenameItem, type RenameResult, type SearchResults,
} from "./lib/api";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { DiscoveryView } from "./views/DiscoveryView";
import { RenameView } from "./views/RenameView";
import { SettingsView } from "./views/SettingsView";
import { ScanView } from "./views/ScanView";
import { PlayerBar } from "./player/PlayerBar";
import { clampSeek } from "./player/playback";
import { runSteps } from "./harness/runner";
import { browseSteps, playerSteps, discoverySteps, renameSteps, groupingSteps, settingsSteps, m7Steps, coversSteps } from "./harness/walkthroughs";

// Wait for React to commit and the browser to paint before a harness screenshot.
function settle(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))),
  );
}

// Wait for any <img> (e.g. cover art served via the asset protocol) to finish loading,
// so a screenshot taken after settle() doesn't capture half-loaded covers.
function imagesSettled(): Promise<void> {
  const imgs = Array.from(document.images);
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

type Route =
  | { kind: "loading" }
  | { kind: "scan" }
  | { kind: "library" }
  | { kind: "author" }
  | { kind: "discovery" }
  | { kind: "rename" }
  | { kind: "settings"; firstRun: boolean };

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: "loading" });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [detail, setDetail] = useState<AuthorDetail | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [forYou, setForYou] = useState<DiscoveryWork[]>([]);
  const [byTags, setByTags] = useState<DiscoveryWork[]>([]);
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- library search (controlled; spans authors/works/chapters) ----
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);

  // ---- rename state ----
  const [renameItems, setRenameItems] = useState<RenameItem[]>([]);
  const [renameResult, setRenameResult] = useState<RenameResult | null>(null);
  const lastManifestRef = useRef<string | null>(null);

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

  async function openRename() {
    setRenameResult(null);
    setRenameItems(await previewRenames());
    setRoute({ kind: "rename" });
  }
  async function reloadRenamePreview() {
    setRenameResult(null);
    setRenameItems(await previewRenames());
  }
  async function doApplyRenames(chapterIds: number[]) {
    const res = await applyRenames(chapterIds, Date.now());
    lastManifestRef.current = res.manifestPath;
    setRenameResult(res);
    setRenameItems(await previewRenames()); // reflect new on-disk names
  }
  async function doUndoRenames() {
    if (!renameResult) return;
    await undoRenames(renameResult.manifestPath);
    setRenameResult(null);
    setRenameItems(await previewRenames());
  }

  async function openDiscovery() {
    setForYou(await getDiscovery());
    await refreshTags();
    setByTags([]);
    setPickedTags([]);
    setRoute({ kind: "discovery" });
  }

  async function pickTags(tags: string[]) {
    setPickedTags(tags);
    setByTags(tags.length === 0 ? [] : await getDiscoveryByTags(tags));
  }

  // Persist the chosen root, scan it, and refresh the author list. Fails safe:
  // a bad/missing path leaves the user on Settings with an error, never crashes.
  async function scanRoot(root: string, persist: boolean) {
    setBusy(true);
    setScanError(null);
    try {
      const result = await scanLibrary(root);
      if (persist) await setSetting("library_root", root);
      setLibraryRoot(root);
      setScan(result);
      await loadAuthors();
      await refreshTags();
      return true;
    } catch (e) {
      setScanError(String(e));
      setLibraryRoot(root);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    setScanError(null);
    setRoute({ kind: "settings", firstRun: false });
  }

  async function chooseFolder() {
    const picked = await pickFolder();
    if (!picked) return; // user cancelled
    const ok = await scanRoot(picked, true);
    if (ok) setRoute({ kind: "library" });
  }

  async function rescan() {
    if (!libraryRoot) return;
    await scanRoot(libraryRoot, true);
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

  async function setGrouping(chapterId: number, baseTitle: string, chapterNo: number) {
    const d = await setGroupingOverride(chapterId, baseTitle, chapterNo);
    setDetail(d);
    await loadAuthors();
  }
  async function clearGrouping(chapterId: number) {
    const d = await clearGroupingOverride(chapterId);
    setDetail(d);
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
      // Precedence: --library flag (harness/dev) → persisted root → first-run onboarding.
      if (args.library) {
        setRoute({ kind: "scan" });
        await scanRoot(args.library, false); // flag is ephemeral; don't persist it
      } else {
        const saved = await getSetting("library_root");
        if (saved) {
          setRoute({ kind: "scan" });
          const ok = await scanRoot(saved, false); // already persisted
          if (!ok) {
            // Saved root is gone/unreadable — fail safe to Settings with the error shown.
            setRoute({ kind: "settings", firstRun: false });
            return;
          }
        } else {
          await refreshTags();
          // No flag and nothing persisted → onboarding.
          setRoute({ kind: "settings", firstRun: true });
          return;
        }
      }

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
            : args.walkthrough === "rename"
            ? renameSteps({
                openRename,
                applyAll: async () => {
                  const items = await previewRenames();
                  const okIds = items.filter((i) => i.status === "ok").map((i) => i.chapterId);
                  const res = await applyRenames(okIds, Date.now());
                  lastManifestRef.current = res.manifestPath;
                  setRenameResult(res);
                  setRenameItems(await previewRenames());
                  setRoute({ kind: "rename" });
                },
                undoLast: async () => {
                  if (lastManifestRef.current) await undoRenames(lastManifestRef.current);
                  setRenameResult(null);
                  setRenameItems(await previewRenames());
                },
              })
            : args.walkthrough === "grouping"
            ? groupingSteps({
                openFirstAuthor,
                mergeDemo: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  const d = await getAuthorDetail(list[0].id);
                  const standalone = d.works.find((w) => w.baseTitle === "Another Standalone Tale");
                  const ch = standalone?.chapters[0];
                  if (ch) setDetail(await setGroupingOverride(ch.id, "Cool Story", 4));
                },
                resetDemo: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  // The merged chapter now lives under "Cool Story"; find it by title.
                  const d = await getAuthorDetail(list[0].id);
                  const cool = d.works.find((w) => w.baseTitle === "Cool Story");
                  const merged = cool?.chapters.find((c) => c.title === "Another Standalone Tale");
                  if (merged) setDetail(await clearGroupingOverride(merged.id));
                },
              })
            : args.walkthrough === "m7"
            ? m7Steps({
                showLibrary: async () => setRoute({ kind: "library" }),
                // Set the query AND fetch results synchronously here (bypassing the
                // debounce) so the screenshot after this step is deterministic.
                search: async (q: string) => {
                  setRoute({ kind: "library" });
                  setQuery(q);
                  setResults(await searchLibrary(q));
                },
              })
            : args.walkthrough === "settings"
            ? settingsSteps({
                openSettings: async () => setRoute({ kind: "settings", firstRun: false }),
              })
            : args.walkthrough === "covers"
            ? coversSteps({
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              })
            : browseSteps({
                showScanResult: async () => setRoute({ kind: "scan" }),
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              });
        await runSteps(steps, args.shots, async (p) => {
          await settle();
          await imagesSettled();
          await settle(); // let the newly-painted covers commit a frame
          await captureWindow(p);
        });
        await finishWalkthrough(args.doneSignal, args.exitWhenDone);
      } else {
        setRoute({ kind: "library" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced backend search. Empty query clears results (list shows instead).
  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await searchLibrary(q);
      if (!cancelled) setResults(r);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

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
          onSetGrouping={setGrouping}
          onClearGrouping={clearGrouping}
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
          picked={pickedTags}
          onPickTags={pickTags}
          onOpenAuthor={openAuthor}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    if (route.kind === "rename") {
      return (
        <RenameView
          items={renameItems}
          result={renameResult}
          onApply={doApplyRenames}
          onUndo={doUndoRenames}
          onReload={reloadRenamePreview}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    if (route.kind === "settings") {
      return (
        <SettingsView
          root={libraryRoot}
          lastScan={scan}
          scanError={scanError}
          busy={busy}
          firstRun={route.firstRun}
          onChooseFolder={chooseFolder}
          onRescan={rescan}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    return (
      <LibraryView
        authors={authors}
        query={query}
        results={results}
        onQueryChange={setQuery}
        onOpenAuthor={openAuthor}
        onOpenDiscovery={openDiscovery}
        onOpenRename={openRename}
        onOpenSettings={openSettings}
      />
    );
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
