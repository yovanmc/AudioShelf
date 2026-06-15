# M33 — Remove Transcripts & Simplify Search (AudioShelf v8)

> **Written for Sonnet execution. If something doesn't match this plan (a line moved, a snippet differs, a test you didn't expect fails), STOP and report rather than guess.** Line numbers are from a 2026-06-14 inventory and may have drifted — always `grep`/confirm before editing. The repo is `C:\Agent Projects\AudioShelf` (package `audioshelf`, lib target `audioshelf_lib`).

## What & why

The owner decided (2026-06-14) to **completely remove the transcripts feature** (parsing `.srt`/`.vtt` sidecars during scan into a `transcripts` table, the `search_transcripts` search bucket, the now-playing transcript panel, and `get_chapter_transcript`). Search keeps working **purely over creator names, work/list titles, and chapter filenames** — exactly what `search_library` already does, **including its existing label/tag-value matching** (the M9/M26 unified-labels discovery affordance via indexed `EXISTS` subqueries — this is KEPT, it is not part of transcripts).

This **supersedes the originally-planned M33 "FTS5 full-text search."** FTS5's only meaningful payload was the large transcript text; with transcripts gone, search runs purely over short fields (M32 measured `searchMs` ≈ 4–7 ms at 12k chapters), so FTS5 would add machinery and no measurable value. **No FTS5, no virtual tables, no trigram tokenizer.**

This is primarily a **deletion** milestone plus one **destructive-but-safe** schema step: a v13 migration that `DROP TABLE`s `transcripts`. The drop is safe — nothing FK-references `transcripts` (it references `chapters`, not the reverse), and its content is fully re-derivable from on-disk sidecars (which we never wrote), so no user-authored data is lost.

## Invariants (hard gates — verify at the end)

- **No new dependency.** `git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json gen-fixture/Cargo.toml` must be **EMPTY**. (We only remove code.)
- **Read-only-on-disk.** This milestone *removes* a read+derive feature, so it only gets more read-only. No new `fs::write`/`remove`/`rename`/`create` in production paths.
- **Default fixtures stay 43 / 44 / 47.** `src-tauri/tests/fixture_scan.rs` expectations are unchanged (confirmed: there are **no** `.srt`/`.vtt` files in the fixture tree; transcripts were always runtime-seeded in tests).
- **Schema bump is on the M16 runner.** `db::LATEST` goes **12 → 13**; the v13 step is a normal `run_step` (atomic `BEGIN … COMMIT` + `PRAGMA user_version = 13`). `SCHEMA_V1` and migrations v5/v8/v10/v11/v12 are **untouched** — v5 still *creates* `transcripts`, v13 *drops* it (monotonic chain, never edit history).
- **Non-transcript search result shapes are byte-identical.** `SearchResults` / `AuthorHit` / `WorkHit` / `ChapterHit` and the scoped/DSL path (`run_scoped_query`) are **NOT** changed. The frontend's author/work/chapter buckets render unchanged.

## Environment / build notes (durable, from M30–M32)

- Run cargo via the **PowerShell tool** with the absolute-quoted dev-env form (the Bash-tool `cmd /c "tools\dev-env.cmd …"` form silently no-ops in this session):
  `cmd /c '"C:\Agent Projects\AudioShelf\tools\dev-env.cmd" cargo test --manifest-path "C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml" <filter>'`
- FE gates from the repo root: `npx tsc --noEmit` and `npm test`.
- Frozen screenshot build (only for Task 6): `npm run build` THEN `cargo tauri build --debug`, then `pwsh -File tools/verify.ps1 -SkipBuild -Walkthrough <name>`. Never run `cargo test`/`tauri dev` between the frozen build and `verify.ps1 -SkipBuild` (re-overwrites the exe → dev-mode "localhost refused").
- `verify.ps1 -Measure` is **not needed** this milestone (no perf claim).

---

## Task 1 — Schema: v13 migration that drops `transcripts`

**File: `src-tauri/src/db.rs`**

1a. **Bump `LATEST`** (currently `pub(crate) const LATEST: i64 = 12;`, ~line 62) to `13`.

1b. **Add the migration function** next to `migration_v12_query_indices` (~lines 247–255), following the identical shape:

