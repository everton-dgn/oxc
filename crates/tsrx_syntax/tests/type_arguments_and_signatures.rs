//! Type arguments on a JSX element, `<List<string> />` (tsrx-org/oxc#153), and the type
//! parameters of a call signature, construct signature, or function type, `<P>(props: P): void`
//! (tsrx-org/oxc#152), as `@tsrx/core` 0.5.2 reads them.

use tsrx_syntax::{
    lift_formatted, project_for_format, project_for_lint, project_for_parser, project_for_types,
    scan, scan_for_parser,
};

const TYPE_ARGUMENTS: [&str; 9] = [
    "const view = <main><List<string> /></main>;",
    "const view = <List<string>>a</List>;",
    "const view = <List<string> items={items} />;",
    "const view = <List<Map<string, Array<number>>>>x</List>;",
    "const view = <main><List<() => void> /><UI.List<'a' | \"b\"> /></main>;",
    "export function App() @{\n\t<main>\n\t\t<List<string> items={items} />\n\t</main>\n}\n",
    "export function App() @{\n\t<List<string>>{item}</List>\n}\n",
    // Bugbot on tsrx-org/oxc#160: a `>` in a template literal type is text.
    "const view = <main><List<`a>b`> /></main>;",
    "const view = <List<`x${Array<string>}>`>>a</List>;",
];

const SIGNATURES: [&str; 7] = [
    "interface Trigger {\n\t<P>(props: P): void;\n}\n\ntype Props<P = unknown> = P;\n",
    "interface Trigger {\n\t<P>(props: P): void;\n}\n",
    "type Render = <P>(props: P) => void;\n",
    "interface Trigger {\n\tnew <P>(props: P): Trigger;\n}\n",
    "let render: <A, B>(a: { b: [A, B] }, c?: () => void) => void;\n",
    "interface T {\n\t<P>(props: P): void;\n}\nexport function App() @{\n\t<div>{'x'}</div>\n}\n",
    "interface T {\n\t<P>(p: `a)${P}`): void;\n}\n",
];

#[test]
fn both_scanners_read_type_arguments_after_a_tag_name() {
    for source in TYPE_ARGUMENTS {
        scan(source).unwrap_or_else(|error| panic!("{source:?}: {error:?}"));
        scan_for_parser(source).unwrap_or_else(|error| panic!("{source:?}: {error:?}"));
    }
}

#[test]
fn both_scanners_hand_a_signature_s_type_parameters_to_oxc() {
    for source in SIGNATURES {
        scan(source).unwrap_or_else(|error| panic!("{source:?}: {error:?}"));
        scan_for_parser(source).unwrap_or_else(|error| panic!("{source:?}: {error:?}"));
    }
}

#[test]
fn markup_that_only_looks_like_a_signature_is_still_markup() {
    // A closed element wins over the signature reading, so the `(note):` text stays text.
    let source = "export function A() @{\n\t<b>(note): y</b>\n}\n";
    let overlay = scan_for_parser(source).unwrap();
    let parser = project_for_parser(source, &overlay).unwrap();
    assert!(parser.source().contains("<b>(note): y</b>"), "{}", parser.source());
}

#[test]
fn every_lane_keeps_type_arguments_and_signatures_as_written() {
    for source in TYPE_ARGUMENTS.into_iter().chain(SIGNATURES) {
        let overlay = scan_for_parser(source).unwrap();
        let parser = project_for_parser(source, &overlay).unwrap();
        let lint = project_for_lint(source, &overlay).unwrap();
        let types = project_for_types(source, &overlay).unwrap();
        for (lane, projected) in
            [("parser", parser.source()), ("lint", lint.source()), ("types", types.source())]
        {
            for written in ["<List<", "<P>(props: P)", "<A, B>("] {
                if source.contains(written) {
                    assert!(projected.contains(written), "{lane} lane of {source:?}: {projected}");
                }
            }
        }
        let format = project_for_format(source, &overlay).unwrap();
        assert_eq!(lift_formatted(format.source(), source, &format).unwrap(), source);
    }
}
