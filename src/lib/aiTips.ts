import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Fact, InsightsData, Tip } from "./insights";

/**
 * Turns the facts from buildInsights into friendly tips with Claude. Only the
 * facts and a spending summary are sent: category names, store names from
 * descriptions, amounts, and goal names. No account names, notes, or balances.
 * The key is the user's own, stored with their data (only they can read it),
 * and the call goes straight from their browser to Anthropic.
 */

const MODEL = "claude-opus-5";

const TipsSchema = z.object({
  tips: z.array(
    z.object({
      factIds: z.array(z.string()),
      title: z.string(),
      body: z.string(),
      tone: z.enum(["warning", "nudge", "praise"]),
      savings: z.number().nullable()
    })
  )
});

const SYSTEM = `You write spending tips for one person's personal budget app. The app runs on monthly pay periods from the 15th to the 14th.

You receive facts the app already calculated about the current pay period. Write 2 to 6 tips, most useful first.

Rules:
- Use only the numbers in the facts. Never invent amounts, dates, stores, or percentages. Round money to whole dollars.
- Each tip lists the ids of the facts it is based on in factIds. Combine related facts into one tip when it reads better.
- Give a specific, doable action with a number in it (a daily limit, a cap on trips, an amount to move to a goal). Avoid vague advice like "spend less".
- Be warm and direct, never judgmental. Praise real improvements with tone "praise".
- title: under 60 characters. body: one or two short sentences, under 220 characters.
- savings: rough dollars per pay period the tip could save, or null when it doesn't apply.
- Don't suggest cutting rent, car payments, insurance, utilities, or savings. Those are left out on purpose.
- If there are no facts, return one encouraging tip with an empty factIds list.`;

export class TipsError extends Error {
  constructor(
    public kind: "bad-key" | "rate-limit" | "refused" | "network" | "other",
    message: string
  ) {
    super(message);
  }
}

function client(key: string) {
  // The key belongs to the person using the app and never leaves their browser except to Anthropic.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
}

/** Checks a key without spending tokens. */
export async function checkKey(key: string): Promise<void> {
  try {
    await client(key).models.retrieve(MODEL);
  } catch (e) {
    throw toTipsError(e);
  }
}

function toTipsError(e: unknown): TipsError {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new TipsError("bad-key", "Anthropic rejected the API key.");
  if (e instanceof Anthropic.RateLimitError) return new TipsError("rate-limit", "Too many requests to Claude right now. Try again in a minute.");
  if (e instanceof Anthropic.APIConnectionError) return new TipsError("network", "Couldn't reach Claude. Check your connection.");
  if (e instanceof Anthropic.APIError) return new TipsError("other", `Claude returned an error (${e.status ?? "unknown"}).`);
  return new TipsError("other", "Couldn't get tips from Claude.");
}

export async function aiTips(data: InsightsData, key: string): Promise<Tip[]> {
  const summary = {
    period: data.periodLabel,
    day: data.day,
    daysInPeriod: data.daysTotal,
    daysLeft: data.daysLeft,
    historyPeriods: data.history.length,
    facts: data.facts,
    spendingThisPeriod: data.spending.slice(0, 12).map((s) => ({ name: s.name, spent: s.spent, budget: s.available, usualByNow: s.usualByNow }))
  };
  let response;
  try {
    response = await client(key).beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(TipsSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Facts for this pay period:\n${JSON.stringify(summary, null, 1)}` }]
    });
  } catch (e) {
    throw toTipsError(e);
  }
  if (response.stop_reason === "refusal") throw new TipsError("refused", "Claude couldn't write tips this time.");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new TipsError("other", "Claude's answer was cut off. Try again.");

  const known = new Set(data.facts.map((f: Fact) => f.id));
  return response.parsed_output.tips.slice(0, 6).map((t, i) => {
    const factIds = t.factIds.filter((id) => known.has(id));
    return {
      id: factIds.length ? `ai:${[...factIds].sort().join("+")}` : `ai:general-${i}`,
      factIds,
      title: t.title.slice(0, 80),
      body: t.body.slice(0, 320),
      tone: t.tone,
      savings: t.savings != null && t.savings > 0 ? Math.round(t.savings) : null
    };
  });
}
