import { useState } from "react";
import type { Collection, ScopedResults as Results } from "../lib/api";
import { ScopedResults } from "./ScopedResults";

export function CollectionsView({
  collections, resolved, onResolve, onOpenAuthor, initialOpenId,
}: {
  collections: Collection[];
  resolved: Record<number, Results | undefined>;
  onResolve: (id: number) => void;
  onOpenAuthor: (authorId: number) => void;
  initialOpenId?: number | null;
}) {
  const [openId, setOpenId] = useState<number | null>(initialOpenId ?? null);
  return (
    <div className="page">
      <header className="page-header"><h1>Collections</h1>
        <p className="page-header__sub">Saved smart filters that update as your library changes.</p></header>
      {collections.length === 0 && <p className="empty-note">No collections yet. Create one in Settings → Backup &amp; maintenance.</p>}
      <ul className="collection-list">
        {collections.map((c) => (
          <li key={c.id}>
            <button className="collection-row" onClick={() => { const next = openId === c.id ? null : c.id; setOpenId(next); if (next !== null && !resolved[c.id]) onResolve(c.id); }}>
              <span className="collection-row__name">{c.name}</span>
              <code className="collection-row__query">{c.query}</code>
            </button>
            {openId === c.id && resolved[c.id] && <ScopedResults results={resolved[c.id]!} onOpenAuthor={onOpenAuthor} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
