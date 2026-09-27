//! Restoring the JSX text runs the formatter projection held out of Oxfmt because they hold a
//! comment. `@tsrx/core` 0.5 reads a JavaScript comment in JSX text as a comment, which TSX does
//! not, so Oxfmt would reflow such a run as plain words and could join a line comment onto the
//! text after it. Each run comes back as authored, with its continuation lines re-indented to the
//! line Oxfmt placed its marker on. A significant edge space the projection moved out beside the
//! marker goes back into the run wherever it stays on the run's line.

use crate::diagnostics::ProjectionError;

use super::{
    super::format::{FormatProjection, RunEdge, TextRunManifest},
    text::{parse_decimal, skip_ascii_whitespace},
};

pub(super) fn lift_text_comment_runs(
    source: &str,
    projection: &FormatProjection,
) -> Result<String, ProjectionError> {
    let bytes = source.as_bytes();
    let needle = format!("{}Y", projection.prefix);
    let mut restored = vec![false; projection.text_comment_runs.len()];
    let mut output = String::with_capacity(source.len());
    let mut copied = 0usize;
    let mut search = 0usize;
    while let Some(relative) = source[search..].find(&needle) {
        let marker = search + relative;
        let (ordinal, digits_end) =
            parse_decimal(bytes, marker + needle.len()).ok_or(ProjectionError::MarkerResidual)?;
        let index = ordinal as usize;
        let run = projection.text_comment_runs.get(index).ok_or(ProjectionError::MarkerResidual)?;
        if restored[index] || bytes.get(digits_end..digits_end + 2) != Some(b"__") {
            return Err(ProjectionError::ScaffoldMismatch { index });
        }
        let (open, close) = marker_braces(source, marker, digits_end + 2, index)?;
        if open < copied {
            return Err(ProjectionError::ScaffoldMismatch { index });
        }
        let indent = line_indentation(source, open);
        let leading = leading_edge(source, open, copied, run);
        let trailing = trailing_edge(source, close, run);
        let close = trailing.end;
        output.push_str(&source[copied..leading.end]);
        if leading.space {
            output.push(' ');
        }
        let payload = run.payload(leading.keep_hoisted, trailing.keep_hoisted);
        let payload = payload.as_str();
        // Where Oxfmt put the marker on a line of its own, the run's leading spaces sit next to
        // a line break and are layout.
        let payload = if source[..leading.end].ends_with(indent)
            && source[..leading.end.saturating_sub(indent.len())].ends_with(['\n', '\r'])
        {
            payload.trim_start_matches([' ', '\t'])
        } else {
            payload
        };
        push_reindented(&mut output, payload, indent);
        if trailing.space {
            output.push(' ');
        }
        // A run that ends in a line comment needs a line break before whatever follows it.
        if ends_in_line_comment(payload)
            && !source[close..].trim_start_matches([' ', '\t']).starts_with(['\n', '\r'])
            && close < source.len()
        {
            output.push('\n');
            output.push_str(indent);
        }
        copied = close;
        search = close;
        restored[index] = true;
    }
    output.push_str(&source[copied..]);
    if let Some(index) = restored.iter().position(|seen| !seen) {
        return Err(ProjectionError::ScaffoldMismatch { index });
    }
    Ok(output)
}

/// How the lift closes one side of a held run.
struct Edge {
    /// Where authored output stops before the run, or resumes after it.
    end: usize,
    /// A space to write between the run and its neighbour.
    space: bool,
    /// The space the projection moved out on this side goes back into the run.
    keep_hoisted: bool,
}

/// A significant space before the marker. Where Oxfmt printed a moved-out space right beside the
/// marker, it goes back where it was authored, so an unwrapped line keeps its bytes. Where Oxfmt
/// broke the line at it and wrote `{" "}` at the line's edge, the space goes back onto the line
/// of the text it separates. A run of spaces and comments alone stays on its neighbour's line.
fn leading_edge(source: &str, open: usize, copied: usize, run: &TextRunManifest) -> Edge {
    let previous_text = |end: usize| {
        source[..end]
            .rfind(|character: char| !character.is_ascii_whitespace())
            .map(|index| index + 1)
            .filter(|index| *index >= copied)
    };
    if let Some(space) = run.hoisted_before
        && let Some(before) = open.checked_sub(1)
        && before >= copied
        && source[before..open] == run.authored[space..=space]
        && source[..before].chars().next_back().is_some_and(|c| !c.is_ascii_whitespace())
    {
        return Edge { end: before, space: false, keep_hoisted: true };
    }
    if run.before == RunEdge::Spaced
        && let Some(spacer) = spacer_before(source, open)
        && let Some(end) = previous_text(spacer)
    {
        let hoisted = run.hoisted_before.is_some();
        return Edge { end, space: !hoisted, keep_hoisted: hoisted };
    }
    if run.before == RunEdge::Glued
        && let Some(end) = previous_text(open)
        && source[end..open].contains(['\n', '\r'])
    {
        return Edge { end, space: false, keep_hoisted: false };
    }
    Edge { end: open, space: false, keep_hoisted: false }
}

