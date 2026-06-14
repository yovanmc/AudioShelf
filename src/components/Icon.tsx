export type IconName =
  | "home" | "library" | "discover" | "rename" | "metadata" | "settings"
  | "menu" | "chevronLeft" | "chevronRight" | "more"
  | "play" | "pause" | "back15" | "back30" | "forward15" | "forward30"
  | "volume" | "mute" | "sleep" | "search" | "check" | "tag"
  | "expand" | "collapse" | "close" | "refresh" | "folder"
  | "journal" | "insights" | "collections" | "voice" | "list"
  | "circle" | "circleHalf"
  | "music";

type GlyphDef = { d: string; fill?: string };

const glyphs: Record<IconName, GlyphDef> = {
  home:        { d: "M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z" },
  metadata:    { d: "M4 6h16M4 10h10M4 14h7M4 18h5m10-1v4m-2-2h4" },
  library:     { d: "M4 4h4v16H4zm6 0h4v16h-4zm6 2h4v14h-4z" },
  discover:    { d: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" },
  rename:      { d: "M4 5h10v4H4zm0 10h16v4H4zm12-8 4 4-4 4" },
  settings:    { d: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" },
  menu:        { d: "M4 7h16M4 12h16M4 17h16" },
  chevronLeft: { d: "m15 18-6-6 6-6" },
  chevronRight:{ d: "m9 18 6-6-6-6" },
  more:        { d: "M5 12h.01M12 12h.01M19 12h.01" },
  play:        { d: "m8 5 11 7-11 7z" },
  pause:       { d: "M7 5h3v14H7zm7 0h3v14h-3z" },
  back15:      { d: "M9 7 5 11l4 4M5 11h8a5 5 0 1 1 0 10" },
  back30:      { d: "M9 4 5 8l4 4M5 8h9a6 6 0 1 1-6 6" },
  forward15:   { d: "m15 7 4 4-4 4m4-4h-8a5 5 0 1 0 0 10" },
  forward30:   { d: "m15 4 4 4-4 4m4-4h-9a6 6 0 1 0 6 6" },
  volume:      { d: "M4 10v4h4l5 4V6l-5 4zm12-1a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12" },
  mute:        { d: "M4 10v4h4l5 4V6l-5 4H4zm14-2 5 8m0-8-5 8" },
  sleep:       { d: "M18 4a8 8 0 1 0 2 14 7 7 0 0 1-2-14" },
  search:      { d: "m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15" },
  check:       { d: "m5 12 4 4L19 6" },
  tag:         { d: "M3 4v6l10 10 7-7L10 3zm5 4h.01" },
  expand:      { d: "M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" },
  collapse:    { d: "M9 9H3V3m12 6h6V3M9 15H3v6m12-6h6v6" },
  close:       { d: "M5 5l14 14M19 5 5 19" },
  refresh:     { d: "M20 6v5h-5M4 18v-5h5m10.5-2a8 8 0 0 0-14-3M4.5 14a8 8 0 0 0 14 3" },
  folder:      { d: "M3 6h7l2 2h9v11H3z" },
  journal:     { d: "M4 3h12l4 4v14H4zM4 3v18m8-18v5H8m4 0h4M8 12h8m-8 4h5" },
  insights:    { d: "M5 13v7m7-11v11m7-15v15M3 20h18" },
  collections: { d: "M3 7h18M3 12h18M3 17h18m-9-14v4m-6 0v4m12-4v4" },
  voice:       { d: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" },
  list:        { d: "M4 6h16M4 12h16M4 18h16" },
  /** Outline circle — "unstarted" / "not played" status indicator. */
  circle:      { d: "M12 4a8 8 0 1 0 0 16A8 8 0 0 0 12 4z" },
  /** Half-filled circle — "in progress" status indicator. */
  circleHalf:  { d: "M12 4a8 8 0 0 1 0 16V4z", fill: "currentColor" },
  /** Music note — cover-art placeholder glyph. */
  music:       { d: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" },
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const { d, fill } = glyphs[name];
  return (
    <svg className={`icon ${className}`} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} fill={fill ?? "none"} />
    </svg>
  );
}
