import { useEffect, useState } from "react";
import { PageHeader, EmptyState, Button } from "../components/ui";
import { Icon } from "../components/Icon";
import { ScopedResults } from "../components/ScopedResults";
import { queryPlayedInRange } from "../lib/api";
import type { ScopedResults as Results } from "../lib/api";

export function PlayedRangeView(props: {
  startMs: number;
  endMs: number;
  label: string;
  onOpenAuthor: (authorId: number) => void;
  onBack: () => void;
}) {
  const [results, setResults] = useState<Results | null>(null);

  useEffect(() => {
    let live = true;
    queryPlayedInRange(props.startMs, props.endMs).then((r) => {
      if (live) setResults(r);
    });
    return () => { live = false; };
  }, [props.startMs, props.endMs]);

  return (
    <div className="view">
      <Button variant="ghost" onClick={props.onBack}><Icon name="chevronLeft" /> Insights</Button>
      <PageHeader eyebrow="Insights" title={`Played · ${props.label}`} />
      {results == null ? (
        <p>Loading…</p>
      ) : results.works.length === 0 ? (
        <EmptyState title="Nothing played in this period">
          No chapters were finished during this time window.
        </EmptyState>
      ) : (
        <ScopedResults results={results} onOpenAuthor={props.onOpenAuthor} />
      )}
    </div>
  );
}
