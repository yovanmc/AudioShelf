# AudioShelf — Design Spec

- **Date:** 2026-06-11
- **Status:** Approved (brainstorming complete; ready for implementation plan)
- **Working name:** AudioShelf (renameable before public release)
- **Repo home:** `C:\Agent Projects\AudioShelf` (own git repo, published to user's GitHub)

## 1. Summary

A Windows desktop app for listening to a large personal library of **short-form spoken
audio** (works of ~5 min–1 hr, listened to a chapter at a time). The collection has **no
embedded metadata** — the only signal is the folder name (one folder per author) and the
filenames. AudioShelf builds and owns an indexed library on top of those files, tracks
played/unplayed state, lets the user tag authors, and surfaces content through a
tag-driven discovery panel. The app is **read-only on the audio files by default**, with
one explicit, reversible rename tool.

## 2. Principles

- **Read-only by default.** The app never renames, moves, or deletes audio files except
  through the explicit, opt-in rename tool (Section 9), which requires preview +
  confirmation and writes an undo manifest.
- **App-owned metadata.** Files carry no tags, so the SQLite DB is the source of truth for
  grouping, tags, played-flags, and any cleaned-up display titles. The audio bytes on disk
  are the only thing the DB does not own.
- **Crash-safe & resumable scanning.** Re-scans are incremental and idempotent; an
  interrupted scan never corrupts the index or loses prior state.
- **Defensive file ops.** Any disk mutation (rename tool only) verifies the target before
  acting, prefers recoverable operations, and fails safe. (Standing user preference.)
- **Autonomous self-verification.** The app ships with a fixture generator and launch/screenshot
  hooks so UI states can be verified end-to-end headlessly before being shown to the user
  (ported from MangaReader).

## 3. Tech stack & architecture

Mirrors MangaReader: **Tauri 2 + React 18 + TypeScript + SQLite**, Vitest for tests.

Three layers:

- **Rust core (`src-tauri/`)** — folder scanning, filename→work grouping, SQLite access,
  the rename tool, and the launch/screenshot harness. All heavy or file-mutating work lives
  here.
- **React/TS front-end (`src/`)** — library browsing, discovery panel, player, tag editing.
  Communicates with Rust through Tauri commands.
- **SQLite** — the indexed library and all app-owned metadata.

Playback uses the WebView's native `<audio>` element. Chromium/WebView2 natively decodes
all required formats (MP3, M4A/AAC, Opus/OGG, FLAC, WAV), so no external codecs or
transcoding are required.

## 4. Library model & scanning

- **Source:** a single user-selected **root folder**. Each immediate subfolder is an
  **author**. Each audio file within is a candidate **chapter**.
- **Scale target:** large — 300+ authors, 10k+ files. Lists are virtualized; search and
  discovery run off indexed SQLite queries; scanning is incremental.
- **Formats:** `.mp3`, `.m4a`/`.aac`/`.mp4`(audio), `.opus`/`.ogg`, `.flac`, `.wav`.

### Grouping heuristic (filenames → works)

The only grouping signal is the filename. Observed pattern (confirmed by user):

```
Author Name/
  Cool Story.mp3              -> work "Cool Story", chapter 1
  Cool Story 2 the sequel.mp3 -> work "Cool Story", chapter 2
  Cool Story 3 finale.mp3     -> work "Cool Story", chapter 3
  Another Standalone Tale.mp3 -> work "Another Standalone Tale", single chapter
```

Rule: strip a trailing `<number> <optional extra words>` from the filename stem to derive a
**base title**. Files within one author sharing a base title form one **work**. The
unnumbered file is chapter 1; numbered files order by their number (natural sort). A file
with no detected siblings is a single-chapter (standalone) work.

The heuristic is fuzzy by nature, so grouping is **reviewable and overridable in the UI**.
Overrides (merge/split/reassign chapter, set base title, set chapter number) are stored in
the DB and **never written to disk**. This review surface is where filename/naming
refinement happens later.

## 5. Data model (SQLite)

- `authors` — `id`, `folder_name`, `display_name`
- `works` — `id`, `author_id`, `base_title`, `sort_key`
- `chapters` — `id`, `work_id`, `file_path`, `chapter_no`, `raw_filename`, `format`,
  `duration`, `played` (bool)
- `author_tags` — `author_id`, `tag` (many-to-many)
- `play_events` — `chapter_id`, `played_at` (feeds "recent plays" for discovery)
- `grouping_overrides` — user corrections to the heuristic grouping
- `settings` — library root path and app preferences

## 6. Library UI — Author → works → chapters

- Virtualized author list/sidebar (handles 300+ authors).
- Drill-down: author → their works → expand a work → its chapters.
- Played chapters are visibly marked.
- Search box filters across authors, works, and chapters.

## 7. Discovery panel

Three coordinated parts:

- **"For you" (default).** Suggests authors/works that share tags with the user's
  recently-played authors (via `play_events` + `author_tags`).
- **"Pick a tag".** A button switching to a multi-select tag chooser; results re-rank to
  works with matching/similar tags, weighted toward **mostly unplayed** content.
- **"More from this author".** Contextual section showing other works by the author the
  user is currently viewing/playing.

## 8. Tagging

- Tags are assigned to **authors** (not works/chapters), from the author view.
- Tag input autocompletes from existing tags.
- Tags are the sole driver of the discovery panel.

## 9. Playback

Bottom-bar / now-playing UI with:

- Play / pause and a draggable seek bar (current time + total time).
- Skip back/forward **±15s and ±30s**.
- **Volume** control.
- **Sleep timer** — auto-stop after a chosen number of minutes.

Behavior:

- **Stops after each chapter.** No auto-advance, no play queue, no continuous library play.
  The user picks the next item manually.
- **No per-second resume.** Progress is tracked only as played/unplayed (no exact-position
  bookmarking).
- **Played logic:** a chapter is auto-marked **played** when playback reaches its end; the
  user can also **manually toggle** any chapter played/unplayed.
- **No playback-speed/pitch control** (explicitly out of scope).

## 10. Opt-in rename tool

A separate, explicitly-triggered screen (off by default; app is fully usable without it):

- Shows a **preview diff** of current → proposed clean filenames.
- Requires explicit confirmation before any disk change.
- Performs renames defensively (verify target, fail safe) and writes an **undo manifest**
  enabling rollback — same defensive pattern as VideoTriage's swap/manifest approach.

## 11. Self-verification harness

Ported from MangaReader:

- **`tools/gen-fixture`** builds a synthetic library: author folders, multi-chapter and
  standalone works, silent audio files across the supported formats and varied durations.
- **Launch hooks** — `--folder`, `--autostart`, `--done-signal` — to drive the real app
  headlessly.
- **`capture.rs`** screenshots for walking every UI state.
- **`tools/verify.ps1`** orchestrates fixture → launch → screenshot → checks, so UI can be
  self-verified before being shown to the user.

## 12. Project layout

`C:\Agent Projects\AudioShelf`, own git repo on the user's GitHub, mirroring MangaReader:

```
AudioShelf/
  src/            React/TS front-end (views, player, discovery, harness client)
  src-tauri/      Rust core (scan, grouping, natsort, db, commands, rename, capture, launch)
  tools/          gen-fixture, verify.ps1, dev-env
  docs/           specs and notes
```

Tauri 2, React 18, TypeScript, Vitest, SQLite. Commits keep the user's human identity as
git author.

## 13. Out of scope (YAGNI for v1)

- Playback speed / pitch control.
- Transcoding or format conversion.
- Streaming / online sources / downloading.
- Auto-advance, play queue, continuous library play.
- Per-second / exact-position resume.
- A cover-art system — v1 uses simple generated placeholders (color + initials per author).
- Tags on works/chapters (tags are author-level only in v1).
