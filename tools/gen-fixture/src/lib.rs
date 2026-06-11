//! Generate a deterministic synthetic audio library for tests and the harness.
//! Layout mirrors the real collection: Author folders containing loose WAV files
//! named with the base-title + number convention.

use std::path::Path;

/// Write `secs` seconds of silence as a mono 8 kHz 16-bit WAV.
fn write_silence(path: &Path, secs: u32) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 8000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    for _ in 0..(8000 * secs) {
        writer
            .write_sample(0i16)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    }
    writer
        .finalize()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}

pub fn generate(root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;

    // Author with a multi-chapter work and a standalone work.
    let jane = root.join("Jane Doe");
    write_silence(&jane.join("Cool Story.wav"), 2)?;
    write_silence(&jane.join("Cool Story 2 the sequel.wav"), 3)?;
    write_silence(&jane.join("Cool Story 3 finale.wav"), 4)?;
    write_silence(&jane.join("Another Standalone Tale.wav"), 5)?;

    // Author with a single multi-chapter work.
    let sam = root.join("Sam Smith");
    write_silence(&sam.join("Night Walk.wav"), 6)?;
    write_silence(&sam.join("Night Walk 2.wav"), 7)?;

    // Trap: a lone numbered file that must NOT split into "Area" / chapter 51.
    let trap = root.join("Trap Author");
    write_silence(&trap.join("Area 51.wav"), 2)?;

    Ok(())
}
