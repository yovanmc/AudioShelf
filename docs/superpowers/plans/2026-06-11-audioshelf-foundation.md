# AudioShelf — Milestone 1: Foundation & Library Browsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the AudioShelf Tauri app and ship a working, self-verified library browser: scan a single root folder of `Author/` directories full of loose audio files, group files into multi-chapter works by filename, and browse Author → works → chapters with played/unplayed markers and a manual played toggle.

**Architecture:** Tauri 2 + React 18 + TypeScript + SQLite, mirroring MangaReader (`C:\Agent Projects\MangaReader`). A Rust core (`src-tauri`) scans the filesystem, groups files, and owns a SQLite metadata DB; a React front-end browses via Tauri `invoke` commands. A ported self-verification harness (launch hooks + screenshot capture + WAV fixture + `verify.ps1`) lets us confirm UI states headlessly.

**Tech Stack:** Tauri 2, Rust (rusqlite bundled, clap, serde, walkdir, lofty for duration, image, xcap, windows crate), React 18, TypeScript, Vite, Vitest, `hound` (WAV fixture generation).

**Reference codebase:** MangaReader at `C:\Agent Projects\MangaReader`. Several files are near-verbatim ports; tasks name the exact source file and the exact substitutions. The executing engineer/subagent has read access to that repo and MUST open the named source file when a task says "port from".

**Milestone scope (this plan):** scaffold, Rust core (natsort, grouping, db, model, scan, launch, capture, commands subset, lib wiring), front-end (api, App routing, ScanView, LibraryView, AuthorDetailView), harness, fixture + verify tooling, end-to-end self-verification.

**Out of scope (later milestones — see Appendix):** the audio player & playback controls (M2), author tags & the discovery panel (M3), the opt-in rename tool (M4).

**Global conventions:**
- App/exe/db name: `audioshelf` (lowercase for exe/db), display title "AudioShelf".
- Every Rust command returns `Result<T, String>` via `.map_err(|e| e.to_string())?`.
- SQLite access through `DbState(pub Mutex<rusqlite::Connection>)`.
- All serde structs use `#[serde(rename_all = "camelCase")]`.
- Commit after every task with the message shown in its final step. Keep the human git identity as author (do NOT add any AI co-author trailer — the repo's `AGENTS.md` only governs Codex commits, which these are not).

---

## File Structure

**Rust core — `src-tauri/src/`** (one responsibility each):
- `main.rs` — Windows subsystem shim; calls `audioshelf_lib::run()`.
- `lib.rs` — Tauri builder: parse launch args, init DB, register commands.
- `launch.rs` — `LaunchArgs` clap struct + `parse_lenient`.
- `db.rs` — SQLite schema + `open` / `open_in_memory` / `migrate`.
- `model.rs` — serde structs returned to the front-end.
- `natsort.rs` — `natural_cmp` for human-friendly ordering.
- `grouping.rs` — filename → work/chapter clustering (audio-specific, set-aware).
- `scan.rs` — walk root → authors → works → chapters; idempotent upserts; duration probe.
- `commands.rs` — `DbState`, `init_db`, and the Tauri command functions.
- `capture.rs` — window screenshot + `finish_walkthrough` (verbatim port).

**Front-end — `src/`**:
- `main.tsx` — React root mount.
- `App.tsx` — routing + harness bootstrap.
- `lib/api.ts` — typed `invoke` wrappers + shared TS types.
- `lib/library.ts` — pure helpers (`matchesSearch`, `summarizeAuthor`).
- `views/ScanView.tsx` — scan trigger + result counts.
- `views/LibraryView.tsx` — virtualized author list + search.
- `views/AuthorDetailView.tsx` — works → chapters, played markers + toggle.
- `harness/types.ts`, `harness/runner.ts`, `harness/walkthroughs.ts` — self-verification.

**Tooling — `tools/`**:
- `gen-fixture/` — Rust bin: synthesize a WAV author/work library.
- `dev-env.cmd` — MSVC + cargo environment wrapper (verbatim port).
- `verify.ps1` — fixture → build → launch → wait-for-signal orchestration.

---

## Task 1: Scaffold the Tauri + React + TypeScript project

**Files:**
- Create: `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `src/main.tsx`, `src/App.tsx`, `src/test-setup.ts`, `src/vite-env.d.ts`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Create: `tools/dev-env.cmd`
- Copy: `src-tauri/icons/` from MangaReader (icons are required by the bundler)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "audioshelf",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AudioShelf</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

- [ ] **Step 4: Create `tsconfig.json` and `tsconfig.node.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `src/main.tsx`, `src/test-setup.ts`, `src/vite-env.d.ts`, and a placeholder `src/App.tsx`**

`src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`src/App.tsx` (placeholder, replaced in Task 13):
```tsx
export default function App() {
  return <div>AudioShelf</div>;
}
```

- [ ] **Step 6: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "audioshelf"
version = "0.1.0"
edition = "2021"

[lib]
name = "audioshelf_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.32", features = ["bundled"] }
clap = { version = "4", features = ["derive"] }
walkdir = "2"
lofty = "0.21"
image = "0.25"
xcap = "0.0.14"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_Graphics_Gdi",
  "Win32_UI_WindowsAndMessaging",
  "Win32_Storage_Xps",
] }

[dev-dependencies]
tempfile = "3"
gen-fixture = { path = "../tools/gen-fixture" }
```

> Note: the `gen-fixture` dev-dependency is added in Task 18; until then, comment that line out so the crate builds. Step 6 should include it commented: `# gen-fixture = { path = "../tools/gen-fixture" }`.

- [ ] **Step 7: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 8: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AudioShelf",
  "version": "0.1.0",
  "identifier": "com.audioshelf.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "AudioShelf",
        "width": 1280,
        "height": 860
      }
    ],
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **Step 9: Copy icons and create the Rust entry points**

Copy the icons directory:
```powershell
Copy-Item -Recurse "C:\Agent Projects\MangaReader\src-tauri\icons" "C:\Agent Projects\AudioShelf\src-tauri\icons"
```

`src-tauri/src/main.rs`:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    audioshelf_lib::run();
}
```

`src-tauri/src/lib.rs` (minimal; expanded in Task 12):
```rust
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`tools/dev-env.cmd` — copy verbatim from `C:\Agent Projects\MangaReader\tools\dev-env.cmd` (no edits needed; it only sets up the MSVC + cargo environment).

- [ ] **Step 10: Install JS deps and verify the front-end builds**

Run:
```powershell
cd "C:\Agent Projects\AudioShelf"; npm install; npm run build
```
Expected: `tsc` passes and Vite writes `dist/`. No errors.

- [ ] **Step 11: Verify the Rust crate builds**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"
```
Expected: compiles successfully (warnings about unused code are fine).

- [ ] **Step 12: Commit**

```powershell
cd "C:\Agent Projects\AudioShelf"; git add -A; git commit -m "chore: scaffold Tauri + React + TS project"
```

---

## Task 2: `natsort.rs` — natural ordering

**Files:**
- Create: `src-tauri/src/natsort.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod natsort;`)

- [ ] **Step 1: Write the failing test** (append to `src-tauri/src/natsort.rs`)

```rust
//! Natural (human) ordering: digit runs compare numerically, other text
//! compares case-insensitively. So "2" < "10" and "Tale 2" < "Tale 10".

use std::cmp::Ordering;

pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) => {
                if ca.is_ascii_digit() && cb.is_ascii_digit() {
                    let na: String = take_digits(&mut ai);
                    let nb: String = take_digits(&mut bi);
                    let va: u64 = na.parse().unwrap_or(0);
                    let vb: u64 = nb.parse().unwrap_or(0);
                    match va.cmp(&vb) {
                        Ordering::Equal => continue,
                        other => return other,
                    }
                } else {
                    let la = ca.to_ascii_lowercase();
                    let lb = cb.to_ascii_lowercase();
                    match la.cmp(&lb) {
                        Ordering::Equal => {
                            ai.next();
                            bi.next();
                        }
                        other => return other,
                    }
                }
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    while let Some(&c) = it.peek() {
        if c.is_ascii_digit() {
            s.push(c);
            it.next();
        } else {
            break;
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::natural_cmp;
    use std::cmp::Ordering;

    #[test]
    fn numbers_compare_numerically() {
        assert_eq!(natural_cmp("Tale 2", "Tale 10"), Ordering::Less);
        assert_eq!(natural_cmp("2", "10"), Ordering::Less);
        assert_eq!(natural_cmp("10", "2"), Ordering::Greater);
    }

    #[test]
    fn text_compares_case_insensitively() {
        assert_eq!(natural_cmp("apple", "Apple"), Ordering::Equal);
        assert_eq!(natural_cmp("Apple", "banana"), Ordering::Less);
    }
}
```

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add at the top: `mod natsort;`

- [ ] **Step 3: Run the tests**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml natsort"
```
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: natural-order comparison for library sorting"
```

---

## Task 3: `grouping.rs` — filename → work/chapter clustering (audio-specific)

This is the heart of the library model and differs from MangaReader. We parse each
filename *stem* (no extension) into a base title + chapter number, then cluster files
under one author by base title. The chapter number is the **first standalone integer ≥ 2**
in the stem; text before it is the base, text after is ignored "extra words". A lone file
that parsed a number but has no siblings is demoted to a standalone work (guards against
titles like "Area 51").

**Files:**
- Create: `src-tauri/src/grouping.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod grouping;`)

> **Implementation correction (applied during execution):** `Chapter` carries BOTH a
> canonical display `stem` (e.g. `"Cool Story 2"`) AND an `original_stem` field holding the
> verbatim on-disk filename stem (e.g. `"Cool Story 2 the sequel"`); `Parsed` gains an
> `original` field. `scan.rs` MUST match files by `original_stem`, because the canonical
> `stem` drops the trailing extra words and would fail to locate the file. See the committed
> `src-tauri/src/grouping.rs` and `src-tauri/src/scan.rs` for the authoritative version. The
> skeleton below is the pre-correction draft kept for context.

- [ ] **Step 1: Write the failing test + implementation skeleton** (`src-tauri/src/grouping.rs`)

```rust
//! Group loose audio filenames under one author into works of ordered chapters.
//! Rule: the chapter number is the first standalone integer >= 2 in the stem;
//! text before it is the base title. Files sharing a base title form one work.
//! A lone numbered file with no siblings is demoted to a standalone work so that
//! titles like "Area 51" are not split into work "Area" / chapter 51.

use crate::natsort::natural_cmp;

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub base: String,
    pub chapter_no: u32,
    pub had_number: bool,
}

/// Parse one filename stem (without extension).
pub fn parse_stem(stem: &str) -> Parsed {
    let tokens: Vec<&str> = stem.split_whitespace().collect();
    for (i, tok) in tokens.iter().enumerate() {
        if i == 0 {
            continue; // a leading number is part of the title, never a chapter marker
        }
        if let Ok(n) = tok.parse::<u32>() {
            if n >= 2 {
                let base = tokens[..i].join(" ");
                if !base.is_empty() {
                    return Parsed { base, chapter_no: n, had_number: true };
                }
            }
        }
    }
    Parsed { base: stem.trim().to_string(), chapter_no: 1, had_number: false }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Chapter {
    pub stem: String,
    pub chapter_no: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Work {
    pub base_title: String,
    pub chapters: Vec<Chapter>,
}

/// Group a set of filename stems (all under one author) into works.
pub fn group_author(stems: &[String]) -> Vec<Work> {
    use std::collections::BTreeMap;
    // Preserve stable ordering of bases by first appearance via an index map.
    let mut order: Vec<String> = Vec::new();
    let mut clusters: BTreeMap<String, Vec<Parsed>> = BTreeMap::new();
    for stem in stems {
        let p = parse_stem(stem);
        if !clusters.contains_key(&p.base) {
            order.push(p.base.clone());
        }
        clusters.entry(p.base.clone()).or_default().push(Parsed {
            base: p.base.clone(),
            chapter_no: p.chapter_no,
            had_number: p.had_number,
        });
    }

    let mut works: Vec<Work> = Vec::new();
    for base in &order {
        let group = &clusters[base];
        let multi = group.len() > 1;
        for p in group {
            if !multi && p.had_number {
                // Demote a lone numbered file to a standalone work keyed on its full stem.
                let full = if p.chapter_no >= 2 {
                    format!("{} {}", p.base, p.chapter_no)
                } else {
                    p.base.clone()
                };
                works.push(Work {
                    base_title: full.clone(),
                    chapters: vec![Chapter { stem: full, chapter_no: 1 }],
                });
            } else {
                let stem = if p.had_number {
                    format!("{} {}", p.base, p.chapter_no)
                } else {
                    p.base.clone()
                };
                if let Some(w) = works.iter_mut().find(|w| w.base_title == *base && multi) {
                    w.chapters.push(Chapter { stem, chapter_no: p.chapter_no });
                } else {
                    works.push(Work {
                        base_title: base.clone(),
                        chapters: vec![Chapter { stem, chapter_no: p.chapter_no }],
                    });
                }
            }
        }
    }
    for w in &mut works {
        w.chapters.sort_by(|a, b| a.chapter_no.cmp(&b.chapter_no).then(natural_cmp(&a.stem, &b.stem)));
    }
    works
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_base_and_chapter() {
        assert_eq!(parse_stem("Cool Story"), Parsed { base: "Cool Story".into(), chapter_no: 1, had_number: false });
        assert_eq!(parse_stem("Cool Story 2 the sequel"), Parsed { base: "Cool Story".into(), chapter_no: 2, had_number: true });
        assert_eq!(parse_stem("Cool Story 3 finale"), Parsed { base: "Cool Story".into(), chapter_no: 3, had_number: true });
    }

    #[test]
    fn groups_multichapter_and_standalone() {
        let stems = vec![
            "Cool Story".to_string(),
            "Cool Story 2 the sequel".to_string(),
            "Cool Story 3 finale".to_string(),
            "Another Standalone Tale".to_string(),
        ];
        let works = group_author(&stems);
        assert_eq!(works.len(), 2);
        let cool = works.iter().find(|w| w.base_title == "Cool Story").unwrap();
        assert_eq!(cool.chapters.iter().map(|c| c.chapter_no).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert!(works.iter().any(|w| w.base_title == "Another Standalone Tale" && w.chapters.len() == 1));
    }

    #[test]
    fn lone_numbered_file_is_demoted_to_standalone() {
        let works = group_author(&vec!["Area 51".to_string()]);
        assert_eq!(works.len(), 1);
        assert_eq!(works[0].base_title, "Area 51");
        assert_eq!(works[0].chapters.len(), 1);
        assert_eq!(works[0].chapters[0].chapter_no, 1);
    }
}
```

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add: `mod grouping;`

- [ ] **Step 3: Run the tests**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml grouping"
```
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: filename-based work/chapter grouping for an author"
```

---

## Task 4: `db.rs` — SQLite schema and connection

**Files:**
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod db;`)

- [ ] **Step 1: Write the schema + open functions + test** (`src-tauri/src/db.rs`)

```rust
//! SQLite schema and connection helpers. The DB is the source of truth for all
//! app-owned metadata (grouping, played flags, tags, play history). Audio files
//! on disk are never modified by this layer.

use rusqlite::Connection;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY,
  folder_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES authors(id),
  base_title TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(author_id, base_title)
);
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  file_path TEXT NOT NULL UNIQUE,
  raw_filename TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  format TEXT NOT NULL,
  duration_secs INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS author_tags (
  author_id INTEGER NOT NULL REFERENCES authors(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (author_id, tag)
);
CREATE TABLE IF NOT EXISTS play_events (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  played_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grouping_overrides (
  chapter_path TEXT PRIMARY KEY,
  base_title TEXT,
  chapter_no INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
"#;

/// Open a file-backed connection and ensure the schema exists (idempotent).
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

/// Open an in-memory connection (for tests).
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_V1)?;
    conn.execute_batch("INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version','1');")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_creates_all_tables() {
        let conn = open_in_memory().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('authors','works','chapters','author_tags','play_events','grouping_overrides','settings')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 7);
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = open_in_memory().unwrap();
        // Running migrate again must not error.
        super::migrate(&conn).unwrap();
    }
}
```

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add: `mod db;`

- [ ] **Step 3: Run the tests**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml db"
```
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: SQLite schema and connection helpers"
```

---

## Task 5: `model.rs` — serde structs for the front-end

**Files:**
- Create: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod model;`)

- [ ] **Step 1: Write the structs** (`src-tauri/src/model.rs`)

```rust
//! Data returned to the front-end. All camelCase for JS consumption.

use serde::Serialize;

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub authors: usize,
    pub works: usize,
    pub chapters: usize,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorRow {
    pub id: i64,
    pub name: String,        // display_name if set, else folder_name
    pub work_count: i64,
    pub chapter_count: i64,
    pub unplayed_count: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRow {
    pub id: i64,
    pub title: String,       // raw_filename without extension
    pub chapter_no: i64,
    pub format: String,
    pub duration_secs: i64,
    pub file_path: String,
    pub played: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkRow {
    pub id: i64,
    pub base_title: String,
    pub chapters: Vec<ChapterRow>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorDetail {
    pub id: i64,
    pub name: String,
    pub works: Vec<WorkRow>,
}
```

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add: `mod model;`

- [ ] **Step 3: Verify it compiles**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"
```
Expected: compiles (unused-code warnings are fine).

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: front-end data models"
```

---

## Task 6: `scan.rs` — walk the library and populate the DB

**Files:**
- Create: `src-tauri/src/scan.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod scan;`)

Scan logic: for the single root, each immediate subdirectory is an author. Within an
author, collect audio files (by extension), parse stems through `grouping::group_author`,
then upsert authors → works → chapters. Idempotent on `authors.folder_name`,
`works(author_id, base_title)`, and `chapters.file_path`. Duration is probed with `lofty`
(0 on failure — fail-safe).

- [ ] **Step 1: Write the implementation + test** (`src-tauri/src/scan.rs`)

```rust
//! Scan a single root folder of `Author/` directories full of loose audio files
//! into the DB. Idempotent: re-scanning updates rather than duplicating.

use crate::grouping::{group_author, Work};
use crate::model::ScanResult;
use crate::natsort::natural_cmp;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "mp4", "opus", "ogg", "flac", "wav"];

fn is_audio(ext: &str) -> bool {
    AUDIO_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

fn sorted_dirs(root: &Path) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<_> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));
    dirs
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

/// Probe duration in whole seconds; 0 on any failure.
fn probe_duration_secs(path: &Path) -> i64 {
    match lofty::read_from_path(path) {
        Ok(tagged) => {
            use lofty::file::AudioFile;
            tagged.properties().duration().as_secs() as i64
        }
        Err(_) => 0,
    }
}

pub fn scan_into(conn: &Connection, root: &Path) -> rusqlite::Result<ScanResult> {
    for author_path in sorted_dirs(root) {
        let folder = file_name(&author_path);
        conn.execute(
            "INSERT INTO authors(folder_name, status) VALUES (?1, 'active')
             ON CONFLICT(folder_name) DO UPDATE SET status='active'",
            params![folder],
        )?;
        let author_id: i64 = conn.query_row(
            "SELECT id FROM authors WHERE folder_name=?1",
            params![folder],
            |r| r.get(0),
        )?;

        // Collect audio files in this author dir (top-level only).
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&author_path)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .map(|x| is_audio(&x.to_string_lossy()))
                        .unwrap_or(false)
            })
            .collect();
        files.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));

        let stems: Vec<String> = files
            .iter()
            .map(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())
            .collect();
        let works: Vec<Work> = group_author(&stems);

        for work in works {
            conn.execute(
                "INSERT INTO works(author_id, base_title, sort_key, status)
                 VALUES (?1, ?2, ?3, 'active')
                 ON CONFLICT(author_id, base_title) DO UPDATE SET status='active'",
                params![author_id, work.base_title, work.base_title.to_lowercase()],
            )?;
            let work_id: i64 = conn.query_row(
                "SELECT id FROM works WHERE author_id=?1 AND base_title=?2",
                params![author_id, work.base_title],
                |r| r.get(0),
            )?;

            for chapter in work.chapters {
                // Find the on-disk file whose stem matches this chapter.
                let file = files.iter().find(|p| {
                    p.file_stem().map(|s| s.to_string_lossy() == chapter.stem).unwrap_or(false)
                });
                let Some(file) = file else { continue };
                let path_str = file.to_string_lossy().to_string();
                let raw = file_name(file);
                let format = file
                    .extension()
                    .map(|x| x.to_string_lossy().to_ascii_lowercase())
                    .unwrap_or_default();
                let duration = probe_duration_secs(file);
                upsert_chapter(conn, work_id, &path_str, &raw, chapter.chapter_no, &format, duration)?;
            }
        }
    }

    Ok(ScanResult {
        authors: count(conn, "authors"),
        works: count(conn, "works"),
        chapters: count(conn, "chapters"),
    })
}

