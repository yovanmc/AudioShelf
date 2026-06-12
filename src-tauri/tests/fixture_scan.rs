use audioshelf_lib::testing::{open_in_memory, query_authors, scan_into};

#[test]
fn scanning_the_generated_fixture_produces_expected_counts() {
    let tmp = tempfile::tempdir().unwrap();
    gen_fixture::generate(tmp.path()).unwrap();

    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, tmp.path()).unwrap();
    // 3 real authors + 40 "Zz Sample Author NN" filler authors added in M7 for
    // virtualization testing.
    assert_eq!(report.authors, 43);
    // Jane: "Cool Story" (3 ch) + "Another Standalone Tale" (1). Sam: "Night Walk" (2).
    // Trap: "Area 51" demoted to a standalone work (1).
    // Filler: 40 authors × 1 "Quiet Hours" standalone work each.
    assert_eq!(report.works, 44);
    assert_eq!(report.chapters, 47);

    let authors = query_authors(&conn).unwrap();
    // Real authors sort first (natural sort); filler authors sort last ("Zz...").
    assert_eq!(&authors[0].name, "Jane Doe");
    assert_eq!(&authors[1].name, "Sam Smith");
    assert_eq!(&authors[2].name, "Trap Author");
    assert_eq!(authors.len(), 43);
    assert!(authors[3].name.starts_with("Zz Sample Author"));
    assert_eq!(&authors[42].name, "Zz Sample Author 40");
}
