import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { join } from 'node:path';
import { openPostgres, openSqlite, type Database } from '@/server/db';
import type { Workspace } from './domain';

// The one origin users reach the app on. Sign-in and signed changes bind it,
// and same-origin checks compare against it, never a client Host header.
export const ORIGIN = process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000';
export const SECURE = ORIGIN.startsWith('https://');
const SESSION_COOKIE = SECURE ? '__Host-ts_session' : 'ts_session';

// With DATA_KEY set, workspace state and audit details are sealed at rest
// (AES-256-GCM, bound to their workspace and column), so the database host can
// neither read nor transplant them. It could still restore an older copy;
// wallet-signed records and on-chain checks guard what decides payments.
const KEY = process.env.DATA_KEY
  ? Buffer.from(process.env.DATA_KEY, 'base64')
  : undefined;
if (KEY && KEY.length !== 32) throw Error('DATA_KEY must be 32 bytes, base64');
const SEALED = 'enc:v1:';
export function seal(text: string, binding: string) {
  if (!KEY) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv).setAAD(
    Buffer.from(binding),
  );
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return (
    SEALED + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
  );
}
export function unseal(stored: string, binding: string) {
  if (!stored.startsWith(SEALED)) {
    // Fail closed: an encrypted store never accepts a plaintext row.
    if (KEY) throw Error('Unsealed record in an encrypted store');
    return stored;
  }
  if (!KEY) throw Error('DATA_KEY is required to read this store');
  const raw = Buffer.from(stored.slice(SEALED.length), 'base64');
  if (raw.length < 28) throw Error('Sealed record is truncated');
  // A full 16-byte tag only: GCM would otherwise accept truncated tags.
  const decipher = createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12), {
    authTagLength: 16,
  })
    .setAAD(Buffer.from(binding))
    .setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}

/** Ties sealed audit details to their row, so they can't be swapped between rows. */
export const auditBinding = (
  workspace: string,
  row: string,
  version: number,
  actor: string,
  action: string,
) => `${workspace}:audit:${row}:${version}:${actor}:${action}`;

let database: Database | undefined;
/** Opens storage and applies migrations; call once before serving requests. */
export async function openStore() {
  const root = process.env.DB_DIR ?? join(process.cwd(), 'db');
  database = process.env.DATABASE_URL
    ? await openPostgres(process.env.DATABASE_URL, join(root, 'migrations-pg'))
    : openSqlite(
        process.env.DATABASE_PATH ?? 'data/tensor-safe.db',
        join(root, 'migrations'),
      );
}
export function db() {
  if (!database) throw Error('Storage is not open');
  return database;
}

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export function sessionCookie(token: string, maxAgeSeconds: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${SECURE ? '; Secure' : ''}`;
}
export function sessionToken(request: Request) {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9_-]{43})(?:;|$)`),
  );
  return match?.[1];
}
/** The signed-in wallet address. Members and owners are wallet addresses. */
export async function identity(request: Request) {
  const token = sessionToken(request);
  const row = token
    ? await db()
        .prepare(
          'SELECT address FROM sessions WHERE token_hash=? AND expires>?',
        )
        .bind(tokenHash(token), Date.now())
        .first<{ address: string }>()
    : null;
  if (!row) throw new HttpError(401, 'Sign in with your wallet to continue');
  return { userId: row.address, displayName: row.address };
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
    ...JSON.parse(unseal(row.state, `${row.id}:state`)),
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
  if (origin && origin !== ORIGIN) throw new HttpError(403, 'Request rejected');
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
  if (error instanceof Error && error.message.includes('signed_nonces'))
    return Response.json(
      { error: 'This signed change was already used. Sign it again.' },
      { status: 409 },
    );
  if (error instanceof SyntaxError)
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  console.error(
    'Workspace operation failed',
    error instanceof Error ? error.message : 'unknown',
  );
  // Plain Errors carry the app's own user-facing rule messages. Database,
  // decoding and runtime errors (subclasses or coded) stay in the server log.
  const userFacing =
    error instanceof Error &&
    error.constructor === Error &&
    !('code' in error);
  return Response.json(
    { error: userFacing ? error.message : 'Operation failed' },
    { status: 400 },
  );
}
export const noCache = { 'Cache-Control': 'no-store' };
