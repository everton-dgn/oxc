import assert from "node:assert/strict";
import test from "node:test";

import { parseModule } from "../../packages/tsrx-core-compat/dist/index.js";

// Regression tests for the @tsrx/core 0.5.0 conformance issues tsrx-org/oxc #110, #112, #113,
// #114, #115, and #116. Every expected value below is what @tsrx/core 0.5.0 (tsrx main at c70964d)
// returns for the same source, so a difference here is a difference from the reference parser.

function findAll(root, predicate) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index]);
      continue;
    }
    if (predicate(value)) found.push(value);
    for (const [key, child] of Object.entries(value).reverse()) {
      if (key === "loc" || key === "metadata" || key.endsWith("Comments")) continue;
      pending.push(child);
    }
  }
  return found;
}

const texts = (ast) =>
  findAll(ast, (node) => node.type === "JSXText").map(({ value, raw, start, end }) => ({
    value,
    raw,
    start,
    end,
  }));

const script = (ast) =>
  findAll(
    ast,
    (node) => node.type === "JSXElement" && node.openingElement?.name?.name === "script",
  )[0];

test("#110: a // line and a block comment in JSX text are left out of value and raw", () => {
  const cases = [
    [
      "export function App() @{\n\t<p>\n\t\ta\n\t\t// note\n\t\tb\n\t</p>\n}",
      [{ value: "\n\t\ta\n\t\t\n\t\tb\n\t", raw: "\n\t\ta\n\t\t\n\t\tb\n\t", start: 29, end: 49 }],
    ],
    [
      "export function App({ c }) @{\n\t<main>{c && <b>\n\t\ta\n\t\t// note\n\t\tb\n\t</b>}</main>\n}",
      [{ value: "\n\t\ta\n\t\t\n\t\tb\n\t", raw: "\n\t\ta\n\t\t\n\t\tb\n\t", start: 46, end: 66 }],
    ],
    [
      "export function App() {\n\treturn (\n\t\t<p>\n\t\t\ta\n\t\t\t// note\n\t\t\tb\n\t\t</p>\n\t);\n}",
      [
        {
          value: "\n\t\t\ta\n\t\t\t\n\t\t\tb\n\t\t",
          raw: "\n\t\t\ta\n\t\t\t\n\t\t\tb\n\t\t",
          start: 39,
          end: 63,
        },
      ],
    ],
    [
      "export function App() {\n\treturn <p>a /* note */ b</p>;\n}",
      [{ value: "a  b", raw: "a  b", start: 35, end: 49 }],
    ],
    [
      "export function App() @{\n\t<p>a /* note */ b</p>\n}",
      [{ value: "a  b", raw: "a  b", start: 29, end: 43 }],
    ],
    // A text made only of comments and layout is not a child.
    ["export function App() {\n\treturn <p>/* only */</p>;\n}", []],
    ["export function App() {\n\treturn <p>\n\t\t// only\n\t</p>;\n}", []],
    // A `//` after other text on its line is text, and so is an escaped comment opener.
    [
      "export function App() @{\n\t<p>a // note</p>\n}",
      [{ value: "a // note", raw: "a // note", start: 29, end: 38 }],
    ],
    [
      "export function App() {\n\treturn <p>a // note\n b</p>;\n}",
      [{ value: "a // note\n b", raw: "a // note\n b", start: 35, end: 47 }],
    ],
    [
      "export function App() @{\n\t<p>a &#47;* note *&#47; b</p>\n}",
      [
        {
          value: "a &#47;* note *&#47; b",
          raw: "a &#47;* note *&#47; b",
          start: 29,
          end: 51,
        },
      ],
    ],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(texts(parseModule(source, "App.tsrx")), expected, source);
  }
});

