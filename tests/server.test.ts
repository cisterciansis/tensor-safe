// Starts the real server on a temporary database and exercises wallet
// sign-in, sessions and signed changes over HTTP. No network access needed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keyring } from '@polkadot/keyring';
import { stringToU8a, u8aToHex, u8aWrapBytes } from '@polkadot/util';
import { changeMessage, payloadHash } from '../lib/auth';
import { contactSigned, workspaceSchema } from '../lib/domain';

const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
const [alice, bob] = ['//Alice', '//Bob'].map((u) => keyring.addFromUri(u));
const sign = (message: string, pair = alice) =>
  u8aToHex(pair.sign(u8aWrapBytes(stringToU8a(message))));

// TEST_ORIGIN points the suite at an already-running server (a container or
// staging). It creates test workspaces there, so never aim it at production.
const port = 18000 + Math.floor(Math.random() * 1000);
const origin = process.env.TEST_ORIGIN ?? `http://localhost:${port}`;
const dir = mkdtempSync(join(tmpdir(), 'tensor-safe-'));
const server = process.env.TEST_ORIGIN
  ? undefined
  : spawn('npx', ['tsx', 'server/main.ts'], {
      env: {
        ...process.env,
        PORT: String(port),
        PUBLIC_ORIGIN: origin,
        DATABASE_PATH: join(dir, 'test.db'),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
if (server)
  await new Promise<void>((ready) =>
    server.stdout!.on(
      'data',
      (d) => String(d).includes('listening') && ready(),
    ),
  );

async function call(path: string, body?: unknown, cookie = '', extra = {}) {
  const r = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    json: (await r.json()) as {
      id?: string;
      nonce?: string;
      message?: string;
      address?: string;
      workspace?: unknown;
      error?: string;
    },
    cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}
async function signIn(pair = alice, signer = pair) {
  const { json } = await call('/api/session/challenge', {
    address: pair.address,
  });
  return call('/api/session', {
    nonce: json.nonce,
    signature: sign(json.message!, signer),
  });
}

try {
  assert.equal((await call('/api/workspaces')).status, 401);

  // A signature from the wrong key fails, and the challenge is single use.
  const { json: ch } = await call('/api/session/challenge', {
    address: alice.address,
  });
  const forged = { nonce: ch.nonce, signature: sign(ch.message!, bob) };
  assert.equal((await call('/api/session', forged)).status, 401);
  const reused = { nonce: ch.nonce, signature: sign(ch.message!) };
  assert.equal((await call('/api/session', reused)).status, 401);

  const login = await signIn();
  assert.equal(login.status, 200);
  assert.match(login.cookie, /^ts_session=[A-Za-z0-9_-]{43}$/);
  const session = login.cookie;
  assert.equal(
    (await call('/api/session', undefined, session)).json.address,
    alice.address,
  );

  // Cross-origin writes are refused even with a valid session.
  assert.equal(
    (
      await call('/api/workspaces', { name: 'X' }, session, {
        Origin: 'https://evil.example',
      })
    ).status,
    403,
  );
  const { json: created } = await call(
    '/api/workspaces',
    { name: 'Treasury' },
    session,
  );
  const id = created.id as string;
  const path = `/api/workspaces/${id}`;

  const contact = { name: 'Validator ops', address: bob.address };
  const change = (
    c: typeof contact,
    signer = alice,
    nonce = 'c'.repeat(32),
  ) => {
    const message = changeMessage({
      origin,
      action: 'addContact',
      path,
      workspace: id,
      network: 'any',
      summary: `Add contact ${c.name}`,
      payload: payloadHash({ action: 'addContact', contact: c }),
      signer: signer.address,
      nonce,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    return {
      message,
      signature: sign(message, signer),
      signer: signer.address,
    };
  };
  const post = (command: unknown, version: number) =>
    call(path, { version, command }, session);

  // Unsigned, mis-signed, other-signer and payload-swapped changes fail.
  assert.equal((await post({ action: 'addContact', contact }, 0)).status, 400);
  const other = await post(
    { action: 'addContact', contact, attestation: change(contact, bob) },
    0,
  );
  assert.equal(other.status, 403);
  const swapped = await post(
    {
      action: 'addContact',
      contact: { ...contact, address: keyring.addFromUri('//Eve').address },
      attestation: change(contact),
    },
    0,
  );
  assert.equal(swapped.status, 403);

  const attestation = change(contact);
  const ok = await post({ action: 'addContact', contact, attestation }, 0);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // The same signature can't be replayed for a second change.
  const replay = await post(
    {
      action: 'addContact',
      contact,
      attestation,
    },
    1,
  );
  assert.notEqual(replay.status, 200);

  // A reused nonce is refused even for a different, validly signed change.
  const second = {
    name: 'Second',
    address: keyring.addFromUri('//Eve').address,
  };
  const reusedNonce = await post(
    { action: 'addContact', contact: second, attestation: change(second) },
    1,
  );
  assert.notEqual(reusedNonce.status, 200);
  assert.equal(
    (
      await post(
        {
          action: 'addContact',
          contact: second,
          attestation: change(second, alice, 'd'.repeat(32)),
        },
        1,
      )
    ).status,
    200,
  );

  // Every browser re-checks the stored signature.
  const { json: loaded } = await call(path, undefined, session);
  const w = workspaceSchema.parse(loaded.workspace);
  const stored = w.contacts[0];
  const verifier = { id, accounts: w.accounts, origin };
  assert.equal(contactSigned(verifier, stored), true);
  const tampered = { ...stored, address: keyring.addFromUri('//Eve').address };
  assert.equal(contactSigned(verifier, tampered), false);

  // A write against a stale version is refused, never merged.
  assert.equal(
    (await post({ action: 'rebuild', id: crypto.randomUUID() }, 0)).status,
    409,
  );

  // Members are wallet addresses; viewers can read but not write.
  assert.equal(
    (
      await post(
        { action: 'addMember', userId: bob.address, role: 'viewer' },
        2,
      )
    ).status,
    200,
  );
  const bobSession = (await signIn(bob)).cookie;
  assert.equal((await call(path, undefined, bobSession)).status, 200);
  assert.equal(
    (
      await call(
        path,
        { version: 3, command: { action: 'rebuild', id } },
        bobSession,
      )
    ).status,
    403,
  );

  // A manager who isn't a co-signer can't redirect cap-table payouts (review H1).
  const dave = keyring.addFromUri('//Dave');
  const signedBy = (
    pair: typeof alice,
    action: string,
    command: unknown,
    nonce: string,
  ) => {
    const message = changeMessage({
      origin,
      action,
      path,
      workspace: id,
      network: 'test',
      summary: action,
      payload: payloadHash(command),
      signer: pair.address,
      nonce,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    return { message, signature: sign(message, pair), signer: pair.address };
  };
  const account = {
    id: crypto.randomUUID(),
    name: 'Treasury',
    network: 'test',
    threshold: 2,
    signers: [
      { name: 'Alice', address: alice.address },
      { name: 'Charlie', address: keyring.addFromUri('//Charlie').address },
    ],
  };
  const addAccount = { action: 'addAccount', account };
  assert.equal(
    (
      await post(
        {
          ...addAccount,
          attestation: signedBy(
            alice,
            'addAccount',
            addAccount,
            'e'.repeat(32),
          ),
        },
        3,
      )
    ).status,
    200,
  );
  const agreement = {
    id: crypto.randomUUID(),
    name: 'Seed',
    accountId: account.id,
    netuid: 1,
    hotkey: alice.address,
    startBlock: 10,
    revisions: [
      {
        id: crypto.randomUUID(),
        effectiveBlock: 11,
        owners: [{ name: 'Alice', address: alice.address, bps: 10000 }],
      },
    ],
  };
  const addAgreement = { action: 'addAgreement', agreement };
  assert.equal(
    (
      await post(
        {
          ...addAgreement,
          attestation: signedBy(
            alice,
            'addAgreement',
            addAgreement,
            'f'.repeat(32),
          ),
        },
        4,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        { action: 'addMember', userId: dave.address, role: 'manager' },
        5,
      )
    ).status,
    200,
  );
  const daveSession = (await signIn(dave)).cookie;
  const revise = {
    action: 'reviseAgreement',
    id: agreement.id,
    revision: {
      id: crypto.randomUUID(),
      effectiveBlock: 50,
      owners: [{ name: 'Dave', address: dave.address, bps: 10000 }],
    },
  };
  const redirect = await call(
    path,
    {
      version: 6,
      command: {
        ...revise,
        attestation: signedBy(dave, 'reviseAgreement', revise, '1'.repeat(32)),
      },
    },
    daveSession,
  );
  assert.equal(redirect.status, 403, JSON.stringify(redirect.json));
  // Nested signature blobs inside a command are refused.
  const nested = {
    action: 'addContact',
    contact: { ...second, name: 'Nested', attestation: change(second) },
  };
  assert.equal(
    (
      await post(
        { ...nested, attestation: change(second, alice, '2'.repeat(32)) },
        6,
      )
    ).status,
    400,
  );

  // Signing out ends the session.
  const out = await fetch(origin + '/api/session', {
    method: 'DELETE',
    headers: { Cookie: session },
  });
  assert.equal(out.status, 200);
  assert.equal((await call('/api/workspaces', undefined, session)).status, 401);
  console.log(
    'PASS wallet sign-in, single-use challenges, sessions, origin checks, signed changes, replay rejection and member roles',
  );
} finally {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
}
