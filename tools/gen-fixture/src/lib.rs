//! Generate a deterministic synthetic audio library for tests and the harness.
//! Layout mirrors the real collection: Author folders containing loose WAV files
//! named with the base-title + number convention.

use std::path::Path;

/// Write a solid-colour PNG cover image into `dir` (exercises the folder-image cover path).
fn write_cover(dir: &Path, rgb: [u8; 3]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut img = image::RgbImage::new(160, 160);
    for px in img.pixels_mut() {
        *px = image::Rgb(rgb);
    }
    img.save(dir.join("cover.png"))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}

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
    write_cover(&jane, [196, 64, 64])?; // warm red cover

    // Author with a single multi-chapter work.
    let sam = root.join("Sam Smith");
    write_silence(&sam.join("Night Walk.wav"), 6)?;
    write_silence(&sam.join("Night Walk 2.wav"), 7)?;
    write_cover(&sam, [64, 120, 196])?; // cool blue cover

    // Trap: a lone numbered file that must NOT split into "Area" / chapter 51.
    let trap = root.join("Trap Author");
    write_silence(&trap.join("Area 51.wav"), 2)?;

    // Filler authors so the virtualized author list has enough rows to scroll —
    // this is what the `m7` walkthrough screenshots to prove virtualization.
    // CRITICAL: they are named "Zz Sample Author NN" to sort AFTER the three real
    // authors above, so walkthroughs that open the *first* author (player, grouping)
    // keep opening "Jane Doe" and are unaffected. The base title is non-numbered so
    // grouping treats each file as one standalone work.
    for n in 1..=40 {
        let dir = root.join(format!("Zz Sample Author {n:02}"));
        write_silence(&dir.join("Quiet Hours.wav"), 1)?;
    }

    Ok(())
}
