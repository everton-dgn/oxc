import assert from "node:assert/strict";
import test from "node:test";

import { parseModule } from "../../packages/tsrx-core-compat/dist/index.js";

// Regression tests for tsrx-org/oxc #139 (a lone surrogate in a `.js`, `.jsx`, `.ts` or `.tsx`
// file) and #140 (a TemplateElement's span and raw text). Every expected value below is what
// @tsrx/core 0.5.2 returns for the same source. `<H>` and `<L>` in a source stand for a lone high
// and a lone low surrogate, which a JavaScript string can hold.

const source = (text) => text.replaceAll("<H>", "\ud800").replaceAll("<L>", "\udc00");

function findAll(root, predicate) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (predicate(value)) found.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (key !== "loc" && key !== "metadata") pending.push(child);
    }
  }
  return found.sort((left, right) => left.start - right.start);
}

// Each string, regular expression, JSX text and template text, in source order, as
// `[start, end, raw, value]`: a template's `value` is its cooked text, a regular expression's
// its pattern.
const texts = (ast) =>
  findAll(ast, (node) => ["Literal", "JSXText", "TemplateElement"].includes(node.type)).map(
    (node) =>
      node.type === "TemplateElement"
        ? [node.start, node.end, node.value.raw, node.value.cooked]
        : node.regex
          ? [node.start, node.end, node.raw, node.regex.pattern]
          : [node.start, node.end, node.raw, node.value],
  );

test("#139: a lone surrogate in a .ts or .tsx string, attribute or JSX text is kept as written", () => {
  assert.deepEqual(texts(parseModule(source("const s = 'a<H>b';"), "App.ts")), [
    [10, 15, source("'a<H>b'"), source("a<H>b")],
  ]);
  const tsx = source("const s = 'a<H>b';\nconst x = <p title=\"a<H>b\">a<H>b</p>;");
  for (const filename of ["App.tsx", "App.tsrx"]) {
    assert.deepEqual(texts(parseModule(tsx, filename)), [
      [10, 15, source("'a<H>b'"), source("a<H>b")],
      [36, 41, source('"a<H>b"'), source("a<H>b")],
      [42, 45, source("a<H>b"), source("a<H>b")],
    ], filename);
  }
});

test("#139: a lone surrogate is told apart from a U+FFFD, and a directive and a pattern keep it", () => {
  // A U+FFFD written as is or as an escape stays one, and `\` before a lone surrogate cooks to it.
  const string = String.raw`"<L>\<H>\ud800�<H>\u{FFFD}�"`;
  const ast = parseModule(
    source(`'use <H>';\nconst s = ${string};\nconst r = /a<H>[<L>]/g;`),
    "App.js",
  );
  assert.deepEqual(texts(ast), [
    [0, 7, source("'use <H>'"), source("use <H>")],
    [19, 41, source(string), source("<L><H><H>�<H>��")],
    [53, 61, source("/a<H>[<L>]/g"), source("a<H>[<L>]")],
  ]);
  assert.equal(ast.body[0].directive, source("use <H>"));
  assert.equal(String(ast.body[2].declarations[0].init.value), source("/a<H>[<L>]/g"));
});

test("#139: template escapes next to a lone surrogate cook as core cooks them", () => {
  const escaped = String.raw`\<H>\u{FFFD}<L>\
<H>`;
  assert.deepEqual(texts(parseModule(source(`const t = \`${escaped}\`;`), "App.ts")), [
    [11, 25, source(escaped), source("<H>�<L><H>")],
  ]);
  // A tagged template's invalid escape leaves `cooked` null and `raw` as written.
  const tagged = source(String.raw`const t = tag` + "`" + String.raw`\unicode<H>${"${x}"}\x<L>` + "`;");
  for (const filename of ["App.ts", "App.tsx"]) {
    assert.deepEqual(texts(parseModule(tagged, filename)), [
      [14, 23, source(String.raw`\unicode<H>`), null],
      [27, 30, source(String.raw`\x<L>`), null],
    ], filename);
  }
});

test("#139: a lone surrogate in a .jsx attribute and text is kept around character references", () => {
  const ast = parseModule(
    source('const x = <p title="&amp;<H>\\\\">\r\n<H>&lt;&#xFFFD;</p>;'),
    "App.jsx",
  );
  assert.deepEqual(texts(ast), [
    [19, 29, source('"&amp;<H>\\\\"'), source("&<H>\\\\")],
    [30, 45, source("\r\n<H>&lt;&#xFFFD;"), source("\n<H><�")],
  ]);
});

