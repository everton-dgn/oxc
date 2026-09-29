//! Text `@tsrx/core` 0.5.2 reads in JSX where TSX would not: a `>` (tsrx-org/oxc#145), and a
//! branch keyword no control owns, such as `@else` in `<code>@else</code>` (tsrx-org/oxc#146).

#[expect(
    dead_code,
    reason = "the shared test-support module is compiled into every integration binary and each one uses a different part of it"
)]
mod support;

use support::{assert_all_records_and_scalar_bytes_reachable, scalar_field, span};
use tsrx_parser_engine::{TsrxParseRequest, parse_tsrx};
use tsrx_tape_schema::{FlatTape, ParseCompleteness, RecordIndex, ValueKind};

/// Every reachable object of `kind`, in source order.
fn objects_of(tape: &FlatTape, kind: &str) -> Vec<RecordIndex> {
    let expected = format!(r#""{kind}""#);
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
                if tape
                    .field_index(object, "type")
                    .and_then(|field| tape.field_value(field))
                    .and_then(|value| tape.scalar(value))
                    == Some(expected.as_str())
                {
                    found.push(object);
                }
                pending.extend(tape.fields(object).map(|record| record.value));
            }
            ValueKind::List => {
                pending.extend(tape.values(value.as_list().expect("list reference")));
            }
        }
    }
    found.sort_by_key(|object| span(tape, *object));
    found
}

/// A string as the tape quotes it.
fn quoted(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            other => output.push(other),
        }
    }
    output.push('"');
    output
}

/// Each JSX text as `(value, raw, start, end)`, as the tape quotes the strings.
fn texts(source: &str) -> Vec<(String, String, u32, u32)> {
    let result = parse_tsrx(&TsrxParseRequest { source })
        .unwrap_or_else(|error| panic!("{source:?} must parse: {error}"));
    assert_eq!(result.status, ParseCompleteness::Complete, "{source:?}: {:?}", result.errors);
    let tape = result.program();
    assert_all_records_and_scalar_bytes_reachable(tape);
    objects_of(tape, "JSXText")
        .into_iter()
        .map(|text| {
            let (start, end) = span(tape, text);
            (
                scalar_field(tape, text, "value").to_string(),
                scalar_field(tape, text, "raw").to_string(),
                start,
                end,
            )
        })
        .collect()
}

fn text(value: &str, start: u32, end: u32) -> (String, String, u32, u32) {
    (quoted(value), quoted(value), start, end)
}

#[test]
fn a_gt_in_jsx_text_is_text_with_its_authored_value_raw_and_span() {
    let source = "export function App() @{\n\t<p>a > b</p>\n}\n";
    assert_eq!(texts(source), [text("a > b", 29, 34)]);
    let source = "export function App() {\n\treturn <p>a > b</p>;\n}\n";
    assert_eq!(texts(source), [text("a > b", 35, 40)]);
    // A module with no TSRX syntax at all still takes the projection for its `>`.
    assert_eq!(texts("const a = <p>a > b</p>;"), [text("a > b", 13, 18)]);
}

#[test]
fn a_gt_at_a_texts_edges_beside_comments_children_and_containers() {
    let source = "const a = <div>>/* c > d */>{x}>>a<b>></b>></div>;";
    assert_eq!(
        texts(source),
        [
            text(">", 15, 16),
            text(">", 27, 28),
            text(">>a", 31, 34),
            text(">", 37, 38),
            text(">", 42, 43)
        ]
    );
    assert_eq!(texts("const a = <>-> =></>;"), [text("-> =>", 12, 17)]);
    let crlf = "const a = <p>\r\n>\r\n</p>;";
    assert_eq!(texts(crlf), [text("\r\n>\r\n", 13, 18)]);
    let entities = "const a = <p>&gt; > &amp;></p>;";
    assert_eq!(texts(entities), [text("&gt; > &amp;>", 13, 26)]);
}

#[test]
fn a_gt_in_text_in_every_control_body_and_a_dynamic_tag() {
    let source = concat!(
        "export function App() @{\n",
        "\t<div>\n",
        "\t@if (a) {<p>a > b</p>} @else {<p>c > d</p>}\n",
        "\t@for (const v of vs) {<li>e > f</li>} @empty {<li>g > h</li>}\n",
        "\t@try {<p>i > j</p>} @pending {<p>k > l</p>} @catch (e) {<p>m > n</p>}\n",
        "\t@switch (k) {@case 1: {<p>o > p</p>} @default: {<p>q > r</p>}}\n",
        "\t<{Tag}>s > t</{Tag}>\n",
        "\t</div>\n",
        "}\n",
    );
    let values = texts(source).into_iter().filter_map(|(value, raw, start, end)| {
        assert_eq!(value, raw);
        let authored = &source[start as usize..end as usize];
        assert_eq!(quoted(authored), value);
        (!authored.trim().is_empty()).then_some(value)
    });
    assert_eq!(
        values.collect::<Vec<_>>(),
        ["a > b", "c > d", "e > f", "g > h", "i > j", "k > l", "m > n", "o > p", "q > r", "s > t"]
            .map(quoted)
    );
}

#[test]
fn a_gt_outside_jsx_text_is_untouched() {
    let source =
        "const a = 1 > 0;\nconst b = <T,>(x: T) => x;\nconst c = <p title=\"a > b\">{1 > 0}</p>;";
    assert_eq!(texts(source), []);
}

#[test]
fn a_branch_keyword_no_control_owns_is_jsx_text() {
    for word in ["empty", "case", "default", "else", "catch", "pending"] {
        let source = format!("export function App() @{{\n\t<code>@{word}</code>\n}}\n");
        let end = 32 + u32::try_from(word.len()).unwrap() + 1;
        assert_eq!(texts(&source), [text(&format!("@{word}"), 32, end)], "@{word}");
    }
    assert_eq!(
        texts("const a = <p>me@else.com @catch (e)</p>;"),
        [text("me@else.com @catch (e)", 13, 35)]
    );
    // Text after a control, before a stray `@else`, keeps the `@else` as text too.
    let source = "export function App() @{\n\t<div>@if (a) {<b />} text @else {<i />}</div>\n}\n";
    assert_eq!(texts(source), [text(" text @else ", 46, 58)]);
}
