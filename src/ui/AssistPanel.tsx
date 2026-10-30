/**
 * Ask Muse Spark from the Live twin. With a jeepney selected, the question
 * is about that jeepney and sent exactly as its driver's app would send it;
 * with none, about the whole fleet (operatorScreen: totals and the busiest
 * stops). Either way the size, and so the cost, does not grow with the fleet.
 */

import { useState, type FormEvent } from 'react';
import type { PlannerRequest } from '@/core/advisory/plannerSnapshot';
import { askAs, type AssistAnswer } from '@/net/assist';

export function AssistPanel({
  about,
  request,
}: {
  /** The selected jeepney's plate, or null for the whole fleet. */
  about: string | null;
  request: () => PlannerRequest;
}) {
  const [question, setQuestion] = useState(
    'Which jeepney should pick up the most waiting riders next?',
  );
  const [answer, setAnswer] = useState<AssistAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAnswer(await askAs(question, request()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h3 className="section__title">Ask the assistant</h3>
      <p className="fine">
        {about
          ? `Asking about ${about}, the jeepney selected above.`
          : 'Asking about the whole fleet. Select a jeepney above to ask about it.'}
      </p>
      <form className="assist" onSubmit={submit}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          maxLength={500}
        />
        <button type="submit" className="btn btn--primary" disabled={busy || !question.trim()}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {answer && <p className="assist__answer">{answer.text}</p>}
      {error && <p className="error">{error}</p>}
      <p className="fine">
        Answers use only the numbers on screen. Deterministic code decides; the model explains.
      </p>
    </section>
  );
}
