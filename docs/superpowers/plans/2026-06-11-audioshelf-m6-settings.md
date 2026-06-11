# AudioShelf M6 — Settings & Library-Root Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AudioShelf standalone-usable by adding an in-app folder picker that persists the library root in the `settings` table, so the app boots, scans, and browses without the `--library` CLI flag — plus a Settings screen to change the root and re-scan.

**Architecture:** Add a generic key/value `get_setting`/`set_setting` command pair over the existing `settings` table (Rust). Add the `tauri-plugin-dialog` plugin for a native folder picker, gated by a new capability file. The front-end gains a full-page `SettingsView` route (mirroring `RenameView`), and `App.tsx`'s bootstrap gains a precedence chain: `--library` flag → persisted `library_root` → first-run onboarding. Views stay prop-driven (no `invoke` in views); `App` owns the dialog + persist + scan orchestration. Scanning failures (e.g. a persisted root that was moved/deleted) fail safe to the Settings screen with an error rather than crashing — consistent with the standing defensive-ops preference.

**Tech Stack:** Tauri 2, React 18, TypeScript, SQLite (rusqlite 0.32), `@tauri-apps/plugin-dialog`, Vitest, inline `#[cfg(test)]` Rust tests.

**Conventions (from [ROADMAP.md](../../../ROADMAP.md)):**
- Cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the FOREGROUND (large timeout). `npm run build` before any `cargo tauri build`.
- Gates: `npx tsc --noEmit` · `npm test` · `cmd /c "tools\dev-env.cmd cargo test"` · `tools\verify.ps1 -Walkthrough <name>`.
- Commits: human author `Yovan <yovanfly@gmail.com>` + trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **No Codex trailer.**
- App ships **no stylesheet** in v1 (intentionally unstyled) — do not add CSS.
- Views never call `invoke` directly; they receive callback props (keeps them unit-testable without mocking Tauri). All IPC lives in `src/lib/api.ts`.
- Tauri serializes Rust `snake_case` ↔ JS `camelCase` automatically; command arg objects use camelCase keys.

---

## File Structure

**Rust (`src-tauri/`):**
- Modify `src/commands.rs` — add `get_setting`/`set_setting` commands + `get_setting_value`/`set_setting_value` helpers + a round-trip test.
- Modify `src/lib.rs` — register the two new commands and `.plugin(tauri_plugin_dialog::init())`.
- Modify `Cargo.toml` — add `tauri-plugin-dialog = "2"`.
- Create `capabilities/default.json` — grant `core:default` + `dialog:default` to the `main` window.

**Front-end (`src/`):**
- Modify `lib/api.ts` — add `getSetting`, `setSetting`, `pickFolder` wrappers.
- Create `views/SettingsView.tsx` — full-page route: shows current root, choose-folder, re-scan, first-run onboarding, scan error.
- Create `views/SettingsView.test.tsx` — co-located Vitest tests.
- Modify `views/LibraryView.tsx` — add a "Settings" button (`onOpenSettings` prop).
- Modify `views/LibraryView.test.tsx` — assert the new button (if the file exists; otherwise the new test in SettingsView covers it).
- Modify `App.tsx` — add `{ kind: "settings" }` route, `libraryRoot` + `scanError` state, bootstrap precedence chain with defensive scan error handling, and `chooseFolder`/`rescan` handlers.
- Modify `harness/walkthroughs.ts` — add `settingsSteps` + register `"settings"` in the `walkthroughs` array.
- Modify `App.tsx` walkthrough switch — wire the `settings` walkthrough.

**Config:**
- Modify `package.json` — add `@tauri-apps/plugin-dialog` dependency.

---

## Task 1: Rust settings get/set commands

**Files:**
- Modify: `src-tauri/src/commands.rs` (add imports near line 9, commands after `scan_library` ~line 30, helpers + test)
- Modify: `src-tauri/src/lib.rs:31-51` (register commands)

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/commands.rs` (append as a new `#[test]` fn alongside the existing tests):

