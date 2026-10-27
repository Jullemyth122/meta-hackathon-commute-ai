/**
 * Ask Muse Spark about the current twin. The model receives a number-only
 * snapshot and is instructed to refuse rather than guess (see api/assist.ts).
 */

import { useState, type FormEvent } from 'react';
import { askAssistant } from '@/net/assist';

export function AssistPanel({ snapshot }: { snapshot: () => object }) {
  const [question, setQuestion] = useState(
    'Which jeepney should pick up the most waiting riders next?',
  );
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setAnswer(await askAssistant(question, snapshot()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h3 className="section__title">Ask the assistant</h3>
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
      {answer && <p className="assist__answer">{answer}</p>}
      {error && <p className="error">{error}</p>}
      <p className="fine">
        Answers use only the numbers on screen. Deterministic code decides; the model explains.
      </p>
    </section>
  );
}
