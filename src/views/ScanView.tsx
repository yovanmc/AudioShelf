import type { ScanResult } from "../lib/api";
import { Button, Card, StatCard } from "../components/ui";

export function ScanView(props: { result: ScanResult | null; onOpenLibrary?: () => void; onOpenHome?: () => void }) {
  if (!props.result) {
    return <Card className="scan empty-state"><h1>Scanning your library</h1><p className="muted">Reading your folders and grouping chapters into works. We never move, rename, or change your files — this just builds your shelf.</p></Card>;
  }
  const { authors, works, chapters } = props.result;
  return (
    <Card className="scan" style={{ padding: 24 }}>
      <h1>Library scanned</h1>
      <div className="stats-grid"><StatCard label="Creators" value={authors} /><StatCard label="Works" value={works} /><StatCard label="Chapters" value={chapters} /></div>
      <div className="scan-cta" style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
        {props.onOpenLibrary && <Button variant="primary" onClick={props.onOpenLibrary}>Browse library</Button>}
        {props.onOpenHome && <Button variant="secondary" onClick={props.onOpenHome}>Go to Home</Button>}
      </div>
    </Card>
  );
}