fn upsert_chapter(
    conn: &Connection,
    work_id: i64,
    path: &str,
    raw: &str,
    chapter_no: u32,
    format: &str,
    duration: i64,
) -> rusqlite::Result<()> {
    // Preserve the played flag on re-scan by only updating non-played columns.
    let _existing: Option<i64> = conn
        .query_row("SELECT id FROM chapters WHERE file_path=?1", params![path], |r| r.get(0))
        .optional()?;
    conn.execute(
        "INSERT INTO chapters(work_id, file_path, raw_filename, chapter_no, format, duration_secs, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active')
         ON CONFLICT(file_path) DO UPDATE SET
           work_id=excluded.work_id,
           raw_filename=excluded.raw_filename,
           chapter_no=excluded.chapter_no,
           format=excluded.format,
           duration_secs=excluded.duration_secs,
           status='active'",
        params![work_id, path, raw, chapter_no as i64, format, duration],
    )?;
    Ok(())
}

fn count(conn: &Connection, table: &str) -> usize {
    conn.query_row(&format!("SELECT count(*) FROM {table} WHERE status='active'"), [], |r| {
        r.get::<_, i64>(0)
    })
    .unwrap_or(0) as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use std::fs::{self, File};

    fn touch(path: &std::path::Path) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        File::create(path).unwrap();
    }

    #[test]
    fn scan_groups_files_into_works_and_chapters() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Some Author");
        touch(&author.join("Cool Story.mp3"));
        touch(&author.join("Cool Story 2 the sequel.mp3"));
        touch(&author.join("Cool Story 3 finale.mp3"));
        touch(&author.join("Another Standalone Tale.wav"));

        let conn = open_in_memory().unwrap();
        let report = scan_into(&conn, root).unwrap();
        assert_eq!(report.authors, 1);
        assert_eq!(report.works, 2);
        assert_eq!(report.chapters, 4);
    }

    #[test]
    fn rescan_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("A");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Tale 2.mp3"));

        let conn = open_in_memory().unwrap();
        let first = scan_into(&conn, root).unwrap();
        let second = scan_into(&conn, root).unwrap();
        assert_eq!(first, second);
        assert_eq!(second.chapters, 2);
    }
}
```

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add: `mod scan;`

- [ ] **Step 3: Run the tests**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml scan"
```
Expected: PASS (2 tests). (The empty files have no audio header, so `probe_duration_secs` returns 0 — that is the intended fail-safe and does not break the test.)

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: filesystem scan into the library DB"
```

---

## Task 7: `launch.rs` — launch-arg parsing (port)

**Files:**
- Create: `src-tauri/src/launch.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod launch;`)

- [ ] **Step 1: Write the struct + lenient parse + test** (`src-tauri/src/launch.rs`)

```rust
//! CLI launch args used by the self-verification harness. Ported from MangaReader;
//! `parse_lenient` ignores unknown args the WebView/Tauri may inject.

