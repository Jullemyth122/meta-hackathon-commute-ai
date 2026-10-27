/**
 * Minimal client for Meta's OpenAI-compatible chat completions endpoint.
 * Server-only: it reads META_API_KEY, which must never reach the browser.
 * (Files under api/_lib are not exposed as routes by Vercel.)
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class MetaConfigError extends Error {}

export function metaConfigured(): boolean {
  return Boolean(process.env.META_API_KEY && process.env.META_MODEL);
}

export async function chat(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const key = process.env.META_API_KEY;
  const model = process.env.META_MODEL;
  const base = process.env.META_API_BASE ?? 'https://api.llama.com/compat/v1';
  if (!key || !model) throw new MetaConfigError('META_API_KEY and META_MODEL must be set');

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 300 }),
    signal,
  });
  if (!res.ok) {
    // Log the upstream body server-side; return only the status to the client.
    console.error('Meta API error', res.status, await res.text().catch(() => ''));
    throw new Error(`Meta API responded ${res.status}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
