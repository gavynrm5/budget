import { useEffect, useState } from "react";
import { evaluate } from "../lib/expr";
import { round2 } from "../lib/money";

/**
 * Currency input that accepts simple math. Reports every valid value through
 * onLive (for instant recalculation) and commits on blur or Enter.
 */
export function MoneyInput({
  value,
  onCommit,
  onLive,
  label,
  id,
  className = "",
  allowZero = true
}: {
  value: number;
  onCommit: (v: number) => void;
  onLive?: (v: number) => void;
  label: string;
  id?: string;
  className?: string;
  allowZero?: boolean;
}) {
  const [text, setText] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (!focused) setText(value.toFixed(2));
  }, [value, focused]);

  const parse = (t: string): number | null => {
    if (!t.trim()) return 0;
    try {
      const v = round2(evaluate(t));
      if (v < 0 || (!allowZero && v === 0)) return null;
      return v;
    } catch {
      return null;
    }
  };

  const commit = () => {
    const v = parse(text);
    if (v === null) {
      setText(value.toFixed(2));
      setBad(false);
      onLive?.(value);
      return;
    }
    setText(v.toFixed(2));
    if (v !== value) onCommit(v);
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        id={id}
        aria-label={label}
        aria-invalid={bad}
        inputMode="decimal"
        autoComplete="off"
        className={`input num min-h-[44px] pl-6 pr-2 text-right ${bad ? "border-bad" : ""} ${className}`}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parse(e.target.value);
          setBad(v === null);
          if (v !== null) onLive?.(v);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(value.toFixed(2));
            onLive?.(value);
            setBad(false);
          }
        }}
      />
    </div>
  );
}