test("#112: a non-breaking space next to a line break is text, not layout", () => {
  const cases = [
    [
      "export function App() @{\n\t<p>\u00a0\n\t\t<b /></p>\n}",
      [{ value: "\u00a0\n\t\t", raw: "\u00a0\n\t\t", start: 29, end: 33 }],
    ],
    [
      "export function App() @{\n\t<p><b />\n\t\t\u00a0</p>\n}",
      [{ value: "\n\t\t\u00a0", raw: "\n\t\t\u00a0", start: 34, end: 38 }],
    ],
    [
      "export function App() {\n\treturn <p>\u00a0\n\t\t<b /></p>;\n}",
      [{ value: "\u00a0\n\t\t", raw: "\u00a0\n\t\t", start: 35, end: 39 }],
    ],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(texts(parseModule(source, "App.tsrx")), expected, JSON.stringify(source));
  }
});

test("#114: a plain function's <script> body is raw text on content, with no children", () => {
  const cases = [
    ["export function App({ code }) @{\n\t<div><script>{code}</script></div>\n}", "{code}"],
    ["export function App({ code }) {\n\treturn <div><script>{code}</script></div>;\n}", "{code}"],
    [
      "export function App({ code }) {\n\treturn <div><script>run(); {code}</script></div>;\n}",
      "run(); {code}",
    ],
    [
      "export function App() {\n\treturn (\n\t\t<script>\n\t\t\t// c\n\t\t\trun();\n\t\t</script>\n\t);\n}",
      "\n\t\t\t// c\n\t\t\trun();\n\t\t",
    ],
    ["export function App() {\n\treturn <script></script>;\n}", ""],
    ["export function App() {\n\treturn <script>if (a) { go(); }</script>;\n}", "if (a) { go(); }"],
    [
      'export function App() {\n\treturn <script type="application/json">{"a": 1}</script>;\n}',
      '{"a": 1}',
    ],
    ["export function App() {\n\treturn <script>if (a < b) go();</script>;\n}", "if (a < b) go();"],
    [
      "export function App() {\n\treturn <script>items.forEach((i) => log(i));</script>;\n}",
      "items.forEach((i) => log(i));",
    ],
  ];
  for (const [source, content] of cases) {
    const element = script(parseModule(source, "App.tsrx"));
    assert.equal(element.content, content, source);
    assert.deepEqual(element.children, [], source);
    const closeStart = source.lastIndexOf("</script>");
    assert.deepEqual(
      [element.closingElement.start, element.closingElement.end],
      [closeStart, closeStart + 9],
      source,
    );
  }
});

test("#116: a script body ends at </script, HTML whitespace, and >", () => {
  const cases = [
    ["export function App() @{\n\t<div><script>go();</script ></div>\n}", 44, 54],
    ["export function App() @{\n\t<div><script>go();</script\n\t></div>\n}", 44, 55],
    ["export function App() @{\n\t<div><script>go();</script\f></div>\n}", 44, 54],
    ["export function App() {\n\treturn <script>go();</script >;\n}", 45, 55],
  ];
  for (const [source, start, end] of cases) {
    for (const options of [undefined, { collect: true, errors: [] }, { loose: true, errors: [] }]) {
      const element = script(parseModule(source, "App.tsrx", options));
      assert.equal(element.content, "go();", source);
      assert.deepEqual([element.closingElement.start, element.closingElement.end], [start, end]);
      if (options) assert.deepEqual(options.errors, []);
    }
  }
});