use clap::Parser;
use serde::Serialize;

#[derive(Parser, Debug, Clone, Serialize, Default)]
#[command(name = "AudioShelf")]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    #[arg(long)]
    pub library: Option<String>,
    #[arg(long, default_value_t = false)]
    pub autostart: bool,
    #[arg(long)]
    pub walkthrough: Option<String>,
    #[arg(long)]
    pub shots: Option<String>,
    #[arg(long)]
    pub done_signal: Option<String>,
    #[arg(long, default_value_t = false)]
    pub exit_when_done: bool,
}

impl LaunchArgs {
    pub fn parse_lenient<I: IntoIterator<Item = String>>(args: I) -> Self {
        LaunchArgs::try_parse_from(args).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::LaunchArgs;

    #[test]
    fn parses_known_flags() {
        let args = LaunchArgs::parse_lenient(
            ["audioshelf", "--library", "C:/lib", "--autostart", "--walkthrough", "browse"]
                .map(String::from),
        );
        assert_eq!(args.library.as_deref(), Some("C:/lib"));
        assert!(args.autostart);
        assert_eq!(args.walkthrough.as_deref(), Some("browse"));
    }

    #[test]
    fn ignores_unknown_args() {
        let args = LaunchArgs::parse_lenient(["audioshelf", "--webview-flag=xyz"].map(String::from));
        assert!(args.library.is_none());
    }
}
```

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add: `mod launch;`

- [ ] **Step 3: Run the tests**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml launch"
```
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: lenient launch-arg parsing for the harness"
```

---

## Task 8: `capture.rs` — window screenshot + finish signal (verbatim port)

**Files:**
- Create: `src-tauri/src/capture.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod capture;`)

- [ ] **Step 1: Port the file.** Copy `C:\Agent Projects\MangaReader\src-tauri\src\capture.rs` verbatim to `src-tauri/src/capture.rs`. It defines `capture_window` (Win32 `PrintWindow` with `PW_RENDERFULLCONTENT`, `xcap` monitor fallback) and `finish_walkthrough` (writes the done-signal file, optionally exits). No edits are required — it references no app-specific names.

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add: `mod capture;`

- [ ] **Step 3: Verify it compiles**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"
```
Expected: compiles.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: window capture + walkthrough finish signal (ported)"
```

---

## Task 9: `commands.rs` — DbState, init_db, and Milestone-1 commands

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod commands;`)

Commands for this milestone: `scan_library`, `get_authors`, `get_author_detail`,
`set_chapter_played`, `set_author_display_name`. (Tags, discovery, playback, and rename
arrive in later milestones.)

- [ ] **Step 1: Write commands + a query-helper test** (`src-tauri/src/commands.rs`)

```rust
//! Tauri commands and the shared DB state.

use crate::db;
use crate::model::{AuthorDetail, AuthorRow, ChapterRow, ScanResult, WorkRow};
use crate::natsort::natural_cmp;
use crate::scan;
use rusqlite::params;
use std::sync::Mutex;

pub struct DbState(pub Mutex<rusqlite::Connection>);

pub fn init_db(app: &tauri::AppHandle) -> rusqlite::Connection {
    use tauri::Manager;
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("audioshelf.db");
    db::open(&path.to_string_lossy()).expect("open db")
}

#[tauri::command]
pub fn scan_library(state: tauri::State<DbState>, root: String) -> Result<ScanResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    scan::scan_into(&conn, std::path::Path::new(&root)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_authors(state: tauri::State<DbState>) -> Result<Vec<AuthorRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let rows = query_authors(&conn).map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn get_author_detail(state: tauri::State<DbState>, author_id: i64) -> Result<AuthorDetail, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    query_author_detail(&conn, author_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_played(state: tauri::State<DbState>, chapter_id: i64, played: bool) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapters SET played=?2 WHERE id=?1",
        params![chapter_id, played as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_author_display_name(state: tauri::State<DbState>, author_id: i64, name: Option<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE authors SET display_name=?2 WHERE id=?1",
        params![author_id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- query helpers (pub(crate) so integration tests can call them) ----

pub(crate) fn query_authors(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<AuthorRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.id,
                COALESCE(a.display_name, a.folder_name) AS name,
                (SELECT count(*) FROM works w WHERE w.author_id=a.id AND w.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active'),
                (SELECT count(*) FROM chapters c JOIN works w ON c.work_id=w.id
                   WHERE w.author_id=a.id AND c.status='active' AND c.played=0)
         FROM authors a WHERE a.status='active'",
    )?;
    let mut rows: Vec<AuthorRow> = stmt
        .query_map([], |r| {
            Ok(AuthorRow {
                id: r.get(0)?,
                name: r.get(1)?,
                work_count: r.get(2)?,
                chapter_count: r.get(3)?,
                unplayed_count: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    rows.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    Ok(rows)
}

pub(crate) fn query_author_detail(conn: &rusqlite::Connection, author_id: i64) -> rusqlite::Result<AuthorDetail> {
    let name: String = conn.query_row(
        "SELECT COALESCE(display_name, folder_name) FROM authors WHERE id=?1",
        params![author_id],
        |r| r.get(0),
    )?;

    let mut wstmt = conn.prepare(
        "SELECT id, base_title FROM works WHERE author_id=?1 AND status='active'",
    )?;
    let mut works: Vec<WorkRow> = wstmt
        .query_map(params![author_id], |r| {
            Ok(WorkRow { id: r.get(0)?, base_title: r.get(1)?, chapters: Vec::new() })
        })?
        .collect::<rusqlite::Result<_>>()?;
    works.sort_by(|a, b| natural_cmp(&a.base_title, &b.base_title));

    for work in &mut works {
        let mut cstmt = conn.prepare(
            "SELECT id, raw_filename, chapter_no, format, duration_secs, file_path, played
             FROM chapters WHERE work_id=?1 AND status='active'",
        )?;
        let mut chapters: Vec<ChapterRow> = cstmt
            .query_map(params![work.id], |r| {
                let raw: String = r.get(1)?;
                let title = std::path::Path::new(&raw)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(raw);
                Ok(ChapterRow {
                    id: r.get(0)?,
                    title,
                    chapter_no: r.get(2)?,
                    format: r.get(3)?,
                    duration_secs: r.get(4)?,
                    file_path: r.get(5)?,
                    played: r.get::<_, i64>(6)? != 0,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        chapters.sort_by(|a, b| a.chapter_no.cmp(&b.chapter_no));
        work.chapters = chapters;
    }

    Ok(AuthorDetail { id: author_id, name, works })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use std::fs::{self, File};

    fn touch(path: &std::path::Path) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        File::create(path).unwrap();
    }

    #[test]
    fn authors_and_detail_reflect_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let author = root.join("Author One");
        touch(&author.join("Tale.mp3"));
        touch(&author.join("Tale 2.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();

        let authors = query_authors(&conn).unwrap();
        assert_eq!(authors.len(), 1);
        assert_eq!(authors[0].name, "Author One");
        assert_eq!(authors[0].chapter_count, 2);
        assert_eq!(authors[0].unplayed_count, 2);

        let detail = query_author_detail(&conn, authors[0].id).unwrap();
        assert_eq!(detail.works.len(), 1);
        assert_eq!(detail.works[0].chapters.len(), 2);
    }

    #[test]
    fn marking_played_decrements_unplayed() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(&root.join("A").join("X.mp3"));
        let conn = open_in_memory().unwrap();
        scan::scan_into(&conn, root).unwrap();
        let detail = query_author_detail(&conn, query_authors(&conn).unwrap()[0].id).unwrap();
        let ch = detail.works[0].chapters[0].id;
        conn.execute("UPDATE chapters SET played=1 WHERE id=?1", params![ch]).unwrap();
        let authors = query_authors(&conn).unwrap();
        assert_eq!(authors[0].unplayed_count, 0);
    }
}
```

