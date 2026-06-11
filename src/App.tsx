import { useEffect, useState } from "react";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, captureWindow, finishWalkthrough,
  type AuthorRow, type AuthorDetail, type ScanResult,
} from "./lib/api";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { ScanView } from "./views/ScanView";
import { runSteps } from "./harness/runner";
import { browseSteps } from "./harness/walkthroughs";

// Wait for React to commit and the browser to paint before a harness screenshot,
// so each shot reflects the state the preceding step just set (two rAFs guarantee
// a paint has occurred; the timeout adds margin).
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

  async function loadAuthors() {
    setAuthors(await getAuthors());
  }

  async function openAuthor(id: number) {
    setDetail(await getAuthorDetail(id));
    setRoute({ kind: "author" });
  }

  async function togglePlayed(chapterId: number, played: boolean) {
    await setChapterPlayed(chapterId, played);
    if (detail) setDetail(await getAuthorDetail(detail.id));
    await loadAuthors();
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
        const steps = browseSteps({
          showScanResult: async () => setRoute({ kind: "scan" }),
          showLibrary: async () => setRoute({ kind: "library" }),
          openFirstAuthor: async () => {
            const list = await getAuthors();
            if (list.length > 0) await openAuthor(list[0].id);
          },
        });
        await runSteps(steps, args.shots, async (p) => { await settle(); await captureWindow(p); });
        await finishWalkthrough(args.doneSignal, args.exitWhenDone);
      } else {
        setRoute({ kind: "library" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (route.kind === "loading") return <div>Loading…</div>;
  if (route.kind === "scan") return <ScanView result={scan} />;
  if (route.kind === "author" && detail) {
    return (
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={togglePlayed}
        onPlayChapter={() => {}}
        onBack={() => setRoute({ kind: "library" })}
      />
    );
  }
  return <LibraryView authors={authors} onOpenAuthor={openAuthor} />;
}
