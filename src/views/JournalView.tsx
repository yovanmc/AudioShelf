import { useEffect, useRef, useState } from "react";
import type { JournalResults, JournalEntry } from "../lib/api";
import { EmptyState, Notice, PageHeader } from "../components/ui";

type KindFilter = "all" | "note" | "bookmark" | "summary" | "takeaway" | "favorite" | "rating";

const KIND_LABELS: Record<KindFilter, string> = {
  all: "All",
  note: "Notes",
  bookmark: "Bookmarks",
  summary: "Summaries",
  takeaway: "Takeaways",
  favorite: "Favorites",
  rating: "Ratings",
};

const KIND_CHIP_LABEL: Record<string, string> = {
  note: "Note",
  bookmark: "Bookmark",
  summary: "Summary",
  takeaway: "Takeaway",
  favorite: "★ Favorite",
  re_entry: "Re-entry",
  rating: "Rating",
};

/** Formats integer seconds as m:ss. */
function fmtPos(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function JournalView(props: {
  journal: JournalResults | null;
  exportStatus: string | null;
  onSearch: (query: string) => void;
  onExport: (format: "markdown" | "json") => void;
}) {
  const { journal, exportStatus, onSearch, onExport } = props;

  const [searchText, setSearchText] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Debounced search — 150ms like Library.
  useEffect(() => {
    const t = setTimeout(() => onSearch(searchText), 150);
    return () => clearTimeout(t);
  }, [searchText, onSearch]);

  // Close export menu on outside click.
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);

  const entries = journal?.entries ?? [];

  // Client-side kind filter.
  const filtered = kindFilter === "all"
    ? entries
    : kindFilter === "favorite"
    ? entries.filter((e) => e.kind === "favorite")
    : entries.filter((e) => e.kind === (kindFilter as string));

  // Group by authorName → workTitle.
  const grouped: Map<string, Map<string, JournalEntry[]>> = new Map();
  for (const entry of filtered) {
    let byWork = grouped.get(entry.authorName);
    if (!byWork) { byWork = new Map(); grouped.set(entry.authorName, byWork); }
    let list = byWork.get(entry.workTitle);
    if (!list) { list = []; byWork.set(entry.workTitle, list); }
    list.push(entry);
  }

  const kindChips: KindFilter[] = ["all", "note", "bookmark", "summary", "takeaway", "favorite", "rating"];

  return (
    <main className="view journal">
      <PageHeader
        eyebrow="Your listening record"
        title="Journal"
        actions={
          <div style={{ position: "relative" }} ref={exportMenuRef}>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setExportMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
            >
              Export ▾
            </button>
            {exportMenuOpen && (
              <div
                role="menu"
                className="card"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  minWidth: 130,
                  padding: "var(--space-2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-1)",
                  zIndex: 200,
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="button button--ghost"
                  onClick={() => { setExportMenuOpen(false); onExport("markdown"); }}
                >
                  Markdown
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="button button--ghost"
                  onClick={() => { setExportMenuOpen(false); onExport("json"); }}
                >
                  JSON
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* Search */}
      <div className="toolbar">
        <label style={{ display: "flex", flex: 1, alignItems: "center", gap: 8 }}>
          <span className="visually-hidden">Search journal</span>
          <input
            style={{ width: "100%" }}
            aria-label="Search journal"
            placeholder="Search notes, bookmarks, summaries…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </label>
      </div>

      {/* Kind filter chips */}
      <div className="chips" style={{ padding: "var(--space-2) 0", gap: "var(--space-2)", flexWrap: "wrap" }} role="group" aria-label="Filter by kind">
        {kindChips.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kindFilter === k}
            className={`chip chip--toggle${kindFilter === k ? " chip--on" : ""}`}
            onClick={() => setKindFilter(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {/* Export status notice */}
      {exportStatus && (
        <Notice tone="success" role="status">{exportStatus}</Notice>
      )}

      {/* Entries grouped by author → work */}
      {journal === null ? (
        <EmptyState title="Loading…" />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing in your journal yet">
          {entries.length === 0
            ? "Open a chapter to add notes, bookmarks, summaries, and more."
            : "No entries match the current filter."}
        </EmptyState>
      ) : (
        <div className="journal-groups" style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {Array.from(grouped.entries()).map(([authorName, workMap]) => (
            <section key={authorName}>
              <h2 className="eyebrow muted" style={{ marginBottom: "var(--space-2)" }}>{authorName}</h2>
              {Array.from(workMap.entries()).map(([workTitle, workEntries]) => (
                <div key={workTitle} className="card journal-work" style={{ marginBottom: "var(--space-3)", padding: "var(--space-3)" }}>
                  <h3 style={{ margin: "0 0 var(--space-2)" }}>{workTitle}</h3>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                    {workEntries.map((entry, i) => (
                      <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                        <span
                          className="chip"
                          style={{ flexShrink: 0, fontSize: "0.75rem" }}
                          aria-label={`Kind: ${KIND_CHIP_LABEL[entry.kind] ?? entry.kind}`}
                        >
                          {KIND_CHIP_LABEL[entry.kind] ?? entry.kind}
                        </span>
                        <span style={{ flex: 1, fontSize: "0.9rem" }}>
                          {entry.chapterTitle && (
                            <span className="muted" style={{ fontSize: "0.82rem", display: "block" }}>
                              {entry.chapterTitle}
                              {entry.positionSecs != null && <> @ {fmtPos(entry.positionSecs)}</>}
                            </span>
                          )}
                          {entry.body && <span>{entry.body}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
