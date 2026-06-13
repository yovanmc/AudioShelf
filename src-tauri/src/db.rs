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

/// Open a file-backed connection and ensure the schema exists (idempotent).
pub fn open(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
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

/// Ordered, idempotent migration runner. Each step bumps user_version inside its own
/// transaction so a crash mid-migration leaves the DB at the last fully-applied version.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    const LATEST: i64 = 3; // bump as later tasks add steps
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
                  'tag_aliases','tag_parents')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 9);
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
        assert_eq!(ver, 3);
    }

    #[test]
    fn migrate_from_v1_is_noop_when_current() {
        let conn = open_in_memory().unwrap();
        // Running migrate a second time must leave user_version at 3 without error.
        super::migrate(&conn).unwrap();
        let ver: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 3);
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
        assert_eq!(post, 3);
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
    fn open_in_memory_has_v2_tables_and_user_version_3() {
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
        assert_eq!(ver, 3);
    }

    #[test]
    fn upgrade_from_v1_to_v2() {
        // Open at v1 (no tag_aliases/tag_parents), then run migrate to reach v3.
        let conn = open_at_version(1).unwrap();
        let pre: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pre, 1);
        // Run full migration — should add v2 tables and v3 columns.
        super::migrate(&conn).unwrap();
        let post: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(post, 3);
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

        // Run the full migration to reach v3.
        super::migrate(&conn).unwrap();
        let post: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(post, 3);

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
}
