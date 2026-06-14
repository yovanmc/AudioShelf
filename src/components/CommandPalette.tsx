import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchResults } from "../lib/api";

export function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

type Flat =
  | { kind: "author"; id: number; label: string; sub: string }
  | { kind: "work"; id: number; authorId: number; label: string; sub: string }
  | { kind: "chapter"; id: number; label: string; sub: string };

export function CommandPalette({
  open, results, query, onQueryChange, onClose, onOpenAuthor, onOpenWorkAuthor, onPlayChapter,
}: {
  open: boolean;
  results: SearchResults | null;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  onOpenAuthor: (authorId: number) => void;
  onOpenWorkAuthor: (authorId: number) => void;
  onPlayChapter: (chapterId: number) => void;
}) {
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const flat: Flat[] = useMemo(() => {
    if (!results) return [];
    return [
      ...results.authors.map((a) => ({ kind: "author" as const, id: a.authorId, label: a.authorName, sub: "Creator" })),
      ...results.works.map((w) => ({ kind: "work" as const, id: w.workId, authorId: w.authorId, label: w.baseTitle, sub: w.authorName })),
      ...results.chapters.map((c) => ({ kind: "chapter" as const, id: c.chapterId, label: c.title, sub: `${c.baseTitle} · ${c.authorName}` })),
    ];
  }, [results]);

  useEffect(() => { setActive(0); }, [flat.length]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) return null;

  const activate = (item: Flat) => {
    if (item.kind === "author") onOpenAuthor(item.id);
    else if (item.kind === "work") onOpenWorkAuthor(item.authorId);
    else onPlayChapter(item.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => clampIndex(i + 1, flat.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => clampIndex(i - 1, flat.length)); }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); activate(flat[active]); }
  };

  // Build a lookup from (kind, id) → flat index so section-grouped rendering
  // can still pass the correct flat index to onMouseEnter / active check.
  const flatIndex = useMemo(() => {
    const m = new Map<string, number>();
    flat.forEach((item, idx) => m.set(`${item.kind}-${item.id}`, idx));
    return m;
  }, [flat]);

  const KIND_LABELS: Record<Flat["kind"], string> = { author: "Authors", work: "Works", chapter: "Chapters" };

  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Search creators, works, chapters…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Command palette search"
        />
        <ul className="palette__list" role="listbox">
          {(["author", "work", "chapter"] as const).map((kind) => {
            const items = flat.filter((r) => r.kind === kind);
            if (!items.length) return null;
            return (
              <li key={kind} className="palette__section" aria-hidden="true">
                <div className="palette__section-label">{KIND_LABELS[kind]}</div>
                <ul role="presentation">
                  {items.map((item) => {
                    const idx = flatIndex.get(`${item.kind}-${item.id}`) ?? 0;
                    return (
                      <li
                        key={`${item.kind}-${item.id}`}
                        role="option"
                        aria-selected={idx === active}
                        className={`palette__item${idx === active ? " palette__item--active" : ""}`}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => activate(item)}
                      >
                        <span className="palette__label">{item.label}</span>
                        <span className="palette__sub">{item.sub}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {flat.length === 0 && query.trim() !== "" && <li className="palette__empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
