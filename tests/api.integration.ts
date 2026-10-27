import assert from 'node:assert/strict';
import { responseSchema } from '../lib/domain';
import { encodeAddress } from '@polkadot/util-crypto';
const origin = process.env.TEST_ORIGIN ?? 'http://localhost:3001';
const cookie = '__sites_local_auth=1';
async function call(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data: ReturnType<typeof responseSchema.parse>;
  try {
    data = responseSchema.parse(JSON.parse(text));
  } catch {
    data = { error: text };
  }
  return { status: r.status, data };
}
assert.equal((await fetch(origin + '/api/workspaces')).status, 401);
assert.equal(
  (await call('/api/workspaces', { name: 'Invalid', extra: true })).status,
  400,
);
assert.equal(
  (
    await call(
      '/api/workspaces',
      { name: 'Cross origin' },
      { Origin: 'https://elsewhere.example' },
    )
  ).status,
  403,
);
const created = await call('/api/workspaces', {
  name: 'Validation workspace ' + Date.now(),
});
assert.equal(created.status, 201);
const path = '/api/workspaces/' + created.data.id;
const address = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);
const account = {
  id: crypto.randomUUID(),
  name: 'Test-only treasury',
  network: 'test',
  threshold: 2,
  signers: [
    { name: 'Test A', address: address(1) },
    { name: 'Test B', address: address(2) },
  ],
};
assert.equal(
  (await call(path, { version: 0, command: { action: 'addAccount', account } }))
    .status,
  200,
);
assert.equal(
  (
    await call(path, {
      version: 0,
      command: {
        action: 'addContact',
        contact: { name: 'Stale', address: address(3) },
      },
    })
  ).status,
  409,
);
const races = await Promise.all(
  [3, 4].map((n) =>
    call(path, {
      version: 1,
      command: {
        action: 'addContact',
        contact: { name: 'Concurrent ' + n, address: address(n) },
      },
    }),
  ),
);
assert.deepEqual(
  races.map((r) => r.status).sort((a, b) => a - b),
  [200, 409],
);
let state = (await call(path)).data;
assert.equal(state.workspace!.version, 2);
assert.equal(state.workspace!.contacts.length, 1);
assert.equal(state.audit!.length, 3);
const agreement = {
  id: crypto.randomUUID(),
  name: 'Test-only agreement',
  accountId: account.id,
  netuid: 1,
  hotkey: address(5),
  startBlock: 100,
  revisions: [
    {
      id: crypto.randomUUID(),
      effectiveBlock: 101,
      owners: [
        { name: 'A', address: address(1), bps: 6000 },
        { name: 'B', address: address(2), bps: 4000 },
      ],
    },
  ],
};
assert.equal(
  (
    await call(path, {
      version: 2,
      command: { action: 'addAgreement', agreement },
    })
  ).status,
  200,
);
assert.equal(
  (
    await call(path, {
      version: 3,
      command: {
        action: 'reviseAgreement',
        id: agreement.id,
        revision: {
          id: crypto.randomUUID(),
          effectiveBlock: 101,
          owners: agreement.revisions[0].owners,
        },
      },
    })
  ).status,
  400,
);
state = (await call(path)).data;
assert.equal(state.workspace!.version, 3);
assert.equal(state.audit!.length, 4);
console.log(
  'PASS auth rejection, unknown-field validation, CSRF rejection, persistence, CAS collision and revision immutability',
);
console.log('Local validation workspace:', created.data.id);
