import { useState } from "react";
import type { LabelType, MetaTerm, TagStat } from "../lib/api";
import { Button, Dialog, Notice, SectionHeading, TagGroup } from "../components/ui";

// ---------------------------------------------------------------------------
// Props interface — reported to T11
// ---------------------------------------------------------------------------

export interface LabelManagerViewProps {
  // ---- Types section ----
  labelTypes: LabelType[];
  onCreateType: (name: string, display: string) => void;
  onRenameType: (name: string, display: string) => void;
  onDeleteType: (name: string) => void;
  onReorderTypes: (names: string[]) => void;

  // ---- Labels (terms) section — grouped by type ----
  terms: MetaTerm[];
  onCreateTerm: (facet: string, value: string) => void;
  onRenameTerm: (id: number, value: string) => void;
  onDeleteTerm: (id: number) => void;
  onMergeTerms: (sourceIds: number[], targetId: number) => void;

  // ---- Tag section (built-in "tag" type uses TagStat list) ----
  tags?: TagStat[];
  onRenameTag?: (from: string, to: string) => void;
  onMergeTag?: (sources: string[], target: string) => void;
  onSetTagAlias?: (alias: string, canonical: string) => void;
  onClearTagAlias?: (alias: string) => void;
}

// ---------------------------------------------------------------------------
// Types section — add / rename / delete / reorder
// ---------------------------------------------------------------------------

