import { parse_style } from "./style.js";
//#region src/facade.ts
const PARSER_OPTIONS = Object.freeze({
	lang: "tsrx",
	sourceType: "module",
	astType: "ts",
	preserveParens: true
});
const TSRX_CORE_COMPAT_EAGER = Symbol.for("@oxc-tsrx/parser/tsrx-core-compat-eager");
const TSRX_CORE_COMPAT_DEFAULTS_STRIPPED = Symbol.for("@oxc-tsrx/parser/tsrx-core-compat-defaults-stripped");
const EAGER_PARSER_OPTIONS = Object.freeze(Object.defineProperty({ ...PARSER_OPTIONS }, TSRX_CORE_COMPAT_EAGER, { value: true }));
const EMPTY_ERRORS = Object.freeze([]);
function parserResultProgram(result) {
	return result?.type === "Program" ? result : result?.program ?? null;
}
function parserResultErrors(result) {
	return result?.type === "Program" ? EMPTY_ERRORS : result?.errors ?? EMPTY_ERRORS;
}
function tsrxRetry(parser, filename, source, eagerTsrx) {
	const options = eagerTsrx ? EAGER_PARSER_OPTIONS : PARSER_OPTIONS;
	const result = parser.parseSync(filename, source, options);
	if (parserResultProgram(result) === null || parserResultErrors(result).length > 0) return null;
	return {
		result,
		options
	};
}
function ordinaryParserOptions(lang) {
	return Object.freeze({
		lang,
		sourceType: "module",
		astType: "js",
		preserveParens: false,
		showSemanticErrors: true
	});
}
const TYPESCRIPT_PARSER_OPTIONS = ordinaryParserOptions("ts");
const TYPESCRIPT_REACT_PARSER_OPTIONS = Object.freeze({
	...ordinaryParserOptions("tsx"),
	astType: "ts"
});
const TYPESCRIPT_DEFINITION_PARSER_OPTIONS = ordinaryParserOptions("dts");
function parserOptions(filename, eagerTsrx = false) {
	let pathname = filename;
	const query = pathname.indexOf("?");
	const hash = pathname.indexOf("#");
	const suffix = query === -1 ? hash : hash === -1 ? query : Math.min(query, hash);
	if (suffix !== -1) pathname = pathname.slice(0, suffix);
	if (pathname.endsWith(".tsrx")) return eagerTsrx ? EAGER_PARSER_OPTIONS : PARSER_OPTIONS;
	if (pathname.endsWith(".d.ts") || pathname.endsWith(".d.mts") || pathname.endsWith(".d.cts")) return TYPESCRIPT_DEFINITION_PARSER_OPTIONS;
	if (pathname.endsWith(".tsx")) return TYPESCRIPT_REACT_PARSER_OPTIONS;
	if (pathname.endsWith(".object.ts")) return TYPESCRIPT_REACT_PARSER_OPTIONS;
	if (pathname.endsWith(".ts") || pathname.endsWith(".mts") || pathname.endsWith(".cts")) return TYPESCRIPT_PARSER_OPTIONS;
	if (pathname.endsWith(".jsx")) return TYPESCRIPT_REACT_PARSER_OPTIONS;
	if (pathname.endsWith(".js") || pathname.endsWith(".mjs") || pathname.endsWith(".cjs")) return TYPESCRIPT_PARSER_OPTIONS;
	return eagerTsrx ? EAGER_PARSER_OPTIONS : PARSER_OPTIONS;
}
const DYNAMIC_TAG_REFERENCE_MESSAGE = "A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";
const DYNAMIC_TAG_EXPRESSION_CODE = "tsrx-dynamic-tag-expression";
const DYNAMIC_TAG_NOT_EXPRESSION_MESSAGE = /^malformed TSRX at byte \d+: expected a valid dynamic JSX tag expression$/u;
const UNCLOSED_TAG_MESSAGE = /^Unclosed tag '<[^'\r\n]*>'\. Expected '<\/[^'\r\n]*>' before end of template\.$/u;
const UNCLOSED_TAG_CODE = "tsrx-unclosed-tag";
const IDENTIFIER_START = /[$_\p{ID_Start}]/u;
const IDENTIFIER_CONTINUE = /[$_\u200c\u200d\p{ID_Continue}]/u;
const WHITESPACE = /\s/u;
const SOURCE_DECLARATION_TYPES = /* @__PURE__ */ new Set([
	"ImportDeclaration",
	"ExportNamedDeclaration",
	"ExportAllDeclaration"
]);
const COMPLETION_PLACEHOLDER = "__markless_at__";
const RECOVERABLE_LOOSE_SHAPE_MESSAGE = "unsupported TSRX parser shape: failed TSRX result has no authored diagnostic";
const LOOSE_RENDER_ERRORS = /* @__PURE__ */ new Set([
	"Adjacent JSX elements must be wrapped in an enclosing tag.",
	"render expression precedes another statement",
	RECOVERABLE_LOOSE_SHAPE_MESSAGE
]);
function createRecoverySource(source) {
	return {
		text: source,
		boundaries: Array.from({ length: source.length + 1 }, (_value, index) => index)
	};
}
function replaceRecoveryRange(recovery, start, end, replacement) {
	const oldLength = end - start;
	const replacementBoundaries = [];
	if (replacement.length === oldLength) replacementBoundaries.push(...recovery.boundaries.slice(start, end + 1));
	else {
		const originalStart = recovery.boundaries[start];
		const originalEnd = recovery.boundaries[end];
		replacementBoundaries.push(originalStart);
		for (let index = 1; index < replacement.length; index += 1) replacementBoundaries.push(originalStart);
		replacementBoundaries.push(originalEnd);
	}
	recovery.text = recovery.text.slice(0, start) + replacement + recovery.text.slice(end);
	recovery.boundaries.splice(start, oldLength + 1, ...replacementBoundaries);
}
function applyRecoveryEdits(recovery, edits) {
	const ordered = [...edits].sort((left, right) => right.start - left.start);
	for (const edit of ordered) replaceRecoveryRange(recovery, edit.start, edit.end, edit.replacement);
}
function remapRecoveredTree(root, boundaries) {
	const seen = /* @__PURE__ */ new WeakSet();
	const stack = [root];
	while (stack.length > 0) {
		const value = stack.pop();
		if (value === null || typeof value !== "object" || seen.has(value)) continue;
		seen.add(value);
		if (value.type === "StyleSheet") continue;
		if (Number.isInteger(value.start)) value.start = boundaries[Math.max(0, Math.min(boundaries.length - 1, value.start))];
		if (Number.isInteger(value.end)) value.end = boundaries[Math.max(0, Math.min(boundaries.length - 1, value.end))];
		if (Array.isArray(value.range) && value.range.length === 2) {
			value.range[0] = boundaries[Math.max(0, Math.min(boundaries.length - 1, value.range[0]))];
			value.range[1] = boundaries[Math.max(0, Math.min(boundaries.length - 1, value.range[1]))];
		}
		for (const [key, child] of Object.entries(value)) {
			if (key === "parent" || key === "loc" || child === null || typeof child !== "object") continue;
			if (Array.isArray(child)) for (let index = child.length - 1; index >= 0; index -= 1) stack.push(child[index]);
			else stack.push(child);
		}
	}
}
function isOperationalError(error) {
	return error?.name === "ParserOperationalError" || typeof error?.code === "string" && error.code.startsWith("ERR_TSRX_");
}
function isRecoverableLooseShapeFailure(error) {
	return isOperationalError(error) && error?.code === "ERR_TSRX_INVALID_ARGUMENT" && error?.message === RECOVERABLE_LOOSE_SHAPE_MESSAGE;
}
function isSyntaxErrorLike(error) {
	return error instanceof SyntaxError || error?.name === "SyntaxError" || typeof error?.message === "string" && Array.isArray(error?.labels);
}
function positionLookup(source) {
	const lineStarts = [0];
	for (let index = 0; index < source.length; index += 1) {
		const code = source.charCodeAt(index);
		if (code === 13) {
			if (source.charCodeAt(index + 1) === 10) index += 1;
			lineStarts.push(index + 1);
		} else if (code === 10 || code === 8232 || code === 8233) lineStarts.push(index + 1);
	}
	return (rawOffset) => {
		const offset = Math.max(0, Math.min(source.length, Number.isInteger(rawOffset) ? rawOffset : 0));
		let low = 0;
		let high = lineStarts.length;
		while (low + 1 < high) {
			const middle = low + high >>> 1;
			if (lineStarts[middle] <= offset) low = middle;
			else high = middle;
		}
		return {
			line: low + 1,
			column: offset - lineStarts[low]
		};
	};
}
function primarySpan(error) {
	const label = Array.isArray(error?.labels) ? error.labels.find((candidate) => Number.isInteger(candidate?.start) && Number.isInteger(candidate?.end)) : void 0;
	const start = label?.start ?? (Number.isInteger(error?.pos) ? error.pos : void 0);
	return {
		start,
		end: label?.end ?? (Number.isInteger(error?.end) ? error.end : Number.isInteger(error?.raisedAt) ? error.raisedAt : start)
	};
}
function compatibleDiagnosticSpan(error, source) {
	const span = primarySpan(error);
	if (error?.message !== "Unexpected token" || typeof source !== "string" || !Number.isInteger(span.start)) return span;
	let extra = Math.min(span.start - 1, source.length - 1);
	while (extra >= 0 && WHITESPACE.test(source[extra])) extra -= 1;
	if (source[extra] !== ">" || source[extra - 1] !== ">") return span;
	const closingStart = source.lastIndexOf("</", extra - 1);
	if (closingStart === -1 || source.lastIndexOf("<", extra - 1) !== closingStart) return span;
	const closingName = source.slice(closingStart + 2, extra - 1);
	if (!/^(?:[A-Za-z_$][\w.$:-]*|\{[^{}\r\n]*\})?$/u.test(closingName)) return span;
	return {
		start: extra,
		end: extra + 1
	};
}
function compatibleDiagnosticMessage(error) {
	return typeof error?.message === "string" ? error.message : String(error);
}
function isDynamicTagNotExpression(error) {
	return typeof error?.message === "string" && DYNAMIC_TAG_NOT_EXPRESSION_MESSAGE.test(error.message);
}
function dynamicTagNotExpressionError(error, positionAt) {
	const { start, end } = primarySpan(error);
	const loc = positionAt(start);
	const raised = /* @__PURE__ */ new SyntaxError(`${DYNAMIC_TAG_REFERENCE_MESSAGE} (${loc.line}:${loc.column})`);
	raised.pos = start;
	raised.loc = loc;
	raised.raisedAt = end;
	return raised;
}
function isUnclosedTag(error) {
	return typeof error?.message === "string" && UNCLOSED_TAG_MESSAGE.test(error.message);
}
function acornRaise(message, start, positionAt) {
	const loc = positionAt(start);
	const raised = /* @__PURE__ */ new SyntaxError(`${message} (${loc.line}:${loc.column})`);
	raised.pos = start;
	raised.loc = loc;
	raised.raisedAt = start;
	return raised;
}
function unclosedTagFailure(error, collecting, positionAt, source) {
	if (collecting && typeof source === "string") return acornRaise("'}' expected.", source.length, positionAt);
	return acornRaise(error.message, primarySpan(error).start ?? 0, positionAt);
}
function compatibleDiagnosticCode(error, message) {
	if (typeof error?.code === "string") return error.code;
	if (UNCLOSED_TAG_MESSAGE.test(message)) return UNCLOSED_TAG_CODE;
	return message === DYNAMIC_TAG_REFERENCE_MESSAGE ? DYNAMIC_TAG_EXPRESSION_CODE : void 0;
}
function toCompileError(error, filename, positionAt, type, source) {
	const translated = new SyntaxError(compatibleDiagnosticMessage(error));
	const { start, end } = compatibleDiagnosticSpan(error, source);
	translated.code = compatibleDiagnosticCode(error, translated.message);
	translated.pos = start;
	translated.raisedAt = end;
	translated.end = end;
	translated.fileName = filename;
	translated.type = type;
	translated.loc = start === void 0 ? void 0 : {
		start: positionAt(start),
		end: positionAt(end ?? start)
	};
	return translated;
}
function codePointAt(source, index) {
	const value = source.codePointAt(index);
	return value === void 0 ? {
		character: "",
		width: 0
	} : {
		character: String.fromCodePoint(value),
		width: value > 65535 ? 2 : 1
	};
}
function readIdentifier(source, start) {
	let point = codePointAt(source, start);
	if (!IDENTIFIER_START.test(point.character)) return null;
	let end = start + point.width;
	while (end < source.length) {
		point = codePointAt(source, end);
		if (!IDENTIFIER_CONTINUE.test(point.character)) break;
		end += point.width;
	}
	return {
		start,
		end,
		name: source.slice(start, end)
	};
}
function skipQuoted(source, start, quote) {
	let index = start + 1;
	while (index < source.length) {
		const character = source[index];
		if (character === "\\") index += 2;
		else if (character === quote) return index + 1;
		else index += codePointAt(source, index).width || 1;
	}
	return source.length;
}
function skipComment(source, start) {
	if (source[start + 1] === "/") {
		const newline = source.indexOf("\n", start + 2);
		return newline === -1 ? source.length : newline + 1;
	}
	if (source[start + 1] === "*") {
		const close = source.indexOf("*/", start + 2);
		return close === -1 ? source.length : close + 2;
	}
	return start + 1;
}
function matchingBrace(source, open) {
	let depth = 1;
	for (let index = open + 1; index < source.length; index += 1) {
		const character = source[index];
		if (character === "\"" || character === "'" || character === "`") {
			index = skipQuoted(source, index, character) - 1;
			continue;
		}
		if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipComment(source, index) - 1;
			continue;
		}
		if (character === "{") depth += 1;
		else if (character === "}" && --depth === 0) return index;
	}
	return -1;
}
function codeBlockRanges(source) {
	const ranges = [];
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === "\"" || character === "'" || character === "`") {
			index = skipQuoted(source, index, character) - 1;
			continue;
		}
		if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipComment(source, index) - 1;
			continue;
		}
		if (character !== "@" || source[index + 1] !== "{") continue;
		const close = matchingBrace(source, index + 1);
		if (close !== -1) ranges.push({
			start: index,
			open: index + 1,
			close,
			end: close + 1
		});
	}
	return ranges;
}
function bareAtOffsets(source) {
	const offsets = [];
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === "\"" || character === "'" || character === "`") {
			index = skipQuoted(source, index, character) - 1;
			continue;
		}
		if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipComment(source, index) - 1;
			continue;
		}
		if (character !== "@") continue;
		const next = source[index + 1] ?? "";
		if (next !== "{" && !/[A-Za-z0-9_]/u.test(next)) offsets.push(index);
	}
	return offsets;
}
function incompleteConstructRecovery(source, blankExpressionLines = false) {
	const edits = [];
	const expressionLines = [];
	for (const offset of bareAtOffsets(source)) {
		const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
		const newline = source.indexOf("\n", offset);
		const lineEnd = newline === -1 ? source.length : newline;
		const lineBefore = source.slice(lineStart, offset);
		const trimmedBefore = source.slice(Math.max(0, offset - 96), offset).trimEnd();
		let replacement = " ";
		if (/@try\b/u.test(lineBefore)) replacement = "@pending {}";
		else if (/@switch\b/u.test(lineBefore)) replacement = "@default: {}";
		else if ("=+-*/%?:,(".includes(trimmedBefore.at(-1) ?? "")) {
			replacement = "0";
			expressionLines.push({
				start: lineStart,
				end: lineEnd
			});
		}
		edits.push({
			start: offset,
			end: offset + 1,
			replacement
		});
	}
	const recovery = createRecoverySource(source);
	if (blankExpressionLines && expressionLines.length > 0) {
		const merged = [];
		for (const line of expressionLines) if (!merged.some((candidate) => candidate.start === line.start && candidate.end === line.end)) merged.push(line);
		const retained = edits.filter((edit) => !merged.some((line) => line.start <= edit.start && edit.end <= line.end));
		retained.push(...merged.map((line) => ({
			...line,
			replacement: " ".repeat(line.end - line.start)
		})));
		applyRecoveryEdits(recovery, retained);
	} else applyRecoveryEdits(recovery, edits);
	blankStandaloneEmptyCodeBlocks(recovery);
	return {
		recovery,
		expressionLines
	};
}
function blankStandaloneEmptyCodeBlocks(recovery) {
	const ranges = codeBlockRanges(recovery.text);
	const edits = [];
	for (const range of ranges) {
		if (recovery.text.slice(range.open + 1, range.close).trim() !== "") continue;
		const nested = ranges.some((candidate) => candidate.start < range.start && range.end < candidate.end);
		const lineStart = recovery.text.lastIndexOf("\n", range.start - 1) + 1;
		const linePrefix = recovery.text.slice(lineStart, range.start).trim();
		if (!nested && linePrefix !== "") continue;
		edits.push({
			start: range.start,
			end: range.end,
			replacement: " ".repeat(range.end - range.start)
		});
	}
	applyRecoveryEdits(recovery, edits);
}
function outerCodeBlocks(ranges) {
	return ranges.filter((range) => !ranges.some((candidate) => candidate.start < range.start && range.end < candidate.end));
}
function nestingAt(source, start, end) {
	let braces = 0;
	let parentheses = 0;
	let brackets = 0;
	for (let index = start; index < end; index += 1) {
		const character = source[index];
		if (character === "\"" || character === "'" || character === "`") {
			index = skipQuoted(source, index, character) - 1;
			continue;
		}
		if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipComment(source, index) - 1;
			continue;
		}
		if (character === "{") braces += 1;
		else if (character === "}") braces = Math.max(0, braces - 1);
		else if (character === "(") parentheses += 1;
		else if (character === ")") parentheses = Math.max(0, parentheses - 1);
		else if (character === "[") brackets += 1;
		else if (character === "]") brackets = Math.max(0, brackets - 1);
	}
	return {
		braces,
		parentheses,
		brackets
	};
}
function firstRenderStart(source, block, limit = block.close) {
	let braces = 0;
	let parentheses = 0;
	let brackets = 0;
	for (let index = block.open + 1; index < limit; index += 1) {
		const character = source[index];
		if (character === "\"" || character === "'" || character === "`") {
			index = skipQuoted(source, index, character) - 1;
			continue;
		}
		if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
			index = skipComment(source, index) - 1;
			continue;
		}
		if (character === "{") {
			braces += 1;
			continue;
		}
		if (character === "}") {
			braces = Math.max(0, braces - 1);
			continue;
		}
		if (character === "(") {
			parentheses += 1;
			continue;
		}
		if (character === ")") {
			parentheses = Math.max(0, parentheses - 1);
			continue;
		}
		if (character === "[") {
			brackets += 1;
			continue;
		}
		if (character === "]") {
			brackets = Math.max(0, brackets - 1);
			continue;
		}
		if (braces !== 0 || parentheses !== 0 || brackets !== 0) continue;
		if ([
			"@if",
			"@for",
			"@switch",
			"@try"
		].some((token) => source.startsWith(token, index))) return index;
		if (character !== "<" || !/[A-Za-z>{/]/u.test(source[index + 1] ?? "")) continue;
		let previous = index - 1;
		while (previous > block.open && /\s/u.test(source[previous])) previous -= 1;
		if (previous === block.open || ";{}".includes(source[previous])) return index;
	}
	return -1;
}
function isolateCompletionCandidate(recovery) {
	const placeholder = recovery.text.indexOf(COMPLETION_PLACEHOLDER);
	if (placeholder === -1) return;
	const ranges = outerCodeBlocks(codeBlockRanges(recovery.text));
	const target = ranges.find((range) => range.start < placeholder && placeholder < range.end);
	const edits = [];
	for (const range of ranges) {
		if (range === target) continue;
		edits.push({
			start: range.open + 1,
			end: range.close,
			replacement: " ".repeat(range.close - range.open - 1)
		});
	}
	if (target !== void 0) {
		const placeholderEnd = placeholder + 15;
		const lineStart = recovery.text.lastIndexOf("\n", placeholder - 1) + 1;
		const newline = recovery.text.indexOf("\n", placeholderEnd);
		const lineEnd = newline === -1 ? recovery.text.length : newline;
		const linePrefix = recovery.text.slice(lineStart, placeholder);
		if (/\b(?:const|let|var|return)\b/u.test(linePrefix) || "=+-*/%?:,(".includes(linePrefix.trimEnd().at(-1) ?? "")) {
			edits.push({
				start: target.open + 1,
				end: lineStart,
				replacement: " ".repeat(Math.max(0, lineStart - target.open - 1))
			});
			edits.push({
				start: lineEnd,
				end: target.close,
				replacement: " ".repeat(Math.max(0, target.close - lineEnd))
			});
		} else {
			const nesting = nestingAt(recovery.text, target.open + 1, placeholder);
			if (nesting.braces === 0 && nesting.parentheses === 0 && nesting.brackets === 0) edits.push({
				start: placeholderEnd,
				end: target.close,
				replacement: " ".repeat(target.close - placeholderEnd)
			});
			else {
				const switchStart = recovery.text.lastIndexOf("@switch", placeholder);
				if (switchStart > target.open) {
					const switchOpen = recovery.text.indexOf("{", switchStart + 7);
					const switchClose = switchOpen === -1 ? -1 : matchingBrace(recovery.text, switchOpen);
					if (switchOpen < placeholder && placeholder < switchClose) edits.push({
						start: switchClose + 1,
						end: target.close,
						replacement: " ".repeat(target.close - switchClose - 1)
					});
				}
			}
		}
	}
	applyRecoveryEdits(recovery, edits);
	blankStandaloneEmptyCodeBlocks(recovery);
}
function forwardOffset(offset, edits) {
	let delta = 0;
	for (const edit of edits) if (edit.start < offset) delta += edit.replacement.length - (edit.end - edit.start);
	return offset + delta;
}
function wrapRenderBlocks(recovery) {
	const ranges = outerCodeBlocks(codeBlockRanges(recovery.text));
	const wrappers = [];
	const edits = [];
	for (const block of ranges) {
		const first = firstRenderStart(recovery.text, block);
		if (first === -1) continue;
		const placeholder = recovery.text.indexOf(COMPLETION_PLACEHOLDER, first);
		if (placeholder !== -1 && placeholder < block.close) {
			const nesting = nestingAt(recovery.text, block.open + 1, placeholder);
			let previous = placeholder - 1;
			while (previous > block.open && /\s/u.test(recovery.text[previous])) previous -= 1;
			if (nesting.braces === 0 && nesting.parentheses === 0 && nesting.brackets === 0 && recovery.text[previous] !== "{") {
				edits.push({
					start: placeholder,
					end: placeholder,
					replacement: "{"
				});
				edits.push({
					start: placeholder + 15,
					end: placeholder + 15,
					replacement: "}"
				});
			}
		}
		edits.push({
			start: first,
			end: first,
			replacement: "<>"
		});
		edits.push({
			start: block.close,
			end: block.close,
			replacement: "</>"
		});
		wrappers.push({
			first,
			close: block.close
		});
	}
	if (wrappers.length === 0) return [];
	const fragments = wrappers.map((wrapper) => ({
		start: forwardOffset(wrapper.first, edits),
		end: forwardOffset(wrapper.close, edits) + 3
	}));
	applyRecoveryEdits(recovery, edits);
	return fragments;
}
function isRecoveryLayoutText(node) {
	if (node?.type !== "JSXText" || typeof node.value !== "string") return false;
	return node.value.replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//gu, "").trim() === "";
}
function placeholderStatement(node) {
	if (node?.type !== "JSXExpressionContainer" || node.expression?.type !== "Identifier" || node.expression.name !== COMPLETION_PLACEHOLDER) return null;
	return {
		type: "ExpressionStatement",
		start: node.start,
		end: node.end,
		expression: node.expression
	};
}
function flattenSyntheticFragments(program, fragments) {
	const expected = new Set(fragments.map((fragment) => `${fragment.start}:${fragment.end}`));
	const seen = /* @__PURE__ */ new WeakSet();
	const stack = [program];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === null || typeof node !== "object" || seen.has(node)) continue;
		seen.add(node);
		if (node.type === "JSXCodeBlock" && node.render?.type === "JSXFragment" && expected.has(`${node.render.start}:${node.render.end}`)) {
			const converted = (node.render.children ?? []).filter((child) => !isRecoveryLayoutText(child)).map((child) => placeholderStatement(child) ?? child);
			const last = converted.at(-1);
			if (last?.type === "ExpressionStatement" && last.expression?.name === COMPLETION_PLACEHOLDER) {
				node.body.push(...converted);
				node.render = null;
			} else {
				node.body.push(...converted.slice(0, -1));
				node.render = last ?? null;
			}
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === "parent" || value === null || typeof value !== "object") continue;
			if (Array.isArray(value)) for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
			else stack.push(value);
		}
	}
}
function repairIncompleteElement(program, openingStart) {
	const seen = /* @__PURE__ */ new WeakSet();
	const stack = [program];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === null || typeof node !== "object" || seen.has(node)) continue;
		seen.add(node);
		if (node.type === "JSXElement" && node.openingElement?.start === openingStart) {
			node.closingElement = null;
			node.unclosed = true;
			node.end = node.openingElement.end;
			return true;
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === "parent" || value === null || typeof value !== "object") continue;
			if (Array.isArray(value)) for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
			else stack.push(value);
		}
	}
	return false;
}
function tryIncompleteClosingRecovery(parser, filename, recovery, errors) {
	const diagnostic = errors.find((error) => /^unterminated JSX element starting at byte \d+$/u.test(error?.message));
	if (diagnostic === void 0) return null;
	const match = /byte (?<start>\d+)$/u.exec(diagnostic.message);
	const openingStart = Number(match?.groups?.start);
	if (!Number.isInteger(openingStart)) return null;
	const opening = /^<(?<name>[A-Za-z][\w.:-]*)\b[^>]*>/u.exec(recovery.text.slice(openingStart));
	if (opening?.groups?.name === void 0 || opening[0].endsWith("/>")) return null;
	const block = codeBlockRanges(recovery.text).filter((candidate) => candidate.start < openingStart && openingStart < candidate.close).sort((left, right) => left.end - left.start - (right.end - right.start))[0];
	if (block === void 0) return null;
	replaceRecoveryRange(recovery, block.close, block.close, `</${opening.groups.name}>`);
	const result = parser.parseSync(filename, recovery.text, PARSER_OPTIONS);
	if (result?.program === null || (result?.errors?.length ?? 0) > 0) return null;
	if (!repairIncompleteElement(result.program, openingStart)) return null;
	remapRecoveredTree(result.program, recovery.boundaries);
	if (Array.isArray(result.comments)) remapRecoveredTree(result.comments, recovery.boundaries);
	return result;
}
function normalizeCompletionPlaceholderSiblings(program) {
	const seen = /* @__PURE__ */ new WeakSet();
	const stack = [program];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === null || typeof node !== "object" || seen.has(node)) continue;
		seen.add(node);
		if (Array.isArray(node.children)) for (let index = 0; index < node.children.length; index += 1) {
			if (node.children[index]?.expression?.name !== COMPLETION_PLACEHOLDER) continue;
			while (index > 0 && node.children[index - 1]?.type === "JSXText") {
				const previous = node.children[index - 1];
				if (typeof previous.value !== "string" || previous.value.trim() !== "") break;
				node.children.splice(index - 1, 1);
				index -= 1;
			}
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === "parent" || value === null || typeof value !== "object") continue;
			if (Array.isArray(value)) for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
			else stack.push(value);
		}
	}
}
function parseLooseCandidate(parser, filename, recovery) {
	let result;
	try {
		result = parser.parseSync(filename, recovery.text, PARSER_OPTIONS);
	} catch (error) {
		if (!isRecoverableLooseShapeFailure(error)) throw error;
		return {
			result: null,
			program: null,
			errors: [{ message: error.message }]
		};
	}
	return {
		result,
		program: result?.program ?? null,
		errors: result?.errors ?? []
	};
}
function recoveredResult(result, recovery, fragments = []) {
	if (fragments.length > 0) flattenSyntheticFragments(result.program, fragments);
	remapRecoveredTree(result.program, recovery.boundaries);
	if (Array.isArray(result.comments)) remapRecoveredTree(result.comments, recovery.boundaries);
	if (result.program !== null) normalizeCompletionPlaceholderSiblings(result.program);
	return result;
}
function looseRecovery(parser, filename, source) {
	const prepared = incompleteConstructRecovery(source, false);
	const variants = [{
		recovery: prepared.recovery,
		allowRenderWrapping: prepared.expressionLines.length === 0
	}];
	if (prepared.expressionLines.length > 0) variants.push({
		recovery: incompleteConstructRecovery(source, true).recovery,
		allowRenderWrapping: true
	});
	for (const { recovery, allowRenderWrapping } of variants) {
		isolateCompletionCandidate(recovery);
		let parsed = parseLooseCandidate(parser, filename, recovery);
		if (parsed.program !== null && parsed.errors.length === 0) return recoveredResult(parsed.result, recovery);
		const closing = tryIncompleteClosingRecovery(parser, filename, recovery, parsed.errors);
		if (closing !== null) return closing;
		if (!allowRenderWrapping || !parsed.errors.some((error) => LOOSE_RENDER_ERRORS.has(error?.message))) continue;
		const fragments = wrapRenderBlocks(recovery);
		if (fragments.length === 0) continue;
		parsed = parseLooseCandidate(parser, filename, recovery);
		if (parsed.program !== null && parsed.errors.length === 0) return recoveredResult(parsed.result, recovery, fragments);
	}
	return null;
}
function findSubmoduleSources(source) {
	const candidates = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index];
		if (character === "\"" || character === "'" || character === "`") {
			index = skipQuoted(source, index, character);
			continue;
		}
		if (character === "/" && source[index + 1] === "/") {
			const newline = source.indexOf("\n", index + 2);
			index = newline === -1 ? source.length : newline + 1;
			continue;
		}
		if (character === "/" && source[index + 1] === "*") {
			const close = source.indexOf("*/", index + 2);
			index = close === -1 ? source.length : close + 2;
			continue;
		}
		const identifier = readIdentifier(source, index);
		if (identifier === null) {
			index += codePointAt(source, index).width || 1;
			continue;
		}
		index = identifier.end;
		if (identifier.name !== "from") continue;
		const replaceStart = index;
		while (index < source.length && WHITESPACE.test(source[index])) index += 1;
		if (index === replaceStart) continue;
		const moduleSource = readIdentifier(source, index);
		if (moduleSource === null) continue;
		candidates.push({
			replaceStart,
			replaceEnd: moduleSource.end,
			name: moduleSource.name,
			start: moduleSource.start,
			end: moduleSource.end
		});
		index = moduleSource.end;
	}
	return candidates;
}
function submoduleRecovery(source, errors) {
	if (typeof source !== "string") return null;
	const unexpectedStarts = /* @__PURE__ */ new Set();
	for (const error of errors) {
		if (error?.message !== "Unexpected token" || !Array.isArray(error?.labels)) continue;
		for (const label of error.labels) if (Number.isInteger(label?.start)) unexpectedStarts.add(label.start);
	}
	if (unexpectedStarts.size === 0) return null;
	const candidates = findSubmoduleSources(source);
	if (!candidates.some((candidate) => unexpectedStarts.has(candidate.start))) return null;
	let rewritten = source;
	for (let index = candidates.length - 1; index >= 0; index -= 1) {
		const candidate = candidates[index];
		const length = candidate.replaceEnd - candidate.replaceStart;
		const placeholder = `"${" ".repeat(length - 2)}"`;
		rewritten = rewritten.slice(0, candidate.replaceStart) + placeholder + rewritten.slice(candidate.replaceEnd);
	}
	return {
		source: rewritten,
		candidates
	};
}
function restoreSubmoduleSources(program, candidates) {
	const replacements = new Map(candidates.map((candidate) => [`${candidate.replaceStart}:${candidate.replaceEnd}`, candidate]));
	const seen = /* @__PURE__ */ new WeakSet();
	const stack = [program];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === null || typeof node !== "object" || seen.has(node)) continue;
		seen.add(node);
		if (SOURCE_DECLARATION_TYPES.has(node.type) && node.source !== null) {
			const replacement = replacements.get(`${node.source?.start}:${node.source?.end}`);
			if (replacement !== void 0) node.source = {
				type: "Identifier",
				name: replacement.name,
				start: replacement.start,
				end: replacement.end
			};
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === "parent" || value === null || typeof value !== "object") continue;
			if (Array.isArray(value)) for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
			else stack.push(value);
		}
	}
}
function compatibleComment(comment, positionAt) {
	return {
		...comment,
		loc: comment?.loc ?? {
			start: positionAt(comment?.start),
			end: positionAt(comment?.end)
		},
		context: comment?.context ?? null
	};
}
function keywordSpan(source, keyword, start, end, positionAt) {
	const offset = source.indexOf(keyword, Math.max(0, start));
	if (offset === -1 || offset + keyword.length > end) return null;
	return {
		start: offset,
		end: offset + keyword.length,
		loc: {
			start: positionAt(offset),
			end: positionAt(offset + keyword.length)
		}
	};
}
function unwrapParenthesizedExpression(value) {
	let expression = value;
	let parenthesized = false;
	while (expression?.type === "ParenthesizedExpression") {
		expression = expression.expression;
		parenthesized = true;
	}
	if (parenthesized && expression !== null && typeof expression === "object") {
		expression.metadata ??= { path: [] };
		expression.metadata.path ??= [];
		expression.metadata.parenthesized = true;
	}
	return expression;
}
function splitTextComments(element) {
	if (!Array.isArray(element.children)) return;
	const children = [];
	for (const child of element.children) {
		const text = child?.type === "JSXText" && typeof child.raw === "string" ? child.raw : "";
		const piece = (start, end) => {
			const value = text.slice(start, end);
			return {
				type: "JSXText",
				start: child.start + start,
				end: child.start + end,
				value,
				raw: value
			};
		};
		let copied = 0;
		for (let index = text.indexOf("/"); index !== -1; index = text.indexOf("/", index + 1)) {
			let end;
			if (text[index + 1] === "*") {
				end = text.indexOf("*/", index + 2);
				end = end === -1 ? text.length : end + 2;
			} else if (text[index + 1] === "/" && (index === 0 || /[ \t\r\n]/u.test(text[index - 1]))) end = index + text.slice(index).search(/[\r\n]|$/u);
			else continue;
			if (index > copied) children.push(piece(copied, index));
			const span = {
				start: child.start + index,
				end: child.start + end
			};
			const expression = {
				type: "JSXEmptyExpression",
				...span
			};
			children.push({
				type: "JSXExpressionContainer",
				...span,
				expression
			});
			copied = end;
			index = end - 1;
		}
		if (copied === 0) children.push(child);
		else if (copied < text.length) children.push(piece(copied, text.length));
	}
	element.children = children;
}
function stampTemplateBlock(value) {
	if (value?.type !== "BlockStatement") return;
	value.metadata ??= { path: [] };
	value.metadata.path ??= [];
	value.metadata.native_tsrx_template_block = true;
	value.metadata.templateMode = "script";
	value.metadata.allows_native_return = false;
}
function materializeDirectiveBlockMetadata(value) {
	if (value.type === "JSXIfExpression") {
		stampTemplateBlock(value.consequent);
		stampTemplateBlock(value.alternate);
	} else if (value.type === "JSXForExpression") {
		stampTemplateBlock(value.body);
		stampTemplateBlock(value.empty);
	} else if (value.type === "JSXTryExpression") {
		stampTemplateBlock(value.block);
		stampTemplateBlock(value.pending);
		stampTemplateBlock(value.handler);
		stampTemplateBlock(value.handler?.body);
	} else if (value.type === "JSXSwitchExpression") for (const switchCase of value.cases ?? []) for (let index = 0; index < (switchCase?.consequent?.length ?? 0); index += 1) {
		const statement = switchCase.consequent[index];
		if (statement?.type === "BlockStatement" && statement.body?.length === 1 && statement.body[0]?.type === "ExpressionStatement") switchCase.consequent[index] = {
			type: "JSXExpressionContainer",
			start: statement.start,
			end: statement.end,
			expression: statement.body[0].expression
		};
		else stampTemplateBlock(statement);
	}
}
function materializeDirectiveRange(value, positionAt) {
	let finalBranch;
	if (value.type === "JSXIfExpression") finalBranch = value.alternate ?? value.consequent;
	else if (value.type === "JSXForExpression") finalBranch = value.empty ?? value.body;
	else if (value.type === "JSXTryExpression") finalBranch = value.handler ?? value.pending ?? value.block;
	else if (value.type === "JSXSwitchExpression") finalBranch = value.cases?.at(-1);
	if (!Number.isInteger(finalBranch?.end) || finalBranch.end <= value.end) return;
	value.end = finalBranch.end;
	if (value.loc?.end != null) value.loc.end = positionAt(value.end);
}
function omitTsrxCoreCompatDefault(type, key, value) {
	if (Array.isArray(value) && value.length === 0 && (key === "decorators" || key === "attributes" && (type === "ExportAllDeclaration" || type === "ExportNamedDeclaration" || type === "ImportDeclaration") || key === "implements" && (type === "ClassDeclaration" || type === "ClassExpression") || key === "extends" && type === "TSInterfaceDeclaration")) return true;
	if (value == null && (key === "accessibility" || key === "directive" || key === "hashbang" || key === "options" || key === "phase" || key === "returnType" || key === "superTypeArguments" || key === "typeAnnotation" || key === "typeArguments" || key === "typeParameters" || type === "RestElement" && key === "value")) return true;
	if (value !== false) return false;
	if (key === "abstract" || key === "const" || key === "declare" || key === "definite" || key === "global" || key === "in" || key === "out" || key === "override" || key === "readonly" || key === "static") return true;
	return key === "optional" && (type === "ArrayPattern" || type === "AssignmentPattern" || type === "Identifier" || type === "MethodDefinition" || type === "ObjectPattern" || type === "Property" || type === "PropertyDefinition" || type === "RestElement" || type === "TSMethodSignature" || type === "TSPropertySignature");
}
function stripOxcDefaultFields(value) {
	for (const key in value) if (omitTsrxCoreCompatDefault(value.type, key, value[key])) delete value[key];
}
function materializeCompatibilityProgram(program, source, filename, loose, positionAt, ordinaryJsx) {
	if (typeof source !== "string") return;
	const defaultsStripped = program[TSRX_CORE_COMPAT_DEFAULTS_STRIPPED] === true;
	if (defaultsStripped) delete program[TSRX_CORE_COMPAT_DEFAULTS_STRIPPED];
	const stack = [program];
	const insideHeadStack = [false];
	const templateElements = [];
	while (stack.length > 0) {
		const value = stack.pop();
		const insideHead = insideHeadStack.pop();
		if (value === null || typeof value !== "object") continue;
		if (value.type === "StyleSheet") continue;
		if (value.type === "Program") {
			value.start = 0;
			value.end = source.length;
			value.loc = {
				start: positionAt(0),
				end: positionAt(source.length)
			};
		}
		if (!defaultsStripped) stripOxcDefaultFields(value);
		if (Number.isInteger(value.start) && Number.isInteger(value.end) && value.loc == null) value.loc = {
			start: positionAt(value.start),
			end: positionAt(value.end)
		};
		if (value.type === "JSXElement" || value.type === "JSXFragment" || value.type === "JSXStyleElement") {
			value.metadata ??= { path: [] };
			value.metadata.path ??= [];
			value.metadata.native_tsrx = true;
			const elementName = value.openingElement?.name?.name;
			value.metadata.templateMode = value.type === "JSXStyleElement" || elementName === "script" || value.openingElement?.selfClosing === true ? "script" : "template";
			templateElements.push(value);
			if (ordinaryJsx) splitTextComments(value);
		}
		const comment = value.type === "JSXEmptyExpression" && source.slice(value.start, value.end);
		if (comment && /^(\/\/[^\r\n]*|\/\*(?:(?!\*\/)[\s\S])*\*\/)$/u.test(comment)) {
			const type = comment[1] === "/" ? "Line" : "Block";
			const text = comment.slice(2, type === "Line" ? void 0 : -2);
			const { start, end, loc } = value;
			value.innerComments = [{
				type,
				value: text,
				start,
				end,
				loc
			}];
		}
		if (value.type === "TSModuleDeclaration") {
			value.metadata ??= { path: [] };
			value.metadata.path ??= [];
			value.metadata.module_keyword = value.kind;
		}
		materializeDirectiveBlockMetadata(value);
		materializeDirectiveRange(value, positionAt);
		if ((value.type === "JSXIfExpression" || value.type === "IfStatement") && value.alternate != null && value.alternateKeyword == null) value.alternateKeyword = keywordSpan(source, "@else", value.consequent?.end ?? value.start, value.alternate?.end ?? value.end, positionAt);
		else if (value.type === "JSXForExpression" && value.empty != null && value.emptyKeyword == null) value.emptyKeyword = keywordSpan(source, "@empty", value.body?.end ?? value.start, value.empty?.end ?? value.end, positionAt);
		else if (value.type === "SwitchCase" && value.keyword == null) value.keyword = keywordSpan(source, value.test == null ? "@default" : "@case", value.start, value.end, positionAt);
		else if (value.type === "JSXTryExpression") {
			if (value.pending != null && value.pendingKeyword == null) value.pendingKeyword = keywordSpan(source, "@pending", value.block?.end ?? value.start, value.pending?.end ?? value.end, positionAt);
			if (value.handler != null && value.handlerKeyword == null) value.handlerKeyword = keywordSpan(source, "@catch", value.pending?.end ?? value.block?.end ?? value.start, value.handler?.end ?? value.end, positionAt);
		}
		if (value.type === "JSXStyleElement" && typeof value.css === "string" && value.openingElement?.selfClosing !== true) {
			const style = parse_style(value.css, {
				filename,
				line: value.openingElement?.loc?.start?.line ?? value.loc?.start?.line ?? 1,
				column: value.openingElement?.loc?.start?.column ?? value.loc?.start?.column ?? 0
			}, { loose });
			value.children = [style];
			if (!insideHead) {
				value.metadata ??= { path: [] };
				value.metadata.styleScopeHash = style.hash;
			}
		}
		const elementName = value.openingElement?.name?.name;
		const childInsideHead = insideHead || value.type === "JSXElement" && elementName === "head";
		for (const key in value) {
			let child = value[key];
			if (key === "parent" || key === "loc" || key === "metadata" || key.endsWith("Keyword") || child === null || typeof child !== "object") continue;
			if (Array.isArray(child)) for (let index = child.length - 1; index >= 0; index -= 1) {
				const unwrapped = unwrapParenthesizedExpression(child[index]);
				if (unwrapped !== child[index]) child[index] = unwrapped;
				stack.push(unwrapped);
				insideHeadStack.push(childInsideHead);
			}
			else {
				const unwrapped = unwrapParenthesizedExpression(child);
				if (unwrapped !== child) {
					value[key] = unwrapped;
					child = unwrapped;
				}
				stack.push(child);
				insideHeadStack.push(childInsideHead);
			}
		}
	}
	templateElements.sort((left, right) => left.start - right.start || right.end - left.end);
	for (let index = 0; index < templateElements.length; index += 1) templateElements[index].metadata.commentContainerId = index + 1;
}
function missingProgramError(filename) {
	const error = /* @__PURE__ */ new SyntaxError(`@tsrx/oxc/parser did not return a Program for ${filename}`);
	error.code = void 0;
	error.pos = void 0;
	error.raisedAt = void 0;
	error.end = void 0;
	error.loc = void 0;
	error.fileName = filename;
	error.type = "fatal";
	return error;
}
function addBindingNames(pattern, bindings) {
	if (pattern === null || typeof pattern !== "object") return;
	switch (pattern.type) {
		case "Identifier":
			bindings.add(pattern.name);
			break;
		case "RestElement":
			addBindingNames(pattern.argument, bindings);
			break;
		case "AssignmentPattern":
			addBindingNames(pattern.left, bindings);
			break;
		case "ArrayPattern":
			for (const element of pattern.elements ?? []) addBindingNames(element, bindings);
			break;
		case "ObjectPattern":
			for (const property of pattern.properties ?? []) addBindingNames(property?.type === "RestElement" ? property.argument : property?.value, bindings);
			break;
		case "TSParameterProperty": addBindingNames(pattern.parameter, bindings);
	}
}
function addDeclarationBindings(declaration, bindings) {
	if (declaration === null || typeof declaration !== "object") return;
	switch (declaration.type) {
		case "VariableDeclaration":
			for (const declarator of declaration.declarations ?? []) addBindingNames(declarator?.id, bindings);
			break;
		case "FunctionDeclaration":
		case "ClassDeclaration":
		case "TSDeclareFunction":
		case "TSEnumDeclaration":
		case "TSInterfaceDeclaration":
		case "TSModuleDeclaration":
		case "TSTypeAliasDeclaration":
		case "TSImportEqualsDeclaration": addBindingNames(declaration.id, bindings);
	}
}
function undefinedLocalExportDiagnostics(program) {
	if (!Array.isArray(program?.body)) return [];
	const bindings = /* @__PURE__ */ new Set();
	for (const statement of program.body) {
		if (statement?.type === "ImportDeclaration") {
			for (const specifier of statement.specifiers ?? []) addBindingNames(specifier?.local, bindings);
			continue;
		}
		if (statement?.type === "ExportNamedDeclaration" || statement?.type === "ExportDefaultDeclaration") {
			addDeclarationBindings(statement.declaration, bindings);
			continue;
		}
		addDeclarationBindings(statement, bindings);
	}
	const diagnostics = [];
	for (const statement of program.body) {
		if (statement?.type !== "ExportNamedDeclaration" || statement.declaration != null || statement.source != null) continue;
		for (const specifier of statement.specifiers ?? []) {
			const local = specifier?.local;
			const name = local?.name ?? local?.value;
			if (typeof name !== "string" || bindings.has(name)) continue;
			diagnostics.push({
				severity: "Error",
				message: `Export '${name}' is not defined`,
				labels: [{
					start: Number.isInteger(local?.start) ? local.start : statement.start,
					end: Number.isInteger(local?.end) ? local.end : statement.end,
					message: ""
				}],
				helpMessage: null,
				codeframe: null
			});
		}
	}
	return diagnostics;
}
const SCOPE_TOP = 1;
const SCOPE_FUNCTION = 2;
const SCOPE_VAR = 4;
const SCOPE_SIMPLE_CATCH = 8;
const BIND_VAR = 1;
const BIND_LEXICAL = 2;
const SCOPE_SKIPPED_KEYS = /* @__PURE__ */ new Set([
	"type",
	"start",
	"end",
	"loc",
	"range",
	"metadata",
	"typeAnnotation",
	"returnType",
	"typeParameters",
	"typeArguments",
	"superTypeArguments",
	"superTypeParameters",
	"implements",
	"leadingComments",
	"trailingComments",
	"innerComments",
	"comments",
	"css",
	"content"
]);
const SCOPE_TS_EXPRESSION_WRAPPERS = /* @__PURE__ */ new Set([
	"TSAsExpression",
	"TSSatisfiesExpression",
	"TSNonNullExpression",
	"TSTypeAssertion",
	"TSInstantiationExpression",
	"TSExportAssignment"
]);
const SCOPE_CHILD_KEYS = /* @__PURE__ */ new Map([
	["Identifier", []],
	["Literal", []],
	["JSXText", []],
	["JSXIdentifier", []],
	["JSXNamespacedName", []],
	["JSXMemberExpression", []],
	["TemplateElement", []],
	["ThisExpression", []],
	["Super", []],
	["PrivateIdentifier", []],
	["JSXEmptyExpression", []],
	["JSXClosingElement", []],
	["JSXOpeningFragment", []],
	["JSXClosingFragment", []],
	["EmptyStatement", []],
	["DebuggerStatement", []],
	["BreakStatement", []],
	["ContinueStatement", []],
	["MetaProperty", []],
	["ExpressionStatement", ["expression"]],
	["ReturnStatement", ["argument"]],
	["ThrowStatement", ["argument"]],
	["IfStatement", [
		"test",
		"consequent",
		"alternate"
	]],
	["WhileStatement", ["test", "body"]],
	["DoWhileStatement", ["body", "test"]],
	["LabeledStatement", ["body"]],
	["CallExpression", ["callee", "arguments"]],
	["NewExpression", ["callee", "arguments"]],
	["MemberExpression", ["object", "property"]],
	["ChainExpression", ["expression"]],
	["ParenthesizedExpression", ["expression"]],
	["SequenceExpression", ["expressions"]],
	["BinaryExpression", ["left", "right"]],
	["LogicalExpression", ["left", "right"]],
	["AssignmentExpression", ["left", "right"]],
	["ConditionalExpression", [
		"test",
		"consequent",
		"alternate"
	]],
	["UnaryExpression", ["argument"]],
	["UpdateExpression", ["argument"]],
	["AwaitExpression", ["argument"]],
	["YieldExpression", ["argument"]],
	["SpreadElement", ["argument"]],
	["ObjectExpression", ["properties"]],
	["ArrayExpression", ["elements"]],
	["Property", ["key", "value"]],
	["TemplateLiteral", ["expressions"]],
	["TaggedTemplateExpression", ["tag", "quasi"]],
	["ImportExpression", ["source", "options"]],
	["JSXElement", ["openingElement", "children"]],
	["JSXFragment", ["children"]],
	["JSXOpeningElement", ["name", "attributes"]],
	["JSXAttribute", ["value"]],
	["JSXExpressionContainer", ["expression"]],
	["JSXSpreadAttribute", ["argument"]],
	["JSXSpreadChild", ["expression"]],
	["JSXIfExpression", [
		"test",
		"consequent",
		"alternate"
	]],
	["MethodDefinition", [
		"decorators",
		"key",
		"value"
	]],
	["PropertyDefinition", [
		"decorators",
		"key",
		"value"
	]],
	["AccessorProperty", [
		"decorators",
		"key",
		"value"
	]],
	["Decorator", ["expression"]],
	["ExportDefaultDeclaration", ["declaration"]],
	["ExportAllDeclaration", []]
]);
const DECLARED_LEXICAL = 1;
const DECLARED_VAR = 2;
const DECLARED_TYPE = 4;
const DECLARED_ENUM = 8;
const DECLARED_EXPORT_ONLY = 16;
function scopeHas(scope, name, kind) {
	return scope.names !== null && ((scope.names.get(name) ?? 0) & kind) !== 0;
}
function scopeAdd(scope, name, kind) {
	scope.names ??= /* @__PURE__ */ new Map();
	scope.names.set(name, (scope.names.get(name) ?? 0) | kind);
}
function scopeDiagnostic(message, start, end, fatal) {
	return {
		severity: "Error",
		message,
		labels: [{
			start,
			end,
			message: ""
		}],
		helpMessage: null,
		codeframe: null,
		compatFatal: fatal
	};
}
function nextTokenEnd(source, offset) {
	let index = offset;
	while (index < source.length && /\s/u.test(source[index])) index += 1;
	return Math.min(index + 1, source.length);
}
function scopeDiagnostics(program, source) {
	if (!Array.isArray(program?.body)) return [];
	const diagnostics = [];
	const scopes = [];
	const undefinedExports = /* @__PURE__ */ new Map();
	const enter = (flags) => {
		scopes.push({
			flags,
			names: null,
			firstLexical: void 0
		});
	};
	const exit = () => {
		scopes.pop();
	};
	const current = () => scopes[scopes.length - 1];
	const redeclared = (name, start) => {
		diagnostics.push(scopeDiagnostic(`Identifier '${name}' has already been declared`, start, start + 1, {
			start,
			end: start + 1
		}));
	};
	const pushLexical = (scope, name) => {
		scope.firstLexical ??= name;
		scopeAdd(scope, name, DECLARED_LEXICAL);
	};
	const declareName = (name, binding, start) => {
		const scope = current();
		if (binding === BIND_LEXICAL) {
			if (scopeHas(scope, name, 3)) redeclared(name, start);
			pushLexical(scope, name);
			if (scope.flags & SCOPE_TOP) undefinedExports.delete(name);
			return;
		}
		let reported = false;
		for (let index = scopes.length - 1; index >= 0; index -= 1) {
			const candidate = scopes[index];
			if (!reported && scopeHas(candidate, name, DECLARED_LEXICAL) && !(candidate.flags & SCOPE_SIMPLE_CATCH && candidate.firstLexical === name)) {
				redeclared(name, start);
				reported = true;
			}
			scopeAdd(candidate, name, DECLARED_VAR);
			if (candidate.flags & SCOPE_TOP) undefinedExports.delete(name);
			if (candidate.flags & SCOPE_VAR) break;
		}
	};
	const patternIdentifiers = (pattern, out) => {
		if (pattern === null || typeof pattern !== "object") return out;
		switch (pattern.type) {
			case "Identifier":
				out.push(pattern);
				break;
			case "RestElement":
				patternIdentifiers(pattern.argument, out);
				break;
			case "AssignmentPattern":
				patternIdentifiers(pattern.left, out);
				break;
			case "ArrayPattern":
				for (const element of pattern.elements ?? []) patternIdentifiers(element, out);
				break;
			case "ObjectPattern":
				for (const property of pattern.properties ?? []) patternIdentifiers(property?.type === "RestElement" ? property.argument : property?.value, out);
				break;
			case "TSParameterProperty": patternIdentifiers(pattern.parameter, out);
		}
		return out;
	};
	const patternExpressions = (pattern, out) => {
		if (pattern === null || typeof pattern !== "object") return out;
		switch (pattern.type) {
			case "Identifier":
				out.push(pattern.decorators);
				break;
			case "RestElement":
				patternExpressions(pattern.argument, out);
				break;
			case "AssignmentPattern":
				patternExpressions(pattern.left, out);
				out.push(pattern.right);
				break;
			case "ArrayPattern":
				for (const element of pattern.elements ?? []) patternExpressions(element, out);
				break;
			case "ObjectPattern":
				for (const property of pattern.properties ?? []) if (property?.type === "RestElement") patternExpressions(property.argument, out);
				else {
					if (property?.computed) out.push(property.key);
					patternExpressions(property?.value, out);
				}
				break;
			case "TSParameterProperty":
				out.push(pattern.decorators);
				patternExpressions(pattern.parameter, out);
				break;
			default: out.push(pattern);
		}
		return out;
	};
	const declareIdentifiers = (pattern, binding) => {
		for (const identifier of patternIdentifiers(pattern, [])) declareName(identifier.name, binding, identifier.start);
	};
	const declarePattern = (pattern, binding, out) => {
		patternExpressions(pattern, out);
		out.push(() => declareIdentifiers(pattern, binding));
	};
	const checkParams = (params) => {
		const first = /* @__PURE__ */ new Map();
		const reported = /* @__PURE__ */ new Set();
		for (const param of params ?? []) for (const identifier of patternIdentifiers(param, [])) {
			const { name, start } = identifier;
			if (name === "this") continue;
			if (first.has(name)) {
				if (!reported.has(name)) {
					const firstStart = first.get(name);
					diagnostics.push(scopeDiagnostic("Argument name clash", firstStart, firstStart + name.length, null));
					reported.add(name);
				}
				const end = Number.isInteger(identifier.end) ? identifier.end : start + name.length;
				diagnostics.push(scopeDiagnostic("Argument name clash", start, end, {
					start,
					end: start + 1
				}));
				continue;
			}
			first.set(name, start);
			declareName(name, BIND_VAR, start);
		}
	};
	const declareTopLevelName = (scope, name, kind) => {
		scopeAdd(scope, name, kind);
		if (scope.flags & SCOPE_TOP) undefinedExports.delete(name);
	};
	const scopeDeclares = (scope, name) => scopeHas(scope, name, 23);
	const tasks = [];
	const enterBlock = () => enter(0);
	const enterVarScope = () => enter(SCOPE_VAR);
	const enterFunction = () => enter(6);
	const enterSimpleCatch = () => enter(SCOPE_SIMPLE_CATCH);
	const schedule = (sequence) => {
		for (let index = sequence.length - 1; index >= 0; index -= 1) {
			const task = sequence[index];
			if (task !== null && (typeof task === "object" || typeof task === "function")) tasks.push(task);
		}
	};
	const bodyStatements = (body) => body?.type === "BlockStatement" ? body.body : body;
	const visitFunction = (node, declaration) => {
		const outer = current();
		const body = node.body;
		const sequence = [enterFunction];
		for (const param of node.params ?? []) patternExpressions(param, sequence);
		if (body?.type === "JSXCodeBlock") sequence.push(body, () => checkParams(node.params));
		else if (body != null) sequence.push(() => checkParams(node.params), bodyStatements(body));
		sequence.push(exit);
		if (declaration && node.id?.type === "Identifier") {
			const id = node.id;
			sequence.push(() => {
				if (body != null) declareName(id.name, outer.flags & SCOPE_FUNCTION ? BIND_VAR : BIND_LEXICAL, id.start);
				else if (node.declare && outer.flags & SCOPE_TOP) {
					scopeAdd(outer, id.name, DECLARED_EXPORT_ONLY);
					undefinedExports.delete(id.name);
				}
			});
		}
		schedule(sequence);
	};
	const visitClass = (node, declaration) => {
		const sequence = [node.decorators];
		if (declaration && node.id?.type === "Identifier") {
			const id = node.id;
			sequence.push(() => declareName(id.name, BIND_LEXICAL, id.start));
		}
		sequence.push(node.superClass);
		for (const member of node.body?.body ?? []) if (member?.type === "StaticBlock") sequence.push(enterVarScope, member.body, exit);
		else sequence.push(member);
		schedule(sequence);
	};
	const visitCatch = (clause) => {
		const param = clause.param;
		const sequence = [];
		if (param?.type === "Identifier") sequence.push(enterSimpleCatch, () => pushLexical(current(), param.name));
		else {
			sequence.push(enterBlock);
			if (param != null) declarePattern(param, BIND_LEXICAL, sequence);
		}
		if (clause.resetParam != null) declarePattern(clause.resetParam, BIND_LEXICAL, sequence);
		sequence.push(bodyStatements(clause.body), exit);
		schedule(sequence);
	};
	const checkLocalExports = (node) => {
		for (const specifier of node.specifiers ?? []) {
			const local = specifier?.local;
			if (local?.type !== "Identifier") continue;
			if (scopes.some((scope) => scopeDeclares(scope, local.name))) undefinedExports.delete(local.name);
			else undefinedExports.set(local.name, local);
		}
	};
	const step = (node) => {
		if (Array.isArray(node)) {
			for (let index = node.length - 1; index >= 0; index -= 1) {
				const child = node[index];
				if (child !== null && typeof child === "object") tasks.push(child);
			}
			return;
		}
		const childKeys = SCOPE_CHILD_KEYS.get(node.type);
		if (childKeys !== void 0) {
			for (let index = childKeys.length - 1; index >= 0; index -= 1) {
				const child = node[childKeys[index]];
				if (child !== null && typeof child === "object") tasks.push(child);
			}
			return;
		}
		switch (node.type) {
			case "VariableDeclaration": {
				const binding = node.kind === "var" ? BIND_VAR : BIND_LEXICAL;
				const sequence = [];
				for (const declarator of node.declarations ?? []) {
					declarePattern(declarator?.id, binding, sequence);
					sequence.push(declarator?.init);
				}
				schedule(sequence);
				return;
			}
			case "FunctionDeclaration":
			case "TSDeclareFunction":
				visitFunction(node, true);
				return;
			case "FunctionExpression":
			case "ArrowFunctionExpression":
			case "TSEmptyBodyFunctionExpression":
				visitFunction(node, false);
				return;
			case "ClassDeclaration":
				visitClass(node, true);
				return;
			case "ClassExpression":
				visitClass(node, false);
				return;
			case "BlockStatement":
				schedule([
					enterBlock,
					node.body,
					exit
				]);
				return;
			case "StaticBlock":
				schedule([
					enterVarScope,
					node.body,
					exit
				]);
				return;
			case "CatchClause":
				visitCatch(node);
				return;
			case "TryStatement":
			case "JSXTryExpression":
				schedule([
					node.block,
					node.pending,
					node.handler,
					node.finalizer
				]);
				return;
			case "ForStatement":
				schedule([
					enterBlock,
					node.init,
					node.test,
					node.update,
					node.body,
					exit
				]);
				return;
			case "ForInStatement":
			case "ForOfStatement":
			case "JSXForExpression":
				schedule([
					enterBlock,
					node.left,
					node.right,
					node.index,
					node.key,
					node.body,
					exit,
					node.empty
				]);
				return;
			case "SwitchStatement": {
				const sequence = [node.discriminant, enterBlock];
				for (const clause of node.cases ?? []) sequence.push(clause?.test, clause?.consequent);
				sequence.push(exit);
				schedule(sequence);
				return;
			}
			case "JSXSwitchExpression": {
				const sequence = [node.discriminant, enterBlock];
				for (const clause of node.cases ?? []) sequence.push(clause?.test, enterBlock, clause?.consequent, exit);
				sequence.push(exit);
				schedule(sequence);
				return;
			}
			case "JSXCodeBlock":
				schedule([
					enterBlock,
					node.body,
					node.render,
					exit
				]);
				return;
			case "ImportDeclaration":
				for (const specifier of node.specifiers ?? []) {
					const local = specifier?.local;
					if (local?.type === "Identifier") declareName(local.name, BIND_LEXICAL, local.start);
				}
				return;
			case "TSImportEqualsDeclaration":
				if (node.id?.type === "Identifier") declareName(node.id.name, BIND_LEXICAL, node.id.start);
				return;
			case "ExportNamedDeclaration":
				if (node.source == null && current().flags & SCOPE_TOP) schedule([node.declaration, () => checkLocalExports(node)]);
				else schedule([node.declaration]);
				return;
			case "TSEnumDeclaration": {
				const scope = current();
				const name = node.id?.name;
				if (typeof name !== "string" || scopeHas(scope, name, DECLARED_ENUM)) return;
				declareName(name, BIND_LEXICAL, node.id.start);
				scopeAdd(scope, name, DECLARED_ENUM);
				return;
			}
			case "TSInterfaceDeclaration":
				if (node.id?.type === "Identifier") declareTopLevelName(current(), node.id.name, DECLARED_TYPE);
				return;
			case "TSTypeAliasDeclaration": {
				const scope = current();
				const id = node.id;
				if (id?.type !== "Identifier") return;
				if (scopeHas(scope, id.name, DECLARED_TYPE)) diagnostics.push(scopeDiagnostic(`type '${id.name}' has already been declared.`, id.start, id.start + 1, {
					start: id.start,
					raisedAt: nextTokenEnd(source, id.end),
					raise: true
				}));
				declareTopLevelName(scope, id.name, DECLARED_TYPE);
				return;
			}
			case "TSModuleDeclaration": {
				let id = node.id;
				while (id?.type === "TSQualifiedName") id = id.left;
				if (id?.type === "Identifier" && node.kind !== "global") declareTopLevelName(current(), id.name, DECLARED_EXPORT_ONLY);
				let body = node.body;
				while (body?.type === "TSModuleDeclaration") body = body.body;
				if (body?.type === "TSModuleBlock") schedule([
					enterVarScope,
					body.body,
					exit
				]);
				return;
			}
			case "JSXStyleElement":
			case "StyleSheet": return;
		}
		if (typeof node.type === "string" && node.type.startsWith("TS")) {
			if (SCOPE_TS_EXPRESSION_WRAPPERS.has(node.type)) schedule([node.expression]);
			return;
		}
		const children = [];
		for (const key in node) {
			if (SCOPE_SKIPPED_KEYS.has(key)) continue;
			children.push(node[key]);
		}
		schedule(children);
	};
	enter(5);
	schedule([program.body]);
	while (tasks.length > 0) {
		const task = tasks.pop();
		if (typeof task === "function") task();
		else step(task);
	}
	exit();
	for (const [name, local] of undefinedExports) diagnostics.push(scopeDiagnostic(`Export '${name}' is not defined`, local.start, local.start + 1, {
		start: local.start,
		raisedAt: source.length,
		raise: true
	}));
	return diagnostics;
}
function scopeFatalError(error, filename, positionAt) {
	const fatal = error.compatFatal;
	if (fatal.raise) {
		const loc = positionAt(fatal.start);
		const raised = /* @__PURE__ */ new SyntaxError(`${error.message} (${loc.line}:${loc.column})`);
		raised.pos = fatal.start;
		raised.loc = loc;
		raised.raisedAt = fatal.raisedAt;
		return raised;
	}
	return toCompileError({
		message: error.message,
		labels: [{
			start: fatal.start,
			end: fatal.end
		}]
	}, filename, positionAt, "fatal", void 0);
}
function strictError(errors, filename, positionAt, source) {
	const error = errors.find((candidate) => candidate?.compatFatal !== null) ?? errors[0];
	if (error?.compatFatal != null) return scopeFatalError(error, filename, positionAt);
	if (isUnclosedTag(error)) return acornRaise(error.message, primarySpan(error).start ?? 0, positionAt);
	return toCompileError(error, filename, positionAt, "fatal", source);
}
function mergeBySourceOrder(left, right) {
	if (left.length === 0) return right;
	if (right.length === 0) return left;
	const merged = [];
	let l = 0;
	let r = 0;
	while (l < left.length && r < right.length) if (diagnosticStart(right[r]) < diagnosticStart(left[l])) merged.push(right[r++]);
	else merged.push(left[l++]);
	while (l < left.length) merged.push(left[l++]);
	while (r < right.length) merged.push(right[r++]);
	return merged;
}
const SCRIPT_END_TAG_START = /<\/script/giu;
const SCRIPT_END_TAG_IN_BODY_CODE = "tsrx-script-end-tag-in-body";
function mayHaveScriptEndTagInBody(source) {
	if (typeof source !== "string") return false;
	SCRIPT_END_TAG_START.lastIndex = 0;
	let match;
	while ((match = SCRIPT_END_TAG_START.exec(source)) !== null) {
		if (match[0] !== "<\/script") return true;
		if (!/^[\t\n\f\r ]*>/u.test(source.slice(match.index + match[0].length))) return true;
	}
	return false;
}
function scriptEndTagDiagnostics(program, source) {
	if (!mayHaveScriptEndTagInBody(source)) return [];
	const diagnostics = [];
	const stack = [program];
	while (stack.length > 0) {
		const value = stack.pop();
		if (value === null || typeof value !== "object") continue;
		if (Array.isArray(value)) {
			for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
			continue;
		}
		if (value.type === "JSXElement" && value.openingElement?.name?.type === "JSXIdentifier" && value.openingElement.name.name === "script" && typeof value.content === "string" && Number.isInteger(value.openingElement.end)) {
			const contentStart = value.openingElement.end;
			SCRIPT_END_TAG_START.lastIndex = 0;
			let match;
			while ((match = SCRIPT_END_TAG_START.exec(value.content)) !== null) {
				const written = match[0];
				const start = contentStart + match.index;
				diagnostics.push({
					severity: "Error",
					message: `'${written}' can end a script in HTML, so a '<script>' body can't contain it. Write '<\\/${written.slice(2)}' instead.`,
					code: SCRIPT_END_TAG_IN_BODY_CODE,
					labels: [{
						start,
						end: start + written.length,
						message: ""
					}],
					helpMessage: null,
					codeframe: null
				});
			}
		}
		for (const key in value) {
			if (key === "loc" || key === "metadata" || key === "content") continue;
			const child = value[key];
			if (child !== null && typeof child === "object") stack.push(child);
		}
	}
	return diagnostics;
}
function sortBySourceOrder(errors) {
	const dynamic = [];
	const others = [];
	for (const [index, error] of errors.entries()) (error?.message === DYNAMIC_TAG_REFERENCE_MESSAGE ? dynamic : others).push({
		error,
		index
	});
	others.sort((left, right) => diagnosticStart(left.error) - diagnosticStart(right.error) || left.index - right.index);
	const merged = [];
	let next = 0;
	for (const entry of dynamic) {
		while (next < others.length && diagnosticStart(others[next].error) < diagnosticStart(entry.error)) {
			merged.push(others[next].error);
			next += 1;
		}
		merged.push(entry.error);
	}
	for (; next < others.length; next += 1) merged.push(others[next].error);
	return merged;
}
function diagnosticStart(error) {
	const { start } = primarySpan(error);
	return Number.isInteger(start) ? start : Number.POSITIVE_INFINITY;
}
function isEventAttribute(name) {
	return name.startsWith("on") && name.length > 2 && name[2] === name[2].toUpperCase();
}
function isCaptureEvent(name) {
	const lowered = name.toLowerCase();
	return name.endsWith("Capture") && lowered !== "gotpointercapture" && lowered !== "lostpointercapture";
}
function normalizeEventName(name) {
	const original = name.slice(2);
	return (isCaptureEvent(original) ? original.slice(0, -7) : original).toLowerCase();
}
function createTsrxCoreCompat(parser) {
	if (typeof parser?.parseSync !== "function") throw new TypeError("@tsrx/oxc-core-compat requires a parseSync function");
	return Object.freeze({
		isEventAttribute,
		normalizeEventName,
		parseModule(source, filename = "module.tsrx", options) {
			const resolvedFilename = filename || "module.tsrx";
			const collecting = Boolean(options?.collect || options?.loose);
			const wantsComments = Array.isArray(options?.comments);
			const eagerTsrx = !options?.loose && !wantsComments;
			let selectedParserOptions = parserOptions(resolvedFilename, eagerTsrx);
			let positionAt;
			const positions = () => positionAt ??= positionLookup(source);
			let result;
			try {
				try {
					result = parser.parseSync(resolvedFilename, source, selectedParserOptions);
				} catch (ordinaryError) {
					if (selectedParserOptions !== TYPESCRIPT_REACT_PARSER_OPTIONS || typeof source !== "string" || !source.includes("@{")) throw ordinaryError;
					try {
						const retry = tsrxRetry(parser, resolvedFilename, source, eagerTsrx);
						if (retry === null) throw ordinaryError;
						result = retry.result;
						selectedParserOptions = retry.options;
					} catch {
						throw ordinaryError;
					}
				}
			} catch (error) {
				if (options?.loose && typeof source === "string" && isRecoverableLooseShapeFailure(error)) {
					const recovered = looseRecovery(parser, resolvedFilename, source);
					if (recovered === null) throw error;
					result = recovered;
				} else {
					if (isOperationalError(error) || !isSyntaxErrorLike(error)) throw error;
					if (isDynamicTagNotExpression(error)) throw dynamicTagNotExpressionError(error, positions());
					if (isUnclosedTag(error)) throw unclosedTagFailure(error, collecting, positions(), source);
					const translated = toCompileError(error, resolvedFilename, positions(), "fatal", source);
					if (collecting && Array.isArray(options?.errors)) options.errors.push(toCompileError(error, resolvedFilename, positions(), "usage", source));
					throw translated;
				}
			}
			if (selectedParserOptions === TYPESCRIPT_REACT_PARSER_OPTIONS && typeof source === "string" && source.includes("@{") && (parserResultProgram(result) === null || parserResultErrors(result).length > 0)) try {
				const retry = tsrxRetry(parser, resolvedFilename, source, eagerTsrx);
				if (retry !== null) {
					result = retry.result;
					selectedParserOptions = retry.options;
				}
			} catch {}
			if (parserResultProgram(result) === null) {
				const notExpression = parserResultErrors(result).find(isDynamicTagNotExpression);
				if (notExpression !== void 0) throw dynamicTagNotExpressionError(notExpression, positions());
				const unclosed = parserResultErrors(result)[0];
				if (isUnclosedTag(unclosed)) throw unclosedTagFailure(unclosed, collecting, positions(), source);
			}
			let program;
			let comments;
			let nativeErrors;
			try {
				program = parserResultProgram(result);
				nativeErrors = parserResultErrors(result);
				if (program === null) {
					const recovery = submoduleRecovery(source, nativeErrors);
					if (recovery !== null) {
						result = parser.parseSync(resolvedFilename, recovery.source, selectedParserOptions);
						program = parserResultProgram(result);
						nativeErrors = parserResultErrors(result);
						if (program !== null) restoreSubmoduleSources(program, recovery.candidates);
					}
				}
				if (program === null && options?.loose && typeof source === "string") {
					const recovered = looseRecovery(parser, resolvedFilename, source);
					if (recovered !== null) {
						result = recovered;
						program = recovered.program;
						nativeErrors = recovered.errors ?? [];
					}
				}
				if (program !== null && options?.loose && typeof source === "string" && source.includes(COMPLETION_PLACEHOLDER)) normalizeCompletionPlaceholderSiblings(program);
				if (program !== null && selectedParserOptions.showSemanticErrors === true) {
					const compatibilityErrors = undefinedLocalExportDiagnostics(program);
					if (compatibilityErrors.length > 0) nativeErrors = [...nativeErrors, ...compatibilityErrors];
				}
				if (nativeErrors.length > 1 && nativeErrors.some((error) => error?.message === DYNAMIC_TAG_REFERENCE_MESSAGE)) nativeErrors = sortBySourceOrder(nativeErrors);
				if (program !== null) {
					const scriptErrors = scriptEndTagDiagnostics(program, source);
					if (scriptErrors.length > 0) nativeErrors = sortBySourceOrder([...nativeErrors, ...scriptErrors]);
				}
				if (program !== null && (selectedParserOptions === PARSER_OPTIONS || selectedParserOptions === EAGER_PARSER_OPTIONS)) {
					const scopeErrors = scopeDiagnostics(program, source);
					if (scopeErrors.length > 0) {
						const exportErrors = scopeErrors.filter((error) => error.message.startsWith("Export '"));
						const declarationErrors = scopeErrors.filter((error) => !error.message.startsWith("Export '"));
						nativeErrors = [...mergeBySourceOrder(nativeErrors, declarationErrors), ...exportErrors];
					}
				}
				comments = wantsComments ? result?.comments ?? [] : [];
			} catch (error) {
				if (isOperationalError(error) || !isSyntaxErrorLike(error)) throw error;
				if (isDynamicTagNotExpression(error)) throw dynamicTagNotExpressionError(error, positions());
				const translated = toCompileError(error, resolvedFilename, positions(), "fatal", source);
				if (collecting && Array.isArray(options?.errors)) options.errors.push(toCompileError(error, resolvedFilename, positions(), "usage", source));
				throw translated;
			}
			if (nativeErrors.length > 0) {
				if (!collecting) throw strictError(nativeErrors, resolvedFilename, positions(), source);
				if (Array.isArray(options?.errors)) for (const error of nativeErrors) options.errors.push(toCompileError(error, resolvedFilename, positions(), "usage", source));
			}
			if (program === null) {
				if (nativeErrors.length > 0) throw toCompileError(nativeErrors[0], resolvedFilename, positions(), "fatal", source);
				throw missingProgramError(resolvedFilename);
			}
			materializeCompatibilityProgram(program, source, resolvedFilename, Boolean(options?.loose), positions(), selectedParserOptions === TYPESCRIPT_REACT_PARSER_OPTIONS);
			if (wantsComments) for (const comment of comments) options.comments.push(compatibleComment(comment, positions()));
			return program;
		}
	});
}
//#endregion
export { createTsrxCoreCompat, isEventAttribute, normalizeEventName };
