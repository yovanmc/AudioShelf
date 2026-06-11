//! rename.rs — opt-in, defensive batch rename of audio files to canonical names.
//! Pure planning + crash-safe execution + tolerant undo. The ONLY module that
//! mutates the user's audio files, and only when explicitly invoked.

/// Replace Windows-illegal and control characters with spaces, collapse runs of
/// whitespace, and trim. Never returns a name with leading/trailing spaces.
pub fn sanitize(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Canonical filename: sanitized base title, a space + chapter number when >= 2,
/// then `.<ext>` using the original extension verbatim (case preserved).
pub fn canonical_name(base_title: &str, chapter_no: i64, ext: &str) -> String {
    let safe = sanitize(base_title);
    let stem = if chapter_no >= 2 { format!("{safe} {chapter_no}") } else { safe };
    if ext.is_empty() { stem } else { format!("{stem}.{ext}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_illegal_and_collapses_space() {
        assert_eq!(sanitize("Cool: Story"), "Cool Story");
        assert_eq!(sanitize("a/b\\c"), "a b c");
        assert_eq!(sanitize("  pad  me  "), "pad me");
    }

    #[test]
    fn canonical_name_uses_chapter_and_ext() {
        assert_eq!(canonical_name("Cool Story", 1, "mp3"), "Cool Story.mp3");
        assert_eq!(canonical_name("Cool Story", 2, "mp3"), "Cool Story 2.mp3");
        assert_eq!(canonical_name("Area 51", 1, "wav"), "Area 51.wav");
        assert_eq!(canonical_name("Cool Story", 3, "MP3"), "Cool Story 3.MP3");
    }
}