/// The same after the marker's `}` at `close`.
fn trailing_edge(source: &str, close: usize, run: &TextRunManifest) -> Edge {
    let next_text = |from: usize| {
        let next = from
            + source[from..]
                .find(|character: char| !character.is_ascii_whitespace())
                .unwrap_or(source.len() - from);
        (source[from..next].contains(['\n', '\r']) && next < source.len()).then_some(next)
    };
    if let Some(space) = run.hoisted_after
        && source.get(close..=close) == Some(&run.authored[space..=space])
        && source[close + 1..].chars().next().is_some_and(|c| !c.is_ascii_whitespace())
    {
        return Edge { end: close + 1, space: false, keep_hoisted: true };
    }
    if run.after == RunEdge::Glued
        && let Some(end) = next_text(close)
    {
        return Edge { end, space: false, keep_hoisted: false };
    }
    if run.after == RunEdge::Spaced
        && source[close..].starts_with(SPACER)
        && let Some(end) = next_text(close + SPACER.len())
    {
        let hoisted = run.hoisted_after.is_some();
        return Edge { end, space: !hoisted, keep_hoisted: hoisted };
    }
    Edge { end: close, space: false, keep_hoisted: false }
}

/// Oxfmt's spelling of a significant JSX space at a line break.
const SPACER: &str = "{\" \"}";

/// The offset of a `{" "}` that ends the line before the marker at `open`, if one does.
fn spacer_before(source: &str, open: usize) -> Option<usize> {
    let gap_start = source[..open]
        .rfind(|character: char| !character.is_ascii_whitespace())
        .map_or(0, |index| index + 1);
    let gap = &source[gap_start..open];
    (gap.contains(['\n', '\r']) && source[..gap_start].ends_with(SPACER))
        .then(|| gap_start - SPACER.len())
}

/// Finds the braces around one marker: `{/*PY0__*/}` inline, or `{// PY0__` and a line break
/// before `}`. Returns the offset of `{` and the offset just past `}`.
fn marker_braces(
    source: &str,
    marker: usize,
    after_marker: usize,
    index: usize,
) -> Result<(usize, usize), ProjectionError> {
    let bytes = source.as_bytes();
    let (comment_start, comment_end) = if marker >= 2 && &bytes[marker - 2..marker] == b"/*" {
        if bytes.get(after_marker..after_marker + 2) != Some(b"*/") {
            return Err(ProjectionError::ScaffoldMismatch { index });
        }
        (marker - 2, after_marker + 2)
    } else if marker >= 3 && &bytes[marker - 3..marker] == b"// " {
        if !bytes.get(after_marker).is_some_and(|byte| matches!(byte, b'\n' | b'\r')) {
            return Err(ProjectionError::ScaffoldMismatch { index });
        }
        (marker - 3, after_marker)
    } else {
        return Err(ProjectionError::ScaffoldMismatch { index });
    };
    let open = bytes[..comment_start]
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
        .filter(|position| bytes[*position] == b'{')
        .ok_or(ProjectionError::ScaffoldMismatch { index })?;
    let close = skip_ascii_whitespace(source, comment_end);
    if bytes.get(close) != Some(&b'}') {
        return Err(ProjectionError::ScaffoldMismatch { index });
    }
    Ok((open, close + 1))
}

fn line_indentation(source: &str, position: usize) -> &str {
    let line_start = source.as_bytes()[..position]
        .iter()
        .rposition(|byte| matches!(byte, b'\n' | b'\r'))
        .map_or(0, |index| index + 1);
    let line = &source[line_start..position];
    &line[..line.len() - line.trim_start_matches([' ', '\t']).len()]
}

/// Writes a run with each continuation line re-indented to `indent`. Leading whitespace on a
/// continuation line of JSX text is layout, so this changes no text; a blank line stays blank.
fn push_reindented(output: &mut String, payload: &str, indent: &str) {
    let payload = payload.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = payload.split('\n');
    if let Some(first) = lines.next() {
        output.push_str(first);
    }
    for line in lines {
        output.push('\n');
        let line = line.trim_start_matches([' ', '\t']);
        if !line.is_empty() {
            output.push_str(indent);
            output.push_str(line);
        }
    }
}

/// True when the run's last line is a `//` comment, which runs to the end of the payload: the
/// scanner ends a run's content at its last non-whitespace byte, and a `//` is a comment only
/// where nothing but whitespace precedes it on its line or in its run.
fn ends_in_line_comment(payload: &str) -> bool {
    let last_line = payload.rsplit(['\n', '\r']).next().unwrap_or(payload);
    last_line.trim_start_matches([' ', '\t']).starts_with("//")
}
