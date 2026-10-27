/** GET /api/health -> which server features are configured. Never echoes secrets. */

import { metaConfigured } from './_lib/meta';

export function GET(): Response {
  return Response.json({ ok: true, assistant: metaConfigured() });
}
