# AudioShelf — UI/UX Review & Consistency Findings (2026-06-12)

> Synthesized from two independent expert reviews of the post-M12 UI (the 13-shot `m12`
> screenshot matrix): a **senior UI engineer** (visual/implementation consistency) and a
> **senior UX designer** (experience/flow). Deduped, grouped, and prioritized here to seed
> **M13 — UI Consistency & UX Refinement** (v4). Screen refs are the `m12` shot numbers.
>
> Scope note: this milestone fixes **cross-cutting consistency + shared primitives + core-loop
> flow** so the later feature milestones (M14 player features, M15 home features) build on a
> consistent base. Feature *additions* (chapters-in-work jump panel, configurable Home shelves,
> creator hours/progress) stay in M14/M15; this milestone fixes the *foundations and defects*.

## A. Shared primitives to introduce (fix-once, reused everywhere)

1. **`<SectionHeading>`** — one component for body-level section titles. Today Home's
   "You May Like" / "Keep listening to…" and Discover's "For You" / "Pick a tag" render at
   inconsistent weight/size. (02, 07, 08)
2. **`<TagGroup>`** — a uniform wrapper for tag-pill rows. The pill itself is consistent, but
   its container layout differs three ways: WorkCard (single muted pill), Library row
   (right-aligned, uneven pill→chevron gap), Author detail (pills + "Add tag" + "Tags (N)"
   overlay). (04, 02, 06)
3. **`<Dialog>` / `<Modal>`** — a real shared modal pattern. The expanded player (12) is a
   one-off positioned div with an orphaned top-left close button; author-detail editing (06)
   also needs to move into a modal/slide-panel. Build one, reuse for both. (12, 06)
4. **Proper overflow control** — replace the raw text `...` affordance with `<IconButton
   icon="MoreHorizontal">` going through the existing `Icon`/`Menu` system. The `...` appears as
   literal dots, inconsistently visible across sidebar states. (02, 03, 13)
5. **Tooltip/`title` discipline for all icon-only controls** — player transport row, sidebar
   collapse chevron, expand-to-Now-Playing icon, Settings re-scan icon. Especially the transport
   icons: skip-chapter vs skip-30s are visually ambiguous, and an accidental chapter skip is
   costly (no autoplay recovery). Every icon-only control gets a native `title` at minimum. (11, 12, 01, 10)

## B. Global visual-consistency fixes

6. **Standardize eyebrow copy to one register.** Today eyebrows mix user-orientation
   ("Your personal audio library"), algorithm-description ("Based on your library and listening"),
   and developer jargon ("Previewed, conflict-aware, reversible"). Pick one voice: a single
   user-facing orienting sentence per screen. De-jargon the Rename eyebrow ("conflict-aware" →
   plain language). When Library search is active, the "All creators and audio" eyebrow is stale —
   swap to "Search results" or hide it. (all screens; 09 jargon; 05 stale) [UX theme E]
7. **Responsive card grid + content max-widths.** The `You May Like` / `For You` grids don't
   reflow to more columns at wide widths (3/10 are wide captures); use
   `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`. Settings cards stretch full-width
   with large right-side dead zones — give settings cards a `max-width` (~600px) or a two-column
   layout. (03, 10)
8. **Artwork corner clipping** — the hero "Keep listening" artwork leaks a white pixel at the
   rounded corner; add `overflow:hidden` to the artwork wrapper (or radius on the `<img>`). (02, 03)
9. **Progress-bar contrast** — the thin progress bar under the continue card's "Next:" line is
   near-invisible (dark-on-dark, reads as a divider). Use `--color-accent`/`--color-accent-muted`
   on the fill and a lighter track. (02, 03)
10. **Card eyebrow variants** — the card eyebrow slot shows two different data axes in identical
    accent styling: progress status ("Mostly unplayed") and tag affinity ("Shares cozy"). Give them
    distinct token colors via a `cardEyebrowVariant` (progress vs affinity). (01/02 vs 07/08)
11. **One `WorkCard` with explicit props** — the Search "Works" result card is a stripped-down
    variant (no tag pill, no CTA) diverging from the Home/Discover card. Converge on one component
    with optional slots. (05 vs 01/07)
12. **Rename status pills need differentiation** — "already clean" vs "rename" are near-identical;
    give "rename" a leading icon and/or full-accent color so actionable rows scan instantly. (09)
13. **Discovery tag filter as pill-toggles, not raw checkboxes** — replace the native
    `<input type=checkbox> cozy` row with the app's tag-pill component in a toggled state. (08)
14. **Settings status box structure** — the "Indexed 43 authors, 44 works, 47 chapters" box uses a
    success/error-looking border but no icon/heading/structure; make it a labeled stat row or add an
    icon + bold counts. Add a light "that's it for now" note so the sparse page doesn't read as a
    load failure. (10)
15. **`CreatorAvatar` fallback color determinism** — initials-circle background appears to vary by
    context; ensure the fallback palette derives from a deterministic hash of the creator name, the
    same everywhere. (cards vs 06 hero)
16. **Author-detail toolbar grouping** — the "Sort works / Collapse all" toolbar floats between the
    hero card and the works with no scope label; add a left-aligned "Works (N)" or tie it visually
    to the list. (06)

## C. Cross-cutting UX / core-loop fixes

