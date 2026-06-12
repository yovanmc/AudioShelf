use audioshelf_lib::testing::{cover_cache_for_chapter, find_folder_image, CoverPriority};

/// The generated fixture drops `cover.png` into "Jane Doe" and "Sam Smith"; resolving a
/// cover for one of Jane's chapter files must produce a cached PNG thumbnail.
#[test]
fn fixture_folder_cover_resolves_to_thumbnail() {
    let lib = tempfile::tempdir().unwrap();
    gen_fixture::generate(lib.path()).unwrap();

    let jane = lib.path().join("Jane Doe");
    assert!(find_folder_image(&jane).is_some(), "fixture must drop a folder image for Jane Doe");

    let chapter = jane.join("Cool Story.wav");
    assert!(chapter.exists());

    let cache = tempfile::tempdir().unwrap();
    let p = cover_cache_for_chapter(cache.path(), &chapter, CoverPriority::FolderFirst, 256)
        .expect("Jane Doe cover should resolve");
    assert!(p.exists());
    let decoded = image::load_from_memory(&std::fs::read(&p).unwrap()).unwrap();
    assert!(decoded.width() <= 256 && decoded.height() <= 256);
}

/// A filler author ("Zz Sample Author NN") has no folder image and a tag-less WAV → no cover.
#[test]
fn fixture_author_without_art_has_no_cover() {
    let lib = tempfile::tempdir().unwrap();
    gen_fixture::generate(lib.path()).unwrap();

    let filler = lib.path().join("Zz Sample Author 01");
    assert!(find_folder_image(&filler).is_none());

    let chapter = filler.join("Quiet Hours.wav");
    let cache = tempfile::tempdir().unwrap();
    assert!(
        cover_cache_for_chapter(cache.path(), &chapter, CoverPriority::FolderFirst, 256).is_none(),
        "no embedded art and no folder image → None"
    );
}
