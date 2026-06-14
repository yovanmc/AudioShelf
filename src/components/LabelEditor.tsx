import { useId, useState } from "react";
import type { LabelType, MetaTag } from "../lib/api";

export interface LabelEditorProps {
  applied: MetaTag[];            // all currently-attached labels (all facets)
  labelTypes: LabelType[];       // ordered types to render rows for (already in sort order)
  suggestions?: string[];        // optional global value suggestions for the datalist
  onAdd: (type: string, value: string) => void;   // type = facet name
  onRemove: (termId: number) => void;
}

/** Unified label editor — one row per label type.
 *
 *  Replaces the old TagEditor + MetadataEditor pair. All label types (including
 *  the built-in "tag" bucket) are first-class rows; the caller supplies the ordered
 *  list via `labelTypes`. */
export function LabelEditor({ applied, labelTypes, suggestions, onAdd, onRemove }: LabelEditorProps) {
  const listId = useId();
  return (
    <div className="label-editor">
      <datalist id={listId}>
        {(suggestions ?? []).map((s) => <option key={s} value={s} />)}
      </datalist>
      <p className="muted field-hint">Labels — attach tags, narrator, language, mood, and any custom types you create. Browse and filter by them in Discover.</p>
      {labelTypes.map((t) => (
        <LabelTypeRow
          key={t.name}
          type={t}
          datalistId={listId}
          values={applied.filter((l) => l.facet === t.name)}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function LabelTypeRow({ type, datalistId, values, onAdd, onRemove }: {
  type: LabelType;
  datalistId: string;
  values: MetaTag[];
  onAdd: (typeName: string, value: string) => void;
  onRemove: (termId: number) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const v = draft.trim();
    if (!v) return;
    onAdd(type.name, v);
    setDraft("");
  }

  return (
    <div
      className="label-editor__row"
      style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "4px 0" }}
    >
      <span className="muted" style={{ minWidth: 72 }}>{type.display}</span>
      {values.map((l) => (
        <span key={l.termId} className="chip">
          {l.value}
          <button
            type="button"
            className="chip__x"
            aria-label={`Remove ${l.value}`}
            onClick={() => onRemove(l.termId)}
          >×</button>
        </span>
      ))}
      <input
        aria-label={`Add ${type.name} label`}
        list={datalistId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={`+ ${type.display.toLowerCase()}`}
        style={{ width: 140 }}
      />
    </div>
  );
}
