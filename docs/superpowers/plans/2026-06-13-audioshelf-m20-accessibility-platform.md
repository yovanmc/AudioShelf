# M20 — Accessibility & Platform Integration (AudioShelf)

> **Written for Sonnet execution.** Each task lists exact files, the code to write, the
> command to run, and the expected result. **If something doesn't match what you find in the
> repo (a snippet has drifted, a line moved, a name differs), STOP and report rather than
> guess.** The line numbers below are from a 2026-06-13 read and may have shifted by a few
> lines — anchor on the quoted code, not the numbers.

Project: AudioShelf — Windows desktop spoken-audio library player. Tauri 2 + React 18 +
TypeScript + SQLite (rusqlite). Repo `C:\Agent Projects\AudioShelf`, default branch `main`.
This is milestone **M20** of the **v5 — Depth & Reach** track (M16–M19 already ✅ Merged).

---

## 0. Goal, scope, and hard invariants

M20 makes AudioShelf **accessible and natively integrated with Windows**. The user chose
(AskUserQuestion, 2026-06-13) the **broad** scope: every accessibility "curb-cut" **plus**
media-key/SMTC integration **plus** the always-on-top mini-player window — all in one
milestone (mirrors the M16–M19 broad pattern).

**Eleven sub-features:**

1. **A11y preferences foundation** — one `a11y_prefs` JSON setting applied as `data-*`
   attributes on `.app-shell` (mirrors M19 `data-density`).
2. **Light + high-contrast themes** — `[data-theme]` token override blocks + `forced-colors`
   support (revisits the deliberately-dropped light toggle, reframed as accessibility).
3. **Text-size + dyslexia-friendly font** — `[data-text-size]` type scale + `[data-font]` toggle.
4. **Reduced-motion** — `prefers-reduced-motion` media query **and** a manual
   `[data-reduced-motion]` override. **NO Motion One / animation library** (see §Forks).
5. **Settings → Accessibility section** — UI to drive all of the above.
6. **Color-blind-safe + icon-augmented status** — status (played / in-progress / unstarted)
   distinguishable by **shape/icon**, not color alone.
7. **Full keyboard operability + focus** — skip-to-content link, Dialog focus-trap +
   return-focus, global playback shortcuts (Space / arrows), focus-ring audit.
8. **Screen-reader semantics** — browse `role="tree"`, player `aria-live` region, landmarks.
9. **RTL / i18n readiness** — CSS logical properties + `dir="auto"` on user content. **NO
   translation framework**, strings stay English (see §Forks).
10. **Media keys + SMTC card** — `navigator.mediaSession` (metadata + action handlers +
    position state). WebView2 auto-bridges to the Windows now-playing card & hardware media
    keys. **Pure TypeScript, no new dependency** (see §Forks).
11. **Focus / mini-player widget** — an always-on-top second Tauri window acting as a remote
    control, state-synced to the main window via Tauri events.

### Hard invariants (verify each at the end — these define "done")

- **NO schema migration.** All a11y prefs live in one `a11y_prefs` row of the existing
  `settings` table. `LATEST` stays **7**. `db.rs migrate()` untouched. (Returns to the M18
  no-migration approach.)
- **NO new crate or npm dependency.** `Cargo.toml` / `Cargo.lock` / `package.json` /
  `package-lock.json` stay **byte-identical** (verify with `git diff --stat`). Media Session
  is a web API; the mini-player uses Tauri's built-in windowing + `@tauri-apps/api/event`
  (already a dep); reduced-motion is CSS-only; the dyslexia font uses a **system** stack (no
  bundled font file, no asset).
- **Read-only-on-disk preserved.** The only new write is the `a11y_prefs` SQLite setting.
  Rename stays the sole audio-file mutator. The mini-player creates **no files**.
- **Fixtures stay 43/44/47.** All M20 behavior is seeded/toggled at runtime in the new `m20`
  walkthrough; `fixture_scan.rs` and the on-disk fixtures are untouched.
- **No cross-screen regressions** beyond intentional a11y additions (the `m12` 15-shot matrix
  must still pass; a "pop out player" button in the expanded Now Playing is the only new
  always-visible control).

### Product forks already decided (do not re-litigate)

- **Scope = broad / all 11**, including the mini-player window.
- **Media keys = Media Session API** (`navigator.mediaSession`), **not** native WinRT SMTC.
  Zero new dep. The OS now-playing card is populated automatically by WebView2/Chromium from
  the metadata we set; hardware media keys route to our action handlers.
- **i18n = readiness only** — convert physical CSS → logical properties, add `dir="auto"` on
  user content, verify nothing breaks under `dir="rtl"`. **No** react-i18next, **no** locale
  files, strings remain hardcoded English.
- **Reduced-motion = CSS only.** Do **NOT** add Motion One or any animation library (a prior
  subagent digest suggested this — it is wrong; the app has no animation dep and needs none).
- **Dyslexia font = system stack** (`Verdana, Tahoma, "Segoe UI", sans-serif` + increased
  letter/word spacing + line-height), **not** a bundled OpenDyslexic file. Keeps the build
  offline-safe and dependency/asset-free. (A future milestone may bundle OpenDyslexic.)

---

## 1. Key existing code to mirror (verbatim anchors)

**`src/lib/density.ts`** (template for the new `src/lib/a11y.ts`):
```typescript
export type Density = "compact" | "comfortable" | "spacious";
const VALID: Density[] = ["compact", "comfortable", "spacious"];
export function parseDensity(raw: string | null): Density {
  return VALID.includes(raw as Density) ? (raw as Density) : "comfortable";
}
```

