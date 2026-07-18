import { SchemaFakerError } from "./errors.js";

/**
 * Bounded randexp-style generator for JSON Schema `pattern` (a regex source string).
 * Zero-dependency, hand-rolled mini regex parser + AST walker — deliberately does NOT support
 * the full regex grammar; see `parsePattern`'s doc comment for exactly what's covered.
 *
 * Unbounded quantifiers (`*`/`+`) are hard-capped at a fixed number of repetitions to avoid
 * catastrophic expansion; a parse failure or unsupported construct falls back to plain-string
 * generation, with `strict` mode's validate-retry as the documented backstop. All randomness
 * flows through the caller-supplied `rand()` (itself derived from the seeded backend instance),
 * so generation is deterministic per seed.
 */

const MAX_UNBOUNDED_REPS = 10;
/** Absolute ceiling on how many characters a single generated pattern match may contain,
 * independent of any one quantifier's own cap — a defense-in-depth guard against
 * pathological nested-quantifier patterns (e.g. `(a{10}){10}`) blowing up output size. */
const MAX_TOTAL_LENGTH = 2000;

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Node =
  | { kind: "literal"; char: string }
  | { kind: "any" } // `.`
  | { kind: "class"; ranges: Array<[number, number]>; negate: boolean }
  | { kind: "group"; alternatives: Node[][] }
  | { kind: "repeat"; node: Node; min: number; max: number };

interface ParsedPattern {
  sequence: Node[];
}

class UnsupportedPatternError extends SchemaFakerError {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPatternError";
  }
}

/**
 * Parses a regex source string (as found in JSON Schema's `pattern` keyword) into a small AST.
 * Throws `UnsupportedPatternError` for anything outside the supported subset, which callers
 * should catch and fall back to plain-string generation for.
 *
 * Supported: literals, `.`, character classes (`[...]`, ranges `a-z`, negation `[^...]`),
 * escapes `\d \w \s \D \W \S` (inside and outside classes) and common literal escapes
 * (`\. \- \\` etc), quantifiers `+ * ? {n} {n,} {n,m}`, alternation `|`, non-capturing and
 * capturing groups `(...)`  `(?:...)`, and leading/trailing anchors `^`/`$` (stripped, since a
 * full-string generated value is implicitly anchored).
 *
 * Not supported (throws): lookaheads/lookbehinds, backreferences, named groups, unicode
 * property escapes, flags, nested quantifier chaining beyond a single quantifier per atom.
 */
export function parsePattern(source: string): ParsedPattern {
  const p = new Parser(stripAnchors(source));
  const sequence = p.parseAlternation();
  if (!p.atEnd()) {
    throw new UnsupportedPatternError(`Unexpected trailing input at position ${p.pos}`);
  }
  // parseAlternation always returns a single-branch "group" wrapping the top-level
  // alternatives; unwrap so the top-level sequence is a flat Node[] when there's only one
  // alternative (common case), else keep it as a group.
  const [onlyNode] = sequence;
  if (sequence.length === 1 && onlyNode?.kind === "group") {
    const [onlyAlternative, ...restAlternatives] = onlyNode.alternatives;
    if (onlyAlternative && restAlternatives.length === 0) {
      return { sequence: onlyAlternative };
    }
  }
  return { sequence };
}

function stripAnchors(source: string): string {
  let s = source;
  if (s.startsWith("^")) s = s.slice(1);
  if (s.endsWith("$") && !s.endsWith("\\$")) s = s.slice(0, -1);
  return s;
}

class Parser {
  pos = 0;
  constructor(private readonly src: string) {}

  atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  peek(): string | undefined {
    return this.src[this.pos];
  }

  private advance(): string {
    const c = this.src[this.pos];
    if (c === undefined) throw new UnsupportedPatternError("Unexpected end of pattern");
    this.pos += 1;
    return c;
  }

  /** `a|b|c` — returns a one-element array containing a `group` node so callers can uniformly unwrap. */
  parseAlternation(): Node[] {
    const alternatives: Node[][] = [this.parseSequence()];
    while (this.peek() === "|") {
      this.advance();
      alternatives.push(this.parseSequence());
    }
    return [{ kind: "group", alternatives }];
  }

