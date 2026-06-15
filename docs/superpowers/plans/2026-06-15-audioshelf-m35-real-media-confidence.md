# M35 — Real-Media Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Written for Sonnet execution; if something doesn't match the codebase as described, STOP and report rather than guess.** This plan was written against verified file:line shapes (2026-06-15); minor drift is possible.

**Goal:** Prove (and harden) that real encoded `mp3/m4a/mp4/flac/ogg/wav` files actually scan, probe a real duration, surface embedded art, and play in the app — with an honest inline error when a file can't be played — replacing today's silent-WAV-stub-only coverage.

**Architecture:** Additive only. Commit tiny real encoded sample files (generated once via the locally-available `ffmpeg`) into a new `src-tauri/tests/media/` dir; assert their scan behavior in a new Rust integration test; add a `ScanResult.unknownDuration` diagnostic; wire an HTML5 `<audio onError>` → an inline player error state; and add an `m35` screenshot walkthrough that points the running app at the real samples. No new code dependency, no schema change (`db::LATEST` stays 13), read-only-on-disk, default 43/44/47 fixture untouched.

**Tech Stack:** Tauri 2 · React 18 + TypeScript · rusqlite · `lofty 0.21` (metadata) · `image 0.25` (thumbnails) · `hound` (WAV fixtures) · `ffmpeg` (one-time sample generation, NOT a runtime dep) · vitest · `cargo test`.

**Conventions (from ROADMAP.md):** Cargo via `cmd /c "tools\dev-env.cmd cargo ..."` in the FOREGROUND. Frozen build = `npm run build` then `cargo tauri build --debug --no-bundle`, then `tools\verify.ps1 -Walkthrough <name> -SkipBuild`. Commit as `yovanmc <yovanmc@users.noreply.github.com>` (no `-c user.email` override). CI job `build-and-test` on windows-latest runs `npm test` + `cargo test --manifest-path src-tauri/Cargo.toml`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `tools/gen-media-samples.ps1` | One-time ffmpeg generator for the real sample clips (reproducibility doc) | Create |
| `src-tauri/tests/media/Real Formats/*.{mp3,m4a,mp4,flac,ogg,wav}` | Tiny (~2s) real encoded clips, one art-bearing, one corrupt | Create (binaries) |
| `src-tauri/tests/real_media.rs` | Integration test: real files scan w/ real duration, art extracts, corrupt ingests w/o crash | Create |
| `src-tauri/src/model.rs` | `ScanResult` gains `unknown_duration` | Modify |
| `src-tauri/src/scan.rs` | `finish_result` computes `unknown_duration` | Modify |
| `src-tauri/src/lib.rs` (testing module) | Re-export `read_embedded_picture` / `make_thumbnail_png` if not already test-reachable | Modify (if needed) |
| `src/lib/api.ts` | `ScanResult` TS type gains `unknownDuration?` | Modify |
| `src/views/ScanView.tsx` | Render unknown-duration count in scan-diff summary | Modify |
| `src/lib/playback.ts` | Pure `playbackErrorText(title)` helper | Modify |
| `src/lib/playback.test.ts` | Unit test for `playbackErrorText` | Modify/Create |
| `src/App.tsx` | `playbackError` state, `<audio onError>`, clear-on-load, m35 walkthrough branch | Modify |
| `src/player/PlayerBar.tsx` | Inline error message + new prop | Modify |
| `src/styles/components.css` | `.player-bar__error` class | Modify |
| `src/harness/walkthroughs.ts` | `m35Steps(...)` factory + `"m35"` in the walkthroughs array | Modify |
| `tools/verify.ps1` | For `-Walkthrough m35`, point `--library` at `src-tauri/tests/media` (skip gen-fixture) | Modify |

---

## Task 1: Generate & commit the real sample fixtures

**Files:**
- Create: `tools/gen-media-samples.ps1`
- Create: `src-tauri/tests/media/Real Formats/` (binary clips)

- [ ] **Step 1: Write the generator script**

Create `tools/gen-media-samples.ps1`:

