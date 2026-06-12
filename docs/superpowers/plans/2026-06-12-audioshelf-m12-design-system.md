# M12 Design System & Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Written for fresh-context execution. If repository details differ, inspect the live
> code and adapt when intent is clear. Pause only when the difference changes product
> behavior, safety, destructive scope, or acceptance criteria.

**Goal:** Give AudioShelf a complete dark modern design system, creator-rich Home and
browsing experience, collapsible app shell, and expandable player without changing the
database schema or the chapter-at-a-time playback model.

**Architecture:** Add one read-only backend extension for Home recommendations, then
build a local React/CSS component layer around the existing views. `App` owns routing,
persisted sidebar state, and a richer playback context; shared cards, creator identity,
menus, and player-panel primitives keep the redesign consistent while existing queries
and mutations remain authoritative.

**Tech Stack:** Tauri 2, Rust, rusqlite, React 18, TypeScript, CSS custom properties,
Vitest, Testing Library, existing screenshot harness.

---

## Scope And Invariants

- Approved design:
  `docs/superpowers/specs/2026-06-12-audioshelf-m12-design-system.md`.
- Dark-only. Do not add a light theme, theme toggle, or `settings.theme`.
- Add only one preference: `sidebar_collapsed` in the existing `settings` table.
- No schema migration and no new Rust or npm dependency.
- No audio-file mutation. Rename remains the only sanctioned mutation.
- No queue, autoplay, playback speed, per-second resume, waveform, lyrics, radio, or
  online metadata.
- Preserve virtualized author browsing and lazy cover loading.
- Fixture counts remain 43 authors / 44 works / 47 chapters.
- Keep the repository-configured human Git identity. Every substantive Codex-generated
  commit must end, after a blank line, with:

  `Co-authored-by: Codex <noreply@openai.com>`

## File Map

### Backend

- Modify `src-tauri/src/model.rs`
  - Replace the plural Home continuation contract with one optional featured item.
  - Add recommendation metadata and stable IDs to recent-history items.
- Modify `src-tauri/src/commands.rs`
  - Add deterministic recommendation ranking and reasons.
  - Assemble the new `HomeData`.
  - Add focused Rust tests.
- No change to `src-tauri/src/db.rs`, schema constants, migrations, or Cargo manifests.

### Frontend foundation

- Create `src/styles/tokens.css`
  - Dark palette, typography, spacing, radii, shadows, layout dimensions, focus, and
    motion tokens.
- Create `src/styles/base.css`
  - Reset, body/root sizing, typography, native controls, focus, reduced motion.
- Create `src/styles/components.css`
  - Shared buttons, cards, artwork, identity, chips, progress, menus, notices, modal,
    toolbar, and skeleton styles.
- Create `src/styles/layout.css`
  - Shell, sidebar, routed content, responsive grids, view layouts, and PlayerBar.
- Modify `src/main.tsx`
  - Import the four stylesheets.
- Create `src/components/Icon.tsx`
  - Small local SVG icon set; no icon dependency.
- Create `src/components/ui.tsx`
  - `Button`, `IconButton`, `Card`, `ProgressBar`, `StatCard`, `EmptyState`, `Notice`.
- Modify `src/components/Cover.tsx`
  - Split reusable square `WorkArtwork` and circular `CreatorAvatar` wrappers over the
    existing cached resolver/fallback.
- Create `src/components/CreatorIdentity.tsx`
  - Creator image/name plus optional secondary metadata.
- Create `src/components/WorkCard.tsx`
  - Shared Home/Discovery/search work card.
- Create `src/components/Menu.tsx`
  - Keyboard-accessible overflow menu for existing secondary actions.
- Create `src/components/AppShell.tsx`
  - Persistent collapsible navigation and page content frame.

### Views and player

- Modify `src/lib/api.ts`
  - New Home contracts and `PlaybackContext`.
- Create `src/lib/home.ts` and `src/lib/home.test.ts`
  - Pure adapters/progress helpers for Home and cards.
- Modify `src/App.tsx`
  - App shell, sidebar persistence, route navigation, recommendation loading, richer
    playback context, expanded-player state, and M12 walkthrough wiring.
- Modify all files under `src/views/`
  - Remove per-view top-level navigation buttons.
  - Adopt shared controls and visual components.
- Modify `src/player/PlayerBar.tsx` and `src/player/PlayerBar.test.tsx`
  - Rich compact player and accessible expanded panel.
- Create `src/player/NowPlayingPanel.tsx` and
  `src/player/NowPlayingPanel.test.tsx`.
- Modify `src/harness/walkthroughs.ts` and `src/harness/runner.test.ts`
  - Add deterministic M12 visual states.
- Modify `tools/verify.ps1`
  - Allow a caller-selected screenshot root for durable before/after output.
- Modify `.gitignore`
  - Ignore `.shots-before/` and `.shots-after/`.

---

### Task 1: Capture The Unstyled Before State

**Files:**
- Modify: `.gitignore`
- Modify: `tools/verify.ps1`
- Test: manual PowerShell harness invocation

- [ ] **Step 1: Add a configurable output root to the harness**

Extend the parameter block in `tools/verify.ps1`:

```powershell
param(
  [string]$Walkthrough = "browse",
  [int]$TimeoutSec = 240,
  [switch]$SkipBuild,
  [string]$OutputRoot = ".shots"
)
```

Replace the current `$shots` and `$done` assignments with:

```powershell
$output  = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
  $OutputRoot
} else {
  Join-Path $root $OutputRoot
}
$shots   = Join-Path $output $Walkthrough
$done    = Join-Path $output "$Walkthrough.done"
```

Keep the comparison baseline at `.shots-baseline\<walkthrough>` so normal runs retain
their existing behavior. The custom output path changes only where current shots and
the done signal are written.

- [ ] **Step 2: Ignore durable local before/after artifacts**

Append to `.gitignore`:

```gitignore
.shots-before/
.shots-after/
```

- [ ] **Step 3: Verify the script still parses**

Run:

```powershell
[void][scriptblock]::Create((Get-Content -Raw tools\verify.ps1))
```

Expected: exit 0 with no output.

- [ ] **Step 4: Capture every current view before production edits**

Run the first walkthrough with a build, then reuse the binary:

```powershell
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough home -OutputRoot .shots-before
```

Then run:

```powershell
$walkthroughs = @("browse","player","discovery","rename","grouping","settings","m7","covers","tags")
foreach ($name in $walkthroughs) {
  powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough $name -OutputRoot .shots-before -SkipBuild
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: every run prints `WALKTHROUGH OK`; PNGs exist below
`.shots-before\<walkthrough>\`.

- [ ] **Step 5: Commit the harness support**

```powershell
git add .gitignore tools/verify.ps1
git commit -m "chore(harness): support M12 before-after captures" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 2: Extend Home Data And Recommendation Ranking

