//! Pure parser for the M19 scoped-search DSL: `tag:` / `duration:` / `status:` + free text.

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum CmpOp { Lt, Le, Gt, Ge }

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct DurationFilter { pub op: CmpOp, pub secs: i64 }

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum StatusFilter { Unstarted, InProgress, Done }

/// A single metadata facet filter from the search DSL (e.g. `narrator:Roe`).
/// Matches a single whitespace-delimited token value (no quoting), like `tag:`.
/// Multi-word narrators/values are reached via the Narrators browse page or
/// Discover facet picker, which pass exact values.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct MetaFilter {
    pub facet: String,
    pub value: String,
}

#[derive(Debug, PartialEq, Eq, Clone, Default)]
pub struct ParsedQuery {
    pub text: String,
    pub tags: Vec<String>,
    pub duration: Option<DurationFilter>,
    pub status: Option<StatusFilter>,
    pub meta: Vec<MetaFilter>,
}

pub fn parse_query(raw: &str) -> ParsedQuery {
    let mut out = ParsedQuery::default();
    let mut text_parts: Vec<&str> = Vec::new();
    for tok in raw.split_whitespace() {
        if let Some(v) = tok.strip_prefix("tag:") {
            if !v.is_empty() { out.tags.push(v.to_string()); }
        } else if let Some(v) = tok.strip_prefix("duration:") {
            match parse_duration(v) {
                Some(d) => out.duration = Some(d),
                None => text_parts.push(tok), // unparseable → treat as text
            }
        } else if let Some(v) = tok.strip_prefix("status:") {
            match parse_status(v) {
                Some(s) => out.status = Some(s),
                None => text_parts.push(tok),
            }
        } else if let Some(v) = tok.strip_prefix("narrator:") {
            if !v.is_empty() { out.meta.push(MetaFilter { facet: "narrator".into(), value: v.to_string() }); }
            else { text_parts.push(tok); }
        } else if let Some(v) = tok.strip_prefix("language:") {
            if !v.is_empty() { out.meta.push(MetaFilter { facet: "language".into(), value: v.to_string() }); }
            else { text_parts.push(tok); }
        } else if let Some(v) = tok.strip_prefix("mood:") {
            if !v.is_empty() { out.meta.push(MetaFilter { facet: "mood".into(), value: v.to_string() }); }
            else { text_parts.push(tok); }
        } else if let Some(colon_pos) = tok.find(':') {
            // Generic `type:value` — any bareword prefix not already handled above becomes a
            // MetaFilter.  The scoped EXISTS on metadata_terms naturally returns no rows for
            // unknown facets, so no DB validation is needed here.
            let (prefix, rest) = tok.split_at(colon_pos);
            let v = &rest[1..]; // strip the ':'
            // Only treat as a facet filter if the prefix is a bare identifier (no spaces, not
            // empty) and the value part is non-empty.
            if !prefix.is_empty() && !v.is_empty()
                && prefix.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                out.meta.push(MetaFilter { facet: prefix.to_string(), value: v.to_string() });
            } else {
                text_parts.push(tok);
            }
        } else {
            text_parts.push(tok);
        }
    }
    out.text = text_parts.join(" ");
    out
}

fn parse_duration(v: &str) -> Option<DurationFilter> {
    let (op, rest) = if let Some(r) = v.strip_prefix("<=") {
        (CmpOp::Le, r)
    } else if let Some(r) = v.strip_prefix(">=") {
        (CmpOp::Ge, r)
    } else if let Some(r) = v.strip_prefix('<') {
        (CmpOp::Lt, r)
    } else if let Some(r) = v.strip_prefix('>') {
        (CmpOp::Gt, r)
    } else {
        (CmpOp::Le, v) // default: "up to"
    };
    let (num_str, unit) = rest.split_at(rest.find(|c: char| c.is_alphabetic()).unwrap_or(rest.len()));
    let num: i64 = num_str.parse().ok()?;
    let mult = match unit {
        "s" | "" => 1,
        "m" => 60,
        "h" => 3600,
        _ => return None,
    };
    Some(DurationFilter { op, secs: num * mult })
}

