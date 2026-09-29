//! A file `@tsrx/core` 0.5.2 parses has to lint: a `>` in JSX text (tsrx-org/oxc#145) and a
//! branch keyword no control owns, such as `<code>@else</code>` (tsrx-org/oxc#146), are text.

use std::path::Path;

use tsrx_lint::LintSession;

#[test]
fn a_gt_and_an_unowned_branch_keyword_in_jsx_text_lint_and_map_reports_around_them() {
    let source = "export function View(props) @{\n\
                  \t<div>\n\
                  \t\t<p>a > b >> c</p>\n\
                  \t\t<code>@else</code> <code>@empty</code> me@catch.com @pending\n\
                  \t\t@if (props.open) {\n\
                  \t\t\t<p>{props.a} > {props.b}</p>\n\
                  \t\t} @else {\n\
                  \t\t\t<p>></p>\n\
                  \t\t}\n\
                  \t</div>\n\
                  }\n\
                  export function Plain() {\n\
                  \tvar count = 0;\n\
                  \treturn <p>{count} > 0 @default</p>;\n\
                  }\n";
    let output = LintSession::new_with_config_source(
        Path::new("/demo"),
        Some(r#"{ "rules": { "no-var": "error" } }"#),
        &[],
        false,
    )
    .expect("an in-memory config compiles without reading the filesystem")
    .lint_text(Path::new("/demo/View.tsrx"), source)
    .expect("a file core parses lints");
    let reported = output
        .diagnostics
        .iter()
        .map(|diagnostic| {
            let [label] = &diagnostic.labels[..] else {
                panic!("one label: {diagnostic:?}");
            };
            let start = label.span.offset as usize;
            (diagnostic.code.as_str(), &source[start..start + label.span.length as usize])
        })
        .collect::<Vec<_>>();
    assert_eq!(reported, [("eslint(no-var)", "var")]);
    let var = source.find("var").unwrap();
    assert_eq!(output.diagnostics[0].labels[0].span.offset as usize, var);
}
