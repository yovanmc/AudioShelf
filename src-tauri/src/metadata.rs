//! Faceted, user-defined metadata (narrator / language / mood) applied to chapters
//! (files) and authors (creators). Works aggregate their chapters' terms at query
//! time. The set of *facets* is driven by the `label_types` table; the *values* within
//! each facet are created by the user. No embedded-tag ingestion — values are entered manually.

/// The three built-in facets shipped with the app (always present; used as guards).
pub const BUILTIN_FACETS: [&str; 3] = ["narrator", "language", "tag"];

/// True iff `facet` is a known label type (DB-backed).
pub fn is_valid_facet(conn: &rusqlite::Connection, facet: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM label_types WHERE name=?1)",
        rusqlite::params![facet],
        |r| r.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

/// Map an entity scope keyword to its `(attach_table, key_column)`. Returns `None`
/// for unknown scopes so callers reject untrusted input. The table/column are only
/// ever taken from this fixed mapping — never interpolated from raw user strings.
pub fn scope_table(scope: &str) -> Option<(&'static str, &'static str)> {
    match scope {
        "chapter" => Some(("chapter_metadata", "chapter_id")),
        "author"  => Some(("author_metadata",  "author_id")),
        "work"    => Some(("work_metadata",     "work_id")),
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
        // Use a full in-memory DB so label_types is seeded by migration v10.
        let conn = crate::db::open_in_memory().unwrap();
        assert!(is_valid_facet(&conn, "narrator"));
        assert!(is_valid_facet(&conn, "language"));
        assert!(is_valid_facet(&conn, "mood"));
        assert!(is_valid_facet(&conn, "tag")); // seeded in v10
        assert!(!is_valid_facet(&conn, "genre"));
        assert!(!is_valid_facet(&conn, ""));
    }

    #[test]
    fn scope_table_maps_known_scopes_only() {
        assert_eq!(scope_table("chapter"), Some(("chapter_metadata", "chapter_id")));
        assert_eq!(scope_table("author"),  Some(("author_metadata",  "author_id")));
        assert_eq!(scope_table("work"),    Some(("work_metadata",    "work_id")));
        assert_eq!(scope_table("'; DROP TABLE works;--"), None);
    }
}
