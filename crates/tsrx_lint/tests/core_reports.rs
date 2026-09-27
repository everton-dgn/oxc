//! `@tsrx/core` reports some authored TSRX without failing the parse, and its editor tooling shows
//! those reports as errors. The lint lane, which is what the CLI and the editor read, must show
//! them too, at core's spans, with core's messages and codes, and still lint the rest of the file.

use std::path::Path;

use tsrx_lint::{DiagnosticOutput, LintSession};

const DYNAMIC_TAG_MESSAGE: &str = "A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";

fn lint(source: &str) -> Vec<DiagnosticOutput> {
    LintSession::new_with_config_source(
        Path::new("/demo"),
        Some(r#"{ "rules": { "no-var": "error" } }"#),
        &[],
        false,
    )
    .expect("an in-memory config compiles without reading the filesystem")
    .lint_text(Path::new("/demo/View.tsrx"), source)
    .expect("a file core only reports on still lints")
    .diagnostics
}

/// Each diagnostic as `(code, authored text under its one label)`.
fn reported<'s>(source: &'s str, diagnostics: &[&DiagnosticOutput]) -> Vec<(String, &'s str)> {
    diagnostics
        .iter()
        .map(|diagnostic| {
            let [label] = &diagnostic.labels[..] else {
                panic!("one label: {diagnostic:?}");
            };
            let start = label.span.offset as usize;
            let end = start + label.span.length as usize;
            (diagnostic.code.clone(), &source[start..end])
        })
        .collect()
}

#[test]
fn a_disallowed_dynamic_tag_expression_is_an_error_at_cores_span() {
    let source = "export function View(props) @{\n\
                  \tvar count = 0;\n\
                  \t<{getTag()} />\n\
                  \t<{props.open ? A : B}>{count}</{props.open ? A : B}>\n\
                  \t<{(props.as)} />\n\
                  \t<{props.open ? <A /> : B} />\n\
                  \t<{props.as} />\n\
                  \t<{registry[name]} />\n\
                  \t<{'section'} />\n\
                  }\n";
    let diagnostics = lint(source);
    let dynamic =
        diagnostics.iter().filter(|diagnostic| diagnostic.code == "TSRX2014").collect::<Vec<_>>();
    // Core reports each opening tag once, at the part that isn't an allowed form, parentheses
    // included; the allowed forms report nothing.
    assert_eq!(
        reported(source, &dynamic),
        [
            ("TSRX2014".to_string(), "getTag()"),
            ("TSRX2014".to_string(), "props.open ? A : B"),
            ("TSRX2014".to_string(), "(props.as)"),
            ("TSRX2014".to_string(), "props.open ? <A /> : B"),
        ]
    );
    for diagnostic in &dynamic {
        assert_eq!(diagnostic.rule, "TSRX2014");
        assert_eq!(diagnostic.severity, "error");
        assert_eq!(diagnostic.message, DYNAMIC_TAG_MESSAGE);
    }
    // The rest of the file still lints.
    assert!(diagnostics.iter().any(|diagnostic| diagnostic.rule == "no-var"), "{diagnostics:?}");
}

#[test]
fn a_script_end_tag_inside_a_script_body_is_an_error_at_cores_span() {
    let source = "export function View() @{\n\
                  \tvar count = 0;\n\
                  \t<head><script>a = 1;</SCRIPT>b = '</script/>';</Script >{count}</script></head>\n\
                  }\n";
    let diagnostics = lint(source);
    let script =
        diagnostics.iter().filter(|diagnostic| diagnostic.code == "TSRX1004").collect::<Vec<_>>();
    assert_eq!(
        reported(source, &script),
        [
            ("TSRX1004".to_string(), "</SCRIPT"),
            ("TSRX1004".to_string(), "</script"),
            ("TSRX1004".to_string(), "</Script"),
        ]
    );
    assert_eq!(
        script[0].message,
        "'</SCRIPT' can end a script in HTML, so a '<script>' body can't contain it. Write '<\\/SCRIPT' instead."
    );
    for diagnostic in &script {
        assert_eq!(diagnostic.rule, "TSRX1004");
        assert_eq!(diagnostic.severity, "error");
    }
    assert!(diagnostics.iter().any(|diagnostic| diagnostic.rule == "no-var"), "{diagnostics:?}");
}

