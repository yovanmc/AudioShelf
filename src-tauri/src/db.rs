//! SQLite schema and connection helpers. The DB is the source of truth for all
//! app-owned metadata (grouping, played flags, tags, play history). Audio files
//! on disk are never modified by this layer.

use rusqlite::Connection;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY,
  folder_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES authors(id),
  base_title TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(author_id, base_title)
);
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  file_path TEXT NOT NULL UNIQUE,
  raw_filename TEXT NOT NULL,
  chapter_no INTEGER NOT NULL,
  format TEXT NOT NULL,
  duration_secs INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS author_tags (
  author_id INTEGER NOT NULL REFERENCES authors(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (author_id, tag)
);
CREATE TABLE IF NOT EXISTS work_tags (
  work_id INTEGER NOT NULL REFERENCES works(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (work_id, tag)
);
CREATE TABLE IF NOT EXISTS chapter_tags (
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (chapter_id, tag)
);
CREATE TABLE IF NOT EXISTS play_events (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  played_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grouping_overrides (
  chapter_path TEXT PRIMARY KEY,
  base_title TEXT,
  chapter_no INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
"#;

/// The current schema version. Bump this constant whenever a new migration step is added.
pub(crate) const LATEST: i64 = 12;

/// Open a file-backed connection and ensure the schema exists (idempotent).
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    crate::backup::apply_pending_restore(path); // best-effort, crash-safe staged restore
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA cache_size = -16384;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 134217728;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

/// Open an in-memory connection (for tests).
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

/// Create the tag taxonomy tables introduced in migration v2.
fn migration_v2_tag_taxonomy(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tag_aliases (
          alias     TEXT PRIMARY KEY,
          canonical TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tag_parents (
          child  TEXT PRIMARY KEY,
          parent TEXT NOT NULL
        );",
    )
}

/// Add metadata_source columns introduced in migration v3.
fn migration_v3_metadata_source(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "ALTER TABLE works    ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'filename';
         ALTER TABLE chapters ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'filename';",
    )
}

/// Add series/reading-order tables introduced in migration v4.
fn migration_v4_series(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS series (
          id        INTEGER PRIMARY KEY,
          author_id INTEGER NOT NULL REFERENCES authors(id),
          title     TEXT NOT NULL,
          sort_key  TEXT NOT NULL,
          UNIQUE(author_id, title)
        );
        CREATE TABLE IF NOT EXISTS work_series_membership (
          work_id   INTEGER PRIMARY KEY REFERENCES works(id),
          series_id INTEGER NOT NULL REFERENCES series(id),
          position  INTEGER NOT NULL
        );",
    )
}

/// Add the transcripts table introduced in migration v5.
fn migration_v5_transcripts(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS transcripts (
          chapter_id  INTEGER PRIMARY KEY REFERENCES chapters(id),
          source_path TEXT NOT NULL,
          content     TEXT NOT NULL
        );",
    )
}

/// Add saved_searches, smart_collections tables and works.chapter_sort column (migration v7).
fn migration_v7_power_scale(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_searches (
           id         INTEGER PRIMARY KEY,
           name       TEXT    NOT NULL,
           query      TEXT    NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS smart_collections (
           id         INTEGER PRIMARY KEY,
           name       TEXT    NOT NULL,
           query      TEXT    NOT NULL,
           position   INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_smart_collections_pos ON smart_collections(position);
         ALTER TABLE works ADD COLUMN chapter_sort TEXT NOT NULL DEFAULT '';",
    )
}

/// Add playback_position_secs to chapters (migration v9). Stores resume position in
/// seconds; cleared to 0 when a chapter is marked finished. Additive only.
fn migration_v9_playback_position(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "ALTER TABLE chapters ADD COLUMN playback_position_secs INTEGER NOT NULL DEFAULT 0;",
    )
}

/// Add label_types + work_metadata tables and copy existing *_tags rows into the
/// unified metadata_terms / *_metadata tables (migration v10). Additive only —
/// author_tags/work_tags/chapter_tags are left intact (dormant, recoverable).
fn migration_v10_label_types(conn: &Connection) -> rusqlite::Result<()> {
    // (a) DDL: user-definable label types + work-level metadata attach
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS label_types (
           name    TEXT PRIMARY KEY,
           display TEXT NOT NULL,
           builtin INTEGER NOT NULL DEFAULT 0,
           sort    INTEGER NOT NULL DEFAULT 0
         );
         INSERT OR IGNORE INTO label_types(name, display, builtin, sort) VALUES
           ('narrator','Narrator',1,0),
           ('language','Language',1,1),
           ('tag','Tag',1,2),
           ('mood','Mood',0,3);
         CREATE TABLE IF NOT EXISTS work_metadata (
           work_id INTEGER NOT NULL REFERENCES works(id),
           term_id INTEGER NOT NULL REFERENCES metadata_terms(id),
           PRIMARY KEY (work_id, term_id)
         );
         CREATE INDEX IF NOT EXISTS idx_work_metadata_term ON work_metadata(term_id);",
    )?;
    // (b) Data copy: seed metadata_terms with all legacy tag values (collision-safe via
    //     UNIQUE(facet,value) + INSERT OR IGNORE).
    conn.execute(
        "INSERT OR IGNORE INTO metadata_terms(facet, value)
           SELECT 'tag', tag FROM author_tags
           UNION SELECT 'tag', tag FROM work_tags
           UNION SELECT 'tag', tag FROM chapter_tags",
        [],
    )?;
    // (c) Populate the unified attach tables from the legacy tag junction tables.
    conn.execute(
        "INSERT OR IGNORE INTO author_metadata(author_id, term_id)
           SELECT at.author_id, mt.id FROM author_tags at
           JOIN metadata_terms mt ON mt.facet='tag' AND mt.value=at.tag",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO work_metadata(work_id, term_id)
           SELECT wt.work_id, mt.id FROM work_tags wt
           JOIN metadata_terms mt ON mt.facet='tag' AND mt.value=wt.tag",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO chapter_metadata(chapter_id, term_id)
           SELECT ct.chapter_id, mt.id FROM chapter_tags ct
           JOIN metadata_terms mt ON mt.facet='tag' AND mt.value=ct.tag",
        [],
    )?;
    Ok(())
}

