//! Transcript ingestion and parsing utilities.
//!
//! Sidecars (`.srt`, `.vtt`) are read-only; content is stored in SQLite.

/// Strip timing/header lines from a raw SRT or WebVTT file and return the plain cue text.
///
/// Removes:
/// - `WEBVTT` header lines (the first line if it starts with "WEBVTT", plus any following
///   blank-separated header block)
/// - Cue-number lines (lines that are purely a decimal integer, as in SRT)
/// - Timestamp lines containing ` --> ` (covers both `HH:MM:SS,mmm --> …` and
///   `MM:SS.mmm --> …` variants)
/// - Blank lines used as cue separators
///
/// The remaining lines (cue text) are joined with newlines and returned trimmed.
pub fn parse_srt_vtt(text: &str) -> String {
    let mut lines = text.lines().peekable();
    let mut out: Vec<&str> = Vec::new();
    let mut skip_header_block = false;

    // Consume the optional WEBVTT header block: the "WEBVTT …" line plus any non-blank
    // continuation lines (header metadata), terminated by a blank line.
    if let Some(&first) = lines.peek() {
        if first.trim_start().starts_with("WEBVTT") {
            lines.next(); // consume the WEBVTT line
            skip_header_block = true;
        }
    }
    if skip_header_block {
        // Skip continuation lines until we hit a blank line (end of header block).
        for line in lines.by_ref() {
            if line.trim().is_empty() {
                break;
            }
        }
    }

    for line in lines {
        let trimmed = line.trim();
        // Skip blank separator lines.
        if trimmed.is_empty() {
            continue;
        }
        // Skip timestamp lines (contain " --> ").
        if trimmed.contains(" --> ") {
            continue;
        }
        // Skip cue-number lines: purely a decimal integer (SRT style).
        if trimmed.chars().all(|c| c.is_ascii_digit()) && !trimmed.is_empty() {
            continue;
        }
        out.push(trimmed);
    }

    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_srt_basic() {
        let srt = "1\n00:00:01,000 --> 00:00:04,000\nHello world.\n\n2\n00:00:05,000 --> 00:00:08,000\nSecond cue.\n";
        let result = parse_srt_vtt(srt);
        assert!(result.contains("Hello world."), "got: {result}");
        assert!(result.contains("Second cue."), "got: {result}");
        assert!(!result.contains("-->"), "timestamps must be stripped: {result}");
        assert!(!result.contains("00:00"), "timestamps must be stripped: {result}");
    }

    #[test]
    fn parses_srt_multiline_cue() {
        let srt = "1\n00:00:01,000 --> 00:00:04,000\nLine one.\nLine two.\n\n2\n00:00:05,000 --> 00:00:08,000\nThird line.\n";
        let result = parse_srt_vtt(srt);
        assert!(result.contains("Line one."), "got: {result}");
        assert!(result.contains("Line two."), "got: {result}");
        assert!(result.contains("Third line."), "got: {result}");
    }

    #[test]
    fn parses_vtt_basic() {
        let vtt = "WEBVTT\n\n00:00.000 --> 00:04.000\nHello VTT.\n\n00:05.000 --> 00:08.000\nSecond vtt cue.\n";
        let result = parse_srt_vtt(vtt);
        assert!(result.contains("Hello VTT."), "got: {result}");
        assert!(result.contains("Second vtt cue."), "got: {result}");
        assert!(!result.contains("WEBVTT"), "header must be stripped: {result}");
        assert!(!result.contains("-->"), "timestamps must be stripped: {result}");
    }

    #[test]
    fn parses_vtt_with_header_metadata() {
        let vtt = "WEBVTT\nKind: subtitles\nLanguage: en\n\n00:00.000 --> 00:04.000\nCue text here.\n";
        let result = parse_srt_vtt(vtt);
        assert!(result.contains("Cue text here."), "got: {result}");
        assert!(!result.contains("Kind:"), "header metadata must be stripped: {result}");
        assert!(!result.contains("Language:"), "header metadata must be stripped: {result}");
    }

    #[test]
    fn strips_cue_numbers_but_keeps_numeric_content() {
        // Cue numbers are standalone integer lines; numbers embedded in cue text are kept.
        let srt = "1\n00:00:01,000 --> 00:00:04,000\nChapter 3 begins here.\n\n2\n00:00:05,000 --> 00:00:08,000\nEnd.\n";
        let result = parse_srt_vtt(srt);
        // "Chapter 3 begins here." contains a digit but is NOT stripped.
        assert!(result.contains("Chapter 3 begins here."), "got: {result}");
        assert!(result.contains("End."), "got: {result}");
    }

    #[test]
    fn empty_input_returns_empty() {
        assert_eq!(parse_srt_vtt(""), "");
    }

    #[test]
    fn vtt_without_header_block_parsed_correctly() {
        // A VTT file that has WEBVTT but no metadata block (blank line follows directly).
        let vtt = "WEBVTT\n\n00:00.000 --> 00:04.000\nSimple cue.\n";
        let result = parse_srt_vtt(vtt);
        assert!(result.contains("Simple cue."), "got: {result}");
    }
}
