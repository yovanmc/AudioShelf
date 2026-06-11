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

# Use a different walkthrough and increase the timeout
.\tools\verify.ps1 -Walkthrough browse -TimeoutSec 300
```

Screenshots are saved to `.shots\<walkthrough>\`. See [`tools/README.md`](tools/README.md) for full harness documentation.

---

## Roadmap

| Milestone | Status | Description |
|-----------|--------|-------------|
| **M1 — Foundation** | Shipped | Scan, group, browse, played markers |
| **M2 — Playback** | Planned | In-app audio player and playback controls |
| **M3 — Tags & Discovery** | Planned | Author tags, filtering, discovery panel |
| **M4 — Rename tool** | Planned | Opt-in batch rename to normalise filenames |

Design spec: [`docs/superpowers/specs/2026-06-11-audioshelf-design.md`](docs/superpowers/specs/2026-06-11-audioshelf-design.md)

M1 implementation plan: [`docs/superpowers/plans/2026-06-11-audioshelf-foundation.md`](docs/superpowers/plans/2026-06-11-audioshelf-foundation.md)

---

## Data & Privacy

AudioShelf stores grouping metadata and played flags in a SQLite database at the OS app-data directory (`%APPDATA%\com.audioshelf.app\audioshelf.db` on Windows). Your audio files are never modified.