```powershell
# Generates tiny (~2s) REAL encoded audio samples for M35 real-media tests.
# Requires ffmpeg on PATH. Run once; the produced files are committed to git.
# Output: src-tauri/tests/media/Real Formats/
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dir  = Join-Path $root "src-tauri\tests\media\Real Formats"
New-Item -ItemType Directory -Force $dir | Out-Null

function S($name, [string[]]$enc) {
  $out = Join-Path $dir $name
  & ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2" @enc $out 2>$null
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $name" }
}
S "Mp3 Sample - 01.mp3"  @("-c:a","libmp3lame","-b:a","64k")
S "M4a Sample - 01.m4a"  @("-c:a","aac","-b:a","64k")
S "Mp4 Sample - 01.mp4"  @("-c:a","aac","-b:a","64k")
S "Flac Sample - 01.flac" @("-c:a","flac")
S "Ogg Sample - 01.ogg"  @("-c:a","libvorbis","-q:a","2")
S "Wav Sample - 01.wav"  @("-c:a","pcm_s16le")

# Art-bearing MP3: embed a tiny cover (APIC)
$cover = Join-Path $env:TEMP "m35cover.png"
& ffmpeg -y -f lavfi -i "color=c=blue:s=80x80:d=0.1" -frames:v 1 $cover 2>$null
$artOut = Join-Path $dir "With Art - 01.mp3"
& ffmpeg -y -f lavfi -i "sine=frequency=330:duration=2" -i $cover `
  -map 0:a -map 1:v -c:a libmp3lame -b:a 64k -c:v mjpeg -id3v2_version 3 `
  -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" `
  -disposition:v attached_pic $artOut 2>$null
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for art mp3" }

# Corrupt file: valid extension, invalid payload
[System.IO.File]::WriteAllBytes((Join-Path $dir "Corrupt File - 01.mp3"),
  [byte[]](0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09))

Write-Host "Generated samples in $dir"
Get-ChildItem $dir | Select-Object Name, Length
```

- [ ] **Step 2: Run the generator and verify file sizes**

Run (PowerShell tool): `& "C:\Agent Projects\AudioShelf\tools\gen-media-samples.ps1"`

Expected: 8 files listed, each non-zero and small (each well under 50 KB; the corrupt one is 10 bytes). If any clip is missing or 0 bytes, STOP and report.

- [ ] **Step 3: Verify each real clip has a real duration with ffprobe**

Run: `ffprobe -v error -show_entries format=duration -of csv=p=0 "C:\Agent Projects\AudioShelf\src-tauri\tests\media\Real Formats\Mp3 Sample - 01.mp3"`
Expected: a value near `2.0`. Spot-check the m4a/flac/ogg/mp4 similarly. The corrupt file will error (expected).

- [ ] **Step 4: Commit**

```bash
git add tools/gen-media-samples.ps1 "src-tauri/tests/media/Real Formats"
git commit -m "test(M35): commit tiny real encoded audio samples + generator"
```

---

## Task 2: Integration test — real files scan with real durations + art

**Files:**
- Create: `src-tauri/tests/real_media.rs`
- Modify (only if the covers fns aren't reachable from an integration test): `src-tauri/src/lib.rs`

Background: integration tests reach the crate via `audioshelf_lib::...` (see `src-tauri/tests/fixture_scan.rs`: `use audioshelf_lib::testing::{open_in_memory, query_authors, scan_into};`). Scan entry: `pub fn scan_into(conn: &Connection, root: &Path) -> rusqlite::Result<ScanResult>`. The `chapters` table has `format TEXT`, `duration_secs INTEGER`, `status TEXT` ('active'). Covers API: `covers::read_embedded_picture(&Path) -> Option<Vec<u8>>` and `covers::make_thumbnail_png(&[u8], u32) -> Option<Vec<u8>>`.

- [ ] **Step 1: Ensure the covers fns are reachable from integration tests**

Check `src-tauri/src/lib.rs` for the `testing` module re-exports. If `read_embedded_picture` and `make_thumbnail_png` are NOT already exported (via `pub mod covers` or a `pub use` in `testing`), add to the existing `pub mod testing { ... }` block:

```rust
pub use crate::covers::{make_thumbnail_png, read_embedded_picture};
```

If `covers` is already `pub` (i.e. `audioshelf_lib::covers::read_embedded_picture` resolves), skip this step and use that path in the test.

- [ ] **Step 2: Write the failing integration test**

Create `src-tauri/tests/real_media.rs`:

```rust
//! M35: prove real encoded audio files (not silent-WAV stubs) scan correctly.
use audioshelf_lib::testing::{make_thumbnail_png, open_in_memory, read_embedded_picture, scan_into};
use std::path::PathBuf;

