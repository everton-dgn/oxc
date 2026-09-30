import assert from "node:assert/strict";
import test from "node:test";

import { parseModule } from "../../packages/tsrx-core-compat/dist/index.js";

// Regression tests for tsrx-org/oxc#142: the errors `parseModule` throws and records, in the shape
// and with the code, message, and position `@tsrx/core` 0.5.2 gives them. Every expected value
// below is what @tsrx/core 0.5.2 returns for the same source.

function thrown(source, options) {
  try {
    parseModule(source, "App.tsrx", options);
  } catch (error) {
    return error;
  }
  assert.fail(`expected ${JSON.stringify(source)} to throw`);
}

// Acorn's `SyntaxError`: the `(line:column)` of `pos` after the message, `loc` at `pos`, and
// `raisedAt`, with no `end`, `type`, or `fileName`.
function assertAcornError(error, expected, label) {
  assert.equal(error.constructor, SyntaxError, label);
  assert.deepEqual(
    {
      code: error.code,
      message: error.message,
      pos: error.pos,
      raisedAt: error.raisedAt,
      loc: error.loc,
    },
    expected,
    label,
  );
  for (const key of ["end", "type", "fileName"]) {
    assert.equal(Object.hasOwn(error, key), false, `${label}: ${key}`);
  }
}

test("#142: a thrown SyntaxError has acorn's (line:column) suffix and { line, column } loc", () => {
  const cases = [
    [
      "export function App() @{\n\t<p />\n\t@if\n}",
      { code: "TS1359", message: "Unexpected keyword 'if' (3:2)", pos: 34, raisedAt: 38, loc: { line: 3, column: 2 } },
    ],
    [
      "export function App({ value }) @{\n\t@switch (value) { @case 'x': { <span>x</span> } @ }\n}",
      { code: "TS1012", message: "Unexpected token (2:49)", pos: 83, raisedAt: 84, loc: { line: 2, column: 49 } },
    ],
    [
      "export function App() @{\n\t<div>\n}",
      {
        code: "TSRX1001",
        message: "Unclosed tag '<div>'. Expected '</div>' before end of template. (3:0)",
        pos: 32,
        raisedAt: 33,
        loc: { line: 3, column: 0 },
      },
    ],
    [
      "const = 1;",
      { code: "TS1012", message: "Unexpected token (1:6)", pos: 6, raisedAt: 7, loc: { line: 1, column: 6 } },
    ],
    // Acorn's line breaks: a CRLF is one.
    [
      "const a = 1;\r\nconst = 2;",
      { code: "TS1012", message: "Unexpected token (2:6)", pos: 20, raisedAt: 21, loc: { line: 2, column: 6 } },
    ],
  ];
  for (const [source, expected] of cases) assertAcornError(thrown(source), expected, source);
});

