use tsrx_parser_engine::{
    TsrxParseOptions, TsrxParseRequest, TsrxUtf16ParseRequest, parse_tsrx, parse_tsrx_utf16,
    parse_tsrx_with_options,
};
use tsrx_tape_schema::{FlatTape, RecordIndex, ValueKind, ValueRef};

fn field(tape: &FlatTape, object: RecordIndex, name: &str) -> ValueRef {
    tape.fields(object)
        .find(|record| tape.key(record) == name)
        .unwrap_or_else(|| panic!("missing `{name}` field"))
        .value
}

fn object_field(tape: &FlatTape, object: RecordIndex, name: &str) -> RecordIndex {
    field(tape, object, name).as_object().unwrap_or_else(|| panic!("`{name}` is not an object"))
}

fn list_field(tape: &FlatTape, object: RecordIndex, name: &str) -> Vec<ValueRef> {
    let list =
        field(tape, object, name).as_list().unwrap_or_else(|| panic!("`{name}` is not a list"));
    tape.values(list).collect()
}

fn scalar_field<'a>(tape: &'a FlatTape, object: RecordIndex, name: &str) -> &'a str {
    tape.scalar(field(tape, object, name)).unwrap_or_else(|| panic!("`{name}` is not a scalar"))
}

fn span(tape: &FlatTape, object: RecordIndex) -> (u32, u32) {
    (
        tape.scalar_u32(field(tape, object, "start")).expect("numeric start"),
        tape.scalar_u32(field(tape, object, "end")).expect("numeric end"),
    )
}

fn offset(value: usize) -> u32 {
    u32::try_from(value).expect("fixture fits in a u32 span")
}

fn reachable_scalar_bytes(tape: &FlatTape, value: ValueRef) -> usize {
    match value.kind() {
        ValueKind::Missing => 0,
        ValueKind::Scalar => value.as_scalar().map_or(0, |range| {
            usize::try_from(range.length).expect("fixture scalar range fits usize")
        }),
        ValueKind::Object => tape
            .fields(value.as_object().expect("object index"))
            .map(|field| reachable_scalar_bytes(tape, field.value))
            .sum(),
        ValueKind::List => tape
            .values(value.as_list().expect("list index"))
            .map(|item| reachable_scalar_bytes(tape, item))
            .sum(),
    }
}

