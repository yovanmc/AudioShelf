# AudioShelf v7 — Discovery & Curation Coherence (UX/UI backlog)

> **Produced 2026-06-14** by a five-lens UX/UI subagent review of the **live post-M25 build**
> (grounded in the current `.shots/m12` 15-shot + `.shots/m21` 5-shot + `.shots/m24` 7-shot +
> `.shots/m25` 3-shot screenshots and the FE/Rust source). This is the v7 analogue of the
> [v6 UX/UI backlog](2026-06-13-audioshelf-v6-ux-ui-backlog.md). v6 (M22 nav/IA → M23 clarity →
> M24 player → M25 visual polish) shipped and **fully absorbed** the original M26 "Power, Calm"
> residue, so v7 opens a fresh arc. Owner direction (standing since 2026-06-13): *"the next few
> versions [are] focused on user experience and UI exploration — the app should make sense, be easy
> to navigate, not be confusing, and be something people want to use."*

## The headline finding (owner-confirmed M26)

After 25 milestones the app has accreted **six overlapping ways to organize/label/find audio** —
free-form **tags** (author/work/chapter), **metadata** with *fixed* narrator/language/mood facets,
**series**, **smart collections**, **saved searches**, and **more-like-this** — plus **three
disconnected discovery surfaces** (Discover "pick a tag", Discover facet picker, Home "You may
like"/"For you") that don't share state. A user can't tell which system to reach for, and the
power features are buried. This was the single strongest cross-lens signal (flagged by the
curation, IA, and onboarding lenses).

**Owner decision (2026-06-14):** collapse this to **one simple, user-defined "Types & Labels"
system** that drives everything. Verbatim intent: *"if I type in 'talk show' in a configuration or
on an audio, that would be a new filter applicable [wherever] filters are offered. Same as the
search bar — if I type 'talk show' I expect that audio to appear in the list of everything else
that matches. I do want to keep collections and more-like-this, but I'd like simple metadata (that
we add through the UI) to drive all of this functionality. Let's make all of these systems make
sense, simply."* Refinement: *"Other than narrator and language, I imagine mood being a simple
type/tag just like everything else. One unified system — simple and straightforward."*

→ **M26 = the unified-labels foundation** (see the [M26 plan](../plans/2026-06-14-audioshelf-m26-unified-labels.md)).

## Proposed v7 arc (validate each at its turn)

| # | Title | Theme | Lead lens(es) | Likely cost |
|---|-------|-------|---------------|-------------|
| 26 | **Discovery & Curation Coherence** | Unify tags+metadata into one user-defined Types & Labels system driving search/filter/Discover/collections/more-like-this | curation + IA | additive schema v10, broad |
| 27 | **Reflection that Connects** | Make Journal & Insights actionable: clickable notes→play-from-here, Insights drill-downs, ratings/notes feed discovery, consistent back-nav | curation + IA | small query/maybe schema |
| 28 | **Visual Consistency II** | Systemic border-strength rule, secondary-text hierarchy, chip spacing rhythm, table/search legibility | visual | FE-only |
| 29 | **Player & Onboarding micro-polish** | Scrubber/drag feedback, chapter-end transitions, "Play next — [title]", post-scan next-steps CTA, collapsed-sidebar labels, Settings sub-nav | player + onboarding | FE-only |

Order = foundation-first (mirrors v5/v6): the labels system underpins everything, so it leads;
reflection and visual/player polish layer on top. M28/M29 are FE-only catch-alls and may merge.

## Consolidated findings (five lenses, ~50 items)

Severity: **H**igh / **M**ed / **L**ow. "→Mn" = the milestone that owns it.

### Curation, browsing-at-scale & reflection depth (CUR)
| ID | Sev | Finding | →M |
|----|-----|---------|----|
| CUR-1 | H | Six overlapping organizing systems (tags/metadata/series/collections/saved-searches/more-like-this), no mental model for which to use | 26 |
| CUR-3 | H | Three independent discovery paths (tags, metadata facets, For-You) share no state/history; picking a tag resets the facet pick | 26 |
| CUR-6 | M | Saved searches (Library strip) and Collections (separate view) are both scoped-query filters in two places — confusing dichotomy | 26 |
| CUR-7 | M | Author-detail "More like this" and Discover "For You" are two separate "what next?" gates | 26 |
| CUR-8 | L | Narrator/language/mood metadata only visible inside Author Detail; no Library-level "browse by mood" filter | 26 |
| CUR-9 | L | Chapter-level tagging duplicates work tagging with no scope guidance ("why tag a chapter?") | 26 |
| CUR-4 | M | Collections are hidden (Settings→Curation); no "save this search as a collection" CTA in results | 26 |
| CUR-2 | H | Journal note shows chapterTitle/position as plain text — no click-through to re-hear the moment | 27 |
| CUR-5 | M | Insights heatmap/trends are visual dead-ends — no "show me what I played that week" drill-down | 27 |
| CUR-10 | M | "Where I left off" notes + completion ratings (M17) don't feed Insights/Discover/Collections | 27 |