test("#142: every malformed directive throws core's code and message at core's position", () => {
  // [body, code, message, pos, raisedAt]
  const cases = [
    ["@if", "TS1359", "Unexpected keyword 'if' (2:2)", 42, 46],
    ["@if x {}", "TS1359", "Unexpected keyword 'if' (2:2)", 42, 46],
    ["@if () {}", "TS1012", "Unexpected token (2:6)", 46, 47],
    ["@if (a) x", "TSRX1008", "Expected `{` after JSX control-flow directive. (2:9)", 49, 50],
    ["@if (a) {} @else", "TSRX1008", "Expected `{` after JSX control-flow directive. (3:0)", 58, 59],
    ["@if (a) {} @else x", "TSRX1008", "Expected `{` after JSX control-flow directive. (2:18)", 58, 59],
    ["@if (a) {} @else if x {}", "TS1012", "Unexpected token (2:21)", 61, 62],
    ["@if (a) {} else {}", "TSRX1009", "Expected `@else` after `@if` block. (2:12)", 52, 56],
    ["@if (a) {} @elsx {}", "TS1206", "Leading decorators must be attached to a class declaration. (2:18)", 58, 59],
    ["@x", "TS1206", "Leading decorators must be attached to a class declaration. (3:0)", 44, 45],
    ["@x()", "TS1206", "Leading decorators must be attached to a class declaration. (3:0)", 46, 47],
    ["@x.y", "TS1206", "Leading decorators must be attached to a class declaration. (3:0)", 46, 47],
    ["@x @y", "TS1206", "Leading decorators must be attached to a class declaration. (3:0)", 47, 48],
    ["@for", "TS1359", "Unexpected keyword 'for' (2:2)", 42, 47],
    ["@for x {}", "TS1359", "Unexpected keyword 'for' (2:2)", 42, 47],
    ["@for (const i of items) {} @empty", "TSRX1008", "Expected `{` after JSX control-flow directive. (3:0)", 75, 76],
    ["@for (const i of items) {} empty {}", "TSRX1009", "Expected `@empty` after `@for` block. (2:28)", 68, 73],
    ["@for (const i of items; index) {}", "TS1012", "Unexpected token (2:30)", 70, 71],
    ["@switch", "TS1359", "Unexpected keyword 'switch' (2:2)", 42, 50],
    ["@switch x {}", "TS1359", "Unexpected keyword 'switch' (2:2)", 42, 50],
    ["@switch () {}", "TS1012", "Unexpected token (2:10)", 50, 51],
    ["@switch (v) { @ }", "TS1012", "Unexpected token (2:15)", 55, 56],
    ["@switch (v) { x }", "TS1012", "Unexpected token (2:15)", 55, 56],
    ["@switch (v) { @case }", "TS1012", "Unexpected token (2:21)", 61, 62],
    ["@switch (v) { @case 1 }", "TS1012", "Unexpected token (2:23)", 63, 64],
    ["@switch (v) { @case 1: {} @ }", "TS1012", "Unexpected token (2:27)", 67, 68],
    ["@try", "TS1359", "Unexpected keyword 'try' (2:2)", 42, 47],
    ["@try x", "TS1359", "Unexpected keyword 'try' (2:2)", 42, 47],
    ["@try {} @catch", "TS1012", "Unexpected token (3:0)", 56, 57],
    ["@try {} @catch (e)", "TS1012", "Unexpected token (3:0)", 60, 61],
    ["@try {} @catch (e) x", "TS1012", "Unexpected token (2:20)", 60, 61],
    ["@try {} @pending", "TS1012", "Unexpected token (3:0)", 58, 59],
    ["@try {} pending {}", "TSRX1009", "Expected `@pending` after `@try` block. (2:9)", 49, 56],
    ["@try {} catch {}", "TSRX1009", "Expected `@catch` after `@try` block. (2:9)", 49, 54],
    ["@while (a) {}", "TS1359", "Unexpected keyword 'while' (2:2)", 42, 49],
    ["@do {}", "TS1359", "Unexpected keyword 'do' (2:2)", 42, 46],
    ["@default", "TS1359", "Unexpected keyword 'default' (2:2)", 42, 51],
    ["@case 1:", "TS1359", "Unexpected keyword 'case' (2:2)", 42, 48],
    ["const if = 1; <p />", "TS1359", "Unexpected keyword 'if' (2:7)", 47, 51],
  ];
  for (const [body, code, message, pos, raisedAt] of cases) {
    const source = `export function App({ v, a, items }) @{\n\t${body}\n}`;
    const error = thrown(source);
    const [, line, column] = /\((\d+):(\d+)\)$/u.exec(message);
    assertAcornError(
      error,
      { code, message, pos, raisedAt, loc: { line: Number(line), column: Number(column) } },
      body,
    );
  }
});

test("#142: a missing `@catch` or `@pending` is reported at the `@try` keyword", () => {
  const error = thrown("export function App({ v, a, items }) @{\n\t@try {} @x {}\n}");
  assert.equal(error.constructor, SyntaxError);
  // Core's `raisedAt` is 50, past the next `@`.
  assert.deepEqual([error.code, error.message, error.pos, error.loc], [
    "TSRX1010",
    "Missing `@catch` or `@pending` after `@try` block. (2:2)",
    42,
    { line: 2, column: 2 },
  ]);
});

