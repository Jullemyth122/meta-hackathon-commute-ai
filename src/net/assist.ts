/** Client for /api/assist. Works under `vercel dev` or a deployment, not plain `vite`. */

export async function askAssistant(question: string, snapshot: object): Promise<string> {
  const res = await fetch('/api/assist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, snapshot }),
  });
  if (res.status === 404) throw new Error('No /api here. Run `vercel dev` or use the deployment.');
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Assistant failed (${res.status})`);
  return data.text ?? '';
}