test("#116: any other </script in a script body is tsrx-script-end-tag-in-body", () => {
  const message = (written) =>
    `'${written}' can end a script in HTML, so a '<script>' body can't contain it. Write '<\\/${written.slice(2)}' instead.`;
  const cases = [
    ["</SCRIPT>", "</SCRIPT", 60, 69],
    ["</script/>", "</script", 61, 70],
    ["</scripts>", "</script", 61, 70],
  ];
  for (const [inner, written, closeStart, closeEnd] of cases) {
    const source = `export function App() @{\n\t<div><script>a = 1;${inner}b = 2;</script></div>\n}`;

    assert.throws(
      () => parseModule(source, "App.tsrx"),
      (error) => {
        assert.equal(error.message, message(written));
        assert.equal(error.code, "tsrx-script-end-tag-in-body");
        assert.deepEqual([error.pos, error.end], [45, 53]);
        return true;
      },
      source,
    );

    for (const mode of ["collect", "loose"]) {
      const errors = [];
      const element = script(parseModule(source, "App.tsrx", { [mode]: true, errors }));
      assert.equal(element.content, `a = 1;${inner}b = 2;`, `${mode}: ${source}`);
      assert.deepEqual(element.children, []);
      assert.deepEqual(
        [element.closingElement.start, element.closingElement.end],
        [closeStart, closeEnd],
      );
      assert.deepEqual(
        errors.map(({ message, code, pos, end }) => ({ message, code, pos, end })),
        [{ message: message(written), code: "tsrx-script-end-tag-in-body", pos: 45, end: 53 }],
        `${mode}: ${source}`,
      );
    }
  }
});

test("#116: a </script in a string outside a script body is not reported", () => {
  const source = 'export function App() {\n\tconst s = "</SCRIPT>";\n\treturn <script>a</script>;\n}';
  const errors = [];
  assert.equal(script(parseModule(source, "App.tsrx", { collect: true, errors })).content, "a");
  assert.deepEqual(errors, []);
});

const DYNAMIC_TAG_MESSAGE =
  "A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";
const DYNAMIC_TAG_CODE = "tsrx-dynamic-tag-expression";

const dynamicTagSource = (tag) =>
  `export function App({ tag, props, registry, name, c, A, B, Tag, getTag, getName, level, items, a }) @{\n\t<div>\n\t\t<{${tag}} />\n\t</div>\n}`;

const dynamicTagNames = (ast) =>
  findAll(ast, (node) => node.type === "JSXOpeningElement" && node.name?.type === "JSXExpressionContainer");

test("#115: identifiers, member chains, and string literals are dynamic tags", () => {
  for (const tag of ["tag", "props.as", "registry[name]", "'section'", "this.tag", "items[0]", "a.b[name][0].c"]) {
    const source = dynamicTagSource(tag);
    const errors = [];
    parseModule(source, "App.tsrx");
    parseModule(source, "App.tsrx", { collect: true, errors });
    assert.deepEqual(errors, [], tag);
  }
});

test("#115: any other dynamic tag expression is reported at the part core reports", () => {
  // [tag, the part @tsrx/core 0.5.0 reports]
  const cases = [
    ["c ? A : B", "c ? A : B"],
    ["props.as ?? 'div'", "props.as ?? 'div'"],
    ["(tag)", "(tag)"],
    ["(a).b", "(a)"],
    ["tag as any", "tag as any"],
    ["tag!", "tag!"],
    ["c && Tag", "c && Tag"],
    ["props?.as", "props?.as"],
    ["registry[getName()]", "getName()"],
    ["registry[(name)]", "(name)"],
    ["undefined", "undefined"],
    ["null", "null"],
    ["() => <b>x</b>", "() => <b>x</b>"],
    ["c || <b>x</b>", "c || <b>x</b>"],
    ["`div`", "`div`"],
    ["getTag()", "getTag()"],
    ["'h' + level", "'h' + level"],
    ["@if (c) {A} @else {B}", "@if (c) {A} @else {B}"],
  ];
  for (const [tag, part] of cases) {
    const source = dynamicTagSource(tag);
    const start = source.indexOf(part, source.indexOf("<{"));
    const end = start + part.length;
    assert.throws(
      () => parseModule(source, "App.tsrx"),
      (error) => {
        assert.equal(error.message, DYNAMIC_TAG_MESSAGE, tag);
        assert.equal(error.code, DYNAMIC_TAG_CODE, tag);
        assert.deepEqual([error.pos, error.end], [start, end], tag);
        return true;
      },
    );
    for (const mode of ["collect", "loose"]) {
      const errors = [];
      const ast = parseModule(source, "App.tsrx", { [mode]: true, errors });
      assert.deepEqual(
        errors.map((error) => [error.message, error.code, error.type, error.pos, error.end]),
        [[DYNAMIC_TAG_MESSAGE, DYNAMIC_TAG_CODE, "usage", start, end]],
        `${mode} ${tag}`,
      );
      // The check doesn't change the parse: the tag keeps its authored expression.
      const [opening] = dynamicTagNames(ast);
      assert.equal(opening.name.start, source.indexOf("<{") + 1, `${mode} ${tag}`);
    }
  }
});

