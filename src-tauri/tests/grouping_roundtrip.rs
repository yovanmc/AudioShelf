//! End-to-end: scan, merge a standalone work into another via an override + regroup, then reset.

use audioshelf_lib::testing::{open_in_memory, query_author_detail, query_authors, regroup_author, scan_into};
use rusqlite::params;
use std::fs::{self, File};
use std::path::Path;

fn touch(path: &Path) {
    if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
    File::create(path).unwrap();
}

#[test]
fn grouping_override_merge_then_reset() {
    let tmp = tempfile::tempdir().unwrap();
    let author = tmp.path().join("Jane Doe");
    touch(&author.join("Cool Story.mp3"));
    touch(&author.join("Cool Story 2 the sequel.mp3"));
    touch(&author.join("Another Standalone Tale.mp3"));
    let conn = open_in_memory().unwrap();
    scan_into(&conn, tmp.path()).unwrap();
    let id = query_authors(&conn).unwrap()[0].id;
    assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 2);

    let path: String = conn.query_row(
        "SELECT file_path FROM chapters WHERE raw_filename='Another Standalone Tale.mp3'",
        [], |r| r.get(0)).unwrap();

    conn.execute(
        "INSERT INTO grouping_overrides(chapter_path, base_title, chapter_no) VALUES (?1,'Cool Story',3)",
        params![path]).unwrap();
    regroup_author(&conn, id).unwrap();
    let merged = query_author_detail(&conn, id).unwrap();
    assert_eq!(merged.works.len(), 1);
    assert_eq!(merged.works[0].chapters.len(), 3);

    conn.execute("DELETE FROM grouping_overrides WHERE chapter_path=?1", params![path]).unwrap();
    regroup_author(&conn, id).unwrap();
    assert_eq!(query_author_detail(&conn, id).unwrap().works.len(), 2);
}