fn media_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("media")
}

#[test]
fn real_encoded_formats_scan_with_nonzero_duration() {
    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, &media_root()).unwrap();
    // 7 real playable clips + 1 corrupt = 8 audio files ingested as chapters.
    assert!(report.chapters >= 8, "expected >=8 chapters, got {}", report.chapters);

    for fmt in ["mp3", "m4a", "mp4", "flac", "ogg", "wav"] {
        let dur: i64 = conn
            .query_row(
                "SELECT MAX(duration_secs) FROM chapters WHERE format = ?1 AND status = 'active'",
                [fmt],
                |r| r.get(0),
            )
            .unwrap_or(0);
        assert!(dur >= 1, "format {fmt} should probe a real duration, got {dur}");
    }
}

#[test]
fn corrupt_file_is_ingested_without_crashing() {
    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, &media_root()).unwrap();
    // Corrupt-but-readable file: lofty fails -> duration 0, no panic, scan completes.
    let zero: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE duration_secs = 0 AND status = 'active'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(zero >= 1, "corrupt file should be ingested with duration 0");
    assert!(!report.cancelled);
}

#[test]
fn embedded_cover_art_extracts_and_thumbnails() {
    let art = media_root().join("Real Formats").join("With Art - 01.mp3");
    let bytes = read_embedded_picture(&art).expect("embedded picture should be present");
    assert!(!bytes.is_empty(), "picture bytes should be non-empty");
    let thumb = make_thumbnail_png(&bytes, 256).expect("thumbnail should encode");
    assert!(!thumb.is_empty());
}
```

- [ ] **Step 3: Run the test to verify it fails (or surfaces real behavior)**

Run: `cmd /c "C:\Agent Projects\AudioShelf\tools\dev-env.cmd cargo test --manifest-path C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml --test real_media"`

Expected on first run: PASS if Task 1 produced valid files and `lofty` parses them. If a format's duration is 0, STOP and report — that means the sample is malformed or `lofty` can't parse it (re-check Task 1 output for that format). If the test can't find the covers fns, revisit Step 1.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/real_media.rs src-tauri/src/lib.rs
git commit -m "test(M35): integration test proving real formats scan + art extracts"
```

---

## Task 3: Surface unknown-duration files in the scan-diff

**Files:**
- Modify: `src-tauri/src/model.rs:5-19` (`ScanResult`)
- Modify: `src-tauri/src/scan.rs:349-369` (`finish_result`)
- Modify: `src/lib/api.ts:5-15` (`ScanResult` TS type)
- Modify: `src/views/ScanView.tsx:37`

- [ ] **Step 1: Add the field to the Rust struct**

In `src-tauri/src/model.rs`, add to `ScanResult` (after `skipped`):

```rust
    #[serde(default)]
    pub unknown_duration: usize,
```

- [ ] **Step 2: Compute it in `finish_result`**

In `src-tauri/src/scan.rs`, inside `finish_result`'s returned `ScanResult { ... }`, add (after `skipped,`):

```rust
        unknown_duration: conn
            .query_row(
                "SELECT COUNT(*) FROM chapters WHERE duration_secs = 0 AND status = 'active'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0),
```

- [ ] **Step 3: Add a Rust assertion (extend the M35 integration test)**

Append to `src-tauri/tests/real_media.rs`:

