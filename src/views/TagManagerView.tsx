import { useState } from "react";
import { Button, Dialog, EmptyState, Notice, SectionHeading, TagGroup } from "../components/ui";
import type { TagStat } from "../lib/api";

// ---- inline rename form -------------------------------------------------------

function RenameRow({
  tag,
  onRename,
}: {
  tag: string;
  onRename: (from: string, to: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tag);

  function submit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== tag) {
      onRename(tag, trimmed);
    }
    setEditing(false);
    setValue(tag);
  }

  if (!editing) {
    return (
      <Button variant="ghost" onClick={() => { setValue(tag); setEditing(true); }}>
        Rename
      </Button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        data-autofocus
        type="text"
        value={value}
        aria-label={`Rename ${tag} to`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") { setEditing(false); setValue(tag); }
        }}
        style={{ width: 140 }}
      />
      <Button variant="primary" onClick={submit}>OK</Button>
      <Button variant="secondary" onClick={() => { setEditing(false); setValue(tag); }}>Cancel</Button>
    </span>
  );
}

// ---- alias editor row --------------------------------------------------------

function AliasRow({
  tag,
  onSetAlias,
  onClearAlias,
}: {
  tag: string;
  onSetAlias: (alias: string, canonical: string) => void;
  onClearAlias: (alias: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [canonical, setCanonical] = useState("");

  function submit() {
    const c = canonical.trim();
    if (c) {
      onSetAlias(tag, c);
    } else {
      onClearAlias(tag);
    }
    setOpen(false);
    setCanonical("");
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Add alias
      </Button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <span className="muted" style={{ fontSize: "0.85em" }}>{tag} →</span>
      <input
        data-autofocus
        type="text"
        value={canonical}
        placeholder="standardized name (blank = clear)"
        aria-label={`Set ${tag} as alias of`}
        onChange={(e) => setCanonical(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") { setOpen(false); setCanonical(""); }
        }}
        style={{ width: 160 }}
      />
      <Button variant="primary" onClick={submit}>OK</Button>
      <Button variant="secondary" onClick={() => { setOpen(false); setCanonical(""); }}>Cancel</Button>
    </span>
  );
}

// ---- merge dialog ------------------------------------------------------------

function MergeDialog({
  selected,
  allTags,
  onMerge,
  onClose,
}: {
  selected: string[];
  allTags: string[];
  onMerge: (sources: string[], target: string) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(selected[0] ?? "");

  function submit() {
    const t = target.trim();
    if (!t) return;
    onMerge(selected, t);
    onClose();
  }

  return (
    <Dialog label="Merge tags" onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Merge tags</h2>
      <p>
        All usages of{" "}
        <TagGroup tags={selected} />{" "}
        will be replaced by the target tag. This cannot be undone.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <label htmlFor="merge-target-select">Merge into</label>
        <select
          id="merge-target-select"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Merge target"
        >
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          <option value="">— enter a new tag —</option>
        </select>
        {target === "" && (
          <input
            type="text"
            placeholder="new tag name"
            aria-label="New merge target"
            onChange={(e) => setTarget(e.target.value)}
            style={{ width: 140 }}
          />
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="danger" onClick={submit} disabled={!target.trim()}>
          Merge
        </Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}

// ---- main view ---------------------------------------------------------------

export interface TagManagerViewProps {
  tags: TagStat[];
  onRename: (from: string, to: string) => void;
  onMerge: (sources: string[], target: string) => void;
  onSetAlias: (alias: string, canonical: string) => void;
  onClearAlias: (alias: string) => void;
}

export function TagManagerView({
  tags,
  onRename,
  onMerge,
  onSetAlias,
  onClearAlias: onClearAliasCallback,
}: TagManagerViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showMerge, setShowMerge] = useState(false);

  function toggleSelect(tag: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const selectedArray = Array.from(selected);
  const allTagNames = tags.map((t) => t.tag);

  if (tags.length === 0) {
    return (
      <EmptyState title="No tags yet">
        Add tags to authors, works, or chapters to see them here.
      </EmptyState>
    );
  }

  return (
    <div>
      <SectionHeading
        title="Tag manager"
        eyebrow="Library intelligence"
        actions={
          selected.size >= 2 ? (
            <Button variant="secondary" onClick={() => setShowMerge(true)}>
              Merge {selected.size} tags…
            </Button>
          ) : undefined
        }
      />

      {selected.size > 0 && selected.size < 2 && (
        <Notice tone="info">Select at least 2 tags to merge them.</Notice>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th style={{ width: 28, padding: "6px 4px" }}></th>
            <th style={{ padding: "6px 8px" }}>Tag</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Authors</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Works</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Chapters</th>
            <th style={{ padding: "6px 8px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((stat) => (
            <tr
              key={stat.tag}
              style={{ borderTop: "1px solid var(--border, #e0e0e0)" }}
            >
              <td style={{ padding: "6px 4px", textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={selected.has(stat.tag)}
                  onChange={() => toggleSelect(stat.tag)}
                  aria-label={`Select ${stat.tag}`}
                />
              </td>
              <td style={{ padding: "6px 8px", fontWeight: 500 }}>{stat.tag}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{stat.authorCount}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{stat.workCount}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{stat.chapterCount}</td>
              <td style={{ padding: "6px 8px", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                <RenameRow tag={stat.tag} onRename={onRename} />
                <AliasRow tag={stat.tag} onSetAlias={onSetAlias} onClearAlias={onClearAliasCallback} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showMerge && (
        <MergeDialog
          selected={selectedArray}
          allTags={allTagNames}
          onMerge={onMerge}
          onClose={() => { setShowMerge(false); setSelected(new Set()); }}
        />
      )}
    </div>
  );
}