/// Add per-file scan-tracking columns to `chapters` (migration v11). Additive only —
/// three ADD COLUMN + one index; SCHEMA_V1 untouched, no FK-off rebuild. These power
/// incremental mtime/size skip and generation-stamped deletion detection.
///   file_mtime     — file modified time, seconds since unix epoch (0 = unknown)
///   file_size      — file size in bytes (0 = unknown)
///   last_seen_scan — the scan_generation that last observed this file on disk
fn migration_v11_scan_tracking(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "ALTER TABLE chapters ADD COLUMN file_mtime INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE chapters ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE chapters ADD COLUMN last_seen_scan INTEGER NOT NULL DEFAULT 0;
         CREATE INDEX IF NOT EXISTS idx_chapters_last_seen ON chapters(last_seen_scan);",
    )?;
    Ok(())
}

/// v12 — query performance: the two genuinely-missing indices.
/// `idx_chapters_work` is a COVERING index for the work-grouped aggregations in
/// `query_authors` and `compute_insights` (work_id join + status/played/duration read
/// entirely from the index → index-only scan). `idx_play_events_chapter` is the FK
/// index for per-chapter event lookups. (works.author_id and metadata_terms(facet,value)
/// are intentionally NOT added — already covered by their UNIQUE auto-indexes; see the
/// M32 plan "Scope corrections" section.)
fn migration_v12_query_indices(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_chapters_work
             ON chapters(work_id, status, played, duration_secs);
         CREATE INDEX IF NOT EXISTS idx_play_events_chapter
             ON play_events(chapter_id);",
    )?;
    Ok(())
}

