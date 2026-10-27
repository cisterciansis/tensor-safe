import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import type { Workspace } from './domain';
export function db(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}
export async function identity() {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, 'Sign in to access your workspace');
  return user;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readWorkspace(id: string, userId: string) {
  const row = await db()
    .prepare(
      "SELECT w.*, CASE WHEN w.owner=? THEN 'owner' ELSE m.role END AS role FROM workspaces w LEFT JOIN members m ON m.workspace_id=w.id AND m.user_id=? WHERE w.id=? AND (w.owner=? OR m.user_id=?)",
    )
    .bind(userId, userId, id, userId, userId)
    .first<{
      id: string;
      name: string;
      state: string;
      version: number;
      role: Workspace['role'];
    }>();
  if (!row) throw new HttpError(404, 'Workspace not found');
  return {
    ...JSON.parse(row.state),
    id: row.id,
    name: row.name,
    version: row.version,
    role: row.role,
  } as Workspace;
}
export async function body(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    throw new HttpError(415, 'JSON required');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new HttpError(403, 'Request rejected');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'JSON body required');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 100000) {
      await reader.cancel();
      throw new HttpError(413, 'Request too large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(merged);
  return JSON.parse(text);
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === 'ZodError')
    return Response.json(
      {
        error: 'Invalid input',
        details: JSON.parse(error.message)
          .map((i: { message: string }) => i.message)
          .slice(0, 4),
      },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  console.error(
    'Workspace operation failed',
    error instanceof Error ? error.message : 'unknown',
  );
  return Response.json(
    { error: error instanceof Error ? error.message : 'Operation failed' },
    { status: 400 },
  );
}
export const noCache = { 'Cache-Control': 'no-store' };
