//! Putting each `>` in JSX text back. `@tsrx/core` reads a `>` there as text, where TSX rejects
//! it, so the projection wrote a one-byte stand-in OXC reads as text. Once every span is authored
//! again, a text that holds one of those offsets takes its `value` and `raw` from the source.

use tsrx_tape_schema::{FlatTape, RecordIndex};

use crate::{TsrxParseError, lexical::FinalizationIndex};

use super::{
    access::{has_type, scalar_u32},
    spans::slice_authored,
};

/// Rewrites the `value` and `raw` of each reachable `JSXText` whose authored span holds a `>` the
/// scanner read as JSX text. OXC's `value` for a JSX text is its source slice, as its `raw` is,
/// and the `>` is the only byte the projection changed inside one, so the authored slice is both.
///
/// A complete parse reaches every such text. A recovered one may have dropped the text a `>` was
/// in, and keeps the tree it has.
pub(crate) fn restore_jsx_text_gts(
    tape: &mut FlatTape,
    authored: &str,
    gts: &[u32],
    finalization_index: &FinalizationIndex,
    recovered: bool,
) -> Result<(), TsrxParseError> {
    if gts.is_empty() {
        return Ok(());
    }
    let mut restored = 0_usize;
    for (index, _) in finalization_index.reachable_span_fields() {
        let raw = u32::try_from(index).map_err(|_| {
            TsrxParseError::ResourceExhausted("object index exceeds the 32-bit tape limit")
        })?;
        let text = RecordIndex::new(raw);
        if !has_type(tape, text, r#""JSXText""#) {
            continue;
        }
        let start = scalar_u32(tape, text, "start")?;
        let end = scalar_u32(tape, text, "end")?;
        let first = gts.partition_point(|gt| *gt < start);
        let held = gts[first..].partition_point(|gt| *gt < end);
        if held == 0 {
            continue;
        }
        let source = slice_authored(authored, tsrx_syntax::ByteSpan::new(start, end))?;
        for name in ["value", "raw"] {
            if let Some(field) = tape.field_index(text, name) {
                let value = tape.push_json_string_scalar(source)?;
                tape.set_field_value(field, value)?;
            }
        }
        restored += held;
    }
    // Every `>` the scanner read as text sits in exactly one text, so each is restored once.
    if restored != gts.len() && !recovered {
        return Err(TsrxParseError::Unsupported("a `>` in JSX text has no reachable text"));
    }
    Ok(())
}
