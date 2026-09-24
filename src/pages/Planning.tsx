import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, NotebookPen, Plus, Trash2 } from "lucide-react";
import { useData } from "../store/data";
import { useUI } from "../store/ui";
import { evaluatePlan } from "../lib/planning";
import { fmt } from "../lib/money";
import type { PlanLine } from "../lib/types";
import { EmptyState, PageHeader } from "../components/ui";

export default function Planning() {
  const { planning, savePlanning, newId } = useData();
  const { deleteWithUndo } = useUI();
  const [lines, setLines] = useState<PlanLine[]>(planning.lines);
  const lastSaved = useRef(JSON.stringify(planning.lines));
  const timer = useRef<number>();

  // Adopt changes that arrive from another device.
  useEffect(() => {
    const incoming = JSON.stringify(planning.lines);
    if (incoming !== lastSaved.current) {
      lastSaved.current = incoming;
      setLines(planning.lines);
    }
  }, [planning.lines]);

  const commit = (next: PlanLine[], immediate = false) => {
    setLines(next);
    window.clearTimeout(timer.current);
    const run = () => {
      lastSaved.current = JSON.stringify(next);
      savePlanning({ lines: next });
    };
    if (immediate) run(); else timer.current = window.setTimeout(run, 600);
  };

  const results = useMemo(() => evaluatePlan(lines), [lines]);
  const update = (id: string, patch: Partial<PlanLine>) => commit(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const move = (i: number, d: number) => {
    const next = [...lines];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    commit(next, true);
  };
  const add = () => commit([...lines, { id: newId(), label: `Line ${lines.length + 1}`, formula: "0" }], true);
  const remove = (l: PlanLine) => {
    const before = lines;
    deleteWithUndo({ what: `"${l.label}"`, remove: () => commit(before.filter((x) => x.id !== l.id), true), restore: () => commit(before, true) });
  };

  return (
    <>
      <PageHeader
        title="Planning"
        subtitle="What-if numbers. Nothing here touches your budget."
        actions={<button className="btn-primary" onClick={add}><Plus size={18} aria-hidden /> Add line</button>}
      />

      <div className="card mb-4 p-4 text-sm text-muted">
        Type a number, or a formula that uses other lines in square brackets, like <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">[Current CC] - 1800</code>. Words like minus and plus work too.
      </div>

      {lines.length === 0 ? (
        <div className="card"><EmptyState icon={<NotebookPen size={22} />} title="Nothing planned yet.">Add a line to start a what-if.</EmptyState></div>
      ) : (
        <ul className="grid gap-3">
          {lines.map((l, i) => {
            const r = results[l.id];
            return (
              <li key={l.id} className="card p-3 sm:p-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-center sm:gap-3">
                  <div>
                    <label htmlFor={`pl-l-${l.id}`} className="sr-only">Label</label>
                    <input id={`pl-l-${l.id}`} className="input font-medium" value={l.label} onChange={(e) => update(l.id, { label: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={`pl-f-${l.id}`} className="sr-only">Value or formula for {l.label}</label>
                    <input id={`pl-f-${l.id}`} className="input num" value={l.formula} onChange={(e) => update(l.id, { formula: e.target.value })} aria-describedby={`pl-r-${l.id}`} />
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:contents">
                    <p id={`pl-r-${l.id}`} className="num min-w-[120px] text-right text-lg font-semibold" aria-live="polite">
                      {r && "value" in r ? <span className={r.value < 0 ? "text-bad" : ""}>{fmt(r.value)}</span> : <span className="text-sm font-normal text-bad">{r?.error ?? ""}</span>}
                    </p>
                    <div className="flex">
                      <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${l.label} up`}><ArrowUp size={17} /></button>
                      <button className="icon-btn" disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${l.label} down`}><ArrowDown size={17} /></button>
                      <button className="icon-btn hover:text-bad" onClick={() => remove(l)} aria-label={`Delete ${l.label}`}><Trash2 size={17} /></button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
