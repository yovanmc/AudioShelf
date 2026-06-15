//! M35: prove real encoded audio files (not silent-WAV stubs) scan correctly.
use audioshelf_lib::testing::{make_thumbnail_png, open_in_memory, read_embedded_picture, scan_into};
use std::path::PathBuf;

fn media_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("media")
}

#[test]
fn real_encoded_formats_scan_with_nonzero_duration() {
    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, &media_root()).unwrap();
    // 7 real playable clips + 1 corrupt = 8 audio files ingested as chapters.
    assert!(report.chapters >= 8, "expected >=8 chapters, got {}", report.chapters);

    for fmt in ["mp3", "m4a", "mp4", "flac", "ogg", "wav"] {
        let dur: i64 = conn
            .query_row(
                "SELECT MAX(duration_secs) FROM chapters WHERE format = ?1 AND status = 'active'",
                [fmt],
                |r| r.get(0),
            )
            .unwrap_or(0);
        assert!(dur >= 1, "format {fmt} should probe a real duration, got {dur}");
    }
}

#[test]
fn corrupt_file_is_ingested_without_crashing() {
    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, &media_root()).unwrap();
    // Corrupt-but-readable file: lofty fails -> duration 0, no panic, scan completes.
    let zero: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE duration_secs = 0 AND status = 'active'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(zero >= 1, "corrupt file should be ingested with duration 0");
    assert!(!report.cancelled);
}

#[test]
fn embedded_cover_art_extracts_and_thumbnails() {
    let art = media_root().join("Real Formats").join("With Art - 01.mp3");
    let bytes = read_embedded_picture(&art).expect("embedded picture should be present");
    assert!(!bytes.is_empty(), "picture bytes should be non-empty");
    let thumb = make_thumbnail_png(&bytes, 256).expect("thumbnail should encode");
    assert!(!thumb.is_empty());
}

#[test]
fn scan_result_reports_unknown_duration_count() {
    let conn = open_in_memory().unwrap();
    let report = scan_into(&conn, &media_root()).unwrap();
    assert!(report.unknown_duration >= 1, "corrupt file should count as unknown-duration");
}