```rust
    #[test]
    fn settings_round_trip() {
        let conn = crate::db::open_in_memory().unwrap();
        // Missing key reads as None.
        assert_eq!(get_setting_value(&conn, "library_root").unwrap(), None);
        // First write inserts.
        set_setting_value(&conn, "library_root", "C:/Audio").unwrap();
        assert_eq!(
            get_setting_value(&conn, "library_root").unwrap(),
            Some("C:/Audio".to_string())
        );
        // Second write upserts (overwrites, not duplicates).
        set_setting_value(&conn, "library_root", "D:/Other").unwrap();
        assert_eq!(
            get_setting_value(&conn, "library_root").unwrap(),
            Some("D:/Other".to_string())
        );
        // The pre-seeded schema_version key is untouched.
        assert_eq!(
            get_setting_value(&conn, "schema_version").unwrap(),
            Some("1".to_string())
        );
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri/Cargo.toml settings_round_trip"`
Expected: FAIL — compile error, `get_setting_value`/`set_setting_value` not found.

- [ ] **Step 3: Write minimal implementation**

In `src-tauri/src/commands.rs`, add `OptionalExtension` to the rusqlite import. Change line 9 from:

```rust
use rusqlite::params;
```

to:

```rust
use rusqlite::{params, OptionalExtension};
```

Then add the two commands immediately after `scan_library` (after line 30, before `get_authors`):

```rust
#[tauri::command]
pub fn get_setting(state: tauri::State<DbState>, key: String) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_setting_value(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: tauri::State<DbState>, key: String, value: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_setting_value(&conn, &key, &value).map_err(|e| e.to_string())
}

/// Read a settings value by key, or `None` if the key is absent.
pub(crate) fn get_setting_value(conn: &rusqlite::Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
}

/// Insert-or-update a settings value (upsert on the `key` primary key).
pub(crate) fn set_setting_value(conn: &rusqlite::Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}
```

- [ ] **Step 4: Register the commands in `lib.rs`**

In `src-tauri/src/lib.rs`, edit the `generate_handler!` list. Change line 35 region — replace:

```rust
            commands::scan_library,
            commands::get_authors,
```

with:

```rust
            commands::scan_library,
            commands::get_setting,
            commands::set_setting,
            commands::get_authors,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri/Cargo.toml settings_round_trip"`
Expected: PASS (`test commands::tests::settings_round_trip ... ok`).

- [ ] **Step 6: Run the full Rust suite to confirm no regressions**

Run: `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri/Cargo.toml"`
Expected: all existing tests + `settings_round_trip` PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(m6): add get_setting/set_setting commands over settings table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add the dialog plugin + capability

This task wires `tauri-plugin-dialog` for the native folder picker. Application commands don't need capabilities, but **plugin** commands (like `dialog:open`) do — so a capability file is required here.

**Files:**
- Modify: `src-tauri/Cargo.toml` (`[dependencies]`)
- Modify: `src-tauri/src/lib.rs:24` (register plugin)
- Create: `src-tauri/capabilities/default.json`
- Modify: `package.json` (`dependencies`)

- [ ] **Step 1: Add the Rust dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add after the `tauri = { ... }` line:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register the plugin in the builder**

In `src-tauri/src/lib.rs`, change:

```rust
    tauri::Builder::default()
        .manage(args)
```

to:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(args)
```

- [ ] **Step 3: Create the capability file**

Create `src-tauri/capabilities/default.json` with exactly:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Core defaults plus the folder-picker dialog for the main window.",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:default"]
}
```

Note: the `$schema` path is only for editor autocomplete and may not exist until the first build generates it — its absence does not cause a build error. The window label `main` is Tauri's default label for the single window defined in `tauri.conf.json`. Tauri 2 auto-loads every file in `src-tauri/capabilities/`, so no `tauri.conf.json` change is needed. Custom app commands (`scan_library`, etc.) remain permitted regardless of capabilities — this file only *adds* the gated `dialog` and core-plugin permissions.

- [ ] **Step 4: Add the JS dependency**

In `package.json`, add to `dependencies` (alongside `@tauri-apps/api`):

```json
"@tauri-apps/plugin-dialog": "^2",
```

Then install:

Run: `npm install`
Expected: adds `@tauri-apps/plugin-dialog` to `node_modules` and updates `package-lock.json`.

- [ ] **Step 5: Verify the Rust side compiles with the new plugin**

Run: `cmd /c "tools\dev-env.cmd cargo build --manifest-path src-tauri/Cargo.toml"`
Expected: builds successfully (downloads `tauri-plugin-dialog` on first run; FOREGROUND, allow a large timeout).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat(m6): add tauri-plugin-dialog + capability for folder picker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Front-end IPC wrappers (api.ts)

