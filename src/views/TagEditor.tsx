import { useId, useState } from "react";

export function TagEditor(props: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
  /** Optional auto-tag suggestion chips (one-click add). */
  suggestions?: string[];
}) {
  const listId = useId();
  const [value, setValue] = useState("");

  function add() {
    const t = value.trim();
    if (t === "" || props.tags.includes(t)) {
      setValue("");
      return;
    }
    props.onChange([...props.tags, t]);
    setValue("");
  }

  function remove(tag: string) {
    props.onChange(props.tags.filter((t) => t !== tag));
  }

  function addSuggestion(tag: string) {
    if (props.tags.includes(tag)) return;
    props.onChange([...props.tags, tag]);
  }

  return (
    <div className="tag-editor">
      <ul className="tag-list chips" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {props.tags.map((t) => (
          <li key={t} className="tag-chip chip">
            <span>{t}</span>
            <button aria-label={`Remove tag ${t}`} onClick={() => remove(t)}>×</button>
          </li>
        ))}
      </ul>
      <input
        list={listId}
        placeholder="Add tag"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <datalist id={listId}>
        {props.allTags.map((t) => <option key={t} value={t} />)}
      </datalist>
      {props.suggestions && props.suggestions.length > 0 && (
        <div className="tag-suggestions" aria-label="Suggested tags">
          {props.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="chip chip--suggestion"
              aria-label={`Add suggested tag ${s}`}
              onClick={() => addSuggestion(s)}
            >+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
