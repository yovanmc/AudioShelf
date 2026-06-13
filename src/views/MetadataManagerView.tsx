import { useState } from "react";
import type { MetaTerm } from "../lib/api";
import { Button, SectionHeading } from "../components/ui";

const FACETS: { key: string; label: string }[] = [
  { key: "narrator", label: "Narrator" },
  { key: "language", label: "Language" },
  { key: "mood", label: "Mood" },
];

export interface MetadataManagerViewProps {
  terms: MetaTerm[];
  onCreate: (facet: string, value: string) => void;
  onRename: (id: number, value: string) => void;
  onDelete: (id: number) => void;
  onMerge: (sourceIds: number[], targetId: number) => void;
}

export function MetadataManagerView({ terms, onCreate, onRename, onDelete, onMerge }: MetadataManagerViewProps) {
  return (
    <div>
      <SectionHeading title="Metadata" eyebrow="Faceted values applied to files and creators" />
      {FACETS.map((f) => (
        <FacetSection
          key={f.key}
          facet={f.key}
          label={f.label}
          terms={terms.filter((t) => t.facet === f.key)}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
          onMerge={onMerge}
        />
      ))}
    </div>
  );
}

function FacetSection({ facet, label, terms, onCreate, onRename, onDelete, onMerge }: {
  facet: string; label: string; terms: MetaTerm[];
  onCreate: (facet: string, value: string) => void;
  onRename: (id: number, value: string) => void;
  onDelete: (id: number) => void;
  onMerge: (sourceIds: number[], targetId: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function submit() {
    const v = draft.trim();
    if (!v) return;
    onCreate(facet, v);
    setDraft("");
  }
  function mergeSelected() {
    const ids = Array.from(selected);
    if (ids.length < 2) return;
    // Merge the rest into the first selected (by display order).
    const [target, ...sources] = ids;
    onMerge(sources, target);
    setSelected(new Set());
  }

  return (
    <section className="view-section" aria-label={label} style={{ marginBottom: 20 }}>
      <div className="toolbar card" style={{ padding: 12, gap: 8, display: "flex", alignItems: "center" }}>
        <input
          aria-label={`New ${facet} value`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={`Add a ${facet}…`}
        />
        <Button variant="primary" onClick={submit}>Add {facet}</Button>
        {selected.size >= 2 && (
          <Button variant="secondary" onClick={mergeSelected}>Merge {selected.size}…</Button>
        )}
      </div>
      {terms.length === 0 ? (
        <p className="muted" style={{ padding: "8px 0" }}>None yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ width: 28 }} />
              <th style={{ padding: "6px 8px" }}>Value</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Files</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Creators</th>
              <th style={{ padding: "6px 8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <TermRow key={t.id} term={t} selected={selected.has(t.id)} onToggle={() => toggle(t.id)} onRename={onRename} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TermRow({ term, selected, onToggle, onRename, onDelete }: {
  term: MetaTerm; selected: boolean; onToggle: () => void;
  onRename: (id: number, value: string) => void; onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(term.value);
  return (
    <tr style={{ borderTop: "1px solid var(--border, #2a2a2a)" }}>
      <td style={{ textAlign: "center" }}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${term.value}`} />
      </td>
      <td style={{ padding: "6px 8px", fontWeight: 500 }}>
        {editing ? (
          <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Rename ${term.value}`} />
        ) : (
          term.value
        )}
      </td>
      <td style={{ padding: "6px 8px", textAlign: "right" }}>{term.chapterCount}</td>
      <td style={{ padding: "6px 8px", textAlign: "right" }}>{term.authorCount}</td>
      <td style={{ padding: "6px 8px", display: "flex", gap: 4 }}>
        {editing ? (
          <>
            <Button variant="primary" onClick={() => { const v = draft.trim(); if (v) onRename(term.id, v); setEditing(false); }}>Save</Button>
            <Button variant="ghost" onClick={() => { setDraft(term.value); setEditing(false); }}>Cancel</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>Rename</Button>
            <Button variant="ghost" onClick={() => onDelete(term.id)}>Delete</Button>
          </>
        )}
      </td>
    </tr>
  );
}
