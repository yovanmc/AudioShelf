# M8 — Embedded Cover Art (implementation plan)

> **Written for Sonnet execution.** Every task lists exact files, complete code, exact
> commands, and expected output. If something doesn't match what you find in the repo
> (a signature differs, a function moved, a lofty/image API call won't compile), **STOP
> and report** rather than guessing. Follow `docs/superpowers/WORKFLOW-execution.md`:
> per task → implement → spec review → quality review → fix; whole-branch review before PR;
> screenshot-verify before merge; FOREGROUND `gh pr checks <PR#> --watch`.

## Goal

Show real cover images in the library. For each **work** (and each **author** in the list),
resolve a cover from either:
1. an **embedded picture** in the audio file's tags (`lofty`), or
2. a **folder image** next to the files (`cover.*` / `folder.*` / `front.*`, jpg/jpeg/png),

thumbnail it, cache it on disk, and render it; fall back to the existing color+initials
placeholder when there's no art. This is the first v2 ("Library Experience") milestone.

## Design constraints (read before coding)

- **No schema change, no migration.** Covers are resolved on demand by two Tauri commands.
  Chapter `file_path`s are absolute and the library is flat (`Author/<file>`), so an author's
  directory is `parent(file_path)`. This intentionally avoids the `library_root` setting,
  which is **not persisted under the screenshot harness** (the `--library` flag is ephemeral).
- `lofty = "0.21"` and `image = "0.25"` are **already** in `src-tauri/Cargo.toml` — do not add them there.
- Serve thumbnails through the **existing asset protocol** (same mechanism as audio playback:
  `convertFileSrc` on the FE, `allow_directory` on the BE). **Do not** add a `base64` crate.
- The app **ships no stylesheet** — all cover/swatch styling is inline, like the existing `Swatch`.
- Read-only guarantee: the app must not write to or modify any audio file or any file inside the
  library root. The only writes are PNG thumbnails under `<app_data>/covers/` (app-private cache).

## Definition of done

- `npx tsc --noEmit` clean, `npm test` green, `cargo test` green (existing + new tests).
- `tools\verify.ps1 -Walkthrough covers` produces `01-library.png` (Jane Doe & Sam Smith show
  real square covers in the author list) and `02-author-detail.png` (Jane Doe's works show covers).
- Regression: `tools\verify.ps1 -Walkthrough browse` and `-Walkthrough m7` still pass (Jane Doe
  still first; lists render).
- ROADMAP M8 row flipped to ✅ Merged with the PR number.

---

## Task 1 — Backend: `src-tauri/src/covers.rs` (pure, testable helpers)

Create a new file `src-tauri/src/covers.rs` with the full contents below.

```rust
//! Cover-art resolution: read an embedded picture from an audio file (via lofty) or a
//! folder image next to it, thumbnail it (via image), and cache the PNG on disk.
//! Pure helpers with no Tauri dependency so they are unit-testable.

use lofty::prelude::*; // brings TaggedFileExt (primary_tag / first_tag) into scope
use lofty::tag::Tag;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Which cover source wins when both an embedded picture and a folder image exist.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CoverPriority {
    /// Works prefer their own embedded art, then the author's folder image.
    EmbeddedFirst,
    /// Authors prefer a folder image, then the first file's embedded art.
    FolderFirst,
}

/// Candidate folder-image filenames, in priority order (matched case-insensitively).
const FOLDER_IMAGE_NAMES: &[&str] = &[
    "cover.jpg", "cover.jpeg", "cover.png",
    "folder.jpg", "folder.jpeg", "folder.png",
    "front.jpg", "front.jpeg", "front.png",
];

/// Extract the first embedded picture's raw bytes from an audio file, if any.
pub fn read_embedded_picture(path: &Path) -> Option<Vec<u8>> {
    let tagged = lofty::read_from_path(path).ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    picture_from_tag(tag)
}

/// Extract the first picture's bytes from an already-parsed tag (file-I/O-free; unit-testable).
pub fn picture_from_tag(tag: &Tag) -> Option<Vec<u8>> {
    tag.pictures().first().map(|p| p.data().to_vec())
}

/// Find a folder image (cover/folder/front .jpg/.jpeg/.png) inside `dir`, case-insensitively.
pub fn find_folder_image(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    // Map lowercased file name -> actual path for a single directory pass.
    let mut present: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(name) = p.file_name() {
                present.insert(name.to_string_lossy().to_ascii_lowercase(), p);
            }
        }
    }
    for name in FOLDER_IMAGE_NAMES {
        if let Some(p) = present.get(*name) {
            return Some(p.clone());
        }
    }
    None
}

/// Decode arbitrary image bytes and re-encode a PNG thumbnail bounded to `max`x`max`
/// (aspect preserved). Returns the encoded PNG bytes, or None on decode/encode failure.
pub fn make_thumbnail_png(src_bytes: &[u8], max: u32) -> Option<Vec<u8>> {
    let img = image::load_from_memory(src_bytes).ok()?;
    let thumb = img.thumbnail(max, max); // preserves aspect ratio, never upscales past max
    let mut out = std::io::Cursor::new(Vec::new());
    thumb.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// Pick the cover *source bytes* for a chapter file, honoring `prio`.
/// EmbeddedFirst: this file's embedded picture, else a folder image in its directory.
/// FolderFirst:   a folder image in its directory, else this file's embedded picture.
fn source_cover(chapter_file: &Path, prio: CoverPriority) -> Option<(PathBuf, Vec<u8>)> {
    let embedded = || read_embedded_picture(chapter_file).map(|b| (chapter_file.to_path_buf(), b));
    let folder = || {
        let dir = chapter_file.parent()?;
        let img = find_folder_image(dir)?;
        let bytes = std::fs::read(&img).ok()?;
        Some((img, bytes))
    };
    match prio {
        CoverPriority::EmbeddedFirst => embedded().or_else(folder),
        CoverPriority::FolderFirst => folder().or_else(embedded),
    }
}

/// Resolve a cover for `chapter_file`, write/reuse a cached PNG thumbnail under `cache_dir`,
/// and return the cache file path. Returns None when there is no cover source.
pub fn cover_cache_for_chapter(
    cache_dir: &Path,
    chapter_file: &Path,
    prio: CoverPriority,
    max: u32,
) -> Option<PathBuf> {
    let (source_path, bytes) = source_cover(chapter_file, prio)?;
    std::fs::create_dir_all(cache_dir).ok()?;

    // Cache key = hash(source path + source mtime) so a changed source regenerates.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source_path.to_string_lossy().hash(&mut hasher);
    if let Ok(md) = std::fs::metadata(&source_path) {
        if let Ok(mtime) = md.modified() {
            if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                dur.as_secs().hash(&mut hasher);
            }
        }
    }
    let out = cache_dir.join(format!("{:016x}.png", hasher.finish()));
    if out.exists() {
        return Some(out);
    }
    let thumb = make_thumbnail_png(&bytes, max)?;
    std::fs::write(&out, thumb).ok()?;
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn png_bytes(w: u32, h: u32, rgb: [u8; 3]) -> Vec<u8> {
        let mut img = RgbImage::new(w, h);
        for px in img.pixels_mut() {
            *px = Rgb(rgb);
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn thumbnail_bounds_and_preserves_aspect() {
        let src = png_bytes(400, 300, [200, 80, 80]);
        let thumb = make_thumbnail_png(&src, 256).expect("thumbnail");
        let decoded = image::load_from_memory(&thumb).expect("decode thumb");
        assert!(decoded.width() <= 256 && decoded.height() <= 256);
        // 400x300 -> 256x192 (aspect preserved).
        assert_eq!(decoded.width(), 256);
        assert_eq!(decoded.height(), 192);
    }

    #[test]
    fn find_folder_image_is_case_insensitive_and_ordered() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Folder.JPG"), png_bytes(8, 8, [1, 2, 3])).unwrap();
        std::fs::write(dir.path().join("cover.png"), png_bytes(8, 8, [4, 5, 6])).unwrap();
        let found = find_folder_image(dir.path()).expect("found");
        // cover.* outranks folder.* regardless of case.
        assert_eq!(found.file_name().unwrap().to_string_lossy().to_ascii_lowercase(), "cover.png");
    }

    #[test]
    fn no_folder_image_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"hi").unwrap();
        assert!(find_folder_image(dir.path()).is_none());
    }

    #[test]
    fn read_embedded_picture_none_for_non_audio() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("not-audio.txt");
        std::fs::write(&p, b"definitely not audio").unwrap();
        assert!(read_embedded_picture(&p).is_none());
    }

    #[test]
    fn picture_from_tag_returns_embedded_bytes() {
        // If any of these lofty 0.21 picture APIs don't compile, STOP and report.
        use lofty::picture::{MimeType, Picture, PictureType};
        use lofty::tag::TagType;
        let png = png_bytes(16, 16, [9, 9, 9]);
        let mut tag = Tag::new(TagType::Id3v2);
        tag.push_picture(Picture::new_unchecked(
            PictureType::CoverFront,
            Some(MimeType::Png),
            None,
            png.clone(),
        ));
        assert_eq!(picture_from_tag(&tag), Some(png));
    }

    #[test]
    fn cover_cache_uses_folder_image_and_thumbnails_it() {
        let lib = tempfile::tempdir().unwrap();
        let author = lib.path().join("Some Author");
        std::fs::create_dir_all(&author).unwrap();
        let chapter = author.join("Chapter One.wav");
        std::fs::write(&chapter, b"fake wav, no audio tags").unwrap();
        std::fs::write(author.join("cover.png"), png_bytes(512, 512, [30, 90, 160])).unwrap();

        let cache = tempfile::tempdir().unwrap();
        let p = cover_cache_for_chapter(cache.path(), &chapter, CoverPriority::FolderFirst, 256)
            .expect("cover path");
        assert!(p.exists());
        let decoded = image::load_from_memory(&std::fs::read(&p).unwrap()).unwrap();
        assert!(decoded.width() <= 256 && decoded.height() <= 256);

        // Second call reuses the cache file (same path, no error).
        let p2 = cover_cache_for_chapter(cache.path(), &chapter, CoverPriority::FolderFirst, 256)
            .expect("cover path 2");
        assert_eq!(p, p2);
    }
}
```

> **lofty 0.21 API note:** `picture_from_tag` / `read_embedded_picture` use
> `TaggedFileExt::primary_tag`/`first_tag`, `Tag::pictures()`, and `Picture::data()`. The
> `picture_from_tag_returns_embedded_bytes` test additionally uses `Tag::new(TagType)`,
> `Tag::push_picture`, and `Picture::new_unchecked(PictureType, Option<MimeType>, Option<String>, Vec<u8>)`.
> These are the lofty 0.21 names. If any won't compile, **STOP and report** the exact compiler
> error — do not invent alternatives.

---

## Task 2 — Backend: register the module + grant the cache dir asset scope

### 2a. `src-tauri/src/lib.rs` — declare the module

Add `mod covers;` to the module list (keep alphabetical placement after `commands`):

```rust
mod capture;
mod commands;
mod covers;
mod db;
mod grouping;
mod launch;
mod model;
mod natsort;
mod regroup;
mod rename;
mod scan;
```

### 2b. `src-tauri/src/lib.rs` — create the covers cache dir & allow the asset protocol to read it

Replace the existing `.setup(...)` closure:

```rust
        .setup(|app| {
            let conn = commands::init_db(&app.handle());
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
```

with:

```rust
        .setup(|app| {
            let handle = app.handle();
            let conn = commands::init_db(&handle);
            app.manage(DbState(Mutex::new(conn)));
            // Cover thumbnails are cached here and served via the asset protocol.
            let covers_dir = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir())
                .join("covers");
            std::fs::create_dir_all(&covers_dir).ok();
            let _ = handle.asset_protocol_scope().allow_directory(&covers_dir, true);
            Ok(())
        })
```

(`use tauri::Manager;` is already imported at the top of `lib.rs`, which provides `.path()` and
`.asset_protocol_scope()`.)

### 2c. `src-tauri/src/lib.rs` — register the two new commands

In the `tauri::generate_handler![ ... ]` list, add the two commands. Change the tail of the list
from:

```rust
            commands::clear_grouping_override,
            commands::search_library
        ])
```

to:

```rust
            commands::clear_grouping_override,
            commands::search_library,
            commands::get_work_cover,
            commands::get_author_cover
        ])
```

### 2d. `src-tauri/src/lib.rs` — export covers helpers for integration tests

In the `pub mod testing { ... }` block, add covers re-exports:

```rust
pub mod testing {
    pub use crate::commands::{query_author_detail, query_authors};
    pub use crate::covers::{
        cover_cache_for_chapter, find_folder_image, make_thumbnail_png, read_embedded_picture,
        CoverPriority,
    };
    pub use crate::db::open_in_memory;
    pub use crate::regroup::regroup_author;
    pub use crate::rename::{build_plan, execute, undo, ItemStatus};
    pub use crate::scan::scan_into;
}
```

---

## Task 3 — Backend: the two cover commands in `src-tauri/src/commands.rs`

Append the following to `src-tauri/src/commands.rs` (after the existing commands). It reuses the
existing `DbState`, `params!`, and error-string conventions.

```rust
/// Max thumbnail edge in pixels (square-bounded, aspect preserved).
const COVER_MAX: u32 = 256;

/// `<app_data>/covers`, created if missing. Matches the asset scope granted in `setup`.
fn covers_cache_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("covers");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// First (lowest chapter_no) active chapter file for a work.
fn first_chapter_file_for_work(
    conn: &rusqlite::Connection,
    work_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT file_path FROM chapters
         WHERE work_id=?1 AND status='active'
         ORDER BY chapter_no LIMIT 1",
        params![work_id],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// First active chapter file for an author (first work by sort_key, first chapter by no).
fn first_chapter_file_for_author(
    conn: &rusqlite::Connection,
    author_id: i64,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT c.file_path FROM chapters c
         JOIN works w ON c.work_id = w.id
         WHERE w.author_id=?1 AND c.status='active' AND w.status='active'
         ORDER BY w.sort_key, c.chapter_no LIMIT 1",
        params![author_id],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

/// Cover for a work: its first file's embedded art, else a folder image. Returns the
/// cached thumbnail's absolute path, or None if there's no cover.
#[tauri::command]
pub fn get_work_cover(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    work_id: i64,
) -> Result<Option<String>, String> {
    let file = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        first_chapter_file_for_work(&conn, work_id).map_err(|e| e.to_string())?
    }; // drop the DB lock before image work
    let Some(file) = file else { return Ok(None) };
    let dir = covers_cache_dir(&app);
    let p = crate::covers::cover_cache_for_chapter(
        &dir,
        std::path::Path::new(&file),
        crate::covers::CoverPriority::EmbeddedFirst,
        COVER_MAX,
    );
    Ok(p.map(|x| x.to_string_lossy().to_string()))
}

/// Cover for an author: a folder image, else the first file's embedded art.
#[tauri::command]
pub fn get_author_cover(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    author_id: i64,
) -> Result<Option<String>, String> {
    let file = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        first_chapter_file_for_author(&conn, author_id).map_err(|e| e.to_string())?
    };
    let Some(file) = file else { return Ok(None) };
    let dir = covers_cache_dir(&app);
    let p = crate::covers::cover_cache_for_chapter(
        &dir,
        std::path::Path::new(&file),
        crate::covers::CoverPriority::FolderFirst,
        COVER_MAX,
    );
    Ok(p.map(|x| x.to_string_lossy().to_string()))
}
```

> If `commands.rs` does not already have `use rusqlite::params;` (or import it via a glob)
> in scope for these functions, add it at the top of the file. Confirm by checking existing
> `params![...]` usages compile.

---

## Task 4 — Backend: integration test `src-tauri/tests/covers.rs`

Create `src-tauri/tests/covers.rs`:

```rust
use audioshelf_lib::testing::{cover_cache_for_chapter, find_folder_image, CoverPriority};

/// The generated fixture drops `cover.png` into "Jane Doe" and "Sam Smith"; resolving a
/// cover for one of Jane's chapter files must produce a cached PNG thumbnail.
#[test]
fn fixture_folder_cover_resolves_to_thumbnail() {
    let lib = tempfile::tempdir().unwrap();
    gen_fixture::generate(lib.path()).unwrap();

    let jane = lib.path().join("Jane Doe");
    assert!(find_folder_image(&jane).is_some(), "fixture must drop a folder image for Jane Doe");

    let chapter = jane.join("Cool Story.wav");
    assert!(chapter.exists());

    let cache = tempfile::tempdir().unwrap();
    let p = cover_cache_for_chapter(cache.path(), &chapter, CoverPriority::FolderFirst, 256)
        .expect("Jane Doe cover should resolve");
    assert!(p.exists());
    let decoded = image::load_from_memory(&std::fs::read(&p).unwrap()).unwrap();
    assert!(decoded.width() <= 256 && decoded.height() <= 256);
}

/// A filler author ("Zz Sample Author NN") has no folder image and a tag-less WAV → no cover.
#[test]
fn fixture_author_without_art_has_no_cover() {
    let lib = tempfile::tempdir().unwrap();
    gen_fixture::generate(lib.path()).unwrap();

    let filler = lib.path().join("Zz Sample Author 01");
    assert!(find_folder_image(&filler).is_none());

    let chapter = filler.join("Quiet Hours.wav");
    let cache = tempfile::tempdir().unwrap();
    assert!(
        cover_cache_for_chapter(cache.path(), &chapter, CoverPriority::FolderFirst, 256).is_none(),
        "no embedded art and no folder image → None"
    );
}
```

(The `image` crate and the `gen-fixture` dev-dependency are already available to the test crate
per `src-tauri/Cargo.toml`.)

---

## Task 5 — Fixtures: drop folder cover images (`tools/gen-fixture`)

### 5a. `tools/gen-fixture/Cargo.toml` — add the `image` dep

Change the `[dependencies]` section to:

```toml
[dependencies]
hound = "3"
image = "0.25"
```

### 5b. `tools/gen-fixture/src/lib.rs` — write `cover.png` into two real authors

Add this helper near `write_silence`:

```rust
/// Write a solid-colour PNG cover image into `dir` (exercises the folder-image cover path).
fn write_cover(dir: &Path, rgb: [u8; 3]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut img = image::RgbImage::new(160, 160);
    for px in img.pixels_mut() {
        *px = image::Rgb(rgb);
    }
    img.save(dir.join("cover.png"))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}
```

Then inside `generate`, after Jane's files are written and after Sam's files are written, add the
cover writes. Concretely, change:

```rust
    let jane = root.join("Jane Doe");
    write_silence(&jane.join("Cool Story.wav"), 2)?;
    write_silence(&jane.join("Cool Story 2 the sequel.wav"), 3)?;
    write_silence(&jane.join("Cool Story 3 finale.wav"), 4)?;
    write_silence(&jane.join("Another Standalone Tale.wav"), 5)?;

    // Author with a single multi-chapter work.
    let sam = root.join("Sam Smith");
    write_silence(&sam.join("Night Walk.wav"), 6)?;
    write_silence(&sam.join("Night Walk 2.wav"), 7)?;
```

to:

```rust
    let jane = root.join("Jane Doe");
    write_silence(&jane.join("Cool Story.wav"), 2)?;
    write_silence(&jane.join("Cool Story 2 the sequel.wav"), 3)?;
    write_silence(&jane.join("Cool Story 3 finale.wav"), 4)?;
    write_silence(&jane.join("Another Standalone Tale.wav"), 5)?;
    write_cover(&jane, [196, 64, 64])?; // warm red cover

    // Author with a single multi-chapter work.
    let sam = root.join("Sam Smith");
    write_silence(&sam.join("Night Walk.wav"), 6)?;
    write_silence(&sam.join("Night Walk 2.wav"), 7)?;
    write_cover(&sam, [64, 120, 196])?; // cool blue cover
```

> `cover.png` is **not** an audio extension, so it is ignored by scanning — author/work/chapter
> counts are unchanged (`fixture_scan.rs` stays 43/44/47). Do not edit `fixture_scan.rs`.

---

## Task 6 — Frontend: `src/lib/api.ts` cover wrappers

In `src/lib/api.ts`, add two invoke wrappers. Put them next to the other library getters
(e.g. right after `searchLibrary`):

```typescript
export const getWorkCover = (workId: number) =>
  invoke<string | null>("get_work_cover", { workId });
export const getAuthorCover = (authorId: number) =>
  invoke<string | null>("get_author_cover", { authorId });
```

(`fileUrl` / `convertFileSrc` already exist in this file — reuse them on the FE.)

---

## Task 7 — Frontend: `src/components/Cover.tsx` (lazy cover + shared Swatch)

Create `src/components/Cover.tsx`. This **owns** the `Swatch` (moved out of `LibraryView`) plus a
lazy-loading `Cover` with a module-level client cache and a graceful fallback.

```tsx
import { useEffect, useState } from "react";
import { getAuthorCover, getWorkCover, fileUrl } from "../lib/api";
import { colorFor, initials } from "../lib/avatar";

/** Inline-styled colour+initials placeholder (the app ships no stylesheet). */
export function Swatch({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 6,
        marginRight: 8,
        flex: "0 0 auto",
        background: colorFor(name),
        color: "#fff",
        fontSize: Math.round(size * 0.43),
        fontWeight: 600,
      }}
    >
      {initials(name)}
    </span>
  );
}

// Resolved cover paths cached across mounts (virtualized rows remount on scroll).
// Value: asset cache path, or null when there's no cover.
const coverCache = new Map<string, string | null>();

/**
 * Lazy cover image for an author or work. Shows the colour+initials Swatch while loading
 * and whenever there is no cover — so there is never a layout shift or a broken image.
 */
export function Cover({
  kind,
  id,
  name,
  size = 28,
}: {
  kind: "author" | "work";
  id: number;
  name: string;
  size?: number;
}) {
  const key = `${kind}:${id}`;
  const [path, setPath] = useState<string | null>(() => coverCache.get(key) ?? null);

  useEffect(() => {
    let alive = true;
    if (coverCache.has(key)) {
      setPath(coverCache.get(key) ?? null);
      return;
    }
    // Promise.resolve(...) tolerates test mocks that return undefined.
    Promise.resolve(kind === "author" ? getAuthorCover(id) : getWorkCover(id))
      .then((p) => {
        const v = p ?? null;
        coverCache.set(key, v);
        if (alive) setPath(v);
      })
      .catch(() => {
        coverCache.set(key, null);
        if (alive) setPath(null);
      });
    return () => {
      alive = false;
    };
  }, [key, id, kind]);

  if (path) {
    return (
      <img
        src={fileUrl(path)}
        alt=""
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          marginRight: 8,
          flex: "0 0 auto",
          objectFit: "cover",
          display: "inline-block",
          verticalAlign: "middle",
        }}
      />
    );
  }
  return <Swatch name={name} size={size} />;
}
```

---

## Task 8 — Frontend: use `<Cover>` in `src/views/LibraryView.tsx`

1. **Remove** the local `Swatch` function and its now-unused imports, and import `Cover` instead.
   Change the top imports:

   ```typescript
   import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
   import type { AuthorRow, SearchResults } from "../lib/api";
   import { summarizeAuthor } from "../lib/library";
   import { initials, colorFor } from "../lib/avatar";
   ```

   to:

   ```typescript
   import { FixedSizeList as List, type ListChildComponentProps } from "react-window";
   import type { AuthorRow, SearchResults } from "../lib/api";
   import { summarizeAuthor } from "../lib/library";
   import { Cover } from "../components/Cover";
   ```

   and **delete** the entire local `function Swatch({ name }: { name: string }) { ... }` block.

2. In the virtualized `Row`, replace `<Swatch name={a.name} />` with:

   ```tsx
   <Cover kind="author" id={a.id} name={a.name} />
   ```

3. In `SearchResultsPanel`, in the **Authors** section, replace `<Swatch name={a.authorName} />` with:

   ```tsx
   <Cover kind="author" id={a.authorId} name={a.authorName} />
   ```

   (Leave the Works and Chapters search sections unchanged — they have no swatch today.)

---

## Task 9 — Frontend: work covers in `src/views/AuthorDetailView.tsx`

1. Add the import at the top:

   ```typescript
   import { Cover } from "../components/Cover";
   ```

2. Replace the work heading. Change:

   ```tsx
         <section key={w.id} className="work">
           <h2><span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span></h2>
   ```

   to:

   ```tsx
         <section key={w.id} className="work">
           <h2 style={{ display: "flex", alignItems: "center" }}>
             <Cover kind="work" id={w.id} name={w.baseTitle} size={40} />
             <span className="work-title">{w.baseTitle}{" "}({w.chapters.length})</span>
           </h2>
   ```

---

## Task 10 — Frontend: `covers` walkthrough + image-load wait in `src/App.tsx`

### 10a. `src/harness/walkthroughs.ts` — add the steps factory + register the name

Add the factory (place it near the other `*Steps` factories):

```typescript
export function coversSteps(nav: {
  showLibrary: () => Promise<void>;
  openFirstAuthor: () => Promise<void>;
}): Step[] {
  return [
    { name: "library", run: nav.showLibrary },
    { name: "author-detail", run: nav.openFirstAuthor },
  ];
}
```

Add `"covers"` to the walkthroughs const:

```typescript
export const walkthroughs = ["browse", "player", "discovery", "rename", "grouping", "settings", "m7", "covers"] as const;
```

### 10b. `src/App.tsx` — import `coversSteps`

Add `coversSteps` to the existing import from `./harness/walkthroughs` (alongside `browseSteps`,
`playerSteps`, etc.). Example (merge into the actual existing import list — do not duplicate):

```typescript
import {
  browseSteps,
  playerSteps,
  discoverySteps,
  renameSteps,
  groupingSteps,
  settingsSteps,
  m7Steps,
  coversSteps,
} from "./harness/walkthroughs";
```

### 10c. `src/App.tsx` — add an `imagesSettled()` helper next to `settle()`

Immediately after the existing `settle()` function (around lines 23–28), add:

```typescript
// Wait for any <img> (e.g. cover art served via the asset protocol) to finish loading,
// so a screenshot taken after settle() doesn't capture half-loaded covers.
function imagesSettled(): Promise<void> {
  const imgs = Array.from(document.images);
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  ).then(() => undefined);
}
```

### 10d. `src/App.tsx` — wait for images in the screenshot callback

Change the capture callback:

```typescript
        await runSteps(steps, args.shots, async (p) => { await settle(); await captureWindow(p); });
```

to:

```typescript
        await runSteps(steps, args.shots, async (p) => {
          await settle();
          await imagesSettled();
          await settle(); // let the newly-painted covers commit a frame
          await captureWindow(p);
        });
```

### 10e. `src/App.tsx` — dispatch the `covers` walkthrough

In the chained walkthrough selection (the `args.walkthrough === ... ? ... :` expression),
add a `covers` branch. Insert it before the final `: browseSteps({ ... })` fallback. The
`openFirstAuthor` callback is already defined just above the chain — reuse it:

```typescript
            : args.walkthrough === "covers"
            ? coversSteps({
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              })
```

So the tail reads:

```typescript
            : args.walkthrough === "settings"
            ? settingsSteps({
                openSettings: async () => setRoute({ kind: "settings", firstRun: false }),
              })
            : args.walkthrough === "covers"
            ? coversSteps({
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              })
            : browseSteps({
                showScanResult: async () => setRoute({ kind: "scan" }),
                showLibrary: async () => setRoute({ kind: "library" }),
                openFirstAuthor,
              });
```

---

## Task 11 — Frontend test hygiene (only if existing tests break)

`LibraryView` and `AuthorDetailView` now mount `<Cover>`, which calls `getAuthorCover` /
`getWorkCover` (Tauri `invoke`). The `Cover` component already tolerates an `undefined`/rejected
return (wrapped in `Promise.resolve` + `.catch` → falls back to `Swatch`), so existing
props-driven tests should still pass and assert the same visible text.

**Run the FE tests first** (`npm test`). Only if a test that renders `LibraryView` or
`AuthorDetailView` now fails or logs an unhandled rejection, add a mock for the cover API at the
top of *that* test file:

```typescript
import { vi } from "vitest";
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, getAuthorCover: vi.fn().mockResolvedValue(null), getWorkCover: vi.fn().mockResolvedValue(null) };
});
```

(Adjust the relative path to `../lib/api` to match the test file's location.) Do **not** add this
pre-emptively — only if a specific test requires it. Report which tests needed it.

---

## Task 12 — Verify, review, PR, merge

Run from the repo root (`C:\Agent Projects\AudioShelf`), cargo in the FOREGROUND.

1. **Type + unit gates:**
   ```
   npx tsc --noEmit
   npm test
   cmd /c "tools\dev-env.cmd cargo test --manifest-path src-tauri\Cargo.toml"
   ```
   Expected: tsc clean; vitest all green; cargo test green incl. new `covers` unit tests (6) and
   `tests/covers.rs` (2). The existing `fixture_scan` counts test (43/44/47) must still pass.

2. **Build the app** (Rust changed, so the debug binary relinks — no stale-binary risk):
   ```
   npm run build
   cmd /c "tools\dev-env.cmd cargo tauri build --debug --no-bundle"
   ```

3. **Screenshot-verify covers:**
   ```
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough covers
   ```
   Read `.shots\covers\01-library.png` and `.shots\covers\02-author-detail.png`. Confirm:
   - `01-library.png`: **Jane Doe** shows a red square cover and **Sam Smith** a blue square cover
     in the author list (filler `Zz Sample Author NN` rows still show initials swatches).
   - `02-author-detail.png`: Jane Doe's works each show the red cover next to the work title.
   If a cover is missing/half-rendered, the `imagesSettled()` wait or the asset-scope grant is the
   likely cause — investigate before proceeding (do not merge on a blank cover).

4. **Regression-verify:**
   ```
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough browse
   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -Walkthrough m7
   ```
   Confirm the library still renders and Jane Doe is still first.

5. **Whole-branch review** (read every changed file): confirm read-only guarantee holds (no writes
   outside `<app_data>/covers/`), no `library_root` dependency introduced, inline styling only.

6. **Commit, PR, merge.** Branch name e.g. `m8-cover-art`. Commit with the repo identity
   (`yovanmc <yovanmc@users.noreply.github.com>` — do not override) and trailer:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   ```
   Open the PR, then FOREGROUND-watch CI (sleep ~20s first to dodge "no checks reported"):
   ```
   gh pr checks <PR#> --watch
   ```
   On green, merge from main: `gh pr merge <PR#> --merge --delete-branch`, then sync `main`.

7. **Update `ROADMAP.md`**: flip the M8 row to `✅ Merged` with the PR number and a one-line
   shipped summary; append any new gotchas to the decision log. Commit + push.

8. **Ping** the user with the Phase-B handoff (next milestone is **M9 — Work & Chapter Tags**):
   > `AudioShelf M8 Embedded Cover Art merged & CI-green. /clear, then paste: 'Use the roadmap skill to plan the next milestone (M9 — Work & Chapter Tags) in C:\Agent Projects\AudioShelf\ROADMAP.md.'`

## File-change summary

| File | Change |
|------|--------|
| `src-tauri/src/covers.rs` | **New** — cover resolution + thumbnail + cache helpers; unit tests |
| `src-tauri/src/lib.rs` | `mod covers;`; setup creates+grants covers cache dir; register 2 commands; testing re-exports |
| `src-tauri/src/commands.rs` | `get_work_cover`, `get_author_cover` + first-chapter-file helpers + `covers_cache_dir` |
| `src-tauri/tests/covers.rs` | **New** — fixture cover resolves; art-less author has none |
| `tools/gen-fixture/Cargo.toml` | add `image = "0.25"` |
| `tools/gen-fixture/src/lib.rs` | `write_cover` + `cover.png` for Jane Doe & Sam Smith |
| `src/lib/api.ts` | `getWorkCover`, `getAuthorCover` wrappers |
| `src/components/Cover.tsx` | **New** — `Cover` (lazy + cache + fallback) and shared `Swatch` |
| `src/views/LibraryView.tsx` | drop local `Swatch`; use `<Cover kind="author">` (list + search) |
| `src/views/AuthorDetailView.tsx` | `<Cover kind="work" size={40}>` in each work heading |
| `src/harness/walkthroughs.ts` | `coversSteps` factory; add `"covers"` to walkthroughs |
| `src/App.tsx` | import `coversSteps`; `imagesSettled()`; image-wait in capture; `covers` branch |
| `<test file>` | (only if needed) mock `getAuthorCover`/`getWorkCover` |
| `ROADMAP.md` | flip M8 → ✅ Merged after merge |
