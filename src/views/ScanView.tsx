import type { ScanResult, ScanProgress } from "../lib/api";
import { Button, Card, StatCard } from "../components/ui";

export function ScanView(props: {
  result: ScanResult | null;
  progress?: ScanProgress | null;
  onCancel?: () => void;
  onOpenLibrary?: () => void;
  onOpenHome?: () => void;
}) {
  // Scanning in progress (no result yet).
  if (!props.result) {
    const p = props.progress;
    const pct = p && p.authorsTotal > 0 ? Math.round((p.authorsDone / p.authorsTotal) * 100) : 0;
    return (
      <Card className="scan empty-state">
        <h1>Scanning your library</h1>
        <p className="muted">Reading your folders and grouping chapters into works. We never move, rename, or change your files — this just builds your shelf.</p>
        {p && (
          <div className="scan-progress" aria-live="polite">
            <div className="scan-progress__track"><div className="scan-progress__fill" style={{ width: `${pct}%` }} /></div>
            <p className="muted">{p.authorsDone} / {p.authorsTotal} creators · {p.added} added · {p.updated} updated · {p.skipped} unchanged</p>
            <p className="muted scan-progress__current">{p.current}</p>
          </div>
        )}
        {props.onCancel && <Button variant="secondary" onClick={props.onCancel}>Cancel scan</Button>}
      </Card>
    );
  }

  const { authors, works, chapters, added = 0, updated = 0, removed = 0, skipped = 0, unknownDuration = 0, errors = [], cancelled = false } = props.result;
  return (
    <Card className="scan" style={{ padding: 24 }}>
      <h1>{cancelled ? "Scan cancelled" : "Library scanned"}</h1>
      {cancelled && <p className="muted">Stopped early — what was scanned so far is kept. Re-scan any time to finish.</p>}
      <div className="stats-grid"><StatCard label="Creators" value={authors} /><StatCard label="Works" value={works} /><StatCard label="Chapters" value={chapters} /></div>
      <p className="muted scan-diff">
        {added} added · {updated} updated · {removed} removed · {skipped} unchanged
        {(unknownDuration ?? 0) > 0 ? ` · ${unknownDuration} unknown length` : ""}
      </p>
      {errors.length > 0 && (
        <details className="scan-errors">
          <summary>{errors.length} item{errors.length === 1 ? "" : "s"} skipped (unreadable)</summary>
          <ul>{errors.slice(0, 50).map((e, i) => <li key={i} className="muted"><code>{e.path}</code> — {e.reason}</li>)}</ul>
        </details>
      )}
      <div className="scan-cta" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
        {props.onOpenLibrary && <Button variant="primary" onClick={props.onOpenLibrary}>Browse library</Button>}
        {props.onOpenHome && <Button variant="secondary" onClick={props.onOpenHome}>Go to Home</Button>}
      </div>
    </Card>
  );
}
