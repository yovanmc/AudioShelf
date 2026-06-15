# M35 — Real-Media Confidence (design)

> Design spec for the next AudioShelf milestone. Produced via the `/roadmap` brainstorming
> phase on 2026-06-15. Standalone milestone (the start of v9 — "real-world readiness"); **not**
> a multi-milestone arc. Follow-on milestones (embedded-metadata-at-scan, `.m4b`, more formats,
> packaging) are deliberately out of scope and decided later, only if real-file testing or the
> owner calls for them.

## Problem

Across all 34 shipped milestones, AudioShelf's audio pipeline has **only ever been exercised on
synthetic silent-WAV fixtures and non-decodable stub bytes** (`std::fs::write(path, b"x")`). A
real encoded audio file — mp3, m4a, mp4, flac, ogg — has never been scanned, never had its
duration or embedded art probed, and **never been played** in the app. The format support is
therefore *asserted* (an extension allowlist) but never *proven*, and several real-world failure
modes are unhandled:

- A corrupt / truncated / undecodable file **fails silently**: scan stores duration `0` with no
  signal, and playback simply never starts — no error, no message.
- Whether the WebView actually decodes real `.m4a` / `.flac` / `.ogg` files served over the Tauri
  asset protocol (correct MIME content-type, container sniffing) is **unverified**.
- Whether `lofty` returns correct durations and extracts embedded cover art from real encodings
  (vs. the silent WAVs) is **unverified**.

## Goal

Take the six owner-blessed formats — **mp3, m4a, mp4, flac, wav, ogg** — from "tested only on
silent-WAV stubs" to **"proven on real encoded files in CI, with honest failure when a file
can't be played."** The genuine value is twofold: (1) a durable CI gate that real formats work,
and (2) discovering and fixing whatever actually breaks the first time real audio runs through the
scan + playback pipeline.

### Non-goals (explicitly out of scope)

- **No new formats beyond the six.** `.m4b` was considered and declined by the owner; the
  allowlist (`mp3/m4a/aac/mp4/opus/ogg/flac/wav`) is left unchanged. WMA/ALAC/AC3/AMR (which
  Chromium physically cannot decode) are out — no Rust-side decoder/transcoder.
- **No new audio engine / dep.** Playback stays WebView-native HTML5 `<audio>`; metadata stays
  `lofty`; thumbnails stay `image`; fixture WAVs stay `hound`. No `symphonia`, no `ffmpeg`
  runtime dep.
- **No embedded-metadata-at-scan.** Title/artist stay manual (M21 decision); M16's opt-in
  "Import metadata" flow already covers embedded-tag import on demand and is not rebuilt here.
  Scan continues to read only **duration** (+ cover art on demand).
- **No schema change.** `db::LATEST` stays **13**.

## Current-state facts (verified)

- Scan allowlist: `const AUDIO_EXTS = ["mp3","m4a","aac","mp4","opus","ogg","flac","wav"]`
  (`src-tauri/src/scan.rs:15`); unknown extensions silently skipped.
- Duration probe: `lofty 0.21` `read_from_path(...).properties().duration()` →
  `probe_duration_secs` (`src-tauri/src/scan.rs:43`); on error returns `0`.
- Cover art: `lofty` first embedded picture → `image 0.25` decode → PNG thumbnail ≤ max px
  (`src-tauri/src/covers.rs:27`); `None` on any decode failure.
- Playback: native `<audio>` (`src/App.tsx:3431`), `audio.src = fileUrl(path)` via
  `convertFileSrc` over the Tauri asset protocol (`src/lib/api.ts:341`). **No `onError`
  handler.** MIME inferred by the WebView from the file extension.
- Scan errors: M30 already captures per-file `ScanError{path,reason}` (never aborts) and shows a
  scan-diff summary in `ScanView`. A file that probes to duration `0` **without erroring** is
  *not* flagged today.
- Fixtures: default 43/44/47 silent WAVs via `tools/gen-fixture` (`hound`); format unit tests in
  `scan.rs` write non-decodable stub bytes, so no real codec is exercised anywhere.

## Design

Four deliverables. Most of the diff is test media + tests; one small new FE feature; targeted
fixes only where the real-file pass exposes a real defect.

### 1. Real sample fixtures + scan integration test (the bulk)

Add a small, **separate** test-only fixtures directory (NOT the generated 43/44/47 default
fixture, which stays byte-identical) holding tiny (< ~50 KB each) **real encoded** clips:

- one per format that has a distinct codec/container worth proving: `mp3`, `m4a` (or `mp4`),
  `flac`, `ogg`, and a real (non-silent or differently-encoded) `wav`;
- one file carrying a real **embedded cover picture**;
- one deliberately **corrupt / truncated** file (valid extension, invalid payload).

New Rust **integration test** scanning this dir asserts: each real file is detected and stored;
each probes a **nonzero** duration; the format string is stored; the art-bearing file yields a
non-`None` thumbnail through `covers.rs`; the corrupt file is **ingested with duration 0** (so it
stays browsable and playback fails honestly) — `probe_duration_secs` swallows the `lofty` error
and returns 0 rather than emitting a `ScanError`, so the corrupt file surfaces via the new
unknown-duration count (deliverable 4), and scan completes with no panic and other files still
ingested. (A truly IO-unreadable file still becomes an M30 `ScanError`.)

> **Execution risk (resolved in planning, not here):** producing real encoded samples in-env may
> require `ffmpeg` or sourcing tiny known-good public-domain clips. The sourcing method is a
> planning detail; the design decision (commit real samples) stands. Samples must be license-clean
> and tiny.

### 2. Playback error state (the one new feature — FE only)

Wire an `onError` handler on the `<audio>` element → an App-level `playbackError` state →
render an honest inline message in the PlayerBar / Now-Playing: **"This file couldn't be
played"**, naming the chapter title. Cleared automatically on the next successful chapter load
(`onLoadedMetadata` / successful `play`). The chapter remains fully browsable — only playback
surfaces the error. Implementation stays prop-driven (views pure), unit-tested, using existing
M12 design tokens (reuse the established error/muted token palette; no new color).

### 3. Real-file robustness fixes — only what the first real-file pass reveals

Run the six real formats through scan + playback and fix **actual** defects found. Anticipated
candidates (fix only if broken, not speculatively):

- **Asset-protocol MIME**: confirm the WebView serves `.m4a/.mp4/.flac/.ogg` with a content-type
  that decodes; add an explicit extension→MIME mapping only if a format fails to play.
- **Duration trust**: if `lofty`'s stored duration diverges from the real `<audio>.duration`
  (e.g. VBR mp3), prefer the live `<audio>.duration` for scrubber/time-left/percent math once
  loaded — only if a real divergence is observed.

### 4. Scan-diff: surface unknown-duration files (minor)

Alongside M30's existing per-file scan errors, surface a count of files ingested with an
**unknown (0 s) duration** in the scan-diff summary, so silently-degraded files are visible
rather than lost. Additive to the existing `ScanResult` summary; no schema change.

## Verification

- **CI gate:** the new Rust integration test (real samples scan correctly; corrupt file → error,
  no crash) runs in `cargo test` on `build-and-test`.
- **FE:** unit tests for the playback-error state (error shown on `onError`, cleared on next
  load) added to the vitest suite (count must not drop).
- **Screenshot walkthrough:** new `m35` walkthrough — plays a real short clip (capture shows
  progress advancing) and triggers the corrupt-file error state — captured against a **frozen**
  `cargo tauri build --debug`, viewed by a **Sonnet subagent returning a text verdict** (PNGs
  never loaded into the controller). Regression pass on `m12`/`m24` unchanged.

## Invariants (hard gates)

- **No new code dependency** — `lofty`/`image`/`hound` already present; the only additions are
  binary **test fixtures** (not a Cargo/npm dep). `Cargo.*` / `package*.json` diff-stat EMPTY.
- **Read-only-on-disk** — no new `std::fs` write path to the library; all writes remain SQLite /
  app-private thumbnails (no change here).
- **Default fixtures 43/44/47 unchanged** — `tools/gen-fixture` and `fixture_scan.rs` untouched;
  real samples live in a separate test-only dir.
- **No schema change** — `db::LATEST` stays **13**.
- **Dark-first M12 design system** — error state reuses existing tokens; no new color.

## Sizing (honest)

A single, modest milestone. The diff is dominated by **test fixtures + integration/unit tests**,
plus one small FE feature (the playback error state), plus targeted fixes for whatever the first
real-file pass surfaces — which is the real point, since real encoded audio has never run through
the pipeline. Not a multi-milestone version; follow-on work (m4b, more formats, embedded metadata
at scan, packaging) is deferred and decided later.
