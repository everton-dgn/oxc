//! A template body `@{` after a return type that ends in type arguments, like
//! `(): Element<'div'> @{`, opens the function's body, as `@tsrx/core` 0.5.2 reads it
//! (tsrx-org/oxc#150). Only a return type annotation leads there: a `>` anywhere else in an
//! expression leaves the `@{` after it an expression code block, as before.

use tsrx_syntax::{ParserCodeBlockKind, StructuralKind, scan_for_parser};

/// Each `@{` token, and whether the parser scanner read it as an expression code block rather
/// than a function body.
fn bodies(source: &str) -> Vec<(StructuralKind, bool)> {
    let overlay = scan_for_parser(source).expect("parser overlay");
    let view = overlay.view();
    view.tokens
        .iter()
        .enumerate()
        .map(|(index, token)| {
            let expression = view.parser_code_blocks.iter().any(|block| {
                block.token as usize == index && block.kind == ParserCodeBlockKind::Expression
            });
            (token.kind, expression)
        })
        .collect()
}

#[test]
fn a_template_body_after_type_arguments_is_the_function_body() {
    for source in [
        "function App(): Element<'div'> @{\n\t<div />\n}",
        "const App = function (): Element<'div'> @{\n\t<div />\n};",
        "class View {\n\trender(): Element<'div'> @{\n\t\t<div />\n\t}\n}",
        "const view = {\n\trender(): Element<'div'> @{\n\t\t<div />\n\t},\n};",
        "export function Foo({ a }: {\n\ta: string;\n}): TSRXElement<'div'> @{\n\t<div>{a}</div>\n}",
        "function App(): Promise<Array<Element<'div'>>> @{ <div /> }",
        "function App(): Foo<() => void> @{ <div /> }",
        "function App(): Foo<{ a: B; c: D<'x'> }> @{ <div /> }",
        "function App(): A | JSX.El<'x'> @{ <div /> }",
        "function App(): Foo<'>'> @{ <div /> }",
        "function App(): Foo<\"a\\\"<\"> @{ <div /> }",
        "function App<T>(): Element<T> /* c */ @{ <div /> }",
        "function App(): Element <'div'>\n// c\n@{ <div /> }",
        // A quote, `<`, or `>` in a comment inside the list is not read (Bugbot on
        // tsrx-org/oxc#162).
        "function App(): Foo<A /* > */> @{ <div /> }",
        "function App(): Foo<A /* ' */> @{ <div /> }",
        "function App(): Foo</* < */ A> @{ <div /> }",
        "function App(): Foo<A // > '\n> @{ <div /> }",
        // A multi-line list, a default type parameter, and mapped and conditional types.
        "function App(): Foo<\n\tA,\n\tB\n> @{ <div /> }",
        "function App<T = string>(): Element<T> @{ <div /> }",
        "function App(): Foo<{ +readonly [K in keyof T]+?: T[K] }> @{ <div /> }",
        "function App(): Foo<A extends B\n\t? C\n\t: D> @{ <div /> }",
        // Other return type shapes, method kinds, and parameter lists.
        "function App(x: number): x is Foo<X> @{ <div /> }",
        "function App(): () => Foo<X> @{ <div /> }",
        "function App<T>(this: Window, a?: T): Foo<T>[\"k\"] @{ <div /> }",
        "class V {\n\t[k](): Foo<X> @{ <div /> }\n}",
        "class V {\n\tget x(): Foo<X> @{ <div /> }\n}",
        "const o = { async *gen(): Foo<X> @{ <div /> } };",
        "class V {\n\t#r(): Foo<X> @{ <div /> }\n}",
        // Optional, quoted, and numeric method names, comments before the parameter list, and
        // import types (Bugbot on tsrx-org/oxc#162).
        "class V {\n\trender?(): Foo<X> @{ <div /> }\n}",
        "const o = {\n\t'render'(): Foo<X> @{ <div /> }\n};",
        "const o = {\n\t\"a-b\"(): Foo<X> @{ <div /> }\n};",
        "const o = {\n\t0(): Foo<X> @{ <div /> }\n};",
        "function App /* c */ (): Foo<X> @{ <div /> }",
        "function App // c\n(): Foo<X> @{ <div /> }",
        "function App(): import(\"./m\").Foo<X> @{ <div /> }",
        "function App(): typeof import(\"./m\")<X> @{ <div /> }",
    ] {
        assert_eq!(bodies(source), [(StructuralKind::FunctionBody, false)], "{source}");
    }
}

#[test]
fn a_template_body_after_a_comparison_stays_an_expression_block() {
    for source in [
        "const x = a > @{ <div /> };",
        "const x = (a < b) > @{ <div /> };",
        "if (a < b) { x = c > @{ <div /> }; }",
        "a < b; c > @{ <div /> };",
        "y = c ? f(a) : b > @{ <div /> };",
        "x <<= y > @{ <div /> };",
        // Each of these made an earlier `<` and `>` pairing read the `@{` as a function body
        // (Bugbot on tsrx-org/oxc#162). None follows a return type annotation.
        "const x = a < b << c > @{ <div /> };",
        "const x = a < (b) < c > @{ <div /> };",
        "a < b\nc > @{ <div /> };",
        "let y = a < b\nconst x = c > @{ <div /> };",
        "a < b\n'c' > @{ <div /> };",
        "a < b\n1 > @{ <div /> };",
        "x = (a <<= b, c > @{ <div /> });",
        "x = a <<= b\nc > @{ <div /> };",
        "y = a < b + c > @{ <div /> };",
        "y = [a < b, c = d > @{ <div /> }];",
        "y = a < b && c > @{ <div /> };",
        "y = a < b ?? c > @{ <div /> };",
        "y = a < b / c > @{ <div /> };",
        "y = a < b++ > @{ <div /> };",
        "y = a < b! * c > @{ <div /> };",
    ] {
        assert_eq!(bodies(source), [(StructuralKind::FunctionBody, true)], "{source}");
    }
}