test("#142: a shorthand attribute with no `}` is TS1005, and a decorator in a class is not TS1206", () => {
  const shorthand = thrown("export function App({ v, a, items }) @{\n\t<div {a.b} />\n}");
  assert.deepEqual(
    [shorthand.constructor, shorthand.code, shorthand.message, shorthand.pos],
    [SyntaxError, "TS1005", "'}' expected. (2:8)", 48],
  );
  // Core reports these as TS1146; they are no leading decorator, whatever the class's heritage.
  for (const source of [
    "class A { @dec }",
    "class A extends B<{ x: 1 }> { @dec }",
    "class A implements I<{ x: 1 }> { @dec }",
  ]) {
    assert.notEqual(thrown(source).code, "TS1206", source);
  }
  // A method body is no class body.
  const method = thrown("class A { m() { @x } }");
  assert.deepEqual(
    [method.code, method.message, method.pos],
    ["TS1206", "Leading decorators must be attached to a class declaration. (1:19)", 19],
  );
});

test("#142: a comment between the mistake and the token core stops at changes nothing", () => {
  // [body, code, message, pos]
  const cases = [
    ["@if /* c */", "TS1359", "Unexpected keyword 'if' (2:2)", 42],
    ["@if // c", "TS1359", "Unexpected keyword 'if' (2:2)", 42],
    ["@x /* c */", "TS1206", "Leading decorators must be attached to a class declaration. (3:0)", 52],
    ["@x // c", "TS1206", "Leading decorators must be attached to a class declaration. (3:0)", 49],
    ["@if (a) /* c */ x", "TSRX1008", "Expected `{` after JSX control-flow directive. (2:17)", 57],
  ];
  for (const [body, code, message, pos] of cases) {
    const error = thrown(`export function App({ v, a, items }) @{\n\t${body}\n}`);
    assert.deepEqual([error.code, error.message, error.pos], [code, message, pos], body);
  }
});

test("#142: an element its template ends is unclosed at the `}` that ends the template", () => {
  // [body, tag, pos, (line:column)]
  const cases = [
    ["<div>", "div", 47, "(3:0)"],
    ["<>", "", 44, "(3:0)"],
    ["<div>{a}", "div", 50, "(3:0)"],
    ["<div a='}'>", "div", 53, "(3:0)"],
    ["@if (a) { <div> }", "div", 57, "(2:17)"],
    ["@if (a) { <b> <i> }", "i", 59, "(2:19)"],
    // A `}` in a template literal nested in an attribute's substitution ends nothing.
    ["<div a={`${`}`}`}>", "div", 60, "(3:0)"],
    ["<div a={`${ { b: `}` } }`}>", "div", 69, "(3:0)"],
  ];
  for (const [body, tag, pos, suffix] of cases) {
    const error = thrown(`export function App({ v, a, items }) @{\n\t${body}\n}`);
    assert.equal(error.constructor, SyntaxError, body);
    assert.deepEqual(
      [error.code, error.message, error.pos, error.raisedAt],
      [
        "TSRX1001",
        `Unclosed tag '<${tag}>'. Expected '</${tag}>' before end of template. ${suffix}`,
        pos,
        pos + 1,
      ],
      body,
    );
  }
});

test("#142: a parse that fails while collecting throws acorn's SyntaxError too", () => {
  for (const mode of ["collect", "loose"]) {
    const error = thrown("export function App() @{\n\t<p />\n\t@if\n}", { [mode]: true, errors: [] });
    assertAcornError(
      error,
      { code: "TS1359", message: "Unexpected keyword 'if' (3:2)", pos: 34, raisedAt: 38, loc: { line: 3, column: 2 } },
      mode,
    );
  }
});

test("#142: what core reports itself throws as a plain Error with a loc over the span", () => {
  const cases = [
    [
      "export function App() @{ <div/> <img/> }",
      {
        message: "A code block renders a single node; wrap multiple nodes or text in a fragment '<>…</>'.",
        code: "TSRX2011",
        pos: 32,
        raisedAt: 38,
        end: 38,
        loc: { start: { line: 1, column: 32 }, end: { line: 1, column: 38 } },
        fileName: "App.tsrx",
        type: "fatal",
      },
    ],
    [
      "function f(a, a) {}",
      {
        message: "Argument name clash",
        code: "TS2300",
        pos: 14,
        raisedAt: 15,
        end: 15,
        loc: { start: { line: 1, column: 14 }, end: { line: 1, column: 15 } },
        fileName: "App.tsrx",
        type: "fatal",
      },
    ],
  ];
  for (const [source, expected] of cases) {
    const error = thrown(source);
    assert.equal(error.constructor, Error, source);
    assert.deepEqual({ ...error, message: error.message }, expected, source);
  }

  // A statement after the rendered output: core's message and code. Core also spans the statement.
  const after = thrown("export function App() @{\n\t<div/>\n\tconst x = 1;\n}");
  assert.equal(after.constructor, Error);
  assert.deepEqual([after.code, after.message, after.type], [
    "TSRX2012",
    "Code must be at the top of '@{ }'; statements cannot follow the rendered output.",
    "fatal",
  ]);
});