test("#115: a paired element is reported once, and a nested tag reports before its parent", () => {
  const paired = "export function App({ c, A, B }) @{\n\t<div><{c ? A : B}>x</{c ? A : B}></div>\n}";
  const errors = [];
  parseModule(paired, "App.tsrx", { collect: true, errors });
  assert.deepEqual(
    errors.map((error) => [error.pos, error.end]),
    [[44, 53]],
  );

  const nested = "export function A() @{ const x=<{() => <{a()}/>}>x</{() => <{a()}/>}>; }";
  const nestedErrors = [];
  parseModule(nested, "A.tsrx", { collect: true, errors: nestedErrors });
  assert.deepEqual(
    nestedErrors.map((error) => nested.slice(error.pos, error.end) + "@" + error.pos),
    ["a()@41", "() => <{a()}/>@33", "a()@61"],
  );
  assert.throws(
    () => parseModule(nested, "A.tsrx"),
    (error) => error.pos === 41,
  );
});

test("#115: a spread or an empty dynamic tag is no expression and throws in every mode", () => {
  const cases = [
    ["export function App({ a }) @{\n\t<div><{...a} /></div>\n}", 37, "(2:7)"],
    ["export function App() @{\n\t<div><{} /></div>\n}", 33, "(2:8)"],
  ];
  for (const [source, pos, position] of cases) {
    for (const options of [undefined, { collect: true, errors: [] }, { loose: true, errors: [] }]) {
      assert.throws(
        () => parseModule(source, "App.tsrx", options),
        (error) => {
          assert.ok(error instanceof SyntaxError);
          assert.equal(error.message, `${DYNAMIC_TAG_MESSAGE} ${position}`);
          assert.equal(error.pos, pos);
          assert.equal(error.end, undefined);
          return true;
        },
      );
      // Core raises these through acorn, so collecting records nothing before the throw.
      assert.deepEqual(options?.errors ?? [], []);
    }
  }
});

// #113: every expected value is what @tsrx/core 0.5.0 reports for the source; `[message, pos, end]`.
function strictError(source) {
  try {
    parseModule(source, "App.tsrx");
  } catch (error) {
    return [error.message, error.pos, error.end ?? null];
  }
  return null;
}

function recordedErrors(source, mode) {
  const errors = [];
  parseModule(source, "App.tsrx", { [mode]: true, errors });
  return errors.map((error) => [error.message, error.pos, error.end]);
}