  parseSequence(): Node[] {
    const nodes: Node[] = [];
    while (!this.atEnd() && this.peek() !== "|" && this.peek() !== ")") {
      nodes.push(this.parseQuantified());
    }
    return nodes;
  }

  parseQuantified(): Node {
    const atom = this.parseAtom();
    const quant = this.tryParseQuantifier();
    if (!quant) return atom;
    return { kind: "repeat", node: atom, min: quant.min, max: quant.max };
  }

  tryParseQuantifier(): { min: number; max: number } | undefined {
    const c = this.peek();
    if (c === "+") {
      this.advance();
      this.skipLazyMarker();
      return { min: 1, max: MAX_UNBOUNDED_REPS };
    }
    if (c === "*") {
      this.advance();
      this.skipLazyMarker();
      return { min: 0, max: MAX_UNBOUNDED_REPS };
    }
    if (c === "?") {
      this.advance();
      this.skipLazyMarker();
      return { min: 0, max: 1 };
    }
    if (c === "{") {
      const start = this.pos;
      this.advance();
      const result = this.tryParseBraceQuantifierBody();
      if (result === undefined) {
        // Not a valid {..} quantifier body — treat `{` as a literal (JS regex allows this).
        this.pos = start;
        return undefined;
      }
      this.skipLazyMarker();
      return result;
    }
    return undefined;
  }

  private skipLazyMarker(): void {
    // `+?`, `*?`, `{n,m}?` (lazy quantifiers) — irrelevant for generation (we always emit a
    // count in-range), but must be consumed so the parser doesn't choke on the trailing `?`.
    if (this.peek() === "?") this.advance();
  }

  /** Consumes as many ASCII-digit characters as are next in the input, returning them as a string (`""` if none). Captures `peek()` into a local once per iteration so the digit-test doesn't need a second (possibly-`undefined`) call. */
  private consumeDigits(): string {
    let digits = "";
    for (let next = this.peek(); next !== undefined && /\d/.test(next); next = this.peek()) {
      digits += this.advance();
    }
    return digits;
  }

  private tryParseBraceQuantifierBody(): { min: number; max: number } | undefined {
    const digitsStart = this.pos;
    const minStr = this.consumeDigits();
    if (minStr === "") {
      this.pos = digitsStart;
      return undefined;
    }
    const min = Number.parseInt(minStr, 10);

    if (this.peek() === "}") {
      this.advance();
      return { min, max: min };
    }
    if (this.peek() !== ",") {
      this.pos = digitsStart;
      return undefined;
    }
    this.advance(); // ','
    const maxStr = this.consumeDigits();
    if (this.peek() !== "}") {
      this.pos = digitsStart;
      return undefined;
    }
    this.advance(); // '}'
    const max = maxStr === "" ? Math.max(min, MAX_UNBOUNDED_REPS) : Number.parseInt(maxStr, 10);
    return { min, max };
  }

  parseAtom(): Node {
    const c = this.peek();
    if (c === undefined) throw new UnsupportedPatternError("Unexpected end of pattern");

    if (c === "(") {
      this.advance();
      if (this.src.slice(this.pos, this.pos + 2) === "?:") {
        this.pos += 2;
      } else if (this.peek() === "?") {
        // (?=...) (?!...) (?<=...) (?<!...) (?<name>...) — lookarounds and named groups.
        throw new UnsupportedPatternError("Lookaround/named groups are not supported");
      }
      const [innerGroup] = this.parseAlternation();
      if (this.peek() !== ")") throw new UnsupportedPatternError("Unbalanced group");
      this.advance();
      if (!innerGroup) {
        // Unreachable: parseAlternation() always returns exactly one "group" node (see its own
        // doc comment). Guarded explicitly so a future change to that invariant fails loudly.
        throw new UnsupportedPatternError("Internal error: parseAlternation() returned no node");
      }
      return innerGroup;
    }

    if (c === "[") {
      return this.parseClass();
    }

    if (c === ".") {
      this.advance();
      return { kind: "any" };
    }

    if (c === "\\") {
      this.advance();
      return this.parseEscape();
    }

    if (c === "^" || c === "$") {
      // A stray anchor mid-pattern (multiline-style) — not supported; only leading/trailing
      // anchors on the whole pattern are stripped by `stripAnchors`.
      throw new UnsupportedPatternError("Mid-pattern anchors are not supported");
    }

    this.advance();
    return { kind: "literal", char: c };
  }

