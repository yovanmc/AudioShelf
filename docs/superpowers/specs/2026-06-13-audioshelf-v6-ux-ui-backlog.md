# AudioShelf v6 — UX/UI Backlog (actionable log)

> **Theme of v6:** *"The app should make sense, be easy to navigate, not be confusing,
> and be something people want to use."* (owner mandate, 2026-06-13). Where v5 added
> **depth and reach** (37 features over M16–M21), v6 turns inward: make the accumulated
> surface **coherent, calm, and obvious**. No new feature *areas* — the work is
> reorganizing, clarifying, polishing, and closing the few genuine experience gaps the
> feature-build left behind.
>
> **How this was produced:** a five-lens UX/UI subagent review of the **current post-M21
> build**, each lens grounded in the live `.shots/m12` (15-shot matrix) + `.shots/m21`
> (5-shot) screenshots and the FE source. Lenses: (1) Information architecture &
> navigation, (2) Visual design & consistency, (3) Core listening flow & player,
> (4) First-run, empty states & plain-language clarity, (5) Feature discoverability &
> cognitive load. ~55 raw findings → deduped into the items below.
>
> **Status:** PROVISIONAL idea-bank + proposed arc. Plan each milestone just-in-time;
> re-validate scope at each milestone's turn (the v5 pattern). Standing invariants still
> hold: **read-only-on-disk** (Rename is the sole sanctioned audio mutation; all other
> writes are SQLite/app-data), **no new dep unless a milestone explicitly justifies one**,
> **fixtures 43/44/47**, dark-first design system from M12. Non-goals unchanged
> (no autoplay/up-next queue, no social/sharing). v6 is mostly **FE-only**; only the
> player-loop milestone is likely to touch schema (per-second resume / persisted speed).

---

## Cross-lens signal (what multiple independent lenses agreed on)

The most reliable findings are the ones several lenses surfaced without coordination:

- **Navigation/IA overload — flagged by ALL FIVE lenses.** 9 flat sidebar items + Settings,
  no grouping; admin tools ("Rename", "Import tags") sit at the same visual weight as
  everyday browsing; "Import tags" is mislabeled; "Narrators" duplicates Discover's facet
  picker; Settings is an 8-section single-scroll wall. This is the consensus #1 problem and
  the most literal hit on the owner's mandate.
- **Hidden power — flagged by lenses 1 & 5.** The Ctrl+K command palette and the
  scoped-search DSL (`tag:`/`duration:`/`status:`/`narrator:`) have **zero in-UI affordance**;
  multi-select/bulk-tag has no discoverable entry point.
- **Plain-language / first-run clarity — flagged by lenses 1, 4 & 5.** Jargon ("canonical",
  "scoped query", "facets", "Metadata vocabulary"); developer-grade empty states
  ("Personalized picks — needs listening history"); the doubled welcome CTA; zeroed stat
  cards on first run that read as "broken".
- **Player is the most developer-grade surface — flagged by lenses 2 & 3.** Native `<select>`
  controls, a raw "CAPTURE" label, avatar/title collision, a "−0:00" timestamp bug, thin
  scrubber; plus the **no-speed-control** functional gap and the **chapter-end dead-end**.
- **Cover-art placeholders are flat color blocks — lens 2's single biggest visual drag**,
  echoed by lens 1/4 (cards read as "nothing loaded").

---

## Proposed v6 arc (foundation-first, owner to validate)

| M | Title | Theme | Why here | Schema? |
|---|-------|-------|----------|---------|
| **M22** | **Navigation & IA Coherence** | Lens 1 (+5) | **Foundation.** Every other milestone lives inside the nav/IA this fixes. Most-flagged, most literal hit on the mandate. Moving Rename/Import-tags, merging Narrators→Discover, sectioning Settings, and adding command-palette/DSL affordances all relocate or reframe things later milestones touch — do it first so they build on the new structure. | No |
| **M23** | **Clarity & Onboarding** | Lens 4 (+5) | Once the structure is right, fix the *words* and the *first five minutes*: first-run flow, empty states, plain-language copy sweep, dialog titles/context, jargon → human labels. Cheap, FE-only, high day-one leverage. | No |
| **M24** | **The Listening Loop & Player** | Lens 3 | The core daily experience and the only milestone with real feature gaps: **playback speed**, **chapter-end "what next"**, Start-vs-Keep labels, scannable chapter states, faster path-to-play, sleep-timer countdown, mute. The one milestone that likely needs **schema** (persisted speed; optionally revisit per-second resume — a parked item that now has M17 plumbing). | Likely |
| **M25** | **Visual Polish & Design-System Consistency** | Lens 2 | With IA/copy/loop settled, do the cosmetic pass last so it re-skins the *final* structure in one sweep (the M12 "design system built last" logic): cover-art placeholders, accent-color discipline, chip/pill legibility, heading/eyebrow consistency, replace native selects, card-header redesign. | No |
| **M26** *(optional)* | **Power, Calm** | Lens 5 | Tie off discoverability of advanced features without clutter: progressive disclosure of bulk-select/curation, the tags-vs-metadata-vs-collections distinction, in-context microcopy/tooltips, optional first-use tips. Some of this folds into M22/M23; keep as a catch-all only if residue remains. | No |