**Files:**
- Modify: `src/lib/api.ts` (add a dialog import + three wrappers)

- [ ] **Step 1: Add the dialog import**

At the top of `src/lib/api.ts`, below the existing `import { invoke, convertFileSrc } from "@tauri-apps/api/core";` line, add:

```typescript
import { open } from "@tauri-apps/plugin-dialog";
```

- [ ] **Step 2: Add the wrappers**

Append these exports to the bottom of `src/lib/api.ts` (after `fileUrl`):

```typescript
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
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors. (If `@tauri-apps/plugin-dialog` types are missing, re-run `npm install` from Task 2 Step 4.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(m6): add getSetting/setSetting/pickFolder IPC wrappers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: SettingsView component (prop-driven, with tests)

A full-page route mirroring `RenameView`. It is purely prop-driven — `App` owns the dialog + scan; this view just renders state and fires callbacks. This keeps it unit-testable without mocking Tauri.

**Files:**
- Create: `src/views/SettingsView.tsx`
- Create: `src/views/SettingsView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/views/SettingsView.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("shows the current root and last scan counts when a library is set", () => {
    render(
      <SettingsView
        root="C:/Audio/Library"
        lastScan={{ authors: 3, works: 7, chapters: 21 }}
        scanError={null}
        busy={false}
        firstRun={false}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText("C:/Audio/Library")).toBeInTheDocument();
    expect(screen.getByText(/3 authors/)).toBeInTheDocument();
    expect(screen.getByText(/21 chapters/)).toBeInTheDocument();
  });

  it("fires onChooseFolder when the choose button is clicked", async () => {
    const onChooseFolder = vi.fn();
    render(
      <SettingsView
        root="C:/Audio/Library"
        lastScan={null}
        scanError={null}
        busy={false}
        firstRun={false}
        onChooseFolder={onChooseFolder}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /choose .*folder/i }));
    expect(onChooseFolder).toHaveBeenCalledOnce();
  });

  it("shows onboarding copy and hides re-scan/back on first run", () => {
    render(
      <SettingsView
        root={null}
        lastScan={null}
        scanError={null}
        busy={false}
        firstRun={true}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/welcome to audioshelf/i)).toBeInTheDocument();
    // No library chosen yet → cannot re-scan, and no back target.
    expect(screen.queryByRole("button", { name: /re-scan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /back to library/i })).toBeNull();
  });

  it("disables actions and shows a busy label while scanning", () => {
    render(
      <SettingsView
        root="C:/Audio/Library"
        lastScan={null}
        scanError={null}
        busy={true}
        firstRun={false}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/scanning…/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose .*folder/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /re-scan/i })).toBeDisabled();
  });

  it("surfaces a scan error", () => {
    render(
      <SettingsView
        root="C:/Audio/Gone"
        lastScan={null}
        scanError="The system cannot find the path specified."
        busy={false}
        firstRun={false}
        onChooseFolder={vi.fn()}
        onRescan={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/cannot find the path/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SettingsView`
Expected: FAIL — cannot resolve `./SettingsView` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/views/SettingsView.tsx`:

```tsx
import type { ScanResult } from "../lib/api";

export function SettingsView(props: {
  root: string | null;
  lastScan: ScanResult | null;
  scanError: string | null;
  busy: boolean;
  firstRun: boolean;
  onChooseFolder: () => void;
  onRescan: () => void;
  onBack: () => void;
}) {
  const { root, lastScan, scanError, busy, firstRun } = props;
  return (
    <div className="settings">
      {!firstRun && (
        <button onClick={props.onBack} disabled={busy}>
          Back to library
        </button>
      )}
      <h1>Settings</h1>

      {firstRun && (
        <p>
          Welcome to AudioShelf. Choose the folder that holds your audio library
          (one subfolder per author) to get started.
        </p>
      )}

      <section className="settings-root">
        <h2>Library folder</h2>
        {root ? <p className="current-root">{root}</p> : <p>No library folder chosen yet.</p>}

        <button onClick={props.onChooseFolder} disabled={busy}>
          {root ? "Choose a different folder…" : "Choose library folder…"}
        </button>
        {root && (
          <button onClick={props.onRescan} disabled={busy}>
            Re-scan this folder
          </button>
        )}
      </section>

      {busy && <p className="settings-busy">Scanning…</p>}

      {scanError && (
        <p className="settings-error" role="alert">
          Couldn’t scan that folder: {scanError}
        </p>
      )}

      {lastScan && !busy && !scanError && (
        <p className="settings-scan-summary">
          Indexed {lastScan.authors} authors, {lastScan.works} works,{" "}
          {lastScan.chapters} chapters.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- SettingsView`
Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/views/SettingsView.tsx src/views/SettingsView.test.tsx
git commit -m "feat(m6): add prop-driven SettingsView with tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: LibraryView "Settings" button

**Files:**
- Modify: `src/views/LibraryView.tsx:5-19`
- Modify: `src/views/LibraryView.test.tsx` (only if it exists)

- [ ] **Step 1: Check whether a LibraryView test exists**

Run: `npx vitest run src/views/LibraryView.test.tsx --reporter=dot` (or check the path).
- If the file exists, do Step 2 (add an assertion).
- If it does not exist, skip Step 2 — the button is exercised in `App` integration via the harness, and adding a brand-new test file is out of scope for this task.

- [ ] **Step 2: (If the test file exists) add a failing assertion**

Add this `it` block inside the existing `describe` in `src/views/LibraryView.test.tsx`:

```tsx
  it("fires onOpenSettings when the Settings button is clicked", async () => {
    const onOpenSettings = vi.fn();
    render(
      <LibraryView
        authors={[]}
        onOpenAuthor={vi.fn()}
        onOpenDiscovery={vi.fn()}
        onOpenRename={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
```

Ensure the file imports `vi` and `userEvent` (match the existing imports at the top of the file; if any are missing, add `import { vi } from "vitest";` and `import userEvent from "@testing-library/user-event";`). Then run `npm test -- LibraryView` and expect the new test to FAIL with a missing `onOpenSettings` prop / no "Settings" button.

- [ ] **Step 3: Add the prop and button**

In `src/views/LibraryView.tsx`, change the props type (lines 5-10) to add `onOpenSettings`:

```tsx
export function LibraryView(props: {
  authors: AuthorRow[];
  onOpenAuthor: (id: number) => void;
  onOpenDiscovery: () => void;
  onOpenRename: () => void;
  onOpenSettings: () => void;
}) {
```

Then add the button next to the existing two (after line 19, the "Rename tool" button):

```tsx
      <button onClick={props.onOpenDiscovery}>Discover</button>
      <button onClick={props.onOpenRename}>Rename tool</button>
      <button onClick={props.onOpenSettings}>Settings</button>
```

- [ ] **Step 4: Verify**

Run: `npm test -- LibraryView` (if a test file exists) and `npx tsc --noEmit`.
Expected: LibraryView tests PASS; `tsc` will still report an error at `App.tsx`'s `<LibraryView ... />` call site (missing `onOpenSettings`) — that is fixed in Task 6. This is the only expected `tsc` error after this task.

- [ ] **Step 5: Commit**

```bash
git add src/views/LibraryView.tsx src/views/LibraryView.test.tsx
git commit -m "feat(m6): add Settings button to LibraryView

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: App.tsx wiring (route, state, bootstrap precedence, handlers)

This is the integration task. It adds the `settings` route, `libraryRoot`/`scanError` state, a defensive bootstrap precedence chain, and the choose-folder/re-scan handlers. After this task `tsc` and all tests must be clean.

**Files:**
- Modify: `src/App.tsx` (imports, Route union, state, bootstrap effect, handlers, routedView)

- [ ] **Step 1: Update imports**

In `src/App.tsx`, update the `./lib/api` import block (lines 2-10) to also import the new wrappers. Add `getSetting, setSetting, pickFolder,` to the import list:

```tsx
import {
  getLaunchArgs, scanLibrary, getAuthors, getAuthorDetail,
  setChapterPlayed, markChapterFinished, captureWindow, finishWalkthrough, fileUrl,
  getAllTags, setAuthorTags, getDiscovery, getDiscoveryByTags,
  previewRenames, applyRenames, undoRenames,
  setGroupingOverride, clearGroupingOverride,
  getSetting, setSetting, pickFolder,
  type AuthorRow, type AuthorDetail, type ChapterRow, type ScanResult, type DiscoveryWork,
  type RenameItem, type RenameResult,
} from "./lib/api";
```

Add the `SettingsView` component import below the `RenameView` import (line 14):

```tsx
import { SettingsView } from "./views/SettingsView";
```

Add `settingsSteps` to the harness walkthroughs import (line 19) — change it to:

```tsx
import { browseSteps, playerSteps, discoverySteps, renameSteps, groupingSteps, settingsSteps } from "./harness/walkthroughs";
```

- [ ] **Step 2: Extend the Route union**

Change the `Route` type (lines 28-34) to add a `settings` variant carrying a `firstRun` flag:

```tsx
type Route =
  | { kind: "loading" }
  | { kind: "scan" }
  | { kind: "library" }
  | { kind: "author" }
  | { kind: "discovery" }
  | { kind: "rename" }
  | { kind: "settings"; firstRun: boolean };
```

- [ ] **Step 3: Add state**

After the `pickedTags` state line (line 44), add:

```tsx
  const [libraryRoot, setLibraryRoot] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
```

- [ ] **Step 4: Add the settings handlers**

Add these functions alongside the other handlers (e.g. after `openDiscovery`/`pickTags`, near line 111). `scanRoot` is the shared, defensive scan-and-persist routine used by both first-run pick, change-folder, and re-scan:

```tsx
  // Persist the chosen root, scan it, and refresh the author list. Fails safe:
  // a bad/missing path leaves the user on Settings with an error, never crashes.
  async function scanRoot(root: string, persist: boolean) {
    setBusy(true);
    setScanError(null);
    try {
      const result = await scanLibrary(root);
      if (persist) await setSetting("library_root", root);
      setLibraryRoot(root);
      setScan(result);
      await loadAuthors();
      await refreshTags();
      return true;
    } catch (e) {
      setScanError(String(e));
      setLibraryRoot(root);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openSettings() {
    setScanError(null);
    setRoute({ kind: "settings", firstRun: false });
  }

  async function chooseFolder() {
    const picked = await pickFolder();
    if (!picked) return; // user cancelled
    const ok = await scanRoot(picked, true);
    if (ok) setRoute({ kind: "library" });
  }

  async function rescan() {
    if (!libraryRoot) return;
    await scanRoot(libraryRoot, true);
  }
```

- [ ] **Step 5: Rewrite the bootstrap precedence chain**

Replace the bootstrap block (current lines 191-202, from `const args = await getLaunchArgs();` through the `await refreshTags();` that precedes the `if (args.autostart ...)` check) with the precedence chain below. **Important:** keep the `if (args.autostart && args.walkthrough) { ... } else { ... }` block that follows it exactly as-is (it is rewired in Task 7, not here). Replace only the top portion:

```tsx
      const args = await getLaunchArgs();
      // Precedence: --library flag (harness/dev) → persisted root → first-run onboarding.
      if (args.library) {
        setRoute({ kind: "scan" });
        await scanRoot(args.library, false); // flag is ephemeral; don't persist it
      } else {
        const saved = await getSetting("library_root");
        if (saved) {
          setRoute({ kind: "scan" });
          const ok = await scanRoot(saved, false); // already persisted
          if (!ok) {
            // Saved root is gone/unreadable — fail safe to Settings with the error shown.
            setRoute({ kind: "settings", firstRun: false });
            return;
          }
        } else {
          await refreshTags();
          // No flag and nothing persisted → onboarding.
          setRoute({ kind: "settings", firstRun: true });
          return;
        }
      }
```

Notes:
- `scanRoot` already calls `loadAuthors()` and `refreshTags()` internally on success, so the old standalone `loadAuthors()`/`refreshTags()` calls are removed from this block.
- The two `return;` statements end the bootstrap early for the onboarding and failed-saved-root cases, so the harness/`else` block below them does not run (those paths are interactive, not headless).
- For the `args.library` path we deliberately fall through to the existing `if (args.autostart && args.walkthrough)` block so all current walkthroughs keep working unchanged.

- [ ] **Step 6: Add the settings route to `routedView()` and pass `onOpenSettings` to LibraryView**

In `routedView()` (lines 287-330), add a settings branch before the final `return <LibraryView ... />`:

```tsx
    if (route.kind === "settings") {
      return (
        <SettingsView
          root={libraryRoot}
          lastScan={scan}
          scanError={scanError}
          busy={busy}
          firstRun={route.firstRun}
          onChooseFolder={chooseFolder}
          onRescan={rescan}
          onBack={() => setRoute({ kind: "library" })}
        />
      );
    }
    return <LibraryView authors={authors} onOpenAuthor={openAuthor} onOpenDiscovery={openDiscovery} onOpenRename={openRename} onOpenSettings={openSettings} />;
```

- [ ] **Step 7: Verify types and the full front-end suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests PASS (SettingsView + LibraryView + existing).

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(m6): wire settings route, persisted-root bootstrap, change/re-scan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Settings walkthrough (harness self-verification)

Adds a headless walkthrough that captures the Settings screen so the UI can be screenshot-verified. The native folder picker is an OS dialog (not drivable headlessly), so the walkthrough navigates to Settings with the fixture's root already loaded and screenshots it — it does not invoke the picker.

**Files:**
- Modify: `src/harness/walkthroughs.ts` (add `settingsSteps`, register name)
- Modify: `src/App.tsx` (wire the `settings` walkthrough in the switch)

- [ ] **Step 1: Add `settingsSteps` and register the name**

In `src/harness/walkthroughs.ts`, change the `walkthroughs` array (line 34) to include `"settings"`:

```tsx
export const walkthroughs = ["browse", "player", "discovery", "rename", "grouping", "settings"] as const;
```

Then append this factory to the end of the file:

```tsx
/**
 * Build the "settings" walkthrough: open the Settings screen (with the fixture
 * library root already loaded) so the current-root + scan-summary state is
 * captured. The OS folder picker is not driven headlessly.
 */
export function settingsSteps(nav: {
  openSettings: () => Promise<void>;
}): Step[] {
  return [{ name: "settings", run: nav.openSettings }];
}
```

- [ ] **Step 2: Wire the walkthrough in `App.tsx`**

In the bootstrap effect's walkthrough switch (the `const steps = args.walkthrough === "player" ? ... : browseSteps({...})` chain, ~lines 209-277), add a `settings` branch. Insert it immediately before the final `: browseSteps({` fallback:

```tsx
            : args.walkthrough === "settings"
            ? settingsSteps({
                openSettings: async () => setRoute({ kind: "settings", firstRun: false }),
              })
            : browseSteps({
```

(The `settings` route renders `libraryRoot`, which `scanRoot` set during the `--library` bootstrap path, plus `scan` for the summary — so the screenshot shows the populated Settings screen.)

- [ ] **Step 3: Verify types + front-end tests**

Run: `npx tsc --noEmit && npm test`
Expected: all PASS.

- [ ] **Step 4: Build the debug app for the harness**

Run: `npm run build`
Then: `cmd /c "tools\dev-env.cmd cargo tauri build --debug --no-bundle"` (FOREGROUND, large timeout).
Expected: builds an `audioshelf.exe` debug binary.

- [ ] **Step 5: Run the settings walkthrough and screenshot-verify**

Run: `pwsh tools\verify.ps1 -Walkthrough settings -SkipBuild`
Expected: produces `.shots/settings.png` and writes the `.done` signal. Open the screenshot (Read tool) and confirm: the Settings heading, the fixture root path, and the "Indexed N authors, … chapters" summary are visible and legible. If the path/summary is missing, check that the `--library` bootstrap path set `libraryRoot`/`scan` before the walkthrough step ran.

- [ ] **Step 6: Run the existing walkthroughs to confirm no regression**

Run: `pwsh tools\verify.ps1 -Walkthrough browse -SkipBuild`
Expected: `.shots/browse-*.png` produced as before (bootstrap precedence change did not break the flag path).

- [ ] **Step 7: Commit**

```bash
git add src/harness/walkthroughs.ts src/App.tsx
git commit -m "test(m6): add settings walkthrough for screenshot verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full verification, PR, and roadmap update

**Files:**
- Modify: `ROADMAP.md` (flip M6 row to ✅ Merged with PR link, after merge)

- [ ] **Step 1: Run every gate**

Run each and confirm PASS:
- `npx tsc --noEmit`
- `npm test`
- `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri/Cargo.toml"`
- `pwsh tools\verify.ps1 -Walkthrough settings -SkipBuild` (screenshot reviewed)

- [ ] **Step 2: Manual read-only sanity check (defensive-ops invariant)**

Confirm M6 added **no** new audio-file mutation: the only disk writes are to the SQLite `settings` table and the (unchanged) rename tool. `scan_library` remains read-only on audio. Grep to confirm no new `std::fs` write/rename/remove calls were introduced outside `rename.rs`:

Run: `npx rg "fs::(rename|remove|write|copy)" src-tauri/src` (expect matches only in `rename.rs` / `capture.rs`, none in `commands.rs` settings code).

- [ ] **Step 3: Push the branch and open the PR**

```bash
git push -u origin <branch>
gh pr create --title "M6: Settings & Library-Root Picker" --body "Implements ROADMAP M6: in-app folder picker persists the library root in the settings table, so the app boots/scans/browses without --library. Adds a Settings screen (change root + re-scan), tauri-plugin-dialog + capability, defensive fail-safe to Settings when a persisted root is gone, and a settings walkthrough. Read-only on audio preserved.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Watch CI in the FOREGROUND**

Run: `gh pr checks <PR#> --watch`
Expected: `build-and-test` (windows-latest) passes. If it fails, use superpowers:systematic-debugging before re-pushing.

- [ ] **Step 5: Merge**

Run: `gh pr merge <PR#> --merge --delete-branch`

- [ ] **Step 6: Flip the ROADMAP row**

In `ROADMAP.md`, update the M6 row (line 32): status `[ ] Not started` → `✅ Merged`, fill the Plan column with `[M6](docs/superpowers/plans/2026-06-11-audioshelf-m6-settings.md)`, the PR column with the merged PR link, and a one-line Notes summary. Commit directly to `main`:

```bash
git pull
git add ROADMAP.md
git commit -m "docs: mark M6 (Settings & Library-Root Picker) merged

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push
```

- [ ] **Step 7: Ping the user**

The execution session sends the phase-handoff ping (PushNotification): M6 merged, suggest `/clear` + `/model opus` to plan M7 (Scale & Search Polish, the final v1 milestone).

---

## Self-Review

**Spec coverage (§5/§12 — the M6 scope):**
- §5 "`settings` — library root path and app preferences": Task 1 adds generic `get_setting`/`set_setting` over the existing table; `library_root` key persisted in Task 6. ✓
- §12 "in-app folder picker → persist root in settings → scan → browse": Tasks 2–6 (dialog plugin → `pickFolder` → `scanRoot` persists + scans → routes to library). ✓
- §12 "change-root + re-scan": Task 6 `chooseFolder` (change) + `rescan` (re-scan), both surfaced in SettingsView (Task 4). ✓
- Standalone-usable without `--library`: Task 6 bootstrap precedence (flag → persisted → onboarding). ✓
- Defensive-ops (standing preference): `scanRoot` fails safe to Settings with the error on a bad/missing root; M6 adds no audio-file mutation (Task 8 Step 2 verifies). ✓
- Self-verification harness: Task 7 adds the `settings` walkthrough + screenshot check. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to" — every step has concrete code or an exact command. ✓

**Type consistency:**
- Rust: `get_setting(key) -> Result<Option<String>>`, `set_setting(key, value) -> Result<()>`; helpers `get_setting_value`/`set_setting_value` used identically in the test. ✓
- TS: `getSetting(key) => string | null`, `setSetting(key, value)`, `pickFolder() => string | null` match SettingsView/App usage. ✓
- `SettingsView` prop names (`root`, `lastScan`, `scanError`, `busy`, `firstRun`, `onChooseFolder`, `onRescan`, `onBack`) are identical between the test (Task 4), the component (Task 4), and the call site (Task 6 Step 6). ✓
- `LibraryView` gains `onOpenSettings` in the type (Task 5), the test (Task 5), and the call site (Task 6 Step 6). ✓
- Route variant `{ kind: "settings"; firstRun: boolean }` is constructed consistently in bootstrap, `openSettings`, the walkthrough wiring, and consumed in `routedView()`. ✓

**Known v1 limitation (acceptable, documented):** the `--library` flag root is intentionally **not** persisted (keeps the harness hermetic); only user-picked/persisted roots survive restarts. Stated in Task 6 Step 5.
