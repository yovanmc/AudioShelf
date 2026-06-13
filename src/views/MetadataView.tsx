import { useState } from "react";
import type { MetadataProposal, MetadataApplyReport } from "../lib/api";
import { Button, Card, Notice, PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";

function fieldLabel(field: string): string {
  if (field === "title") return "Work title";
  if (field === "order") return "Chapter order";
  if (field === "tag") return "Genre tag";
  return field;
}

/** Group proposals by work_id, return sorted entries [workId, proposals[]]. */
function groupByWork(proposals: MetadataProposal[]): [number, MetadataProposal[]][] {
  const map = new Map<number, MetadataProposal[]>();
  for (const p of proposals) {
    const arr = map.get(p.workId) ?? [];
    arr.push(p);
    map.set(p.workId, arr);
  }
  return Array.from(map.entries());
}

export function MetadataView(props: {
  proposals: MetadataProposal[];
  result: MetadataApplyReport | null;
  onApply: (accepted: MetadataProposal[]) => void;
  onBack?: () => void;
  onReload: () => void;
}) {
  // Default: all proposals accepted.
  const [checked, setChecked] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const p of props.proposals) s.add(proposalKey(p));
    return s;
  });

  // When proposals change (reload), reset checked state.
  const [lastProposals, setLastProposals] = useState(props.proposals);
  if (props.proposals !== lastProposals) {
    setLastProposals(props.proposals);
    const s = new Set<string>();
    for (const p of props.proposals) s.add(proposalKey(p));
    setChecked(s);
  }

  function proposalKey(p: MetadataProposal) {
    return `${p.workId}:${p.chapterId}:${p.field}`;
  }

  function toggle(p: MetadataProposal) {
    const key = proposalKey(p);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const accepted = props.proposals.filter((p) => checked.has(proposalKey(p)));
  const groups = groupByWork(props.proposals);

  return (
    <main className="view rename">
      <PageHeader
        eyebrow="Import metadata from embedded audio tags into your library — DB-only, files are never modified"
        title="Import metadata"
        actions={props.onBack ? <Button variant="ghost" onClick={props.onBack}>← Back to Settings</Button> : undefined}
      />

      <Card className="view-section" style={{ padding: 20 }}>
        <p className="rename-blurb">
          AudioShelf found <strong>{props.proposals.length}</strong> field{props.proposals.length === 1 ? "" : "s"} in
          your files that differ from your library. Select the changes to import, then click{" "}
          <strong>Apply selected</strong>. Files on disk are never touched.
        </p>

        {props.result ? (
          <Notice tone="success" role="status">
            <p>Applied {props.result.applied} change{props.result.applied === 1 ? "" : "s"}
              {props.result.skipped > 0 ? `, skipped ${props.result.skipped}` : ""}.
            </p>
            <Button variant="ghost" onClick={props.onReload}>
              <Icon name="refresh" /> Refresh preview
            </Button>
          </Notice>
        ) : (
          <Button
            variant="primary"
            disabled={accepted.length === 0}
            onClick={() => props.onApply(accepted)}
          >
            Apply selected ({accepted.length})
          </Button>
        )}
      </Card>

      {props.proposals.length === 0 ? (
        <Card style={{ padding: 20 }}>
          <p className="muted">No differences found between embedded tags and your library.</p>
        </Card>
      ) : (
        groups.map(([workId, items]) => (
          <Card key={workId} style={{ overflow: "hidden", marginBottom: 8 }}>
            <table className="rename-table data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>Field</th>
                  <th>Current</th>
                  <th>Proposed</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const key = proposalKey(p);
                  const isChecked = checked.has(key);
                  return (
                    <tr
                      key={key}
                      className={`rename-row ${isChecked ? "rename-ok" : "rename-noop"}`}
                      onClick={() => toggle(p)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(p)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Accept ${fieldLabel(p.field)} change`}
                        />
                      </td>
                      <td>{fieldLabel(p.field)}</td>
                      <td>{p.current || <em className="muted">none</em>}</td>
                      <td>{p.proposed}</td>
                      <td><span className="badge badge-ok">{p.source}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </main>
  );
}
