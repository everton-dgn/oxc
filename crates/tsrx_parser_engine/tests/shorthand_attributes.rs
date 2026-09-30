//! Shorthand attributes, `{name}` for `name={name}` with `shorthand: true`, in every JSX
//! (tsrx-org/oxc#148) and on a dynamic tag (tsrx-org/oxc#147), as `@tsrx/core` 0.5.2 reads them.

#[expect(
    dead_code,
    reason = "the shared test-support module is compiled into every integration binary and each one uses a different part of it"
)]
mod support;

use support::{
    assert_all_records_and_scalar_bytes_reachable, object_field, optional_field, scalar_field, span,
};
use tsrx_parser_engine::{TsrxParseRequest, parse_tsrx};
use tsrx_tape_schema::{FlatTape, ParseCompleteness, RecordIndex, ValueKind};

/// Every reachable `JSXAttribute`, in source order.
fn attributes(tape: &FlatTape) -> Vec<RecordIndex> {
    let mut seen = vec![false; tape.object_count()];
    let mut pending = vec![tape.root()];
    let mut found = Vec::new();
    while let Some(value) = pending.pop() {
        match value.kind() {
            ValueKind::Missing | ValueKind::Scalar => {}
            ValueKind::Object => {
                let object = value.as_object().expect("object reference");
                if std::mem::replace(&mut seen[object.into_raw() as usize], true) {
                    continue;
                }
                if optional_field(tape, object, "type").and_then(|value| tape.scalar(value))
                    == Some(r#""JSXAttribute""#)
                {
                    found.push(object);
                }
                pending.extend(tape.fields(object).map(|record| record.value));
            }
            ValueKind::List => pending.extend(tape.values(value.as_list().expect("list"))),
        }
    }
    found.sort_by_key(|object| span(tape, *object));
    found
}

/// Each attribute as its span, its name and the name's span, whether it is a shorthand, and its
/// expression's type, name, and span.
type Shape = ((u32, u32), String, (u32, u32), bool, String, String, (u32, u32));

fn shapes(source: &str) -> Vec<Shape> {
    let result = parse_tsrx(&TsrxParseRequest { source })
        .unwrap_or_else(|error| panic!("{source:?} must parse: {error}"));
    assert_eq!(result.status, ParseCompleteness::Complete, "{source:?}: {:?}", result.errors);
    let tape = result.program();
    assert_all_records_and_scalar_bytes_reachable(tape);
    attributes(tape)
        .into_iter()
        .map(|attribute| {
            let name = object_field(tape, attribute, "name");
            let value = object_field(tape, attribute, "value");
            let expression = object_field(tape, value, "expression");
            let shorthand = optional_field(tape, attribute, "shorthand")
                .is_some_and(|value| tape.scalar(value) == Some("true"));
            // A shorthand's container is the whole attribute.
            if shorthand {
                assert_eq!(span(tape, value), span(tape, attribute), "{source:?}");
            }
            (
                span(tape, attribute),
                scalar_field(tape, name, "name").to_string(),
                span(tape, name),
                shorthand,
                scalar_field(tape, expression, "type").to_string(),
                scalar_field(tape, expression, "name").to_string(),
                span(tape, expression),
            )
        })
        .collect()
}

fn shorthand(start: u32, end: u32, name: &str, name_start: u32) -> Shape {
    let name_end = name_start + u32::try_from(name.len()).unwrap();
    (
        (start, end),
        format!(r#""{name}""#),
        (name_start, name_end),
        true,
        r#""Identifier""#.to_string(),
        format!(r#""{name}""#),
        (name_start, name_end),
    )
}

#[test]
fn a_shorthand_in_plain_jsx_is_a_shorthand_attribute() {
    assert_eq!(
        shapes("export function link({ href }) {\n\treturn <a {href} />;\n}"),
        [shorthand(44, 50, "href", 45)]
    );
    assert_eq!(shapes("const link = (href) => <a {href} />;"), [shorthand(26, 32, "href", 27)]);
    assert_eq!(shapes("const v = <a { a } />;"), [shorthand(13, 18, "a", 15)]);
    assert_eq!(shapes("const v = <a {/* c */ b} />;"), [shorthand(13, 24, "b", 22)]);
    assert_eq!(shapes("const v = <a{b}/>;"), [shorthand(12, 15, "b", 13)]);
}

#[test]
fn a_shorthand_on_a_dynamic_tag_is_a_shorthand_attribute() {
    assert_eq!(
        shapes("export function Heading({ tag, id }) @{\n\t<{tag} {id} />\n}"),
        [shorthand(48, 52, "id", 49)]
    );
    let source =
        "export function heading({ tag, id }) {\n\treturn <{tag} x={id} {id}>{id}</{tag}>;\n}";
    let shapes = shapes(source);
    assert_eq!(shapes.len(), 2);
    assert!(!shapes[0].3);
    assert_eq!(shapes[1], shorthand(61, 65, "id", 62));
}

#[test]
fn a_reserved_word_is_an_identifier_of_that_name_even_in_a_template() {
    assert_eq!(
        shapes("const v = <a {class} {this} {null} />;"),
        [
            shorthand(13, 20, "class", 14),
            shorthand(21, 27, "this", 22),
            shorthand(28, 34, "null", 29)
        ]
    );
    assert_eq!(
        shapes("export function App() @{\n\t<a {await} {yield} />\n}"),
        [shorthand(29, 36, "await", 30), shorthand(37, 44, "yield", 38)]
    );
}

#[test]
fn a_shorthand_attribute_value_is_its_container() {
    let source = "const v = <a {href} />;";
    let result = parse_tsrx(&TsrxParseRequest { source }).unwrap();
    let tape = result.program();
    let attribute = attributes(tape)[0];
    let value = object_field(tape, attribute, "value");
    assert_eq!(scalar_field(tape, value, "type"), r#""JSXExpressionContainer""#);
    assert_eq!(scalar_field(tape, attribute, "shorthand"), "true");
}
