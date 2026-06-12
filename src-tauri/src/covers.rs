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
