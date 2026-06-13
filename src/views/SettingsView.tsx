import { useState } from "react";
import type { ScanResult, TagStat, Collection, ImportReport, HealthReport } from "../lib/api";
import { Button, Card, Notice, PageHeader } from "../components/ui";
import { Icon } from "../components/Icon";
import type { HomeShelf, ShelfKind } from "../lib/shelves";
import type { PlayedStatus } from "../lib/browse";
import { TagManagerView } from "./TagManagerView";
import { MetadataManagerView } from "./MetadataManagerView";
import type { MetaTerm } from "../lib/api";
import type { Density } from "../lib/density";
import type { A11yPrefs, Theme, TextSize } from "../lib/a11y";

const STATUS_LABELS: Record<PlayedStatus, string> = {
  all: "All",
  unplayed: "Has unplayed",
  done: "Fully played",
  unstarted: "Not started",
};

function ShelfKindSummary({ shelf }: { shelf: HomeShelf }) {
  if (shelf.kind === "tag") return <span className="muted">Tag: {shelf.tag ?? "—"}</span>;
  if (shelf.kind === "creator") return <span className="muted">Creator shelf</span>;
  if (shelf.kind === "status") return <span className="muted">Status: {shelf.status ? STATUS_LABELS[shelf.status] : "—"}</span>;
  return null;
}

function AddShelfForm({
  allTags,
  authors,
  onAddShelf,
}: {
  allTags: string[];
  authors: { id: number; name: string }[];
  onAddShelf: (shelf: Omit<HomeShelf, "id">) => void;
}) {
  const [kind, setKind] = useState<ShelfKind>("tag");
  const [tag, setTag] = useState(allTags[0] ?? "");
  const [authorId, setAuthorId] = useState<number>(authors[0]?.id ?? 0);
  const [status, setStatus] = useState<PlayedStatus>("unplayed");
  const [title, setTitle] = useState("");

  // Derive a default title from the target when kind/target changes
  function defaultTitle(k: ShelfKind, t: string, aId: number, st: PlayedStatus): string {
    if (k === "tag") return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
    if (k === "creator") return authors.find((a) => a.id === aId)?.name ?? "";
    if (k === "status") return STATUS_LABELS[st] ?? "";
    return "";
  }

  function handleKindChange(k: ShelfKind) {
    setKind(k);
    setTitle(defaultTitle(k, tag, authorId, status));
  }
  function handleTagChange(t: string) {
    setTag(t);
    if (kind === "tag") setTitle(defaultTitle("tag", t, authorId, status));
  }
  function handleAuthorChange(id: number) {
    setAuthorId(id);
    if (kind === "creator") setTitle(defaultTitle("creator", tag, id, status));
  }
  function handleStatusChange(st: PlayedStatus) {
    setStatus(st);
    if (kind === "status") setTitle(defaultTitle("status", tag, authorId, st));
  }

  function handleAdd() {
    const effectiveTitle = title.trim() || defaultTitle(kind, tag, authorId, status);
    if (!effectiveTitle) return;
    const base = { kind, title: effectiveTitle };
    if (kind === "tag") onAddShelf({ ...base, tag });
    else if (kind === "creator") onAddShelf({ ...base, authorId });
    else onAddShelf({ ...base, status });
    // Reset
    setTitle("");
  }

  return (
    <div className="add-shelf-form" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      <h3 style={{ margin: 0 }}>Add a shelf</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Kind
          <select
            value={kind}
            onChange={(e) => handleKindChange(e.target.value as ShelfKind)}
            aria-label="Shelf kind"
            style={{ marginLeft: 6 }}
          >
            <option value="tag">Tag</option>
            <option value="creator">Creator</option>
            <option value="status">Played status</option>
          </select>
        </label>

        {kind === "tag" && (
          <label>
            Tag
            <select
              value={tag}
              onChange={(e) => handleTagChange(e.target.value)}
              aria-label="Tag"
              style={{ marginLeft: 6 }}
            >
              {allTags.length === 0
                ? <option value="">— no tags —</option>
                : allTags.map((t) => <option key={t} value={t}>{t}</option>)
              }
            </select>
          </label>
        )}

        {kind === "creator" && (
          <label>
            Creator
            <select
              value={authorId}
              onChange={(e) => handleAuthorChange(Number(e.target.value))}
              aria-label="Creator"
              style={{ marginLeft: 6 }}
            >
              {authors.length === 0
                ? <option value={0}>— no creators —</option>
                : authors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)
              }
            </select>
          </label>
        )}

        {kind === "status" && (
          <label>
            Status
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as PlayedStatus)}
              aria-label="Status"
              style={{ marginLeft: 6 }}
            >
              <option value="all">All</option>
              <option value="unplayed">Has unplayed</option>
              <option value="done">Fully played</option>
              <option value="unstarted">Not started</option>
            </select>
          </label>
        )}

        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={defaultTitle(kind, tag, authorId, status) || "Shelf title"}
            aria-label="Shelf title"
            style={{ marginLeft: 6 }}
          />
        </label>

        <Button variant="primary" onClick={handleAdd}>Add</Button>
      </div>
    </div>
  );
}