const REDECLARATIONS = [
  // let twice
  ["export function f() {\n\tlet count = 0;\n\tlet count = 1;\n\treturn count;\n}", [["Identifier 'count' has already been declared", 43, 44]]],
  // var in block vs let top
  ["let a; { var a; }", [["Identifier 'a' has already been declared", 13, 14]]],
  // function twice top
  ["function g() {} function g() {}", [["Identifier 'g' has already been declared", 25, 26]]],
  // function then var top
  ["function g() {} var g;", [["Identifier 'g' has already been declared", 20, 21]]],
  // function block vs let
  ["{ function g() {} let g; }", [["Identifier 'g' has already been declared", 22, 23]]],
  // import, then const
  ["import { a } from 'x';\nconst a = 1;", [["Identifier 'a' has already been declared", 29, 30]]],
  // import type then const
  ["import type { A } from 'x';\nconst A = 1;", [["Identifier 'A' has already been declared", 34, 35]]],
  // import then var
  ["import { a } from 'x';\nvar a;", [["Identifier 'a' has already been declared", 27, 28]]],
  // class twice
  ["class A {}\nclass A {}", [["Identifier 'A' has already been declared", 17, 18]]],
  // catch parameter, then let
  ["try {} catch (e) {\n\tlet e = 1;\n}", [["Identifier 'e' has already been declared", 24, 25]]],
  // catch pattern var
  ["try {} catch ({ e }) { var e = 1; }", [["Identifier 'e' has already been declared", 27, 28]]],
  // for of const var body
  ["for (const x of []) { var x; }", [["Identifier 'x' has already been declared", 26, 27]]],
  // switch case lets
  ["switch (1) { case 1: let a; case 2: let a; }", [["Identifier 'a' has already been declared", 40, 41]]],
  // using twice
  ["{ using a = null; using a = null; }", [["Identifier 'a' has already been declared", 24, 25]]],
  // declare const then let
  ["declare const a: number;\nlet a;", [["Identifier 'a' has already been declared", 29, 30]]],
  // declare class then class
  ["declare class A {}\nclass A {}", [["Identifier 'A' has already been declared", 25, 26]]],
  // enum then const
  ["enum E { A }\nconst E = 1;", [["Identifier 'E' has already been declared", 19, 20]]],
  // abstract class twice
  ["abstract class A {}\nabstract class A {}", [["Identifier 'A' has already been declared", 35, 36]]],
  // tsrx const then var in nested @{ }
  ["export function App({ ready }) @{\n\tconst count = 0;\n\t<div>@{\n\t\tif (ready) { var count = 1; }\n\t\t<span>{count}</span>\n\t}</div>\n}", [["Identifier 'count' has already been declared", 80, 81]]],
  // tsrx const then var in @if
  ["export function App({ ready }) @{\n\tconst count = 0;\n\t<div>@if (ready) {\n\t\tvar count = 1;\n\t\t<span>{count}</span>\n\t}</div>\n}", [["Identifier 'count' has already been declared", 78, 79]]],
  // tsrx let twice in body
  ["export function App() @{\n\tlet a = 1;\n\tlet a = 2;\n\t<div />\n}", [["Identifier 'a' has already been declared", 42, 43]]],
  // tsrx @for body var same
  ["export function App({ items }) @{\n\t<ul>@for (const x of items) { var x = 1; <li>{x}</li> }</ul>\n}", [["Identifier 'x' has already been declared", 69, 70]]],
  // tsrx @for var body vs outer const
  ["export function App({ items }) @{\n\tconst y = 0;\n\t<ul>@for (const x of items) { var y = 1; <li>{x}</li> }</ul>\n}", [["Identifier 'y' has already been declared", 83, 84]]],
  // tsrx @switch var vs const
  ["export function App({ k }) @{\n\tconst x = 0;\n\t<div>@switch (k) { @case 1: { var x = 1; <b>{x}</b> } }</div>\n}", [["Identifier 'x' has already been declared", 79, 80]]],
  // tsrx @try catch let
  ["export function App() @{\n\t<div>@try { <b /> } @catch (e) { const e = 1; <i>{e}</i> }</div>\n}", [["Identifier 'e' has already been declared", 65, 66]]],
  // tsrx @try catch reset same
  ["export function App() @{\n\t<div>@try { <b /> } @catch (e, e) { <i /> }</div>\n}", [["Identifier 'e' has already been declared", 57, 58]]],
  // tsrx @try pending var
  ["export function App() @{\n\tconst y = 1;\n\t<div>@try { <b /> } @pending { var y = 2; <p /> }</div>\n}", [["Identifier 'y' has already been declared", 75, 76]]],
  // tsrx function then var in body
  ["export function App() @{\n\tfunction h() {}\n\tvar h;\n\t<div />\n}", [["Identifier 'h' has already been declared", 47, 48]]],
  // tsrx component vs import
  ["import { App } from 'x';\nexport function App() @{ <div /> }", [["Identifier 'App' has already been declared", 41, 42]]],
  // tsrx @if in plain fn
  ["export function App({ a }) {\n\tconst x = 1;\n\treturn <div>@if (a) { var x = 2; <b /> }</div>;\n}", [["Identifier 'x' has already been declared", 70, 71]]],
  // tsrx var in two nested levels
  ["export function App() @{\n\tlet q = 1;\n\t<div><p>@{ @if (true) { var q = 2; <b /> } }</p></div>\n}", [["Identifier 'q' has already been declared", 66, 67]]],
  // order fn body then name
  ["let f;\nfunction f() { let a; let a; }", [["Identifier 'a' has already been declared", 33, 34], ["Identifier 'f' has already been declared", 16, 17]]],
  // component nested @for var
  ["export function App({ items }) @{\n\tlet i = 0;\n\t<ul>@for (const x of items) { @if (x) { var i = 1; <li /> } }</ul>\n}", [["Identifier 'i' has already been declared", 91, 92]]],
];

