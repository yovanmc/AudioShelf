import type { AuthorDetail } from "../lib/api";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onBack: () => void;
}) {
  const { detail } = props;
  return (
    <div className="author-detail">
      <button onClick={props.onBack}>← Library</button>
      <h1>{detail.name}</h1>
      {detail.works.map((w) => (
        <section key={w.id} className="work">
          <h2><span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span></h2>
          <ul>
            {w.chapters.map((c) => (
              <li key={c.id} data-played={c.played ? "true" : "false"}>
                <label aria-label={`Mark '${c.title}' played`}>
                  <input
                    type="checkbox"
                    checked={c.played}
                    onChange={(e) => props.onTogglePlayed(c.id, e.target.checked)}
                  />
                </label>
                <span className="chapter-title">{c.title}</span>{" — "}
                <span className="chapter-duration">{formatDuration(c.durationSecs)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
