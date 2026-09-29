//! A file with shorthand attributes, `{name}` for `name={name}`, lints: on a dynamic tag
//! (tsrx-org/oxc#147) and in plain JSX (tsrx-org/oxc#148), each shorthand is a use of its name,
//! and a report on one lands on the authored name.

use std::path::Path;

use tsrx_lint::LintSession;

#[test]
fn a_shorthand_is_a_use_of_its_name_and_reports_on_it_map_to_the_authored_name() {
    let source = "export function Heading({ tag, id, used }) @{\n\
                  \t<{tag} {id} {missing} />\n\
                  }\n\
                  export function link({ href }) {\n\
                  \treturn <a {href} {/* c */ absent} {class} />;\n\
                  }\n\
                  const arrow = (target) => <a { target } />;\n\
                  export { arrow };\n";
    let output = LintSession::new_with_config_source(
        Path::new("/demo"),
        Some(r#"{ "rules": { "no-undef": "error", "no-unused-vars": "error" } }"#),
        &[],
        false,
    )
    .expect("an in-memory config compiles without reading the filesystem")
    .lint_text(Path::new("/demo/View.tsrx"), source)
    .expect("a file with shorthand attributes lints");
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
    // `id`, `href`, and `target` are used by their shorthands; `used` is not used anywhere. The
    // undefined names are reported at the names inside the braces. `{class}` names nothing.
    assert_eq!(
        reported,
        [
            ("eslint(no-undef)", "absent"),
            ("eslint(no-undef)", "missing"),
            ("eslint(no-unused-vars)", "used"),
        ]
    );
}
