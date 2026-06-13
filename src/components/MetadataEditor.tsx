import { useId, useState } from "react";
import type { MetaTag } from "../lib/api";

const FACETS: { key: string; label: string }[] = [
  { key: "narrator", label: "Narrator" },
  { key: "language", label: "Language" },
  { key: "mood", label: "Mood" },
];

/** Reusable facet editor for one entity (a chapter or an author). Pure/prop-driven:
 *  it renders the applied terms grouped by facet and emits add/remove intents. */
export function MetadataEditor({ applied, suggestions, onAdd, onRemove }: {
  applied: MetaTag[];
  suggestions: string[];           // existing values across facets, for the datalist
  onAdd: (facet: string, value: string) => void;
  onRemove: (termId: number) => void;
}) {
  const listId = useId();
  return (
    <div className="metadata-editor">
      <datalist id={listId}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      {FACETS.map((f) => (
        <FacetRow
          key={f.key}
          facet={f.key}
          label={f.label}
          datalistId={listId}
          values={applied.filter((m) => m.facet === f.key)}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function FacetRow({ facet, label, datalistId, values, onAdd, onRemove }: {
  facet: string; label: string; datalistId: string; values: MetaTag[];
  onAdd: (facet: string, value: string) => void; onRemove: (termId: number) => void;
}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const v = draft.trim();
    if (!v) return;
    onAdd(facet, v);
    setDraft("");
  }
  return (
    <div className="metadata-editor__row" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "4px 0" }}>
      <span className="muted" style={{ minWidth: 72 }}>{label}</span>
      {values.map((m) => (
        <span key={m.termId} className="chip">
          {m.value}
          <button type="button" className="chip__x" aria-label={`Remove ${m.value}`} onClick={() => onRemove(m.termId)}>×</button>
        </span>
      ))}
      <input
        aria-label={`Add ${facet} value`}
        list={datalistId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        placeholder={`+ ${facet}`}
        style={{ width: 120 }}
      />
    </div>
  );
}