fn parse_status(v: &str) -> Option<StatusFilter> {
    match v.to_ascii_lowercase().as_str() {
        "unstarted" | "unplayed" => Some(StatusFilter::Unstarted),
        "inprogress" | "in-progress" => Some(StatusFilter::InProgress),
        "done" | "played" | "finished" => Some(StatusFilter::Done),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tags_duration_status_and_text() {
        let p = parse_query("tag:cozy   duration:<15m status:unplayed bedtime story");
        assert_eq!(p.tags, vec!["cozy".to_string()]);
        assert_eq!(p.duration, Some(DurationFilter { op: CmpOp::Lt, secs: 15 * 60 }));
        assert_eq!(p.status, Some(StatusFilter::Unstarted));
        assert_eq!(p.text, "bedtime story");
    }

    #[test]
    fn duration_default_op_is_le_and_units_convert() {
        assert_eq!(parse_query("duration:30m").duration, Some(DurationFilter { op: CmpOp::Le, secs: 1800 }));
        assert_eq!(parse_query("duration:>=1h").duration, Some(DurationFilter { op: CmpOp::Ge, secs: 3600 }));
        assert_eq!(parse_query("duration:<=90s").duration, Some(DurationFilter { op: CmpOp::Le, secs: 90 }));
    }

    #[test]
    fn status_aliases_collapse() {
        assert_eq!(parse_query("status:done").status, Some(StatusFilter::Done));
        assert_eq!(parse_query("status:played").status, Some(StatusFilter::Done));
        assert_eq!(parse_query("status:finished").status, Some(StatusFilter::Done));
        assert_eq!(parse_query("status:unplayed").status, Some(StatusFilter::Unstarted));
        assert_eq!(parse_query("status:inprogress").status, Some(StatusFilter::InProgress));
    }

    #[test]
    fn multiple_tags_and_unknown_keys_fall_through() {
        // Since T4, a generic `word:value` token is now parsed as a MetaFilter, not as text.
        // `foo:bar` becomes MetaFilter{facet:"foo", value:"bar"} and does NOT fall to text.
        let p = parse_query("tag:a tag:b foo:bar plain");
        assert_eq!(p.tags, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(p.meta, vec![MetaFilter { facet: "foo".into(), value: "bar".into() }]);
        assert_eq!(p.text, "plain");
    }

    #[test]
    fn empty_query_is_empty() {
        assert_eq!(parse_query("   "), ParsedQuery::default());
    }

    #[test]
    fn garbage_duration_is_ignored() {
        assert_eq!(parse_query("duration:abc").duration, None);
        assert_eq!(parse_query("duration:abc").text, "duration:abc");
    }

    #[test]
    fn parses_metadata_facet_filters() {
        let p = parse_query("narrator:Roe mood:cozy language:English ghosts");
        assert_eq!(p.meta, vec![
            MetaFilter { facet: "narrator".into(), value: "Roe".into() },
            MetaFilter { facet: "mood".into(), value: "cozy".into() },
            MetaFilter { facet: "language".into(), value: "English".into() },
        ]);
        assert_eq!(p.text, "ghosts");
    }

    #[test]
    fn empty_facet_value_falls_through_to_text() {
        let p = parse_query("narrator:");
        assert!(p.meta.is_empty());
        assert_eq!(p.text, "narrator:");
    }

    // ---- T4: generic type:value DSL ----

    #[test]
    fn generic_type_value_token_becomes_meta_filter() {
        let p = parse_query("format:podcast");
        assert_eq!(p.meta, vec![MetaFilter { facet: "format".into(), value: "podcast".into() }]);
        assert!(p.tags.is_empty());
        assert_eq!(p.text, "");
    }

    #[test]
    fn known_facets_still_parse_correctly() {
        // tag: goes to tags (not meta)
        let p = parse_query("tag:cozy");
        assert_eq!(p.tags, vec!["cozy".to_string()]);
        assert!(p.meta.is_empty());
        // narrator:/language:/mood: go to meta
        let p2 = parse_query("narrator:Alice language:English mood:calm");
        assert_eq!(p2.meta, vec![
            MetaFilter { facet: "narrator".into(), value: "Alice".into() },
            MetaFilter { facet: "language".into(), value: "English".into() },
            MetaFilter { facet: "mood".into(), value: "calm".into() },
        ]);
    }

    #[test]
    fn reserved_tokens_duration_and_status_are_not_generic_meta() {
        let p = parse_query("duration:<15m status:done");
        // duration and status must NOT appear in meta
        assert!(p.meta.is_empty());
        assert!(p.duration.is_some());
        assert!(p.status.is_some());
    }

    #[test]
    fn generic_token_with_empty_value_falls_through() {
        // "format:" has an empty value — should NOT become a MetaFilter
        let p = parse_query("format:");
        assert!(p.meta.is_empty());
        assert_eq!(p.text, "format:");
    }

    #[test]
    fn unknown_type_value_with_non_identifier_prefix_falls_to_text() {
        // "hello world:value" (space in prefix) — each token is already split by whitespace;
        // but a colon with non-alnum chars in prefix should fall through.
        let p = parse_query("123!:value");
        assert!(p.meta.is_empty());
        assert_eq!(p.text, "123!:value");
    }
}
