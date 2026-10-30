/**
 * Ask the assistant as this driver or commuter, by typing or by voice.
 *
 * Nothing is sent until the person asks: typing does not count, a tap on a
 * suggestion, Ask or the mic does. The mic records one question, in either
 * of two ways:
 *
 *   tap    talk, pause as you like; 2.5 s of quiet sends it (the countdown
 *          shows), or tap again to send now
 *   hold   talk while holding the mic, let go to send; pauses never end it
 *
 * Only that recording is sent (see net/voice.ts). The answer is read out,
 * with pause, resume and stop, in the voice the person picks. Hands-free
 * listens for "Hey Commute, ..." where the browser supports it. "Free
 * answer" asks the planner only, which never spends Meta credit; the line
 * under each answer says what it cost.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlannerRequest } from '@/core/advisory/plannerSnapshot';
import { askAs, type AssistAnswer } from '@/net/assist';
import {
  hasFilipinoVoice,
  listen,
  looksTagalog,
  micSupported,
  record,
  speech,
  transcribe,
  voices,
  voiceSupported,
  type Recording,
  type SpeechState,
} from '@/net/voice';

function costLine(a: AssistAnswer): string {
  if (a.source === 'meta-ai')
    return a.creditUsed ? 'Meta AI · used credit' : 'Meta AI · cached, no credit';
  if (a.source === 'deterministic-fallback') return 'Planner (Meta AI unreachable) · no credit';
  return 'Planner · no credit';
}

type Mic = 'idle' | 'recording' | 'holding' | 'transcribing';
/** Pressed longer than this, the mic is being held (push to talk). */
const HOLD_MS = 350;
/** Must match SILENCE_S in net/voice.ts: for the "sending in…" countdown. */
const SEND_AFTER_QUIET_S = 2.5;
const VOICE_KEY = 'commuteai.voice';

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The voice the person picked, remembered on this device ('' = automatic). */
function useVoiceChoice(): [string, (uri: string) => void, SpeechSynthesisVoice[]] {
  const [choice, setChoice] = useState(() => {
    try {
      return localStorage.getItem(VOICE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [list, setList] = useState(voices);
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    // Browsers load their voice list a moment after the page.
    const update = () => setList(voices());
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  const pick = (uri: string) => {
    setChoice(uri);
    try {
      localStorage.setItem(VOICE_KEY, uri);
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
  };
  return [choice, pick, list];
}

export function AskBox({
  suggestions,
  request,
  keywords = [],
  handsFree = false,
}: {
  suggestions: string[];
  /** Built when asked, so it carries the numbers of that moment. */
  request: () => PlannerRequest;
  /** Words to listen for when transcribing (stop names, fare words). */
  keywords?: string[];
  /** Offer listening for the wake phrase (the driver: eyes on the road). */
  handsFree?: boolean;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mathOnly, setMathOnly] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<{ sentence: string; addressed: boolean } | null>(null);
  const [mic, setMic] = useState<Mic>('idle');
  const [level, setLevel] = useState(0);
  const [quiet, setQuiet] = useState(0);
  const [spoken, setSpoken] = useState<SpeechState>(speech.state());
  const [voice, setVoice, voiceList] = useVoiceChoice();
  const recording = useRef<Recording | null>(null);
  const pressedAt = useRef(0);
  const holding = useRef(false);
  const questionHistory = useRef<string[]>([]);

  const [serverVoice, setServerVoice] = useState(speech.serverVoice());
  useEffect(() => speech.subscribe(setSpoken), []);
  useEffect(() => speech.subscribeServerVoice(setServerVoice), []);

  // The latest closure, so long-lived voice callbacks never ask with stale numbers.
  const ask = useRef<(q: string, aloud?: boolean) => Promise<void>>(async () => {});
  ask.current = async (q: string, aloud = false) => {
    if (!q.trim() || busy) return;
    speech.stop();
    setQuestion(q);
    setBusy(true);
    setError(null);
    try {
      const a = await askAs(q, request(), mathOnly ? 'math' : 'ai', questionHistory.current);
      setAnswer(a);
      questionHistory.current = [...questionHistory.current, q].slice(-4);
      // Asked by voice, answered by voice: eyes stay on the road.
      if (aloud || listening) speech.speak(a.text, voice);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** End the recording, turn it into text, and ask it. */
  const send = useRef(async () => {});
  send.current = async () => {
    const rec = recording.current;
    if (!rec) return;
    recording.current = null;
    holding.current = false;
    setMic('transcribing');
    try {
      const text = await transcribe(await rec.stop(), keywords);
      if (text) void ask.current(text, true);
      else setError('Didn’t catch that. Tap the mic and try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMic('idle');
      setLevel(0);
      setQuiet(0);
    }
  };

  async function pressMic() {
    pressedAt.current = performance.now();
    holding.current = true;
    if (mic === 'recording') return void send.current(); // second tap: send now
    if (mic !== 'idle') return;
    setError(null);
    speech.stop();
    try {
      recording.current = await record(
        () => void send.current(),
        () => !holding.current,
      );
      setMic(holding.current ? 'holding' : 'recording');
    } catch (err) {
      holding.current = false;
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setError(denied ? 'Microphone permission denied.' : 'No microphone available.');
    }
  }

  function releaseMic() {
    const held = performance.now() - pressedAt.current >= HOLD_MS;
    holding.current = false;
    if (!recording.current) return;
    // Held down: letting go sends. A quick tap leaves it listening.
    if (held) void send.current();
    else setMic('recording');
  }

  // Level meter and quiet countdown while recording; drop any recording if the panel closes.
  useEffect(() => {
    if (mic !== 'recording' && mic !== 'holding') return;
    const id = window.setInterval(() => {
      setLevel(recording.current?.level() ?? 0);
      setQuiet(recording.current?.quiet() ?? 0);
    }, 100);
    return () => window.clearInterval(id);
  }, [mic]);
  useEffect(
    () => () => {
      recording.current?.cancel();
      speech.stop();
    },
    [],
  );

  useEffect(() => {
    if (!listening) return;
    return listen(
      (q) => void ask.current(q),
      (sentence, addressed) => setHeard({ sentence, addressed }),
      (message) => {
        setError(message);
        setListening(false);
      },
    );
  }, [listening]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask.current(question);
  }

  const status =
    mic === 'holding'
      ? 'Listening… let go to send.'
      : mic === 'recording'
        ? quiet >= 0.8
          ? `Sending in ${Math.max(0, SEND_AFTER_QUIET_S - quiet).toFixed(1)} s… keep talking to continue, or tap to send now.`
          : 'Listening… pause as you like. Tap the mic to send, or hold it next time to talk.'
        : mic === 'transcribing'
          ? 'Turning your voice into text…'
          : null;

  return (
    <div className="ask">
      <div className="row">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="chip ask__suggestion"
            onClick={() => void ask.current(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <form className="assist" onSubmit={submit}>
        <textarea
          value={question}
          placeholder="Ask about your trip, or tap the mic…"
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          maxLength={500}
        />
        <div className="ask__actions">
          {micSupported() && (
            <button
              type="button"
              className={`btn ask__mic ask__mic--${mic}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                void pressMic();
              }}
              onPointerUp={releaseMic}
              onPointerCancel={releaseMic}
              onContextMenu={(e) => e.preventDefault()}
              disabled={busy || mic === 'transcribing'}
              aria-pressed={mic === 'recording' || mic === 'holding'}
              aria-label={mic === 'idle' ? 'Ask by voice (tap or hold)' : 'Send'}
              title={mic === 'idle' ? 'Tap to talk, or hold while talking' : 'Send'}
              style={{ ['--level' as string]: level }}
            >
              <MicIcon />
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy || !question.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </form>
      {status && (
        <p className="fine" role="status">
          {status}
        </p>
      )}
      <label className="toggle">
        <input type="checkbox" checked={mathOnly} onChange={(e) => setMathOnly(e.target.checked)} />
        <span>Free answer (planner only, never uses AI credit)</span>
      </label>
      {handsFree && voiceSupported() && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={listening}
            onChange={(e) => setListening(e.target.checked)}
          />
          <span>
            Hands-free: say “Hey Commute, …”. Anything else said is ignored and costs nothing.
          </span>
        </label>
      )}
      {listening && heard && (
        <p className="fine">
          Heard “{heard.sentence}” · {heard.addressed ? 'asked' : 'ignored, not sent'}
        </p>
      )}
      {answer && (
        <>
          <p className="assist__answer">{answer.text}</p>
          <div className="ask__speech">
            {spoken === 'idle' && (
              <button
                type="button"
                className="chip"
                onClick={() => speech.speak(answer.text, voice)}
              >
                ▶ Read aloud
              </button>
            )}
            {spoken === 'speaking' && (
              <button type="button" className="chip" onClick={() => speech.pause()}>
                ❚❚ Pause
              </button>
            )}
            {spoken === 'paused' && (
              <button type="button" className="chip" onClick={() => speech.resume()}>
                ▶ Resume
              </button>
            )}
            {spoken !== 'idle' && (
              <button type="button" className="chip" onClick={() => speech.stop()}>
                ■ Stop
              </button>
            )}
            {voiceList.length > 0 && (
              <select
                className="ask__voice"
                aria-label="Reading voice"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
              >
                <option value="">Voice: automatic</option>
                {voiceList.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            )}
          </div>
          {looksTagalog(answer.text) &&
            serverVoice === 'off' &&
            voiceList.length > 0 &&
            !hasFilipinoVoice(voiceList) && (
              <p className="fine">
                No Filipino voice here, so Tagalog is read in English. Set ELEVENLABS_API_KEY or
                AZURE_SPEECH_KEY on the server (api/speak.ts) for a Filipino voice.
              </p>
            )}
          <p className="fine">{costLine(answer)}</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