/// Add the metadata_terms vocabulary + chapter_metadata / author_metadata attach
/// tables (migration v8). Faceted user-defined metadata (narrator / language / mood)
/// applied to files and creators. Additive only — no existing table touched.
fn migration_v8_metadata(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS metadata_terms (
           id    INTEGER PRIMARY KEY,
           facet TEXT NOT NULL,
           value TEXT NOT NULL,
           UNIQUE(facet, value)
         );
         CREATE TABLE IF NOT EXISTS chapter_metadata (
           chapter_id INTEGER NOT NULL REFERENCES chapters(id),
           term_id    INTEGER NOT NULL REFERENCES metadata_terms(id),
           PRIMARY KEY (chapter_id, term_id)
         );
         CREATE TABLE IF NOT EXISTS author_metadata (
           author_id INTEGER NOT NULL REFERENCES authors(id),
           term_id   INTEGER NOT NULL REFERENCES metadata_terms(id),
           PRIMARY KEY (author_id, term_id)
         );
         CREATE INDEX IF NOT EXISTS idx_chapter_metadata_term ON chapter_metadata(term_id);
         CREATE INDEX IF NOT EXISTS idx_author_metadata_term  ON author_metadata(term_id);",
    )
}

/// Add the journal tables and columns introduced in migration v6.
fn migration_v6_journal(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chapter_notes (
           id            INTEGER PRIMARY KEY,
           chapter_id    INTEGER NOT NULL REFERENCES chapters(id),
           position_secs INTEGER NOT NULL DEFAULT 0,
           body          TEXT    NOT NULL,
           created_at    INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_chapter_notes_chapter ON chapter_notes(chapter_id);
         CREATE TABLE IF NOT EXISTS chapter_bookmarks (
           id            INTEGER PRIMARY KEY,
           chapter_id    INTEGER NOT NULL REFERENCES chapters(id),
           position_secs INTEGER NOT NULL,
           label         TEXT    NOT NULL DEFAULT '',
           created_at    INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_chapter_bookmarks_chapter ON chapter_bookmarks(chapter_id);
         ALTER TABLE chapters ADD COLUMN user_summary TEXT    NOT NULL DEFAULT '';
         ALTER TABLE chapters ADD COLUMN takeaway     TEXT    NOT NULL DEFAULT '';
         ALTER TABLE chapters ADD COLUMN is_favorite  INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE works    ADD COLUMN re_entry_note     TEXT NOT NULL DEFAULT '';
         ALTER TABLE works    ADD COLUMN completion_rating TEXT NOT NULL DEFAULT '';",
    )
}

/// Ordered, idempotent migration runner. Each step bumps user_version inside its own
/// transaction so a crash mid-migration leaves the DB at the last fully-applied version.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current < 1 {
        run_step(conn, 1, |c| {
            c.execute_batch(SCHEMA_V1)?;
            Ok(())
        })?;
    }
    if current < 2 {
        run_step(conn, 2, migration_v2_tag_taxonomy)?;
    }
    if current < 3 {
        run_step(conn, 3, migration_v3_metadata_source)?;
    }
    if current < 4 {
        run_step(conn, 4, migration_v4_series)?;
    }
    if current < 5 {
        run_step(conn, 5, migration_v5_transcripts)?;
    }
    if current < 6 {
        run_step(conn, 6, migration_v6_journal)?;
    }
    if current < 7 {
        run_step(conn, 7, migration_v7_power_scale)?;
    }
    if current < 8 {
        run_step(conn, 8, migration_v8_metadata)?;
    }
    if current < 9 { run_step(conn, 9, migration_v9_playback_position)?; }
    if current < 10 { run_step(conn, 10, migration_v10_label_types)?; }
    if current < 11 { run_step(conn, 11, migration_v11_scan_tracking)?; }
    if current < 12 { run_step(conn, 12, migration_v12_query_indices)?; }
    conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES ('schema_version', ?1)",
        [LATEST.to_string()],
    )?;
    let _ = current;
    Ok(())
}

