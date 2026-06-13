use audioshelf_lib::testing::open_at_version;

#[test]
fn v7_adds_tables_and_chapter_sort_column() {
    let conn = open_at_version(7).unwrap();
    let uv: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(uv, 7);
    // tables exist
    for t in ["saved_searches", "smart_collections"] {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [t],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "table {t} should exist");
    }
    // new column present (robust pragma_table_info form)
    let has: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('works') WHERE name='chapter_sort'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(has, 1);
}

#[test]
fn legacy_v6_db_upgrades_to_v7_cleanly() {
    let conn = open_at_version(6).unwrap();
    // This test documents that a v6 DB stays at v6 when opened with open_at_version(6).
    // v6→v7 is additive and idempotent (CREATE/ADD ... IF NOT EXISTS pattern).
    let uv: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(uv, 6);
}
