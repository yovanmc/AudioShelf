import { useState } from "react";
import type { ChapterRow, ChapterJournal, ChapterNote, ChapterBookmark } from "../lib/api";
import { Dialog, Button } from "../components/ui";

/** Formats integer seconds as m:ss. */
function fmtPos(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ChapterJournalDialog(props: {
  chapter: ChapterRow;
  journal: ChapterJournal;
  onClose: () => void;
  onSetSummary: (chapterId: number, text: string) => void;
  onSetTakeaway: (chapterId: number, text: string) => void;
  onSetFavorite: (chapterId: number, isFavorite: boolean) => void;
  onAddNote: (chapterId: number, positionSecs: number, body: string) => void;
  onDeleteNote: (noteId: number) => void;
  onAddBookmark: (chapterId: number, positionSecs: number, label: string) => void;
  onDeleteBookmark: (bookmarkId: number) => void;
}) {
  const { chapter, journal } = props;

  const [summaryText, setSummaryText] = useState(chapter.userSummary);
  const [takeawayText, setTakeawayText] = useState(chapter.takeaway);

  // Add-note form state
  const [notePos, setNotePos] = useState(0);
  const [noteBody, setNoteBody] = useState("");

  // Add-bookmark form state
  const [bmkPos, setBmkPos] = useState(0);
  const [bmkLabel, setBmkLabel] = useState("");

  return (
    <Dialog label="Chapter journal" title={`Journal — ${chapter.title}`} context="Notes, bookmarks, summary, and favorite for this chapter" onClose={props.onClose} className="chapter-journal-dialog">
      <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: 20, minWidth: 340 }}>

        {/* Favorite toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className={`chip chip--toggle${chapter.isFavorite ? " chip--on" : ""}`}
            aria-pressed={chapter.isFavorite}
            aria-label={chapter.isFavorite ? "Remove from favorites" : "Mark as favorite"}
            onClick={() => props.onSetFavorite(chapter.id, !chapter.isFavorite)}
            style={{ fontSize: "1.2rem" }}
          >
            ★ Favorite
          </button>
        </div>

        {/* Summary */}
        <div>
          <label style={{ display: "block", fontWeight: 650, marginBottom: 4 }}>
            Summary
          </label>
          <textarea
            aria-label="Chapter summary"
            value={summaryText}
            onChange={(e) => setSummaryText(e.target.value)}
            rows={3}
            style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
            data-autofocus
          />
          <Button
            variant="secondary"
            style={{ marginTop: 6 }}
            onClick={() => props.onSetSummary(chapter.id, summaryText)}
          >
            Save summary
          </Button>
        </div>

        {/* Takeaway */}
        <div>
          <label style={{ display: "block", fontWeight: 650, marginBottom: 4 }}>
            Takeaway
          </label>
          <input
            aria-label="Chapter takeaway"
            value={takeawayText}
            onChange={(e) => setTakeawayText(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <Button
            variant="secondary"
            style={{ marginTop: 6 }}
            onClick={() => props.onSetTakeaway(chapter.id, takeawayText)}
          >
            Save takeaway
          </Button>
        </div>

        {/* Notes */}
        <div>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>Notes</div>
          {journal.notes.length > 0 ? (
            <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {journal.notes.map((note: ChapterNote) => (
                <li key={note.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="muted" style={{ minWidth: 36, fontSize: "0.85rem" }}>{fmtPos(note.positionSecs)}</span>
                  <span style={{ flex: 1, fontSize: "0.9rem" }}>{note.body}</span>
                  <Button
                    variant="ghost"
                    aria-label={`Delete note at ${fmtPos(note.positionSecs)}`}
                    onClick={() => props.onDeleteNote(note.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: "0 0 10px", fontSize: "0.88rem" }}>No notes yet.</p>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.85rem" }}>
              Position (s)
              <input
                aria-label="Note position in seconds"
                type="number"
                min={0}
                value={notePos}
                onChange={(e) => setNotePos(Math.max(0, Number(e.target.value)))}
                style={{ width: 72 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.85rem", flex: 1 }}>
              Note text
              <input
                aria-label="Note body"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              onClick={() => {
                if (!noteBody.trim()) return;
                props.onAddNote(chapter.id, notePos, noteBody);
                setNoteBody("");
                setNotePos(0);
              }}
            >
              Add note
            </Button>
          </div>
        </div>

        {/* Bookmarks */}
        <div>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>Bookmarks</div>
          {journal.bookmarks.length > 0 ? (
            <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {journal.bookmarks.map((bm: ChapterBookmark) => (
                <li key={bm.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="muted" style={{ minWidth: 36, fontSize: "0.85rem" }}>{fmtPos(bm.positionSecs)}</span>
                  <span style={{ flex: 1, fontSize: "0.9rem" }}>{bm.label || <em className="muted">—</em>}</span>
                  <Button
                    variant="ghost"
                    aria-label={`Delete bookmark at ${fmtPos(bm.positionSecs)}`}
                    onClick={() => props.onDeleteBookmark(bm.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: "0 0 10px", fontSize: "0.88rem" }}>No bookmarks yet.</p>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.85rem" }}>
              Position (s)
              <input
                aria-label="Bookmark position in seconds"
                type="number"
                min={0}
                value={bmkPos}
                onChange={(e) => setBmkPos(Math.max(0, Number(e.target.value)))}
                style={{ width: 72 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.85rem", flex: 1 }}>
              Label (optional)
              <input
                aria-label="Bookmark label"
                value={bmkLabel}
                onChange={(e) => setBmkLabel(e.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              onClick={() => {
                props.onAddBookmark(chapter.id, bmkPos, bmkLabel);
                setBmkLabel("");
                setBmkPos(0);
              }}
            >
              Add bookmark
            </Button>
          </div>
        </div>

      </div>
    </Dialog>
  );
}
