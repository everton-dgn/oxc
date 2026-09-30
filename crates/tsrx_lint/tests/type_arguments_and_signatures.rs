//! A file with type arguments on a JSX element (tsrx-org/oxc#153) or a call signature's type
//! parameters (tsrx-org/oxc#152) lints, and a report lands on the authored name.

use std::path::Path;

use tsrx_lint::LintSession;

#[test]
fn type_arguments_and_signatures_lint_and_reports_map_to_authored_names() {
    let source = "interface Trigger {\n\
                  \t<P>(props: P): void;\n\
                  }\n\
                  type Props<P = unknown> = P;\n\
                  export type { Trigger, Props };\n\
                  export function App({ unused }) @{\n\
                  \t<main>\n\
                  \t\t<List<string> items={missing} />\n\
                  \t</main>\n\
                  }\n";
    let output = LintSession::new_with_config_source(
        Path::new("/demo"),
        Some(r#"{ "rules": { "no-undef": "error", "no-unused-vars": "error" } }"#),
        &[],
        false,
    )
    .expect("an in-memory config compiles without reading the filesystem")
    .lint_text(Path::new("/demo/View.tsrx"), source)
    .expect("a file with type arguments and signatures lints");
    let mut reported = output
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
    reported.sort_unstable();
    assert_eq!(
        reported,
        [
            ("eslint(no-undef)", "List"),
            ("eslint(no-undef)", "missing"),
            ("eslint(no-unused-vars)", "unused"),
        ]
    );
}
