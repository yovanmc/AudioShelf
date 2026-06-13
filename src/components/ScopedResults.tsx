import type { ScopedResults as Results, ScopedWork } from "../lib/api";

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ScopedResults({
  results, onOpenAuthor, selectMode, selectedWorkIds, onToggleWork,
}: {
  results: Results;
  onOpenAuthor: (authorId: number) => void;
  selectMode?: boolean;
  selectedWorkIds?: number[];
  onToggleWork?: (workId: number) => void;
}) {
  const selected = new Set(selectedWorkIds ?? []);
  return (
    <div>
      <div className="scoped-chips">
        {results.tags.map((t) => <span key={t} className="chip">tag: {t}</span>)}
        {results.durationLabel && <span className="chip">duration: {results.durationLabel}</span>}
        {results.statusLabel && <span className="chip">{results.statusLabel}</span>}
        {results.text && <span className="chip chip--text">"{results.text}"</span>}
        <span className="scoped-count">{results.works.length} works</span>
      </div>
      <div className="card-grid">
        {results.works.map((w: ScopedWork) => (
          <button
            key={w.workId}
            className={`work-card${selected.has(w.workId) ? " work-card--selected" : ""}`}
            onClick={() => (selectMode && onToggleWork ? onToggleWork(w.workId) : onOpenAuthor(w.authorId))}
          >
            {selectMode && (
              <span className="work-card__check" aria-hidden>
                {selected.has(w.workId) ? "☑" : "☐"}
              </span>
            )}
            <span className="work-card__title">{w.baseTitle}</span>
            <span className="work-card__sub">{w.authorName}</span>
            <span className="work-card__meta">{w.playedCount}/{w.chapterCount} · {fmt(w.totalSecs)}</span>
          </button>
        ))}
        {results.works.length === 0 && <p className="empty-note">No works match this filter. Try removing a condition.</p>}
      </div>
    </div>
  );
}
