//! JSX text `@tsrx/core` 0.5.2 reads where TSX would not: a `>` (tsrx-org/oxc#145), and a branch
//! keyword no control owns (tsrx-org/oxc#146). The scanner reads both as text, and every lane
//! hands OXC a projection it reads as the same text.

use tsrx_syntax::{
    PARSER_JSX_TEXT_GT_STAND_IN, StructuralKind, lift_formatted, project_for_format,
    project_for_lint, project_for_parser, project_for_types, scan, scan_for_parser,
};

#[test]
fn the_scanner_records_each_gt_in_jsx_text_and_nothing_else() {
    let source = "const a = 1 > 0;\nconst b = <T,>(x: T) => x;\nconst c = <p title=\"a > b\" data-x={1 > 0}>>a > b/* c > d */<i>></i>></p>;";
    let overlay = scan_for_parser(source).unwrap();
    // The first text `>`, the one in `a > b`, the one in `<i>`, and the one after `</i>`. The
    // operators, the type parameter list's end, the attribute's, and the comment's are not text.
    let gts = overlay.jsx_text_gts();
    assert_eq!(gts, [86, 89, 106, 111]);
    for gt in gts {
        assert_eq!(source.as_bytes()[*gt as usize], b'>');
    }
}

#[test]
fn every_lane_writes_a_stand_in_tsx_reads_as_text() {
    let source = "export function App() @{\n\t<p>a > b</p>\n}\n";
    let overlay = scan_for_parser(source).unwrap();
    assert_eq!(overlay.jsx_text_gts(), [31]);

    let parser = project_for_parser(source, &overlay).unwrap();
    assert!(parser.source().contains(&format!("<p>a {PARSER_JSX_TEXT_GT_STAND_IN} b</p>")));
    // The stand-in stands for the `>` exactly: its start maps to the `>`, and its end after it.
    let anchors = parser.anchors();
    let stand_in = anchors.iter().position(|anchor| anchor.original == 31).unwrap();
    assert_eq!(anchors[stand_in].projected.end - anchors[stand_in].projected.start, 1);
    assert_eq!(anchors[stand_in + 1].original, 32);
    assert!(anchors[stand_in + 1].projected.is_empty());

    for projected in [
        project_for_lint(source, &overlay).unwrap().source().to_owned(),
        project_for_types(source, &overlay).unwrap().source().to_owned(),
    ] {
        assert!(projected.contains(&format!("<p>a {PARSER_JSX_TEXT_GT_STAND_IN} b</p>")));
    }
}

#[test]
fn the_formatter_lane_writes_a_private_use_stand_in_the_source_never_holds_and_lifts_it_back() {
    // U+E000 is authored, so the stand-in is the next private-use character.
    let source = "export function App() @{\n\t<p>\u{e000} a > b >></p>\n}\n";
    let overlay = scan_for_parser(source).unwrap();
    let projection = project_for_format(source, &overlay).unwrap();
    assert!(projection.source().contains("<p>\u{e000} a \u{e001} b \u{e001}\u{e001}</p>"));
    assert_eq!(lift_formatted(projection.source(), source, &projection).unwrap(), source);

    // A stand-in the formatter lost or copied is never guessed back into the source.
    let lost = projection.source().replacen('\u{e001}', "", 1);
    assert!(lift_formatted(&lost, source, &projection).is_err());
}

#[test]
fn a_branch_keyword_no_control_owns_is_jsx_text_to_both_scanners() {
    for word in ["empty", "case", "default", "else", "catch", "pending"] {
        for source in [
            format!("export function App() @{{\n\t<code>@{word}</code>\n}}\n"),
            format!("const a = <p>me@{word}.com @{word} {{x}} @{word}: y</p>;"),
        ] {
            let parser =
                scan_for_parser(&source).unwrap_or_else(|error| panic!("{source}: {error}"));
            // The only structural token is a template's `@{`: no word in the text is a branch.
            assert!(
                parser.tokens().iter().all(|token| token.kind == StructuralKind::FunctionBody),
                "{source}"
            );
            scan(&source).unwrap_or_else(|error| panic!("{source}: {error}"));
            project_for_lint(&source, &parser).unwrap();
        }
    }
    // Where no JSX text holds it, an unowned branch is still malformed.
    assert!(scan_for_parser("function View() @{ @else {} }").is_err());
}
