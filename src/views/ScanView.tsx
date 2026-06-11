import type { ScanResult } from "../lib/api";

export function ScanView(props: { result: ScanResult | null }) {
  if (!props.result) {
    return <div className="scan">Scanning library…</div>;
  }
  const { authors, works, chapters } = props.result;
  return (
    <div className="scan">
      <h1>Library scanned</h1>
      <p>{authors} authors · {works} works · {chapters} chapters</p>
    </div>
  );
}