#[test]
fn reconstructs_a_simple_authored_function_body_as_jsx_code_block() {
    let source = "function View() @{ const x = 1; <main>{x}</main> }";
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("simple TSRX must parse");
    let tape = result.program();

    let program = tape.root().as_object().expect("Program root");
    assert_eq!(scalar_field(tape, program, "type"), r#""Program""#);
    assert_eq!(span(tape, program), (0, offset(source.len())));

    let program_body = list_field(tape, program, "body");
    assert_eq!(program_body.len(), 1);
    let function = program_body[0].as_object().expect("FunctionDeclaration");
    assert_eq!(scalar_field(tape, function, "type"), r#""FunctionDeclaration""#);
    assert_eq!(span(tape, function), (0, offset(source.len())));

    let code_block = object_field(tape, function, "body");
    assert_eq!(scalar_field(tape, code_block, "type"), r#""JSXCodeBlock""#);
    assert_eq!(
        tape.scalar_u32(field(tape, code_block, "start")),
        Some(offset(source.find("@{").expect("authored body")))
    );
    assert_eq!(
        span(tape, code_block),
        (offset(source.find("@{").expect("authored body")), offset(source.len()))
    );

    let statements = list_field(tape, code_block, "body");
    assert_eq!(statements.len(), 1);
    let declaration = statements[0].as_object().expect("VariableDeclaration");
    assert_eq!(scalar_field(tape, declaration, "type"), r#""VariableDeclaration""#);
    let declaration_start = offset(source.find("const x").expect("declaration"));
    assert_eq!(
        span(tape, declaration),
        (declaration_start, declaration_start + offset("const x = 1;".len()))
    );

    let render = object_field(tape, code_block, "render");
    assert_eq!(scalar_field(tape, render, "type"), r#""JSXElement""#);
    let render_start = offset(source.find("<main>").expect("render"));
    assert_eq!(span(tape, render), (render_start, render_start + offset("<main>{x}</main>".len())));

    let metadata = object_field(tape, code_block, "metadata");
    assert!(list_field(tape, metadata, "path").is_empty());
    assert!(!tape.scalar_storage().contains("__OXC_TSRX"));
    assert!(!tape.scalar_storage().contains("OXC_TSRX"));
    assert!(!tape.scalar_storage().contains("/*_t"));
    assert_eq!(
        reachable_scalar_bytes(tape, tape.root()),
        tape.scalar_storage().len(),
        "packed scalar storage must contain no unreachable projected values"
    );
    for raw in 0..tape.object_count() {
        let object = RecordIndex::new(offset(raw));
        let Some(kind) = tape
            .field_index(object, "type")
            .and_then(|field| tape.field_value(field))
            .and_then(|value| tape.scalar(value))
        else {
            continue;
        };
        assert_ne!(kind, r#""ExpressionStatement""#);
    }
}

#[test]
fn code_block_without_terminal_jsx_has_an_explicit_null_render() {
    let source = "function View() @{ const x = 1; }";
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("code-only TSRX body");
    let tape = result.program();
    let program = tape.root().as_object().expect("Program root");
    let function = list_field(tape, program, "body")[0].as_object().expect("FunctionDeclaration");
    let code_block = object_field(tape, function, "body");
    assert_eq!(scalar_field(tape, code_block, "type"), r#""JSXCodeBlock""#);
    assert_eq!(list_field(tape, code_block, "body").len(), 1);
    assert_eq!(tape.scalar(field(tape, code_block, "render")), Some("null"));
}

#[test]
fn native_template_children_drop_layout_text_but_keep_inline_space() {
    let source =
        concat!("function View() @{ <main>\n", "  <span>x</span>\n", "  <b/> <i/>\n", "</main> }",);
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("native template whitespace");
    let tape = result.program();
    let program = tape.root().as_object().expect("Program root");
    let function = list_field(tape, program, "body")[0].as_object().expect("FunctionDeclaration");
    let code_block = object_field(tape, function, "body");
    let main = object_field(tape, code_block, "render");
    let children = list_field(tape, main, "children");

    let kinds = children
        .iter()
        .map(|value| scalar_field(tape, value.as_object().expect("JSX child object"), "type"))
        .collect::<Vec<_>>();
    assert_eq!(kinds, [r#""JSXElement""#, r#""JSXElement""#, r#""JSXText""#, r#""JSXElement""#,]);
    let inline_space = children[2].as_object().expect("inline JSXText");
    assert_eq!(scalar_field(tape, inline_space, "value"), r#"" ""#);
}

#[test]
fn native_template_children_drop_layout_line_comments() {
    let source = concat!(
        "function View() @{ <main>\n",
        "// markless-allow EXAMPLE: fixture\n",
        "<span/>\n",
        "</main> }",
    );
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("template line comment");
    let tape = result.program();
    let program = tape.root().as_object().expect("Program root");
    let function = list_field(tape, program, "body")[0].as_object().expect("FunctionDeclaration");
    let code_block = object_field(tape, function, "body");
    let main = object_field(tape, code_block, "render");
    let children = list_field(tape, main, "children");
    assert_eq!(children.len(), 1);
    assert_eq!(
        scalar_field(tape, children[0].as_object().expect("span child"), "type"),
        r#""JSXElement""#
    );
}

#[test]
fn native_template_text_drops_block_comments_from_value_and_raw() {
    let source = "function View() @{ <main>before/*M9_CHILDREN*/after<i/>/*only-comment*/</main> }";
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("template block comments");
    let tape = result.program();
    let program = tape.root().as_object().expect("Program root");
    let function = list_field(tape, program, "body")[0].as_object().expect("FunctionDeclaration");
    let code_block = object_field(tape, function, "body");
    let main = object_field(tape, code_block, "render");
    let children = list_field(tape, main, "children");

    assert_eq!(children.len(), 2, "comment-only JSX text is not a child");
    let text = children[0].as_object().expect("JSXText child");
    assert_eq!(scalar_field(tape, text, "type"), r#""JSXText""#);
    assert_eq!(scalar_field(tape, text, "value"), r#""beforeafter""#);
    // `@tsrx/core` 0.5 (tsrx-org/tsrx#711): a comment between children is not text, so `raw`
    // leaves it out too.
    assert_eq!(scalar_field(tape, text, "raw"), r#""beforeafter""#);
    assert_eq!(
        scalar_field(tape, children[1].as_object().expect("element child"), "type"),
        r#""JSXElement""#
    );
}

#[test]
fn reconstructs_jsx_child_code_blocks_when_parenthesis_nodes_are_disabled() {
    let source = "function View() @{ <main>@{ const x=1; <span>{x}</span> }</main> }";
    let result = parse_tsrx_with_options(
        &TsrxParseRequest { source },
        TsrxParseOptions { preserve_parens: Some(false), ..TsrxParseOptions::default() },
    )
    .expect("JSX child code block without ParenthesizedExpression nodes");
    let tape = result.program();
    let program = tape.root().as_object().expect("Program root");
    let function = list_field(tape, program, "body")[0].as_object().expect("FunctionDeclaration");
    let code_block = object_field(tape, function, "body");
    let main = object_field(tape, code_block, "render");
    let child = list_field(tape, main, "children")[0].as_object().expect("JSXCodeBlock child");
    assert_eq!(scalar_field(tape, child, "type"), r#""JSXCodeBlock""#);
}

fn rendered_children(tape: &FlatTape) -> Vec<ValueRef> {
    let program = tape.root().as_object().expect("Program root");
    let function = list_field(tape, program, "body")[0].as_object().expect("FunctionDeclaration");
    let code_block = object_field(tape, function, "body");
    let element = object_field(tape, code_block, "render");
    list_field(tape, element, "children")
}

#[test]
fn native_template_text_drops_line_comments_from_value_and_raw() {
    // tsrx-org/oxc#110: a `//` with only whitespace before it on its line is a comment, and the
    // whitespace around it stays, as in `@tsrx/core` 0.5. Inline `a // note` stays text.
    let source = "function View() @{\n\t<p>\n\t\ta\n\t\t// note\n\t\tb\n\t</p>\n}";
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("template line comment");
    let tape = result.program();
    let children = rendered_children(tape);
    assert_eq!(children.len(), 1);
    let text = children[0].as_object().expect("JSXText child");
    assert_eq!(scalar_field(tape, text, "type"), r#""JSXText""#);
    assert_eq!(scalar_field(tape, text, "value"), r#""\n\t\ta\n\t\t\n\t\tb\n\t""#);
    assert_eq!(scalar_field(tape, text, "raw"), r#""\n\t\ta\n\t\t\n\t\tb\n\t""#);

    let source = "function View() @{\n\t<p>a // note</p>\n}";
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("inline slashes");
    let tape = result.program();
    let children = rendered_children(tape);
    let text = children[0].as_object().expect("JSXText child");
    assert_eq!(scalar_field(tape, text, "value"), r#""a // note""#);
    assert_eq!(scalar_field(tape, text, "raw"), r#""a // note""#);

    let source = "function View() @{\n\t<p>a &#47;* note *&#47; b</p>\n}";
    let result = parse_tsrx(&TsrxParseRequest { source }).expect("escaped comment opener");
    let tape = result.program();
    let children = rendered_children(tape);
    let text = children[0].as_object().expect("JSXText child");
    assert_eq!(scalar_field(tape, text, "raw"), r#""a &#47;* note *&#47; b""#);
}

#[test]
fn native_template_text_keeps_a_non_breaking_space_next_to_a_line_break() {
    // tsrx-org/oxc#112: JSX whitespace is space, tab, CR, and LF, so U+00A0 is text even when a
    // line break is next to it.
    for (source, expected) in [
        ("function View() @{\n\t<p>\u{a0}\n\t\t<b /></p>\n}", "\"\u{a0}\\n\\t\\t\""),
        ("function View() @{\n\t<p><b />\n\t\t\u{a0}</p>\n}", "\"\\n\\t\\t\u{a0}\""),
    ] {
        // A non-ASCII source takes the UTF-16 route, as it does from the Node binding.
        let units: Vec<u16> = source.encode_utf16().collect();
        let result = parse_tsrx_utf16(&TsrxUtf16ParseRequest { source: &units })
            .unwrap_or_else(|error| panic!("{source:?}: {error:?}"));
        let tape = result.program();
        let texts: Vec<_> = rendered_children(tape)
            .into_iter()
            .filter_map(ValueRef::as_object)
            .filter(|child| scalar_field(tape, *child, "type") == r#""JSXText""#)
            .collect();
        assert_eq!(texts.len(), 1, "{source:?}");
        assert_eq!(scalar_field(tape, texts[0], "value"), expected, "{source:?}");
    }
}
