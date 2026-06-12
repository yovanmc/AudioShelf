import { useMemo, useState } from "react";
import type { AuthorRow } from "../lib/api";
import { matchesSearch, summarizeAuthor } from "../lib/library";

export function LibraryView(props: {
  authors: AuthorRow[];
  onOpenAuthor: (id: number) => void;
  onOpenDiscovery: () => void;
  onOpenRename: () => void;
  onOpenSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => props.authors.filter((a) => matchesSearch(a, query)),
    [props.authors, query],
  );
  return (
    <div className="library">
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <button onClick={props.onOpenRename}>Rename tool</button>
      <button onClick={props.onOpenSettings}>Settings</button>
      <input placeholder="Search authors" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>
        {shown.map((a) => (
          <li key={a.id}>
            <button onClick={() => props.onOpenAuthor(a.id)}>
              <span className="author-name">{a.name}</span>{" — "}
              <span className="author-summary">{summarizeAuthor(a)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
