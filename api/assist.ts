/**
 * POST /api/assist
 *
 * Accepts:
 *   {
 *     question: string,
 *     snapshot: object,
 *     role?: 'commuter' | 'driver' | 'operator' | 'auto',
 *     driverPlate?: string,
 *     commuterStop?: string,
 *     destinationStop?: string,
 *     mode?: 'ai' | 'math',
 *     screen?: object   // what the person's app shows; the answer must agree
 *   }
 *
 * Returns:
 *   {
 *     text: string,
 *     plan: CommutePlanResult,
 *     creditUsed: boolean,
 *     cached?: boolean,
 *     source: 'meta-ai' | 'deterministic-planner' | 'deterministic-fallback'
 *   }
 *
 * How it works:
 * 1. First runs the deterministic CommuteAI planner (`api/_lib/planner.ts`) to
 *    calculate exact commuter ETAs, seat availability after intermediate
 *    drop-offs, LTFRB fares, First-Come-First-Served (FCFS) multi-jeepney stop
 *    assignments (nearest jeepney claims waiting riders first), and fuel/peso
 *    savings in km, liters, and PHP.
 * 2. If `mode === 'math'`, `META_SAVE_CREDITS=true`, or Meta API credentials
 *    are not set, returns the deterministic answer immediately ($0.00 spent).
 * 3. Otherwise passes the snapshot + pre-computed math plan to Meta AI (with
 *    60-second caching to protect the $150 free credit).
 */

import {
  chatWithCache,
  creditSaverEnabled,
  MetaEmptyReplyError,
  metaConfigured,
} from './_lib/meta';
import { buildCommutePlan, type PlanOptions } from './_lib/planner';
import type { TripBudgetInputs } from '../src/core/advisory/tripBudget';
import { arrivalAdvice } from './_lib/arrivalAdvice';

const MAX_QUESTION_CHARS = 500;
/**
 * The snapshot is never sent to Meta; only the planner reads it. The Live
 * twin's has the whole fleet at real positions (up to 200 jeepneys).
 */
const MAX_SNAPSHOT_BYTES = 48_000;
/** An operator question sends Meta only the busiest stops, not all of them. */
const OPERATOR_STOPS = 5;

const SYSTEM_PROMPT = `You are CommuteAI's transit assistant for Philippine jeepneys. Reply in the language the user writes in (English, Tagalog or Taglish).
Answer the question that was asked, first, in plain words. Then add only what helps that person act. A simple question gets 1–2 sentences; a question asking why, how, or about several things may get a short paragraph (at most about 120 words). No lists of every stop, no repeating the whole plan.
COMMUTERS: say which jeepney (plate) takes them, in how many minutes, and whether it has a seat for them. Use seatsLeftForYou: people already waiting at the stop board first, so a jeepney with free seats can still be full for this commuter; then point them to the next jeepney with seatsLeftForYou > 0. Give the fare (regular and Student/Senior/PWD) when asked or when it helps.
DRIVERS: say whether to stop or pass the next stop and why (riders waiting for you, riders getting off, or a jeepney ahead already taking them). For fuel, give the saving in mL and pesos. For refuelling, use SCREEN.refuel and SCREEN.dieselAhead: only stations on the driver's own side that they can pull into, nearest first, with the brand's DOE price range for the week and the expected price (middle of the range, not that pump's exact price). Give the choice: fill up now at the nearest, or, if the tank can wait, the cheaper one further on and what it saves on a top-up. SCREEN.tank, when given, is the diesel in the tank now (litres, % full, and whether the driver is already going to fill up): use it to say whether they need to fill up now. The driver's map only shows gas stations within SCREEN.mapRadiusM; a station with onYourMap=false is beyond it, so call it "further ahead, not on your map yet" and give its distance, never suggest one that is not in SCREEN.dieselAhead. A jeepney must keep to its franchise route: never suggest other roads, shortcuts or U-turns. More earnings come from picking up the riders assigned to them, skipping empty stops, and refuelling where it is cheapest on their way.
The DRIVERS stop/pass guidance applies ONLY to questions about pickups, drop-offs or the next stop. Discuss fuel savings ONLY when savings are asked about. Never replace a total trip-cost question with nearby-stop advice or the remaining fuel to a terminal. Do not equate fare revenue minus fuel with take-home earnings: other operating expenses may be missing.
SCREEN, when given, is exactly what this person's app shows right now. Its fuelToTerminal is ONLY the remaining leg from the driver's current position, never a full round trip or a daily budget. Your answer must agree with it, and where SCREEN and ComputedPlan cover the same thing (ETAs, seats, the next stops), use SCREEN's numbers. For a driver, "a jeepney in front" means SCREEN.jeepneyInFront, the one within sight (SCREEN.sightM); jeepneys further down the road are not in front of them, so do not name them as such. SCREEN.plannedTrip is a commuter's whole trip when it takes two jeepneys: give both legs, the stop to change at, and the total fare; its nextJeepneyEstimate is an estimate from how that route usually runs, so say "about".
ARRIVALS: SCREEN.nextStops separates waiting (already at the stop) from approaching (within 500 m, still walking or riding a tricycle). approachingBeforeYou is only an ETA comparison, never a seat reservation or instruction to wait. Keep the current stop/pass decision and tell the driver to recheck on arrival, never to wait minutes for distant riders. For commuters, SCREEN.approachingStop describes their own first-mile journey; arrivals with catchable=false reach the stop before the person, so never recommend those jeepneys. yourJeepney=null means there is no current eligible pickup estimate. These arrival facts are simulated, not live phone GPS.
Use ONLY the numbers in SCREEN and ComputedPlan; never invent or round them into different values. Stop names may end with "→ <terminal>": that is the direction, you may leave it out. Do not mention km marks (sKm); they are internal positions.`;