> Ordering rationale mirrors v5/M12: **structure → words → core experience → polish.**
> The owner may reorder (e.g. lead with the Player loop if the daily experience matters most,
> or lead with Visual polish for an immediate "wow"). Validate at M22 start.

---

## M22 — Navigation & IA Coherence  *(recommended first)*

**Goal:** a casual listener can look at the app for five seconds and understand where to
listen, where to reflect, and where to manage — and never trips over a tool they don't need.

- **IA-1 (High) — Demote admin tools out of primary nav.** "Rename" and "Import tags" are
  once-in-a-while maintenance ops sitting at equal weight to Home/Library. Move both into a
  **Settings → "Library tools"** area (or a single "Manage" group). *Files:* `AppShell.tsx`,
  `App.tsx` routing, `SettingsView.tsx`.
- **IA-2 (High) — Fix the "Import tags" mislabel.** The nav slot opens a metadata-vocabulary /
  tag manager, not an importer. Rename to match its in-app heading and function; separate the
  one-shot "import from file metadata" action (M16 `MetadataView`) from the persistent
  vocabulary manager (`MetadataManagerView`). *Files:* `AppShell.tsx`, `MetadataView.tsx`,
  `MetadataManagerView.tsx`.
- **IA-3 (High) — Group the sidebar.** Introduce 2–3 labelled/divided groups, e.g.
  **Browse** (Home, Library, Discover), **My listening** (Journal, Insights, Collections),
  **Manage** (in Settings). Works in both expanded and collapsed states. *Files:*
  `AppShell.tsx`, `layout.css`.
- **IA-4 (High/Med) — Merge "Narrators" into Discover.** Discover already has a
  "By narrator / language / mood" facet section; the standalone Narrators route duplicates it.
  Fold it in as a sub-section/tab (or cross-link the two), removing one top-level item.
  *Files:* `DiscoveryView.tsx`, `NarratorsView.tsx`, `AppShell.tsx`/routing.
- **IA-5 (High) — Surface the Ctrl+K command palette.** Add a visible affordance (a
  "Search ⌘K/Ctrl+K" pill in the header / wired from the Library search field). It's the
  fastest nav in the app and currently invisible. *Files:* `AppShell.tsx`/header, `LibraryView.tsx`,
  `CommandPalette.tsx`.
- **IA-6 (High/Med) — Discoverable scoped-search.** Replace the raw `tag:cozy duration:<15m`
  code hint with plain-language guidance + a collapsible "Search tips" / "Advanced" affordance
  listing the operators with examples; consider an empty-field ghost suggestion. *Files:*
  `LibraryView.tsx`, `ScopedResults.tsx`.
- **IA-7 (Med) — Section the Settings page.** 8 heterogeneous sections in one scroll. Add a
  sticky in-page section nav or a 2–3 group split ("Preferences" / "Library tools" / "Backup").
  Layout-only, no data change. *Files:* `SettingsView.tsx`, `components.css`.
- **IA-8 (Med) — Author Detail "where am I".** Keep a prominent, consistent back affordance and
  ensure the parent nav item reads as active; disambiguate the modal-vs-route feel. *Files:*
  `AuthorDetailView.tsx`, `App.tsx` (`shellRoute`).
- **IA-9 (Med) — Reorder nav by frequency-of-use** once IA-1/IA-4 land (browse cluster, then
  reflect cluster), so the list reads as a deliberate hierarchy not an append log. *Files:*
  `AppShell.tsx`.
