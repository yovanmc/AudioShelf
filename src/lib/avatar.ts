/**
 * Deterministic, stylesheet-free author "cover" placeholder primitives (spec §13).
 * Same name always yields the same initials and colour, so the UI is stable across
 * renders and screenshots.
 */

/** 1–2 uppercase initials for a display name. Falls back to "?" for blank names. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A stable, readable HSL background colour derived from the name (FNV-ish hash). */
export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}
