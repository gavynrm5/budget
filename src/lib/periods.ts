/**
 * Pay periods run from the 15th of one month through the 14th of the next.
 * A period is identified by its starting month, "YYYY-MM".
 */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function periodIdFor(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Period containing a YYYY-MM-DD date. */
export function periodOfDate(iso: string): string {
  const { y, m, d } = parseISO(iso);
  if (d >= 15) return periodIdFor(y, m);
  return m === 1 ? periodIdFor(y - 1, 12) : periodIdFor(y, m - 1);
}

export function currentPeriodId(): string {
  return periodOfDate(todayISO());
}

export function shiftPeriod(id: string, delta: number): string {
  const { y, m } = parseISO(id + "-01");
  const idx = y * 12 + (m - 1) + delta;
  return periodIdFor(Math.floor(idx / 12), (idx % 12) + 1);
}

export function comparePeriods(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function periodRange(id: string): { start: string; end: string } {
  const { y, m } = parseISO(id + "-01");
  const next = shiftPeriod(id, 1);
  return { start: `${periodIdFor(y, m)}-15`, end: `${next}-14` };
}

/** "March" style name. Year added when asked. */
export function periodName(id: string, withYear = false): string {
  const { y, m } = parseISO(id + "-01");
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}

export function shortMonth(id: string): string {
  return SHORT[parseISO(id + "-01").m - 1];
}

/** "Mar 15 to Apr 14, 2026" (the year shown is the end year, both when they differ). */
export function periodRangeLabel(id: string): string {
  const { start, end } = periodRange(id);
  const s = parseISO(start);
  const e = parseISO(end);
  const left = `${SHORT[s.m - 1]} 15`;
  const right = `${SHORT[e.m - 1]} 14`;
  return s.y === e.y ? `${left} to ${right}, ${e.y}` : `${left}, ${s.y} to ${right}, ${e.y}`;
}

export function daysInPeriod(id: string): number {
  const { start, end } = periodRange(id);
  const a = parseISO(start);
  const b = parseISO(end);
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000) + 1;
}

/** 1-based day number of `iso` within the period, clamped to the period. */
export function dayOfPeriod(id: string, iso: string): number {
  const { start } = periodRange(id);
  const a = parseISO(start);
  const b = parseISO(iso);
  const n = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000) + 1;
  return Math.max(0, Math.min(daysInPeriod(id) + 1, n));
}

/** All period ids whose start month falls in `year`, not before `startPeriod`. */
export function periodsForYear(year: number, startPeriod: string): string[] {
  const out: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const id = periodIdFor(year, m);
    if (id >= startPeriod) out.push(id);
  }
  return out;
}

export function formatDate(iso: string): string {
  const { y, m, d } = parseISO(iso);
  return `${SHORT[m - 1]} ${d}, ${y}`;
}

export function isValidPeriodId(id: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(id);
}
