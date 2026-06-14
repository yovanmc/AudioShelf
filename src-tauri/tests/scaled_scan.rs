use audioshelf_lib::testing::{open_in_memory, scan_into};

#[test]
fn scaled_fixture_scans_to_expected_counts_and_rescan_skips() {
    let tmp = tempfile::tempdir().unwrap();
    // Small but structurally identical to the large fixture: 5 authors x 2 works x 3 chapters.
    gen_fixture::generate_scaled(tmp.path(), 5, 2, 3).unwrap();

    let conn = open_in_memory().unwrap();
    let first = scan_into(&conn, tmp.path()).unwrap();
    assert_eq!(first.authors, 5);
    assert_eq!(first.works, 10);
    assert_eq!(first.chapters, 30);
    assert_eq!(first.added, 30);

    // A second scan with nothing changed skips everything (incremental).
    let second = scan_into(&conn, tmp.path()).unwrap();
    assert_eq!(second.added, 0);
    assert_eq!(second.updated, 0);
    assert_eq!(second.removed, 0);
    assert_eq!(second.skipped, 30);
}

#[test]
#[ignore = "scale measurement; run explicitly with --ignored --nocapture"]
fn measure_scan_at_scale() {
    let tmp = tempfile::tempdir().unwrap();
    let (authors, works, chapters) = (1000u32, 3, 4); // ~12k chapters
    let t = std::time::Instant::now();
    gen_fixture::generate_scaled(tmp.path(), authors, works, chapters).unwrap();
    let gen_ms = t.elapsed().as_millis();
    let conn = open_in_memory().unwrap();
    let t = std::time::Instant::now();
    let first = scan_into(&conn, tmp.path()).unwrap();
    let scan_ms = t.elapsed().as_millis();
    let t = std::time::Instant::now();
    let second = scan_into(&conn, tmp.path()).unwrap();
    let rescan_ms = t.elapsed().as_millis();
    println!("SCALE-METRICS {{\"chapters\":{},\"genMs\":{},\"scanMs\":{},\"rescanMs\":{},\"rescanSkipped\":{}}}",
        first.chapters, gen_ms, scan_ms, rescan_ms, second.skipped);
    assert_eq!(second.skipped, first.chapters); // incremental rescan skips everything
}
