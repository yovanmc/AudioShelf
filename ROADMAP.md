# AudioShelf — ROADMAP

> Source of truth for what to build next. A fresh session reads this, finds the topmost milestone that is **not ✅ Merged**, and acts. Follows the `/roadmap` workflow (Opus plans/researches · Sonnet implements · ping at every phase handoff).

**Legend:** ✅ Merged · 📝 Plan ready (execute next) · 🔬 Researching/Planning · [ ] Not started (plan first)

## Definition

Windows desktop app for listening to a large library of short-form spoken audio (audiobooks ~5min–1hr, a chapter at a time). Tauri 2 + React 18 + TypeScript + SQLite (rusqlite). **Read-only on audio files by default**; the rename tool is the sole sanctioned mutation.

- Repo: https://github.com/yovanmc/AudioShelf (default branch `main`)
- Design spec: [`docs/superpowers/specs/2026-06-11-audioshelf-design.md`](docs/superpowers/specs/2026-06-11-audioshelf-design.md)
- Detailed runbook (how-to, env, CI): [`docs/superpowers/WORKFLOW-execution.md`](docs/superpowers/WORKFLOW-execution.md)

## Conventions

- Cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the FOREGROUND (large timeout); `npm run build` before any `cargo tauri build`.
- Gates: `npx tsc --noEmit` · `npm test` · `cargo test` · `tools\verify.ps1 -Walkthrough <name>` (screenshot self-verification).
- Commits: use the repo's configured git identity (`yovanmc <yovanmc@users.noreply.github.com>`) — never pass `-c user.email=...` overrides. Add trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. **No Codex trailer.**
- CI: `build-and-test` on windows-latest. Merge PRs `--merge --delete-branch` from main; FOREGROUND `gh pr checks <PR#> --watch`.
- App ships **no stylesheet** in v1 (intentionally unstyled).

## Milestones