function AddTypeForm({ onAdd }: { onAdd: (name: string, display: string) => void }) {
  const [name, setName] = useState("");
  const [display, setDisplay] = useState("");

  function submit() {
    const n = name.trim().toLowerCase().replace(/\s+/g, "_");
    const d = display.trim();
    if (!n || !d) return;
    onAdd(n, d);
    setName("");
    setDisplay("");
  }

  return (
    <div
      className="toolbar card"
      style={{ padding: 12, gap: 8, display: "flex", alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}
    >
      <input
        aria-label="New type key (e.g. genre)"
        placeholder="key (e.g. genre)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        style={{ width: 140 }}
      />
      <input
        aria-label="New type display name (e.g. Genre)"
        placeholder="display name (e.g. Genre)"
        value={display}
        onChange={(e) => setDisplay(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        style={{ width: 160 }}
      />
      <Button variant="primary" onClick={submit} disabled={!name.trim() || !display.trim()}>
        Add type
      </Button>
    </div>
  );
}

function TypeRow({
  type,
  index,
  total,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  type: LabelType;
  index: number;
  total: number;
  onRename: (name: string, display: string) => void;
  onDelete: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(type.display);

  function submit() {
    const d = draft.trim();
    if (d && d !== type.display) {
      onRename(type.name, d);
    }
    setEditing(false);
    setDraft(type.display);
  }

  return (
    <tr style={{ borderTop: "1px solid var(--border, #2a2a2a)" }}>
      <td style={{ padding: "6px 8px", fontWeight: 500 }}>
        {editing ? (
          <input
            data-autofocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") { setEditing(false); setDraft(type.display); }
            }}
            aria-label={`Rename type ${type.display}`}
            style={{ width: 160 }}
          />
        ) : (
          <>
            {type.display}{" "}
            {type.builtin && (
              <span
                className="chip"
                aria-label="built-in type"
                style={{
                  fontSize: "0.75em",
                  background: "var(--color-accent-soft, rgba(255,255,255,0.12))",
                  borderRadius: 4,
                  padding: "1px 6px",
                  marginLeft: 4,
                  color: "var(--color-accent, #7c9ef8)",
                }}
              >
                built-in
              </span>
            )}
          </>
        )}
      </td>
      <td style={{ padding: "6px 8px", color: "var(--text-muted, #888)", fontSize: "0.85em" }}>{type.name}</td>
      <td style={{ padding: "6px 8px", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {editing ? (
          <>
            <Button variant="primary" onClick={submit}>Save</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setDraft(type.display); }}>Cancel</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>Rename</Button>
            <Button
              variant="ghost"
              onClick={() => onDelete(type.name)}
              disabled={type.builtin}
              aria-label={type.builtin ? `Cannot delete built-in type ${type.display}` : `Delete type ${type.display}`}
            >
              Delete
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label={`Move ${type.display} up`}
        >
          ▲
        </Button>
        <Button
          variant="secondary"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label={`Move ${type.display} down`}
        >
          ▼
        </Button>
      </td>
    </tr>
  );
}

function TypesSection({
  labelTypes,
  onCreateType,
  onRenameType,
  onDeleteType,
  onReorderTypes,
}: Pick<LabelManagerViewProps, "labelTypes" | "onCreateType" | "onRenameType" | "onDeleteType" | "onReorderTypes">) {
  function moveType(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= labelTypes.length) return;
    const names = labelTypes.map((t) => t.name);
    const next = [...names];
    [next[index], next[j]] = [next[j], next[index]];
    onReorderTypes(next);
  }

  return (
    <section aria-label="Label types" style={{ marginBottom: 28 }}>
      <SectionHeading title="Types" eyebrow="Types & Labels" />
      <p className="muted" style={{ marginBottom: 12 }}>
        Define the kinds of labels you can apply to files and creators. Built-in types cannot be deleted.
      </p>
      <AddTypeForm onAdd={onCreateType} />
      {labelTypes.length === 0 ? (
        <p className="muted">No label types yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Display name</th>
              <th style={{ padding: "6px 8px" }}>Key</th>
              <th style={{ padding: "6px 8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {labelTypes.map((t, i) => (
              <TypeRow
                key={t.name}
                type={t}
                index={i}
                total={labelTypes.length}
                onRename={onRenameType}
                onDelete={onDeleteType}
                onMoveUp={() => moveType(i, -1)}
                onMoveDown={() => moveType(i, 1)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Labels (terms) section — grouped by type, with merge multi-select
// ---------------------------------------------------------------------------

function TermRow({
  term,
  selected,
  onToggle,
  onRename,
  onDelete,
}: {
  term: MetaTerm;
  selected: boolean;
  onToggle: () => void;
  onRename: (id: number, value: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(term.value);

  return (
    <tr style={{ borderTop: "1px solid var(--border, #2a2a2a)" }}>
      <td style={{ textAlign: "center", padding: "6px 4px" }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${term.value}`}
        />
      </td>
      <td style={{ padding: "6px 8px", fontWeight: 500 }}>
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`Rename ${term.value}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = draft.trim();
                if (v) onRename(term.id, v);
                setEditing(false);
              }
              if (e.key === "Escape") { setEditing(false); setDraft(term.value); }
            }}
          />
        ) : (
          term.value
        )}
      </td>
      <td style={{ padding: "6px 8px", textAlign: "right" }}>{term.chapterCount}</td>
      <td style={{ padding: "6px 8px", textAlign: "right" }}>{term.authorCount}</td>
      <td style={{ padding: "6px 8px", display: "flex", gap: 4 }}>
        {editing ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                const v = draft.trim();
                if (v) onRename(term.id, v);
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(term.value);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
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

/** Merge dialog for terms (uses numeric IDs). */
function TermMergeDialog({
  selectedIds,
  terms,
  onMerge,
  onClose,
}: {
  selectedIds: number[];
  terms: MetaTerm[];
  onMerge: (sourceIds: number[], targetId: number) => void;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState<number>(selectedIds[0] ?? -1);

  function submit() {
    if (targetId < 0) return;
    const sources = selectedIds.filter((id) => id !== targetId);
    onMerge(sources, targetId);
    onClose();
  }

  const selectedTerms = selectedIds.map((id) => terms.find((t) => t.id === id)?.value ?? String(id));

  return (
    <Dialog label="Merge labels" onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Merge labels</h2>
      <p>
        All usages of{" "}
        <TagGroup tags={selectedTerms} />{" "}
        will be merged into the target. This cannot be undone.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <label htmlFor="term-merge-target-select">Merge into</label>
        <select
          id="term-merge-target-select"
          value={targetId}
          onChange={(e) => setTargetId(Number(e.target.value))}
          aria-label="Merge target"
        >
          {terms
            .filter((t) => selectedIds.includes(t.id))
            .map((t) => (
              <option key={t.id} value={t.id}>{t.value}</option>
            ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="danger" onClick={submit} disabled={targetId < 0}>
          Merge
        </Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}

function FacetGroup({
  facet,
  displayName,
  terms,
  onCreateTerm,
  onRenameTerm,
  onDeleteTerm,
  onMergeTerms,
}: {
  facet: string;
  displayName: string;
  terms: MetaTerm[];
  onCreateTerm: (facet: string, value: string) => void;
  onRenameTerm: (id: number, value: string) => void;
  onDeleteTerm: (id: number) => void;
  onMergeTerms: (sourceIds: number[], targetId: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showMerge, setShowMerge] = useState(false);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitCreate() {
    const v = draft.trim();
    if (!v) return;
    onCreateTerm(facet, v);
    setDraft("");
  }

  return (
    <section
      className="view-section"
      aria-label={displayName}
      style={{ marginBottom: 24 }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: "1em" }}>{displayName}</h3>
      <div
        className="toolbar card"
        style={{ padding: 10, gap: 8, display: "flex", alignItems: "center", marginBottom: 8 }}
      >
        <input
          aria-label={`New ${facet} value`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }}
          placeholder={`Add a ${facet}…`}
        />
        <Button variant="primary" onClick={submitCreate} disabled={!draft.trim()}>
          Add {displayName.toLowerCase()}
        </Button>
        {selected.size >= 2 && (
          <Button variant="secondary" onClick={() => setShowMerge(true)}>
            Merge {selected.size}…
          </Button>
        )}
      </div>

      {selected.size === 1 && (
        <Notice tone="info">Select at least 2 labels to merge them.</Notice>
      )}

      {terms.length === 0 ? (
        <p className="muted" style={{ padding: "4px 0" }}>None yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
              <TermRow
                key={t.id}
                term={t}
                selected={selected.has(t.id)}
                onToggle={() => toggle(t.id)}
                onRename={onRenameTerm}
                onDelete={onDeleteTerm}
              />
            ))}
          </tbody>
        </table>
      )}

      {showMerge && (
        <TermMergeDialog
          selectedIds={Array.from(selected)}
          terms={terms}
          onMerge={(sources, target) => {
            onMergeTerms(sources, target);
            setSelected(new Set());
          }}
          onClose={() => { setShowMerge(false); setSelected(new Set()); }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tag section — uses TagStat + multi-select merge (from TagManagerView)
// ---------------------------------------------------------------------------

function TagRenameRow({
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

function TagAliasRow({
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

function TagMergeDialog({
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
        <label htmlFor="tag-merge-target-select">Merge into</label>
        <select
          id="tag-merge-target-select"
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

function TagSection({
  tags,
  onRenameTag,
  onMergeTag,
  onSetTagAlias,
  onClearTagAlias,
}: {
  tags: TagStat[];
  onRenameTag: (from: string, to: string) => void;
  onMergeTag: (sources: string[], target: string) => void;
  onSetTagAlias: (alias: string, canonical: string) => void;
  onClearTagAlias: (alias: string) => void;
}) {
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
    return <p className="muted">No tags yet. Add tags to authors, works, or chapters to see them here.</p>;
  }

  return (
    <section aria-label="Tags" style={{ marginBottom: 24 }}>
      {selected.size > 0 && selected.size < 2 && (
        <Notice tone="info">Select at least 2 tags to merge them.</Notice>
      )}
      {selected.size >= 2 && (
        <div style={{ marginBottom: 8 }}>
          <Button variant="secondary" onClick={() => setShowMerge(true)}>
            Merge {selected.size} tags…
          </Button>
        </div>
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
                <TagRenameRow tag={stat.tag} onRename={onRenameTag} />
                <TagAliasRow tag={stat.tag} onSetAlias={onSetTagAlias} onClearAlias={onClearTagAlias} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showMerge && (
        <TagMergeDialog
          selected={selectedArray}
          allTags={allTagNames}
          onMerge={onMergeTag}
          onClose={() => { setShowMerge(false); setSelected(new Set()); }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function LabelManagerView({
  labelTypes,
  onCreateType,
  onRenameType,
  onDeleteType,
  onReorderTypes,
  terms,
  onCreateTerm,
  onRenameTerm,
  onDeleteTerm,
  onMergeTerms,
  tags,
  onRenameTag,
  onMergeTag,
  onSetTagAlias,
  onClearTagAlias,
}: LabelManagerViewProps) {
  return (
    <div>
      {/* ---- Types section ---- */}
      <TypesSection
        labelTypes={labelTypes}
        onCreateType={onCreateType}
        onRenameType={onRenameType}
        onDeleteType={onDeleteType}
        onReorderTypes={onReorderTypes}
      />

      {/* ---- Labels section — grouped by type ---- */}
      <SectionHeading title="Labels" eyebrow="Types & Labels" />
      <p className="muted" style={{ marginBottom: 16 }}>
        Create and manage the values applied to files and creators. Each group corresponds to a label type.
      </p>

      {labelTypes.length === 0 && terms.length === 0 ? (
        <p className="muted">No label types or labels yet.</p>
      ) : (
        <>
          {/* Non-tag types rendered via FacetGroup (using MetaTerm list) */}
          {labelTypes
            .filter((lt) => lt.name !== "tag")
            .map((lt) => (
              <FacetGroup
                key={lt.name}
                facet={lt.name}
                displayName={lt.display}
                terms={terms.filter((t) => t.facet === lt.name)}
                onCreateTerm={onCreateTerm}
                onRenameTerm={onRenameTerm}
                onDeleteTerm={onDeleteTerm}
                onMergeTerms={onMergeTerms}
              />
            ))}

          {/* Tag type — uses TagStat list with alias + multi-select merge */}
          {labelTypes.some((lt) => lt.name === "tag") &&
            tags !== undefined &&
            onRenameTag &&
            onMergeTag &&
            onSetTagAlias &&
            onClearTagAlias && (
              <section aria-label="Tag" style={{ marginBottom: 24 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: "1em" }}>Tag</h3>
                <TagSection
                  tags={tags}
                  onRenameTag={onRenameTag}
                  onMergeTag={onMergeTag}
                  onSetTagAlias={onSetTagAlias}
                  onClearTagAlias={onClearTagAlias}
                />
              </section>
            )}
        </>
      )}
    </div>
  );
}
