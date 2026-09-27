use tsrx_tape_schema::{FlatTape, RecordIndex, ValueRef};

use crate::TsrxParseError;

use super::{
    access::{has_type, scalar_field},
    edits::ListEntryRemoval,
};

/// Applies TSRX's JSX significant-whitespace rule over the serialized child lists in one flat
/// tape pass. Inline whitespace remains observable text; indentation-only text containing a line
/// break is scheduled for the shared validated in-place removal batch. JavaScript comments in the
/// text are comments, not text, so they leave both `value` and `raw`, as in `@tsrx/core` 0.5.
pub(super) fn normalize_template_layout_text(
    tape: &mut FlatTape,
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
            let value_field = tape
                .field_index(text, "value")
                .ok_or(TsrxParseError::Unsupported("JSXText has no value field"))?;
            let raw_field = tape
                .field_index(text, "raw")
                .ok_or(TsrxParseError::Unsupported("JSXText has no raw field"))?;
            let raw = scalar_field(tape, text, "raw")?;
            if let Some(stripped) = strip_text_comments_json(raw)? {
                if stripped.is_empty() || is_layout_only_text(&stripped) {
                    removals.push(ListEntryRemoval { list: children, entry });
                } else {
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

/// Leaves the JavaScript comments out of one JSON-encoded `JSXText.raw`, as `@tsrx/core` reads
/// template text: `/* ... */` is a comment anywhere, and `//` is a comment up to the line break
/// when only spaces and tabs precede it on its line (or since the text began), so inline text
/// such as `a // note` or `https://...` stays text. The whitespace around a comment stays.
/// Returns `None` when the text has no comment.
fn strip_text_comments_json(encoded: &str) -> Result<Option<String>, TsrxParseError> {
    let inner = encoded
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .ok_or(TsrxParseError::Unsupported("JSXText raw field is not a JSON string"))?;
    if !inner.contains('/') {
        return Ok(None);
    }
    let mut chars = inner.chars();
    let mut decoded = String::with_capacity(inner.len());
    loop {
        match next_json_string_character(&mut chars) {
            Ok(Some(character)) => decoded.push(character),
            Ok(None) => break,
            Err(()) => {
                return Err(TsrxParseError::Unsupported("JSXText raw field is not a JSON string"));
            }
        }
    }
    Ok(strip_text_comments(&decoded))
}

fn strip_text_comments(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut output = String::new();
    let mut changed = false;
    let mut segment_start = 0;
    let mut index = 0;
    // Only spaces and tabs since the text began or since the last line break.
    let mut line_blank = true;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'/' && bytes.get(index + 1) == Some(&b'/') && line_blank {
            output.push_str(&text[segment_start..index]);
            index += 2;
            while index < bytes.len() && !matches!(bytes[index], b'\n' | b'\r') {
                index += 1;
            }
            segment_start = index;
            changed = true;
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            output.push_str(&text[segment_start..index]);
            index = text[index + 2..].find("*/").map_or(bytes.len(), |close| index + 2 + close + 2);
            segment_start = index;
            changed = true;
            line_blank = false;
            continue;
        }
        match byte {
            b'\n' | b'\r' => line_blank = true,
            b' ' | b'\t' => {}
            _ => line_blank = false,
        }
        index += 1;
    }
    if !changed {
        return None;
    }
    output.push_str(&text[segment_start..]);
    Some(output)
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
    use super::{is_layout_only_text, is_layout_only_text_json, strip_text_comments};

    #[test]
    fn line_comments_leave_text_only_at_the_start_of_a_line() {
        assert_eq!(
            strip_text_comments("\n\t\ta\n\t\t// note\n\t\tb\n\t").as_deref(),
            Some("\n\t\ta\n\t\t\n\t\tb\n\t")
        );
        assert_eq!(strip_text_comments(" // note\n b").as_deref(), Some(" \n b"));
        assert_eq!(strip_text_comments("a // note"), None);
        assert_eq!(strip_text_comments("see https://example.com"), None);
        assert_eq!(strip_text_comments("/* x */ // y"), Some(" // y".to_owned()));
    }

    #[test]
    fn block_comments_leave_text_anywhere_and_keep_the_whitespace_around_them() {
        assert_eq!(strip_text_comments("a /* note */ b").as_deref(), Some("a  b"));
        assert_eq!(strip_text_comments("a/* x */b").as_deref(), Some("ab"));
        assert_eq!(strip_text_comments("/* only */").as_deref(), Some(""));
        assert_eq!(strip_text_comments("a /* open").as_deref(), Some("a "));
        assert_eq!(strip_text_comments("a &#47;* note *&#47; b"), None);
    }

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