### Information architecture, navigation & discoverability (IA7)
| ID | Sev | Finding | →M |
|----|-----|---------|----|
| IA7-1 | H | Saved searches are undiscoverable until you've already run a scoped query; no entry point on Home/sidebar | 26 |
| IA7-2 | H | Scoped-search syntax (`tag:`/`duration:`/`narrator:`…) hides under a collapsed "Search tips" toggle | 26 |
| IA7-6 | M | "My listening" group bundles Journal+Insights (records) with Collections (a query interface) — conceptual mismatch | 26/27 |
| IA7-10 | L | Home "You may like" and Discover "For you" show similar recs with no stated difference | 26 |
| IA7-3 | H | Journal & Insights have no back-navigation (Collections/Author-detail do) — inconsistent | 27 |
| IA7-7 | L | No affordance on chapters that already have journal data (note/bookmark) — users won't look | 27 |
| IA7-9 | L | Ctrl+K palette is a flat Authors/Works/Chapters list — no section headers, tedious at scale | 27/29 |
| IA7-4 | M | Settings is one long 7-group page with no anchor/sub-nav; admin tools live below the fold | 29 |
| IA7-5 | M | Collapsed sidebar is icon-only; Journal/Insights/Collections glyphs are ambiguous (hover-only titles) | 29 |
| IA7-8 | L | Saved-search strip has no grouping/management view; overflows at scale | 26 |

### First-run onboarding & calm resonance (ON)
| ID | Sev | Finding | →M |
|----|-----|---------|----|
| ON-1 | H | Empty Home shows the full sidebar incl. Insights/Collections/Journal before any context exists | 29 |
| ON-8 | H | Scan completion shows stats but no "next steps" CTA (Browse / Home) — first-run energy dies | 29 |
| ON-7 | M | Scan progress lacks reassurance ("we're not touching your files, just reading") | 29 |
| ON-2/5 | M | Recommendation shelf headers ("From your library"/"Cozy picks") read flat, not curated/warm | 29 |
| ON-3 | M | Empty-home copy uses "creator → work → chapter" jargon | 29 |
| ON-4 | M | Settings first-run "fine-tune anything later" gives no hint of *what* to adjust | 29 |
| ON-6 | L | Discover "pick a tag" with no library indexed is empty-state debt | 26/29 |
| ON-9 | L | Settings forces scrolling on first run (a11y/density above library basics) | 29 |

### Core listening loop & player (PL7)
| ID | Sev | Finding | →M |
|----|-----|---------|----|
| PL7-1 | H | Scrubber thumb hidden at rest (hover-reveal) — looks non-interactive in the compact bar | 29 |
| PL7-2 | H | No real-time feedback while drag-scrubbing; no chapter-boundary/resume cues | 29 |
| PL7-7 | H | "Play next chapter →" omits the chapter title/number you're about to play | 29 |
| PL7-3 | M | Chapter-end action buttons swap with no transition — easy to miss the state change | 29 |
| PL7-4 | M | Speed control differs between compact (cycle) and expanded (segmented); weak active state | 29 |
| PL7-6 | M | Mute doesn't visibly zero the slider — perceived mismatch | 29 |
| PL7-8 | L | "End of chapter" sleep option doesn't preview remaining minutes | 29 |
| PL7-9 | M | No keyboard-shortcut hints in the player (space/arrows/speed) | 29 |
| PL7-5 | L | Mini player lacks ±15/30s skip (prev/next chapter only) | 29 |
| PL7-10 | L | Sleep countdown is low-prominence; no emphasis as it nears expiry | 29 |

### Visual design system & consistency (VIS7)
| ID | Sev | Finding | →M |
|----|-----|---------|----|
| VIS7-1 | H | Search input border uses near-invisible `--color-border` (#26364a) on dark surface | 28 |
| VIS7-2 | H | Data-table row dividers use weak `--color-border` — tables lose scannability | 28 |
| VIS7-10 | H | 12+ dividers still use weak `--color-border` after M25; need a border-strength context rule | 28 |
| VIS7-3 | M | Secondary-text opacity inconsistent (40–61%) across views | 28 |
| VIS7-4 | M | Icon/glyph sizing incoherent at grid scale (54% artwork glyph vs 20px button icons) | 28 |
| VIS7-5 | M | Chip-row gaps stutter (6px vs 8px) across saved-search/filter/default chips | 28 |
| VIS7-7 | M | `.dialog__context` too small relative to title; needs breathing room | 28 |
| VIS7-9 | M | Card hover-lift too subtle on dense grids | 28 |
| VIS7-6 | L | Author-avatar initials low-contrast on small badges | 28 |
| VIS7-8 | L | Expanded-player two-column gap excessive at mid widths | 28 |

## Invariants for all of v7
- **Read-only-on-disk** (Rename remains the sole sanctioned audio-file mutation; every other write is SQLite or a user-chosen export path).
- **No new dependency** unless a milestone explicitly justifies one (`Cargo.*`/`package*.json` diff-stat empty).
- **Fixtures held at 43/44/47** (all new state seeded at runtime in walkthroughs; `fixture_scan.rs` untouched).
- **Dark-first M12 design system**; light + high-contrast themes preserved.
- **Additive, crash-safe migrations only** on the M16 `run_step`/`user_version` runner (no FK-off table rebuilds; `SCHEMA_V1` untouched). M26 is the only v7 milestone expected to touch schema (v10); M27 may.
- **Non-goals unchanged:** no autoplay/up-next queue, no social features, no multi-root libraries (still deferred).

## Parked (still needs an explicit product decision)
- Listen-later "queues of intent" (brushes the no-queue non-goal).
- Opt-in daily reminder notification (outbound signal).
- Multi-root libraries.
