import type { ScanResult } from "../lib/api";
import { Card, StatCard } from "../components/ui";

export function ScanView(props: { result: ScanResult | null }) {
  if (!props.result) {
    return <Card className="scan empty-state"><h1>Scanning library</h1><p className="muted">Reading creator folders and grouping chapters...</p></Card>;
  }
  const { authors, works, chapters } = props.result;
  return (
    <Card className="scan" style={{ padding: 24 }}>
      <h1>Library scanned</h1>
      <div className="stats-grid"><StatCard label="Creators" value={authors} /><StatCard label="Works" value={works} /><StatCard label="Chapters" value={chapters} /></div>
    </Card>
  );
}
