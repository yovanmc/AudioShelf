//! End-to-end: scan a temp library, apply canonical renames on disk, then undo.

use audioshelf_lib::testing::{build_plan, execute, open_in_memory, scan_into, undo, ItemStatus};
use std::fs::{self, File};
use std::path::Path;

fn touch(path: &Path) {
    if let Some(p) = path.parent() { fs::create_dir_all(p).unwrap(); }
    File::create(path).unwrap();
}

#[test]
fn rename_then_undo_leaves_disk_unchanged() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let author = root.join("Jane Doe");
    touch(&author.join("Cool Story.mp3"));
    touch(&author.join("Cool Story 2 the sequel.mp3"));
    touch(&author.join("Cool Story 3 finale.mp3"));
    let conn = open_in_memory().unwrap();
    scan_into(&conn, root).unwrap();

    let manifests = tmp.path().join("manifests");
    let plan = build_plan(&conn).unwrap();
    let ok_ids: Vec<i64> =
        plan.iter().filter(|i| i.status == ItemStatus::Ok).map(|i| i.chapter_id).collect();
    assert_eq!(ok_ids.len(), 2); // chapters 2 and 3 normalize; chapter 1 is a noop

    let res = execute(&conn, &ok_ids, &manifests, 1_700_000_000_000).unwrap();
    assert_eq!(res.renamed_count, 2);
    assert!(author.join("Cool Story 2.mp3").exists());
    assert!(author.join("Cool Story 3.mp3").exists());

    let undo_out = undo(&conn, Path::new(&res.manifest_path)).unwrap();
    assert_eq!(undo_out.reverted_count, 2);
    assert!(author.join("Cool Story 2 the sequel.mp3").exists());
    assert!(author.join("Cool Story 3 finale.mp3").exists());
    assert!(!author.join("Cool Story 2.mp3").exists());
}
