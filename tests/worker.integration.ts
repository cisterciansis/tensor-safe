import assert from 'node:assert/strict';
import { encodeAddress } from '@polkadot/util-crypto';
import { responseSchema } from '../lib/domain';
const origin = 'http://localhost:8787';
async function send(path: string, body: unknown) {
  const r = await fetch(origin + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'oai-authenticated-user-id': 'worker-validation',
      'oai-authenticated-user-email': 'validation@example.test',
    },
    body: JSON.stringify(body),
  });
  const data = responseSchema.parse(await r.json());
  assert.equal(
    r.status,
    body && 'name' in Object(body) ? 201 : 200,
    JSON.stringify(data),
  );
  return data;
}
const workspace = await send('/api/workspaces', {
  name: 'Worker validation ' + Date.now(),
});
const address = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);
const account = {
  id: crypto.randomUUID(),
  name: 'Unfunded validation multisig',
  network: 'finney',
  threshold: 2,
  signers: [
    { name: 'A', address: address(1) },
    { name: 'B', address: address(2) },
  ],
};
const path = '/api/workspaces/' + workspace.id;
await send(path, { version: 0, command: { action: 'addAccount', account } });
const proposed = await send(path, {
  version: 1,
  command: {
    action: 'propose',
    id: crypto.randomUUID(),
    accountId: account.id,
    title: 'Validation only — not broadcast',
    operations: [{ kind: 'transfer', to: address(3), amount: '1' }],
  },
});
assert.equal(proposed.workspace!.proposals[0].status, 'proposed');
assert(proposed.workspace!.proposals[0].callHex.startsWith('0x'));
const control = await send(path, {
  version: 2,
  command: {
    action: 'propose',
    id: crypto.randomUUID(),
    accountId: account.id,
    title: 'Perpetual lock encoding only',
    operations: [{ kind: 'control', action: 'perpetual', args: ['1', false] }],
  },
});
assert.equal(control.workspace!.proposals[1].operations[0].kind, 'control');
const forbidden = await fetch(origin + path, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'oai-authenticated-user-id': 'worker-validation',
    'oai-authenticated-user-email': 'validation@example.test',
  },
  body: JSON.stringify({
    version: 3,
    command: {
      action: 'propose',
      id: crypto.randomUUID(),
      accountId: account.id,
      title: 'Ownership rejection check',
      operations: [{ kind: 'control', action: 'tempo', args: ['1', '360'] }],
    },
  }),
});
assert.equal(forbidden.status, 400);
assert.match(((await forbidden.json()) as { error: string }).error, /owns this subnet/);
console.log(
  'PASS compiled Worker auth, D1 persistence, live RPC, guided controls, owner authorization and immutable proposals; no broadcast',
);
