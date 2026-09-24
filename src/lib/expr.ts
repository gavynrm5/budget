/**
 * Tiny, safe arithmetic evaluator (no eval). Supports + - * / ( ), decimals,
 * $ and thousands commas, unary minus, and optional [Variable Name] references.
 */
export class ExprError extends Error {}

type Resolver = (name: string) => number;

export function evaluate(input: string, resolve?: Resolver): number {
  const src = input.replace(/\$/g, "").replace(/(\d),(?=\d{3}\b)/g, "$1").trim();
  let i = 0;

  const peek = () => {
    while (src[i] === " ") i++;
    return src[i];
  };

  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      const c = peek();
      if (c === "+") { i++; v += parseTerm(); }
      else if (c === "-") { i++; v -= parseTerm(); }
      else return v;
    }
  }
  function parseTerm(): number {
    let v = parseFactor();
    for (;;) {
      const c = peek();
      if (c === "*" || c === "x" || c === "×") { i++; v *= parseFactor(); }
      else if (c === "/" || c === "÷") {
        i++;
        const d = parseFactor();
        if (d === 0) throw new ExprError("Cannot divide by zero");
        v /= d;
      } else return v;
    }
  }
  function parseFactor(): number {
    const c = peek();
    if (c === "-") { i++; return -parseFactor(); }
    if (c === "+") { i++; return parseFactor(); }
    if (c === "(") {
      i++;
      const v = parseExpr();
      if (peek() !== ")") throw new ExprError("Missing closing parenthesis");
      i++;
      return v;
    }
    if (c === "[") {
      const end = src.indexOf("]", i);
      if (end < 0) throw new ExprError("Missing ]");
      const name = src.slice(i + 1, end).trim();
      i = end + 1;
      if (!resolve) throw new ExprError("References are not allowed here");
      return resolve(name);
    }
    const m = /^\d*\.?\d+/.exec(src.slice(i));
    if (!m) throw new ExprError(c === undefined ? "Unexpected end" : `Unexpected "${c}"`);
    i += m[0].length;
    return parseFloat(m[0]);
  }

  if (!src) throw new ExprError("Empty");
  const value = parseExpr();
  if (peek() !== undefined) throw new ExprError(`Unexpected "${src[i]}"`);
  if (!isFinite(value)) throw new ExprError("Not a number");
  return value;
}

/** True if the text contains math beyond a plain number. */
export function isExpression(input: string): boolean {
  const s = input.replace(/\$/g, "").replace(/,/g, "").trim();
  return /[+*/()×÷x]/.test(s) || /\d\s*-/.test(s);
}
