import type { ReactNode } from "react";
import { CreatorIdentity } from "./CreatorIdentity";
import { Menu, type MenuItem } from "./Menu";
import { WorkArtwork } from "./Cover";
import { Button, Card, ProgressBar, TagGroup } from "./ui";

export function WorkCard({ workId, title, authorId, authorName, tags = [], reason, reasonTone = "affinity", progress, meta, actionLabel, onAction, onOpenAuthor, onPlay, menuItems = [], featured = false, menuOpen = false }: {
  workId: number; title: string; authorId: number; authorName: string; tags?: string[];
  reason?: string; reasonTone?: "progress" | "affinity"; progress?: number; meta?: ReactNode; actionLabel?: string; onAction?: () => void;
  onOpenAuthor?: () => void; onPlay?: () => void; menuItems?: MenuItem[]; featured?: boolean; menuOpen?: boolean;
}) {
  return (
    <Card className={`work-card${featured ? " work-card--featured" : ""}`}>
      <div className="work-card__art"><WorkArtwork workId={workId} title={title} size={featured ? 240 : 220} /></div>
      <div className="work-card__body">
        {reason && <div className={`work-card__reason work-card__reason--${reasonTone}`}>{reason}</div>}
        <h3 className="work-card__title">{title}</h3>
        <CreatorIdentity authorId={authorId} authorName={authorName} onOpen={onOpenAuthor} />
        {meta && <div className="muted">{meta}</div>}
        <TagGroup tags={tags.slice(0, 4)} />
        {progress !== undefined && <ProgressBar value={progress} label={`${title} progress`} />}
        {(onPlay || actionLabel || menuItems.length > 0) && <div className="work-card__actions">
          {onPlay && <Button variant="primary" onClick={onPlay}>▶ Play</Button>}
          {actionLabel && onAction && <Button variant={onPlay ? "ghost" : "primary"} onClick={onAction}>{actionLabel}</Button>}
          {menuItems.length > 0 && <Menu label="More actions" items={menuItems} forcedOpen={menuOpen} />}
        </div>}
      </div>
    </Card>
  );
}
