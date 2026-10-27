/**
 * POST /api/assist  { question: string, snapshot: object }  ->  { text: string }
 *
 * The model only explains numbers the simulation already computed. It is told
 * to refuse rather than invent: if a figure is not in the snapshot, it says so.
 * Deterministic code decides; the model narrates.
 */

import { chat, MetaConfigError } from './_lib/meta';

const MAX_QUESTION_CHARS = 500;
const MAX_SNAPSHOT_BYTES = 8_000;

const SYSTEM_PROMPT = `You are CommuteAI's operations assistant for Philippine jeepney transport.
Answer in at most 4 short sentences, in the language the user writes in.
Use ONLY the numbers in the JSON snapshot. Never invent counts, seats, ETAs or fares.
If the snapshot does not contain what is needed, say exactly which value is missing.
Be explicit about uncertainty: sensor counts are estimates, and a phone's GPS shows where
the phone is, not which jeepney it is in unless the trip phase is CONFIRMED.`;

export async function POST(request: Request): Promise<Response> {
  let body: { question?: unknown; snapshot?: unknown };
  try {
    body = (await request.json()) as typeof body;
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
  const snapshot = JSON.stringify(body.snapshot ?? {});
  if (snapshot.length > MAX_SNAPSHOT_BYTES) {
    return Response.json({ error: 'snapshot too large' }, { status: 413 });
  }

  try {
    const text = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Snapshot:\n${snapshot}\n\nQuestion: ${question}` },
      ],
      AbortSignal.timeout(25_000),
    );
    return Response.json({ text });
  } catch (err) {
    if (err instanceof MetaConfigError)
      return Response.json({ error: err.message }, { status: 503 });
    return Response.json({ error: 'Assistant unavailable' }, { status: 502 });
  }
}
