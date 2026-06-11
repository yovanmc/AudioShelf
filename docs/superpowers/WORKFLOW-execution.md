# AudioShelf Milestone Execution Workflow (Repeatable Runbook)

**Audience:** A Claude **Sonnet** agent executing the AudioShelf milestone roadmap, with an
**Opus controller** orchestrating. Adapted from VideoTriage's remediation runbook for this app's
Tauri + React + SQLite stack.

**Mode:** Default is **one milestone per invocation** (pick the next unstarted milestone, write its
plan if missing, execute end-to-end: plan → implement → review → self-verify → PR → CI → merge,
update the Progress Log, stop). **Override:** if the user asks to "run the whole workflow" / "get the
entire workflow done," chain milestones **continuously** — after merging one, immediately start the
next (sync main, branch, plan, execute…) until all are merged, without stopping to check in. Never
stall at the CI step waiting for a prompt (see §6).

**Authoritative inputs:**
- Design spec: `docs/superpowers/specs/2026-06-11-audioshelf-design.md`
- Per-milestone plans: `docs/superpowers/plans/2026-06-11-audioshelf-*.md` (M1 exists; write M2–M4 with
  the `superpowers:writing-plans` skill before executing them).
- Execution method: the `superpowers:subagent-driven-development` skill.

> **Golden rule:** The controller does **not** write production code. It dispatches fresh subagents
> per task, reviews their work in two stages, self-verifies the running app, then merges. This keeps
> the controller's context clean and the work high-quality.

---

## 0. Environment specifics (learned during M1 — do not rediscover)