- [ ] **Step 2: Register the module.** In `src-tauri/src/lib.rs`, add: `mod commands;`

- [ ] **Step 3: Run the tests**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml commands"
```
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: library query/mutation commands"
```

---

## Task 10: `lib.rs` — wire the Tauri builder

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace `lib.rs` body** with the full wiring (keep the `mod` declarations added in earlier tasks):

```rust
mod capture;
mod commands;
mod db;
mod grouping;
mod launch;
mod model;
mod natsort;
mod scan;

use commands::DbState;
use launch::LaunchArgs;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn get_launch_args(state: tauri::State<LaunchArgs>) -> LaunchArgs {
    state.inner().clone()
}

pub fn run() {
    let args = LaunchArgs::parse_lenient(std::env::args());
    tauri::Builder::default()
        .manage(args)
        .setup(|app| {
            let conn = commands::init_db(&app.handle());
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_launch_args,
            capture::capture_window,
            capture::finish_walkthrough,
            commands::scan_library,
            commands::get_authors,
            commands::get_author_detail,
            commands::set_chapter_played,
            commands::set_author_display_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Exposed for integration tests.
pub mod testing {
    pub use crate::commands::{query_author_detail, query_authors};
    pub use crate::db::open_in_memory;
    pub use crate::scan::scan_into;
}
```

- [ ] **Step 2: Build the full app**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri\Cargo.toml"
```
Expected: compiles with no errors.

- [ ] **Step 3: Run the whole Rust test suite**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "feat: wire Tauri builder, DB state, and command handlers"
```

---

## Task 11: `src/lib/api.ts` — typed invoke wrappers

**Files:**
- Create: `src/lib/api.ts`

- [ ] **Step 1: Write the wrappers + types**

```ts
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export interface ScanResult { authors: number; works: number; chapters: number; }
export interface AuthorRow {
  id: number; name: string; workCount: number; chapterCount: number; unplayedCount: number;
}
export interface ChapterRow {
  id: number; title: string; chapterNo: number; format: string;
  durationSecs: number; filePath: string; played: boolean;
}
export interface WorkRow { id: number; baseTitle: string; chapters: ChapterRow[]; }
export interface AuthorDetail { id: number; name: string; works: WorkRow[]; }

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
export const setChapterPlayed = (chapterId: number, played: boolean) =>
  invoke("set_chapter_played", { chapterId, played });
export const setAuthorDisplayName = (authorId: number, name: string | null) =>
  invoke("set_author_display_name", { authorId, name });

export const captureWindow = (path: string) => invoke("capture_window", { path });
export const finishWalkthrough = (doneSignal: string | null, exitWhenDone: boolean) =>
  invoke("finish_walkthrough", { doneSignal, exitWhenDone });

export const fileUrl = (p: string) => convertFileSrc(p);
```

- [ ] **Step 2: Type-check**

Run:
```powershell
cd "C:\Agent Projects\AudioShelf"; npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat: typed Tauri invoke wrappers"
```

---

## Task 12: `src/lib/library.ts` — pure UI helpers (TDD)

**Files:**
- Create: `src/lib/library.ts`
- Create: `src/lib/library.test.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/library.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { matchesSearch, summarizeAuthor } from "./library";
import type { AuthorRow } from "./api";

const author: AuthorRow = {
  id: 1, name: "Jane Doe", workCount: 3, chapterCount: 7, unplayedCount: 2,
};

describe("matchesSearch", () => {
  it("is case-insensitive and matches substrings", () => {
    expect(matchesSearch(author, "jane")).toBe(true);
    expect(matchesSearch(author, "DOE")).toBe(true);
    expect(matchesSearch(author, "smith")).toBe(false);
  });
  it("matches everything on empty query", () => {
    expect(matchesSearch(author, "")).toBe(true);
  });
});

describe("summarizeAuthor", () => {
  it("summarizes works/chapters and unplayed", () => {
    expect(summarizeAuthor(author)).toBe("3 works · 7 chapters · 2 unplayed");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```powershell
npm test -- library
```
Expected: FAIL (module `./library` not found / functions undefined).

- [ ] **Step 3: Implement** (`src/lib/library.ts`)

```ts
import type { AuthorRow } from "./api";

export function matchesSearch(author: AuthorRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return author.name.toLowerCase().includes(q);
}

