# AudioShelf

A Windows desktop application for browsing and listening to a large library of short-form spoken audio. Built with Tauri 2, React 18, TypeScript, and SQLite.

---

## What AudioShelf Does (Milestone 1)

Point AudioShelf at a root folder that contains one subfolder per author. It scans those folders, groups the audio files into **works** (multi-chapter or standalone), and lets you browse:

- **Author list** — all authors found under the root
- **Works list** — the works belonging to a selected author
- **Chapter list** — the individual audio files that make up a work, with played/unplayed markers
- **Manual played toggle** — mark any chapter played or unplayed

AudioShelf is **read-only** with respect to your audio files. It never moves, renames, or alters them.

---

## Playback (Milestone 2)

A persistent **now-playing bar** appears once you start a chapter (▶ next to any chapter in the author view):

- **Play / pause** and a **draggable seek bar** showing current / total time
- **Skip** back/forward **±15s** and **±30s**
- **Volume** control
- **Sleep timer** — auto-stop after 15, 30, or 60 minutes

When a chapter reaches its end it is **auto-marked played** (and a play event is recorded for future discovery), then playback **stops** — there is no auto-advance or queue, and no per-second resume (progress is played/unplayed only). You can still toggle played state manually at any time.

---

## Tags & Discovery (Milestone 3)

Authors can be **tagged** with free-text labels (e.g. `cozy`, `mystery`, `short`) from the author view — an inline tag editor with autocomplete drawn from tags you've already used. Tags are **author-level** (not per-work or per-chapter), and the audio files are never touched.

A **Discover** panel (reachable from the library) turns those tags plus your play history into suggestions:

- **For you** — works by authors who share tags with the authors you've recently played, ranked by how many tags they share. Only works with unplayed chapters appear.
- **Pick a tag** — check one or more tags to list mostly-unplayed works carrying those tags, ranked by shared-tag count.
- **More from this author** — every suggestion links straight to its author's full work list.

Discovery is computed entirely from the existing `author_tags` and `play_events` tables — no schema change, and read-only with respect to your audio.

---

## Opt-in Rename Tool (Milestone 4)

A separate **Rename tool** screen (reached from the library, off by default — the app is fully usable without ever opening it) normalises messy filenames to a canonical form derived from the detected grouping:

- `Cool Story 2 the sequel.mp3` → `Cool Story 2.mp3`
- `Cool Story.mp3`, `Area 51.wav`, `Another Standalone Tale.wav` → unchanged ("already clean")

It always shows a **preview diff** of current → proposed names first. Each row is classified:

- **rename** — a real, safe change.
- **already clean** — the name is already canonical; skipped.
- **conflict** — the target name is already taken (another file on disk, or two files that would collide); **never** renamed, never overwritten.

Nothing touches disk until you click **Rename N files**. Renames are performed **defensively and crash-safely**: every intended move is written to a JSONL undo manifest *before* the file is touched, the source/target are re-validated at the moment of rename, and each file is independent (one failure never corrupts the batch). An **Undo** button then rolls the whole batch back. Undo is *tolerant* — it only reverses a move when the new name exists and the original is free — so a crash at any point is fully recoverable, and undoing twice is harmless. The DB's `file_path`/`raw_filename` stay in sync with disk throughout.

This is the **only** part of AudioShelf that ever modifies your audio files, and only when you explicitly confirm.

---

## Filename Grouping Convention

AudioShelf groups files under one author by detecting a trailing chapter number in the filename stem. The rule is:

> The **first standalone integer ≥ 2** (not the very first token) is treated as a chapter number. Everything before it is the **base title**. Files that share a base title form one work.

**Example — Jane Doe folder:**

```
Cool Story.wav                 → work "Cool Story", chapter 1
Cool Story 2 the sequel.wav   → work "Cool Story", chapter 2
Cool Story 3 finale.wav       → work "Cool Story", chapter 3
Another Standalone Tale.wav   → standalone work (no chapter number)
```

**Edge case — "Area 51":** A lone numbered file with no siblings is **demoted** to a standalone work, so `Area 51.wav` becomes the work "Area 51" (chapter 1) and is not split into work "Area" / chapter 51.

---

## Grouping Review (Milestone 5)

The grouping heuristic is fuzzy, so it's **reviewable and correctable** right on the author view. Each chapter has an inline **Work title** and **Chapter #** field plus a **Reset** button:

- **Merge** two works → type the same Work title on their chapters.
- **Split** a chapter into its own work → give it a new, unique Work title.
- **Reassign** a chapter's position → change its Chapter #.
- **Reset** → drop the override and fall back to the heuristic.

Corrections are stored in the `grouping_overrides` table and applied on top of the heuristic by a DB-only regroup — they are **re-applied on every scan and never written to disk**, so your audio files are untouched. (Known v1 limit: renaming an overridden file via the rename tool orphans its override, since overrides are keyed on the file path.)

---

## Supported Audio Formats

| Format | Extensions |
|--------|------------|
| MP3 | `.mp3` |
| AAC / M4A | `.m4a`, `.aac`, `.mp4` |
| Opus / Ogg Vorbis | `.opus`, `.ogg` |
| FLAC | `.flac` |
| WAV | `.wav` |