- **IA-10 (Low/Med) — Make multi-select / bulk-tag discoverable.** Add a persistent "Select"
  toggle to the Library toolbar with a selected-count + "Tag selected…" action, so bulk tagging
  isn't gated behind an undiscovered gesture. *Files:* `LibraryView.tsx`, `ScopedResults.tsx`,
  `BulkTagDialog.tsx`. *(Could defer to M26.)*

---

## M23 — Clarity & Onboarding

- **CL-1 (High) — Fix the welcome CTA.** "Choose your library / Go to Settings" is a confusing
  doubled label → single clear "Set up my library"; reframe the secondary. *`HomeView.tsx`.*
- **CL-2 (High) — Suppress zeroed stats on first run.** The `noHistory` flag exists; hide the
  "0m / 0 / 0 days" grid until the first listen so it doesn't read as broken. *`HomeView.tsx`.*
- **CL-3 (High) — First-run guard rails.** During first run, guide to folder-pick; quiet or
  gate the not-yet-usable nav destinations; add a reassuring "what happens next" line.
  *`SettingsView.tsx`, `AppShell.tsx`, `ScanView.tsx`.*
- **CL-4 (High/Med) — Rewrite developer-grade empty states** to "explain + next action"
  (Discover "needs listening history", Narrators "add a narrator…", empty Library/Journal/
  Collections, no-results). *Across views.*
- **CL-5 (Med) — Plain-language copy sweep.** "canonical" → "standardized"; "scoped query" →
  "filter"; "Metadata vocabulary" → "Narrator, Language & Mood"; explain the Rename target
  format; de-jargon Collections. *Across views + `SettingsView.tsx`.*
- **CL-6 (Med) — Dialog titles & context.** The chapter-metadata-edit dialog (and peers) need a
  title + one-line "where this appears" note. *`MetadataEditor.tsx`, `ChapterJournalDialog.tsx`,
  `Dialog` usages.*
- **CL-7 (Med) — Replace `window.prompt`/native modals** ("Save search as:") with in-app inputs.
  *`LibraryView.tsx`.*
- **CL-8 (Low) — Eyebrow audit.** Drop or upgrade redundant eyebrows so each adds context, not a
  restated title. *`PageHeader` usages.*
- **CL-9 (Med) — Tags vs metadata vs collections** in-context microcopy so users know which to
  use when (one line at each point of use, not a tutorial). *Author Detail, Settings.*

---

## M24 — The Listening Loop & Player

- **PL-1 (High) — Playback speed control.** The biggest functional gap for spoken audio. Add
  `playbackRate` + setter to `PlayerControls`; compact button (e.g. "1×") + expanded segmented
  control (0.75/1/1.25/1.5/2×); **persist last speed** (→ schema/settings). *`PlayerBar.tsx`,
  `NowPlayingPanel.tsx`, `App.tsx`, `playback.ts`.*
- **PL-2 (High) — Kill the chapter-end dead-end.** On non-last chapter end, an active
  **"Play next chapter"**; on last, "Mark work complete" + "Browse more by [author]". Respects
  the no-autoplay-queue non-goal (user-initiated, not automatic). *`NowPlayingPanel.tsx`, `App.tsx`.*
- **PL-3 (High) — Start vs Keep listening.** Derive the label: 0 played → "Start listening",
  else "Keep listening" (Home hero + Author Detail). *`HomeView.tsx`, `AuthorDetailView.tsx`.*
- **PL-4 (High) — Scannable chapter states.** Current chapter gets a high-contrast indicator;
  played dimmed/checked-in-color; fix any shared-number display confusion. *`NowPlayingPanel.tsx`.*
- **PL-5 (High/Med) — Elevate the next-chapter title** on the Home hero (it's the actual play
  target, currently muted metadata). *`HomeView.tsx`.*
- **PL-6 (Med) — Compact-bar chapter shortcut + faster path-to-play** (a "Chapters" button;
  a play affordance on Library author rows → next unplayed). *`PlayerBar.tsx`, `LibraryView.tsx`.*
- **PL-7 (Med) — Sleep timer upgrade.** Live countdown when active; "End of chapter" option;
  styled control instead of raw `<select>`. *`PlayerBar.tsx`, `NowPlayingPanel.tsx`.*
- **PL-8 (Med) — Volume affordance.** Speaker icon + click-to-mute + level feedback; differentiate
  from the seek bar. *`PlayerBar.tsx`.*
