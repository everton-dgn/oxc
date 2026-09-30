#[expect(
    dead_code,
    reason = "the shared test-support module is compiled into every integration binary and each one uses a different part of it"
)]
mod support;

use support::assert_failed;
use tsrx_parser_engine::{TsrxParseRequest, parse_tsrx};

#[test]
fn unsupported_tsrx_syntax_returns_no_partial_program() {
    for source in [
        "function View() @{ @switch(x) { @default: { return x } } }",
        "function View() @{ @try { return 1 } @catch {} }",
        "function View() @{ const value = ; <main /> }",
        "function View() @{ <main />; const after = 1; }",
    ] {
        assert_failed(source);
    }
    assert!(
        parse_tsrx(&TsrxParseRequest { source: "function Viéw() @{ <main /> }" }).is_err(),
        "the retained ASCII guard must remain operational"
    );
}

#[test]
fn an_expression_control_takes_no_subscript() {
    // tsrx-org/oxc#149: `@tsrx/core` 0.5.2 reads no member access, call, tagged template, or
    // non-null `!` after a control-flow expression, where OXC would read one as a subscript of
    // the control's wrapper.
    for control in ["@if(ok){one}", "@for(const x of xs){one}", "@try{one}@catch{two}"] {
        for tail in [".length", "()", "[0]", "?.x", "`t`", "!", "\n.length", "\n(1)"] {
            assert_failed(&format!("const value={control}{tail};"));
        }
        for tail in [" != 1", "\n!one", " ? .5 : 1", "\n;(1)", ""] {
            assert_complete(&format!("const value={control}{tail};"));
        }
    }
    assert_complete("const value=(@if(ok){one}).length;");
}

fn assert_complete(source: &str) {
    let result = parse_tsrx(&TsrxParseRequest { source }).unwrap_or_else(|error| {
        panic!("{source}: {error}");
    });
    assert_eq!(result.status, tsrx_tape_schema::ParseCompleteness::Complete, "{source}");
}

#[test]
fn affine_authored_comments_are_byte_validated_and_accepted() {
    for source in [
        "/* module */ function View() @{ /* render */ <main /> }",
        "function View() @{ @if(ok){/* yes */<b/>}@else{/* no */<i/>} }",
        "function View() @{ // render\n <main /> }",
    ] {
        assert!(
            parse_tsrx(&TsrxParseRequest { source }).is_ok(),
            "authored comment should survive the affine parser lane: {source}"
        );
    }
}