| Thing | Value / command |
|---|---|
| Repo root | `C:\Agent Projects\AudioShelf` |
| Default branch | `main` |
| `gh` CLI | **On PATH here** — `gh pr create` / `gh pr merge` work directly via the Bash tool (unlike VideoTriage). |
| Cargo wrapper | All cargo/tauri commands MUST go through `tools\dev-env.cmd` (sets up MSVC): `cmd /c "tools\dev-env.cmd cargo ..."`. |
| Rust tests | `cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"` |
| Front-end tests | `npm test` (vitest run) |
| Type check | `npx tsc --noEmit` |
| Front-end build | `npm run build` (tsc + vite) — **produces `dist/`** |
| Visual self-verify | `powershell -ExecutionPolicy Bypass -File tools\verify.ps1` → screenshots in `.shots\<walkthrough>\` |
| M1 baseline | 13 Rust unit + 1 fixture-scan integration + 11 vitest = 25 tests, 0 failures (grows per milestone) |

**Known gotchas:**
1. **Run cargo in the FOREGROUND inside subagents.** A subagent that launches a long build with
   `run_in_background` returns control before it finishes and **cannot be resumed** in this harness.
   Tell implementers to run cargo in the foreground with a large timeout (~590000 ms). The dependency
   tree is already compiled once `target/` is warm, so incremental builds are fast.
2. **`npm run build` must precede any `cargo build`/`cargo test`.** `tauri::generate_context!()` embeds
   `../dist` at compile time; if `dist/` is missing the Rust build fails. (CI enforces this ordering.)
3. **Harness screenshots need a paint-settle.** After a route/state change in `App.tsx`, the walkthrough
   must `await settle()` (double `requestAnimationFrame` + a short timeout) before `captureWindow`, or
   each screenshot lags one frame behind the state it should show. Keep `settle()` in `App.tsx`.
4. **`cmd /c "tools\dev-env.cmd ..."` output does NOT pipe cleanly through the Bash tool** (you get only
   the cmd banner). Use the **PowerShell tool** for dev-env invocations, or run them with
   `run_in_background` + redirect to a log and `Read` the log.
5. **Bash tool resets CWD between calls** and **mangles backslash paths** (`tools\verify.ps1` →
   `toolsverify.ps1`). Always `cd` at the start of every command, and use **forward slashes**
   (`/c/Agent Projects/AudioShelf`) or the PowerShell tool for `.ps1` invocations.
6. **`vswhere.exe` "not recognized" stderr lines are harmless** — they come from vcvars internals; the
   MSVC compile/link still succeeds. Don't chase them.
7. **CRLF warnings on commit are benign** (`LF will be replaced by CRLF`).
8. **`verify.ps1` self-locates the repo via `$PSScriptRoot`** and `Set-Location $root`, so it can be run
   from any CWD. It does a full `cargo tauri build --debug --no-bundle` then launches the real app.

---

## 1. The milestone queue

Execute in order. Each milestone = one plan file = one PR. **Do one milestone per run.**

| # | Milestone | Plan file | Status | Depends on |
|---|---|---|---|---|
| 1 | Foundation & Library Browsing | `2026-06-11-audioshelf-foundation.md` | ✅ Merged (PR #1) | — |
| 2 | Playback & Progress | *(write with writing-plans)* | [ ] Not started | M1 |
| 3 | Tags & Discovery | *(write with writing-plans)* | [ ] Not started | M2 |
| 4 | Opt-in Rename Tool | *(write with writing-plans)* | [ ] Not started | M1 |

Milestone scope is defined in the design spec (§9–13) and the M1 plan's Appendix. Milestones share files
(`App.tsx`, `commands.rs`, `lib.rs`, `db.rs`); run them **sequentially**, branching each new milestone off
the freshly merged `main`.

---

## 2. Per-run procedure (top level)

```
1. Sync main + create the milestone branch                 (section 3)
2. If no plan file exists, write it (writing-plans skill), commit it
3. Read the plan, extract ALL tasks with full text
4. For each task: implement → spec review → quality review → fix loop   (section 4)
5. Final whole-branch review                                (section 4, Step F)
6. Visual self-verification: run verify.ps1, READ every screenshot      (section 5)
7. Finish: push, PR, watch CI, merge from main repo root, sync          (section 6)
8. Update the Progress Log                                  (section 7)
9. Stop. (One milestone per run.)
```

**Continuous execution within a milestone:** Do not stop to check in with the user between *tasks*.
Only stop for: a BLOCKED subagent you cannot unblock, genuine ambiguity, or milestone complete.

---

## 3. Setup (start of every milestone)

This app uses a **feature branch in the main repo** — NOT a separate git worktree. Rationale: Tauri's
Rust `target/` is ~hundreds of MB and a fresh worktree would force a full cold rebuild (10+ min) every
milestone; a branch in the main repo reuses the warm `target/`.

```bash
# From repo root — sync first, then branch
cd "/c/Agent Projects/AudioShelf" && git checkout main && git pull --ff-only
git checkout -b m<N>-<slug>     # e.g. m2-playback, m3-discovery, m4-rename
```

**Verify a clean baseline before any work:**
```bash
cd "/c/Agent Projects/AudioShelf" && npm test    # vitest
```
```powershell
cmd /c '"C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test --manifest-path "C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml"'
```
If baseline is red, stop and report — do not build on a broken base.

---

## 4. Per-task cycle (the core loop)

For each task in the plan, in order:

### Step I — Dispatch implementer subagent
- Tool: `Agent`, `subagent_type: general-purpose`, `model: sonnet`.
- **Do NOT make the subagent read the plan file.** Paste the full task text, exact file paths, the code
  snippets, and scene-setting context into the prompt. Include:
  - The branch name and "work from `C:\Agent Projects\AudioShelf`; do not switch branches or touch main".
  - TDD expectation: write the failing test first, run it red, implement, run it green, commit.
  - **Run cargo/npm in the FOREGROUND** (gotcha #1), with the exact verification commands.
  - The commit message + trailer (section 8).
  - Required output: end with `STATUS: DONE | DONE_WITH_CONCERNS — … | NEEDS_CONTEXT — … | BLOCKED — …`,
    plus the actual test output observed and the commit SHA.
- Handle the returned status (`DONE` → Step S; `DONE_WITH_CONCERNS` → read concern, address if
  correctness/scope; `NEEDS_CONTEXT` → provide & re-dispatch; `BLOCKED` → add context / stronger model /
  split task / escalate if the plan is wrong).

### Step S — Spec compliance review
- The controller (Opus) reviews by **reading the actual committed files** against the task spec — this is
  independent (the controller didn't write them) and avoids the harness's inability to resume a finished
  subagent. (A fresh Sonnet reviewer subagent is an acceptable alternative.)
- Verdict: spec-compliant (every requirement met, nothing extra) or issues with file:line.
- If issues → dispatch a **fresh implementer subagent** with the precise issues (since `SendMessage` to a
  finished agent is unavailable here), or, for a one-line fix the controller has fully diagnosed, apply it
  directly. Re-review until clean. **Never** start quality review before spec is clean.

### Step Q — Code quality review
- Get the SHAs: `git log --oneline <base>..HEAD`. Review (controller or fresh Sonnet subagent) for
  correctness, pattern consistency, test quality (does the test fail if the bug returns?), side-effects,
  edge cases, and the **read-only-on-audio-files guarantee** (no fs writes/renames/deletes touching the
  library — only the SQLite DB and harness shot/done-signal files are allowed).
- Critical/Important issues → fix loop. Minor → fix if cheap, else log in the Progress Log.

### Step M — Mark task complete, go to the next. Repeat I→S→Q.

### Step F — Final whole-branch review (after ALL tasks)
- Review `git diff <base>..HEAD` for the whole milestone: Rust↔TS type/command-name consistency,
  internal coherence, the read-only guarantee, anything blocking a PR. Address blockers, then go to §5.

---

## 5. Visual self-verification (AudioShelf-specific — do not skip)

This app ships a screenshot harness; a milestone is not "done" until its UI is verified by eye.

```bash
cd "/c/Agent Projects/AudioShelf" && powershell -ExecutionPolicy Bypass -File ./tools/verify.ps1 > .shots-verify.log 2>&1; echo "EXIT=$?"; tail -6 .shots-verify.log
```
(Run with `run_in_background` since it does a full build + app launch; then `Read` the log.)

- Expect `WALKTHROUGH OK` and the screenshot paths under `.shots\<walkthrough>\`.
- **READ each screenshot** with the Read tool — it embeds the image so it renders in chat and on the
  user's iOS remote (see memory `image-delivery-remote-control`). Verify every UI state shows the
  expected content (counts, grouping, ordering, labels, controls) — not blank, not lagged.
- When a milestone adds a screen, add a walkthrough step in `src/harness/walkthroughs.ts` and a matching
  nav callback in `App.tsx` (remember `settle()` — gotcha #3) so the new screen is screenshotted.
- Fix any defect found and re-run before proceeding. (M1 caught a one-frame screenshot lag and missing
  row separators this way.)

---

## 6. Finish the branch (push → PR → CI → merge → clean up)

Use the `superpowers:finishing-a-development-branch` discipline. **User's standing instruction:
"Create a PR and merge it once CI passes."** Follow that without re-asking.

```bash
# 1. Final gates
cd "/c/Agent Projects/AudioShelf" && npx tsc --noEmit && npm test
```
```powershell
cmd /c '"C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test --manifest-path "C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml"'
```
```bash
# 2. Push
cd "/c/Agent Projects/AudioShelf" && git push -u origin m<N>-<slug>