test("#113: a redeclared binding throws core's error, and collect and loose record it", () => {
  for (const [source, expected] of REDECLARATIONS) {
    assert.deepEqual(strictError(source), expected[0], source);
    assert.deepEqual(recordedErrors(source, "collect"), expected, source);
    assert.deepEqual(recordedErrors(source, "loose"), expected, source);
  }
});

const ARGUMENT_CLASHES = [
  // duplicate parameter
  ["export function f(a, a) {}", ["Argument name clash", 21, 22], [["Argument name clash", 18, 19], ["Argument name clash", 21, 22]]],
  // duplicate param two names
  ["function f(a, b, a, b) {}", ["Argument name clash", 17, 18], [["Argument name clash", 11, 12], ["Argument name clash", 17, 18], ["Argument name clash", 14, 15], ["Argument name clash", 20, 21]]],
  // duplicate param pattern
  ["function f({ a }, [a]) {}", ["Argument name clash", 19, 20], [["Argument name clash", 13, 14], ["Argument name clash", 19, 20]]],
  // duplicate param arrow
  ["const f = (a, a) => a;", ["Argument name clash", 14, 15], [["Argument name clash", 11, 12], ["Argument name clash", 14, 15]]],
  // param property dup
  ["class C { constructor(public a, a) {} }", ["Argument name clash", 32, 33], [["Argument name clash", 29, 30], ["Argument name clash", 32, 33]]],
  // tsrx dup params
  ["export function App(a, a) @{\n\t<div />\n}", ["Argument name clash", 23, 24], [["Argument name clash", 20, 21], ["Argument name clash", 23, 24]]],
  // tsrx arrow component
  ["export const App = (a, a) => @{ <div /> };", ["Argument name clash", 23, 24], [["Argument name clash", 20, 21], ["Argument name clash", 23, 24]]],
  // tsrx typed props dup
  ["export function App({ a }: { a: string }, a: number) @{ <div /> }", ["Argument name clash", 42, 43], [["Argument name clash", 22, 23], ["Argument name clash", 42, 51]]],
];

test("#113: a duplicate parameter throws at the second, and collect records both", () => {
  for (const [source, strict, recorded] of ARGUMENT_CLASHES) {
    assert.deepEqual(strictError(source), strict, source);
    assert.deepEqual(recordedErrors(source, "collect"), recorded, source);
    assert.deepEqual(recordedErrors(source, "loose"), recorded, source);
  }
});

const ACORN_RAISES = [
  // export of an undefined name
  ["export { missing };", ["Export 'missing' is not defined (1:9)", 9, null], [["Export 'missing' is not defined", 9, 10]]],
  // export two undefined
  ["export { m1, m2 };", ["Export 'm1' is not defined (1:9)", 9, null], [["Export 'm1' is not defined", 9, 10], ["Export 'm2' is not defined", 13, 14]]],
  // export let in block
  ["{ let a; }\nexport { a };", ["Export 'a' is not defined (2:9)", 20, null], [["Export 'a' is not defined", 20, 21]]],
  // export overload only
  ["function f(): void;\nexport { f };", ["Export 'f' is not defined (2:9)", 29, null], [["Export 'f' is not defined", 29, 30]]],
  // tsrx export undefined
  ["export function App() @{ <div /> }\nexport { Missing };", ["Export 'Missing' is not defined (2:9)", 44, null], [["Export 'Missing' is not defined", 44, 45]]],
  // type twice
  ["type A = 1;\ntype A = 2;", ["type 'A' has already been declared. (2:5)", 17, null], [["type 'A' has already been declared.", 17, 18]]],
  // interface and type
  ["interface A {}\ntype A = 1;", ["type 'A' has already been declared. (2:5)", 20, null], [["type 'A' has already been declared.", 20, 21]]],
];

