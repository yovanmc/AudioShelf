# AudioShelf M12 - Design System & Theming Design

- **Date:** 2026-06-12
- **Status:** Approved in chat; ready for implementation planning
- **Milestone:** M12 - Design System & Theming

## 1. Outcome

M12 gives AudioShelf its first cohesive visual system and restyles every existing
screen. The result is a balanced, modern desktop media-library interface with:

- a dark-only palette built from reusable CSS custom properties;
- a persistent, manually collapsible left sidebar;
- consistent artwork and creator identity wherever audio is shown;
- a redesigned Home led by one creator-focused continuation feature and a
  recommendation grid;
- an expandable bottom player;
- expressive but bounded motion; and
- shared components for controls, cards, lists, forms, status, and navigation.

The app remains a chapter-at-a-time local audio player. M12 does not add queues,
autoplay, playback speed, per-second resume, waveform seeking, visualizers, online
metadata, or any new audio-file mutation.

## 2. Locked Product Decisions

### Visual direction

- Modern media interface.
- Near-black base, dark blue and blue-gray surfaces, cool gray text, electric-blue
  accent.
- Balanced density is the default. Home and Discovery may use larger feature cards,
  but library browsing remains efficient.
- Medium radii, subtle blue-gray borders, restrained elevation, and clear focus
  rings.
- Dark-only. There is no light theme, no theme toggle, and no `settings.theme` key.
  "Theming" in M12 means a tokenized dark theme and reusable component variants.

### Navigation

- Persistent left sidebar with Home, Library, Discover, and Rename.
- Settings is anchored at the bottom.
- Expanded by default; a manual control collapses it to an icon rail.
- The user's choice persists in the existing `settings` table under
  `sidebar_collapsed`.
- The active route has a clear electric-blue indicator.
- Author Detail is a Library sub-route, so Library remains selected and the page
  provides a contextual back action.
- The PlayerBar remains visible below the shell whenever a chapter is loaded.

### Creator identity

Whenever an audio item is visible, the UI includes creator context:

- work cards use square work artwork;
- creator identity uses a circular crop of the existing author cover, with initials
  fallback;
- Home and Discovery may show relevant tags and progress;
- search results show creator plus work context;
- chapter rows show creator name without repeating low-value metadata;
- PlayerBar and expanded player show creator, work, and chapter hierarchy; and
- creator headers show portrait, tags, work/chapter counts, total duration, and
  played percentage.

M12 reuses the M8 cover resolver and fallback system. It does not introduce online
image lookup or a new cover source.

## 3. Application Shell

Create a shared shell around all post-onboarding routes:

```text
+----------------+-----------------------------------------------+
| AudioShelf     | page header                                   |
| Home           |                                               |
| Library        | routed content                                |
| Discover       |                                               |
| Rename         |                                               |
|                |                                               |
| Settings       |                                               |
+----------------+-----------------------------------------------+
| persistent PlayerBar                                           |
+----------------------------------------------------------------+
```

The shell owns navigation, sidebar state, content scrolling, and PlayerBar placement.
Loading, scanning, and first-run onboarding use the same tokens and controls but may
render without the full sidebar when navigation is not yet meaningful.

The collapsed sidebar preserves all destinations as recognizable buttons with
tooltips and accessible labels. Collapse/expand is animated, but content remains
usable throughout the transition.

## 4. Home

Home is ordered by immediate listening value:

1. **Keep listening to [Creator]**
2. **You May Like**
3. **Recently listened**
4. **Your listening**

### Keep listening to [Creator]

Show one feature card for the most recently played creator who still has an unplayed
chapter.

Selection preserves M11's deterministic continuation behavior:

1. Consider creators in most-recent-play order.
2. Prefer the creator's most recently played work when it has an unplayed chapter.
3. Otherwise use that creator's first active work by `sort_key` with an unplayed
   chapter.
4. If the creator is fully played, continue to the next most recently played creator.
5. If no played creator has anything unplayed, omit the feature and show a useful
   library-oriented empty state.

The feature includes:

- creator portrait and name in the heading;
- work artwork;
- work title and next chapter;
- remaining chapter count;
- relative last-listened time;
- work played percentage derived from chapter played flags;
- primary **Keep listening** action; and
- secondary **View creator** action.

This remains chapter-granular. "Keep listening" starts the next unplayed chapter at
the beginning.

### You May Like

Show up to six active works in a responsive grid. Each card includes work artwork,
creator portrait/name, work title, useful tags, unplayed count or progress, and a
short deterministic explanation.

Ranking:

