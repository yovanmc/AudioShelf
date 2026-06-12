import { useState } from "react";

export function TagEditor(props: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}) {
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
        list="all-tags"
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
      <datalist id="all-tags">
        {props.allTags.map((t) => <option key={t} value={t} />)}
      </datalist>
    </div>
  );
}
