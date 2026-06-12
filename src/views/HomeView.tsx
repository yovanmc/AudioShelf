import type { ChapterRow, HomeData } from "../lib/api";
import { Cover } from "../components/Cover";
import { formatLong, formatRelative } from "../lib/time";

export function HomeView(props: {
  home: HomeData | null;
  nowMs: number;
  onPlayChapter: (c: ChapterRow) => void;
  onOpenAuthor: (id: number) => void;
  onOpenLibrary: () => void;
  onOpenDiscovery: () => void;
  onOpenRename: () => void;
  onOpenSettings: () => void;
}) {
  const home = props.home;
  const nav = (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <button onClick={props.onOpenLibrary}>Library</button>
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <button onClick={props.onOpenRename}>Rename tool</button>
      <button onClick={props.onOpenSettings}>Settings</button>
    </div>
  );

  if (!home) {
    return (
      <div className="home">
        {nav}
        <p>Loading…</p>
      </div>
    );
  }

  const { continueListening, stats } = home;
  const isEmpty =
    continueListening.length === 0 && stats.chaptersFinished === 0 && stats.recent.length === 0;

  return (
    <div className="home">
      {nav}
      <h1>Home</h1>

      {isEmpty && (
        <p className="home-empty">
          Nothing played yet — open your <button onClick={props.onOpenLibrary}>Library</button> to
          start listening.
        </p>
      )}

      {continueListening.length > 0 && (
        <section className="jump-back-in">
          <h2>Jump back in</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {continueListening.map((it) => (
              <li
                key={it.workId}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}
              >
                <Cover kind="work" id={it.workId} name={it.workTitle} size={40} />
                <span style={{ flex: 1 }}>
                  <button onClick={() => props.onOpenAuthor(it.authorId)}>
                    <strong>{it.authorName}</strong>
                  </button>{" "}
                  — {it.workTitle}
                  <br />
                  <span className="muted">
                    Next: Ch {it.nextChapter.chapterNo} — {it.nextChapter.title} ·{" "}
                    {it.remainingUnplayed} left · {formatRelative(it.lastPlayedAt, props.nowMs)}
                  </span>
                </span>
                <button onClick={() => props.onPlayChapter(it.nextChapter)}>▶ Play</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="your-listening">
        <h2>Your listening</h2>
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          <Tile label="Total time" value={formatLong(stats.totalSecs)} />
          <Tile label="Chapters finished" value={String(stats.chaptersFinished)} />
          <Tile label="Streak" value={`🔥 ${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`} />
        </div>
        {stats.recent.length > 0 && (
          <>
            <h3>Recent</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {stats.recent.map((r, i) => (
                <li key={`${r.chapterId}-${i}`} style={{ padding: "2px 0" }}>
                  {r.chapterTitle}{" "}
                  <span className="muted">
                    — {r.workTitle} · {r.authorName} · {formatRelative(r.playedAt, props.nowMs)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 110,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
    </div>
  );
}
