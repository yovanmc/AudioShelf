import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./ui";

export type ShellRoute = "home" | "library" | "discovery" | "rename" | "metadata" | "settings" | "journal" | "insights";

export function AppShell({ active, collapsed, onCollapsedChange, onHome, onLibrary, onDiscovery, onRename, onMetadata, onSettings, onJournal, onInsights, children, player }: {
  active: ShellRoute;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onHome: () => void;
  onLibrary: () => void;
  onDiscovery: () => void;
  onRename: () => void;
  onMetadata: () => void;
  onSettings: () => void;
  onJournal: () => void;
  onInsights: () => void;
  children: ReactNode;
  player: ReactNode;
}) {
  const items: Array<{ key: ShellRoute; label: string; icon: IconName; action: () => void }> = [
    { key: "home", label: "Home", icon: "home", action: onHome },
    { key: "library", label: "Library", icon: "library", action: onLibrary },
    { key: "discovery", label: "Discover", icon: "discover", action: onDiscovery },
    { key: "rename", label: "Rename", icon: "rename", action: onRename },
    { key: "metadata", label: "Import tags", icon: "metadata", action: onMetadata },
    { key: "journal", label: "Journal", icon: "journal", action: onJournal },
    { key: "insights", label: "Insights", icon: "insights", action: onInsights },
  ];
  const navButton = (item: typeof items[number]) => (
    <button
      key={item.key}
      className="sidebar__item"
      aria-label={item.label}
      title={item.label}
      aria-current={active === item.key ? "page" : undefined}
      onClick={item.action}
    >
      <Icon name={item.icon} />
      <span className="sidebar__label">{item.label}</span>
    </button>
  );
  return (
    <div className={`app-shell${collapsed ? " app-shell--collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar__brand">
          <span className="sidebar__wordmark">AudioShelf</span>
          <IconButton icon={collapsed ? "chevronRight" : "chevronLeft"} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => onCollapsedChange(!collapsed)} />
        </div>
        <nav className="sidebar__nav">{items.map(navButton)}</nav>
        <div className="sidebar__spacer" />
        <button
          className="sidebar__item"
          aria-label="Settings"
          title="Settings"
          aria-current={active === "settings" ? "page" : undefined}
          onClick={onSettings}
        >
          <Icon name="settings" />
          <span className="sidebar__label">Settings</span>
        </button>
      </aside>
      <div className="app-main">{children}</div>
      {player}
    </div>
  );
}