test("#139: template text keeps a lone surrogate in raw and cooked, with CRLF read as LF", () => {
  const text = source("const t = tag`a<H>${x}\r\nb<L>${`n<H>${y}`}\\\\unicode<H>`;");
  const expected = [
    [14, 16, source("a<H>"), source("a<H>")],
    [20, 24, source("\nb<L>"), source("\nb<L>")],
    [27, 29, source("n<H>"), source("n<H>")],
    [33, 33, "", ""],
    [35, 45, source("\\\\unicode<H>"), source("\\unicode<H>")],
  ];
  for (const filename of ["App.js", "App.ts", "App.tsx", "App.tsrx"]) {
    assert.deepEqual(texts(parseModule(text, filename)), expected, filename);
  }
});

test("#139: a comment keeps a lone surrogate as written", () => {
  // Core attaches the comments to the declaration; the text and the spans are the same.
  for (const filename of ["App.ts", "App.tsx", "App.tsrx"]) {
    const comments = [];
    parseModule(source("// c<H>\n/* d<L> */ const e = 1;"), filename, { comments });
    assert.deepEqual(
      comments.map(({ type, value, start, end }) => [type, value, start, end]),
      [
        ["Line", source(" c<H>"), 0, 5],
        ["Block", source(" d<L> "), 6, 14],
      ],
      filename,
    );
  }
});

test("#139: a surrogate pair is read as its character, unchanged", () => {
  for (const filename of ["App.ts", "App.tsx", "App.tsrx"]) {
    assert.deepEqual(texts(parseModule('const e = "😀" + `😀${x}😀`;', filename)), [
      [10, 14, '"😀"', "😀"],
      [18, 20, "😀", "😀"],
      [24, 26, "😀", "😀"],
    ], filename);
  }
});

test("#140: a TemplateElement spans its text alone, without the template's delimiters", () => {
  for (const filename of ["App.ts", "App.tsx", "App.jsx", "App.tsrx"]) {
    const ast = parseModule("const t = `a${x}b`;", filename);
    assert.deepEqual(texts(ast), [
      [11, 12, "a", "a"],
      [16, 17, "b", "b"],
    ], filename);
    const [head, tail] = ast.body[0].declarations[0].init.quasis;
    assert.deepEqual([head.loc, tail.loc], [
      { start: { line: 1, column: 11 }, end: { line: 1, column: 12 } },
      { start: { line: 1, column: 16 }, end: { line: 1, column: 17 } },
    ], filename);
  }
});

test("#140: a lone surrogate keeps the delimiters out of a TemplateElement's raw text", () => {
  for (const filename of ["App.tsx", "App.tsrx"]) {
    assert.deepEqual(texts(parseModule(source("const t = `a<H>${x}b`;"), filename)), [
      [11, 13, source("a<H>"), source("a<H>")],
      [17, 18, "b", "b"],
    ], filename);
  }
  assert.deepEqual(
    texts(parseModule(source("const t = tag`a${`<H>${y}`}\r\n<H>`;"), "App.tsrx")),
    [
      [14, 15, "a", "a"],
      [18, 19, source("<H>"), source("<H>")],
      [23, 23, "", ""],
      [25, 28, source("\n<H>"), source("\n<H>")],
    ],
  );
});

test("#140: template literal types, templates in JSX, and templates in a template body", () => {
  assert.deepEqual(
    texts(parseModule(source("type T = `a<H>${B}c`;\nconst x = <p>{`<H>${1}`}</p>;"), "App.tsx")),
    [
      [10, 12, source("a<H>"), source("a<H>")],
      [16, 17, "c", "c"],
      [35, 36, source("<H>"), source("<H>")],
      [38, 39, "1", 1],
      [40, 40, "", ""],
    ],
  );
  assert.deepEqual(
    texts(
      parseModule(
        source('export function App() @{ const t = `}${x}${`é`}`; <p title="<H>">{t}<H></p> }'),
        "App.tsrx",
      ),
    ),
    [
      [36, 37, "}", "}"],
      [41, 41, "", ""],
      [44, 45, "é", "é"],
      [47, 47, "", ""],
      [59, 62, source('"<H>"'), source("<H>")],
      [66, 67, source("<H>"), source("<H>")],
    ],
  );
});
