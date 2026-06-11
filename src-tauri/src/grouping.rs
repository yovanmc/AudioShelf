//! Group loose audio filenames under one author into works of ordered chapters.
//! Rule: the chapter number is the first standalone integer >= 2 in the stem;
//! text before it is the base title. Files sharing a base title form one work.
//! A lone numbered file with no siblings is demoted to a standalone work so that
//! titles like "Area 51" are not split into work "Area" / chapter 51.

use crate::natsort::natural_cmp;

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub base: String,
    pub chapter_no: u32,
    pub had_number: bool,
    /// Original filename stem as supplied by the caller.
    pub original: String,
}

/// Parse one filename stem (without extension).
/// The `original` field is left empty; callers that need it set it separately.
pub fn parse_stem(stem: &str) -> Parsed {
    let tokens: Vec<&str> = stem.split_whitespace().collect();
    for (i, tok) in tokens.iter().enumerate() {
        if i == 0 {
            continue; // a leading number is part of the title, never a chapter marker
        }
        if let Ok(n) = tok.parse::<u32>() {
            if n >= 2 {
                let base = tokens[..i].join(" ");
                if !base.is_empty() {
                    return Parsed { base, chapter_no: n, had_number: true, original: String::new() };
                }
            }
        }
    }
    Parsed { base: stem.trim().to_string(), chapter_no: 1, had_number: false, original: String::new() }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Chapter {
    pub stem: String,
    /// The original filename stem (without extension) as it appears on disk.
    /// Use this for file-path lookup; `stem` is the canonical display form.
    pub original_stem: String,
    pub chapter_no: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Work {
    pub base_title: String,
    pub chapters: Vec<Chapter>,
}

/// Group a set of filename stems (all under one author) into works.
pub fn group_author(stems: &[String]) -> Vec<Work> {
    use std::collections::BTreeMap;
    // Preserve stable ordering of bases by first appearance via an index map.
    let mut order: Vec<String> = Vec::new();
    let mut clusters: BTreeMap<String, Vec<Parsed>> = BTreeMap::new();
    for stem in stems {
        let p = parse_stem(stem);
        if !clusters.contains_key(&p.base) {
            order.push(p.base.clone());
        }
        clusters.entry(p.base.clone()).or_default().push(Parsed {
            base: p.base.clone(),
            chapter_no: p.chapter_no,
            had_number: p.had_number,
            original: stem.clone(),
        });
    }

    let mut works: Vec<Work> = Vec::new();
    for base in &order {
        let group = &clusters[base];
        let multi = group.len() > 1;
        for p in group {
            if !multi && p.had_number {
                // Demote a lone numbered file to a standalone work keyed on its full stem.
                let full = if p.chapter_no >= 2 {
                    format!("{} {}", p.base, p.chapter_no)
                } else {
                    p.base.clone()
                };
                works.push(Work {
                    base_title: full.clone(),
                    chapters: vec![Chapter { stem: full, original_stem: p.original.clone(), chapter_no: 1 }],
                });
            } else {
                let stem = if p.had_number {
                    format!("{} {}", p.base, p.chapter_no)
                } else {
                    p.base.clone()
                };
                if let Some(w) = works.iter_mut().find(|w| w.base_title == *base && multi) {
                    w.chapters.push(Chapter { stem, original_stem: p.original.clone(), chapter_no: p.chapter_no });
                } else {
                    works.push(Work {
                        base_title: base.clone(),
                        chapters: vec![Chapter { stem, original_stem: p.original.clone(), chapter_no: p.chapter_no }],
                    });
                }
            }
        }
    }
    for w in &mut works {
        w.chapters.sort_by(|a, b| a.chapter_no.cmp(&b.chapter_no).then(natural_cmp(&a.stem, &b.stem)));
    }
    works
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_base_and_chapter() {
        assert_eq!(parse_stem("Cool Story"), Parsed { base: "Cool Story".into(), chapter_no: 1, had_number: false, original: String::new() });
        assert_eq!(parse_stem("Cool Story 2 the sequel"), Parsed { base: "Cool Story".into(), chapter_no: 2, had_number: true, original: String::new() });
        assert_eq!(parse_stem("Cool Story 3 finale"), Parsed { base: "Cool Story".into(), chapter_no: 3, had_number: true, original: String::new() });
    }

    #[test]
    fn groups_multichapter_and_standalone() {
        let stems = vec![
            "Cool Story".to_string(),
            "Cool Story 2 the sequel".to_string(),
            "Cool Story 3 finale".to_string(),
            "Another Standalone Tale".to_string(),
        ];
        let works = group_author(&stems);
        assert_eq!(works.len(), 2);
        let cool = works.iter().find(|w| w.base_title == "Cool Story").unwrap();
        assert_eq!(cool.chapters.iter().map(|c| c.chapter_no).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert!(works.iter().any(|w| w.base_title == "Another Standalone Tale" && w.chapters.len() == 1));
    }

    #[test]
    fn lone_numbered_file_is_demoted_to_standalone() {
        let works = group_author(&vec!["Area 51".to_string()]);
        assert_eq!(works.len(), 1);
        assert_eq!(works[0].base_title, "Area 51");
        assert_eq!(works[0].chapters.len(), 1);
        assert_eq!(works[0].chapters[0].chapter_no, 1);
    }
}