# 3. Create the PR (Summary + Test Plan; close with the Claude Code footer)
gh pr create --title "Milestone <N>: <Title>" --body "<summary + test plan>"

# 4. Watch CI to green (build-and-test on windows-latest) — RUN IN THE FOREGROUND (BLOCKING)
gh pr checks <PR#> --watch --interval 20
```

> **CI must not require a user prompt.** Run `gh pr checks <PR#> --watch` as a **foreground/blocking**
> command with a large timeout (~590000 ms; CI runs ~6 min, well under the 10-min cap). It exits 0 when
> all checks pass and non-zero on failure. Because it blocks, control returns to this turn automatically
> the moment CI resolves, and you proceed straight to merge — **do NOT end the turn at the CI step and
> wait to be re-prompted.** Do not use a background poll loop for the CI gate. If `--watch` ever times
> out (CI exceeded the cap), re-invoke it once; only escalate if it genuinely stalls.
```bash
# 5. Merge — FROM main (checkout main first so --delete-branch can remove the feature branch)
cd "/c/Agent Projects/AudioShelf" && git checkout main && \
  gh pr merge <PR#> --merge --delete-branch && \
  git pull --ff-only
```

- Use `--merge` (not squash) to preserve the per-task commit history.
- If CI fails, fix on the branch and push; never merge red. The `build-and-test` job builds the
  front-end (tsc + vite), runs vitest, then builds + tests the Rust core — same kind of gate VideoTriage
  has (its extra MSIX-packaging job is .NET-specific and not applicable until AudioShelf has an installer).

