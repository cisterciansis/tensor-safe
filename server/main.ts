// One small Node server: the JSON API plus the built single-page app.
import { createServer, type IncomingMessage } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { ORIGIN, SECURE, openStore } from '@/lib/server';
import { challenge, current, signIn, signOut } from './session';
import { createWorkspace, listWorkspaces } from './workspaces';
import { getWorkspace, updateWorkspace } from './workspace';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = process.env.STATIC_DIR;
const RPC = [
  'wss://entrypoint-finney.opentensor.ai',
  'https://entrypoint-finney.opentensor.ai',
  'wss://test.finney.opentensor.ai',
  'https://test.finney.opentensor.ai',
];
// Scripts and data only from this origin and the Bittensor RPC endpoints.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${RPC.join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  ...(SECURE
    ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' }
    : {}),
};
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};
const UUID =
  /^\/api\/workspaces\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// Fixed-window limit per client; enough to blunt sign-in abuse. Memory is
// bounded by evicting the oldest windows, never by resetting everyone.
const hits = new Map<string, { count: number; reset: number }>();
function limited(key: string, limit: number) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.delete(key);
    if (hits.size >= 20_000)
      for (const old of [...hits.keys()].slice(0, 2_000)) hits.delete(old);
    hits.set(key, { count: 1, reset: now + 60_000 });
    return false;
  }
  return ++entry.count > limit;
}
/** One bucket per IPv4 address or IPv6 /64, which one host can't escape. */
function clientKey(ip: string) {
  const v4 = ip.replace(/^::ffff:/, '');
  if (!v4.includes(':')) return v4;
  const [head, tail = ''] = v4.split('::');
  const groups = [
    ...head.split(':').filter(Boolean),
    ...Array(8).fill('0'),
  ].slice(0, 8 - tail.split(':').filter(Boolean).length);
  return [...groups, ...tail.split(':').filter(Boolean)].slice(0, 4).join(':');
}

function route(request: Request): Promise<Response> | Response {
  const { pathname } = new URL(request.url);
  const { method } = request;
  if (pathname === '/api/session/challenge' && method === 'POST')
    return challenge(request);
  if (pathname === '/api/session')
    return method === 'GET'
      ? current(request)
      : method === 'POST'
        ? signIn(request)
        : method === 'DELETE'
          ? signOut(request)
          : notAllowed();
  if (pathname === '/api/workspaces')
    return method === 'GET'
      ? listWorkspaces(request)
      : method === 'POST'
        ? createWorkspace(request)
        : notAllowed();
  const workspace = pathname.match(UUID)?.[1];
  if (workspace)
    return method === 'GET'
      ? getWorkspace(request, workspace)
      : method === 'POST'
        ? updateWorkspace(request, workspace)
        : notAllowed();
  return Response.json({ error: 'Not found' }, { status: 404 });
}
const notAllowed = () =>
  Response.json({ error: 'Method not allowed' }, { status: 405 });

async function staticFile(pathname: string): Promise<Response> {
  const notFound = () => new Response('Not found', { status: 404 });
  if (!STATIC_DIR) return notFound();
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  // No dotfiles and nothing outside the build, even through a symlink.
  if (
    decoded.includes('\0') ||
    decoded.split('/').some((p) => p.startsWith('.'))
  )
    return notFound();
  const root = await realpath(resolve(STATIC_DIR));
  const inside = (p: string) => p === root || p.startsWith(root + sep);
  const target = resolve(root, '.' + normalize(decoded));
  const real = await realpath(target).catch(() => null);
  const file =
    real && inside(real) && (await stat(real)).isFile()
      ? real
      : extname(decoded)
        ? null
        : join(root, 'index.html'); // client-side routes
  if (!file || !inside(target)) return notFound();
  return new Response(await readFile(file), {
    headers: {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Hashed build assets never change; the HTML always revalidates.
      'Cache-Control': decoded.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    },
  });
}

function toRequest(req: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (typeof value === 'string') headers.set(name, value);
    else if (value) for (const v of value) headers.append(name, v);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(new URL(req.url ?? '/', ORIGIN), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // @ts-expect-error Node requires half-duplex for streamed request bodies.
    duplex: hasBody ? 'half' : undefined,
  });
}

// Sign-in and origin checks bind to PUBLIC_ORIGIN: when serving the app it
// must be set explicitly, and be a bare origin (no path or trailing slash).
if (STATIC_DIR && !process.env.PUBLIC_ORIGIN)
  throw Error('Set PUBLIC_ORIGIN to the https origin users load');
if (new URL(ORIGIN).origin !== ORIGIN)
  throw Error(
    'PUBLIC_ORIGIN must be a bare origin, e.g. https://safe.example.com',
  );
await openStore();
createServer(async (req, res) => {
  let response: Response;
  try {
    const request = toRequest(req);
    const { pathname } = new URL(request.url);
    const api = pathname.startsWith('/api/');
    // Behind our TLS proxy (Caution's Caddy) the client is the right-most
    // X-Forwarded-For hop: the one the proxy added. Earlier hops are client-supplied.
    const forwarded = process.env.TRUST_PROXY
      ? String(req.headers['x-forwarded-for'] ?? '')
          .split(',')
          .at(-1)!
          .trim()
      : '';
    const ip = clientKey(forwarded || req.socket.remoteAddress || '');
    response = api
      ? (
          pathname.startsWith('/api/session')
            ? limited(`${ip}:session`, 20)
            : limited(ip, 300)
        )
        ? Response.json({ error: 'Too many requests' }, { status: 429 })
        : await route(request)
      : ['GET', 'HEAD'].includes(request.method)
        ? await staticFile(pathname)
        : new Response('Method not allowed', { status: 405 });
  } catch (e) {
    console.error('Request failed', e instanceof Error ? e.message : e);
    response = Response.json({ error: 'Server error' }, { status: 500 });
  }
  const headers: Record<string, string | string[]> = { ...SECURITY_HEADERS };
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(
    req.method === 'HEAD'
      ? undefined
      : Buffer.from(await response.arrayBuffer()),
  );
}).listen(PORT, () =>
  console.log(`Tensor Safe listening on :${PORT} for ${ORIGIN}`),
);