```rust
#[test]
fn scan_result_reports_unknown_duration_count() {
    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, &media_root()).unwrap();
    assert!(report.unknown_duration >= 1, "corrupt file should count as unknown-duration");
}
```

- [ ] **Step 4: Run Rust tests**

Run: `cmd /c "C:\Agent Projects\AudioShelf\tools\dev-env.cmd cargo test --manifest-path C:\Agent Projects\AudioShelf\src-tauri\Cargo.toml"`
Expected: all green (the new assertion + the prior suite unchanged). `model.rs` `ScanResult` `PartialEq`/`Default` derives still hold (the new field is `usize`, defaults to 0).

- [ ] **Step 5: Add the TS field**

In `src/lib/api.ts`, add to the `ScanResult` interface (after `skipped?`):

```typescript
  unknownDuration?: number;
```

- [ ] **Step 6: Render it in ScanView**

In `src/views/ScanView.tsx`, replace the final-summary line (currently around line 37):

```typescript
<p className="muted scan-diff">{added} added · {updated} updated · {removed} removed · {skipped} unchanged</p>
```

with:

```typescript
<p className="muted scan-diff">
  {added} added · {updated} updated · {removed} removed · {skipped} unchanged
  {(unknownDuration ?? 0) > 0 ? ` · ${unknownDuration} unknown length` : ""}
</p>
```

Ensure `unknownDuration` is destructured from the same scan-result object the other counts come from (mirror how `skipped` is read in that component).

- [ ] **Step 7: Run FE tests + tsc**

Run: `npm test` then `npx tsc --noEmit` (cwd `C:\Agent Projects\AudioShelf`).
Expected: green; vitest count must not drop. If a ScanView test asserts the exact summary string, update it to include the new optional segment (only shown when > 0).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/scan.rs src-tauri/tests/real_media.rs src/lib/api.ts src/views/ScanView.tsx
git commit -m "feat(M35): report unknown-duration (0s) files in scan-diff summary"
```

---

## Task 4: Honest playback error state

**Files:**
- Modify: `src/lib/playback.ts`
- Modify/Create: `src/lib/playback.test.ts`
- Modify: `src/App.tsx` (state ~240-268, `playChapter` ~924-935, `<audio>` ~3431-3468, PlayerBar render ~3400-3423)
- Modify: `src/player/PlayerBar.tsx`
- Modify: `src/styles/components.css`

- [ ] **Step 1: Write the failing helper test**

In `src/lib/playback.test.ts` (create if absent; follow existing vitest style — `import { describe, it, expect } from "vitest";`), add:

```typescript
import { playbackErrorText } from "./playback";