/// Run one migration step in a transaction, bumping user_version atomically.
fn run_step(
    conn: &Connection,
    version: i64,
    body: impl FnOnce(&Connection) -> rusqlite::Result<()>,
) -> rusqlite::Result<()> {
    conn.execute_batch("BEGIN")?;
    let result = (|| {
        body(conn)?;
        conn.execute_batch(&format!("PRAGMA user_version = {version}"))?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Open an in-memory DB and apply migrations only up to `version` (for upgrade tests).
pub fn open_at_version(version: i64) -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    if version >= 1 {
        run_step(&conn, 1, |c| {
            c.execute_batch(SCHEMA_V1)?;
            Ok(())
        })?;
    }
    if version >= 2 {
        run_step(&conn, 2, migration_v2_tag_taxonomy)?;
    }
    if version >= 3 {
        run_step(&conn, 3, migration_v3_metadata_source)?;
    }
    if version >= 4 {
        run_step(&conn, 4, migration_v4_series)?;
    }
    if version >= 5 {
        run_step(&conn, 5, migration_v5_transcripts)?;
    }
    if version >= 6 {
        run_step(&conn, 6, migration_v6_journal)?;
    }
    if version >= 7 {
        run_step(&conn, 7, migration_v7_power_scale)?;
    }
    if version >= 8 {
        run_step(&conn, 8, migration_v8_metadata)?;
    }
    if version >= 9 { run_step(&conn, 9, migration_v9_playback_position)?; }
    if version >= 10 { run_step(&conn, 10, migration_v10_label_types)?; }
    if version >= 11 { run_step(&conn, 11, migration_v11_scan_tracking)?; }
    if version >= 12 { run_step(&conn, 12, migration_v12_query_indices)?; }
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_creates_all_tables() {
        let conn = open_in_memory().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('authors','works','chapters','author_tags','play_events','grouping_overrides','settings',
                  'tag_aliases','tag_parents','series','work_series_membership')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 11);
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = open_in_memory().unwrap();
        // Running migrate again must not error.
        super::migrate(&conn).unwrap();
    }

    #[test]
    fn migrate_sets_user_version() {
        let conn = open_in_memory().unwrap();
        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 12);
    }

    #[test]
    fn migrate_from_v1_is_noop_when_current() {
        let conn = open_in_memory().unwrap();
        // Running migrate a second time must leave user_version at 12 without error.
        super::migrate(&conn).unwrap();
        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 12);
    }

    #[test]
    fn legacy_db_with_v1_tables_user_version_0_upgrades() {
        // Simulate an existing real DB: schema already applied but user_version still 0.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        // user_version stays 0 since we didn't call migrate.
        let pre: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pre, 0);
        // Now call migrate — it should handle CREATE TABLE IF NOT EXISTS idempotently.
        super::migrate(&conn).unwrap();
        let post: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(post, 12);
    }

    #[test]
    fn open_at_version_1_has_v1_tables_but_no_v2_tables() {
        let conn = open_at_version(1).unwrap();
        // settings table must exist.
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='settings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        // user_version must be 1.
        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 1);
        // v2 tables must NOT exist yet.
        let v2_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'
                 AND name IN ('tag_aliases', 'tag_parents')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v2_count, 0);
    }

    #[test]
    fn open_in_memory_has_v2_tables_and_user_version_11() {
        let conn = open_in_memory().unwrap();
        let v2_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'
                 AND name IN ('tag_aliases', 'tag_parents')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v2_count, 2);
        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 12);
    }

    #[test]
    fn upgrade_from_v1_to_v2() {
        // Open at v1 (no tag_aliases/tag_parents), then run migrate to reach v9.
        let conn = open_at_version(1).unwrap();
        let pre: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pre, 1);
        // Run full migration — should add v2 tables, v3 columns, v4 series tables, v5 transcripts, v6 journal, v7 power-scale, v8 metadata, v9 playback_position, v10 label_types, v11 scan_tracking, v12 query_indices.
        super::migrate(&conn).unwrap();
        let post: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(post, 12);
        let v2_count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'
                 AND name IN ('tag_aliases', 'tag_parents')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v2_count, 2);
    }

    #[test]
    fn upgrade_from_v2() {
        // Open at v2 (has tag_aliases/tag_parents but no metadata_source columns),
        // then upgrade to v3 and confirm the column exists with a 'filename' default.
        let conn = open_at_version(2).unwrap();
        let pre: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(pre, 2);

        // The metadata_source column must NOT exist yet at v2.
        let has_col: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('works') WHERE name='metadata_source'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_col, 0, "metadata_source must not exist before v3 migration");

        // Run the full migration to reach latest.
        super::migrate(&conn).unwrap();
        let post: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(post, 12);

        // Now both tables must have the column.
        let works_col: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('works') WHERE name='metadata_source'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(works_col, 1, "works must have metadata_source after v3");

        let chapters_col: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('chapters') WHERE name='metadata_source'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(chapters_col, 1, "chapters must have metadata_source after v3");

        // Insert a row to verify the default is 'filename'.
        conn.execute(
            "INSERT INTO authors(folder_name, status) VALUES ('Test Author', 'active')",
            [],
        )
        .unwrap();
        let author_id: i64 =
            conn.query_row("SELECT id FROM authors WHERE folder_name='Test Author'", [], |r| r.get(0))
                .unwrap();
        conn.execute(
            "INSERT INTO works(author_id, base_title, sort_key) VALUES (?1, 'Test Work', 'test work')",
            rusqlite::params![author_id],
        )
        .unwrap();
        let src: String = conn
            .query_row("SELECT metadata_source FROM works WHERE base_title='Test Work'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(src, "filename");
    }

    #[test]
    fn upgrade_from_v3() {
        // Open at v3 (no series tables), then upgrade to v4 and confirm the tables exist.
        let conn = open_at_version(3).unwrap();
        let pre: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(pre, 3);

        // series / work_series_membership must NOT exist yet at v3.
        let no_series: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('series','work_series_membership')",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(no_series, 0, "series tables must not exist before v4 migration");

        // Run the full migration to reach latest.
        super::migrate(&conn).unwrap();
        let post: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(post, 12);

        // Both tables must now exist.
        let series_count: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('series','work_series_membership')",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(series_count, 2, "both series tables must exist after v4");
    }

    #[test]
    fn open_at_version_3_lacks_series_tables() {
        let conn = open_at_version(3).unwrap();
        let ver: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(ver, 3);

        let count: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('series','work_series_membership')",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 0, "series tables must not exist at v3");
    }

    // ---- v5 migration tests --------------------------------------------------------

    #[test]
    fn open_at_version_4_lacks_transcripts_table() {
        let conn = open_at_version(4).unwrap();
        let ver: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(ver, 4);
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='transcripts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "transcripts must not exist before v5 migration");
    }

    #[test]
    fn upgrade_from_v4() {
        // Open at v4 (no transcripts table), then migrate to v5.
        let conn = open_at_version(4).unwrap();
        let pre: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(pre, 4);

        // transcripts must NOT exist yet.
        let no_transcripts: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='transcripts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(no_transcripts, 0, "transcripts must not exist before v5 migration");

        // Run the full migration.
        super::migrate(&conn).unwrap();
        let post: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(post, 12);

        // transcripts must now exist.
        let has_transcripts: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='transcripts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_transcripts, 1, "transcripts must exist after v5 migration");
    }

    #[test]
    fn schema_creates_all_tables_including_transcripts() {
        let conn = open_in_memory().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('authors','works','chapters','author_tags','play_events','grouping_overrides','settings',
                  'tag_aliases','tag_parents','series','work_series_membership','transcripts',
                  'chapter_notes','chapter_bookmarks','label_types','work_metadata')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 16);
    }

    // ---- v6 migration tests --------------------------------------------------------

    #[test]
    fn migration_v6_adds_journal_tables_and_columns() {
        let conn = open_at_version(6).unwrap();
        // new tables exist
        for t in ["chapter_notes", "chapter_bookmarks"] {
            let n: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [t], |r| r.get(0),
                ).unwrap();
            assert_eq!(n, 1, "missing table {t}");
        }
        // new columns exist (PRAGMA table_info)
        let has_col = |table: &str, col: &str| -> bool {
            let mut s = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
            let x = s.query_map([], |r| r.get::<_, String>(1)).unwrap()
                .filter_map(Result::ok).any(|c| c == col);
            x
        };
        assert!(has_col("chapters", "user_summary"));
        assert!(has_col("chapters", "takeaway"));
        assert!(has_col("chapters", "is_favorite"));
        assert!(has_col("works", "re_entry_note"));
        assert!(has_col("works", "completion_rating"));
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 6);
    }

    #[test]
    fn legacy_db_upgrades_through_v6() {
        // Open at v1 (legacy), run full migrate(), expect LATEST (v12) and journal columns present.
        let conn = open_at_version(1).unwrap();
        migrate(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 12);
    }

    #[test]
    fn migration_v8_adds_metadata_tables_and_is_additive() {
        // A DB migrated to v7 has no metadata tables; upgrading to v8 adds them and
        // bumps user_version, leaving all earlier tables intact.
        let conn = open_at_version(7).unwrap();
        let v7: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v7, 7);
        run_step(&conn, 8, migration_v8_metadata).unwrap();
        let v8: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v8, 8);
        // The three new tables exist and are empty.
        for t in ["metadata_terms", "chapter_metadata", "author_metadata"] {
            let n: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{t} should exist and be empty");
        }
        // Earlier tables still present (additive).
        let _: i64 = conn.query_row("SELECT count(*) FROM works", [], |r| r.get(0)).unwrap();
        let _: i64 = conn.query_row("SELECT count(*) FROM saved_searches", [], |r| r.get(0)).unwrap();
    }

    #[test]
    fn open_at_version_11_reaches_latest() {
        // Opening at v11 then running full migrate reaches LATEST (v12).
        let conn = open_at_version(11).unwrap();
        let v11: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v11, 11, "open_at_version(11) must leave user_version at 11");
        migrate(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, LATEST, "migrating from v11 must reach LATEST");
    }

    #[test]
    fn open_at_version_12_reaches_latest() {
        let conn = open_at_version(12).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 12);
        assert_eq!(v, LATEST);
    }

    #[test]
    fn migration_v9_adds_playback_position_and_is_additive() {
        let conn = open_at_version(8).unwrap();
        assert!(conn
            .prepare("SELECT playback_position_secs FROM chapters")
            .is_err());
        run_step(&conn, 9, migration_v9_playback_position).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 9);
        conn.prepare("SELECT playback_position_secs FROM chapters").unwrap();
    }

    // ---- v10 migration tests --------------------------------------------------------

    #[test]
    fn migration_v10_is_additive_and_migrates_tags() {
        // Open at v9 (no label_types/work_metadata), seed legacy *_tags rows, then migrate.
        let conn = open_at_version(9).unwrap();
        let v9: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v9, 9);

        // Seed prerequisite rows: one author, one work, one chapter.
        conn.execute(
            "INSERT INTO authors(folder_name, status) VALUES ('Author A', 'active')",
            [],
        ).unwrap();
        let author_id: i64 = conn
            .query_row("SELECT id FROM authors WHERE folder_name='Author A'", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO works(author_id, base_title, sort_key) VALUES (?1, 'Work W', 'work w')",
            rusqlite::params![author_id],
        ).unwrap();
        let work_id: i64 = conn
            .query_row("SELECT id FROM works WHERE base_title='Work W'", [], |r| r.get(0))
            .unwrap();
        conn.execute(
            "INSERT INTO chapters(work_id, file_path, raw_filename, chapter_no, format, duration_secs)
             VALUES (?1, '/fake/ch1.mp3', 'ch1.mp3', 1, 'mp3', 0)",
            rusqlite::params![work_id],
        ).unwrap();
        let chapter_id: i64 = conn
            .query_row("SELECT id FROM chapters WHERE file_path='/fake/ch1.mp3'", [], |r| r.get(0))
            .unwrap();

        // Seed legacy tag rows.
        conn.execute(
            "INSERT INTO author_tags(author_id, tag) VALUES (?1, 'fantasy')",
            rusqlite::params![author_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO work_tags(work_id, tag) VALUES (?1, 'epic')",
            rusqlite::params![work_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_tags(chapter_id, tag) VALUES (?1, 'intro')",
            rusqlite::params![chapter_id],
        ).unwrap();

        // Run migrate() to apply v10 + v11 + v12.
        super::migrate(&conn).unwrap();
        let v10: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v10, 12);

        // label_types has the 4 seeded built-in rows.
        let lt_count: i64 = conn
            .query_row("SELECT count(*) FROM label_types", [], |r| r.get(0))
            .unwrap();
        assert_eq!(lt_count, 4, "label_types must have 4 seeded rows");
        // Verify known names are present.
        for name in ["narrator", "language", "tag", "mood"] {
            let n: i64 = conn
                .query_row(
                    "SELECT count(*) FROM label_types WHERE name=?1",
                    rusqlite::params![name],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "label_types must contain '{name}'");
        }

        // Tags were copied into metadata_terms with facet='tag'.
        for tag in ["fantasy", "epic", "intro"] {
            let n: i64 = conn
                .query_row(
                    "SELECT count(*) FROM metadata_terms WHERE facet='tag' AND value=?1",
                    rusqlite::params![tag],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "metadata_terms must contain tag '{tag}'");
        }

        // author_metadata attach row exists for 'fantasy'.
        let am: i64 = conn
            .query_row(
                "SELECT count(*) FROM author_metadata am
                 JOIN metadata_terms mt ON mt.id=am.term_id
                 WHERE am.author_id=?1 AND mt.facet='tag' AND mt.value='fantasy'",
                rusqlite::params![author_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(am, 1, "author_metadata must have 'fantasy' row");

        // work_metadata attach row exists for 'epic'.
        let wm: i64 = conn
            .query_row(
                "SELECT count(*) FROM work_metadata wm
                 JOIN metadata_terms mt ON mt.id=wm.term_id
                 WHERE wm.work_id=?1 AND mt.facet='tag' AND mt.value='epic'",
                rusqlite::params![work_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(wm, 1, "work_metadata must have 'epic' row");

        // chapter_metadata attach row exists for 'intro'.
        let cm: i64 = conn
            .query_row(
                "SELECT count(*) FROM chapter_metadata cm
                 JOIN metadata_terms mt ON mt.id=cm.term_id
                 WHERE cm.chapter_id=?1 AND mt.facet='tag' AND mt.value='intro'",
                rusqlite::params![chapter_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cm, 1, "chapter_metadata must have 'intro' row");

        // Legacy *_tags rows STILL EXIST (recoverable — never dropped).
        let at: i64 = conn
            .query_row("SELECT count(*) FROM author_tags WHERE author_id=?1", rusqlite::params![author_id], |r| r.get(0))
            .unwrap();
        assert_eq!(at, 1, "author_tags must still exist after v10 migration");
        let wt: i64 = conn
            .query_row("SELECT count(*) FROM work_tags WHERE work_id=?1", rusqlite::params![work_id], |r| r.get(0))
            .unwrap();
        assert_eq!(wt, 1, "work_tags must still exist after v10 migration");
        let ct: i64 = conn
            .query_row("SELECT count(*) FROM chapter_tags WHERE chapter_id=?1", rusqlite::params![chapter_id], |r| r.get(0))
            .unwrap();
        assert_eq!(ct, 1, "chapter_tags must still exist after v10 migration");
    }

    // ---- v11 migration tests --------------------------------------------------------

    #[test]
    fn migration_v11_adds_scan_tracking_columns_and_is_additive() {
        let conn = open_in_memory().unwrap();
        // columns exist and default to 0
        let (m, s, l): (i64, i64, i64) = {
            // insert a chapter via a minimal author/work/chapter chain
            conn.execute("INSERT INTO authors(folder_name,status) VALUES('A','active')", []).unwrap();
            let aid: i64 = conn.query_row("SELECT id FROM authors WHERE folder_name='A'", [], |r| r.get(0)).unwrap();
            conn.execute("INSERT INTO works(author_id,base_title,sort_key,status) VALUES(?1,'W','w','active')", [aid]).unwrap();
            let wid: i64 = conn.query_row("SELECT id FROM works WHERE author_id=?1", [aid], |r| r.get(0)).unwrap();
            conn.execute(
                "INSERT INTO chapters(work_id,file_path,raw_filename,chapter_no,format,duration_secs,status)
                 VALUES(?1,'/x/a.wav','a.wav',1,'wav',0,'active')", [wid]).unwrap();
            conn.query_row(
                "SELECT file_mtime, file_size, last_seen_scan FROM chapters LIMIT 1",
                [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap()
        };
        assert_eq!((m, s, l), (0, 0, 0));
        // the index exists
        let idx: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_chapters_last_seen'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(idx, 1);
    }
}
