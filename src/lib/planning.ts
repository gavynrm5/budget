import { evaluate } from "./expr";
import type { PlanLine } from "./types";

export type PlanResult = { value: number } | { error: string };

/** Turn friendly words into operators: "Current CC minus 1800" style wording. */
function normalize(formula: string): string {
  return formula
    .replace(/\bminus\b/gi, "-")
    .replace(/\bplus\b/gi, "+")
    .replace(/\btimes\b/gi, "*")
    .replace(/\bdivided by\b/gi, "/");
}

/** Evaluate every line; [Label] references another line by its label. */
export function evaluatePlan(lines: PlanLine[]): Record<string, PlanResult> {
  const byLabel = new Map(lines.map((l) => [l.label.trim().toLowerCase(), l]));
  const out: Record<string, PlanResult> = {};
  const visiting = new Set<string>();

  const calc = (line: PlanLine): number => {
    const cached = out[line.id];
    if (cached) {
      if ("value" in cached) return cached.value;
      throw new Error(cached.error);
    }
    if (visiting.has(line.id)) throw new Error("Circular reference");
    visiting.add(line.id);
    try {
      const f = normalize(line.formula).trim();
      const v = f === "" ? 0 : evaluate(f, (name) => {
        const ref = byLabel.get(name.toLowerCase());
        if (!ref) throw new Error(`No line named "${name}"`);
        return calc(ref);
      });
      out[line.id] = { value: v };
      return v;
    } catch (e) {
      out[line.id] = { error: (e as Error).message };
      throw e;
    } finally {
      visiting.delete(line.id);
    }
  };

  lines.forEach((l) => { try { calc(l); } catch { /* recorded */ } });
  return out;
}
