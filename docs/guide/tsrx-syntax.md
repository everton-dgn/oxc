---
title: TSRX Syntax Support
description: The TSRX grammar slice the native overlay recognizes today, and how unsupported grammar fails.
---

# TSRX Syntax Support

The native scanner (`tsrx_syntax::scan`) reads your `.tsrx` file once, byte by
byte, and records where every piece of TSRX-only syntax starts and ends. That
record is called the overlay.

This page lists exactly which syntax the overlay recognizes today. Anything
outside this list **fails closed**: instead of guessing what your code means
and possibly producing wrong output, the command stops and reports an error
that tells you what it found and where.

## Control flow

### Statement containers

`@{ }` is a statement container, the successor and extension of JSX expression
containers: where JSX's `{ }` holds a single expression, `@{ }` holds ordinary
statements.

```tsrx
@{
  const doubled = count * 2;
}
```

### Conditionals

```tsrx
@if (user.isAdmin) {
  <AdminPanel />
} @else if (user.isMember) {
  <MemberPanel />
} @else {
  <SignIn />
}
```

### Loops

`@for` supports `for await`, declaration and assignment bindings, and
`index`/`key` annotations. `@empty` renders when the iterable produces
nothing:

```tsrx
@for (const item of items; index i; key item.id) {
  <Row item={item} position={i} />
} @empty {
  <EmptyState />
}
```

### Switch

```tsrx
@switch (status) {
  @case 'loading': { <Spinner /> }
  @case 'error': { <ErrorBanner /> }
  @default: { <Content /> }
}
```

### Try / pending / catch

Catch clauses support the headerless, error-binding, and
error-plus-reset-binding forms:

```tsrx
@try {
  <Profile user={await loadUser()} />
} @pending {
  <Skeleton />
} @catch (error, reset) {
  <Retry error={error} onRetry={reset} />
}
```

## Positions

Every control form is recognized in statement, direct JSX-child, nested, and
expression positions.

## Dynamic JSX tags

Matched dynamic opening/closing tags are recognized and validated against the
real expression AST from the single official OXC parse, with no lexical
approximation and no second parser:

```tsrx
<{props.as} prop={value}>
  children
</{props.as}>
```

As in `@tsrx/core` 0.5, a tag expression is one of three forms: an identifier
(`Tag`), a member access (`props.as`, `this.tag`, `registry[name]`,
`items[0]`), or a string literal (`'section'`). Anything else, such as
`c ? A : B`, `tag as any`, `props?.as`, or a call, still parses, but it is
reported with the code `tsrx-dynamic-tag-expression`. A normal parse throws
that error, and `collect` and `loose` mode record it and keep the tree.
`oxc-tsrx lint` and the editor report it as an error on the expression, and
still lint and format the rest of the file. To fix it, compute the tag above the
element (`const Tag = c ? A : B;`) and write `<{Tag} />`.

Identities are structurally normalized (enclosing parentheses and trivia are
stripped; edge comments are retained), so equivalent opening and closing
expressions match. Dynamic tag expressions containing *nested dynamic JSX* are
not yet supported.

## Raw style elements

Lowercase raw `<style>` elements are recognized with opaque payload spans. The
CSS bytes are preserved exactly: carried through lint and format untouched,
never CSS-formatted or CSS-validated.

## Comments in JSX text

As in `@tsrx/core` 0.5, anything that looks like a JavaScript comment in JSX
text is a comment, not text. A `/* ... */` is a comment anywhere in the text.
A `//` is a comment up to the end of its line when nothing but spaces and tabs
come before it on that line, or since the tag, element, or `{...}` child just
before it:

```tsrx
<div>
  Visible text
  // <Debug /> is commented out, and so is {value} here
  /* a block comment can span lines and hold tags or braces */
  more text a // after text on the same line, this is text
</div>
```

The comment is read before tags and braces, so it can hold a whole element, a
`{...}` child, a `}`, or a `<`. It is left out of the text around it, and it
shows up with the other comments. `oxc-tsrx lint` reads it as a comment too, so
a variable mentioned only inside one is still unused. `oxc-tsrx fmt` keeps each
run of text that holds a comment as you wrote it, only re-indented, so a line
comment never ends up joined to the text after it.

To write the characters as text, escape one of them: `&#47;*` or `&#47;&#47;`.
A comment that runs over its element's closing tag, such as `<p>// note</p>`,
leaves the element open until the `}` that closes the template, which is
reported as `Unclosed tag '<p>'` (code `tsrx-unclosed-tag`).

## Protected regions

The scanner protects strings, comments, regex literals, template text and
interpolation, JSX text and attributes, and multi-byte Unicode. An `@if`
inside a string literal is just text.

## Failing closed

The scanner rejects:

- orphan or reordered clauses (an `@else` without an `@if`, `@case` outside
  `@switch`);
- mismatched static or dynamic JSX closing tags;
- stale same-length overlays, by source fingerprint; and
- unsupported or incomplete grammar, including malformed editor states.

Failing closed is a deliberate contract: a fast path must not achieve its
numbers by silently dropping requested behavior.