describe("playbackErrorText", () => {
  it("names the chapter that couldn't be played", () => {
    expect(playbackErrorText("Chapter One")).toBe("“Chapter One” couldn’t be played");
  });
  it("falls back when no title", () => {
    expect(playbackErrorText("")).toBe("This file couldn’t be played");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- playback`
Expected: FAIL — `playbackErrorText` is not exported.

- [ ] **Step 3: Implement the pure helper**

In `src/lib/playback.ts`, add (near `formatTimeLeft`/`timeLabel`):

```typescript
/** Honest, user-facing message when an audio file can't be decoded/played. */
export function playbackErrorText(title: string): string {
  const t = title.trim();
  return t ? `“${t}” couldn’t be played` : "This file couldn’t be played";
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- playback`
Expected: PASS.

- [ ] **Step 5: Add the App-level error state**

In `src/App.tsx`, with the other playback `useState`s (~line 240-268), add:

```typescript
const [playbackError, setPlaybackError] = useState<string | null>(null);
```

Add the import for the helper at the top alongside other `playback` imports:

```typescript
import { playbackErrorText } from "./lib/playback";
```

(If `playback` helpers are already imported, add `playbackErrorText` to that existing import list instead of a new line.)

- [ ] **Step 6: Clear the error when a new chapter loads**

In `playChapter` (~line 924), set `setPlaybackError(null)` right after `setCurrent(context);`:

```typescript
function playChapter(context: PlaybackContext) {
  setCurrent(context);
  setPlaybackError(null);
  const audio = audioRef.current;
  // ...unchanged...
}
```

Also clear on successful metadata load — in the `<audio onLoadedMetadata>` handler, add `setPlaybackError(null);` as the first line of the handler body.

- [ ] **Step 7: Set the error on the `<audio onError>` event**

In the `<audio ...>` element (~line 3431), add an `onError` handler:

```typescript
  onError={() => {
    const cur = currentRef.current;
    setIsPlaying(false);
    setPlaybackError(playbackErrorText(cur?.chapter.title ?? ""));
  }}
```

- [ ] **Step 8: Pass the error to PlayerBar**

Where `<PlayerBar ... />` is rendered (~line 3400-3423), add the prop:

```typescript
  playbackError={playbackError}
```

- [ ] **Step 9: Render the message in PlayerBar**

In `src/player/PlayerBar.tsx`: add `playbackError?: string | null;` to the component's Props interface (mirror the existing optional props). Then, inside the now-playing region (after the chapter-position line, ~line 77), render:

```typescript
{props.playbackError ? (
  <div className="player-bar__error" role="alert">{props.playbackError}</div>
) : null}
```

(Use `props.playbackError` or destructure it consistently with how the component reads its other props.)

- [ ] **Step 10: Style it (reuse the danger token)**

In `src/styles/components.css`, add:

```css
.player-bar__error { color: var(--color-danger); font-size: 0.85rem; margin-top: 2px; }
```

- [ ] **Step 11: Run tsc + FE tests**

Run: `npx tsc --noEmit` then `npm test`.
Expected: green; vitest count must not drop (the 2 new helper tests added).

- [ ] **Step 12: Commit**

```bash
git add src/lib/playback.ts src/lib/playback.test.ts src/App.tsx src/player/PlayerBar.tsx src/styles/components.css
git commit -m "feat(M35): honest inline player error when a file can't be played"
```

---

## Task 5: `m35` walkthrough — real-format playback + error state (visual proof)

**Files:**
- Modify: `tools/verify.ps1` (~line 17, ~line 34)
- Modify: `src/harness/walkthroughs.ts`
- Modify: `src/App.tsx` (harness dispatch ~line 1128)

Background: `verify.ps1` generates `.fixture` via gen-fixture and launches `audioshelf.exe --library "$fixture" --autostart --walkthrough $Walkthrough --shots ... --done-signal ... --exit-when-done`. The app scans `--library` then dispatches on `args.walkthrough`. For m35 we point `--library` at the committed real samples instead of the WAV fixture.

- [ ] **Step 1: Point the m35 walkthrough at the real samples**

In `tools/verify.ps1`, after `$fixture` is defined (~line 17, `$fixture = Join-Path $root ".fixture"`), add:

```powershell
$useRealMedia = ($Walkthrough -eq "m35")
if ($useRealMedia) { $fixture = Join-Path $root "src-tauri\tests\media" }
```

Then guard the gen-fixture call (~line 34) so it's skipped for m35:

```powershell
if (-not $useRealMedia) {
  cmd /c "`"$devenv`" cargo run --quiet --manifest-path `"$root\tools\gen-fixture\Cargo.toml`" -- `"$fixture`""
}
```

(The `--library "$fixture"` launch line is unchanged — it now receives the real-media dir for m35.)

- [ ] **Step 2: Add the `m35Steps` factory**

In `src/harness/walkthroughs.ts`, add (mirroring `playerSteps`):

```typescript
export function m35Steps(nav: {
  openFirstAuthor: () => Promise<void>;
  playRealChapter: () => Promise<void>;
  playCorruptChapter: () => Promise<void>;
}): Step[] {
  return [
    { name: "author-detail", run: nav.openFirstAuthor },
    { name: "real-format-playing", run: nav.playRealChapter },
    { name: "playback-error", run: nav.playCorruptChapter },
  ];
}
```

- [ ] **Step 3: Register `"m35"` in the walkthroughs array**

In `src/harness/walkthroughs.ts`, append `"m35"` to the `walkthroughs` const array (after `"m34"`).

- [ ] **Step 4: Dispatch m35 in the App harness branch**

In `src/App.tsx` (~line 1128, the `if (args.autostart && args.walkthrough)` chain), add an `args.walkthrough === "m35"` arm. Define the nav callbacks using existing helpers (`getAuthors`, `getAuthorDetail`, `playChapter`). Pattern:

```typescript
: args.walkthrough === "m35"
  ? m35Steps({
      openFirstAuthor: async () => {
        const list = await getAuthors();
        const a = list[0];
        if (a) { const d = await getAuthorDetail(a.id); openAuthorFromDetail(d); }
      },
      playRealChapter: async () => {
        const list = await getAuthors();
        const d = await getAuthorDetail(list[0].id);
        // first chapter whose file is a real (non-corrupt) format
        for (const w of d.works) for (const c of w.chapters) {
          if (!/Corrupt/i.test(c.title ?? "")) {
            playChapter(buildContext(d, w, c));
            await new Promise((r) => setTimeout(r, 1200)); // let it decode + advance
            return;
          }
        }
      },
      playCorruptChapter: async () => {
        const list = await getAuthors();
        const d = await getAuthorDetail(list[0].id);
        for (const w of d.works) for (const c of w.chapters) {
          if (/Corrupt/i.test(c.title ?? "")) {
            playChapter(buildContext(d, w, c));
            await new Promise((r) => setTimeout(r, 800)); // let onError fire
            return;
          }
        }
      },
    })
```

**Adapt to the real helpers in App.tsx:** use the SAME author-open and context-construction functions the existing `player`/`m24` walkthroughs use (e.g. how `playerSteps`' `playFirstChapter` builds a `PlaybackContext` and calls `playChapter`). If a `buildContext`/`openAuthorFromDetail` equivalent doesn't exist under those names, reuse whatever the neighboring walkthrough arms call — do NOT invent new app functions. If the existing arms construct the `PlaybackContext` inline, copy that exact construction here. STOP and report if you can't locate how an existing walkthrough plays a chapter.

- [ ] **Step 5: tsc + FE tests**

Run: `npx tsc --noEmit` then `npm test`.
Expected: green. If `runner.test.ts` or any test asserts the full `walkthroughs` list, add `"m35"` there too.

- [ ] **Step 6: Commit**

```bash
git add tools/verify.ps1 src/harness/walkthroughs.ts src/App.tsx
git commit -m "test(M35): m35 walkthrough plays real formats + shows error on corrupt file"
```

---

## Task 6: Frozen-build verification + invariant audit

**Files:** none (verification only), then ROADMAP update.

- [ ] **Step 1: Frozen build**

Run (FOREGROUND, large timeout):
```
cmd /c "C:\Agent Projects\AudioShelf\tools\dev-env.cmd npm run build"
cmd /c "C:\Agent Projects\AudioShelf\tools\dev-env.cmd cargo tauri build --debug --no-bundle"
```
Expected: `dist/` built; `src-tauri/target/debug/audioshelf.exe` produced. (Do NOT run `cargo test`/`tauri dev` between this and Step 2 — that re-overwrites the exe in dev mode and yields "localhost refused to connect".)

- [ ] **Step 2: Run the m35 walkthrough (frozen)**

Run: `powershell -File C:\Agent Projects\AudioShelf\tools\verify.ps1 -Walkthrough m35 -SkipBuild`
Expected: 3 shots in `.shots/m35/` — `01-author-detail.png`, `02-real-format-playing.png`, `03-playback-error.png`.

- [ ] **Step 3: Run regression walkthroughs (frozen)**

Run: `verify.ps1 -Walkthrough m24 -SkipBuild` and `verify.ps1 -Walkthrough m12 -SkipBuild`.
Expected: shots produced; these surfaces are untouched by M35.

- [ ] **Step 4: Subagent visual verdict (do NOT load PNGs into the controller)**

Dispatch ONE Sonnet subagent to Read the `.shots/m35/*.png` (+ spot-check `.shots/m24`, `.shots/m12`) and return a TEXT verdict against these criteria:
- `02-real-format-playing.png`: the player bar shows a real chapter playing with a **real duration** (e.g. ~0:02) and NO error message → real-format decode works.
- `03-playback-error.png`: the inline "…couldn't be played" error is visible on the player for the corrupt file.
- `01` + regression shots: layout intact, no visual regressions.
If `02` shows the error state instead of playing (a real format failed to decode in the WebView), that's a genuine MIME/serving defect — see Step 5.

- [ ] **Step 5: Real-format playback fix — ONLY if Step 4 found a decode failure**

If a real format shows the error instead of playing: the asset-protocol Content-Type is likely wrong for that extension. Investigate Tauri's asset-protocol MIME handling; the minimal fix is an explicit extension→MIME mapping for the failing format(s) when building the served response. Do NOT add this speculatively — only if Step 4 proves a format fails. Note: the player already trusts the live `<audio>.duration` (`onLoadedMetadata` → `setDuration`), so no duration-trust change is expected; skip unless a concrete library-label divergence is observed. If a fix is made, re-run Steps 1-4. Document any fix in the commit + ROADMAP note.

- [ ] **Step 6: Invariant audit (hard gates)**

Run and confirm:
```bash
git diff --stat main -- src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json
```
Expected: **EMPTY** (no new dependency — `ffmpeg` is a build-time tool, not a dep; the sample files are test fixtures). Also confirm:
- `git diff --stat main -- tools/gen-fixture src-tauri/tests/fixture_scan.rs` is EMPTY (default 43/44/47 fixture untouched).
- `db::LATEST` is still **13** (no schema change).
- No new `std::fs::write`/library-mutation path was added (read-only-on-disk; only writes remain SQLite + app-private thumbnails).

- [ ] **Step 7: Final full test gate**

Run: `npx tsc --noEmit` · `npm test` · `cmd /c "...dev-env.cmd cargo test --manifest-path ...src-tauri\Cargo.toml"`.
Expected: all green; vitest count ≥ baseline (new tests added, none dropped); cargo green incl. the 4 new `real_media` tests.

- [ ] **Step 8: Update ROADMAP.md → ✅ Merged (after PR merges)**

Open the M35 PR, FOREGROUND-watch `gh pr checks <PR#> --watch`, merge `--merge --delete-branch` from main, then flip the M35 row to ✅ Merged with the PR # and a one-line shipped summary, and append durable gotchas to the decision log. Commit + push (docs PR per convention). Ping the user.

---

## Self-Review

**Spec coverage:** (1) Real sample fixtures → Task 1. (2) Scan integration test (duration, art, corrupt) → Task 2. (3) Unknown-duration scan-diff → Task 3. (4) Playback error state → Task 4. (5) Real-file robustness fixes (MIME/duration, only-if-broken) → Task 5/6 Step 5. (6) m35 walkthrough + verification → Task 5/6. (7) Invariants audit → Task 6 Step 6. All spec sections mapped.

**Placeholder scan:** No "TBD/TODO". The two intentionally contingent items (real-format MIME fix; covers-fn re-export) are explicitly conditional with STOP-and-report guidance, not vague placeholders. Task 5 Step 4 adapts to existing App walkthrough helpers because those exact names couldn't be verified from the digest — flagged with a STOP instruction.

**Type consistency:** Rust field `unknown_duration: usize` ↔ serde `camelCase` → TS `unknownDuration?: number` ↔ ScanView `unknownDuration`. `playbackErrorText(title: string): string` used identically in test, App `onError`, and PlayerBar receives the resulting string via `playbackError` prop. `ScanResult`/`ScanError`/`PlaybackContext` names match the verified shapes.

**Known assumption (flagged):** Task 5 Step 4's `getAuthors`/`getAuthorDetail`/`playChapter`/context-construction must match the existing `player`/`m24` walkthrough arms; the executor is instructed to reuse those exact functions and STOP if they differ.
