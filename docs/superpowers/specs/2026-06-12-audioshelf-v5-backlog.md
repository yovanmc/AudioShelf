# AudioShelf — v5 Backlog & Provisional Plan (2026-06-12)

> **⚠️ PROVISIONAL — refine & validate before implementing.** This is a forward-looking idea
> bank synthesized from an intensive five-lens subagent UX review (senior power-user,
> accessibility specialist, engagement/insight designer, library-intelligence designer,
> spoken-audio domain specialist) over the post-M12 UI. It is **one version above the current
> work**: v4 (M13–M15) must ship first, and v4 may change what v5 should contain. Re-validate
> scope, ordering, and the schema decisions below at the start of v5 (and re-confirm each
> milestone just-in-time via the normal Opus planning phase). Nothing here is committed.

## Framing & cross-cutting decisions

- **v5 deliberately ends the M8→M12 "no-migration" streak.** The highest-conviction bets (the
  Listening Journal, Library Intelligence) require the app's **first schema migrations**. Sibling
  projects have a crash-safe migration pattern to reuse (MangaReader: FK-off table-rebuild,
  versioned runner). This is a conscious line for a "major" version — validate it's wanted before
  starting.
- **Read-only-on-disk is preserved.** All new writes stay in local SQLite (+ the existing opt-in
  Rename tool). Metadata ingestion only **reads** embedded file tags; it never writes audio files.
- **Non-goals still hold:** no playback queue / Up-Next, no autoplay/continuous play, no
  playback-speed control, no social/sharing. Two ideas brush these and are **parked for an explicit
  product decision** (see end).
- **Convergence = signal.** Where 3+ independent lenses landed on the same idea, it's weighted up:
  tag taxonomy (power-user + intelligence); stats/heatmap/year-in-review (power-user + engagement +
  domain); transcripts/search-within-audio (a11y + intelligence + domain); "What fits?" duration
  suggestions (power-user + domain); dormancy/"forgotten" works (intelligence + engagement + domain);
  media-key/SMTC (a11y, but universally expected).

---

## Proposed v5 milestones (provisional grouping & order)

> Order is a proposal; the foundation milestones (intelligence, journal) are sequenced first
> because later milestones (insight, rituals) consume their data. **Validate the order at v5 start.**

### M16 — Library Intelligence *(foundation; introduces the first schema migrations)*
Turn the flat local library into something smarter to explore. Mostly local heuristics over data
that already exists; a Rename-tool-style **diff-preview-before-apply** is the UX pattern for
anything that mutates metadata.
- **Embedded-metadata ingestion** — read ID3/Vorbis at scan (album→series, track→order, genre→tags,
  narrator); diff-preview before committing; read-only on disk. *(L; schema: `metadata_source`
  enum on works/chapters)*
- **Series / reading-order detection** — heuristic group "Cool Story 1/2/3" into an ordered spine
  (the Rename tool already parses numeric suffixes); series view on creator detail; "continue a
  series." *(M; schema: `series` + `work_series_membership`)*
- **Tag taxonomy management** — rename / merge / alias tags, usage counts; optional parent→child
  hierarchy; Discover resolves aliases transparently. *(M; schema: `tag_aliases`, optional
  `parent_tag_id`)*
- **Auto-tag suggestions** — candidate tags from folder/filename tokens + your existing vocabulary
  ("you've used 'mystery' on 8 others — add here?"). *(S–M; no schema)*
- **"More like this" within-library graph** — related works by shared tags/creator/series at a
  work's context (sharpens Discover's "For You" to a single work). *(M; no schema, optional cache)*
- **Calmer Discover with visible reasoning** — show *why* a card surfaced ("because you finished
  Cool Story, tagged cozy"). *(S; no schema)*
- **Dormancy / "Forgotten" surfacing** — started-but-untouched 30+ days, sorted by how far through;
  Home shelf + optional row badge. *(S; no schema — converged across 3 lenses)*
- **Transcripts / search-within-audio** — auto-discover sidecar `.srt`/`.vtt` next to audio; index
  for full-text search; (also ties to Journal notes). *(M–L; schema: transcript/notes store)*

### M17 — The Listening Journal *(signature; schema)*
The thing a music player could never justify: a private, local, searchable record built from
spoken-audio's natural unit, the chapter. Unify into one browsable/searchable/**exportable** surface.
- **Timestamped chapter notes** (annotate a passage mid-listen). *(schema: `chapter_notes`)*
- **Positional bookmarks** with optional labels + scrubber markers + "jump to bookmark." *(schema:
  `chapter_bookmarks` — note: introduces in-chapter position storage, distinct from the
  played/unplayed model)*
- **Per-chapter user summary** (searchable — strong for lectures/nonfiction). *(schema:
  `chapters.user_summary`)*
- **Post-chapter takeaway** — optional one-line reflection at the natural chapter-end pause,
  Escape-dismiss. *(schema: `chapter_log`)*
- **Per-work "where I left off"** re-entry note, surfaced on Home's "Keep listening" card. *(schema:
  `works.re_entry_note`)*