1. Exclude fully played works.
2. Exclude the work featured in Keep Listening.
3. Score shared author/work tags against recently played creators and their works.
4. Favor mostly unplayed works.
5. Prefer creator diversity when comparable candidates exist.
6. Use deterministic tie-breakers so screenshots and tests are stable.
7. When history or tags are sparse, fall back to active unplayed works ordered by
   unplayed ratio, creator name, and work sort key.

Explanation examples:

- `Shares mystery and cozy`
- `More from a creator you listened to`
- `Mostly unplayed`

The explanation must come from the same facts used for ranking. Do not display a
fabricated or probabilistic reason.

The recommendation query is a narrow read-only Rust/API extension. It may extend
`HomeData` or add a dedicated read command, but it must not change the schema or add a
crate dependency.

### Recently listened

Render the existing recent play history as a compact timeline/list with creator,
work, chapter, and relative time. This is secondary to continuation and discovery,
not a second large card grid.

### Your listening

Render total listening time, chapters finished, and streak as compact stat cards
below the action-oriented sections.

## 5. Library And Search

- Preserve the virtualized author list and its 300+/10k scale behavior.
- Restyle virtualized rows using a shared creator-row component; do not replace
  virtualization with a full DOM grid.
- Keep sort and filter controls compact and grouped in a toolbar.
- Enrich search results with artwork and creator context:
  - author result: circular creator image, name;
  - work result: square work art, title, creator;
  - chapter result: work art, chapter, work, creator.
- Search results remain grouped by Authors, Works, and Chapters.
- Hover and keyboard focus reveal secondary actions without hiding core information.

## 6. Creator Detail

The creator header includes:

- larger circular portrait;
- creator name and tags;
- work count, chapter count, total duration, and played percentage;
- contextual Keep Listening action when an unplayed chapter exists.

Works render as shared cards/sections with artwork, title, tags, progress, and
collapse controls. Chapter rows retain playback, played toggle, grouping override,
and chapter-tag functionality.

Secondary edit actions may move into an overflow/context menu only when they remain
discoverable, keyboard accessible, and covered by existing tests. M12 does not add
new mutations; it only reorganizes actions that already exist.

## 7. Discovery

- Replace plain suggestion lists with the same responsive recommendation-card grid
  used by Home.
- Show work artwork, creator portrait/name, shared tags, unplayed count, and the
  reason the item matched.
- Preserve both existing modes: For You and Pick a Tag.
- Tag selection remains explicit and visible.
- Empty states explain how tags and listening history improve suggestions.

## 8. Expandable Player

### Compact PlayerBar

The persistent bar shows:

- work artwork;
- circular creator image;
- creator, work, and chapter hierarchy;
- play/pause;
- skip back/forward 15 and 30 seconds;
- seek progress and elapsed/total time;
- volume;
- sleep-timer status; and
- an affordance to expand the player.

Selecting the artwork/title region or expand button opens the detailed player. Core
playback controls remain available in compact form.

### Expanded player

The expanded panel is an in-app overlay/panel, not a new route. It shows:

- larger artwork;
- creator portrait and link to Creator Detail;
- work and chapter titles;
- larger seek control and timing;
- play/pause and skip controls;
- volume and sleep timer;
- work/chapter context such as progress and remaining chapters when known; and
- a close/collapse action.

Focus moves into the panel when opened and returns to the invoking control when
closed. Escape closes it. The panel does not add queue, up-next, autoplay, speed, or
lyrics behavior.

To provide identity without changing the database, frontend playback state becomes a
context object containing the existing `ChapterRow` plus author/work IDs and names.
Views that can start playback already possess this context.

## 9. Shared Component Layer

The implementation should establish focused components rather than one large
stylesheet-only rewrite:

- `AppShell` / `Sidebar`
- `Icon`
- `Button` and icon-button variants
- `Card`
- `CreatorAvatar`
- `WorkArtwork`
- `CreatorIdentity`
- `WorkCard` / recommendation card
- `ProgressBar`
- `TagChip`
- `StatCard`
- `Toolbar`
- `EmptyState`, `Notice`, and loading treatment
- `Menu` / context menu
- `Modal` or player panel primitive

Use semantic HTML under these components. Avoid adding a general component framework
or icon dependency; a small local SVG icon set is sufficient.

CSS is organized by responsibility:

- root reset, typography, and tokens;
- shell/navigation;
- shared controls and components;
- view-specific layout;
- motion and reduced-motion overrides.

Inline style objects should be removed from production components where the new
classes cover the behavior. React-window's positioning `style` prop remains required
on virtualized row containers.

## 10. Tokens

Exact values may be tuned during screenshot verification, but the token roles are
locked:

