import { useEffect, useRef, useState } from "react";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, markChapterFinished, captureWindow, finishWalkthrough, fileUrl,
  getAllTags, setAuthorTags, setWorkTags, setChapterTags, getDiscovery, getDiscoveryByTags,
  previewRenames, applyRenames, undoRenames,
  setGroupingOverride, clearGroupingOverride,
  getSetting, setSetting, pickFolder, searchLibrary, queryHome, resetPlayHistory,
  type AuthorRow, type AuthorDetail, type ScanResult, type DiscoveryWork,
  type RenameItem, type RenameResult, type SearchResults, type HomeData, type PlaybackContext,
  type ChapterRow,
} from "./lib/api";
import { HomeView } from "./views/HomeView";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { DiscoveryView } from "./views/DiscoveryView";
import { RenameView } from "./views/RenameView";
import { SettingsView } from "./views/SettingsView";
import { ScanView } from "./views/ScanView";
import { PlayerBar } from "./player/PlayerBar";
import { NowPlayingPanel } from "./player/NowPlayingPanel";
import { AppShell, type ShellRoute } from "./components/AppShell";
import { clampSeek, type TimeLabelMode } from "./player/playback";
import { runSteps } from "./harness/runner";
import { homeSteps, browseSteps, playerSteps, discoverySteps, renameSteps, groupingSteps, settingsSteps, m7Steps, coversSteps, tagsSteps, m12Steps } from "./harness/walkthroughs";
import {
  parseBrowsePrefs,
  type BrowsePrefs,
  type AuthorSort,
  type PlayedStatus,
  type WorkSort,
} from "./lib/browse";

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
  | { kind: "home" }
  | { kind: "library" }
  | { kind: "author" }
  | { kind: "discovery" }
  | { kind: "rename" }
  | { kind: "settings"; firstRun: boolean };

