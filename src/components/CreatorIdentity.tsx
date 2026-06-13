import type { ReactNode } from "react";
import { CreatorAvatar } from "./Cover";

export function CreatorIdentity({ authorId, authorName, secondary, size = 32, onOpen }: {
  authorId: number; authorName: string; secondary?: ReactNode; size?: number; onOpen?: () => void;
}) {
  const content = <>
    <CreatorAvatar authorId={authorId} name={authorName} size={size} decorative />
    <span className="creator-identity__copy">
      <span className="creator-identity__name" dir="auto">{authorName}</span>
      {secondary && <span className="muted">{secondary}</span>}
    </span>
  </>;
  return onOpen
    ? <button className="creator-identity" onClick={onOpen}>{content}</button>
    : <span className="creator-identity">{content}</span>;
}
