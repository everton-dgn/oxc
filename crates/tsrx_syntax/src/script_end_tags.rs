//! `@tsrx/core`'s report of a `</script` that a raw `<script>` body keeps as text.
//!
//! HTML ends a script at any `</script` followed by whitespace, `/`, or `>`, in any letter case,
//! so core ends the body at the first lowercase `</script` followed by optional HTML whitespace
//! and `>` (as the scanner does) and reports every other `</script` left in the body as a
//! recoverable error, whatever follows it.

use crate::{ByteSpan, OverlayView};

/// `@tsrx/core`'s diagnostic code for a `</script` inside a `<script>` body.
pub const SCRIPT_END_TAG_IN_BODY_CODE: &str = "tsrx-script-end-tag-in-body";

/// One `</script` written inside a raw `<script>` body, in authored bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptEndTagInBody {
    /// Authored bytes of the `</script` as written, in whatever letter case.
    pub span: ByteSpan,
}

impl ScriptEndTagInBody {
    /// Core's message for this report, quoting the tag as `source` spells it.
    #[must_use]
    pub fn message(&self, source: &str) -> String {
        let written = source.get(self.span.start as usize..self.span.end as usize).unwrap_or("");
        let name = written.get(2..).unwrap_or("");
        format!(
            "'{written}' can end a script in HTML, so a '<script>' body can't contain it. Write '<\\/{name}' instead."
        )
    }
}

/// Every `</script` a parser-scan overlay's `<script>` bodies keep, in source order.
///
/// Core matches `/<\/script/giu`, so letter case is ignored under Unicode simple case folding:
/// ASCII letters in either case, and `ſ` (U+017F), which folds to `s`.
#[must_use]
pub fn script_end_tags_in_body(source: &str, overlay: OverlayView<'_>) -> Vec<ScriptEndTagInBody> {
    let bytes = source.as_bytes();
    let mut found = Vec::new();
    for script in overlay.script_blocks {
        let (start, end) = (script.content.start as usize, script.content.end as usize);
        let Some(content) = bytes.get(start..end) else {
            continue;
        };
        let mut cursor = 0;
        while let Some(relative) = content.get(cursor..).and_then(find_open) {
            let at = cursor + relative;
            match match_script_name(&content[at + 2..]) {
                Some(width) => {
                    let tag_end = at + 2 + width;
                    found.push(ScriptEndTagInBody {
                        span: ByteSpan::new(offset(start + at), offset(start + tag_end)),
                    });
                    cursor = tag_end;
                }
                None => cursor = at + 2,
            }
        }
    }
    found.sort_unstable_by_key(|report| report.span.start);
    found
}

fn find_open(bytes: &[u8]) -> Option<usize> {
    bytes.windows(2).position(|window| window == b"</")
}

/// The byte width of a case-folded `script` at the start of `bytes`.
fn match_script_name(bytes: &[u8]) -> Option<usize> {
    let mut index = 0;
    for expected in *b"script" {
        match bytes.get(index) {
            Some(byte) if byte.to_ascii_lowercase() == expected => index += 1,
            // U+017F LATIN SMALL LETTER LONG S folds to `s`.
            Some(0xC5) if expected == b's' && bytes.get(index + 1) == Some(&0xBF) => index += 2,
            _ => return None,
        }
    }
    Some(index)
}

fn offset(value: usize) -> u32 {
    // Script bodies are spans of a scanned source, which the scanner already bounds to `u32`.
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::script_end_tags_in_body;
    use crate::scan_for_parser;

    fn reports(source: &str) -> Vec<(String, String)> {
        let overlay = scan_for_parser(source).expect("the fixture scans");
        script_end_tags_in_body(source, overlay.view())
            .into_iter()
            .map(|report| {
                let written =
                    source[report.span.start as usize..report.span.end as usize].to_string();
                (written, report.message(source))
            })
            .collect()
    }

    #[test]
    fn every_other_script_end_tag_in_a_body_is_reported_as_core_does() {
        for (inner, written) in [
            ("</SCRIPT>", "</SCRIPT"),
            ("</script/>", "</script"),
            ("</scripts>", "</script"),
            ("</Script >", "</Script"),
            ("</\u{17f}cript>", "</\u{17f}cript"),
        ] {
            let source = format!(
                "export function App() @{{\n\t<div><script>a = 1;{inner}b = 2;</script></div>\n}}"
            );
            let found = reports(&source);
            let expected_message = format!(
                "'{written}' can end a script in HTML, so a '<script>' body can't contain it. Write '<\\/{}' instead.",
                &written[2..]
            );
            assert_eq!(found, vec![(written.to_string(), expected_message)], "{source:?}");
        }
    }

    #[test]
    fn a_clean_body_and_markup_outside_scripts_report_nothing() {
        for source in [
            "export function App() @{\n\t<script>const a = '<\\/script>';</script>\n}",
            "export function App() @{\n\t<div>{'</SCRIPT>'}</div>\n}",
            "export function App() @{\n\t<script>if (a </ b) go();</script>\n}",
        ] {
            assert_eq!(reports(source), Vec::new(), "{source:?}");
        }
    }

    #[test]
    fn several_reports_come_back_in_source_order() {
        let source = "export function App() @{\n\t<head><script></SCRIPT></Script></script><script>x</scripT></script></head>\n}";
        let found = reports(source).into_iter().map(|(written, _)| written).collect::<Vec<_>>();
        assert_eq!(found, ["</SCRIPT", "</Script", "</scripT"]);
    }
}