function shellRoute(route: Route): ShellRoute {
  if (route.kind === "home") return "home";
  if (route.kind === "discovery") return "discovery";
  if (route.kind === "rename") return "rename";
  if (route.kind === "settings") return "settings";
  return "library";
}

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
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [harnessMenuOpen, setHarnessMenuOpen] = useState(false);

  // ---- library search (controlled; spans authors/works/chapters) ----
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);

  // ---- browse prefs (sort / filter / work sort) ----
  const [browsePrefs, setBrowsePrefs] = useState<BrowsePrefs>({
    authorSort: "az",
    filterTag: null,
    filterStatus: "all",
    workSort: "az",
  });

  // ---- rename state ----
  const [renameItems, setRenameItems] = useState<RenameItem[]>([]);
  const [renameResult, setRenameResult] = useState<RenameResult | null>(null);
  const lastManifestRef = useRef<string | null>(null);

  // ---- player state ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRef = useRef<AuthorDetail | null>(null);
  detailRef.current = detail;
  const [current, setCurrent] = useState<PlaybackContext | null>(null);
  const currentRef = useRef<PlaybackContext | null>(null);
  currentRef.current = current;
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const [timeLabelMode, setTimeLabelMode] = useState<TimeLabelMode>("elapsed");
  const cycleTimeLabel = () =>
    setTimeLabelMode((m) => (m === "elapsed" ? "remaining" : m === "remaining" ? "percent" : "elapsed"));
  const [currentWorkChapters, setCurrentWorkChapters] = useState<ChapterRow[]>([]);

  const [home, setHome] = useState<HomeData | null>(null);
  const [homeNow, setHomeNow] = useState(0);
  const routeRef = useRef<Route>(route);
  routeRef.current = route;

  useEffect(() => {
    const ctx = current;
    if (!ctx) { setCurrentWorkChapters([]); return; }
    let cancelled = false;
    void getAuthorDetail(ctx.authorId).then((d) => {
      if (cancelled) return;
      const work = d.works.find((w) => w.id === ctx.workId);
      setCurrentWorkChapters(work?.chapters ?? []);
    }).catch(() => { if (!cancelled) setCurrentWorkChapters([]); });
    return () => { cancelled = true; };
  }, [current?.workId, current?.authorId]);

  function setSidebarCollapsed(collapsed: boolean) {
    setSidebarCollapsedState(collapsed);
    void setSetting("sidebar_collapsed", String(collapsed));
  }

  async function loadHome() {
    const now = Date.now();
    setHomeNow(now);
    setHome(await queryHome(now, new Date().getTimezoneOffset()));
  }
  async function openHome() {
    await loadHome();
    setRoute({ kind: "home" });
  }

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

  async function setWorkTagsFor(workId: number, tags: string[]) {
    if (!detailRef.current) return;
    await setWorkTags(workId, tags);
    setDetail(await getAuthorDetail(detailRef.current.id));
    await refreshTags();
  }

  async function setChapterTagsFor(chapterId: number, tags: string[]) {
    if (!detailRef.current) return;
    await setChapterTags(chapterId, tags);
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

  // ---- browse prefs persistence ----
  const persistPrefs = (update: (prev: BrowsePrefs) => BrowsePrefs) => {
    setBrowsePrefs((prev) => {
      const next = update(prev);
      void setSetting("browse_prefs", JSON.stringify(next));
      return next;
    });
  };
  const setAuthorSort = (s: AuthorSort) => persistPrefs((p) => ({ ...p, authorSort: s }));
  const setFilterTag = (t: string | null) => persistPrefs((p) => ({ ...p, filterTag: t }));
  const setFilterStatus = (s: PlayedStatus) => persistPrefs((p) => ({ ...p, filterStatus: s }));
  const setWorkSort = (s: WorkSort) => persistPrefs((p) => ({ ...p, workSort: s }));

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
    if (ok) await openHome();
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
    if (routeRef.current.kind === "home") await loadHome();
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

  async function playNextChapterOfWork(workId: number, authorId: number) {
    const detail = await getAuthorDetail(authorId);
    const work = detail.works.find((w) => w.id === workId);
    if (!work) return;
    const next = work.chapters.find((c) => !c.played) ?? work.chapters[0];
    if (!next) return;
    const total = work.chapters.length;
    const played = work.chapters.filter((c) => c.played).length;
    playChapter({
      chapter: next, authorId: detail.id, authorName: detail.name,
      workId: work.id, workTitle: work.baseTitle,
      workTotalChapters: total, workPlayedChapters: played,
    });
  }

  function jumpToChapter(chapter: ChapterRow) {
    const ctx = currentRef.current;
    if (!ctx) return;
    const chapters = currentWorkChapters;
    playChapter({
      chapter, authorId: ctx.authorId, authorName: ctx.authorName,
      workId: ctx.workId, workTitle: ctx.workTitle,
      workTotalChapters: chapters.length || ctx.workTotalChapters,
      workPlayedChapters: chapters.filter((c) => c.played).length,
    });
  }

  function playChapter(context: PlaybackContext) {
    setCurrent(context);
    const audio = audioRef.current;
    if (audio) {
      audio.src = fileUrl(context.chapter.filePath);
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
    await markChapterFinished(c.chapter.id, Date.now());
    if (detailRef.current) setDetail(await getAuthorDetail(detailRef.current.id));
    await loadAuthors();
    if (routeRef.current.kind === "home") await loadHome();
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

      setBrowsePrefs(parseBrowsePrefs(await getSetting("browse_prefs")));
      setSidebarCollapsedState((await getSetting("sidebar_collapsed")) === "true");

      if (args.autostart && args.walkthrough) {
        const openFirstAuthor = async () => {
          const list = await getAuthors();
          if (list.length > 0) await openAuthor(list[0].id);
        };
        const steps =
          args.walkthrough === "m12"
            ? m12Steps({
                showEmptyHome: async () => {
                  await resetPlayHistory();
                  setSidebarCollapsedState(false);
                  setHarnessMenuOpen(false);
                  await loadHome();
                  setRoute({ kind: "home" });
                },
                showHome: async () => {
                  const list = await getAuthors();
                  for (const author of list.slice(0, 3)) await setAuthorTags(author.id, ["cozy"]);
                  if (list.length > 0) {
                    const creator = await getAuthorDetail(list[0].id);
                    const chapters = creator.works.flatMap((work) => work.chapters);
                    const day = 86_400_000;
                    if (chapters[0]) await markChapterFinished(chapters[0].id, Date.now() - day);
                    if (chapters[1]) await markChapterFinished(chapters[1].id, Date.now());
                  }
                  await refreshTags();
                  setAuthors(await getAuthors());
                  await loadHome();
                  setRoute({ kind: "home" });
                },
                collapseSidebar: async () => { setSidebarCollapsedState(true); setRoute({ kind: "home" }); },
                showLibrary: async () => { setSidebarCollapsedState(false); setQuery(""); setResults(null); setRoute({ kind: "library" }); },
                showSearch: async () => {
                  setQuery("cool");
                  setResults(await searchLibrary("cool"));
                  setRoute({ kind: "library" });
                },
                showAuthorDetail: openFirstAuthor,
                showDiscovery: openDiscovery,
                showDiscoveryByTag: async () => {
                  // Self-contained: reset play history so "For You" is empty
                  // (discovery_for_you requires recent play events; with none it
                  // returns []), then open Discovery fresh and apply a tag filter.
                  // Without "For You" cards pushing it below the fold, the "Pick a
                  // tag" chip + by-tag result set are visible in the viewport.
                  await resetPlayHistory();
                  await openDiscovery();
                  await pickTags(["cozy"]);
                },
                showRename: openRename,
                showSettings: async () => { setRoute({ kind: "settings", firstRun: false }); },
                showPlayerCompact: async () => {
                  const list = await getAuthors();
                  if (!list.length) return;
                  const creator = await getAuthorDetail(list[0].id);
                  const work = creator.works[0];
                  const chapter = work?.chapters[0];
                  if (!work || !chapter) return;
                  setDetail(creator);
                  setRoute({ kind: "author" });
                  playChapter({
                    chapter,
                    authorId: creator.id,
                    authorName: creator.name,
                    workId: work.id,
                    workTitle: work.baseTitle,
                    workTotalChapters: work.chapters.length,
                    workPlayedChapters: work.chapters.filter((item) => item.played).length,
                  });
                  setPlayerExpanded(false);
                },
                showPlayerExpanded: async () => { setPlayerExpanded(true); },
                showContextMenu: async () => {
                  // showDiscoveryByTag (step 7) wiped play history; re-seed it
                  // so keepListening is non-null and the featured WorkCard renders
                  // with menuOpen={harnessMenuOpen} to demonstrate Menu layering.
                  setPlayerExpanded(false);
                  const list = await getAuthors();
                  if (list.length > 0) {
                    const creator = await getAuthorDetail(list[0].id);
                    const chapters = creator.works.flatMap((work) => work.chapters);
                    const day = 86_400_000;
                    if (chapters[0]) await markChapterFinished(chapters[0].id, Date.now() - day);
                    if (chapters[1]) await markChapterFinished(chapters[1].id, Date.now());
                  }
                  setSidebarCollapsedState(false);
                  await loadHome();
                  setRoute({ kind: "home" });
                  setHarnessMenuOpen(true);
                },
              })
            : args.walkthrough === "home"
            ? homeSteps({
                showEmptyHome: async () => {
                  // Wipe any play history left over from prior harness runs so
                  // this shot genuinely reflects the empty-state Home.
                  await resetPlayHistory();
                  await loadHome();
                  setRoute({ kind: "home" });
                },
                seedAndShow: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const chs = d.works.flatMap((w) => w.chapters);
                    const DAY = 86_400_000;
                    if (chs[0]) await markChapterFinished(chs[0].id, Date.now() - DAY);
                    if (chs[1]) await markChapterFinished(chs[1].id, Date.now());
                  }
                  await loadHome();
                  setRoute({ kind: "home" });
                },
              })
            : args.walkthrough === "player"
            ? playerSteps({ openFirstAuthor, playFirstChapter: async () => {
                const list = await getAuthors();
                if (list.length === 0) return;
                const d = await getAuthorDetail(list[0].id);
                const work = d.works[0];
                const first = work?.chapters[0];
                if (work && first) playChapter({
                  chapter: first,
                  authorId: d.id,
                  authorName: d.name,
                  workId: work.id,
                  workTitle: work.baseTitle,
                  workTotalChapters: work.chapters.length,
                  workPlayedChapters: work.chapters.filter((chapter) => chapter.played).length,
                });
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
            : args.walkthrough === "tags"
            ? tagsSteps({
                // Seed an author tag, a work tag, and a chapter tag on the first author.
                seed: async () => {
                  const list = await getAuthors();
                  if (list.length === 0) return;
                  await setAuthorTags(list[0].id, ["cozy"]);
                  const d = await getAuthorDetail(list[0].id);
                  const w = d.works[0];
                  if (w) {
                    await setWorkTags(w.id, ["mystery"]);
                    const ch = w.chapters[0];
                    if (ch) await setChapterTags(ch.id, ["intro"]);
                  }
                  await refreshTags();
                },
                openDetail: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                },
                searchByTag: async () => {
                  setRoute({ kind: "library" });
                  setQuery("mystery");
                  setResults(await searchLibrary("mystery"));
                },
              })
            : browseSteps({
                // Seed tags on a few authors + a played chapter so sort-by-length,
                // played%, the tag filter, and the status filter all have signal.
                seed: async () => {
                  const list = await getAuthors();
                  for (const a of list.slice(0, 3)) await setAuthorTags(a.id, ["cozy"]);
                  if (list.length > 0) {
                    const d = await getAuthorDetail(list[0].id);
                    const ch = d.works[0]?.chapters[0];
                    if (ch) await markChapterFinished(ch.id, Date.now());
                  }
                  await refreshTags();
                  setAuthors(await getAuthors()); // refresh counts/tags after seeding
                },
                showLibrarySorted: async () => {
                  setRoute({ kind: "library" });
                  setAuthorSort("length");
                },
                showLibraryFiltered: async () => {
                  setFilterTag("cozy");
                  setFilterStatus("unplayed");
                },
                openFirstAuthor: async () => {
                  const list = await getAuthors();
                  if (list.length > 0) await openAuthor(list[0].id);
                },
              });
        await runSteps(steps, args.shots, async (p) => {
          await settle();
          await imagesSettled();
          await settle(); // let the newly-painted covers commit a frame
          await captureWindow(p);
        });
        await finishWalkthrough(args.doneSignal, args.exitWhenDone);
      } else {
        await openHome();
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
    if (route.kind === "home") {
      return (
        <HomeView
          home={home}
          nowMs={homeNow}
          onPlay={playChapter}
          onOpenAuthor={openAuthor}
          onOpenLibrary={() => setRoute({ kind: "library" })}
          onOpenSettings={openSettings}
          onPlayNextOfWork={playNextChapterOfWork}
          featureMenuOpen={harnessMenuOpen}
        />
      );
    }
    if (route.kind === "author" && detail) {
      return (
        <AuthorDetailView
          detail={detail}
          onTogglePlayed={togglePlayed}
          onPlayChapter={playChapter}
          onSetTags={setTags}
          onSetWorkTags={setWorkTagsFor}
          onSetChapterTags={setChapterTagsFor}
          onSetGrouping={setGrouping}
          onClearGrouping={clearGrouping}
          allTags={allTags}
          onBack={() => setRoute({ kind: "library" })}
          workSort={browsePrefs.workSort}
          onWorkSortChange={setWorkSort}
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
          onPlayNextOfWork={playNextChapterOfWork}
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
        sort={browsePrefs.authorSort}
        onSortChange={setAuthorSort}
        filterTag={browsePrefs.filterTag}
        onFilterTagChange={setFilterTag}
        filterStatus={browsePrefs.filterStatus}
        onFilterStatusChange={setFilterStatus}
        allTags={allTags}
        onPlayNextOfWork={playNextChapterOfWork}
      />
    );
  }

  const player = (
    <PlayerBar
      context={current}
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
      onExpand={() => setPlayerExpanded(true)}
      onOpenAuthor={openAuthor}
      timeLabelMode={timeLabelMode}
      onCycleTimeLabel={cycleTimeLabel}
    />
  );
  const view = routedView();
  const standalone = route.kind === "loading" || route.kind === "scan" ||
    (route.kind === "settings" && route.firstRun);

  return (
    <div className="app" style={{ height: "100%" }}>
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={handleEnded}
      />
      {standalone ? <div className="standalone-view">{view}</div> : (
        <AppShell
          active={shellRoute(route)}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          onHome={openHome}
          onLibrary={() => setRoute({ kind: "library" })}
          onDiscovery={openDiscovery}
          onRename={openRename}
          onSettings={openSettings}
          player={player}
        >
          {view}
        </AppShell>
      )}
      {current && playerExpanded && (
        <NowPlayingPanel
          context={current}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          sleepMinutes={sleepMinutes}
          onClose={() => setPlayerExpanded(false)}
          onToggle={toggle}
          onSeek={seek}
          onSkip={skip}
          onVolume={setVolume}
          onSetSleep={setSleep}
          onOpenAuthor={(authorId) => {
            setPlayerExpanded(false);
            void openAuthor(authorId);
          }}
          timeLabelMode={timeLabelMode}
          onCycleTimeLabel={cycleTimeLabel}
          chapters={currentWorkChapters}
          onJumpToChapter={jumpToChapter}
        />
      )}
    </div>
  );
}