```rust
fn migration_v13_drop_transcripts(conn: &Connection) -> rusqlite::Result<()> {
    // M33: the transcripts feature is removed. Nothing FK-references this table
    // (it references chapters, not the reverse), so a plain DROP is clean and
    // needs no FK-off rebuild. Content was derived from on-disk sidecars and is
    // re-derivable, so no user-authored data is lost.
    conn.execute_batch("DROP TABLE IF EXISTS transcripts;")?;
    Ok(())
}
```

1c. **Register it in `migrate()`** (~lines 312–351): immediately after the v12 step, mirror the existing v12 registration line exactly, changing `12 → 13` and the fn name. (e.g. the analog of `if version < 13 { run_step(conn, 13, migration_v13_drop_transcripts)?; }` — match the surrounding code's exact conditional style; **confirm against the v12 line, don't invent**.)

1d. **Register it in `open_at_version()`** (~lines 378–413): add the v13 arm mirroring the v12 arm (the analog of `if version >= 13 { run_step(&conn, 13, migration_v13_drop_transcripts)?; }`).

1e. **Update the schema-tables test** `schema_creates_all_tables_including_transcripts` (~lines 705–711): it opens at `LATEST` and asserts `transcripts` is present — now wrong. Rename it (e.g. `schema_creates_all_core_tables`) and **remove `"transcripts"`** from its expected-table set so it asserts the remaining core tables.

1f. **Keep** `open_at_version_4_lacks_transcripts_table` (~lines 657–701) as-is — it validates the v5 boundary (absent at v4, present at v5), which is still correct.

1g. **Add a new test** proving the drop (place near the other migration tests):

```rust
#[test]
fn migration_v13_drops_transcripts() {
    let q = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='transcripts'";
    let conn12 = open_at_version(12).unwrap();
    let at12: i64 = conn12.query_row(q, [], |r| r.get(0)).unwrap();
    assert_eq!(at12, 1, "transcripts should still exist at v12");
    let conn13 = open_at_version(13).unwrap();
    let at13: i64 = conn13.query_row(q, [], |r| r.get(0)).unwrap();
    assert_eq!(at13, 0, "transcripts should be dropped at v13");
}
```

