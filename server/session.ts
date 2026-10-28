// Sign in with a wallet: the server issues a one-time message, the wallet
// signs it, and a verified signature opens an HttpOnly session.
import { randomBytes } from 'node:crypto';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { z } from 'zod';
import {
  SESSION_TTL_MS,
  SIGN_IN_TTL_MS,
  signInMessage,
  verifyWalletSignature,
} from '@/lib/auth';
import {
  HttpError,
  ORIGIN,
  body,
  db,
  failure,
  identity,
  noCache,
  sessionCookie,
  sessionToken,
  tokenHash,
} from '@/lib/server';

const ss58 = z
  .string()
  .max(64)
  .transform((v, ctx) => {
    try {
      const key = decodeAddress(v);
      if (key.length === 32) return encodeAddress(key, 42);
    } catch {}
    ctx.addIssue({ code: 'custom', message: 'Enter a valid wallet address' });
    return z.NEVER;
  });

export async function challenge(request: Request) {
  try {
    const { address } = z
      .object({ address: ss58 })
      .strict()
      .parse(await body(request));
    const now = Date.now();
    // Bound unauthenticated storage: a few live challenges per address, and overall.
    const live = await db()
      .prepare(
        'SELECT count(*) AS total, sum(CASE WHEN address=? THEN 1 ELSE 0 END) AS mine FROM challenges WHERE expires>?',
      )
      .bind(address, now)
      .first<{ total: number | string; mine: number | string | null }>();
    if (Number(live?.mine ?? 0) >= 5 || Number(live?.total ?? 0) >= 10_000)
      throw new HttpError(429, 'Too many sign-in attempts. Try again shortly.');
    const nonce = randomBytes(16).toString('hex');
    const message = signInMessage({
      origin: ORIGIN,
      address,
      nonce,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SIGN_IN_TTL_MS).toISOString(),
    });
    await db().batch([
      db().prepare('DELETE FROM challenges WHERE expires<?').bind(now),
      db().prepare('DELETE FROM sessions WHERE expires<?').bind(now),
      // Keep used nonces past expiry by a margin, in case server clocks differ.
      db()
        .prepare('DELETE FROM signed_nonces WHERE expires<?')
        .bind(now - 120_000),
      db()
        .prepare(
          'INSERT INTO challenges(nonce,address,message,expires) VALUES(?,?,?,?)',
        )
        .bind(nonce, address, message, now + SIGN_IN_TTL_MS),
    ]);
    return Response.json({ nonce, message }, { headers: noCache });
  } catch (e) {
    return failure(e);
  }
}

export async function signIn(request: Request) {
  try {
    const { nonce, signature } = z
      .object({
        nonce: z.string().regex(/^[0-9a-f]{32}$/),
        signature: z.string().regex(/^0x[0-9a-f]{128}$/),
      })
      .strict()
      .parse(await body(request));
    // Single use: the challenge is consumed whether or not the signature verifies.
    const row = await db()
      .prepare(
        'DELETE FROM challenges WHERE nonce=? RETURNING address,message,expires',
      )
      .bind(nonce)
      .first<{ address: string; message: string; expires: number }>();
    if (
      !row ||
      row.expires < Date.now() ||
      !verifyWalletSignature(row.message, signature, row.address)
    )
      throw new HttpError(401, 'Signature was not accepted. Try again.');
    const token = randomBytes(32).toString('base64url');
    await db()
      .prepare('INSERT INTO sessions(token_hash,address,expires) VALUES(?,?,?)')
      .bind(tokenHash(token), row.address, Date.now() + SESSION_TTL_MS)
      .run();
    return Response.json(
      { address: row.address },
      {
        headers: {
          ...noCache,
          'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / 1000),
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function current(request: Request) {
  try {
    const user = await identity(request);
    return Response.json({ address: user.userId }, { headers: noCache });
  } catch (e) {
    return failure(e);
  }
}

export async function signOut(request: Request) {
  const token = sessionToken(request);
  if (token)
    await db()
      .prepare('DELETE FROM sessions WHERE token_hash=?')
      .bind(tokenHash(token))
      .run();
  return Response.json(
    { ok: true },
    { headers: { ...noCache, 'Set-Cookie': sessionCookie('', 0) } },
  );
}
