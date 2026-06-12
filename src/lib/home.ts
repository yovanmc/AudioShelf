import type { ContinueItem, RecommendationWork } from "./api";

export function percent(played: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((played / total) * 100);
}

export function keepListeningPercent(item: ContinueItem): number {
  return percent(item.playedChapters, item.totalChapters);
}

export function recommendationPercent(item: RecommendationWork): number {
  return percent(item.totalChapters - item.unplayedCount, item.totalChapters);
}
