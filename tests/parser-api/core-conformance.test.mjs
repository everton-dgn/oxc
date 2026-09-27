import assert from "node:assert/strict";
import test from "node:test";

import { parseModule } from "../../packages/tsrx-core-compat/dist/index.js";

// Regression tests for the @tsrx/core 0.5.0 conformance issues tsrx-org/oxc #110, #112, #114,
// #115, and #116. Every expected value below is what @tsrx/core 0.5.0 (tsrx main at c70964d)
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