```css
:root {
  --color-bg: #080b10;
  --color-sidebar: #0b111b;
  --color-surface: #121a26;
  --color-surface-raised: #182333;
  --color-surface-hover: #1d2a3c;
  --color-border: #26364a;
  --color-text: #f3f7fc;
  --color-text-muted: #9baabd;
  --color-accent: #218bff;
  --color-accent-hover: #49a2ff;
  --color-success: #39b8a0;
  --color-warning: #e7a94b;
  --color-danger: #ef6b73;
}
```

Also define spacing, radius, shadow, typography, sidebar widths, PlayerBar height,
content max width, focus ring, and motion-duration/easing tokens. Components consume
semantic tokens instead of hard-coded colors.

## 11. Motion And Performance

The app should feel alive, with motion scaled back only if verification shows a
material performance problem.

Allowed expressive interactions:

- route content entrance;
- sidebar collapse/expand;
- card hover lift and artwork scale;
- menu and panel entrance/exit;
- work collapse/expand;
- player expansion;
- progress transitions;
- short playback-state feedback.

Rules:

- prefer `transform` and `opacity`;
- avoid continuous decorative animation;
- avoid animated background blur, large filter effects, and layout-heavy loops;
- do not blanket-apply `will-change`;
- keep common interactions short and interruptible;
- preserve virtualization and lazy cover loading; and
- use `@media (prefers-reduced-motion: reduce)` to remove translation, scale, and
  nonessential animation while preserving state changes.

The implementation should follow the performance guidance in
<https://web.dev/articles/animations-guide> and the platform preference described at
<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>.

## 12. Accessibility

- Full keyboard access for sidebar, cards, menus, player controls, tags, grouping,
  filters, and dialogs.
- Visible `:focus-visible` treatment using the accent token.
- Tooltips and `aria-label`s for icon-only sidebar and player buttons.
- Correct dialog semantics, focus trapping, Escape handling, and focus restoration
  for the expanded player and menus.
- Do not rely on color alone for played, conflict, selected, or active states.
- Maintain readable contrast for primary, secondary, muted, danger, warning, and
  success text.
- Respect reduced motion.

## 13. Error, Loading, And Empty States

Every view uses shared treatments:

- loading: stable skeleton or compact loading panel without layout jumps;
- empty: actionable explanation and primary next step;
- error: clear message in a danger notice without hiding recovery actions;
- disabled/busy: visible state with preserved label meaning.

Settings keeps its fail-safe behavior for missing/unreadable roots. Rename retains
preview, confirmation, conflict, result, and undo semantics.

## 14. Data And Safety Constraints

- No schema migration.
- No new crate or npm dependency unless live implementation evidence shows a local
  primitive cannot meet accessibility requirements; default is no dependency.
- No new audio-file mutation.
- Rename remains the only sanctioned audio-file mutation.
- Cover-cache writes remain app-private and unchanged.
- Settings writes added by M12 are limited to `sidebar_collapsed`.
- Recommendation and Home changes are read-only queries over existing authors,
  works, chapters, tags, and play events.
- Fixture counts remain 43/44/47.

## 15. Verification

Before implementation, capture the current unstyled state for every view. After the
redesign, capture and inspect:

1. Home empty
2. Home populated: Keep Listening, You May Like, recent, stats
3. Home with collapsed sidebar
4. Library browse
5. Library search
6. Creator Detail
7. Discovery For You
8. Discovery by tag
9. Rename preview
10. Rename result/undo state
11. Settings
12. Scan/loading/onboarding state
13. Compact PlayerBar
14. Expanded player
15. Context menu or overflow action

The M12 walkthrough may be split into deterministic sub-walkthroughs if one run
becomes too large, but the full set is mandatory. Existing Home, browse, player,
discovery, rename, grouping, settings, m7, covers, and tags walkthroughs remain
regression gates.

Acceptance:

- every view uses tokens and shared components;
- no production view remains dependent on ad hoc inline visual styling, except
  react-window positioning and truly dynamic values;
- creator identity appears in every agreed audio context;
- recommendation reasons match query facts;
- sidebar persistence and player expansion work across routes;
- keyboard, focus, Escape, and reduced-motion behavior are tested;
- `npx tsc --noEmit`, `npm test`, and Rust tests pass;
- every required screenshot is inspected against its before state; and
- browsing scale and playback behavior do not regress.

## 16. Research Adaptation

The design borrows patterns rather than product scope:

- Audiobookshelf: artwork-led library browsing and persistent detailed playback
  context.
- Plexamp: modular Home sections and library rediscovery.
- Apple Music and Spotify: personalized Home picks and visible recommendation
  rationale.
- Windows NavigationView: expanded left navigation with a compact icon-only mode.
- Modern local-library players: strong artwork/creator hierarchy in Now Playing.

AudioShelf does not copy streaming, social, queue, radio, or online-catalog features
that its local chapter-at-a-time model cannot support.
