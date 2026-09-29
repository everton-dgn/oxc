//! JSX shorthand attributes, projected as `name={name}` and restored as authored `{name}` nodes.

use tsrx_syntax::{ByteSpan, OverlayView, ProjectionSegment};
use tsrx_tape_schema::{FlatTape, RecordIndex};

use crate::{TsrxParseError, projection::map_endpoint};

use super::{
    access::{field_value, has_type, object_field, scalar_field, scalar_u32},
    spans::{AuthoredStart, record_authored_span},
};

pub(super) fn reconstruct_shorthand_attributes(
    tape: &mut FlatTape,
    authored: &str,
    overlay: OverlayView<'_>,
    segments: &[ProjectionSegment],
    prefix: &str,
    attributes: &[(u32, RecordIndex)],
    starts: &mut Vec<AuthoredStart>,
) -> Result<(), TsrxParseError> {
    let mut attribute_cursor = 0;
    for (index, shorthand) in overlay.parser_shorthand_attributes.iter().enumerate() {
        let mut projected = None;
        while let Some(&(_, attribute)) = attributes.get(attribute_cursor) {
            attribute_cursor += 1;
            if !is_projected_shorthand(
                tape, authored, attribute, *shorthand, segments, prefix, index,
            )? {
                continue;
            }
            projected = Some(attribute);
            break;
        }
        let attribute = projected
            .ok_or(TsrxParseError::Unsupported("projected shorthand attribute is missing"))?;
        let reserved = reserved_name(authored, *shorthand)?;
        if tape.field_index(attribute, "shorthand").is_some() {
            return Err(TsrxParseError::Unsupported(
                "projected shorthand attribute already has a shorthand field",
            ));
        }
        let name = object_field(tape, attribute, "name")?;
        let container = object_field(tape, attribute, "value")?;
        let expression = object_field(tape, container, "expression")?;
        if let Some(name) = reserved {
            // The projection wrote a stand-in for the reserved word, which `@tsrx/core` reads as
            // an `Identifier` of that name.
            let name = tape.push_json_string_scalar(name)?;
            let name_field = tape.field_index(expression, "name").ok_or(
                TsrxParseError::Unsupported("projected shorthand stand-in has no name field"),
            )?;
            tape.set_field_value(name_field, name)?;
            record_authored_span(starts, expression, shorthand.identifier);
        }
        let expression_name = field_value(tape, expression, "name")?;
        let name_field = tape
            .field_index(name, "name")
            .ok_or(TsrxParseError::Unsupported("projected shorthand name has no name field"))?;
        tape.set_field_value(name_field, expression_name)?;
        let shorthand_value = tape.push_scalar("true")?;
        tape.append_field(attribute, "shorthand", shorthand_value)?;
        record_authored_span(starts, attribute, shorthand.span);
        record_authored_span(starts, name, shorthand.identifier);
    }
    Ok(())
}

/// The authored name of a shorthand attribute the projection wrote a stand-in for.
fn reserved_name(
    authored: &str,
    shorthand: tsrx_syntax::ParserShorthandAttribute,
) -> Result<Option<&str>, TsrxParseError> {
    let name = authored
        .get(shorthand.identifier.start as usize..shorthand.identifier.end as usize)
        .ok_or(TsrxParseError::Unsupported("shorthand attribute name is not a source boundary"))?;
    Ok(tsrx_syntax::shorthand_name_is_reserved(name.as_bytes()).then_some(name))
}

fn is_projected_shorthand(
    tape: &FlatTape,
    authored: &str,
    attribute: RecordIndex,
    shorthand: tsrx_syntax::ParserShorthandAttribute,
    segments: &[ProjectionSegment],
    prefix: &str,
    index: usize,
) -> Result<bool, TsrxParseError> {
    if map_endpoint(segments, scalar_u32(tape, attribute, "end")?, false)
        != Some(shorthand.span.end)
    {
        return Ok(false);
    }
    let name = object_field(tape, attribute, "name")?;
    if !has_type(tape, name, r#""JSXIdentifier""#)
        || !super::scaffold::scaffold_name_matches(
            scalar_field(tape, name, "name")?,
            prefix,
            'S',
            index,
        )
    {
        return Ok(false);
    }
    let container = object_field(tape, attribute, "value")?;
    if !has_type(tape, container, r#""JSXExpressionContainer""#)
        || !mapped_object_span(tape, container, shorthand.span, segments)?
    {
        return Ok(false);
    }
    let expression = object_field(tape, container, "expression")?;
    if !has_type(tape, expression, r#""Identifier""#) {
        return Ok(false);
    }
    // A reserved name was written as a stand-in, which maps to no authored bytes.
    if reserved_name(authored, shorthand)?.is_some() {
        return Ok(scalar_field(tape, expression, "name")?
            == format!(r#""{}""#, tsrx_syntax::SHORTHAND_RESERVED_NAME_STAND_IN));
    }
    mapped_object_span(tape, expression, shorthand.identifier, segments)
}

fn mapped_object_span(
    tape: &FlatTape,
    object: RecordIndex,
    authored: ByteSpan,
    segments: &[ProjectionSegment],
) -> Result<bool, TsrxParseError> {
    mapped_span(tape, object, authored.start, authored.end, segments)
}

fn mapped_span(
    tape: &FlatTape,
    object: RecordIndex,
    authored_start: u32,
    authored_end: u32,
    segments: &[ProjectionSegment],
) -> Result<bool, TsrxParseError> {
    Ok(map_endpoint(segments, scalar_u32(tape, object, "start")?, true) == Some(authored_start)
        && map_endpoint(segments, scalar_u32(tape, object, "end")?, false) == Some(authored_end))
}
