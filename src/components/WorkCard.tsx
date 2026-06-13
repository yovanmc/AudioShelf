import type { ReactNode } from "react";
import { CreatorIdentity } from "./CreatorIdentity";
import { Menu, type MenuItem } from "./Menu";
import { WorkArtwork } from "./Cover";
import { Button, Card, ProgressBar, TagGroup } from "./ui";
import { Icon, type IconName } from "./Icon";

/** Explicit play-status for a work — used to add a non-color shape indicator. */
export type WorkPlayStatus = "done" | "in-progress" | "unstarted";

const STATUS_ICON: Record<WorkPlayStatus, IconName> = {
  done: "check",
  "in-progress": "circleHalf",
  unstarted: "circle",
};

const STATUS_LABEL: Record<WorkPlayStatus, string> = {
  done: "Played",
  "in-progress": "In progress",
  unstarted: "Not started",
};

export function WorkCard({ workId, title, authorId, authorName, tags = [], reason, reasonTone = "affinity", progress, meta, actionLabel, onAction, onOpenAuthor, onPlay, menuItems = [], featured = false, menuOpen = false, playStatus }: {
  workId: number; title: string; authorId: number; authorName: string; tags?: string[];
  reason?: string; reasonTone?: "progress" | "affinity"; progress?: number; meta?: ReactNode; actionLabel?: string; onAction?: () => void;
  onOpenAuthor?: () => void; onPlay?: () => void; menuItems?: MenuItem[]; featured?: boolean; menuOpen?: boolean;
  /** Optional explicit play status — renders a shape icon beside the reason/eyebrow so state is distinguishable without color. */
  playStatus?: WorkPlayStatus;
}) {
  return (
    <Card className={`work-card${featured ? " work-card--featured" : ""}`}>
      <div className="work-card__art"><WorkArtwork workId={workId} title={title} size={featured ? 240 : 220} /></div>
      <div className="work-card__body">
        {(reason || playStatus) && (
          <div className={`work-card__reason work-card__reason--${reasonTone}`}>
            {playStatus && (
              <span className="work-card__status-icon" aria-hidden="true">
                <Icon name={STATUS_ICON[playStatus]} className="work-card__status-icon-svg" />
              </span>
            )}
            {playStatus && <span className="visually-hidden">{STATUS_LABEL[playStatus]}. </span>}
            {reason}
          </div>
        )}
        <h3 className="work-card__title" dir="auto">{title}</h3>
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