- **PL-9 (Med) — Compact bar fixes.** Fix the "−0:00" timestamp; taller scrubber hit-area + hover
  thumb; bigger transport targets. *`PlayerBar.tsx`, `playback.ts`.*
- **PL-10 (Low/Med) — Distinct pop-out icon + always-available entry** for the mini-player (not
  the same "expand" icon). *`NowPlayingPanel.tsx`, `PlayerBar.tsx`.*
- **PARKED-ADJACENT — per-second mid-chapter resume.** A long-deferred parked item; M17 added
  the sub-chapter seek + position plumbing, so the cost dropped. Owner decision whether to fold
  into M24 (it pairs naturally with persisted speed; both want a `chapters.playback_position_secs`
  column on the M16 migration runner).

---

## M25 — Visual Polish & Design-System Consistency

- **VIS-1 (High) — Designed cover-art placeholders.** Replace flat color blocks with a
  consistent treatment: color background + centered music/waveform glyph (~30% white) + title
  initials. Universal in `WorkArtwork`/`Cover.tsx`. *Single highest-leverage visual change.*
- **VIS-2 (High) — Accent-color discipline.** `--color-accent` (#218bff) currently does 4 jobs.
  Reserve it for interactive/active states; give recommendation/affinity reasons the success teal.
  *`components.css`, `WorkCard.tsx`.*
- **VIS-3 (High/Med) — Chip/pill legibility.** ~16% accent-alpha pills read as invisible on the
  dark surface; raise inactive ≈25%, use a solid filled `--on` state for selected. *(Mirrors the
  VideoShelf "SubtleFillBrush ~6% = invisible pill" lesson.)* *`components.css`.*
- **VIS-4 (High/Med) — Expanded player visual redesign.** Two-column art/title grid (no avatar
  collision), styled controls (no native `<select>`), rename the raw "CAPTURE" label, bookmark-row
  separators. *(Coordinate with M24 — may co-build.)* *`NowPlayingPanel.tsx`, `components.css`.*
- **VIS-5 (Med) — Heading/eyebrow consistency** via a single `SectionHeading` pattern everywhere;
  remove the Discover eyebrow cursor/typo artifact. *`ui.tsx`, across views.*
- **VIS-6 (Med) — Replace remaining native `<select>`/inputs** (sleep, volume area) with
  design-system controls. *`PlayerBar.tsx`, `components.css`.*
- **VIS-7 (Med) — Author/creator header redesign** (avatar+name+stats band → divider →
  tags/metadata), CTA top-right. *`AuthorDetailView.tsx`.*
- **VIS-8 (Med) — Saved-search chip strip** single-row + "+N more" overflow + labelled, distinct
  chip affordance. *`LibraryView.tsx`, `components.css`.*
- **VIS-9 (Med) — Rename table polish** ("No change" muted, success-toned "already clean" badge,
  reversibility as a `Notice` not an eyebrow). *`RenameView.tsx`.*

---

## M26 *(optional)* — Power, Calm (discoverability residue)

Only if M22/M23 don't fully absorb it: progressive disclosure of curation/admin power
(bulk-select, smart collections, curation export, health scan), the tags/metadata/collections
mental-model microcopy, icon-button tooltips, and an optional one-time first-use tips sequence
(Ctrl+K, scoped search, multi-select). Mostly FE-only, low risk.

---

## Notes for whoever plans these

- **All findings are grounded in `.shots/m12` + `.shots/m21`** (post-M21, 2026-06-13 14:50).
  Re-capture before a planning pass if the build has moved.
- **Re-audit before building** (the M21 lesson): several items may already be partially handled
  (e.g. first-run already changes the Settings title; `noHistory` flag exists). Inventory first,
  only build the genuinely-missing delta.
- **Verification:** every milestone ships with before/after `m12` matrix screenshots verified by a
  Sonnet subagent returning a text verdict (never load PNGs into the controller). Player/loop work
  also runs the `player`/`player-chapters` walkthroughs.
- **Invariant guard (hard gate per milestone):** `git diff --stat` of `Cargo.*`/`package*.json`
  empty unless the milestone explicitly justifies a dep; read-only-on-disk preserved; fixtures
  43/44/47; schema `LATEST` only bumps in M24 if per-second-resume/persisted-speed is included
  (additive on the M16 `run_step`/`user_version` runner — no FK-off rebuild).
