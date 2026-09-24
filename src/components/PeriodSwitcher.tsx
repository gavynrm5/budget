import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentPeriodId, periodName, periodRangeLabel, shiftPeriod } from "../lib/periods";

export function PeriodSwitcher({ periodId, onChange }: { periodId: string; onChange: (id: string) => void }) {
  const isCurrent = periodId === currentPeriodId();
  return (
    <div className="flex items-center gap-1">
      <button className="icon-btn" onClick={() => onChange(shiftPeriod(periodId, -1))} aria-label={`Previous period, ${periodName(shiftPeriod(periodId, -1), true)}`}>
        <ChevronLeft size={22} />
      </button>
      <div className="min-w-0 px-1 text-center sm:min-w-[200px]">
        <p className="text-lg font-semibold leading-tight" aria-live="polite">
          {periodName(periodId, true)}
        </p>
        <p className="num text-sm text-muted">{periodRangeLabel(periodId)}</p>
      </div>
      <button className="icon-btn" onClick={() => onChange(shiftPeriod(periodId, 1))} aria-label={`Next period, ${periodName(shiftPeriod(periodId, 1), true)}`}>
        <ChevronRight size={22} />
      </button>
      {!isCurrent && (
        <button className="btn-ghost ml-1 min-h-[40px] px-3 text-sm text-primary" onClick={() => onChange(currentPeriodId())}>
          Today
        </button>
      )}
    </div>
  );
}