  private parseEscape(): Node {
    const c = this.advance();
    switch (c) {
      case "d":
        return { kind: "class", ranges: [[48, 57]], negate: false };
      case "D":
        return { kind: "class", ranges: [[48, 57]], negate: true };
      case "w":
        return { kind: "class", ranges: WORD_RANGES, negate: false };
      case "W":
        return { kind: "class", ranges: WORD_RANGES, negate: true };
      case "s":
        return { kind: "class", ranges: SPACE_RANGES, negate: false };
      case "S":
        return { kind: "class", ranges: SPACE_RANGES, negate: true };
      case "n":
        return { kind: "literal", char: "\n" };
      case "t":
        return { kind: "literal", char: "\t" };
      case "r":
        return { kind: "literal", char: "\r" };
      case "b":
        // Word boundary assertion — no character to emit; treat as a no-op literal (empty).
        // Modeled as a zero-width group with a single empty alternative sequence.
        return { kind: "group", alternatives: [[]] };
      default:
        // Any other escaped char (`\. \- \\ \( \)` etc) is just that literal character.
        return { kind: "literal", char: c };
    }
  }

  private parseClass(): Node {
    this.advance(); // '['
    let negate = false;
    if (this.peek() === "^") {
      negate = true;
      this.advance();
    }
    const ranges: Array<[number, number]> = [];
    let first = true;
    while (!this.atEnd() && (this.peek() !== "]" || first)) {
      first = false;
      let loChar: string;
      if (this.peek() === "\\") {
        this.advance();
        const escaped = this.advance();
        const escapedRanges = escapeCharToRanges(escaped);
        if (escapedRanges) {
          ranges.push(...escapedRanges);
          continue;
        }
        loChar = escapeLiteralChar(escaped);
      } else {
        loChar = this.advance();
      }

      if (this.peek() === "-" && this.src[this.pos + 1] !== "]" && this.pos + 1 < this.src.length) {
        this.advance(); // '-'
        let hiChar: string;
        if (this.peek() === "\\") {
          this.advance();
          hiChar = escapeLiteralChar(this.advance());
        } else {
          hiChar = this.advance();
        }
        ranges.push([codePointOf(loChar), codePointOf(hiChar)]);
      } else {
        ranges.push([codePointOf(loChar), codePointOf(loChar)]);
      }
    }
    if (this.peek() !== "]") throw new UnsupportedPatternError("Unbalanced character class");
    this.advance(); // ']'
    if (ranges.length === 0) throw new UnsupportedPatternError("Empty character class");
    return { kind: "class", ranges, negate };
  }
}

const WORD_RANGES: Array<[number, number]> = [
  [48, 57], // 0-9
  [65, 90], // A-Z
  [97, 122], // a-z
  [95, 95], // _
];
const SPACE_RANGES: Array<[number, number]> = [
  [32, 32],
  [9, 13], // \t \n \v \f \r
];

/** `\d \w \s \D \W \S` inside a character class expand to their range sets; returns undefined for a plain literal escape. */
function escapeCharToRanges(escaped: string): Array<[number, number]> | undefined {
  switch (escaped) {
    case "d":
      return [[48, 57]];
    case "w":
      return WORD_RANGES;
    case "s":
      return SPACE_RANGES;
    default:
      return undefined;
  }
}

function escapeLiteralChar(escaped: string): string {
  switch (escaped) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    default:
      return escaped;
  }
}

/**
 * Code point of `char`'s first character. Every caller passes a value produced by
 * `Parser.advance()` (which throws on end-of-input, so it always returns a real character) or
 * `escapeLiteralChar()` (which always returns a non-empty single-character string) -- `char` is
 * therefore always non-empty, but `String.prototype.codePointAt` is typed to allow
 * `undefined` for an out-of-range index. Guarded explicitly (rather than a `!` assertion) so a
 * future caller passing an empty string fails with a clear message instead of `NaN` silently
 * flowing into a character-class range.
 */