17. **[High] Add a direct "Play next chapter" action on every work card** (Home, Discover, Search).
    The core verb is "listen to a chapter," yet reaching playback from a recommendation takes 2–3
    hops; the only card CTA today is "View creator." Add a primary Play action ("next chapter" =
    chapter 1 for unstarted, next-unplayed for in-progress) reusing existing `playChapter`. Keep
    "View creator" as a secondary link. (01, 02, 07, 08, 05) [UX themes A, B; top-1]
18. **[High] Fix the card CTA/navigation semantics** — "View creator" sends users *away* from the
    work they're interested in. Make the work itself the primary target (open its chapters / play),
    with creator as a secondary link. Apply the same play/open pattern uniformly so clicking is
    predictable across Home/Library/Detail/Discover/Search. (01, 07; UX theme B)
19. **[High] First-run / empty Home is not a welcome.** The zero-state leads with a "You May Like"
    grid and the false eyebrow "Based on your library and listening" (there is no history yet).
    Suppress recommendations until there is data; show a single orienting setup card (one-sentence
    mental model: creator→work→chapter; CTA to Settings/choose-folder). (01) [UX top-2]
20. **[High] Isolate author-detail editing.** Tag editing (creator + work), chapter grouping-edit,
    and content browsing all render simultaneously and collide (see also #3 modal). Move grouping
    edit (and chapter-level tags) behind an explicit "…" overflow / modal so the default detail view
    is browse-only — reduces accidental edits and the worst visual collision in the app. (06) [UX top-3]
21. **[Med] Make the chapter-at-a-time model explicit.** Nothing communicates "stops after each
    chapter"; the transport UI looks like a continuous player. In the Now Playing panel add
    "Chapter X of Y", a "Stops after this chapter" / "Last chapter" note, and a link back to the
    work detail — also fills the panel's empty lower third. (12, 11) [UX theme D, top-4]
22. **[Med] Move Discover's "Pick a tag" filter above "For You."** The tag filter — the primary
    navigation control on Discover — is entirely below the fold; surface it on top. Also retitle
    "For You" → "Personalized picks (needs listening history)" so it and the always-available tag
    browser don't read as contradictory in the empty state. (07, 08) [UX top-5]
23. **[Med] Tighten the continue-card copy.** "Next: Chapter 2, Cool Story 2 the sequel · 2 left ·
    just now" is dense and ambiguous ("2 left" of what). Restructure to: work title / "Next: Chapter
    2 — <title>" / "2 chapters remaining", with the timestamp de-emphasized. (02, 03)
24. **[Med] Library row metadata order + units.** Rows lead with raw counts ("2 works · 4 chapters
    …") and end with the meaningful progress; lead with progress instead, and disambiguate "0:14"
    (total duration? add a unit/tooltip). Rename the "Has unplayed" status filter to clearer wording
    ("Has unlistened chapters"). (04)
25. **[Med] Search chapter rows need an action affordance** — chapter result rows show no play
    triangle or chevron; make them directly playable (play icon) or clearly navigable. (05)
26. **[Low] Label tag scope** — distinguish creator-tags vs work-tags (and chapter-tags) with
    explicit small labels so the two identical "Add tag" inputs aren't ambiguous. (06)
27. **[Low] False-scroll affordance** — grids clip the bottom card to hint scroll but show no
    scrollbar/fade; add a subtle bottom fade or a visible-on-hover scrollbar. (01, 07, 08)

## D. Severity rollup (suggested order within the milestone)

- **High (do first):** #3 Dialog/Modal, #4 overflow IconButton, #1 SectionHeading, #2 TagGroup,
  #5 tooltips, #17 play-from-card, #18 CTA semantics, #19 first-run home, #20 isolate detail editing,
  #2/#6 author-detail collision.
- **Med:** #6 eyebrow standardization, #7 grid reflow + settings max-width, #21 chapter-at-a-time
  clarity, #22 Discover reorder, #23 continue-card copy, #24 library metadata, #25 search rows,
  #9 progress contrast, #10 eyebrow variants, #12 rename pills, #13 discovery pill-toggles.
- **Low / quick wins:** #8 artwork clip, #11 WorkCard convergence, #14 settings box, #15 avatar
  color, #16 toolbar grouping, #26 tag-scope labels, #27 scroll affordance.

## E. Explicitly out of scope (respect existing decisions)

- No queue / Up-Next, autoplay/radio, playback-speed, or social features (design non-goals).
- No per-second mid-chapter resume (deferred — needs a schema migration).
- Feature *additions* belong to their milestones: chapters-in-work **jump panel** → M14;
  configurable Home **shelves** + creator **hours/progress** → M15. This milestone supplies the
  shared primitives (modal, section heading, tag group, tooltips, card grid) those build on, and
  fixes the consistency defects — it does not implement those features.

## Gates for the milestone

- The usual: `tsc` clean, `npm test`, `cargo test`, and the screenshot matrix — but here the
  **before/after** comparison is the point: re-capture the full `m12` matrix (and the per-view
  walkthroughs) and verify each listed defect is resolved with **no functional regression**.
  Read-only on disk; no schema/dependency change expected (any new persisted state, e.g. a UI pref,
  uses the existing M6 settings table with a fail-safe parse).