Duration is probed via the [`lofty`](https://crates.io/crates/lofty) crate. Files in unsupported formats are silently skipped.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | [Tauri 2](https://tauri.app/) (Rust backend, WebView2 frontend) |
| UI framework | React 18 + TypeScript |
| Build / bundle | Vite 5 |
| Database | SQLite via `rusqlite` (stored in the OS app-data dir as `audioshelf.db`) |
| Audio metadata | `lofty` crate |
| Frontend tests | Vitest + React Testing Library |
| Rust tests | `cargo test` |

---

## Prerequisites

- **Node.js** (18 or later) and **npm**
- **Rust** (stable, via [rustup](https://rustup.rs/))
- **MSVC C++ toolchain** — install "Desktop development with C++" via Visual Studio Installer (required by Tauri on Windows)
- **`cargo-tauri`** CLI:

  ```powershell
  cargo install tauri-cli
  ```

> All `cargo` and `cargo tauri` commands must run inside the MSVC environment. Use `tools\dev-env.cmd` as a wrapper (see [Tools](#tools) below).

---

## Getting Started

### Install front-end dependencies

```powershell
npm install
```

### Run in development mode

```powershell
cmd /c "tools\dev-env.cmd cargo tauri dev"
```

This starts the Vite dev server and the Tauri shell together. Hot-reload works for the React front-end.

### Build a debug binary

```powershell
cmd /c "tools\dev-env.cmd cargo tauri build --debug --no-bundle"
```

The binary is written to `src-tauri\target\debug\audioshelf.exe`.

### Build a release binary

```powershell
cmd /c "tools\dev-env.cmd cargo tauri build"
```

### Run the tests

**Rust unit tests:**

```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```

**Front-end tests:**

```powershell
npm test
```

---

## Self-Verification Harness

The `tools\verify.ps1` script provides an end-to-end smoke test:

1. Regenerates a synthetic WAV library under `.fixture\`
2. Builds the app (debug, no bundle)
3. Launches it with harness flags against the fixture library
4. Walks through the `browse` UI scenario, capturing screenshots
5. Waits for a done-signal file, then reports results

```powershell
# Full run (build + verify)
.\tools\verify.ps1

# Skip the build step if the binary is already current
.\tools\verify.ps1 -SkipBuild

# Verify the now-playing player bar
.\tools\verify.ps1 -Walkthrough player

# Increase the timeout
.\tools\verify.ps1 -Walkthrough browse -TimeoutSec 300

# Verify the discovery panel (tags → For-you → pick-a-tag)
.\tools\verify.ps1 -Walkthrough discovery

# Verify the rename tool (preview → apply → undo round-trip)
.\tools\verify.ps1 -Walkthrough rename

# Verify grouping review (merge a work via override → reset)
.\tools\verify.ps1 -Walkthrough grouping
```

Available walkthroughs: `browse` (scan result → library → author detail), `player` (author detail → now-playing bar), `discovery` (seed tags + play history → For-you → pick a tag), `rename` (preview diff → apply all → undo, leaving the fixture pristine), and `grouping` (merge a work via a per-chapter override → reset, leaving the grouping pristine).

Screenshots are saved to `.shots\<walkthrough>\`. See [`tools/README.md`](tools/README.md) for full harness documentation.

---

## Roadmap

| Milestone | Status | Description |
|-----------|--------|-------------|
| **M1 — Foundation** | Shipped | Scan, group, browse, played markers |
| **M2 — Playback** | Shipped | Now-playing bar: play/pause, seek, skip ±15/30s, volume, sleep timer; auto-mark played on finish |
| **M3 — Tags & Discovery** | Shipped | Author tags with autocomplete; Discover panel (For-you, pick-a-tag, more-from-author) |
| **M4 — Rename tool** | Shipped | Opt-in, defensive, reversible batch rename to canonical filenames (preview diff + conflict-safe + crash-safe undo manifest) |
| **M5 — Grouping Review** | Shipped | Inline per-chapter Work/Chapter# correction (merge/split/reassign/reset) via DB-only overrides, re-applied on scan, never written to disk |

See [`ROADMAP.md`](ROADMAP.md) for the full roadmap (incl. M6 settings/library-root picker, M7 scale & search polish).

Design spec: [`docs/superpowers/specs/2026-06-11-audioshelf-design.md`](docs/superpowers/specs/2026-06-11-audioshelf-design.md)

Implementation plans: [M1 — Foundation](docs/superpowers/plans/2026-06-11-audioshelf-foundation.md) · [M2 — Playback](docs/superpowers/plans/2026-06-11-audioshelf-m2-playback.md) · [M3 — Tags & Discovery](docs/superpowers/plans/2026-06-11-audioshelf-m3-discovery.md) · [M4 — Rename Tool](docs/superpowers/plans/2026-06-11-audioshelf-m4-rename.md) · [M5 — Grouping Review](docs/superpowers/plans/2026-06-11-audioshelf-m5-grouping.md)

---

## Data & Privacy

AudioShelf stores grouping metadata and played flags in a SQLite database at the OS app-data directory (`%APPDATA%\com.audioshelf.app\audioshelf.db` on Windows). Your audio files are never modified.
