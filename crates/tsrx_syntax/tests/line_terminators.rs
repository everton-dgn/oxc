use tsrx_syntax::{project_for_parser, scan_for_parser};

#[test]
fn line_terminators_separate_setup_from_markup_without_changing_authored_bytes() {
    for newline in ["\n", "\r", "\r\n", "\u{2028}", "\u{2029}"] {
        for setup in ["const a = 1", "a()", "const a = 1 // 🚀", "const a = 1 /* 🚀 */"] {
            for tag in ["<div/>", "<{Tag}/>"] {
                let source =
                    format!("function F() @{{{newline}{setup}{newline} \t{tag}{newline}}}");
                let overlay = scan_for_parser(&source).unwrap();
                let projection = project_for_parser(&source, &overlay).unwrap();
                assert!(projection.source().contains(";<"), "missing boundary: {source:?}");
                for segment in projection.view().segments {
                    let start = segment.original_start as usize;
                    let len = (segment.projected.end - segment.projected.start) as usize;
                    assert_eq!(
                        &projection.source()
                            [segment.projected.start as usize..segment.projected.end as usize],
                        &source[start..start + len]
                    );
                }
            }
        }
    }
}

#[test]
fn line_terminators_in_directive_trivia_end_line_comments() {
    for newline in ["\n", "\r", "\r\n", "\u{2028}", "\u{2029}"] {
        let source = format!("function F() @{{ @if // comment{newline} (ok) {{ <div/> }} }}");
        let overlay = scan_for_parser(&source).unwrap();
        project_for_parser(&source, &overlay).unwrap();
    }
}

#[test]
fn unicode_terminators_do_not_rewrite_literals_or_create_expression_boundaries() {
    for newline in ["\u{2028}", "\u{2029}"] {
        for expression in [
            format!("const a = 'x{newline}y';"),
            format!("const a = `x{newline}y`;"),
            format!("const a = 1{newline}< 2;"),
            format!("const a = ({newline}<div/>);"),
            format!("const a ={newline}<div/>;"),
            format!("const a = f<{newline}T>();"),
        ] {
            let overlay = scan_for_parser(&expression).unwrap();
            let projection = project_for_parser(&expression, &overlay).unwrap();
            assert_eq!(projection.source(), expression);
        }
    }
}

#[test]
fn controls_after_assignment_preserve_line_terminator_semantics() {
    let template = "function F() @{ const v =\n@if (c) { <a/> } @else { <b/> };\n<p/> }";
    let baseline_overlay = scan_for_parser(template).unwrap();
    let baseline = project_for_parser(template, &baseline_overlay).unwrap();
    for newline in ["\n", "\r\n", "\u{2028}", "\u{2029}"] {
        let source = template.replace('\n', newline);
        let overlay = scan_for_parser(&source).unwrap();
        let projection = project_for_parser(&source, &overlay).unwrap();
        assert_eq!(projection.source().replace(newline, "\n"), baseline.source(), "{source:?}");
    }
}

#[test]
fn controls_after_return_preserve_line_terminator_semantics() {
    let template = "function F() @{ return\n@if (c) { <a/> } @else { <b/> };\n<p/> }";
    let baseline_overlay = scan_for_parser(template).unwrap();
    let baseline = project_for_parser(template, &baseline_overlay).unwrap();
    for newline in ["\n", "\r\n", "\u{2028}", "\u{2029}"] {
        let source = template.replace('\n', newline);
        let overlay = scan_for_parser(&source).unwrap();
        let projection = project_for_parser(&source, &overlay).unwrap();
        assert_eq!(projection.source().replace(newline, "\n"), baseline.source(), "{source:?}");
    }
}

#[test]
fn controls_after_operators_preserve_line_terminator_semantics() {
    let template = "function F() @{ const v = true &&\n@if (c) { <a/> } @else { <b/> };\n<p/> }";
    let baseline_overlay = scan_for_parser(template).unwrap();
    let baseline = project_for_parser(template, &baseline_overlay).unwrap();
    for newline in ["\n", "\r\n", "\u{2028}", "\u{2029}"] {
        let source = template.replace('\n', newline);
        let overlay = scan_for_parser(&source).unwrap();
        let projection = project_for_parser(&source, &overlay).unwrap();
        assert_eq!(projection.source().replace(newline, "\n"), baseline.source(), "{source:?}");
    }
}

#[test]
fn controls_after_comment_preserve_line_terminator_semantics() {
    let template = "function F() @{ x =\n// note\n@if (c) { <a/> } @else { <b/> };\n<p/> }";
    let baseline_overlay = scan_for_parser(template).unwrap();
    let baseline = project_for_parser(template, &baseline_overlay).unwrap();
    for newline in ["\n", "\r\n", "\u{2028}", "\u{2029}"] {
        let source = template.replace('\n', newline);
        let overlay = scan_for_parser(&source).unwrap();
        let projection = project_for_parser(&source, &overlay).unwrap();
        assert_eq!(projection.source().replace(newline, "\n"), baseline.source(), "{source:?}");
    }
}

#[test]
fn statement_controls_preserve_line_terminator_semantics() {
    for template in
        ["function F() @{ const v = 1\n@if (c) { <a/> } }", "function F() @{\n@if (c) { <a/> } }"]
    {
        let baseline_overlay = scan_for_parser(template).unwrap();
        let baseline = project_for_parser(template, &baseline_overlay).unwrap();
        for newline in ["\n", "\r", "\r\n", "\u{2028}", "\u{2029}"] {
            let source = template.replace('\n', newline);
            let overlay = scan_for_parser(&source).unwrap();
            let projection = project_for_parser(&source, &overlay).unwrap();
            assert_eq!(projection.source().replace(newline, "\n"), baseline.source(), "{source:?}");
        }
    }
}