#[test]
fn a_clean_file_reports_neither() {
    let source = "export function View(props) @{\n\
                  \t<{props.as}><script>const end = '<\\/script>';</script></{props.as}>\n\
                  }\n";
    assert!(lint(source).is_empty());
}

#[test]
fn a_comment_in_jsx_text_is_a_comment_to_the_lint_rules() {
    // `@tsrx/core` 0.5 reads JavaScript comments in JSX text as comments, so what a comment holds
    // is not code: `a` and `b` below are unused, and `c` after the comment is used.
    let source = "export function View() @{\n\
                  \tconst a = 1;\n\
                  \tconst b = 2;\n\
                  \tconst c = 3;\n\
                  \t<div>\n\
                  \t\t/* {a} */\n\
                  \t\t// {b}\n\
                  \t\t{c}\n\
                  \t</div>\n\
                  }\n";
    let diagnostics = LintSession::new_with_config_source(
        Path::new("/demo"),
        Some(r#"{ "rules": { "no-unused-vars": "error" } }"#),
        &[],
        false,
    )
    .expect("an in-memory config compiles without reading the filesystem")
    .lint_text(Path::new("/demo/View.tsrx"), source)
    .expect("the file lints")
    .diagnostics;
    let unused = diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "eslint(no-unused-vars)")
        .collect::<Vec<_>>();
    assert_eq!(
        reported(source, &unused),
        [("eslint(no-unused-vars)".to_owned(), "a"), ("eslint(no-unused-vars)".to_owned(), "b")]
    );
}

#[test]
fn nested_tsrx_in_a_dynamic_tag_expression_is_reported_not_a_lint_failure() {
    // Issue #123: core keeps these files and reports the whole tag expression. The lint lane must
    // too, and still lint the rest of the file. `paired` also checks `<{e}>x</{e}>`; a closing
    // expression holding a plain closing tag like `</B>` fails to scan in the parser lane too.
    for (expression, paired) in [
        ("c ? B : <{T} />", true),
        ("c || <{T}>x</{T}>", true),
        ("<{T} /> || c", true),
        // Core also reports the nested `a()`; the lint lane reports the outer expression only.
        ("() => <{a()}/>", true),
        ("@if(ok){Tag}@else{Fallback}", true),
        ("@for(item of items){item.Tag}@empty{Fallback}", true),
        ("@switch(kind){@case 0:{A}@default:{B}}", true),
        ("@try{A}@pending{B}@catch{C}", true),
        ("ok ? @if(foo){A}@else{B} : Fallback", true),
        ("ok ? A : <B>@if(x){<i />}</B>", false),
        ("ok ? A : <B>@{ var x = 1; <i /> }</B>", false),
        ("ok ? A : <script>x</script>", false),
    ] {
        let mut elements = vec![format!("<{{ {expression} }} />")];
        if paired {
            elements.push(format!("<{{{expression}}}>x</{{{expression}}}>"));
        }
        for element in elements {
            let source =
                format!("export function View(props) @{{\n\tvar count = 0;\n\t{element}\n}}\n");
            let diagnostics = lint(&source);
            let dynamic = diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "TSRX2014")
                .collect::<Vec<_>>();
            assert_eq!(
                reported(&source, &dynamic),
                [("TSRX2014".to_string(), expression)],
                "{source}"
            );
            assert!(
                diagnostics.iter().any(|diagnostic| diagnostic.rule == "no-var"),
                "{source}: {diagnostics:?}"
            );
        }
    }
}