test("#113: an undefined export and a redeclared type alias throw acorn's error shape", () => {
  for (const [source, strict, recorded] of ACORN_RAISES) {
    assert.deepEqual(strictError(source), strict, source);
    assert.deepEqual(recordedErrors(source, "collect"), recorded, source);
    assert.deepEqual(recordedErrors(source, "loose"), recorded, source);
  }
  assert.throws(
    () => parseModule("export { missing };", "App.tsrx"),
    (error) =>
      error instanceof SyntaxError &&
      error.message === "Export 'missing' is not defined (1:9)" &&
      error.pos === 9 &&
      error.loc.line === 1 &&
      error.loc.column === 9,
  );
});

const VALID_SCOPES = [
  // var twice fn
  "function f() { var a; var a; }",
  // var twice top
  "var a; var a;",
  // let in block shadows
  "let a; { let a; }",
  // function twice in fn
  "function f() { function g() {} function g() {} }",
  // function then var in fn
  "function f() { function g() {} var g; }",
  // catch param var
  "try {} catch (e) { var e = 1; }",
  // param then var
  "function f(a) { var a; }",
  // destructure dup var
  "var [a, a] = [];",
  // for let shadow
  "for (let i = 0; i < 1; i++) { let i; }",
  // for twice sibling
  "for (let i of []) {} for (let i of []) {}",
  // static block var
  "var a; class C { static { var a; } }",
  // export declared later
  "export { a };\nconst a = 1;",
  // export import
  "import { a } from 'x';\nexport { a };",
  // export type
  "type A = 1;\nexport { A };",
  // export interface
  "interface A {}\nexport type { A };",
  // export from
  "export { missing } from 'x';",
  // export var in block
  "{ var a; }\nexport { a };",
  // export namespace
  "namespace N {}\nexport { N };",
  // export declare fn
  "declare function f(): void;\nexport { f };",
  // export enum
  "enum E { A }\nexport { E };",
  // overloads
  "function f(a: string): void;\nfunction f(a: number): void;\nfunction f(a: any) {}",
  // export overloads
  "export function f(a: string): void;\nexport function f(a: any) {}",
  // overload then let
  "function f(): void;\nlet f;",
  // declare function twice
  "declare function f(): void;\ndeclare function f(): void;",
  // declare var twice
  "declare var a: number;\ndeclare var a: number;",
  // interface twice
  "interface A {}\ninterface A {}",
  // interface and class
  "interface A {}\nclass A {}",
  // type and interface
  "type A = 1;\ninterface A {}",
  // type and const
  "type A = 1;\nconst A = 1;",
  // enum twice
  "enum E { A }\nenum E { B }",
  // const enum twice
  "const enum E { A }\nconst enum E { B }",
  // enum and namespace
  "enum E { A }\nnamespace E {}",
  // namespace twice
  "namespace N {}\nnamespace N {}",
  // function and namespace
  "function f() {}\nnamespace f {}",
  // class and namespace
  "class C {}\nnamespace C {}",
  // declare module string
  "declare module 'x' { const a: number; }\nconst a = 1;",
  // declare global
  "declare global { var a: number; }\nvar a: number;",
  // this param
  "function f(this: any, a) {}",
  // generic param names
  "function f<T, T>() {}",
  // import type then interface
  "import type { A } from 'x';\ninterface A {}",
  // tsrx param then const in body
  "export function App({ a }) @{\n\tconst a = 1;\n\t<div>{a}</div>\n}",
  // tsrx param then var in body
  "export function App(a) @{\n\tvar a = 1;\n\t<div>{a}</div>\n}",
  // tsrx param then let in body plain name
  "export function App(count) @{\n\tlet count = 1;\n\t<div />\n}",
  // tsrx sibling @if bodies each const x
  "export function App({ a }) @{\n\t<div>@if (a) { const x = 1; <b>{x}</b> } @else { const x = 2; <i>{x}</i> }</div>\n}",
  // tsrx @if const shadows outer
  "export function App({ a }) @{\n\tconst x = 0;\n\t<div>@if (a) { const x = 1; <b>{x}</b> }</div>\n}",
  // tsrx @if var vs outer var
  "export function App({ a }) @{\n\tvar x = 0;\n\t<div>@if (a) { var x = 1; <b>{x}</b> }</div>\n}",
  // tsrx @for shadow
  "export function App({ items }) @{\n\tconst x = 0;\n\t<ul>@for (const x of items) { <li>{x}</li> }</ul>\n}",
  // tsrx @for body const same
  "export function App({ items }) @{\n\t<ul>@for (const x of items) { const x = 1; <li>{x}</li> }</ul>\n}",
  // tsrx @for index same as item
  "export function App({ items }) @{\n\t<ul>@for (const x of items; index x) { <li>{x}</li> }</ul>\n}",
  // tsrx @switch cases const
  "export function App({ k }) @{\n\t<div>@switch (k) { @case 1: { const x = 1; <b>{x}</b> } @case 2: { const x = 2; <i>{x}</i> } }</div>\n}",
  // tsrx @try catch var
  "export function App() @{\n\t<div>@try { <b /> } @catch (e) { var e = 1; <i>{e}</i> }</div>\n}",
  // tsrx sibling @{ } const
  "export function App() @{\n\t<div>@{ const x = 1; <b>{x}</b> }<span>@{ const x = 2; <i>{x}</i> }</span></div>\n}",
  // tsrx sibling @{ } var
  "export function App() @{\n\t<div>@{ var x = 1; <b>{x}</b> }<span>@{ var x = 2; <i>{x}</i> }</span></div>\n}",
  // tsrx sibling @{ } var vs let
  "export function App() @{\n\t<div>@{ let x = 1; <b>{x}</b> }<span>@{ var x = 2; <i>{x}</i> }</span></div>\n}",
  // tsrx nested fn var
  "export function App() @{\n\tconst x = 1;\n\tfunction h() { var x = 2; }\n\t<div />\n}",
  // tsrx arrow component body let vs param
  "export const App = (a) => @{ let a; <div /> };",
  // tsrx method component
  "export const o = { Render(a) @{ let a = 1; <div /> } };",
  // tsrx var in element handler arrow
  "export function App() @{\n\tconst x = 1;\n\t<button onClick={() => { var x = 2; }} />\n}",
  // nested component var
  "export function Outer() @{\n\tconst x = 1;\n\tfunction Inner() @{ var x = 2; <b /> }\n\t<div />\n}",
  // class method overloads
  "class C { m(a: string): void; m(a: any) {} constructor(a: string); constructor(a: any) {} }",
  // declare fn dup params
  "declare function f(a, a): void;",
  // overload dup params
  "function f(a, a): void;\nfunction f() {}",
  // abstract method dup
  "abstract class C { abstract m(a, a): void; }",
  // ts fn type dup
  "type F = (a: string, a: number) => void;",
  // const with same name in two components
  "export function A() @{ const x = 1; <b /> }\nexport function B() @{ const x = 1; <i /> }",
  // catch no param
  "try {} catch { let e; }",
];

test("#113: merging, shadowing, overloads, and template scopes core accepts stay valid", () => {
  for (const source of VALID_SCOPES) {
    assert.equal(strictError(source), null, source);
    assert.deepEqual(recordedErrors(source, "collect"), [], source);
    assert.deepEqual(recordedErrors(source, "loose"), [], source);
  }
});