export function summarizeAuthor(a: AuthorRow): string {
  return `${a.workCount} works · ${a.chapterCount} chapters · ${a.unplayedCount} unplayed`;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run:
```powershell
npm test -- library
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: library search/summary helpers"
```

---

## Task 13: `src/harness/` — self-verification driver (TDD)

**Files:**
- Create: `src/harness/types.ts`
- Create: `src/harness/runner.ts`
- Create: `src/harness/runner.test.ts`
- Create: `src/harness/walkthroughs.ts`

- [ ] **Step 1: Write types** (`src/harness/types.ts`)

```ts
export interface Step {
  name: string;
  run: () => Promise<void>;
}
```

- [ ] **Step 2: Write the failing test** (`src/harness/runner.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { runSteps } from "./runner";
import type { Step } from "./types";

describe("runSteps", () => {
  it("runs every step in order and captures a numbered shot per step", async () => {
    const order: string[] = [];
    const steps: Step[] = [
      { name: "first", run: async () => { order.push("first"); } },
      { name: "second", run: async () => { order.push("second"); } },
    ];
    const shots: string[] = [];
    await runSteps(steps, "C:/shots", async (p) => { shots.push(p); });
    expect(order).toEqual(["first", "second"]);
    expect(shots).toEqual(["C:/shots/01-first.png", "C:/shots/02-second.png"]);
  });

  it("skips capture when shotsDir is null", async () => {
    const capture = vi.fn();
    await runSteps([{ name: "x", run: async () => {} }], null, capture);
    expect(capture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run:
```powershell
npm test -- runner
```
Expected: FAIL (`./runner` not found).

- [ ] **Step 4: Implement** (`src/harness/runner.ts`)

```ts
import type { Step } from "./types";

export async function runSteps(
  steps: Step[],
  shotsDir: string | null,
  capture: (path: string) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    await steps[i].run();
    if (shotsDir) {
      const n = String(i + 1).padStart(2, "0");
      await capture(`${shotsDir}/${n}-${steps[i].name}.png`);
    }
  }
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run:
```powershell
npm test -- runner
```
Expected: PASS (2 tests).

- [ ] **Step 6: Write the walkthrough registry** (`src/harness/walkthroughs.ts`)

```ts
import type { Step } from "./types";

/**
 * Build the "browse" walkthrough. The caller supplies navigation callbacks so
 * this stays free of React/DOM imports (and unit-testable). Each step leaves the
 * app on a distinct screen so the screenshot after it is meaningful.
 */
export function browseSteps(nav: {
  showScanResult: () => Promise<void>;
  showLibrary: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "scan-result", run: nav.showScanResult },
    { name: "library", run: nav.showLibrary },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}

export const walkthroughs = ["browse"] as const;
export type WalkthroughName = (typeof walkthroughs)[number];
```

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "feat: self-verification harness runner + walkthroughs"
```

---

## Task 14: `src/views/LibraryView.tsx` — author list + search (TDD)

**Files:**
- Create: `src/views/LibraryView.tsx`
- Create: `src/views/LibraryView.test.tsx`

For a 300+ author list we render a simple windowed list: only the slice of rows near the
scroll position. This task keeps it correct and testable without a virtualization library
(YAGNI) by rendering all matched rows but capping initial paint via a "show more" threshold
is unnecessary at this scale for correctness tests — we render matched rows directly and
rely on the browser. (If profiling later shows jank, add windowing in M2.)

- [ ] **Step 1: Write the failing test** (`src/views/LibraryView.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryView } from "./LibraryView";
import type { AuthorRow } from "../lib/api";

const authors: AuthorRow[] = [
  { id: 1, name: "Alice", workCount: 1, chapterCount: 2, unplayedCount: 1 },
  { id: 2, name: "Bob", workCount: 2, chapterCount: 4, unplayedCount: 0 },
];

describe("LibraryView", () => {
  it("lists authors and filters by search", async () => {
    render(<LibraryView authors={authors} onOpenAuthor={() => {}} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search authors"), "ali");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("invokes onOpenAuthor when a row is clicked", async () => {
    const onOpen = vi.fn();
    render(<LibraryView authors={authors} onOpenAuthor={onOpen} />);
    await userEvent.click(screen.getByText("Bob"));
    expect(onOpen).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```powershell
npm test -- LibraryView
```
Expected: FAIL (component not found).

- [ ] **Step 3: Implement** (`src/views/LibraryView.tsx`)

```tsx
import { useMemo, useState } from "react";
import type { AuthorRow } from "../lib/api";
import { matchesSearch, summarizeAuthor } from "../lib/library";

export function LibraryView(props: {
  authors: AuthorRow[];
  onOpenAuthor: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => props.authors.filter((a) => matchesSearch(a, query)),
    [props.authors, query],
  );
  return (
    <div className="library">
      <input
        placeholder="Search authors"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {shown.map((a) => (
          <li key={a.id}>
            <button onClick={() => props.onOpenAuthor(a.id)}>
              <span className="author-name">{a.name}</span>
              <span className="author-summary">{summarizeAuthor(a)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run:
```powershell
npm test -- LibraryView
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: author library list with search"
```

---

## Task 15: `src/views/AuthorDetailView.tsx` — works, chapters, played toggle (TDD)

**Files:**
- Create: `src/views/AuthorDetailView.tsx`
- Create: `src/views/AuthorDetailView.test.tsx`

- [ ] **Step 1: Write the failing test** (`src/views/AuthorDetailView.test.tsx`)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorDetailView } from "./AuthorDetailView";
import type { AuthorDetail } from "../lib/api";

const detail: AuthorDetail = {
  id: 1,
  name: "Jane Doe",
  works: [
    {
      id: 10,
      baseTitle: "Cool Story",
      chapters: [
        { id: 100, title: "Cool Story", chapterNo: 1, format: "mp3", durationSecs: 65, filePath: "x/Cool Story.mp3", played: false },
        { id: 101, title: "Cool Story 2 the sequel", chapterNo: 2, format: "mp3", durationSecs: 130, filePath: "x/Cool Story 2 the sequel.mp3", played: true },
      ],
    },
  ],
};

describe("AuthorDetailView", () => {
  it("renders works, chapters, and a played marker", () => {
    render(<AuthorDetailView detail={detail} onTogglePlayed={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Cool Story")).toBeInTheDocument();
    // Chapter 2 is played -> its row exposes a "played" state.
    const ch2 = screen.getByText("Cool Story 2 the sequel").closest("li")!;
    expect(ch2).toHaveAttribute("data-played", "true");
  });

  it("toggles played when the checkbox is clicked", async () => {
    const onToggle = vi.fn();
    render(<AuthorDetailView detail={detail} onTogglePlayed={onToggle} onBack={() => {}} />);
    const ch1Toggle = screen.getByLabelText("Mark 'Cool Story' played");
    await userEvent.click(ch1Toggle);
    expect(onToggle).toHaveBeenCalledWith(100, true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```powershell
npm test -- AuthorDetailView
```
Expected: FAIL (component not found).

- [ ] **Step 3: Implement** (`src/views/AuthorDetailView.tsx`)

```tsx
import type { AuthorDetail } from "../lib/api";

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AuthorDetailView(props: {
  detail: AuthorDetail;
  onTogglePlayed: (chapterId: number, played: boolean) => void;
  onBack: () => void;
}) {
  const { detail } = props;
  return (
    <div className="author-detail">
      <button onClick={props.onBack}>← Library</button>
      <h1>{detail.name}</h1>
      {detail.works.map((w) => (
        <section key={w.id} className="work">
          <h2>{w.baseTitle}</h2>
          <ul>
            {w.chapters.map((c) => (
              <li key={c.id} data-played={c.played ? "true" : "false"}>
                <label aria-label={`Mark '${c.title}' played`}>
                  <input
                    type="checkbox"
                    checked={c.played}
                    onChange={(e) => props.onTogglePlayed(c.id, e.target.checked)}
                  />
                </label>
                <span className="chapter-title">{c.title}</span>
                <span className="chapter-duration">{formatDuration(c.durationSecs)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run:
```powershell
npm test -- AuthorDetailView
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: author detail view with chapters and played toggle"
```

---

## Task 16: `src/views/ScanView.tsx` — scan trigger + result (TDD)

**Files:**
- Create: `src/views/ScanView.tsx`
- Create: `src/views/ScanView.test.tsx`

- [ ] **Step 1: Write the failing test** (`src/views/ScanView.test.tsx`)

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanView } from "./ScanView";

describe("ScanView", () => {
  it("shows result counts when a scan result is present", () => {
    render(<ScanView result={{ authors: 3, works: 8, chapters: 20 }} />);
    expect(screen.getByText(/3 authors/)).toBeInTheDocument();
    expect(screen.getByText(/8 works/)).toBeInTheDocument();
    expect(screen.getByText(/20 chapters/)).toBeInTheDocument();
  });

  it("shows a scanning message when result is null", () => {
    render(<ScanView result={null} />);
    expect(screen.getByText(/scanning/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```powershell
npm test -- ScanView
```
Expected: FAIL.

- [ ] **Step 3: Implement** (`src/views/ScanView.tsx`)

```tsx
import type { ScanResult } from "../lib/api";

export function ScanView(props: { result: ScanResult | null }) {
  if (!props.result) {
    return <div className="scan">Scanning library…</div>;
  }
  const { authors, works, chapters } = props.result;
  return (
    <div className="scan">
      <h1>Library scanned</h1>
      <p>{authors} authors · {works} works · {chapters} chapters</p>
    </div>
  );
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run:
```powershell
npm test -- ScanView
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: scan result view"
```

---

## Task 17: `src/App.tsx` — routing + harness bootstrap

**Files:**
- Modify: `src/App.tsx`

App states: `loading` → (`scan` → `library` ↔ `author`). On mount, read launch args; if a
library path is given, scan it; if `autostart`+`walkthrough` are set, run the walkthrough
steps capturing screenshots, then signal done. Otherwise land on the library.

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, captureWindow, finishWalkthrough,
  type AuthorRow, type AuthorDetail, type ScanResult,
} from "./lib/api";
import { LibraryView } from "./views/LibraryView";
import { AuthorDetailView } from "./views/AuthorDetailView";
import { ScanView } from "./views/ScanView";
import { runSteps } from "./harness/runner";
import { browseSteps } from "./harness/walkthroughs";

type Route =
  | { kind: "loading" }
  | { kind: "scan" }
  | { kind: "library" }
  | { kind: "author" };

export default function App() {
  const [route, setRoute] = useState<Route>({ kind: "loading" });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [detail, setDetail] = useState<AuthorDetail | null>(null);

  async function loadAuthors() {
    setAuthors(await getAuthors());
  }

  async function openAuthor(id: number) {
    setDetail(await getAuthorDetail(id));
    setRoute({ kind: "author" });
  }

  async function togglePlayed(chapterId: number, played: boolean) {
    await setChapterPlayed(chapterId, played);
    if (detail) setDetail(await getAuthorDetail(detail.id));
    await loadAuthors();
  }

  useEffect(() => {
    (async () => {
      const args = await getLaunchArgs();
      if (args.library) {
        setRoute({ kind: "scan" });
        const result = await scanLibrary(args.library);
        setScan(result);
        await loadAuthors();
      } else {
        await loadAuthors();
      }

      if (args.autostart && args.walkthrough) {
        const steps = browseSteps({
          showScanResult: async () => setRoute({ kind: "scan" }),
          showLibrary: async () => setRoute({ kind: "library" }),
          openFirstAuthor: async () => {
            const list = await getAuthors();
            if (list.length > 0) await openAuthor(list[0].id);
          },
        });
        await runSteps(steps, args.shots, (p) => captureWindow(p));
        await finishWalkthrough(args.doneSignal, args.exitWhenDone);
      } else {
        setRoute({ kind: "library" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (route.kind === "loading") return <div>Loading…</div>;
  if (route.kind === "scan") return <ScanView result={scan} />;
  if (route.kind === "author" && detail) {
    return (
      <AuthorDetailView
        detail={detail}
        onTogglePlayed={togglePlayed}
        onBack={() => setRoute({ kind: "library" })}
      />
    );
  }
  return <LibraryView authors={authors} onOpenAuthor={openAuthor} />;
}
```

- [ ] **Step 2: Type-check + run the full JS test suite**

Run:
```powershell
npx tsc --noEmit; npm test
```
Expected: tsc clean; all Vitest tests PASS.

- [ ] **Step 3: Commit**

```powershell
git add -A; git commit -m "feat: app routing and harness bootstrap"
```

---

## Task 18: `tools/gen-fixture` — synthetic WAV library

**Files:**
- Create: `tools/gen-fixture/Cargo.toml`
- Create: `tools/gen-fixture/src/main.rs`
- Create: `tools/gen-fixture/src/lib.rs`
- Modify: `src-tauri/Cargo.toml` (uncomment the `gen-fixture` dev-dependency from Task 1)

The fixture mimics the real layout: `Author/` folders with loose files whose names follow
the base-title + number convention, including a multi-chapter work and a standalone work,
plus a "trap" lone-numbered file (`Area 51.wav`). We generate valid WAV (pure Rust via
`hound`), so files are real, playable in WebView2, and probe-able by `lofty`. Multi-format
extension handling is covered by `scan.rs` unit tests; the fixture intentionally uses WAV
only to stay fully synthesizable and deterministic.

- [ ] **Step 1: Create `tools/gen-fixture/Cargo.toml`**

```toml
[package]
name = "gen-fixture"
version = "0.1.0"
edition = "2021"

[lib]
name = "gen_fixture"
path = "src/lib.rs"

[[bin]]
name = "gen-fixture"
path = "src/main.rs"

[dependencies]
hound = "3"
```

- [ ] **Step 2: Create `tools/gen-fixture/src/lib.rs`**

```rust
//! Generate a deterministic synthetic audio library for tests and the harness.
//! Layout mirrors the real collection: Author folders containing loose WAV files
//! named with the base-title + number convention.

use std::path::Path;

/// Write `secs` seconds of silence as a mono 8 kHz 16-bit WAV.
fn write_silence(path: &Path, secs: u32) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 8000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    for _ in 0..(8000 * secs) {
        writer
            .write_sample(0i16)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    }
    writer
        .finalize()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}

pub fn generate(root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;

    // Author with a multi-chapter work and a standalone work.
    let jane = root.join("Jane Doe");
    write_silence(&jane.join("Cool Story.wav"), 2)?;
    write_silence(&jane.join("Cool Story 2 the sequel.wav"), 3)?;
    write_silence(&jane.join("Cool Story 3 finale.wav"), 4)?;
    write_silence(&jane.join("Another Standalone Tale.wav"), 5)?;

    // Author with a single multi-chapter work.
    let sam = root.join("Sam Smith");
    write_silence(&sam.join("Night Walk.wav"), 6)?;
    write_silence(&sam.join("Night Walk 2.wav"), 7)?;

    // Trap: a lone numbered file that must NOT split into "Area" / chapter 51.
    let trap = root.join("Trap Author");
    write_silence(&trap.join("Area 51.wav"), 2)?;

    Ok(())
}
```

- [ ] **Step 3: Create `tools/gen-fixture/src/main.rs`**

```rust
use std::path::PathBuf;

fn main() {
    let out = std::env::args().nth(1).expect("usage: gen-fixture <output-dir>");
    gen_fixture::generate(&PathBuf::from(out)).expect("generate fixture");
}
```

- [ ] **Step 4: Add an integration test that scans the fixture**

Create `src-tauri/tests/fixture_scan.rs`:
```rust
use audioshelf_lib::testing::{open_in_memory, query_authors, scan_into};

#[test]
fn scanning_the_generated_fixture_produces_expected_counts() {
    let tmp = tempfile::tempdir().unwrap();
    gen_fixture::generate(tmp.path()).unwrap();

    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, tmp.path()).unwrap();
    assert_eq!(report.authors, 3);
    // Jane: "Cool Story" (3 ch) + "Another Standalone Tale" (1). Sam: "Night Walk" (2).
    // Trap: "Area 51" demoted to a standalone work (1).
    assert_eq!(report.works, 4);
    assert_eq!(report.chapters, 7);

    let authors = query_authors(&conn).unwrap();
    assert_eq!(authors.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(),
               vec!["Jane Doe", "Sam Smith", "Trap Author"]);
}
```

In `src-tauri/Cargo.toml`, uncomment the dev-dependency:
```toml
gen-fixture = { path = "../tools/gen-fixture" }
```

- [ ] **Step 5: Run the integration test**

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml --test fixture_scan"
```
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: synthetic WAV library fixture + scan integration test"
```

---

## Task 19: `tools/verify.ps1` — end-to-end self-verification

**Files:**
- Create: `tools/verify.ps1`

- [ ] **Step 1: Port `verify.ps1`.** Copy `C:\Agent Projects\MangaReader\tools\verify.ps1` and apply exactly these edits:
  - Default walkthrough: change `[string]$Walkthrough = "hello"` → `[string]$Walkthrough = "browse"`.
  - Exe name: change `mangareader.exe` → `audioshelf.exe`.
  - The launch arg line keeps `--library "$fixture" --autostart --walkthrough $Walkthrough --shots "$shots" --done-signal "$done" --exit-when-done` unchanged.
  - The fixture-generation line keeps `--manifest-path "$root\tools\gen-fixture\Cargo.toml" -- "$fixture"` unchanged.

  Resulting script (full):

```powershell
param(
  [string]$Walkthrough = "browse",
  [int]$TimeoutSec = 240,
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$root    = Split-Path -Parent $PSScriptRoot
$devenv  = Join-Path $PSScriptRoot "dev-env.cmd"
$fixture = Join-Path $root ".fixture"
$shots   = Join-Path $root ".shots\$Walkthrough"
$done    = Join-Path $root ".shots\$Walkthrough.done"

Remove-Item $shots -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $done -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $shots | Out-Null

cmd /c "`"$devenv`" cargo run --quiet --manifest-path `"$root\tools\gen-fixture\Cargo.toml`" -- `"$fixture`""
if ($LASTEXITCODE -ne 0) { Write-Host "FIXTURE GENERATION FAILED"; exit 1 }

if (-not $SkipBuild) {
  cmd /c "`"$devenv`" cargo tauri build --debug --no-bundle"
  if ($LASTEXITCODE -ne 0) { Write-Host "APP BUILD FAILED"; exit 1 }
}
$exe = Get-ChildItem "$root\src-tauri\target\debug\audioshelf.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { Write-Host "APP EXE NOT FOUND"; exit 1 }

$argLine = "--library `"$fixture`" --autostart --walkthrough $Walkthrough " +
           "--shots `"$shots`" --done-signal `"$done`" --exit-when-done"
$proc = Start-Process -FilePath $exe.FullName -ArgumentList $argLine -PassThru

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (-not (Test-Path $done) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
if (-not $proc.HasExited) { try { $proc.Kill() } catch {} }

if (Test-Path $done) {
  Write-Host "WALKTHROUGH OK. Shots:"
  Get-ChildItem $shots | ForEach-Object { Write-Host "  $($_.FullName)" }
  exit 0
} else {
  Write-Host "WALKTHROUGH TIMED OUT (no done-signal)"; exit 1
}
```

- [ ] **Step 2: Add `cargo-tauri` if missing.** Ensure the Tauri CLI is available to `cargo tauri`:

Run:
```powershell
cmd /c "tools\dev-env.cmd cargo tauri --version"
```
Expected: prints a version. If it errors with "no such command", install it:
```powershell
cmd /c "tools\dev-env.cmd cargo install tauri-cli --version ^2 --locked"
```

- [ ] **Step 3: Run the full self-verification**

Run:
```powershell
cd "C:\Agent Projects\AudioShelf"; powershell -ExecutionPolicy Bypass -File tools\verify.ps1
```
Expected: `WALKTHROUGH OK.` and three screenshots listed: `01-scan-result.png`, `02-library.png`, `03-author-detail.png` under `.shots\browse\`.

- [ ] **Step 4: Inspect the screenshots.** Open each PNG and confirm: the scan-result screen shows `3 authors · 4 works · 7 chapters`; the library lists `Jane Doe`, `Sam Smith`, `Trap Author`; the author-detail screen for Jane Doe shows the "Cool Story" work with three chapters and "Another Standalone Tale". Fix any UI defects discovered, then re-run Step 3.

- [ ] **Step 5: Add `.gitignore` entries and commit**

Append to `.gitignore`:
```
.fixture/
.shots/
src-tauri/target/
```

```powershell
git add -A; git commit -m "feat: end-to-end self-verification (verify.ps1) for the browse walkthrough"
```

---

## Task 20: README + docs

**Files:**
- Create: `README.md`
- Create: `tools/README.md`

- [ ] **Step 1: Write `README.md`** describing AudioShelf, the M1 feature set (scan a single root of `Author/` folders, browse Author→works→chapters with played markers), the stack, and how to run (`npm install`, `cargo tauri dev`, `tools\verify.ps1`).

- [ ] **Step 2: Write `tools/README.md`** documenting the harness flags (`--library/--autostart/--walkthrough/--shots/--done-signal/--exit-when-done`), `gen-fixture`, and `verify.ps1`, mirroring MangaReader's `tools/README.md`.

- [ ] **Step 3: Commit and push**

```powershell
git add -A; git commit -m "docs: README and tools documentation"; git push
```

---

## Self-Review (against the spec)

**Spec coverage (Milestone 1 portion):**
- Read-only on files → scan only reads; no write/rename anywhere in M1. ✓ (Rename tool is M4.)
- App-owned SQLite metadata → `db.rs` schema (authors/works/chapters/author_tags/play_events/grouping_overrides/settings). ✓
- Single root, Author subfolders → `scan::scan_into`. ✓
- Filename grouping (base + first int ≥2; demote lone numbered) → `grouping.rs` with tests including the "Area 51" trap. ✓
- Large library / natural ordering → `natsort.rs`; author/work sorting. (Windowing deferred with an explicit note in Task 14 — flagged, not silently dropped.) ✓
- Played/unplayed only; manual toggle → `chapters.played`, `set_chapter_played`, AuthorDetailView toggle, unplayed counts. ✓ (Auto-mark-on-finish is M2 with the player.)
- Duration display → `probe_duration_secs` via lofty; ChapterRow.durationSecs; formatted in the view. ✓
- Self-verification harness → launch args, capture, walkthroughs, gen-fixture, verify.ps1, screenshot inspection. ✓
- Tags / discovery / player / rename → explicitly deferred to M2–M4 (Appendix). ✓

**Deferred to later milestones (not gaps):** auto-mark played on finish, all playback controls (M2); author tagging + discovery panel (M3); rename tool (M4). These are spec requirements scheduled into named milestones, not omissions.

**Placeholder scan:** none — every code step contains complete code; ports name the exact source file and the exact edits.

**Type consistency:** `ScanResult/AuthorRow/ChapterRow/WorkRow/AuthorDetail` field names match between `model.rs` (snake_case → camelCase via serde) and `api.ts` (camelCase). Command names match between `commands.rs`, the `invoke_handler` in `lib.rs`, and `api.ts` (`scan_library`, `get_authors`, `get_author_detail`, `set_chapter_played`, `set_author_display_name`, `get_launch_args`, `capture_window`, `finish_walkthrough`). Harness `runSteps` signature matches its test and its App.tsx call site.

---

## Appendix — Milestone Roadmap (M2–M4)

Each milestone gets its own plan via the writing-plans skill before implementation.

- **M2 — Playback & Progress.** `PlayerView` driving a WebView `<audio>` element: play/pause, scrub bar (current/total), skip ±15s/±30s, volume, sleep timer (auto-stop after N min). Auto-mark a chapter played when it reaches the end (writing `chapters.played` and a `play_events` row); stop after each chapter (no auto-advance). New commands: `record_play_event`. New harness walkthrough: `player`.
- **M3 — Tags & Discovery.** Author tag editor (autocomplete from existing tags) writing `author_tags`. Discovery panel: "For you" (authors sharing tags with recently-played authors via `play_events`), "Pick a tag" multi-select re-ranking to similar-tagged, mostly-unplayed works, and "More from this author". New commands: `get_tags`, `set_author_tags`, `get_discovery`, `get_discovery_by_tags`, `get_more_from_author`. New walkthrough: `discovery`.
- **M4 — Opt-in Rename Tool.** A dedicated screen, off by default. Preview diff of current → proposed clean filenames; explicit confirm; defensive rename (verify target absent, fail safe) with an undo manifest enabling rollback. Also a grouping-override UI writing `grouping_overrides` (merge/split/relabel works) consumed by `scan.rs`. New commands: `preview_rename`, `apply_rename`, `undo_rename`, `set_grouping_override`. New walkthrough: `rename`.
