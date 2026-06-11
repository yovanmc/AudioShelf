use audioshelf_lib::testing::{open_in_memory, query_authors, scan_into};

#[test]
fn scanning_the_generated_fixture_produces_expected_counts() {
    let tmp = tempfile::tempdir().unwrap();
    gen_fixture::generate(tmp.path()).unwrap();

    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, tmp.path()).unwrap();
    assert_eq!(report.authors, 3);
    // Jane: "Cool Story" (3 ch) + "Another Standalone Tale" (1). Sam: "Night Walk" (2).
    // Trap: "Area 51" demoted to a standalone work (1).
    assert_eq!(report.works, 4);
    assert_eq!(report.chapters, 7);

    let authors = query_authors(&conn).unwrap();
    assert_eq!(authors.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(),
               vec!["Jane Doe", "Sam Smith", "Trap Author"]);
}