**`src/styles/tokens.css`** `:root` block (every token — author `[data-theme]` overrides against these names):
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
  --color-accent-muted: rgb(33 139 255 / 55%);
  --color-success: #39b8a0;
  --color-warning: #e7a94b;
  --color-danger: #ef6b73;
  --focus-ring: 0 0 0 3px rgb(33 139 255 / 38%);
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px;
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 18px;
  --shadow-card: 0 10px 30px rgb(0 0 0 / 24%);
  --shadow-overlay: 0 24px 80px rgb(0 0 0 / 55%);
  --sidebar-expanded: 224px; --sidebar-collapsed: 72px;
  --player-height: 96px; --content-max: 1480px;
  --motion-fast: 140ms; --motion-normal: 220ms; --motion-slow: 340ms;
  --ease-standard: cubic-bezier(.2, .8, .2, 1);
}
```
> There are **no** `--font-*` / type-ramp tokens yet — Task 3 introduces `--font-scale` and
> `--font-family`. Font sizes today are literal `px`/`rem` in `base.css`/`components.css`.

**`src/components/AppShell.tsx`** — signature + the outer wrapper line (Task 1 adds new props + data-* attrs here):
```tsx
export function AppShell({ active, collapsed, onCollapsedChange, onHome, onLibrary, onDiscovery,
  onRename, onMetadata, onSettings, onJournal, onInsights, onCollections, density, children, player }: {
  active: ShellRoute; collapsed: boolean; onCollapsedChange: (c: boolean) => void;
  /* …all the on* callbacks… */ density: Density; children: ReactNode; player: ReactNode;
}) {
  /* … */
  return (
    <div className={`app-shell${collapsed ? " app-shell--collapsed" : ""}`} data-density={density}>
```
Nav items + button (Task 8 adds tree roles; Task 7 adds the skip link just inside this return):
```tsx
const items: Array<{ key: ShellRoute; label: string; icon: IconName; action: () => void }> = [
  { key: "home", label: "Home", icon: "home", action: onHome }, /* …8 items… */
];
const navButton = (item) => (
  <button className="sidebar__item" aria-label={item.label} title={item.label}
    aria-current={active === item.key ? "page" : undefined} onClick={item.action}>
    <Icon name={item.icon} /><span className="sidebar__label">{item.label}</span>
  </button>
);
// rendered as: <nav className="sidebar__nav">{items.map(navButton)}</nav>
// inside: <aside className="sidebar" aria-label="Primary navigation"> …
```

**`src/App.tsx`** anchors:
- Settings load (init `useEffect`, ~L886–914):
  ```typescript
  setBrowsePrefs(parseBrowsePrefs(await getSetting("browse_prefs")));
  setSidebarCollapsedState((await getSetting("sidebar_collapsed")) === "true");
  setHomeShelves(parseHomeShelves(await getSetting("home_shelves")).shelves);
  setDensity(parseDensity(await getSetting("library_density")));
  ```
- State decls (~L156–158): `const [density, setDensity] = useState<Density>("comfortable");`
- Playback state (~L216–233): `current: PlaybackContext | null`, `isPlaying`, `currentTime`,
  `duration`, `audioRef`. `PlaybackContext` carries `chapter` (`title`, `id`, `filePath`,
  `chapterNo`), `authorId`, `authorName`, `workId`, `workTitle`, `workTotalChapters`,
  `workPlayedChapters`. Cover for the playing work = `WorkArtwork workId=` → `getWorkCover(id)`
  → `fileUrl(path)`.
- Ctrl+K handler (~L1673): `window.addEventListener("keydown", onKey)` inside a `useEffect`.
- Walkthrough dispatch is a long ternary: `… : args.walkthrough === "m19" ? m19Steps({…}) : …`.

**`src/components/ui.tsx` `Dialog`** (Task 7 adds focus-trap + return-focus):
```tsx
export function Dialog({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`card dialog ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={label}>
        <IconButton className="dialog__close" icon="close" label={`Close ${label}`} onClick={onClose} {...{ "data-autofocus": true }} />
        {children}
      </div>
    </div>
  );
}
```

**`src/harness/walkthroughs.ts`** — `Step` is `{ name: string; run: () => Promise<void> }`;
`m19Steps(nav: {…}): Step[]` returns `[{ name, run: nav.xxx }, …]`; the `walkthroughs`
const array (~L51) lists every name and must gain `"m20"`.

**`src-tauri/src/lib.rs`** Builder chain (Task 11 adds the command + capability):
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(args)
    .setup(|app| { /* db + covers asset scope */ Ok(()) })
    .invoke_handler(tauri::generate_handler![
        get_launch_args, capture::capture_window, capture::finish_walkthrough,
        commands::scan_library, /* …~80 commands… */ commands::stage_db_restore
    ])
    .run(tauri::generate_context!())
```
No multi-window code exists today. Routing is **state-based** (`type Route = …` union), **not**
hash routing — the mini-player window is detected via a **`?miniplayer=1` query param**.

---

## 2. Execution order

Mostly frontend; the only Rust is Task 11's window command. Several tasks edit shared files
(`tokens.css`, `base.css`, `components.css`, `App.tsx`, `AppShell.tsx`, `SettingsView.tsx`,
`ui.tsx`), so **run tasks serially in the order below** (one Sonnet subagent per task,
controller reviews each commit before dispatching the next). After every task: `npx tsc
--noEmit` + `npm test` must stay green.

---

### Task 1 — A11y preferences foundation (`a11y.ts` + App load + AppShell data-attrs)

**New file `src/lib/a11y.ts`:**
```typescript
export type Theme = "dark" | "light" | "high-contrast";
export type TextSize = "normal" | "large" | "xlarge";
export interface A11yPrefs {
  theme: Theme;
  textSize: TextSize;
  dyslexiaFont: boolean;
  reducedMotion: boolean;   // manual override; OS prefers-reduced-motion also applies via CSS
}
export const DEFAULT_A11Y: A11yPrefs = { theme: "dark", textSize: "normal", dyslexiaFont: false, reducedMotion: false };
const THEMES: Theme[] = ["dark", "light", "high-contrast"];
const SIZES: TextSize[] = ["normal", "large", "xlarge"];
export function parseA11yPrefs(raw: string | null): A11yPrefs {
  if (!raw) return { ...DEFAULT_A11Y };
  try {
    const o = JSON.parse(raw) as Partial<A11yPrefs>;
    return {
      theme: THEMES.includes(o.theme as Theme) ? (o.theme as Theme) : "dark",
      textSize: SIZES.includes(o.textSize as TextSize) ? (o.textSize as TextSize) : "normal",
      dyslexiaFont: o.dyslexiaFont === true,
      reducedMotion: o.reducedMotion === true,
    };
  } catch { return { ...DEFAULT_A11Y }; }
}
/** data-* attribute map to spread on the shell root. Omit a key when it equals the default
 * so dark/normal stays attribute-free (cleaner CSS + matches the no-attr baseline). */
export function a11yDataAttrs(p: A11yPrefs): Record<string, string> {
  const a: Record<string, string> = {};
  if (p.theme !== "dark") a["data-theme"] = p.theme;
  if (p.textSize !== "normal") a["data-text-size"] = p.textSize;
  if (p.dyslexiaFont) a["data-font"] = "dyslexia";
  if (p.reducedMotion) a["data-reduced-motion"] = "true";
  return a;
}
```

**New file `src/lib/a11y.test.ts`** — unit-test `parseA11yPrefs` (null → default; bad JSON →
default; unknown theme/size → fallback; valid round-trip) and `a11yDataAttrs` (dark/normal →
`{}`; light + large + dyslexia + reduced → all four keys).

**`src/App.tsx`:**
- Add state near density: `const [a11y, setA11y] = useState<A11yPrefs>(DEFAULT_A11Y);`
- In the init `useEffect` settings block, add:
  `setA11y(parseA11yPrefs(await getSetting("a11y_prefs")));`
- Add a setter used by Settings (mirror `setDensity` persistence — find how density is
  persisted; it's saved via `setSetting("library_density", …)` when changed in SettingsView):
  ```typescript
  const updateA11y = (next: A11yPrefs) => { setA11y(next); void setSetting("a11y_prefs", JSON.stringify(next)); };
  ```
- Pass `a11y={a11y}` to `<AppShell …>` (new prop) and `a11y`/`updateA11y` down to the
  settings route render (wherever `density`/`onDensityChange` is passed to SettingsView).
- Import `parseA11yPrefs, DEFAULT_A11Y, type A11yPrefs, a11yDataAttrs` from `./lib/a11y` and
  `setSetting` (already imported for other settings).

**`src/components/AppShell.tsx`:**
- Add `a11y: A11yPrefs` to the props type + destructure. Import `A11yPrefs, a11yDataAttrs`.
- Spread the attrs onto the outer div:
  ```tsx
  return (
    <div className={`app-shell${collapsed ? " app-shell--collapsed" : ""}`} data-density={density} {...a11yDataAttrs(a11y)}>
  ```
- Update `AppShell.test.tsx` for the new mandatory `a11y` prop (pass `DEFAULT_A11Y`).

**Verify:** `npx tsc --noEmit` clean · `npm test` green (incl. new a11y tests).
**Commit:** `M20: a11y prefs foundation (a11y.ts + shell data-attributes)`

---

### Task 2 — Light + high-contrast themes + forced-colors (`tokens.css`)

Append to `src/styles/tokens.css` (after `:root`). Override **every color token** per theme;
leave spacing/radius/motion inherited. Use `color-scheme` per theme so native form controls /
scrollbars match.

```css
[data-theme="light"] {
  color-scheme: light;
  --color-bg: #f4f7fb;
  --color-sidebar: #e9eef6;
  --color-surface: #ffffff;
  --color-surface-raised: #f0f4fa;
  --color-surface-hover: #e6edf6;
  --color-border: #d3dde9;
  --color-border-strong: #aebfd2;
  --color-text: #14202e;
  --color-text-muted: #56657a;
  --color-accent: #1b6fd0;
  --color-accent-hover: #1559a8;
  --color-accent-soft: rgb(27 111 208 / 12%);
  --color-accent-muted: rgb(27 111 208 / 55%);
  --color-success: #1f8a73;
  --color-warning: #b9791f;
  --color-danger: #c83f47;
  --focus-ring: 0 0 0 3px rgb(27 111 208 / 40%);
  --shadow-card: 0 10px 30px rgb(20 32 46 / 10%);
  --shadow-overlay: 0 24px 80px rgb(20 32 46 / 28%);
}
[data-theme="high-contrast"] {
  color-scheme: dark;
  --color-bg: #000000;
  --color-sidebar: #000000;
  --color-surface: #0a0a0a;
  --color-surface-raised: #141414;
  --color-surface-hover: #1f1f1f;
  --color-border: #ffffff;
  --color-border-strong: #ffffff;
  --color-text: #ffffff;
  --color-text-muted: #e6e6e6;
  --color-accent: #ffd000;
  --color-accent-hover: #ffe24d;
  --color-accent-soft: rgb(255 208 0 / 22%);
  --color-accent-muted: rgb(255 208 0 / 70%);
  --color-success: #4dffb0;
  --color-warning: #ffd000;
  --color-danger: #ff6b6b;
  --focus-ring: 0 0 0 3px #ffd000;
  --shadow-card: none;
  --shadow-overlay: 0 0 0 1px #ffffff;
}
/* Windows High Contrast / forced-colors: let the OS drive colors, keep focus visible. */
@media (forced-colors: active) {
  :root { --focus-ring: 0 0 0 2px CanvasText; }
  .button, .icon-button, .card, .sidebar__item, input, select { border: 1px solid CanvasText; }
}
```

> After this, **manually skim `base.css`, `components.css`, `layout.css` for any hardcoded
> hex color that should be a token** (a hardcoded dark color would not flip in light mode). If
> you find one, convert it to the matching `var(--color-*)`. STOP and report if a color has no
> clean token equivalent.

**Verify:** `npx tsc --noEmit` · `npm test`. (Visual proof comes in the `m20` walkthrough.)
**Commit:** `M20: light + high-contrast theme tokens + forced-colors support`

---

### Task 3 — Text-size scale + dyslexia-friendly font

**`src/styles/tokens.css`** — add to `:root`:
```css
  --font-scale: 1;
  --font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  --letter-spacing: normal;
  --word-spacing: normal;
```
Add override blocks:
```css
[data-text-size="large"]  { --font-scale: 1.15; }
[data-text-size="xlarge"] { --font-scale: 1.3; }
[data-font="dyslexia"] {
  --font-family: Verdana, Tahoma, "Segoe UI", sans-serif;
  --letter-spacing: 0.03em;
  --word-spacing: 0.08em;
  line-height: 1.7;
}
```
**`src/styles/base.css`** — make the root font respect the scale + family. Find the
`body`/`#root` font rule and set:
```css
body {
  font-family: var(--font-family);
  font-size: calc(16px * var(--font-scale));
  letter-spacing: var(--letter-spacing);
  word-spacing: var(--word-spacing);
}
```
> If `base.css` uses fixed `px` font-sizes on many elements, they won't scale. Prefer `rem`
> where a quick swap is safe, but **do not** do a sweeping rem-refactor — scaling the root
> `body` font + any `em`/`rem`-based children is sufficient for this milestone. Components using
> literal `px` font-size stay fixed; note that in the commit message and move on (don't
> over-engineer; the text-size control is a meaningful aid even if partial).

**Verify:** `npx tsc --noEmit` · `npm test`.
**Commit:** `M20: text-size scale + dyslexia-friendly font option`

---

### Task 4 — Reduced-motion (CSS only — NO animation library)

**`src/styles/base.css`** — append:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
[data-reduced-motion="true"] *, [data-reduced-motion="true"] *::before, [data-reduced-motion="true"] *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}
```
> Grep `src/` for any JS-driven animation (`requestAnimationFrame`, `setInterval`-based
> count-up, `.animate(`). AudioShelf is expected to have **none** of consequence — if you find
> a JS animation (e.g., a stat count-up), gate it behind `a11y.reducedMotion` (pass the flag in
> and skip the animation, render the final value). **Do NOT add Motion One or any package.**

**Verify:** `npx tsc --noEmit` · `npm test`.
**Commit:** `M20: reduced-motion (OS media query + manual override)`

---

### Task 5 — Settings → Accessibility section

**`src/views/SettingsView.tsx`** — add a new "Accessibility" section mirroring the existing
section pattern (find how the Density control is rendered; copy its markup/classes). It needs
props `a11y: A11yPrefs` and `onA11yChange: (next: A11yPrefs) => void` (wired from App's
`a11y`/`updateA11y` in Task 1 — add them to the SettingsView props type + the App render site).

Controls:
- **Theme** — a segmented control or `<select aria-label="Theme">` over Dark / Light / High
  contrast → `onA11yChange({ ...a11y, theme })`.
- **Text size** — Normal / Large / Extra large → `textSize`.
- **Dyslexia-friendly font** — toggle → `dyslexiaFont`.
- **Reduce motion** — toggle → `reducedMotion`.

Each control reads from `a11y` (controlled) and writes via `onA11yChange`. Reuse existing
toggle/select components from `ui.tsx` (check what the density/other settings use — match it).

**Update `SettingsView.test.tsx`** for the new mandatory props (pass `DEFAULT_A11Y` + a noop).

**Verify:** `npx tsc --noEmit` · `npm test`.
**Commit:** `M20: Accessibility settings section (theme / text size / font / motion)`

---

### Task 6 — Color-blind-safe + icon-augmented status

Status today relies on color alone in a few spots. Make each distinguishable by **shape/icon**:

- **`src/player/NowPlayingPanel.tsx`** "In this work" list — the `chapter-jump__dot` currently
  shows played via color. Add an icon inside (e.g. a check `Icon name="check"` for played, an
  outline/empty circle otherwise), keeping `aria-hidden` on the purely-decorative part but
  ensuring the text label ("played") remains for SR users.
- **`src/components/WorkCard.tsx`** (and any progress/status pill) — wherever a played /
  in-progress / unstarted state is shown by a colored pill or bar, add a small leading icon or
  a distinct fill pattern. In-progress: a half/partial glyph; done: check; unstarted: empty
  ring. Ensure `aria-label` conveys the status in words.
- **Library played-status tabs** (M15) — if the active/played state is color-only, add an icon.

If `Icon.tsx` lacks a needed glyph (`check`, `circle`, `circle-half`), add it as a single
`<path d="…">` following the existing one-path-per-glyph convention (see the M18 note that
`Icon.tsx` uses `stroke="currentColor" fill="none"` single paths). Pick simple stroked paths.

Update CSS as needed (`components.css`) so the icon sits inline with the pill/dot without
layout shift. Add/adjust unit tests where a component's status rendering is tested.

**Verify:** `npx tsc --noEmit` · `npm test`.
**Commit:** `M20: color-blind-safe icon-augmented status indicators`

---

### Task 7 — Keyboard operability + focus management

**(a) Skip-to-content link — `src/components/AppShell.tsx`.** As the very first child inside
the shell return (before the sidebar), add:
```tsx
<a className="skip-link" href="#main-content">Skip to content</a>
```
Give the main content region an id + focus target. Find where `children` is rendered (the
`<main>` / content wrapper) and ensure it is `<main id="main-content" tabIndex={-1}>` (add the
landmark if it's a `<div>` today — but verify there isn't already a `<main>`; if there is, just
add `id`/`tabIndex`). CSS in `components.css`:
```css
.skip-link {
  position: absolute; left: var(--space-3); top: -48px; z-index: 1000;
  background: var(--color-accent); color: #fff; padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm); transition: top var(--motion-fast) var(--ease-standard);
}
.skip-link:focus { top: var(--space-3); }
```

**(b) Dialog focus-trap + return-focus — `src/components/ui.tsx`.** Extend the `Dialog`
`useEffect`:
- On mount, capture `const prev = document.activeElement as HTMLElement | null;` and on cleanup
  `prev?.focus();`.
- Add a `keydown` Tab handler that keeps focus inside `ref.current`: collect focusable
  elements (`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`), and on
  Tab/Shift+Tab at the boundary, wrap to the other end (`e.preventDefault()` + focus).
  Keep the existing Escape-close and `[data-autofocus]` behavior.

**(c) Global playback keyboard shortcuts — `src/App.tsx`.** Add a `useEffect` (sibling to the
Ctrl+K one) with a guard so it never hijacks typing or fires with no track:
```typescript
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!currentRef.current) return;            // no active track → ignore
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowLeft")  { e.preventDefault(); skip(e.shiftKey ? -30 : -15); }
    else if (e.key === "ArrowRight") { e.preventDefault(); skip(e.shiftKey ?  30 :  15); }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);   // uses refs + stable callbacks; verify togglePlay/skip names match the real ones
```
> Use the **actual** toggle/skip function names from App.tsx (the PlayerBar gets `onToggle` /
> `onSkip` — find the functions behind them). If they're not stable across renders, route
> through a ref like `currentRef`. STOP and report if Space is already bound elsewhere.

**(d) Focus-ring audit — `src/styles/components.css`.** The `:focus-visible` rule already
covers `.button, .icon-button, .chip--toggle, .sidebar__item, input, [role="menuitem"],
.time-label`. Extend the selector list to include `a, select, [role="treeitem"],
[tabindex="0"]` so every interactive element shows `var(--focus-ring)`. Confirm nothing sets
`outline: none` without a replacement box-shadow.

**Verify:** `npx tsc --noEmit` · `npm test` (add a Dialog focus-trap test: Tab from last
focusable wraps to first).
**Commit:** `M20: keyboard operability — skip link, dialog focus trap, playback shortcuts`

---

### Task 8 — Screen-reader semantics

**(a) Browse tree — `src/views/AuthorDetailView.tsx`** (creator → works → chapters). Add ARIA
tree semantics to the existing structure **without changing layout**:
- Container: `role="tree" aria-label="Works and chapters"`.
- Each work group: `role="treeitem" aria-expanded={expanded} aria-level={1}` with its chapter
  list in a `role="group"`.
- Each chapter row: `role="treeitem" aria-level={2}`.
> Only add roles to the existing elements; do not restructure. If the markup makes correct
> tree semantics impossible without a refactor, fall back to ensuring it's a proper nested
> list with headings + `aria-label`s and report the limitation — do not force a risky refactor.

**(b) Player live region — `src/player/PlayerBar.tsx` + the expanded panel.** Wrap the now-
playing track/work title text in a polite live region so SR users hear track changes:
```tsx
<div className="player-bar__meta" role="region" aria-label="Now playing" aria-live="polite">
  …title / author…
</div>
```
Ensure play/pause announces (the button already has dynamic `label={isPlaying ? "Pause" :
"Play"}` — good). Do **not** put `aria-live` on a frequently-updating element (don't wrap the
seconds counter — that would spam SR output); only the title/author block.

**(c) Landmarks.** Confirm `<main id="main-content">` (Task 7), `<aside aria-label="Primary
navigation">` (exists). Add `role="contentinfo"`/`aria-label` to the player bar container if
it's a bare `<div>` (e.g. `aria-label="Audio player"`).

**Verify:** `npx tsc --noEmit` · `npm test`.
**Commit:** `M20: screen-reader semantics — browse tree, live player region, landmarks`

---

### Task 9 — RTL / i18n readiness (logical properties + dir="auto")

No framework. Two mechanical passes:

**(a) Logical properties — `components.css`, `layout.css`, `base.css`.** Convert physical →
logical so an RTL `dir` mirrors correctly:
- `margin-left` → `margin-inline-start`; `margin-right` → `margin-inline-end` (same for
  `padding-*`).
- `left:` / `right:` in positioned elements → `inset-inline-start` / `inset-inline-end` where
  the element should flip (sidebar, skip-link, dialog close, menus). Leave genuinely
  symmetric/centered offsets alone.
- `text-align: left|right` → `start|end`.
- `border-left|right` → `border-inline-start|end` where it denotes a leading/trailing accent.
> Be surgical: convert directional layout, not things like icon nudges that must stay fixed.
> Grep for `margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)|\bleft:|\bright:`
> and convert case-by-case. STOP and report if a conversion would visibly change the default
> LTR layout (it shouldn't — logical props equal physical ones in LTR).

**(b) `dir="auto"` on user content.** Add `dir="auto"` to elements rendering library-derived
text (creator names, work titles, chapter titles) so a Hebrew/Arabic title renders RTL while
the English chrome stays LTR. Touch the shared renderers: `CreatorIdentity`/`CreatorAvatar`
name, `WorkCard` title, chapter row title, PlayerBar title. One `dir="auto"` per text element.

**Verify:** `npx tsc --noEmit` · `npm test`. The `m20` walkthrough's `rtl-layout` shot
(toggles `document.documentElement.dir = "rtl"`) proves nothing collapses.
**Commit:** `M20: RTL/i18n readiness — logical properties + dir=auto on user content`

---

### Task 10 — Media Session API (media keys + Windows SMTC card)

**New file `src/lib/mediaSession.ts`** — pure, unit-testable; takes a `MediaSession`-like
object so tests can pass a mock:
```typescript
export interface NowPlayingMeta { title: string; author: string; work: string; artwork?: string; }
export interface MediaSessionHandlers {
  onPlay: () => void; onPause: () => void;
  onPrevChapter: () => void; onNextChapter: () => void;
  onSeekBackward: (s: number) => void; onSeekForward: (s: number) => void;
  onSeekTo: (positionSec: number) => void;
}
type MSLike = {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler: (a: string, h: ((d?: { seekOffset?: number; seekTime?: number }) => void) | null) => void;
  setPositionState?: (s: { duration: number; position: number; playbackRate: number }) => void;
};
export function buildMetadata(m: NowPlayingMeta): { title: string; artist: string; album: string; artwork: { src: string; sizes: string; type: string }[] } {
  return { title: m.title, artist: m.author, album: m.work,
    artwork: m.artwork ? [{ src: m.artwork, sizes: "512x512", type: "image/jpeg" }] : [] };
}
export function applyMediaSession(ms: MSLike | undefined, meta: NowPlayingMeta | null, isPlaying: boolean, h: MediaSessionHandlers): void {
  if (!ms) return;
  if (!meta) { ms.metadata = null; ms.playbackState = "none"; return; }
  // MediaMetadata is a global in the WebView; guard for tests where it's absent.
  const MM = (globalThis as { MediaMetadata?: new (i: unknown) => unknown }).MediaMetadata;
  ms.metadata = MM ? new MM(buildMetadata(meta)) : buildMetadata(meta);
  ms.playbackState = isPlaying ? "playing" : "paused";
  ms.setActionHandler("play", () => h.onPlay());
  ms.setActionHandler("pause", () => h.onPause());
  ms.setActionHandler("previoustrack", () => h.onPrevChapter());
  ms.setActionHandler("nexttrack", () => h.onNextChapter());
  ms.setActionHandler("seekbackward", (d) => h.onSeekBackward(d?.seekOffset ?? 15));
  ms.setActionHandler("seekforward", (d) => h.onSeekForward(d?.seekOffset ?? 15));
  ms.setActionHandler("seekto", (d) => { if (d?.seekTime != null) h.onSeekTo(d.seekTime); });
}
export function updatePosition(ms: MSLike | undefined, duration: number, position: number): void {
  if (ms?.setPositionState && duration > 0 && position <= duration && position >= 0) {
    ms.setPositionState({ duration, position, playbackRate: 1 });
  }
}
```

**New file `src/lib/mediaSession.test.ts`** — with a mock `ms` object assert: null meta clears
metadata + sets `"none"`; non-null sets metadata + correct `playbackState`; each action handler
is registered and invokes the matching callback; `updatePosition` ignores out-of-range/zero.

**`src/App.tsx` wiring:**
- A `useEffect` keyed on `[current, isPlaying]` that builds the `NowPlayingMeta` from `current`
  (title = `current.chapter.title`, author = `current.authorName`, work = `current.workTitle`,
  artwork = the resolved cover asset URL — fetch via the same `getWorkCover(current.workId)` →
  `fileUrl` path already used by `WorkArtwork`; if resolving async is awkward, pass the cover
  URL you already have, or omit artwork — the card still works) and calls
  `applyMediaSession(navigator.mediaSession, meta, isPlaying, handlers)`. Handlers map to the
  real functions: `onPlay/onPause` → the same toggle path; `onPrev/Next` → play previous/next
  chapter in `currentWorkChapters` (reuse the M14 chapter-jump logic / `playChapter`);
  `onSeekBackward/Forward` → `skip(-s)/skip(s)`; `onSeekTo` → seek `audioRef.current.currentTime = pos`.
- A `useEffect` on `[currentTime, duration]` (or inside the existing `onTimeUpdate`) calling
  `updatePosition(navigator.mediaSession, duration, currentTime)`.
- Guard everything with `"mediaSession" in navigator`.

> The OS now-playing card and hardware media keys are an **OS surface** the app harness can't
> screenshot. Verification = the `mediaSession.test.ts` unit tests + the controller noting the
> card is confirmed manually (and the `m20` `media-session` shot can render a small in-app
> "Media keys active" affirmation panel for visual proof — optional).

**Verify:** `npx tsc --noEmit` · `npm test`.
**Commit:** `M20: Media Session API — SMTC now-playing card + hardware media keys`

---

### Task 11 — Focus / mini-player window (second always-on-top Tauri window)

**(a) Rust commands — `src-tauri/src/commands.rs`:**
```rust
#[tauri::command]
pub fn open_mini_player(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    if let Some(w) = app.get_webview_window("miniplayer") {
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "miniplayer", WebviewUrl::App("index.html?miniplayer=1".into()))
        .title("AudioShelf — Mini player")
        .inner_size(340.0, 132.0)
        .min_inner_size(280.0, 120.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_mini_player(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("miniplayer") { w.close().map_err(|e| e.to_string())?; }
    Ok(())
}
```
Register both in `lib.rs` `generate_handler![…]` (add `commands::open_mini_player,
commands::close_mini_player`). Import `tauri::Manager` if `get_webview_window` needs it (it's
on the `Manager` trait — add `use tauri::Manager;` at the top of `commands.rs` if not present).

**(b) Capability — `src-tauri/capabilities/default.json`.** Check the `"windows"` field. If it
targets only `"main"` (or omits the miniplayer label), add `"miniplayer"` so the second window
inherits `core:default` (events). Prefer `"windows": ["main", "miniplayer"]`. **No new
permission string is needed** (event emit/listen are in `core:default`; the window is created
from Rust, needing no JS window-create permission). If `"windows"` is `["*"]` already, no edit.

**(c) Mini-player detection — `src/App.tsx`, very top of the component render.** Before the
normal shell, early-return the compact remote when launched as the mini window:
```typescript
const isMiniPlayer = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("miniplayer") === "1";
// …after hooks that must run unconditionally? — React requires hooks run unconditionally, so
// gate at the RENDER return, not before hooks. Put: if (isMiniPlayer) return <MiniPlayerRemote/>;
// just before the main `return (<AppShell …>)`, and keep MiniPlayerRemote self-contained.
```
> **React hooks rule:** do not early-return before hooks. Either (preferred) render
> `<MiniPlayerRemote/>` as a separate top-level component mounted in `main.tsx`/`index` based on
> the query param (cleanest — the mini window mounts a different root component entirely), **or**
> guard at the final return. The cleanest path: in `src/main.tsx`, check the param and
> `createRoot(...).render(isMini ? <MiniPlayerRemote/> : <App/>)`. Use that.

**(d) `src/main.tsx`:**
```tsx
const isMini = new URLSearchParams(window.location.search).get("miniplayer") === "1";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isMini ? <MiniPlayerRemote /> : <App />}</React.StrictMode>
);
```

**(e) `src/player/MiniPlayer.tsx`** — two exports:
- `MiniPlayer` — **pure** presentational (props: `title, author, artworkUrl?, isPlaying,
  position, duration, onToggle, onPrev, onNext`). Renders cover + title + author + a thin
  progress bar + prev/play-pause/next IconButtons. Reuse `IconButton` + tokens; compact CSS in
  a new `.mini-player` block (or in `components.css`).
- `MiniPlayerRemote` — the container the mini window mounts: subscribes via
  `listen<MiniState>("playback:state", (e) => setState(e.payload))` from `@tauri-apps/api/event`
  on mount, and dispatches commands via `emit("miniplayer:command", { action })`
  (`"toggle" | "prev" | "next"`). Renders `<MiniPlayer …/>` with the synced state.
  ```typescript
  type MiniState = { title: string; author: string; artworkUrl?: string; isPlaying: boolean; position: number; duration: number } | null;
  ```

**(f) Main-window emit + listen — `src/App.tsx`:**
- A `useEffect` keyed on `[current, isPlaying, currentTime, duration]` that emits the current
  state so the mini window stays synced:
  ```typescript
  void emit("playback:state", current ? {
    title: current.chapter.title, author: current.authorName, artworkUrl: <coverUrl or "">,
    isPlaying, position: currentTime, duration,
  } : null);
  ```
  (Throttle the position emit to ~1/sec if `onTimeUpdate` fires too often — emit on a 1000ms
  interval reading refs, instead of every timeupdate. Use a ref-based interval like the sleep
  timer pattern.)
- A `useEffect` (mount-once) that listens for commands and applies them:
  ```typescript
  const un = listen<{ action: "toggle" | "prev" | "next" }>("miniplayer:command", (e) => {
    const a = e.payload.action;
    if (a === "toggle") togglePlay();
    else if (a === "prev") playPrevChapter();   // reuse M14 logic
    else if (a === "next") playNextChapter();
  });
  return () => { void un.then((f) => f()); };
  ```
- A **"Pop out player"** `IconButton` in the **expanded Now Playing** panel (label "Open mini
  player") that calls `invoke("open_mini_player")`. (This is the single new always-visible
  control — note it for the `m12` regression.)

**(g) Verification strategy (important — the OS second window can't be captured by the existing
`captureWindow`, which targets the main HWND):**
- Unit-test `MiniPlayer` rendering (title/author/playing icon) and that `MiniPlayerRemote`'s
  buttons call `emit` with the right action (mock `@tauri-apps/api/event`).
- Add a **Rust smoke test** that `open_mini_player` is registered / the builder config compiles
  (at minimum it's in the handler list; a full window-spawn test needs a running app, so a
  compile + handler-registration check is acceptable — note the limitation).
- For the **screenshot**, the `m20` `mini-player` step renders `<MiniPlayer …/>` inline in the
  **main** window (a harness-only full-frame mount, like M18 rendered the recap inline) so
  `verify.ps1` captures its visual. The real second-window create + event round-trip is
  confirmed by the unit tests + controller manual check (or computer-use desktop capture if the
  controller wants OS-level proof — not required for PASS).

**Verify:** `npx tsc --noEmit` · `npm test` · `cargo test` (handler registration / compile).
**Commit:** `M20: focus mini-player — always-on-top remote window + event sync`

---

### Task 12 — `m20` walkthrough + runner test + gates + regression verify

**`src/harness/walkthroughs.ts`:**
- Add `m20Steps(nav: {...}): Step[]` with steps (split tall surfaces; ~11 shots):
  ```typescript
  export function m20Steps(nav: {
    showThemeLight: () => Promise<void>;
    showThemeHighContrast: () => Promise<void>;
    showTextLarge: () => Promise<void>;
    showDyslexiaFont: () => Promise<void>;
    showReducedMotion: () => Promise<void>;     // settings reflects the toggle
    showColorblindStatus: () => Promise<void>;  // author detail / now-playing with icon statuses
    showSkipLinkFocus: () => Promise<void>;      // focus the skip link (Tab) so it appears
    showSrTree: () => Promise<void>;             // author detail tree (visual = normal; semantics via DOM)
    showRtlLayout: () => Promise<void>;          // document.documentElement.dir = "rtl"
    showMiniPlayer: () => Promise<void>;         // inline MiniPlayer render
    showAccessibilitySettings: () => Promise<void>;
  }): Step[] {
    return [
      { name: "theme-light", run: nav.showThemeLight },
      { name: "theme-high-contrast", run: nav.showThemeHighContrast },
      { name: "text-large", run: nav.showTextLarge },
      { name: "dyslexia-font", run: nav.showDyslexiaFont },
      { name: "reduced-motion", run: nav.showReducedMotion },
      { name: "colorblind-status", run: nav.showColorblindStatus },
      { name: "skip-link-focus", run: nav.showSkipLinkFocus },
      { name: "sr-tree", run: nav.showSrTree },
      { name: "rtl-layout", run: nav.showRtlLayout },
      { name: "mini-player", run: nav.showMiniPlayer },
      { name: "a11y-settings", run: nav.showAccessibilitySettings },
    ];
  }
  ```
- Add `"m20"` to the `walkthroughs` const array.

**`src/App.tsx` dispatch** — extend the ternary chain with `: args.walkthrough === "m20" ?
m20Steps({ … })`. Each callback sets the relevant `a11y` state (theme/textSize/etc. via the
local state, NOT necessarily persisted), navigates to the right view, `await settle()` /
`imagesSettled()` before the shot. For `rtl-layout`, set
`document.documentElement.dir = "rtl"` then restore to `"ltr"` in a following step or at
walkthrough end. For `skip-link-focus`, programmatically `.focus()` the `.skip-link`. For
`mini-player`, render the inline `<MiniPlayer/>` (a harness-only overlay/route state).
> **Reset discipline (M19 lesson):** a11y prefs may persist via `setSetting` and leak across
> harness runs. In the FIRST `m20` step, force-reset `a11y` to `DEFAULT_A11Y` in state so the
> baseline is deterministic; toggle per-step via state only (avoid persisting during the
> walkthrough), and restore `dir="ltr"` + default theme at the end.

**`src/harness/runner.test.ts`** — add an `m20Steps` block asserting the 11 names in order
(copy the `m19Steps` test style).

**Gates (run all, in `tools/dev-env.cmd` foreground for cargo):**
- `npx tsc --noEmit` → clean.
- `npm test` → all green (expect ~+25–35 FE tests).
- `cargo test` (via `cmd /c "tools\dev-env.cmd cargo test"`) → all green, fixtures 43/44/47.
- `npm run build` then `cargo tauri build --debug` (via dev-env.cmd, FOREGROUND) → builds the
  debug exe used by `verify.ps1`.
- `git diff --stat Cargo.toml Cargo.lock package.json package-lock.json` → **empty** (no dep
  churn). If anything shows, STOP and report.
- `tools\verify.ps1 -Walkthrough m20` → captures the 11 shots.
- `tools\verify.ps1 -Walkthrough m12` → the 15-shot regression matrix.

**Screenshot verification (subagent, text verdict — do NOT load PNGs into the controller):**
Dispatch a Sonnet subagent to Read the `m20` + `m12` PNGs and return PASS/FAIL + observations +
the absolute paths. Acceptance per shot:
- `theme-light` — full light palette (light bg, dark text), nothing low-contrast/invisible.
- `theme-high-contrast` — black bg, white borders, yellow accent; all text legible.
- `text-large` — visibly larger type than baseline, no clipping/overlap.
- `dyslexia-font` — different (Verdana/Tahoma) face + looser spacing.
- `reduced-motion` — Accessibility settings shows the toggle on (static frame).
- `colorblind-status` — status icons/shapes visible alongside color.
- `skip-link-focus` — the "Skip to content" link is visible (focused).
- `sr-tree` — author detail renders normally (semantics checked via tests, not pixels).
- `rtl-layout` — layout mirrors cleanly, nothing overlaps/clips off-screen.
- `mini-player` — compact cover + title + author + transport + progress.
- `a11y-settings` — the Accessibility section with theme/text-size/font/motion controls.
- `m12` 15-shot — unchanged except the new "Pop out player" button in expanded Now Playing.

**Commit:** `M20: m20 walkthrough + runner test + gates green`

---

## 3. Finish (controller)

1. Push the branch, open a PR titled **"M20 — Accessibility & Platform Integration"** with a
   body summarizing the 11 sub-features + the invariants verified (no schema, no dep,
   read-only-on-disk, fixtures 43/44/47).
2. `gh pr checks <PR#> --watch` **FOREGROUND** (sleep ~20s first to dodge "no checks reported").
3. On green, merge from `main` `--merge --delete-branch`; sync `main`.
4. Update `ROADMAP.md`: flip M20 → ✅ Merged with the PR # and a one-line shipped summary;
   append a Decision-log entry with gotchas (especially any tree-semantics fallback, any
   text-size `px` limitations, the mini-player capture strategy, and the
   logical-property conversion surprises). Commit + push.
5. Ping the user with the M21 planning handoff (absolute ROADMAP path + milestone name).

---

## 4. Risk register / expected artifacts (not defects)

- **~5s synthetic fixture clips** → any duration label reads small. Status/structure/themes
  render correctly regardless (same artifact class as M11/M14/M15/M18/M19).
- **Mini-player OS window + Media Session card are OS surfaces** the app harness can't
  screenshot. They're verified by unit tests + inline harness render + (optional) controller
  manual/computer-use check. Do not block PASS on an app-harness screenshot of the OS card or
  the real second window.
- **Persisted-setting leakage across harness runs** (M19 lesson) — the `m20` walkthrough must
  force-reset `a11y` + `dir` at the start and avoid persisting toggles mid-run.
- **Hardcoded hex colors in CSS** would not flip under `[data-theme]` — Task 2 includes a sweep
  to tokenize them. If one resists tokenization, STOP and report.
- **Text-size partial scaling** — components using literal `px` font-size won't scale with
  `--font-scale`. Accept partial coverage this milestone; note it; do not do a sweeping rem
  refactor.
- **React hooks rule** — mini-player detection must branch at `main.tsx` root render (mount a
  different component), NOT via an early-return inside `App` before its hooks.
- **No new dependency is the hard line.** If any task seems to "need" a package (Motion One,
  react-i18next, a focus-trap lib, an OpenDyslexic font), it does **not** — the plan gives the
  dependency-free path for each. Adding a dep is a STOP-and-report condition.
