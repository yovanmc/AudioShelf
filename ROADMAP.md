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
| 6 | Settings & Library-Root Picker | 📝 Plan ready | [M6](docs/superpowers/plans/2026-06-11-audioshelf-m6-settings.md) | — | Makes the app standalone-usable (today root only comes from `--library` flag). Spec §5/§12: in-app folder picker → persist root in `settings` → scan → browse; change-root + re-scan. Plan first. |
| 7 | Scale & Search Polish | [ ] Not started | — | — | Finishes v1 (spec §4/§6/§13): virtualize author list (300+/10k target); search across works + chapters (today authors only); generated cover placeholders. Plan first. After M7 the v1 spec is fully implemented. |

## Decision log & gotchas

- **Grouping:** `original_stem` is threaded for on-disk file lookup; canonical `stem` drops trailing words. Lone numbered file demoted to standalone ("Area 51" not split into "Area"/51).
- **Asset protocol:** static scope `[]` + runtime `allow_directory(root, true)` in `scan_library` (library root only).
- **Harness:** `settle()` (double rAF + 60ms) before every screenshot; a walkthrough step that reads React state set by the immediately-prior step must be self-contained (re-fetch). Screenshots render on the user's iOS app via the Read tool.
- **Subagents** must run cargo in the FOREGROUND (background builds can't be resumed).
- **Windows:** a colon in a filename creates an NTFS Alternate Data Stream, not a real file (bit M4 tests).
- **Rename↔grouping (v1 limit):** `grouping_overrides` is keyed on `file_path`, so renaming an overridden file via M4 orphans its override row. Acceptable for v1.
