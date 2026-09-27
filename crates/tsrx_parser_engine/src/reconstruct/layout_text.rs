use tsrx_syntax::{ByteSpan, ProjectionSegment};
use tsrx_tape_schema::{FlatTape, RecordIndex, ValueRef};

use crate::{TsrxParseError, projection::map_endpoint};

use super::{
    access::{has_type, scalar_field, scalar_u32},
    edits::ListEntryRemoval,
    spans::slice_authored,
};

/// Applies TSRX's JSX significant-whitespace rule over the serialized child lists in one flat
/// tape pass. Inline whitespace remains observable text; indentation-only text containing a line
/// break is scheduled for the shared validated in-place removal batch.
///
/// JavaScript comments in JSX text are comments, not text, as in `@tsrx/core` 0.5. The scanner
/// found them and the projection wrote them as whitespace, so OXC read the text around a comment
/// as one run. This pass takes them out of that run's `value` and `raw`, reading the text from
/// the authored source; a run left empty or layout-only goes like any other.
pub(super) fn normalize_template_layout_text(
    tape: &mut FlatTape,
    authored: &str,
    segments: &[ProjectionSegment],
    text_comments: &[ByteSpan],
    layout_containers: &[RecordIndex],
    removals: &mut Vec<ListEntryRemoval>,
) -> Result<(), TsrxParseError> {
    let mut text_updates = Vec::new();
    for &object in layout_containers {
        let Some(children) = tape
            .field_index(object, "children")
            .and_then(|field| tape.field_value(field))
            .and_then(ValueRef::as_list)
        else {
            continue;
        };
        for (entry, value) in tape.values_indexed(children) {
            let Some(text) = value.as_object().filter(|text| has_type(tape, *text, r#""JSXText""#))
            else {
                continue;
            };
            if !text_comments.is_empty()
                && let Some(stripped) =
                    authored_text_without_comments(tape, text, authored, segments, text_comments)?
            {
                if stripped.is_empty() || is_layout_only_text(&stripped) {
                    removals.push(ListEntryRemoval { list: children, entry });
                } else {
                    let value_field = tape
                        .field_index(text, "value")
                        .ok_or(TsrxParseError::Unsupported("JSXText has no value field"))?;
                    let raw_field = tape
                        .field_index(text, "raw")
                        .ok_or(TsrxParseError::Unsupported("JSXText has no raw field"))?;
                    text_updates.push((value_field, raw_field, stripped));
                }
                continue;
            }
            let value = scalar_field(tape, text, "value")?;
            if value == r#""""# || is_layout_only_text_json(value) {
                removals.push(ListEntryRemoval { list: children, entry });
            }
        }
    }
    for (value_field, raw_field, text) in text_updates {
        let value = tape.push_json_string_scalar(&text)?;
        tape.set_field_value(value_field, value)?;
        let raw = tape.push_json_string_scalar(&text)?;
        tape.set_field_value(raw_field, raw)?;
    }
    Ok(())
}

/// The authored text of one projected `JSXText` without the comments inside it, or `None` when
/// it holds none. `text_comments` is in source order.
fn authored_text_without_comments(
    tape: &FlatTape,
    text: RecordIndex,
    authored: &str,
    segments: &[ProjectionSegment],
    text_comments: &[ByteSpan],
) -> Result<Option<String>, TsrxParseError> {
    let (Some(start), Some(end)) = (
        map_endpoint(segments, scalar_u32(tape, text, "start")?, true),
        map_endpoint(segments, scalar_u32(tape, text, "end")?, false),
    ) else {
        return Ok(None);
    };
    let first = text_comments.partition_point(|comment| comment.end <= start);
    let inside = text_comments[first..].iter().take_while(|comment| comment.start < end);
    let mut stripped = String::new();
    let mut cursor = start;
    let mut changed = false;
    for comment in inside {
        if comment.start < start || comment.end > end {
            return Err(TsrxParseError::Unsupported("JSX text comment crosses its text"));
        }
        stripped.push_str(slice_authored(authored, ByteSpan::new(cursor, comment.start))?);
        cursor = comment.end;
        changed = true;
    }
    if !changed {
        return Ok(None);
    }
    stripped.push_str(slice_authored(authored, ByteSpan::new(cursor, end))?);
    Ok(Some(stripped))
}

/// JSX whitespace is space, tab, CR, and LF only: a non-breaking space (U+00A0) is text. Text made
/// of JSX whitespace that holds a line break is layout.
fn is_layout_only_text(text: &str) -> bool {
    text.bytes().all(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
        && text.bytes().any(|byte| matches!(byte, b'\n' | b'\r'))
}

/// Classifies one JSON string scalar without allocating it, with the whitespace rule of
/// [`is_layout_only_text`].
fn is_layout_only_text_json(encoded: &str) -> bool {
    let Some(inner) = encoded.strip_prefix('"').and_then(|value| value.strip_suffix('"')) else {
        return false;
    };
    let mut chars = inner.chars();
    let mut has_newline = false;
    loop {
        match next_json_string_character(&mut chars) {
            Ok(Some('\n' | '\r')) => has_newline = true,
            Ok(Some(' ' | '\t')) => {}
            Ok(None) => return has_newline,
            Ok(Some(_)) | Err(()) => return false,
        }
    }
}

fn next_json_string_character(chars: &mut std::str::Chars<'_>) -> Result<Option<char>, ()> {
    let Some(character) = chars.next() else {
        return Ok(None);
    };
    if character != '\\' {
        return Ok(Some(character));
    }
    let decoded = match chars.next() {
        Some('"') => '"',
        Some('\\') => '\\',
        Some('/') => '/',
        Some('b') => '\u{0008}',
        Some('f') => '\u{000c}',
        Some('n') => '\n',
        Some('r') => '\r',
        Some('t') => '\t',
        Some('u') => {
            let mut code_point = 0_u32;
            for _ in 0..4 {
                let Some(digit) = chars.next().and_then(|digit| digit.to_digit(16)) else {
                    return Err(());
                };
                code_point = (code_point << 4) | digit;
            }
            char::from_u32(code_point).ok_or(())?
        }
        _ => return Err(()),
    };
    Ok(Some(decoded))
}

#[cfg(test)]
mod tests {
    use super::{is_layout_only_text, is_layout_only_text_json};

    #[test]
    fn a_non_breaking_space_is_text_not_layout() {
        assert!(is_layout_only_text("\n\t\t"));
        assert!(!is_layout_only_text(" "));
        assert!(!is_layout_only_text("\u{a0}\n\t\t"));
        assert!(!is_layout_only_text("\n\t\t\u{a0}"));
        assert!(is_layout_only_text_json(r#""\n\t\t""#));
        assert!(!is_layout_only_text_json("\"\u{a0}\\n\\t\\t\""));
        assert!(!is_layout_only_text_json("\"\u{a0}\\n\""));
        assert!(!is_layout_only_text_json("\"\u{a0}\""));
        assert!(is_layout_only_text_json(r#"" \n""#));
    }
}
