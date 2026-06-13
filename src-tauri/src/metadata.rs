//! Faceted, user-defined metadata (narrator / language / mood) applied to chapters
//! (files) and authors (creators). Works aggregate their chapters' terms at query
//! time. The set of *facets* is fixed; the *values* within each facet are created by
//! the user. No embedded-tag ingestion — values are entered manually.

/// The three supported metadata facets. Fixed; user-created values live in `metadata_terms`.
pub const FACETS: [&str; 3] = ["narrator", "language", "mood"];

/// True iff `facet` is one of the supported facets.
pub fn is_valid_facet(facet: &str) -> bool {
    FACETS.contains(&facet)
}

/// Map an entity scope keyword to its `(attach_table, key_column)`. Returns `None`
/// for unknown scopes so callers reject untrusted input. The table/column are only
/// ever taken from this fixed mapping — never interpolated from raw user strings.
pub fn scope_table(scope: &str) -> Option<(&'static str, &'static str)> {
    match scope {
        "chapter" => Some(("chapter_metadata", "chapter_id")),
        "author" => Some(("author_metadata", "author_id")),
        _ => None,
    }
}

/// Human label for a facet (used in Discover reason text).
pub fn facet_label(facet: &str) -> &'static str {
    match facet {
        "narrator" => "Narrator",
        "language" => "Language",
        "mood" => "Mood",
        _ => "Metadata",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_facets_recognized_unknown_rejected() {
        assert!(is_valid_facet("narrator"));
        assert!(is_valid_facet("language"));
        assert!(is_valid_facet("mood"));
        assert!(!is_valid_facet("genre"));
        assert!(!is_valid_facet(""));
    }

    #[test]
    fn scope_table_maps_known_scopes_only() {
        assert_eq!(scope_table("chapter"), Some(("chapter_metadata", "chapter_id")));
        assert_eq!(scope_table("author"), Some(("author_metadata", "author_id")));
        assert_eq!(scope_table("work"), None);
        assert_eq!(scope_table("'; DROP TABLE works;--"), None);
    }
}
