/** Client for /api/assist. Works under `vercel dev` or a deployment, not plain `vite`. */

import type { PlannerRequest } from '@/core/advisory/plannerSnapshot';
import { budgetHistory, tripBudget } from '@/core/advisory/tripBudget';

export interface AssistAnswer {
  text: string;
  /** True only when Meta AI was actually called (not cached, not the planner). */
  creditUsed: boolean;
  /** 'deterministic-planner', 'meta-ai', 'deterministic-fallback'. */
  source: string;
  cached?: boolean;
}

async function post(body: object): Promise<AssistAnswer> {
  const res = await fetch('/api/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) throw new Error('No /api here. Run `vercel dev` or use the deployment.');
  const data = (await res.json().catch(() => ({}))) as Partial<AssistAnswer> & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Assistant failed (${res.status})`);
  return {
    text: data.text ?? '',
    creditUsed: data.creditUsed === true,
    source: data.source ?? 'unknown',
    cached: data.cached,
  };
}

/**
 * Ask as a driver, commuter or operator. `mode: 'math'` gets the
 * planner's answer only, which never spends Meta credit.
 */
export function askAs(
  question: string,
  request: PlannerRequest,
  mode: 'ai' | 'math' = 'ai',
  localQuestionHistory: readonly string[] = [],
): Promise<AssistAnswer> {
  // Whole-trip arithmetic and follow-up context stay on this device. Never
  // forward prior questions to the external model or to the API request.
  const budget = tripBudget(
    question,
    request.snapshot.tripRoute,
    { dieselPhpPerL: request.dieselPricePhpPerLiter, ...request.tripBudgetInputs },
    budgetHistory(localQuestionHistory),
    request.dieselPriceBasis,
  );
  if (budget)
    return Promise.resolve({
      text: budget.answer,
      creditUsed: false,
      source: 'deterministic-planner',
    });
  return post({ question, mode, ...request });
}