function codePointOf(char: string): number {
  const point = char.codePointAt(0);
  if (point === undefined) {
    throw new UnsupportedPatternError(`Internal error: expected a single character, got an empty string`);
  }
  return point;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const PRINTABLE_ASCII: Array<[number, number]> = [[32, 126]];

/**
 * Generates a string matching `parsed`, using `rand()` (in `[0, 1)`) for every random choice
 * — so the whole generation is deterministic given the same `rand` sequence. Enforces
 * `MAX_TOTAL_LENGTH` as a hard ceiling regardless of any individual quantifier's own cap.
 */
export function generateFromPattern(parsed: ParsedPattern, rand: () => number): string {
  let out = "";
  for (const node of parsed.sequence) {
    out += generateNode(node, rand, () => out.length < MAX_TOTAL_LENGTH);
    if (out.length >= MAX_TOTAL_LENGTH) break;
  }
  return out.length > MAX_TOTAL_LENGTH ? out.slice(0, MAX_TOTAL_LENGTH) : out;
}

function generateNode(node: Node, rand: () => number, hasBudget: () => boolean): string {
  switch (node.kind) {
    case "literal":
      return node.char;
    case "any":
      return String.fromCodePoint(pickFromRanges(PRINTABLE_ASCII, false, rand));
    case "class":
      return String.fromCodePoint(pickFromRanges(node.ranges, node.negate, rand));
    case "group": {
      const [firstAlternative] = node.alternatives;
      if (!firstAlternative) {
        // Unreachable: a "group" node is only ever constructed with at least one alternative
        // (parseAlternation/parseClass always push one) -- guarded explicitly rather than
        // asserted, so a future AST-construction bug fails loudly instead of indexing undefined.
        throw new UnsupportedPatternError("Internal error: a group node had no alternatives");
      }
      const alt = node.alternatives[Math.floor(rand() * node.alternatives.length)] ?? firstAlternative;
      let out = "";
      for (const n of alt) {
        if (!hasBudget()) break;
        out += generateNode(n, rand, hasBudget);
      }
      return out;
    }
    case "repeat": {
      const count = node.min + Math.floor(rand() * (node.max - node.min + 1));
      let out = "";
      for (let i = 0; i < count; i++) {
        if (!hasBudget()) break;
        out += generateNode(node.node, rand, hasBudget);
      }
      return out;
    }
  }
}

/** Picks a single code point from a set of inclusive `[lo, hi]` ranges (or its complement, within printable ASCII, if `negate`). */
function pickFromRanges(ranges: Array<[number, number]>, negate: boolean, rand: () => number): number {
  const pool = negate ? complementWithinAscii(ranges) : ranges;
  if (pool.length === 0) {
    // Fully negated the entire printable ASCII range (pathological pattern) — fall back to a
    // safe printable character rather than throwing mid-generation.
    return 65; // 'A'
  }
  const total = pool.reduce((sum, [lo, hi]) => sum + (hi - lo + 1), 0);
  let idx = Math.floor(rand() * total);
  for (const [lo, hi] of pool) {
    const span = hi - lo + 1;
    if (idx < span) return lo + idx;
    idx -= span;
  }
  // Unreachable in exact arithmetic (idx starts strictly below `total`, the sum of every
  // span, so the loop above always returns before exhausting `pool`) -- kept as a defensive
  // floating-point-rounding fallback rather than an assertion, since `pool` was already
  // checked non-empty above.
  const [lo] = pool;
  if (!lo) {
    throw new Error("standard-schema-faker: internal error -- pattern generator's range pool was unexpectedly empty");
  }
  return lo[0];
}

function complementWithinAscii(ranges: Array<[number, number]>): Array<[number, number]> {
  // Complement within printable ASCII (32-126) — negated classes matching outside that
  // window (e.g. matching arbitrary Unicode) are out of scope for a bounded generator.
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const result: Array<[number, number]> = [];
  let cursor = 32;
  for (const [lo, hi] of sorted) {
    if (lo > cursor) result.push([cursor, Math.min(lo - 1, 126)]);
    cursor = Math.max(cursor, hi + 1);
  }
  if (cursor <= 126) result.push([cursor, 126]);
  return result.filter(([lo, hi]) => lo <= hi);
}

export { MAX_TOTAL_LENGTH, MAX_UNBOUNDED_REPS, UnsupportedPatternError };