test("#142: collected errors keep core's span shape", () => {
  const source = "export function App() @{\n\t<p>// c</p>\n}";
  const errors = [];
  parseModule(source, "App.tsrx", { collect: true, errors });
  assert.deepEqual(
    errors.map((error) => ({ ...error, message: error.message })),
    [
      {
        message: "Unclosed tag '<p>'. Expected '</p>' before end of template.",
        code: "TSRX1001",
        pos: 38,
        raisedAt: 39,
        end: 39,
        loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 1 } },
        fileName: "App.tsrx",
        type: "usage",
      },
    ],
  );
  // A strict parse raises the same mistake through acorn.
  assertAcornError(
    thrown(source),
    {
      code: "TSRX1001",
      message: "Unclosed tag '<p>'. Expected '</p>' before end of template. (3:0)",
      pos: 38,
      raisedAt: 39,
      loc: { line: 3, column: 0 },
    },
    source,
  );
});

// tsrx-org/oxc#175: a bare `@` fails the parse at the token after it, which acorn reads as the
// decorator's missing name, before any later mistake is reached.
test("#175: the first error after a bare `@` is the one thrown, at the token after the `@`", () => {
  const cases = [
    // A later malformed `@switch` body doesn't hide the bare `@`.
    [
      "export function App(v) @{\n\t@\n\t@switch (v) { @case 1: { <span/> } @ }\n}",
      { code: "TS1012", message: "Unexpected token (3:1)", pos: 30, raisedAt: 31, loc: { line: 3, column: 1 } },
    ],
    // The `@` of `@if`, not its `i`.
    [
      "export function App() @{\n\t@\n\t@if (v) { <span/> }\n}",
      { code: "TS1012", message: "Unexpected token (3:1)", pos: 29, raisedAt: 30, loc: { line: 3, column: 1 } },
    ],
    // The Markless drop-in source for #143.
    [
      "export function App({ value, values }) @{\n\t@\n\t@if (value) { <span>{value}</span> } @\n\t@for (const item of values) { <span>{item}</span> } @\n\t@switch (value) { @case 'x': { <span>x</span> } @ }\n\t@try { <span>{value}</span> } @\n\tconst expression = value + @;\n}\n@",
      { code: "TS1012", message: "Unexpected token (3:1)", pos: 46, raisedAt: 47, loc: { line: 3, column: 1 } },
    ],
    [
      "export function App() @{\n\t@ /* c */ @switch (v) { @ }\n}",
      { code: "TS1012", message: "Unexpected token (2:11)", pos: 36, raisedAt: 37, loc: { line: 2, column: 11 } },
    ],
  ];
  for (const [source, expected] of cases) assertAcornError(thrown(source), expected, source);

  // The token after the `@` decides the error: a keyword is TS1359, and a name makes a decorator.
  const keyword = thrown("export function App() @{\n\t@\n\tconst x = 1; <p/>\n}");
  assert.deepEqual(
    [keyword.code, keyword.message, keyword.pos],
    ["TS1359", "Unexpected keyword 'const' (3:1)", 29],
  );
  const decorator = thrown("export function App() @{\n\t@ x\n}");
  assert.deepEqual(
    [decorator.code, decorator.message, decorator.pos],
    ["TS1206", "Leading decorators must be attached to a class declaration. (3:0)", 30],
  );
  // An `@` in element text is text.
  const text = thrown("export function App(v) @{\n\t<div>\n\t@\n\t@switch (v) { @ }\n</div>\n}");
  assert.deepEqual([text.code, text.message, text.pos], ["TS1012", "Unexpected token (4:15)", 51]);
});

test("#175: a missing `@catch` or `@pending` is at `try`, one past the `@`", () => {
  const error = thrown("export function App(v) @{\n\t@try { <span/> } @\n}");
  assert.deepEqual(
    [error.code, error.message, error.pos],
    ["TSRX1010", "Missing `@catch` or `@pending` after `@try` block. (2:2)", 28],
  );
});