export function SettingsView(props: {
  root: string | null;
  lastScan: ScanResult | null;
  scanError: string | null;
  busy: boolean;
  firstRun: boolean;
  onChooseFolder: () => void;
  onRescan: () => void;
  onBack?: () => void;
  // Home shelves management (optional — existing tests omit these)
  shelves?: HomeShelf[];
  allTags?: string[];
  authors?: { id: number; name: string }[];
  onAddShelf?: (shelf: Omit<HomeShelf, "id">) => void;
  onRemoveShelf?: (id: string) => void;
  onMoveShelf?: (id: string, dir: -1 | 1) => void;
  onRenameShelf?: (id: string, title: string) => void;
  // Tag manager (optional — existing tests omit these)
  tagStats?: TagStat[];
  onRenameTag?: (from: string, to: string) => void;
  onMergeTags?: (sources: string[], target: string) => void;
  onSetTagAlias?: (alias: string, canonical: string) => void;
  onClearTagAlias?: (alias: string) => void;
  // Metadata vocabulary manager (optional — existing tests omit these)
  metaTerms?: MetaTerm[];
  onCreateMetaTerm?: (facet: string, value: string) => void;
  onRenameMetaTerm?: (id: number, value: string) => void;
  onDeleteMetaTerm?: (id: number) => void;
  onMergeMetaTerms?: (sourceIds: number[], targetId: number) => void;
  // Smart collections (optional — existing tests omit these)
  collections?: Collection[];
  onCreateCollection?: (name: string, query: string) => void;
  onDeleteCollection?: (id: number) => void;
  onReorderCollections?: (ids: number[]) => void;
  // Library tools (optional — existing tests omit these)
  onOpenRename?: () => void;
  onOpenMetadata?: () => void;
  // Density (optional — existing tests omit these)
  density?: Density;
  onDensityChange?: (d: Density) => void;
  // Accessibility (optional — existing tests omit these)
  a11y?: A11yPrefs;
  onA11yChange?: (next: A11yPrefs) => void;
  // Backup & maintenance (optional — existing tests omit these)
  onExportJson?: () => void;
  onExportSnapshot?: () => void;
  onImportJson?: () => void;
  onRestoreSnapshot?: () => void;
  onHealthScan?: () => void;
  importReport?: ImportReport | null;
  healthReport?: HealthReport | null;
  restoreStaged?: boolean;
}) {
  const { root, lastScan, scanError, busy, firstRun } = props;
  const shelves = props.shelves ?? [];
  const allTags = props.allTags ?? [];
  const authors = props.authors ?? [];

  return (
    <main className={firstRun ? "settings" : "view settings"}>
      <PageHeader eyebrow={firstRun ? "Welcome to AudioShelf" : "Library preferences"} title={firstRun ? "Choose your audio library" : "Settings"} />

      {firstRun && (
        <p className="muted">
          Choose the folder that holds your audio library
          (one subfolder per author) to get started.
        </p>
      )}

      <Card className="settings-root" style={{ padding: 24 }}>
        <h2>Library folder</h2>
        {root ? <p className="current-root">{root}</p> : <p>No library folder chosen yet.</p>}

        <Button variant="primary" onClick={props.onChooseFolder} disabled={busy}>
          <Icon name="folder" />
          {root ? "Choose a different folder…" : "Choose library folder…"}
        </Button>
        {root && (
          <Button variant="secondary" onClick={props.onRescan} disabled={busy}>
            <Icon name="refresh" />
            Re-scan this folder
          </Button>
        )}
      </Card>

      {!firstRun && (props.onOpenRename || props.onOpenMetadata) && (
        <Card style={{ padding: 24, marginTop: 16 }}>
          <h2>Library tools</h2>
          <p className="muted">Occasional maintenance. Nothing changes your audio files unless you preview and confirm.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {props.onOpenRename && <Button variant="secondary" onClick={props.onOpenRename}>Standardize file names…</Button>}
            {props.onOpenMetadata && <Button variant="secondary" onClick={props.onOpenMetadata}>Import metadata from files…</Button>}
          </div>
        </Card>
      )}

      {busy && <p className="settings-busy">Scanning…</p>}

      {scanError && (
        <Notice tone="error" role="alert">
          Couldn't scan that folder: {scanError}
        </Notice>
      )}

      {lastScan && !busy && !scanError && (
        <Notice tone="success">
          Indexed {lastScan.authors} authors, {lastScan.works} works,{" "}
          {lastScan.chapters} chapters.
        </Notice>
      )}

      {!firstRun && props.onDensityChange && (
        <Card style={{ padding: 24, marginTop: 16 }}>
          <h2>Library density</h2>
          <p className="muted">Controls the spacing of cards in your library.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {(["compact", "comfortable", "spacious"] as Density[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`button button--secondary${props.density === d ? " button--active" : ""}`}
                aria-pressed={props.density === d}
                onClick={() => props.onDensityChange!(d)}
                style={props.density === d ? { borderColor: "var(--color-accent)", background: "var(--color-accent-soft)" } : undefined}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </Card>
      )}

      {!firstRun && props.onA11yChange && props.a11y && (
        <Card className="a11y-section" style={{ padding: 24, marginTop: 16 }}>
          <h2>Accessibility</h2>

          <div style={{ marginTop: 12 }}>
            <p className="muted" style={{ marginBottom: 4 }}>Theme</p>
            <div style={{ display: "flex", gap: 8 }}>
              {(["dark", "light", "high-contrast"] as Theme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`button button--secondary${props.a11y!.theme === t ? " button--active" : ""}`}
                  aria-pressed={props.a11y!.theme === t}
                  onClick={() => props.onA11yChange!({ ...props.a11y!, theme: t })}
                  style={props.a11y!.theme === t ? { borderColor: "var(--color-accent)", background: "var(--color-accent-soft)" } : undefined}
                >
                  {t === "dark" ? "Dark" : t === "light" ? "Light" : "High contrast"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <p className="muted" style={{ marginBottom: 4 }}>Text size</p>
            <div style={{ display: "flex", gap: 8 }}>
              {(["normal", "large", "xlarge"] as TextSize[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`button button--secondary${props.a11y!.textSize === s ? " button--active" : ""}`}
                  aria-pressed={props.a11y!.textSize === s}
                  onClick={() => props.onA11yChange!({ ...props.a11y!, textSize: s })}
                  style={props.a11y!.textSize === s ? { borderColor: "var(--color-accent)", background: "var(--color-accent-soft)" } : undefined}
                >
                  {s === "normal" ? "Normal" : s === "large" ? "Large" : "Extra large"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <input
              id="a11y-dyslexia-font"
              type="checkbox"
              checked={props.a11y.dyslexiaFont}
              onChange={() => props.onA11yChange!({ ...props.a11y!, dyslexiaFont: !props.a11y!.dyslexiaFont })}
            />
            <label htmlFor="a11y-dyslexia-font">Dyslexia-friendly font</label>
          </div>

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <input
              id="a11y-reduce-motion"
              type="checkbox"
              checked={props.a11y.reducedMotion}
              onChange={() => props.onA11yChange!({ ...props.a11y!, reducedMotion: !props.a11y!.reducedMotion })}
            />
            <label htmlFor="a11y-reduce-motion">Reduce motion</label>
          </div>
        </Card>
      )}

      {!firstRun && (
        <Card style={{ padding: 24, marginTop: 16 }}>
          <h2>Home shelves</h2>
          <p className="muted">
            Add named rows to your Home screen. Each shelf is populated automatically
            from your library — no sync needed.
          </p>

          {shelves.length === 0 && (
            <p className="muted">No shelves yet. Add one below.</p>
          )}

          {shelves.map((shelf, index) => (
            <div
              key={shelf.id}
              className="shelf-row card"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 6 }}
            >
              <span style={{ flex: 1 }}>
                <strong>{shelf.title}</strong>{" "}
                <ShelfKindSummary shelf={shelf} />
              </span>
              <Button
                variant="secondary"
                onClick={() => props.onMoveShelf?.(shelf.id, -1)}
                disabled={index === 0}
                aria-label={`Move ${shelf.title} up`}
              >
                ▲
              </Button>
              <Button
                variant="secondary"
                onClick={() => props.onMoveShelf?.(shelf.id, 1)}
                disabled={index === shelves.length - 1}
                aria-label={`Move ${shelf.title} down`}
              >
                ▼
              </Button>
              <Button
                variant="secondary"
                onClick={() => props.onRemoveShelf?.(shelf.id)}
                aria-label={`Remove ${shelf.title}`}
              >
                Remove
              </Button>
            </div>
          ))}

          {props.onAddShelf && (
            <AddShelfForm
              allTags={allTags}
              authors={authors}
              onAddShelf={props.onAddShelf}
            />
          )}
        </Card>
      )}

      {!firstRun && props.tagStats !== undefined && props.onRenameTag && props.onMergeTags && props.onSetTagAlias && props.onClearTagAlias && (
        <Card style={{ padding: 24, marginTop: 16 }}>
          <h2>Tag manager</h2>
          <p className="muted">
            Rename or merge tags across your entire library. Aliases let you type an
            alternate name and have it resolve to the canonical form automatically.
          </p>
          <TagManagerView
            tags={props.tagStats}
            onRename={props.onRenameTag}
            onMerge={props.onMergeTags}
            onSetAlias={props.onSetTagAlias}
            onClearAlias={props.onClearTagAlias}
          />
        </Card>
      )}

      {!firstRun && props.metaTerms !== undefined && props.onCreateMetaTerm && props.onRenameMetaTerm && props.onDeleteMetaTerm && props.onMergeMetaTerms && (
        <Card style={{ padding: 24, marginTop: 16 }}>
          <h2>Metadata vocabulary</h2>
          <p className="muted">
            Create narrator, language, and mood values you can apply to files and creators.
          </p>
          <MetadataManagerView
            terms={props.metaTerms}
            onCreate={props.onCreateMetaTerm}
            onRename={props.onRenameMetaTerm}
            onDelete={props.onDeleteMetaTerm}
            onMerge={props.onMergeMetaTerms}
          />
        </Card>
      )}

      {!firstRun && props.collections !== undefined && (
        <CollectionsManager
          collections={props.collections}
          onCreateCollection={props.onCreateCollection}
          onDeleteCollection={props.onDeleteCollection}
          onReorderCollections={props.onReorderCollections}
        />
      )}

      {!firstRun && (props.onExportJson || props.onExportSnapshot || props.onImportJson || props.onRestoreSnapshot || props.onHealthScan) && (
        <Card className="backup-maintenance" style={{ padding: 24, marginTop: 16 }}>
          <h2>Backup &amp; maintenance</h2>
          <p className="muted">
            Export your curation data, create full database snapshots, import from a previous export, restore
            a snapshot, or scan your library for file health issues.
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {props.onExportJson && (
              <Button variant="secondary" onClick={props.onExportJson}>
                Export curation (JSON)
              </Button>
            )}
            {props.onExportSnapshot && (
              <Button variant="secondary" onClick={props.onExportSnapshot}>
                Export full snapshot (.db)
              </Button>
            )}
            {props.onImportJson && (
              <Button variant="secondary" onClick={props.onImportJson}>
                Import curation (JSON)
              </Button>
            )}
            {props.onRestoreSnapshot && (
              <Button variant="secondary" onClick={props.onRestoreSnapshot}>
                Restore snapshot (.db)
              </Button>
            )}
            {props.onHealthScan && (
              <Button variant="secondary" onClick={props.onHealthScan}>
                Run health scan
              </Button>
            )}
          </div>

          {props.restoreStaged && (
            <div style={{ marginTop: 16 }}>
              <Notice tone="info">
                Restore staged — restart AudioShelf to apply (your current library is backed up automatically).
              </Notice>
            </div>
          )}

          {props.importReport && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 8px" }}>Import result</h3>
              <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
                <li>Tags added: {props.importReport.tagsAdded}</li>
                <li>Played marked: {props.importReport.playedMarked}</li>
                <li>Favorites marked: {props.importReport.favoritesMarked}</li>
                <li>Journal fields filled: {props.importReport.journalFieldsFilled}</li>
                <li>Notes added: {props.importReport.notesAdded}</li>
                <li>Bookmarks added: {props.importReport.bookmarksAdded}</li>
                <li>Collections added: {props.importReport.collectionsAdded}</li>
                <li>Saved searches added: {props.importReport.searchesAdded}</li>
                {props.importReport.unmatchedAuthors > 0 && (
                  <li>Unmatched authors: {props.importReport.unmatchedAuthors}</li>
                )}
                {props.importReport.unmatchedWorks > 0 && (
                  <li>Unmatched works: {props.importReport.unmatchedWorks}</li>
                )}
                {props.importReport.unmatchedChapters > 0 && (
                  <li>Unmatched chapters: {props.importReport.unmatchedChapters}</li>
                )}
              </ul>
            </div>
          )}

          {props.healthReport && (
            <div className="health-report" style={{ marginTop: 16 }}>
              <h3 style={{ margin: "0 0 8px" }}>Health scan result</h3>
              {props.healthReport.schemaDrift && (
                <div style={{ marginBottom: 12 }}>
                  <Notice tone="error">
                    Schema drift detected — DB version {props.healthReport.schemaVersion}, expected {props.healthReport.latestSchema}.
                  </Notice>
                </div>
              )}
              {props.healthReport.missingFiles.length === 0 &&
               props.healthReport.zeroByte.length === 0 &&
               props.healthReport.unreadable.length === 0 && (
                <p className="muted" style={{ margin: 0 }}>All files look healthy.</p>
              )}
              {props.healthReport.missingFiles.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong>Missing files ({props.healthReport.missingFiles.length})</strong>
                  <ul className="muted" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {props.healthReport.missingFiles.map((item) => (
                      <li key={item.chapterId}>{item.authorName} — {item.workTitle} — {item.title}</li>
                    ))}
                  </ul>
                </div>
              )}
              {props.healthReport.zeroByte.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <strong>Zero-byte files ({props.healthReport.zeroByte.length})</strong>
                  <ul className="muted" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {props.healthReport.zeroByte.map((item) => (
                      <li key={item.chapterId}>{item.authorName} — {item.workTitle} — {item.title}</li>
                    ))}
                  </ul>
                </div>
              )}
              {props.healthReport.unreadable.length > 0 && (
                <div>
                  <strong>Unreadable files ({props.healthReport.unreadable.length})</strong>
                  <ul className="muted" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {props.healthReport.unreadable.map((item) => (
                      <li key={item.chapterId}>{item.authorName} — {item.workTitle} — {item.title}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </main>
  );
}

function CollectionsManager({
  collections,
  onCreateCollection,
  onDeleteCollection,
  onReorderCollections,
}: {
  collections: Collection[];
  onCreateCollection?: (name: string, query: string) => void;
  onDeleteCollection?: (id: number) => void;
  onReorderCollections?: (ids: number[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newQuery, setNewQuery] = useState("");

  function handleCreate() {
    const name = newName.trim();
    const query = newQuery.trim();
    if (!name || !query) return;
    onCreateCollection?.(name, query);
    setNewName("");
    setNewQuery("");
  }

  function moveCollection(id: number, dir: -1 | 1) {
    const ids = collections.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    onReorderCollections?.(next);
  }

  return (
    <Card style={{ padding: 24, marginTop: 16 }}>
      <h2>Collections</h2>
      <p className="muted">
        Saved smart filters — each collection runs a scoped query against your library and updates automatically.
      </p>

      {collections.length === 0 && (
        <p className="muted">No collections yet. Add one below.</p>
      )}

      {collections.map((c, index) => (
        <div
          key={c.id}
          className="shelf-row card"
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 6 }}
        >
          <span style={{ flex: 1 }}>
            <strong>{c.name}</strong>{" "}
            <code className="muted" style={{ fontSize: "0.85em" }}>{c.query}</code>
          </span>
          <Button
            variant="secondary"
            onClick={() => moveCollection(c.id, -1)}
            disabled={index === 0}
            aria-label={`Move ${c.name} up`}
          >
            ▲
          </Button>
          <Button
            variant="secondary"
            onClick={() => moveCollection(c.id, 1)}
            disabled={index === collections.length - 1}
            aria-label={`Move ${c.name} down`}
          >
            ▼
          </Button>
          <Button
            variant="secondary"
            onClick={() => onDeleteCollection?.(c.id)}
            aria-label={`Delete ${c.name}`}
          >
            Delete
          </Button>
        </div>
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>New collection</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Name
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My collection"
              aria-label="Collection name"
              style={{ marginLeft: 6 }}
            />
          </label>
          <label>
            Query
            <input
              type="text"
              value={newQuery}
              onChange={(e) => setNewQuery(e.target.value)}
              placeholder="tag:cozy status:unplayed"
              aria-label="Collection query"
              style={{ marginLeft: 6 }}
            />
          </label>
          <Button variant="primary" onClick={handleCreate}>Add</Button>
        </div>
      </div>
    </Card>
  );
}