1h. **Bump every hardcoded `12` version assert to `13`** in **BOTH** `db.rs` AND `commands.rs` (the M30/M32 lesson — `cargo test` is the catch). `grep` both files for: `assert_eq!(… 12)` on a `user_version`/full-migration result, `open_at_version(12)` calls that mean "latest", and schema-version string `"12"` (e.g. `settings_round_trip`). **Leave version-step-specific guards alone** (e.g. `open_at_version(4)`, "requires v5/v8/v10/v11" guards, the new `migration_v13_drops_transcripts`'s `open_at_version(12)`). Known suspects from the inventory: `db.rs` ~lines 447, 458, 477, 524, 540, 573, 631, 691, 756, 796, 862; `commands.rs` the `settings_round_trip` schema-version string + any `migration_*` test asserting a *full* open reaches LATEST. Don't trust the list — grep and let `cargo test` confirm.

**Verify Task 1:** `cargo test` for db (e.g. filter `migration` and `schema`) — `migration_v13_drops_transcripts` passes, the renamed schema test passes, no `== 12` assert failures.

---

## Task 2 — Remove the transcript Rust module + scan integration

2a. **Delete the file** `src-tauri/src/transcripts.rs` entirely (it is a dedicated module: `parse_srt_vtt` + its 8 unit tests, nothing else depends on it after the steps below).

2b. **`src-tauri/src/lib.rs`:** remove `mod transcripts;` (~line 17) and the testing re-export `pub use crate::transcripts::parse_srt_vtt;` (~line 168).

2c. **`src-tauri/src/scan.rs`:**
- Remove `use crate::transcripts::parse_srt_vtt;` (~line 11).
- Remove the call site in `scan_author`: `ingest_sidecar_transcript(conn, chapter_id, file)?;` (~line 302).
- Remove the entire `fn ingest_sidecar_transcript(...)` (~lines 375–409).
- Remove the transcript-table tests: `sidecar_srt_is_ingested` (~564–572), `sidecar_vtt_is_ingested` (~590–593), `no_sidecar_leaves_transcripts_empty` (~596–610).
- **KEEP** `srt_and_vtt_files_alone_do_not_add_chapters` (~619–620) — it asserts stray `.srt`/`.vtt` files are **not** treated as audio (0 chapters), which is still correct scan behavior unrelated to transcripts. Only strip any line in it that queries the `transcripts` table (if present); keep the chapter-count assertion.

**Verify Task 2:** `cargo build` (lib) compiles with no unused-import/dead-code warnings about transcripts; `cargo test` scan tests green (fixture counts unaffected).

---

## Task 3 — Remove the transcript commands & handler registration

**File: `src-tauri/src/commands.rs`** (grep `transcript` to confirm; inventory line refs in parens):
- Remove the section header comment `// ---- transcript search (M16 Task 8) ---` (~2142).
- Remove `struct TranscriptHit { … }` (~2145–2155).
- Remove `search_transcripts_inner` (~2179–2227), `#[tauri::command] search_transcripts` (~2229–2236), `get_chapter_transcript_inner` (~2238–2250), `#[tauri::command] get_chapter_transcript` (~2252–2259).
- Remove the test block: `// ---- transcript search tests …`, `seed_transcript` helper (~4323–4329), and tests `search_transcripts_finds_seeded_content`, `search_transcripts_returns_empty_for_no_match`, `search_transcripts_returns_empty_for_blank_query`, `get_chapter_transcript_returns_content_when_present`, `get_chapter_transcript_returns_none_when_absent` (~4331–4497).

**File: `src-tauri/src/lib.rs`:**
- Remove `commands::search_transcripts,` and `commands::get_chapter_transcript,` from the `tauri::generate_handler![...]` list (~101–102).
- Remove `search_transcripts_inner` and `TranscriptHit` from the `pub use crate::commands::{ … }` testing re-export (~155).

**Do NOT touch** `search` / `search_library` / `search_library_for_test` / `SearchResults` / `run_scoped_query` / `parse_query` — they stay exactly as they are.

**Verify Task 3:** `cargo test` (full lib) compiles and is green; no dangling handler/use references. Expect the lib test count to **drop** by the removed Rust tests (8 in transcripts.rs + 3 scan + 5 commands = 16 fewer) — that's expected, note the new number.

---

## Task 4 — Frontend: remove transcript wiring

**File: `src/lib/api.ts`:** remove `interface TranscriptHit { … }` (~223–231), `export const searchTranscripts = …` (~326–327), and `export const getChapterTranscript = …` (~328–329).

**File: `src/App.tsx`:**
- Imports: drop `searchTranscripts, getChapterTranscript` (~14) and `type TranscriptHit` (~33).
- Remove state `transcriptResults`/`setTranscriptResults` (~179) and `currentTranscript`/`setCurrentTranscript` (~220–221).
- Remove the `showTranscriptSearch` walkthrough surface callback (~1441–1450).
- Remove every `setTranscriptResults(null)` (~1693, 1751, 1785, 2412, 3067, 3078).
- In the plain-search branch (~3085–3088), replace the parallel call:
  ```ts
  const [r, tr] = await Promise.all([searchLibrary(q), searchTranscripts(q)]);
  if (!cancelled) { setResults(r); setTranscriptResults(tr); }
  ```
  with:
  ```ts
  const r = await searchLibrary(q);
  if (!cancelled) setResults(r);
  ```
  (Adjust the surrounding comment at ~3062 that mentions `searchTranscripts`.)
- Remove the current-chapter transcript effect (~3097–3104, the `getChapterTranscript(chapterId)` fetch).
- Remove render props `transcriptResults={transcriptResults}` on `<LibraryView>` (~3333) and `transcript={currentTranscript}` on `<NowPlayingPanel>` (~3517), and the `showTranscriptSearch` entry wherever the harness `nav` object is assembled.
- Leave the scoped/`advancedSearch` branch and `hasScopedTokens` untouched.

**File: `src/views/LibraryView.tsx`:** remove the `TranscriptHit` type import (~3), the `transcriptResults?` prop (~25–26), the `transcriptHits={props.transcriptResults}` pass-through (~182), and in `SearchResultsPanel` (~227–299) remove the `transcriptHits` param/type, the `hasTranscripts` calc, its inclusion in `hasAny`, and the whole "Transcripts" `<section>` (~276–297). Keep the authors/works/chapters buckets and the no-matches message.

**File: `src/player/NowPlayingPanel.tsx`:** remove the `transcript?: string | null` prop (~41–42) and the conditional "Transcript" `<section>` (~268–275).

**CSS:** `grep -ri transcript src/**/*.css` (and any global stylesheet) and remove dead rules (e.g. `.now-playing__transcript`).

**Verify Task 4:** `npx tsc --noEmit` is clean (no unused symbols, no missing props).

---

## Task 5 — Frontend tests & walkthrough cleanup

**File: `src/views/LibraryView.test.tsx`:** remove the `TranscriptHit` import (~5) and the 4 transcript tests (~197–256): the "renders a Transcripts bucket…", "does not render… when empty", "clicking a transcript hit opens the author", and the transcript half of "no-matches message…". Keep a no-matches test that passes only empty `results` (drop the `transcriptResults` arg).

**File: `src/player/NowPlayingPanel.test.tsx`:** remove the 3 transcript-panel tests (~163–180).

**File: `src/harness/walkthroughs.ts`:** remove the `showTranscriptSearch: () => Promise<void>;` callback type (~171) and the m16 step `{ name: "transcript-search", run: nav.showTranscriptSearch }` (~179); adjust the m16 surface comment (~162–163). Keep all other m16 steps and **all other step names stable**.

**File: `src/harness/runner.test.ts`:** remove `showTranscriptSearch: noop` from the mock nav (~51) and `"transcript-search"` from the expected m16 step-name list (~58).

**Verify Task 5:** `npm test` (vitest) green; `runner.test.ts` m16 expectation matches the trimmed step list.

---

## Task 6 — Full verification + invariant audit

Run in order, capture output:

1. **Rust:** `cargo test` (lib + integration). Expect green, incl. `migration_v13_drops_transcripts`, the renamed schema test, `fixture_scan` still **43/44/47**, `scaled_scan` correctness. Note the new lib test count (≈16 fewer than the 184 M32 baseline).
2. **FE types/tests:** `npx tsc --noEmit` clean; `npm test` green (transcript tests gone; count drops accordingly).
3. **Invariant diff-stat (must be EMPTY):** `git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json gen-fixture/Cargo.toml`.
4. **Read-only audit:** `grep -rn "fs::\(write\|remove\|rename\|create\)" src-tauri/src` — every hit must be `#[cfg(test)]` or a pre-existing export/backup command (no new ones; we added none).
5. **Dead-reference sweep:** `grep -rin transcript src-tauri/src src` returns **nothing** except possibly this plan's path / changelog. Zero `transcripts`-table references in `commands.rs`/`scan.rs`.
6. **Screenshot check (FE surfaces changed: search results panel lost a bucket, now-playing lost a section).** Frozen build, then run the `m7` (search) and `m16` walkthroughs:
   - `npm run build` → `cargo tauri build --debug` → `pwsh -File tools/verify.ps1 -SkipBuild -Walkthrough m7` and `… -Walkthrough m16`.
   - **Dispatch a Sonnet subagent** to Read the produced PNGs and return a **text verdict** (PASS/FAIL + the absolute paths it viewed): confirm the search results render authors/works/chapters cleanly with **no** "Transcripts" section and no layout break, and the now-playing panel renders cleanly with **no** "Transcript" section. Do **not** load the PNGs into the controller context.

If any gate fails, STOP and report with the failing output.

---

## Acceptance criteria

- `db::LATEST == 13`; opening a fresh DB and an existing v12 DB both end with **no** `transcripts` table; `migration_v13_drops_transcripts` proves it.
- No `transcript`/`transcripts` references remain anywhere in `src-tauri/src` or `src` (code, tests, types, walkthroughs, CSS).
- `search_library` and the scoped/DSL search are unchanged: search works over creator names, work titles, chapter filenames, **and** label/tag values (e.g. `cozy` still finds tagged works); the author/work/chapter result shapes are byte-identical.
- All gates green: `cargo test`, `tsc`, `npm test`; diff-stat invariant EMPTY; fixtures 43/44/47; read-only intact; m7+m16 screenshot verdict PASS.

## Commit / PR

- Branch `m33-remove-transcripts` off `main`. Commit with the repo identity (`yovanmc <yovanmc@users.noreply.github.com>`); follow `AGENTS.md` (append `Co-authored-by: Codex <noreply@openai.com>` after a blank line if Codex generated substantive changes).
- PR → FOREGROUND `gh pr checks <PR#> --watch` (sleep ~20s first) → merge `--merge --delete-branch` from main → sync main.
- Flip the M33 row in `ROADMAP.md` to `✅ Merged` with the PR # + one-line summary; add a decision-log entry; commit + push.