/** The app's screen summary (src/core/advisory/screen.ts) is a few hundred bytes. */
const MAX_SCREEN_BYTES = 6_000;

interface AssistRequestBody {
  tripBudgetInputs?: unknown;
  dieselPriceBasis?: unknown;
  question?: unknown;
  snapshot?: unknown;
  role?: unknown;
  driverPlate?: unknown;
  commuterStop?: unknown;
  destinationStop?: unknown;
  commuterKm?: unknown;
  dieselPricePhpPerLiter?: unknown;
  mode?: unknown;
  screen?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: AssistRequestBody;
  try {
    body = (await request.json()) as AssistRequestBody;
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_CHARS) {
    return Response.json(
      { error: `question must be 1–${MAX_QUESTION_CHARS} characters` },
      { status: 400 },
    );
  }

  const snapshotStr = JSON.stringify(body.snapshot ?? {});
  if (snapshotStr.length > MAX_SNAPSHOT_BYTES) {
    return Response.json({ error: 'snapshot too large' }, { status: 413 });
  }

  const planOpts: PlanOptions = {
    tripBudgetInputs:
      body.tripBudgetInputs && typeof body.tripBudgetInputs === 'object'
        ? (body.tripBudgetInputs as Partial<TripBudgetInputs>)
        : undefined,
    dieselPriceBasis:
      typeof body.dieselPriceBasis === 'string' ? body.dieselPriceBasis.slice(0, 180) : undefined,
    question,
    role:
      body.role === 'commuter' || body.role === 'driver' || body.role === 'operator'
        ? body.role
        : 'auto',
    driverPlate: typeof body.driverPlate === 'string' ? body.driverPlate : undefined,
    commuterStop: typeof body.commuterStop === 'string' ? body.commuterStop : undefined,
    destinationStop: typeof body.destinationStop === 'string' ? body.destinationStop : undefined,
    commuterKm: typeof body.commuterKm === 'number' ? body.commuterKm : undefined,
    dieselPricePhpPerLiter:
      typeof body.dieselPricePhpPerLiter === 'number' ? body.dieselPricePhpPerLiter : undefined,
  };

  // Always compute the deterministic math & FCFS conflict plan first ($0.00 cost).
  const plan = buildCommutePlan(body.snapshot, planOpts);
  const screenJson =
    body.screen && typeof body.screen === 'object' ? JSON.stringify(body.screen) : '';
  const screen = screenJson.length <= MAX_SCREEN_BYTES ? screenJson : '';
  const arrivals =
    !plan.tripBudget && screen ? arrivalAdvice(question, body.role, body.screen) : null;
  const directAnswer = arrivals || plan.directAnswer;

  // If math-only mode is requested, credit-saver is enabled, or Meta API is not configured,
  // return the deterministic answer directly without spending any Meta API credits.
  const mathOnly = body.mode === 'math' || creditSaverEnabled() || !metaConfigured();
  if (mathOnly || plan.tripBudget) {
    return Response.json({
      text: directAnswer,
      plan,
      creditUsed: false,
      source: 'deterministic-planner',
    });
  }

  // Build a compact summary of the pre-computed math so the LLM uses minimal tokens
  // and narrates the exact FCFS, drop-off, fuel, and ETA numbers.
  // Only the part of the plan this person needs: a commuter's question does
  // not pay for a driver's whole stop list, nor the other way round.
  // An operator (the Live twin, whole fleet) gets one jeepney's or one
  // stop's plan only when the question names it, and the busiest stops:
  // the same size with 20 jeepneys or 200.
  const role = plan.detectedRole;
  const q = question.toLowerCase();
  const named = (name: string | undefined) =>
    !!name && q.includes(name.split(/ \(| →/)[0]!.toLowerCase());
  const operator = role === 'operator';
  const stops = operator
    ? [...plan.stops].sort((a, b) => b.initialWaiting - a.initialWaiting).slice(0, OPERATOR_STOPS)
    : plan.stops;
  const compactComputed = {
    detectedRole: role,
    directAnswer,
    ...((role === 'driver' || (operator && named(plan.focusedDriverPlan?.plate))) && {
      focusedDriverPlan: plan.focusedDriverPlan,
    }),
    ...((role === 'commuter' || (operator && named(plan.focusedCommuterAdvice?.stopName))) && {
      focusedCommuterAdvice: plan.focusedCommuterAdvice,
    }),
    fcfsStops: stops.map((s) => ({
      name: s.name,
      waiting: s.initialWaiting,
      unclaimed: s.unclaimedWaiting,
      claimedBy: s.claimedBy,
    })),
  };

  // What the person sees, if the app sent it and it is small.
  const cacheKey = `${question}|${screen}|${JSON.stringify(compactComputed)}`;

  try {
    const { text, cached } = await chatWithCache(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            (screen ? `SCREEN:\n${screen}\n\n` : '') +
            `ComputedPlan:\n${JSON.stringify(compactComputed)}\n\nQuestion: ${question}`,
        },
      ],
      cacheKey,
      AbortSignal.timeout(25_000),
    );
    return Response.json({
      text,
      plan,
      creditUsed: !cached,
      cached,
      source: 'meta-ai',
    });
  } catch (err) {
    // Graceful fallback: if Meta API is unreachable, rate-limited or replies
    // with nothing during a live demo, return the deterministic planner's
    // answer so the UI never breaks. An empty reply was still billed.
    return Response.json({
      text: directAnswer,
      plan,
      creditUsed: err instanceof MetaEmptyReplyError,
      source: 'deterministic-fallback',
    });
  }
}
