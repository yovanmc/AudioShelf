import { useState } from "react";
import { Dialog } from "./ui";

export function BulkTagDialog({
  count, allTags, onApply, onClose,
}: {
  count: number;
  allTags: string[];
  onApply: (add: string[], remove: string[]) => void;
  onClose: () => void;
}) {
  const [add, setAdd] = useState("");
  const [remove, setRemove] = useState("");
  const split = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <Dialog label="Bulk tag" onClose={onClose} className="bulk-tag-dialog">
      <h2>Tag {count} work{count !== 1 ? "s" : ""}</h2>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Add tags (comma-separated)
        <input list="bulk-tag-add-list" value={add} onChange={(e) => setAdd(e.target.value)} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
        Remove tags (comma-separated)
        <input list="bulk-tag-remove-list" value={remove} onChange={(e) => setRemove(e.target.value)} />
      </label>
      <datalist id="bulk-tag-add-list">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="bulk-tag-remove-list">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="dialog__actions">
        <button className="button button--ghost" onClick={onClose}>Cancel</button>
        <button
          className="button button--accent"
          onClick={() => { onApply(split(add), split(remove)); onClose(); }}
        >
          Apply
        </button>
      </div>
    </Dialog>
  );
}