- **Work-completion ritual** — "you finished X; this creator has N more"; optional one-word rating
  ("moving", "dense"). *(small schema)*
- **"Listen again" favorites** at chapter grain (distinct from played; a Favorites shelf). *(schema:
  `chapters.is_favorite`)*

### M18 — Insight & "Your Year in Listening" *(mostly visualization)*
Make the invisible listening biography visible — self-knowledge, not gamification (no pressure
mechanics; "streak" framed as "days in a row" or dropped).
- **Listening heatmap** (GitHub-style 52-week grid). 
- **Trends** — this-month-vs-last, time-of-day patterns, busiest periods.
- **Per-creator / per-tag breakdowns** — completed vs unplayed by tag ("14 mysteries owned, 2
  finished"). 
- **Listening rhythm** — chapters/week, gentle.
- **Annual "Year in Listening" recap** — exportable PNG snapshot.
- *(Builds on `play_events` + Journal; minimal/no new schema.)*

### M19 — Power & Scale *(heavy-library curation)*
- **Command palette (Ctrl+K)** — jump to any creator/work/chapter, play, or tag from anywhere. *(M)*
- **Advanced/scoped search** — `tag:cozy duration:<15m status:unplayed`, saved searches. *(M)*
- **Multi-select + bulk tag/group operations**. *(M)*
- **Saved smart filters / dynamic collections** (the proven MangaReader pattern, for audio). *(M;
  schema: `smart_collections`)*
- **Library density toggle** (compact/comfortable/spacious). *(S)*
- **Per-work chapter sort override** (non-destructive; Rename stays the disk path). *(S; small schema)*
- **SQLite metadata export/import** — back up/restore tags + progress + stats (years of curation
  the filesystem doesn't hold). *(M)*
- **Library health scan** — orphans, 0-byte/unreadable chapters, schema drift; triageable list. *(M)*

### M20 — Accessibility & Platform Integration *(many are curb-cuts that help everyone)*
- **Full keyboard operability** + visible focus rings + skip-to-content. *(M)*
- **Screen-reader semantics** — tree/listbox roles for creator→work→chapter; `aria-live` player. *(M)*
- **Windows media-key / SMTC integration** — lock-screen card, Bluetooth/headset buttons, media
  keys (the #1 expectation for a Windows audio player). *(L; Rust side)*
- **Light / high-contrast mode** — `forced-colors` first (cheap on the M12 token layer), full light
  theme later. *Revisits the deliberately-dropped light/dark toggle, reframed as accessibility.*
- **Reduced-motion** (`prefers-reduced-motion`). *(S)*
- **Color-blind-safe palette + icon-augmented status pills.** *(S)*
- **Dyslexia-friendly font option + text-size control.** *(S)*
- **RTL / i18n readiness** (CSS logical properties; `dir="auto"` on names). *(M)*
- **Focus / mini-player widget** — a small always-on-top Now-Playing window. *(M)*

### M21 — Spoken-Audio Rituals *(domain-native, calm)*
- **"What fits?"** — "I have 15 minutes" → a fitting unplayed chapter (zero schema; converged). *(S)*
- **Wind-down / bedtime mode** — gentle volume fade at chapter end + optional evening "ready for
  tonight's chapter?" prompt (extends the sleep timer; no autoplay). *(S)*
- **Narrator / voice metadata + "more by this narrator"** filtering (pairs with M16 ingestion).
  *(M–L; schema: `chapters.narrator`)*
- **Gentle "haven't returned in N days" nudges** — a soft in-app cue, never a push notification. *(S)*

---

## Parked — needs an explicit product decision (NOT scheduled)

- **Listen-later lists / "queues of intent"** — manually-stepped want-to-listen lists (still no
  autoplay). The power-user lens loved it; it brushes the deliberate **no-queue** stance → product
  philosophy call.
- **Opt-in daily reminder notification** — an outbound signal; mild tension with the calm,
  non-nagging ethos even when fully opt-in and local.
- **Per-second mid-chapter resume** & **multi-root libraries** — still deferred. (Per-second resume
  becomes more attractive *if* M17 bookmarks land, since position storage would already exist — but
  it's still its own call.)

## Provenance

Synthesized from five parallel subagent reviews (2026-06-12) of the 13-shot `m12` screenshot
matrix, each with a distinct lens, explicitly excluding anything already on the v4 plan (M13–M15)
and respecting the design non-goals. Full lens reports are in the session transcript; this document
is the deduped, clustered synthesis.