| # | Title | Status | Plan | PR | Notes |
|---|-------|--------|------|----|----|
| 1 | Foundation & Library Browsing | ✅ Merged | [M1](docs/superpowers/plans/2026-06-11-audioshelf-foundation.md) | [#1](https://github.com/yovanmc/AudioShelf/pull/1) | Scan `Author/` dirs → filename grouping (`original_stem` for file lookup) → browse author→works→chapters + played toggle. Harness + WAV fixture + CI. Read-only verified. |
| 2 | Playback & Progress | ✅ Merged | [M2](docs/superpowers/plans/2026-06-11-audioshelf-m2-playback.md) | [#2](https://github.com/yovanmc/AudioShelf/pull/2) | Now-playing PlayerBar (play/pause, seek, skip ±15/30s, volume, sleep timer); auto-mark-played on finish + `play_events`; stop after each. Asset scope hardened to `[]` + runtime grant of library root. |
| 3 | Tags & Discovery | ✅ Merged | [M3](docs/superpowers/plans/2026-06-11-audioshelf-m3-discovery.md) | [#3](https://github.com/yovanmc/AudioShelf/pull/3) | Author TagEditor; Discover panel (For-you / pick-a-tag / more-from-author). No schema change. DiscoveryView `picked` lifted to App (controlled). |
| 4 | Opt-in Rename Tool | ✅ Merged | [M4](docs/superpowers/plans/2026-06-11-audioshelf-m4-rename.md) | [#4](https://github.com/yovanmc/AudioShelf/pull/4) | Defensive, crash-safe, reversible batch rename to canonical names (`rename.rs`: build_plan ok/noop/conflict; manifest-before-rename + TOCTOU; tolerant idempotent undo). The only audio-file mutation. |
| 5 | Grouping-Override Review UI | ✅ Merged | [M5](docs/superpowers/plans/2026-06-11-audioshelf-m5-grouping.md) | [#5](https://github.com/yovanmc/AudioShelf/pull/5) | Per-chapter Work/Ch# edit on Author Detail; DB-only `regroup_author` overlays `grouping_overrides` on the heuristic, re-applied on scan, never to disk. Merge/split/reassign/reset. 41 FE + 32 Rust tests (incl. `grouping_roundtrip`). Screenshot-verified merge→reset round-trip. |
| 6 | Settings & Library-Root Picker | ✅ Merged | [M6](docs/superpowers/plans/2026-06-11-audioshelf-m6-settings.md) | [#6](https://github.com/yovanmc/AudioShelf/pull/6) | App is now standalone-usable: generic `get_setting`/`set_setting` over the `settings` table + `tauri-plugin-dialog` folder picker. Bootstrap precedence `--library` flag → persisted `library_root` → first-run onboarding; a gone/unreadable saved root **fails safe** to Settings with the error. Prop-driven `SettingsView` (choose-folder/re-scan/onboarding), Settings button on LibraryView, `settings` walkthrough. 47 FE + 33 Rust tests. No new audio-file mutation (only the SQLite settings write). |
| 7 | Scale & Search Polish | 📝 Plan ready | [M7](docs/superpowers/plans/2026-06-11-audioshelf-m7-scale-search.md) | — | Finishes v1 (spec §4/§6/§13): virtualize author list (`react-window` FixedSizeList, 300+/10k); backend `search_library` SQL search across authors/works/chapters (`LibraryView` controlled, debounced); inline color+initials cover placeholders; +40 filler fixture authors (sort last) + `m7` walkthrough. Next session executes this. After M7 the v1 spec is fully implemented. |

## Decision log & gotchas

- **Grouping:** `original_stem` is threaded for on-disk file lookup; canonical `stem` drops trailing words. Lone numbered file demoted to standalone ("Area 51" not split into "Area"/51).
- **Asset protocol:** static scope `[]` + runtime `allow_directory(root, true)` in `scan_library` (library root only).
- **Harness:** `settle()` (double rAF + 60ms) before every screenshot; a walkthrough step that reads React state set by the immediately-prior step must be self-contained (re-fetch). Screenshots render on the user's iOS app via the Read tool.
- **Subagents** must run cargo in the FOREGROUND (background builds can't be resumed).
- **Windows:** a colon in a filename creates an NTFS Alternate Data Stream, not a real file (bit M4 tests).
- **Rename↔grouping (v1 limit):** `grouping_overrides` is keyed on `file_path`, so renaming an overridden file via M4 orphans its override row. Acceptable for v1.
- **Settings (M6):** library root persisted in the `settings` table under key `library_root`. The `--library` flag is intentionally **not** persisted (keeps the harness hermetic); only user-picked roots survive restarts. Native picker needs a **capability file** (`capabilities/default.json` granting `dialog:default`) — plugin commands are gated, unlike custom app commands.
- **Tauri debug rebuild gotcha:** `cargo tauri build --debug` is a no-op cache hit if no *Rust* source changed — even after `npm run build` updated the embedded `dist/`. A stale binary runs old JS and the harness hangs. Force a relink (`cargo clean`, or touch a Rust file) after a frontend-only change before re-running the screenshot harness.
- **M7 plan decisions (📝 ready, not yet built):** Search is a **backend** `search_library` SQL command (indexed `LIKE`, per-bucket cap 50), debounced 150ms client-side — *not* client filtering (would defeat the 10k scale target). `LibraryView` becomes **fully controlled** by App (query + results props), staying free of `invoke`. Author list virtualized with **`react-window` `FixedSizeList`** (explicit height/itemSize → renders a bounded window even in jsdom, enabling a deterministic 1000-author bound test). Cover placeholders are **inline-styled** color+initials (app ships no stylesheet, so a CSS class would be inert). Fixture gains **40 `Zz Sample Author NN`** authors named to sort **after** the real three so first-author walkthroughs (player, grouping) are unaffected — re-verified as a regression check. CI uses `npm ci`, so the new `react-window` dep **must** ship a synced `package-lock.json`.
