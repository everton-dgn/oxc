//! Shorthand attributes, `{name}` for `name={name}`, in every JSX (tsrx-org/oxc#148) and on a
//! dynamic tag (tsrx-org/oxc#147), as `@tsrx/core` 0.5.2 reads them.

use tsrx_syntax::{
    ProjectionError, lift_formatted, project_for_format, project_for_lint, project_for_parser,
    project_for_types, scan_for_parser, shorthand_name_is_reserved,
};

/// Each shorthand attribute as the authored text of its braces and of its name.
fn shorthands(source: &str) -> Vec<(&str, &str)> {
    scan_for_parser(source)
        .unwrap()
        .view()
        .parser_shorthand_attributes
        .iter()
        .map(|attribute| {
            (
                &source[attribute.span.start as usize..attribute.span.end as usize],
                &source[attribute.identifier.start as usize..attribute.identifier.end as usize],
            )
        })
        .collect()
}

#[test]
fn the_scanner_reads_a_shorthand_with_trivia_escapes_and_any_identifier_name() {
    assert_eq!(
        shorthands(
            "const v = <a x { a } y=\"1\" {...r} {/* c */ b} {this} {c // d\n} {\\u0061}{class} {a\\u0301} />;"
        ),
        [
            ("{ a }", "a"),
            ("{/* c */ b}", "b"),
            ("{this}", "this"),
            ("{c // d\n}", "c"),
            ("{\\u0061}", "\\u0061"),
            ("{class}", "class"),
            // An escaped combining mark continues a name (Bugbot on tsrx-org/oxc#158).
            ("{a\\u0301}", "a\\u0301"),
        ]
    );
    // Plain JSX outside any template, a dynamic tag, and an element glued to its shorthand.
    assert_eq!(shorthands("function f(id) { return <{tag} {id} />; }"), [("{id}", "id")]);
    assert_eq!(shorthands("const v = <a{b}/>;"), [("{b}", "b")]);
    // An attribute value is an expression, never a shorthand.
    assert_eq!(shorthands("const v = <a b={c} d={ e } />;"), []);
}

#[test]
fn a_malformed_shorthand_fails_where_core_reports_it() {
    for (source, offset, expected) in [
        ("const v = <a {a.b} />;", 15, "`}` after a shorthand attribute's name"),
        ("const v = <a {a />;", 16, "`}` after a shorthand attribute's name"),
        ("const v = <a {a as any} />;", 16, "`}` after a shorthand attribute's name"),
        ("const v = <a {} />;", 14, "a shorthand attribute's name or a spread `...`"),
        ("const v = <a {\"s\"} />;", 14, "a shorthand attribute's name or a spread `...`"),
        ("const v = <a {enum} />;", 14, "a shorthand attribute's name or a spread `...`"),
        ("const v = <a {type} />;", 14, "a shorthand attribute's name or a spread `...`"),
        // Bugbot on tsrx-org/oxc#158: escapes are decoded before a name is refused, and a bad
        // escape fails where `@tsrx/core` fails it.
        ("const v = <a {t\\u0079pe} />;", 14, "a shorthand attribute's name or a spread `...`"),
        ("const v = <a {\\u0031a} />;", 14, "a Unicode escape that spells an identifier character"),
        ("const v = <a {\\x61} />;", 15, "`u` after `\\` in an identifier name"),
        ("const v = <a {ab\\u00} />;", 18, "hexadecimal digits in a Unicode escape"),
        ("const v = <a {\\u{zz}} />;", 17, "hexadecimal digits in a Unicode escape"),
        ("const v = <a {ab\\u{110000}} />;", 19, "a Unicode escape no greater than 0x10FFFF"),
        (
            "const v = <a {a\\u{1F600}} />;",
            15,
            "a Unicode escape that spells an identifier character",
        ),
    ] {
        assert_eq!(
            scan_for_parser(source).unwrap_err(),
            ProjectionError::MalformedSyntax { offset, expected },
            "{source}"
        );
    }
}

#[test]
fn every_lane_writes_a_shorthand_tsx_reads_and_a_reserved_name_as_a_stand_in() {
    let source = "export function View({ tag, href }) @{\n\t<{tag}{href} {class} />\n}\n";
    let overlay = scan_for_parser(source).unwrap();
    assert!(shorthand_name_is_reserved(b"class") && !shorthand_name_is_reserved(b"href"));

    let parser = project_for_parser(source, &overlay).unwrap();
    // The scaffold name never joins the tag's name, and `{class}` holds a stand-in.
    assert!(parser.source().contains(" _t0_S0_={href} _t0_S1_={undefined}"), "{}", parser.source());

    let lint = project_for_lint(source, &overlay).unwrap();
    assert!(lint.source().contains(" _t0_V0_={href} _t0_V1_={undefined}"), "{}", lint.source());

    let types = project_for_types(source, &overlay).unwrap();
    assert!(types.source().contains(" href={href} class={undefined}"), "{}", types.source());

    // The formatter lane writes a marker for the reserved word, which the lift turns back.
    let format = project_for_format(source, &overlay).unwrap();
    assert!(format.source().contains("_t0_V1_={_t0_U1_}"), "{}", format.source());
    assert_eq!(
        lift_formatted(format.source(), source, &format).unwrap(),
        "export function View({ tag, href }) @{\n\t<{tag} {href} {class} />\n}\n"
    );
}
