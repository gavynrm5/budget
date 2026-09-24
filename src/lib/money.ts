/** Round to 2 decimals in a way that avoids 1.005 style float errors. */
export function round2(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  // Sum in integer cents so totals never drift.
  return values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function fmt(n: number): string {
  return usd.format(round2(n) === 0 ? 0 : round2(n));
}

export function pct(n: number | null, digits = 1): string {
  if (n === null || !isFinite(n)) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}
