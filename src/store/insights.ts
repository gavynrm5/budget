import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "./data";
import { buildInsights, factsKey, ruleTips, type InsightsCache, type Tip } from "../lib/insights";
import { currentPeriodId, todayISO } from "../lib/periods";

const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
// One automatic attempt per facts fingerprint per app session, shared by every page using tips.
const autoTried = new Set<string>();
let inFlight: Promise<void> | null = null;

export function useInsights() {
  const { loaded, online, periods, transactions, settings, extraIncome, wishLists, wishlist, insights, saveInsights } = useData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const periodId = currentPeriodId();
  const apiKey = settings.anthropicKey;

  const data = useMemo(
    () => buildInsights({ periodId, today: todayISO(), periods, transactions, settings, extraIncome, wishLists, wishlist }),
    [periodId, periods, transactions, settings, extraIncome, wishLists, wishlist]
  );
  const key = factsKey(data);
  const cache = insights?.periodId === periodId ? insights : null;
  const dismissed = cache?.dismissed ?? [];
  const aiCache = cache?.source === "ai" ? cache : null;
  const tips: Tip[] = aiCache ? aiCache.tips : ruleTips(data.facts);
  const isDismissed = (t: Tip) => (t.factIds.length ? t.factIds.every((id) => dismissed.includes(id)) : dismissed.includes(t.id));
  const visible = tips.filter((t) => !isDismissed(t));
  const hidden = tips.filter(isDismissed);

  const generate = useCallback(async () => {
    if (!apiKey || !data.facts.length) return;
    if (inFlight) return inFlight;
    setLoading(true);
    setError(null);
    inFlight = (async () => {
      try {
        const { aiTips } = await import("../lib/aiTips"); // loaded only when tips are needed
        const next = await aiTips(data, apiKey);
        saveInsights({ periodId, key, generatedAt: Date.now(), source: "ai", tips: next, dismissed: cache?.dismissed ?? [] });
      } catch (e) {
        const err = e as { kind?: string; message?: string };
        setError({ kind: err.kind ?? "other", message: err.message ?? "Couldn't get tips from Claude." });
      } finally {
        inFlight = null;
        setLoading(false);
      }
    })();
    return inFlight;
  }, [apiKey, data, periodId, key, cache, saveInsights]);

  // Write new tips when the period starts, or when the facts changed and the saved tips are 12+ hours old.
  useEffect(() => {
    if (!loaded || !online || !apiKey || !data.facts.length || autoTried.has(key)) return;
    const stale = !aiCache || (aiCache.key !== key && Date.now() - aiCache.generatedAt > REFRESH_AFTER_MS);
    if (!stale) return;
    autoTried.add(key);
    void generate();
  }, [loaded, online, apiKey, key, aiCache, data.facts.length, generate]);

  const setDismissed = (ids: string[]) => {
    const base: InsightsCache = cache ?? { periodId, key, generatedAt: Date.now(), source: "rules", tips: [], dismissed: [] };
    saveInsights({ ...base, dismissed: ids });
  };
  const dismiss = (t: Tip) => setDismissed([...new Set([...dismissed, ...(t.factIds.length ? t.factIds : [t.id])])]);
  const restoreAll = () => setDismissed([]);

  return {
    data,
    tips: visible,
    hiddenCount: hidden.length,
    source: aiCache ? ("ai" as const) : ("rules" as const),
    generatedAt: aiCache?.generatedAt ?? null,
    outdated: !!aiCache && aiCache.key !== key,
    hasKey: !!apiKey,
    loading,
    error,
    refresh: generate,
    dismiss,
    restoreAll
  };
}
