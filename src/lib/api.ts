import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ScanResult { authors: number; works: number; chapters: number; }
export interface AuthorRow {
  id: number; name: string; workCount: number; chapterCount: number; unplayedCount: number;
}
export interface ChapterRow {
  id: number; title: string; chapterNo: number; format: string;
  durationSecs: number; filePath: string; played: boolean;
}
export interface WorkRow { id: number; baseTitle: string; chapters: ChapterRow[]; }
export interface AuthorDetail { id: number; name: string; tags: string[]; works: WorkRow[]; }

export interface AuthorHit { authorId: number; authorName: string; }
export interface WorkHit { workId: number; baseTitle: string; authorId: number; authorName: string; }
export interface ChapterHit {
  chapterId: number; title: string; workId: number; baseTitle: string;
  authorId: number; authorName: string;
}
export interface SearchResults { authors: AuthorHit[]; works: WorkHit[]; chapters: ChapterHit[]; }

export interface DiscoveryWork {
  workId: number; baseTitle: string; authorId: number; authorName: string;
  unplayedCount: number; sharedTags: string[];
}
export interface MoreWork { workId: number; baseTitle: string; unplayedCount: number; }

export interface RenameItem {
  chapterId: number; authorName: string; baseTitle: string;
  fromName: string; toName: string;
  status: "ok" | "noop" | "conflict"; conflictReason: string | null;
}
export interface RenameResult { renamedCount: number; failures: string[]; manifestPath: string; }
export interface UndoResult { revertedCount: number; failures: string[]; }

export interface LaunchArgs {
  library: string | null;
  autostart: boolean;
  walkthrough: string | null;
  shots: string | null;
  doneSignal: string | null;
  exitWhenDone: boolean;
}

export const getLaunchArgs = () => invoke<LaunchArgs>("get_launch_args");
export const scanLibrary = (root: string) => invoke<ScanResult>("scan_library", { root });
export const getAuthors = () => invoke<AuthorRow[]>("get_authors");
export const getAuthorDetail = (authorId: number) =>
  invoke<AuthorDetail>("get_author_detail", { authorId });
export const searchLibrary = (query: string) =>
  invoke<SearchResults>("search_library", { query });
export const setChapterPlayed = (chapterId: number, played: boolean) =>
  invoke("set_chapter_played", { chapterId, played });
export const markChapterFinished = (chapterId: number, nowMs: number) =>
  invoke("mark_chapter_finished", { chapterId, nowMs });
export const setAuthorDisplayName = (authorId: number, name: string | null) =>
  invoke("set_author_display_name", { authorId, name });

export const getAllTags = () => invoke<string[]>("get_all_tags");
export const setAuthorTags = (authorId: number, tags: string[]) =>
  invoke("set_author_tags", { authorId, tags });
export const getDiscovery = () => invoke<DiscoveryWork[]>("get_discovery");
export const getDiscoveryByTags = (tags: string[]) =>
  invoke<DiscoveryWork[]>("get_discovery_by_tags", { tags });
export const getMoreFromAuthor = (authorId: number) =>
  invoke<MoreWork[]>("get_more_from_author", { authorId });

export const previewRenames = () => invoke<RenameItem[]>("preview_renames");
export const applyRenames = (chapterIds: number[], nowMs: number) =>
  invoke<RenameResult>("apply_renames", { chapterIds, nowMs });
export const undoRenames = (manifestPath: string) =>
  invoke<UndoResult>("undo_renames", { manifestPath });

export const setGroupingOverride = (chapterId: number, baseTitle: string | null, chapterNo: number | null) =>
  invoke<AuthorDetail>("set_grouping_override", { chapterId, baseTitle, chapterNo });
export const clearGroupingOverride = (chapterId: number) =>
  invoke<AuthorDetail>("clear_grouping_override", { chapterId });

export const captureWindow = (path: string) => invoke("capture_window", { path });
export const finishWalkthrough = (doneSignal: string | null, exitWhenDone: boolean) =>
  invoke("finish_walkthrough", { doneSignal, exitWhenDone });

export const fileUrl = (p: string) => convertFileSrc(p);

export const getSetting = (key: string) => invoke<string | null>("get_setting", { key });
export const setSetting = (key: string, value: string) =>
  invoke("set_setting", { key, value });

/**
 * Open the OS folder picker. Resolves to the chosen absolute path, or `null` if
 * the user cancelled. `directory: true` + default `multiple: false` yields a
 * single path string (never an array) or null.
 */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose your audio library folder",
  });
  return typeof picked === "string" ? picked : null;
}
