export type IconName =
  | "home" | "library" | "discover" | "rename" | "settings"
  | "menu" | "chevronLeft" | "chevronRight" | "more"
  | "play" | "pause" | "back15" | "back30" | "forward15" | "forward30"
  | "volume" | "sleep" | "search" | "check" | "tag"
  | "expand" | "collapse" | "close" | "refresh" | "folder";

const paths: Record<IconName, string> = {
  home: "M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z",
  library: "M4 4h4v16H4zm6 0h4v16h-4zm6 2h4v14h-4z",
  discover: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z",
  rename: "M4 5h10v4H4zm0 10h16v4H4zm12-8 4 4-4 4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
  menu: "M4 7h16M4 12h16M4 17h16",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  play: "m8 5 11 7-11 7z",
  pause: "M7 5h3v14H7zm7 0h3v14h-3z",
  back15: "M9 7 5 11l4 4M5 11h8a5 5 0 1 1 0 10",
  back30: "M9 4 5 8l4 4M5 8h9a6 6 0 1 1-6 6",
  forward15: "m15 7 4 4-4 4m4-4h-8a5 5 0 1 0 0 10",
  forward30: "m15 4 4 4-4 4m4-4h-9a6 6 0 1 0 6 6",
  volume: "M4 10v4h4l5 4V6l-5 4zm12-1a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12",
  sleep: "M18 4a8 8 0 1 0 2 14 7 7 0 0 1-2-14",
  search: "m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15",
  check: "m5 12 4 4L19 6",
  tag: "M3 4v6l10 10 7-7L10 3zm5 4h.01",
  expand: "M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5",
  collapse: "M9 9H3V3m12 6h6V3M9 15H3v6m12-6h6v6",
  close: "M5 5l14 14M19 5 5 19",
  refresh: "M20 6v5h-5M4 18v-5h5m10.5-2a8 8 0 0 0-14-3M4.5 14a8 8 0 0 0 14 3",
  folder: "M3 6h7l2 2h9v11H3z",
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
