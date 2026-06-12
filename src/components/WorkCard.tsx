import type { ReactNode } from "react";
import { CreatorIdentity } from "./CreatorIdentity";
import { Menu, type MenuItem } from "./Menu";
import { WorkArtwork } from "./Cover";
import { Button, Card, ProgressBar } from "./ui";

export function WorkCard({ workId, title, authorId, authorName, tags = [], reason, progress, meta, actionLabel, onAction, onOpenAuthor, menuItems = [], featured = false, menuOpen = false }: {
  workId: number; title: string; authorId: number; authorName: string; tags?: string[];
  reason?: string; progress?: number; meta?: ReactNode; actionLabel?: string; onAction?: () => void;
  onOpenAuthor?: () => void; menuItems?: MenuItem[]; featured?: boolean; menuOpen?: boolean;
}) {
  return (
    <Card className={`work-card${featured ? " work-card--featured" : ""}`}>
      <div className="work-card__art"><WorkArtwork workId={workId} title={title} size={featured ? 240 : 220} /></div>
      <div className="work-card__body">
        {reason && <div className="work-card__reason">{reason}</div>}
        <h3 className="work-card__title">{title}</h3>
        <CreatorIdentity authorId={authorId} authorName={authorName} onOpen={onOpenAuthor} />
        {meta && <div className="muted">{meta}</div>}
        {tags.length > 0 && <div className="chips">{tags.slice(0, 4).map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>}
        {progress !== undefined && <ProgressBar value={progress} label={`${title} progress`} />}
        {(actionLabel || menuItems.length > 0) && <div className="work-card__actions">
          {actionLabel && onAction && <Button variant="primary" onClick={onAction}>{actionLabel}</Button>}
          {menuItems.length > 0 && <Menu label="More actions" items={menuItems} forcedOpen={menuOpen} />}
        </div>}
      </div>
    </Card>
  );
}