**Files:**
- Modify: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/lib/api.ts`
- Create: `src/lib/home.ts`
- Create: `src/lib/home.test.ts`
- Modify: `src/views/HomeView.test.tsx`

- [ ] **Step 1: Write failing Rust tests for the new Home contract**

In the existing `commands.rs` test module, replace the continuation expectation with a
single featured item and add recommendation coverage:

```rust
#[test]
fn home_keep_listening_uses_latest_creator_with_unplayed_audio() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    touch(&root.join("Alice").join("Tale.mp3"));
    touch(&root.join("Alice").join("Tale 2.mp3"));
    touch(&root.join("Bob").join("Saga.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();

    let ids: std::collections::HashMap<String, i64> =
        query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
    let alice = query_author_detail(&conn, ids["Alice"]).unwrap();
    let bob = query_author_detail(&conn, ids["Bob"]).unwrap();
    mark_finished(&conn, alice.works[0].chapters[0].id, 2_000).unwrap();
    mark_finished(&conn, bob.works[0].chapters[0].id, 3_000).unwrap();

    let item = home_keep_listening(&conn).unwrap().expect("Alice remains resumable");
    assert_eq!(item.author_name, "Alice");
    assert_eq!(item.next_chapter.chapter_no, 2);
    assert_eq!(item.total_chapters, 2);
    assert_eq!(item.played_chapters, 1);
}

#[test]
fn home_recommendations_rank_matches_exclude_feature_and_diversify() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    touch(&root.join("Alice").join("Tale.mp3"));
    touch(&root.join("Alice").join("Tale 2.mp3"));
    touch(&root.join("Bob").join("Blue.mp3"));
    touch(&root.join("Carol").join("Calm.mp3"));
    touch(&root.join("Dave").join("Other.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();

    let ids: std::collections::HashMap<String, i64> =
        query_authors(&conn).unwrap().into_iter().map(|a| (a.name, a.id)).collect();
    set_tags(&conn, ids["Alice"], &["cozy".into(), "mystery".into()]).unwrap();
    set_tags(&conn, ids["Bob"], &["cozy".into(), "mystery".into()]).unwrap();
    set_tags(&conn, ids["Carol"], &["cozy".into()]).unwrap();
    let alice = query_author_detail(&conn, ids["Alice"]).unwrap();
    mark_finished(&conn, alice.works[0].chapters[0].id, 5_000).unwrap();

    let featured = home_keep_listening(&conn).unwrap().unwrap();
    let recs = home_recommendations(&conn, Some(featured.work_id), 6).unwrap();
    assert!(recs.iter().all(|r| r.work_id != featured.work_id));
    assert_eq!(recs[0].author_name, "Bob");
    assert_eq!(recs[0].matched_tags, vec!["cozy", "mystery"]);
    assert_eq!(recs[0].reason, "Shares cozy and mystery");
    assert!(recs.iter().all(|r| r.unplayed_count > 0));
    let first_three: std::collections::BTreeSet<_> =
        recs.iter().take(3).map(|r| r.author_id).collect();
    assert_eq!(first_three.len(), recs.len().min(3));
}

#[test]
fn home_recommendations_have_deterministic_sparse_history_fallback() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    touch(&root.join("Beta").join("Short.mp3"));
    touch(&root.join("Alpha").join("Long.mp3"));
    touch(&root.join("Alpha").join("Long 2.mp3"));
    let conn = open_in_memory().unwrap();
    scan::scan_into(&conn, root).unwrap();

    let recs = home_recommendations(&conn, None, 6).unwrap();
    assert_eq!(recs[0].author_name, "Alpha");
    assert_eq!(recs[0].reason, "Mostly unplayed");
    assert_eq!(recs[1].author_name, "Beta");
}
```

Run:

```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml home_"
```

Expected: FAIL because the new helpers and fields do not exist.

- [ ] **Step 2: Replace and extend the backend response structs**

In `src-tauri/src/model.rs`, extend `ContinueItem`:

```rust
pub struct ContinueItem {
    pub author_id: i64,
    pub author_name: String,
    pub work_id: i64,
    pub work_title: String,
    pub next_chapter: ChapterRow,
    pub remaining_unplayed: i64,
    pub total_chapters: i64,
    pub played_chapters: i64,
    pub last_played_at: i64,
}
```

Add:

```rust
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationWork {
    pub work_id: i64,
    pub base_title: String,
    pub author_id: i64,
    pub author_name: String,
    pub total_chapters: i64,
    pub unplayed_count: i64,
    pub tags: Vec<String>,
    pub matched_tags: Vec<String>,
    pub reason: String,
}
```

Extend `RecentItem` with stable navigation IDs:

```rust
pub author_id: i64,
pub work_id: i64,
```

Replace `HomeData` with:

```rust
pub struct HomeData {
    pub keep_listening: Option<ContinueItem>,
    pub recommendations: Vec<RecommendationWork>,
    pub stats: ListeningStats,
}
```

- [ ] **Step 3: Implement one featured continuation item**

Rename `home_continue` to:

```rust
pub(crate) fn home_keep_listening(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<Option<ContinueItem>>
```

Keep the current deterministic author/work selection, iterate recent authors until a
resumable creator is found, and return immediately. Query:

```sql
SELECT
  count(*) AS total,
  sum(CASE WHEN played=1 THEN 1 ELSE 0 END) AS played,
  sum(CASE WHEN played=0 THEN 1 ELSE 0 END) AS unplayed
FROM chapters
WHERE work_id=?1 AND status='active'
```

Populate `total_chapters`, `played_chapters`, and `remaining_unplayed`. Return `Ok(None)`
when no played creator remains resumable.

- [ ] **Step 4: Implement deterministic recommendation candidates**

Import `RecommendationWork` in `commands.rs`. Add a private candidate struct:

```rust
struct HomeCandidate {
    item: RecommendationWork,
    shared_count: usize,
    recent_author_rank: Option<usize>,
    sort_key: String,
}
```

Add helpers:

```rust
fn tags_for_author_and_work(
    conn: &rusqlite::Connection,
    author_id: i64,
    work_id: i64,
) -> rusqlite::Result<std::collections::BTreeSet<String>>

fn recommendation_reason(
    matched_tags: &[String],
    recent_author: bool,
) -> String

pub(crate) fn home_recommendations(
    conn: &rusqlite::Connection,
    exclude_work_id: Option<i64>,
    cap: usize,
) -> rusqlite::Result<Vec<RecommendationWork>>
```

`recommendation_reason` is exact:

```rust
match matched_tags {
    [one] => format!("Shares {one}"),
    [first, second, ..] => format!("Shares {first} and {second}"),
    [] if recent_author => "More from a creator you listened to".to_string(),
    [] => "Mostly unplayed".to_string(),
}
```

Candidate SQL returns active works with active chapters:

```sql
SELECT
  w.id,
  w.base_title,
  w.sort_key,
  a.id,
  COALESCE(a.display_name, a.folder_name),
  count(c.id),
  sum(CASE WHEN c.played=0 THEN 1 ELSE 0 END)
FROM works w
JOIN authors a ON a.id=w.author_id
JOIN chapters c ON c.work_id=w.id
WHERE w.status='active' AND a.status='active' AND c.status='active'
GROUP BY w.id, w.base_title, w.sort_key, a.id, a.folder_name, a.display_name
HAVING sum(CASE WHEN c.played=0 THEN 1 ELSE 0 END) > 0
```

Build a recent-author rank map from `recent_authors(conn, 20)`. Build the recent tag
set from author and work tags for those creators. Sort candidates by:

1. `shared_count` descending;
2. recent-creator presence descending;
3. recent-creator rank ascending when both candidates are recent;
4. unplayed ratio descending using cross multiplication
   (`a.unplayed * b.total` versus `b.unplayed * a.total`);
5. unplayed count descending;
6. author name case-insensitive ascending;
7. `sort_key` ascending;
8. work ID ascending.

Select in two passes:

1. take best candidates whose creator has not yet been selected;
2. fill remaining capacity from the sorted remainder.

Track selected work IDs so the second pass cannot duplicate the first. Never include
`exclude_work_id`.

- [ ] **Step 5: Assemble the new Home response**

Update `home_stats` recent SQL to select author/work IDs and populate the new fields.

Update `query_home`:

```rust
let keep_listening = home_keep_listening(&conn).map_err(|e| e.to_string())?;
let recommendations = home_recommendations(
    &conn,
    keep_listening.as_ref().map(|item| item.work_id),
    6,
).map_err(|e| e.to_string())?;
let stats = home_stats(&conn, now_ms, tz_offset_minutes, 10)
    .map_err(|e| e.to_string())?;
Ok(HomeData { keep_listening, recommendations, stats })
```

- [ ] **Step 6: Run the Rust tests**

```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```

Expected: all tests PASS; the old plural continuation test has been replaced, not
duplicated.

- [ ] **Step 7: Update frontend API contracts**

In `src/lib/api.ts`:

```ts
export interface ContinueItem {
  authorId: number;
  authorName: string;
  workId: number;
  workTitle: string;
  nextChapter: ChapterRow;
  remainingUnplayed: number;
  totalChapters: number;
  playedChapters: number;
  lastPlayedAt: number;
}

export interface RecommendationWork {
  workId: number;
  baseTitle: string;
  authorId: number;
  authorName: string;
  totalChapters: number;
  unplayedCount: number;
  tags: string[];
  matchedTags: string[];
  reason: string;
}

export interface RecentItem {
  chapterId: number;
  chapterTitle: string;
  workId: number;
  workTitle: string;
  authorId: number;
  authorName: string;
  playedAt: number;
}

export interface HomeData {
  keepListening: ContinueItem | null;
  recommendations: RecommendationWork[];
  stats: ListeningStats;
}

export interface PlaybackContext {
  chapter: ChapterRow;
  authorId: number;
  authorName: string;
  workId: number;
  workTitle: string;
  workTotalChapters: number;
  workPlayedChapters: number;
}
```

- [ ] **Step 8: Add pure Home adapters**

Create `src/lib/home.ts`:

```ts
import type { ContinueItem, RecommendationWork } from "./api";

export function percent(played: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((played / total) * 100);
}

export function keepListeningPercent(item: ContinueItem): number {
  return percent(item.playedChapters, item.totalChapters);
}

export function recommendationPercent(item: RecommendationWork): number {
  return percent(item.totalChapters - item.unplayedCount, item.totalChapters);
}
```

Create tests for zero totals, rounded progress, and recommendation progress.

Run:

```powershell
npx vitest run src/lib/home.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 9: Keep the existing Home renderer green on the new contract**

Change `HomeView.test.tsx` fixtures from `continueListening` to `keepListening`, add
`recommendations`, add the count fields, and add recent IDs.

In `HomeView.tsx`, make the smallest compatibility change needed before the visual
redesign:

```ts
const continueListening = home.keepListening ? [home.keepListening] : [];
```

Keep the current `Jump back in` markup temporarily and use this local array where the
old response array was read. Do not render recommendations yet; Task 6 replaces the
entire Home layout. This compatibility step keeps every commit buildable.

Run:

```powershell
npx vitest run src/views/HomeView.test.tsx
npx tsc --noEmit
```

Expected: PASS using the new API shape with the old visual presentation.

- [ ] **Step 10: Commit backend and contract changes**

```powershell
git add src-tauri/src/model.rs src-tauri/src/commands.rs src/lib/api.ts src/lib/home.ts src/lib/home.test.ts src/views/HomeView.tsx src/views/HomeView.test.tsx
git commit -m "feat(home): add creator continuation and recommendations" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 3: Build Tokens, Icons, And Shared UI Primitives

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Create: `src/styles/components.css`
- Create: `src/styles/layout.css`
- Modify: `src/main.tsx`
- Create: `src/components/Icon.tsx`
- Create: `src/components/ui.tsx`
- Modify: `src/components/Cover.tsx`
- Create: `src/components/CreatorIdentity.tsx`
- Create: `src/components/WorkCard.tsx`
- Create: `src/components/Menu.tsx`
- Create tests beside new components where interaction exists

- [ ] **Step 1: Write failing primitive interaction tests**

Create `src/components/Menu.test.tsx` covering:

```tsx
it("opens from its trigger, chooses an item, and closes on Escape", async () => {
  const action = vi.fn();
  render(
    <Menu
      label="More actions"
      items={[{ label: "Open creator", onSelect: action }]}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "Open creator" }));
  expect(action).toHaveBeenCalled();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
```

Add a second test that presses Escape and verifies focus returns to the trigger.

Create `src/components/WorkCard.test.tsx` covering work title, creator, reason, tags,
progress, primary action, and overflow action.

Run:

```powershell
npx vitest run src/components/Menu.test.tsx src/components/WorkCard.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 2: Define root tokens**

Create `src/styles/tokens.css` with the approved palette and semantic tokens:

```css
:root {
  color-scheme: dark;
  --color-bg: #080b10;
  --color-sidebar: #0b111b;
  --color-surface: #121a26;
  --color-surface-raised: #182333;
  --color-surface-hover: #1d2a3c;
  --color-border: #26364a;
  --color-border-strong: #36506d;
  --color-text: #f3f7fc;
  --color-text-muted: #9baabd;
  --color-accent: #218bff;
  --color-accent-hover: #49a2ff;
  --color-accent-soft: rgb(33 139 255 / 16%);
  --color-success: #39b8a0;
  --color-warning: #e7a94b;
  --color-danger: #ef6b73;
  --focus-ring: 0 0 0 3px rgb(33 139 255 / 38%);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --shadow-card: 0 10px 30px rgb(0 0 0 / 24%);
  --shadow-overlay: 0 24px 80px rgb(0 0 0 / 55%);
  --sidebar-expanded: 224px;
  --sidebar-collapsed: 72px;
  --player-height: 88px;
  --content-max: 1480px;
  --motion-fast: 140ms;
  --motion-normal: 220ms;
  --motion-slow: 340ms;
  --ease-standard: cubic-bezier(.2, .8, .2, 1);
}
```

- [ ] **Step 3: Add reset, accessibility, and reduced motion**

Create `base.css` with:

- `html`, `body`, `#root` full size;
- body background/text/system font;
- inherited fonts for controls;
- normalized buttons/inputs/selects/tables;
- `:focus-visible` focus ring;
- visually hidden utility;
- responsive type scale;
- `prefers-reduced-motion` that reduces animation/transition duration and removes
  transform-based entrances.

Do not disable focus outlines globally.

- [ ] **Step 4: Implement local SVG icons**

`Icon.tsx` exports:

```ts
export type IconName =
  | "home" | "library" | "discover" | "rename" | "settings"
  | "menu" | "chevronLeft" | "chevronRight" | "more"
  | "play" | "pause" | "back15" | "back30" | "forward15" | "forward30"
  | "volume" | "sleep" | "search" | "check" | "tag"
  | "expand" | "collapse" | "close" | "refresh" | "folder";
```

Render a single `<svg aria-hidden="true" viewBox="0 0 24 24">` and path(s) selected by
name. Use `currentColor`; do not embed text glyphs or emoji.

- [ ] **Step 5: Implement shared presentational primitives**

`ui.tsx` exports:

```ts
Button
IconButton
Card
ProgressBar
StatCard
EmptyState
Notice
```

`ProgressBar` must expose `role="progressbar"`, `aria-valuemin`, `aria-valuemax`, and
`aria-valuenow`. Buttons support `primary`, `secondary`, `ghost`, and `danger`
variants.

- [ ] **Step 6: Refactor cover presentation without changing resolution**

Keep `coverCache`, fetch behavior, and `fileUrl` behavior unchanged. Add:

```tsx
export function WorkArtwork(props: {
  workId: number;
  title: string;
  size?: number;
  className?: string;
})

export function CreatorAvatar(props: {
  authorId: number;
  name: string;
  size?: number;
  className?: string;
})
```

`WorkArtwork` uses rounded-square styling. `CreatorAvatar` uses `border-radius: 50%`.
Both use the existing initials fallback and preserve fixed dimensions to prevent layout
shift. Keep `Cover` as a compatibility wrapper until every call site is migrated.

- [ ] **Step 7: Implement CreatorIdentity and WorkCard**

`CreatorIdentity` props:

```ts
{
  authorId: number;
  authorName: string;
  secondary?: React.ReactNode;
  size?: number;
  onOpen?: () => void;
}
```

`WorkCard` props:

```ts
{
  workId: number;
  title: string;
  authorId: number;
  authorName: string;
  tags?: string[];
  reason?: string;
  progress?: number;
  meta?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onOpenAuthor?: () => void;
  menuItems?: MenuItem[];
  featured?: boolean;
}
```

The entire card is not a nested button. Use separate semantic controls for primary
action, creator link, and overflow menu.

- [ ] **Step 8: Implement accessible Menu**

`Menu`:

- uses a button trigger;
- opens a `role="menu"` popover positioned with CSS;
- supports ArrowDown/ArrowUp, Home/End, Enter/Space, and Escape;
- closes on outside pointer down;
- restores focus to the trigger;
- renders `role="menuitem"` buttons;
- does not depend on a third-party positioning package.

- [ ] **Step 9: Add component and layout styles**

In `components.css` and `layout.css`, implement the visual classes used by the new
components. Use only tokens for colors, spacing, radii, shadows, and motion.

Motion:

```css
.work-card {
  transition:
    transform var(--motion-normal) var(--ease-standard),
    border-color var(--motion-fast) ease,
    background-color var(--motion-fast) ease;
}

.work-card:hover {
  transform: translateY(-3px);
}

.work-card:hover .work-artwork {
  transform: scale(1.035);
}
```

No continuous animation and no blanket `will-change`.

- [ ] **Step 10: Import styles once**

At the top of `src/main.tsx`:

```ts
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
```

- [ ] **Step 11: Run focused tests and typecheck**

```powershell
npx vitest run src/components/Menu.test.tsx src/components/WorkCard.test.tsx
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 12: Commit the design-system foundation**

```powershell
git add src/main.tsx src/styles src/components
git commit -m "feat(ui): add dark design-system primitives" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 4: Add The Persistent Collapsible App Shell

**Files:**
- Create: `src/components/AppShell.tsx`
- Create: `src/components/AppShell.test.tsx`
- Modify: `src/App.tsx`
- Modify: all view prop types that currently receive top-level navigation callbacks

- [ ] **Step 1: Write failing shell tests**

Cover:

```tsx
it("shows all destinations, active state, and settings in the footer")
it("collapses to labelled icon buttons and emits the new state")
it("keeps Library selected for the author sub-route")
```

Use a route key union:

```ts
export type ShellRoute = "home" | "library" | "discovery" | "rename" | "settings";
```

Run:

```powershell
npx vitest run src/components/AppShell.test.tsx
```

Expected: FAIL because `AppShell` does not exist.

- [ ] **Step 2: Implement AppShell**

Props:

```ts
{
  active: ShellRoute;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onHome: () => void;
  onLibrary: () => void;
  onDiscovery: () => void;
  onRename: () => void;
  onSettings: () => void;
  children: React.ReactNode;
  player: React.ReactNode;
}
```

The sidebar contains:

- brand and collapse toggle;
- Home, Library, Discover, Rename;
- flexible spacer;
- Settings footer action.

Each icon-only state retains `aria-label` and `title`. Set `aria-current="page"` on the
active destination.

- [ ] **Step 3: Add persisted sidebar state to App**

Add:

```ts
const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
```

After the DB is reachable:

```ts
setSidebarCollapsedState((await getSetting("sidebar_collapsed")) === "true");
```

Handler:

```ts
function setSidebarCollapsed(collapsed: boolean) {
  setSidebarCollapsedState(collapsed);
  void setSetting("sidebar_collapsed", String(collapsed));
}
```

This setting is not read on first-run onboarding before a library/DB is ready.

- [ ] **Step 4: Wrap routed views**

Create a helper mapping:

```ts
function shellRoute(route: Route): ShellRoute {
  if (route.kind === "author") return "library";
  if (route.kind === "discovery") return "discovery";
  if (route.kind === "rename") return "rename";
  if (route.kind === "settings") return "settings";
  if (route.kind === "home") return "home";
  return "library";
}
```

Render loading/scan/first-run onboarding in a styled standalone frame. Wrap all normal
routes in `AppShell`.

- [ ] **Step 5: Remove duplicated top-level nav props**

Remove Home/Library/Discover/Rename/Settings toolbar buttons and matching props from:

- `HomeView`
- `LibraryView`
- `DiscoveryView`
- `RenameView`
- non-first-run `SettingsView`

Keep contextual actions:

- Author Detail back to Library;
- first-run Settings onboarding action;
- shell navigation.

Update tests so they no longer assert per-view toolbar callbacks.

- [ ] **Step 6: Run shell and affected view tests**

```powershell
npx vitest run src/components/AppShell.test.tsx src/views/HomeView.test.tsx src/views/LibraryView.test.tsx src/views/DiscoveryView.test.tsx src/views/RenameView.test.tsx src/views/SettingsView.test.tsx
npx tsc --noEmit
```

Expected: all listed tests PASS.

- [ ] **Step 7: Commit the shell**

```powershell
git add src/App.tsx src/components/AppShell.tsx src/components/AppShell.test.tsx src/views
git commit -m "feat(shell): add persisted collapsible navigation" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 5: Add Rich Playback Context And Expandable Player

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/player/PlayerBar.tsx`
- Modify: `src/player/PlayerBar.test.tsx`
- Create: `src/player/NowPlayingPanel.tsx`
- Create: `src/player/NowPlayingPanel.test.tsx`
- Modify: view callback types that start playback

- [ ] **Step 1: Write failing PlayerBar and panel tests**

Update PlayerBar test props to use:

```ts
context: {
  chapter: nextChapter,
  authorId: 1,
  authorName: "Jane Doe",
  workId: 3,
  workTitle: "Cool Story",
  workTotalChapters: 4,
  workPlayedChapters: 2,
}
```

Add tests:

```tsx
it("shows artwork, creator, work, and chapter hierarchy")
it("opens the expanded player")
it("keeps all four skip controls and sleep timer behavior")
```

For `NowPlayingPanel`:

```tsx
it("renders as a dialog and closes on Escape")
it("moves focus to Close and restores focus through onClose")
it("opens the creator and exposes volume, sleep, seek, and playback controls")
```

Run:

```powershell
npx vitest run src/player/PlayerBar.test.tsx src/player/NowPlayingPanel.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Change App playback state to PlaybackContext**

Replace:

```ts
const [current, setCurrent] = useState<ChapterRow | null>(null);
```

with:

```ts
const [current, setCurrent] = useState<PlaybackContext | null>(null);
const [playerExpanded, setPlayerExpanded] = useState(false);
```

Update refs and `handleEnded` to use `current.chapter`.

Change the play entry point:

```ts
function playChapter(context: PlaybackContext) {
  setCurrent(context);
  const audio = audioRef.current;
  if (audio) {
    audio.src = fileUrl(context.chapter.filePath);
    audio.load();
    void audio.play().catch(() => {});
  }
}
```

- [ ] **Step 3: Pass complete context from every playback surface**

Home featured card already has author/work/count context.

Author Detail creates:

```ts
{
  chapter,
  authorId: detail.id,
  authorName: detail.name,
  workId: work.id,
  workTitle: work.baseTitle,
  workTotalChapters: work.chapters.length,
  workPlayedChapters: work.chapters.filter((item) => item.played).length,
}
```

Harness playback uses the same factory. Do not invent placeholder creator/work names.

- [ ] **Step 4: Implement the compact PlayerBar**

New props:

```ts
{
  context: PlaybackContext | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  sleepMinutes: number | null;
  onToggle: () => void;
  onSeek: (secs: number) => void;
  onSkip: (delta: number) => void;
  onVolume: (v: number) => void;
  onSetSleep: (minutes: number | null) => void;
  onExpand: () => void;
  onOpenAuthor: (authorId: number) => void;
}
```

Show work art, creator avatar, creator/work/chapter hierarchy, progress, skip controls,
volume, sleep status, and an expand button. Keep the full range controls accessible.

- [ ] **Step 5: Implement NowPlayingPanel**

Render `role="dialog" aria-modal="true" aria-label="Now playing"`. On open:

- store the previously focused element;
- focus Close;
- add an Escape listener;
- trap Tab/Shift+Tab within focusable controls;
- restore focus when unmounted.

Reuse PlayerBar control callbacks; do not create a second audio element or playback
state.

- [ ] **Step 6: Wire the panel in App**

Render the panel adjacent to the shell when `current && playerExpanded`. `onOpenAuthor`
closes the panel before navigating.

- [ ] **Step 7: Run player tests and full frontend gate**

```powershell
npx vitest run src/player
npx tsc --noEmit
npm test
```

Expected: all PASS.

- [ ] **Step 8: Commit the richer player**

```powershell
git add src/App.tsx src/lib/api.ts src/player src/views
git commit -m "feat(player): add creator-rich expandable now playing" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 6: Redesign Home Around Creator Continuation

**Files:**
- Modify: `src/views/HomeView.tsx`
- Modify: `src/views/HomeView.test.tsx`
- Modify: `src/App.tsx`
- Reuse: `src/components/WorkCard.tsx`, `CreatorIdentity.tsx`, UI primitives

- [ ] **Step 1: Replace compatibility assertions with the failing redesigned Home assertions**

Tests must cover:

- heading `Keep listening to Alice`;
- feature work/chapter/remaining count/relative time/progress;
- Keep listening callback receives a full `PlaybackContext`;
- View creator callback;
- six-card You May Like grid with visible reasons;
- Recently listened creator/work/chapter/time;
- stats after action sections;
- empty state when there is no feature, no recommendation, and no history;
- recommendations still render when no feature exists.

Run:

```powershell
npx vitest run src/views/HomeView.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Implement the Home hierarchy**

Render:

```text
Home
Keep listening to [Creator]
You May Like
Recently listened
Your listening
```

Feature card uses:

```ts
keepListeningPercent(home.keepListening)
```

and creates the `PlaybackContext` from the featured data.

Recommendation cards:

- maximum six;
- responsive CSS grid;
- exact backend `reason`;
- `matchedTags` first, falling back to `tags`;
- progress from `recommendationPercent`;
- primary action opens the creator because recommendation rows do not yet carry a
  full `ChapterRow`;
- no fake Play button.

Recently listened remains compact and opens the creator via the new IDs.

- [ ] **Step 3: Keep Home fresh after playback changes**

After `handleEnded`, call `loadHome()` when the active route is Home or before the next
Home navigation. Also refresh Home after manual played toggles when returning Home
would otherwise show stale counts.

Use a `routeRef` if needed to avoid adding `route` to the one-time startup effect.

- [ ] **Step 4: Run Home tests and typecheck**

```powershell
npx vitest run src/views/HomeView.test.tsx src/lib/home.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit Home**

```powershell
git add src/App.tsx src/views/HomeView.tsx src/views/HomeView.test.tsx
git commit -m "feat(home): redesign personal listening dashboard" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 7: Restyle Library, Search, And Creator Detail

**Files:**
- Modify: `src/views/LibraryView.tsx`
- Modify: `src/views/LibraryView.test.tsx`
- Modify: `src/views/SortFilterBar.tsx`
- Modify: `src/views/SortFilterBar.test.tsx`
- Modify: `src/views/AuthorDetailView.tsx`
- Modify: `src/views/AuthorDetailView.test.tsx`
- Modify: `src/views/TagEditor.tsx`
- Modify: `src/views/TagEditor.test.tsx`

- [ ] **Step 1: Add failing creator-context assertions**

Library tests:

- search has an accessible Search icon/label;
- author rows expose circular avatar and enriched summary;
- work and chapter search hits show artwork plus creator identity;
- virtualization still renders fewer than 40 row/action buttons for 1000 authors;
- sort/filter callbacks and empty state remain intact.

Author Detail tests:

- creator hero exposes work count, chapter count, total duration, and played percent;
- Keep Listening emits `PlaybackContext` for the first unplayed chapter;
- work cards show progress and tags;
- grouping/tag controls remain keyboard reachable through their direct controls or
  overflow menu;
- collapse/sort behavior remains intact.

Run:

```powershell
npx vitest run src/views/LibraryView.test.tsx src/views/AuthorDetailView.test.tsx
```

Expected: FAIL on new UI assertions.

- [ ] **Step 2: Restyle the virtualized author list**

Keep:

```tsx
<div style={style}>
```

on the react-window outer row. Move all other visual styling to classes. Use
`CreatorAvatar`, creator name, `summarizeAuthor`, tags, and a chevron affordance.

Do not render a non-virtualized card grid of all authors.

- [ ] **Step 3: Restyle grouped search results**

Use:

- creator result row with `CreatorAvatar`;
- work result card/row with `WorkArtwork` and `CreatorIdentity`;
- chapter result row with work art and creator/work hierarchy.

Keep navigation behavior: every hit opens its creator.

- [ ] **Step 4: Build the creator hero**

Derive:

```ts
const chapters = detail.works.flatMap((work) => work.chapters);
const played = chapters.filter((chapter) => chapter.played).length;
const totalSecs = chapters.reduce((sum, chapter) => sum + chapter.durationSecs, 0);
const firstUnplayed = works
  .flatMap((work) => work.chapters.map((chapter) => ({ work, chapter })))
  .find(({ chapter }) => !chapter.played);
```

Show portrait, tags, counts, formatted duration, played percent, and Keep Listening
when `firstUnplayed` exists.

- [ ] **Step 5: Restyle works and chapter rows**

Each work section uses work artwork, title, progress, tags, sort/collapse controls,
and animated chapter expansion.

Chapter rows show:

- play;
- played checkbox with text/icon state;
- chapter title and duration;
- a compact `CreatorIdentity` with circular avatar and creator name;
- tag and grouping actions.

Use the shared `Menu` for secondary chapter actions:

- Edit chapter tags toggles the existing chapter tag editor.
- Edit grouping reveals and focuses the existing grouping form.
- Reset grouping calls the existing reset callback.

Keep Play and the played checkbox direct and always visible. Work and recommendation
card menus include Open creator. Tests must prove menu actions invoke the same
callbacks as the old direct controls.

- [ ] **Step 6: Restyle toolbar and TagEditor**

Use shared button/input/chip classes, local icons, visible labels, and consistent
focus. Preserve Enter-to-add and remove-tag behavior.

- [ ] **Step 7: Run view tests and scale check**

```powershell
npx vitest run src/views/LibraryView.test.tsx src/views/SortFilterBar.test.tsx src/views/AuthorDetailView.test.tsx src/views/TagEditor.test.tsx
npx tsc --noEmit
```

Expected: PASS, including the 1000-author bounded DOM test.

- [ ] **Step 8: Commit browsing views**

```powershell
git add src/views/LibraryView.tsx src/views/LibraryView.test.tsx src/views/SortFilterBar.tsx src/views/SortFilterBar.test.tsx src/views/AuthorDetailView.tsx src/views/AuthorDetailView.test.tsx src/views/TagEditor.tsx src/views/TagEditor.test.tsx
git commit -m "feat(browse): apply creator-rich library design" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 8: Restyle Discovery, Rename, Settings, And Scan States

**Files:**
- Modify: `src/views/DiscoveryView.tsx`
- Modify: `src/views/DiscoveryView.test.tsx`
- Modify: `src/views/RenameView.tsx`
- Modify: `src/views/RenameView.test.tsx`
- Modify: `src/views/SettingsView.tsx`
- Modify: `src/views/SettingsView.test.tsx`
- Modify: `src/views/ScanView.tsx`
- Modify: `src/views/ScanView.test.tsx`

- [ ] **Step 1: Add failing view assertions**

Discovery:

- For You and by-tag results use artwork cards;
- creator identity and shared-tag reason are visible;
- empty state explains tags/history;
- tag controls remain controlled.

Rename:

- preview table remains semantically a table;
- statuses have visible text and styled badges;
- apply/undo/refresh semantics remain unchanged;
- result and failures use Notice components.

Settings:

- first-run onboarding has a distinct hero/card;
- current root, choose, rescan, busy, error, and summary remain visible;
- shell owns normal back navigation.

Scan:

- loading state has a stable styled panel;
- completed state shows counts.

Run:

```powershell
npx vitest run src/views/DiscoveryView.test.tsx src/views/RenameView.test.tsx src/views/SettingsView.test.tsx src/views/ScanView.test.tsx
```

Expected: FAIL on new presentation assertions.

- [ ] **Step 2: Convert Discovery to the shared card grid**

Adapt each `DiscoveryWork` to `WorkCard`:

```ts
reason={
  work.sharedTags.length > 0
    ? `Shares ${work.sharedTags.slice(0, 2).join(" and ")}`
    : "Mostly unplayed"
}
```

This reason is factual from the existing discovery response. Show unplayed count and
shared tags. The action opens the creator.

- [ ] **Step 3: Restyle Rename without changing safety behavior**

Use shared buttons, Notice, Card, badges, and table classes. Keep:

- preview before mutation;
- conflicts and noops skipped;
- explicit apply;
- result failures;
- undo;
- refresh.

Do not introduce row-level automatic rename or any new filesystem call.

- [ ] **Step 4: Restyle Settings and Scan**

Use `folder`, `refresh`, and navigation icons. Preserve disabled state while busy and
`role="alert"` on errors.

- [ ] **Step 5: Run focused tests**

```powershell
npx vitest run src/views/DiscoveryView.test.tsx src/views/RenameView.test.tsx src/views/SettingsView.test.tsx src/views/ScanView.test.tsx
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit remaining views**

```powershell
git add src/views/DiscoveryView.tsx src/views/DiscoveryView.test.tsx src/views/RenameView.tsx src/views/RenameView.test.tsx src/views/SettingsView.tsx src/views/SettingsView.test.tsx src/views/ScanView.tsx src/views/ScanView.test.tsx
git commit -m "feat(ui): restyle discovery tools and settings" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 9: Add The Deterministic M12 Walkthrough

**Files:**
- Modify: `src/harness/walkthroughs.ts`
- Modify: `src/harness/runner.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing walkthrough-order test**

Add `m12Steps` test expecting:

```ts
[
  "home-empty",
  "home",
  "home-sidebar-collapsed",
  "library",
  "search",
  "author-detail",
  "discovery",
  "discovery-by-tag",
  "rename-preview",
  "settings",
  "player-compact",
  "player-expanded",
  "context-menu",
]
```

Run:

```powershell
npx vitest run src/harness/runner.test.ts
```

Expected: FAIL because `m12Steps` does not exist.

- [ ] **Step 2: Add m12Steps**

Define one callback per named state. Do not combine state changes that depend on a
React update from the previous step; each callback re-fetches what it needs.

- [ ] **Step 3: Wire the M12 harness state**

Add `"m12"` to `walkthroughs`.

In App's autostart switch, seed deterministic data:

- reset play history;
- author/work/chapter tags on at least three creators;
- finish two chapters on two dates;
- leave the latest played creator with a next unplayed chapter;
- refresh Home;
- open and close routes through normal handlers.

For the context-menu shot, expose a harness-only callback/state that opens a known
menu through component props. Do not use DOM query/click automation inside App.

For player shots:

- construct a real `PlaybackContext` from the first author/work/chapter;
- show compact state;
- set `playerExpanded=true`.

For rename preview, do not apply changes in the M12 walkthrough. Existing rename
walkthrough remains the mutation/undo regression.

- [ ] **Step 4: Run unit tests**

```powershell
npx vitest run src/harness/runner.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Build and run the M12 visual sequence**

```powershell
npm run build
cmd /c "tools\dev-env.cmd cargo clean -p audioshelf --manifest-path src-tauri\Cargo.toml"
cmd /c "tools\dev-env.cmd cargo tauri build --debug --no-bundle"
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m12 -OutputRoot .shots-after -SkipBuild
```

Expected: `WALKTHROUGH OK` and 13 PNGs.

- [ ] **Step 6: Inspect every M12 screenshot**

Use the image viewer on every PNG under `.shots-after\m12\`. Verify:

- no blank/unstyled screen;
- correct dark palette and active route;
- creator/work images and initials fallback;
- Home hierarchy and six recommendations;
- expanded/collapsed sidebar;
- virtualized list remains aligned;
- search grouping;
- creator hero and work/chapter controls;
- Discovery reasons;
- Rename/Settings clarity;
- compact and expanded player;
- context menu placement;
- no clipped controls at 1280x860.

Fix defects and rerun until all pass.

- [ ] **Step 7: Commit the walkthrough**

```powershell
git add src/App.tsx src/harness
git commit -m "test(harness): cover the complete M12 interface" -m "Co-authored-by: Codex <noreply@openai.com>"
```

---

### Task 10: Run Functional And Visual Regression Gates

**Files:**
- Modify only files required by discovered regressions

- [ ] **Step 1: Run frontend tests and typecheck**

```powershell
npx tsc --noEmit
npm test
```

Expected: all PASS.

- [ ] **Step 2: Run Rust tests**

```powershell
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
```

Expected: all PASS.

- [ ] **Step 3: Run every existing screenshot walkthrough**

Build once:

```powershell
npm run build
cmd /c "tools\dev-env.cmd cargo clean -p audioshelf --manifest-path src-tauri\Cargo.toml"
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough home -OutputRoot .shots-after
```

Then:

```powershell
$walkthroughs = @("browse","player","discovery","rename","grouping","settings","m7","covers","tags")
foreach ($name in $walkthroughs) {
  powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough $name -OutputRoot .shots-after -SkipBuild
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: every run prints `WALKTHROUGH OK`.

- [ ] **Step 4: Inspect all changed after-shots**

Read each `.shots-after\<walkthrough>\diff-manifest.txt`. Load every PNG marked
`CHANGED` or `NEW` and inspect it. Because M12 intentionally restyles every view, expect
nearly every shot to be changed.

Specific regressions:

- Home empty/populated content remains correct.
- Browse filters and sort values remain seeded.
- Player controls and hierarchy are visible.
- Discovery tag selection remains visible.
- Rename preview/apply/undo remains a complete round trip.
- Grouping merge/reset controls remain present.
- Settings root and scan summary remain readable.
- Search still groups authors/works/chapters.
- Real covers render and do not shift layout.
- Author/work/chapter tag editors remain usable.

- [ ] **Step 5: Verify motion and accessibility manually**

Run the Tauri development command in the foreground. Tauri starts Vite through the
configured `beforeDevCommand`, so do not launch a second dev server:

```powershell
cmd /c "tools\dev-env.cmd cargo tauri dev"
```

Verify:

- keyboard traversal through sidebar, cards, toolbar, PlayerBar, menu, and panel;
- visible focus ring;
- Escape closes menu and player panel;
- focus returns to invoking control;
- sidebar collapse remains usable;
- motion is smooth during route/card/player interactions;
- Windows Animation Effects off or DevTools reduced-motion emulation removes
  nonessential transforms.

Stop the dev processes after verification.

- [ ] **Step 6: Performance sanity check**

Use WebView/Chromium performance tooling while:

- scrolling the 43-author fixture list;
- rapidly opening/closing the sidebar;
- opening/closing the player panel;
- hovering several cards.

Acceptance:

- no continuous main-thread activity while idle;
- no animation loop;
- no dropped-frame burst caused by animated width/height on card grids;
- author virtualization remains bounded;
- image requests remain cached.

If sidebar width transition causes meaningful layout jank, change it to a transform
or grid-template approach while keeping the same visual behavior. Do not reduce all
motion preemptively.

- [ ] **Step 7: Commit any regression fixes**

If files changed:

```powershell
git add src src-tauri tools
git commit -m "fix(m12): address visual and accessibility regressions" -m "Co-authored-by: Codex <noreply@openai.com>"
```

If no files changed, do not create an empty commit.

---

### Task 11: Whole-Branch Review And Final Gate

**Files:**
- Review all files changed from `main`

- [ ] **Step 1: Review specification coverage**

Compare:

```powershell
git diff --stat main...HEAD
git diff main...HEAD
```

against every section of:

```text
docs/superpowers/specs/2026-06-12-audioshelf-m12-design-system.md
```

Confirm:

- every view is styled;
- every agreed audio context includes creator identity;
- recommendation reasons are factual;
- no obsolete per-view nav remains;
- no light-theme code exists;
- no unapproved behavior was added.

- [ ] **Step 2: Review safety and dependency drift**

Run:

```powershell
git diff main...HEAD -- src-tauri/src/db.rs src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json src-tauri/tests/fixture_scan.rs
```

Expected: no output.

Run:

```powershell
git status --short
```

Expected: only the pre-existing unrelated untracked `CTempbuild_out.txt` may remain.
Do not add, delete, or modify it.

- [ ] **Step 3: Run the exact final gate**

```powershell
npx tsc --noEmit
npm test
npm run build
cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m12 -OutputRoot .shots-after -SkipBuild
```

Expected: every command exits 0 and M12 screenshots have been inspected.

- [ ] **Step 4: Request whole-branch code review**

Use `superpowers:requesting-code-review`. Review for:

- backend ranking correctness and determinism;
- React state/route freshness;
- keyboard/focus behavior;
- invalid nested interactive markup;
- virtualized-list regressions;
- stale image cache assumptions;
- read-only-on-audio guarantee;
- screenshot coverage gaps.

Address all Critical and Important findings, then rerun Step 3.

---

### Task 12: Push, PR, CI, Merge, And Roadmap Completion

**Files:**
- Modify after implementation: `ROADMAP.md`

- [ ] **Step 1: Push the implementation branch**

Implementation should use branch:

```text
m12-design-system
```

Push:

```powershell
git push -u origin m12-design-system
```

- [ ] **Step 2: Open the PR**

```powershell
$body = @"
## Summary
- add AudioShelf's dark tokenized design system and shared component layer
- add creator-focused Home recommendations, collapsible navigation, and expandable now playing
- restyle every view while preserving chapter-at-a-time behavior and read-only library safety

## Test plan
- npx tsc --noEmit
- npm test
- npm run build
- cargo test through tools/dev-env.cmd
- M12 before/after screenshot matrix plus all existing walkthrough regressions
"@
gh pr create --repo yovanmc/AudioShelf --base main --head m12-design-system --title "M12 - Design System & Theming" --body $body
```

- [ ] **Step 3: Watch CI to completion**

```powershell
$pr = gh pr view m12-design-system --repo yovanmc/AudioShelf --json number --jq .number
gh pr checks $pr --repo yovanmc/AudioShelf --watch --interval 20
```

Expected: `build-and-test` passes. Fix failures on the branch and repeat; never merge
red.

- [ ] **Step 4: Update ROADMAP.md before merge**

On the feature branch, update M12 to:

- status `✅ Merged` only after the PR number is known and CI is green;
- plan link `[M12](docs/superpowers/plans/2026-06-12-audioshelf-m12-design-system.md)`;
- PR link;
- final frontend/Rust test counts;
- screenshot verification summary;
- confirmation of no schema/dependency/fixture-count drift;
- durable decisions and deviations.

Add a decision-log entry covering:

- dark-only replaces the originally drafted light/dark toggle;
- `sidebar_collapsed` is the only new setting;
- Home is one creator continuation feature plus six deterministic recommendations;
- small read-only Rust extension, no migration;
- local component/CSS system and local SVG icons, no UI dependency;
- expandable panel reuses one audio element and playback state;
- complete before/after screenshot matrix.

Commit:

```powershell
git add ROADMAP.md
git commit -m "docs(roadmap): mark M12 design system merged" -m "Co-authored-by: Codex <noreply@openai.com>"
git push
```

Wait for the updated CI run to pass.

- [ ] **Step 5: Merge and synchronize main**

```powershell
git switch main
$pr = gh pr view m12-design-system --repo yovanmc/AudioShelf --json number --jq .number
gh pr merge $pr --repo yovanmc/AudioShelf --merge --delete-branch
git pull --ff-only
```

- [ ] **Step 6: Final post-merge verification**

```powershell
git status --short --branch
git log -5 --oneline
```

Expected:

- `main` matches `origin/main`;
- the M12 merge commit is present;
- only the pre-existing unrelated untracked build-output file may remain.

---

## Done Criteria

- [ ] Dark-only tokens and shared components style every production view.
- [ ] Sidebar is persistent, collapsible, accessible, and persists under
  `sidebar_collapsed`.
- [ ] Home shows one `Keep listening to [Creator]` feature, up to six factual
  recommendations, recent history, and stats.
- [ ] Creator/work imagery and creator identity appear in every approved audio context.
- [ ] Library remains virtualized and search remains grouped.
- [ ] Creator Detail preserves played, grouping, tag, sort, and collapse behavior.
- [ ] Discovery, Rename, Settings, Scan, loading, empty, and error states use the system.
- [ ] Compact PlayerBar and expanded Now Playing panel share one playback state/audio
  element and preserve all existing controls.
- [ ] Motion is expressive, bounded, transform/opacity-led, and reduced-motion aware.
- [ ] Keyboard, focus, Escape, and focus restoration tests pass.
- [ ] No schema, dependency, fixture-count, or audio-file-mutation drift.
- [ ] TypeScript, frontend tests, build, Rust tests, M12 screenshots, and all existing
  walkthroughs pass.
- [ ] Whole-branch review has no unresolved Critical or Important findings.
- [ ] PR is CI-green, merged with merge commit, and `ROADMAP.md` records completion.