---

## 7. Progress Log (update at the end of every run)

| Milestone | Branch | PR | Status | Notes |
|---|---|---|---|---|
| 1 — Foundation & Library Browsing | `m1-foundation` | #1 | ✅ Merged | Scan Author/ dirs → filename grouping (`original_stem` threaded for file lookup; canonical `stem` drops trailing words) → browse Author→works→chapters + played toggle. Read-only verified. Harness + WAV fixture + CI added. 25 tests. Screenshot-verified. |
| 2 — Playback & Progress | `m2-playback` | #2 | ✅ Merged | Now-playing PlayerBar (play/pause, seek, skip ±15/30s, volume, sleep timer); auto-mark-played on finish + `play_events`; stop after each chapter; per-chapter ▶. `mark_chapter_finished` command. Asset scope hardened to `[]` + runtime grant of library root. `player` walkthrough. Screenshot-verified. |
| 3 — Tags & Discovery | `m3-discovery` | #3 | ✅ Merged | Author TagEditor (autocomplete from used tags); Discover panel — "For you" (shared tags w/ recently-played authors), "Pick a tag" (multi-select, mostly-unplayed), "More from author" via suggestion links. Commands: get_all_tags/set_author_tags/get_discovery/get_discovery_by_tags/get_more_from_author. No schema change (reused `author_tags`+`play_events`); read-only preserved. DiscoveryView `picked` lifted to App (controlled). `discovery` walkthrough. 34 FE + 18 Rust tests. Screenshot-verified (For-you, checked pick-a-tag, by-tag results). |
| 4 — Opt-in Rename Tool | `m4-rename` | — | [ ] Not started | Separate screen, off by default. Preview diff → confirm → defensive rename + undo manifest. Plus grouping-override UI writing `grouping_overrides`. Honor destructive-op discipline. |

**How to update:** after merging a milestone, flip its row to ✅ Merged, fill in the PR number, and add a
one-line note of what shipped plus any deferred minor issues.

---

## 8. Commit & authorship conventions

- Keep the human (`Yovan <yovanfly@gmail.com>`) as git author/committer.
- Append the Claude trailer to AI-generated commits:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **No Codex trailer** — AudioShelf's plans are Claude-authored, not Codex-derived (this differs from
  VideoTriage, whose `AGENTS.md` requires a Codex trailer for Codex-derived changes).
- Keep commits small and per-task (one logical change each). Merge PRs with `--merge` (no squash) to
  preserve that history.

---

## 9. Cross-cutting rules (apply to every milestone)

- **Read-only on the user's audio files** is the core product guarantee. The ONLY allowed filesystem
  writes are: the SQLite DB in the app-data dir, harness screenshot/done-signal files, and (M4 only) the
  explicit opt-in rename tool with preview + undo manifest. Quality review must check this every time.
- **Destructive-op discipline** (standing user principle, central to M4): verify before destroying,
  prefer recoverable ops, fail safe, preflight checks, crash-safe/resumable.
- **Confirm-before-build:** before dispatching a task, check whether a prior milestone already
  implemented part of it; tell the implementer to verify-then-skip if present.
- **Pre-playback (M2) security note:** the asset-protocol scope in `tauri.conf.json` is currently `["**"]`.
  Before wiring `<audio>` playback, narrow it to the user's library root.
- **Agent timeouts:** every agent-run shell command must have a finite timeout. No unbounded waits.

---

## 10. One-run checklist (copy this each time)

- [ ] Identified next `[ ]` milestone from the Progress Log
- [ ] Synced main, created `m<N>-<slug>` branch, verified green baseline
- [ ] Wrote the milestone plan (writing-plans) if missing, committed it
- [ ] Extracted all tasks with full text
- [ ] Ran each task through Implement → Spec ✓ → Quality ✓ → next
- [ ] Ran the final whole-branch review, addressed blockers
- [ ] Ran `verify.ps1` and **read every screenshot**; fixed UI defects; re-verified
- [ ] tsc clean, vitest green, cargo test green
- [ ] Pushed, opened PR, watched CI to green (build-and-test)
- [ ] Merged from main with `--merge --delete-branch`, pulled main
- [ ] Updated the Progress Log row
- [ ] Stopped (one milestone per run)
