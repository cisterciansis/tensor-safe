import assert from 'node:assert/strict';
import { encodeAddress } from '@polkadot/util-crypto';
import { operationSchema, accountAddress } from '../lib/domain';
import { controls, percentParts, childProportion } from '../lib/controls';
import { assertControlAuthority, type Chain } from '../lib/chain';
const wallet = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);
const account = {
  id: crypto.randomUUID(),
  name: 'Test',
  network: 'test' as const,
  threshold: 2,
  signers: [
    { name: 'A', address: wallet(1) },
    { name: 'B', address: wallet(2) },
  ],
};
const control = (action: string, args: unknown[]) => ({
  kind: 'control',
  action,
  args,
});
assert(operationSchema.safeParse(control('perpetual', ['1', false])).success);
assert(
  !operationSchema.safeParse(control('perpetual', ['1', 'false'])).success,
);
assert(!operationSchema.safeParse(control('tempo', ['1', '359'])).success);
assert(operationSchema.safeParse(control('tempo', ['1', '360'])).success);
assert(!operationSchema.safeParse(control('tempo', ['1', '50401'])).success);
assert(
  !operationSchema.safeParse(control('networkRegistration', ['1', true]))
    .success,
);
assert(
  !operationSchema.safeParse({ ...control('tempo', ['1', '360']), extra: true })
    .success,
);
assert(
  !controls.subnetIdentity.schema.safeParse([
    '1',
    'é'.repeat(129),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]).success,
);
assert.equal(percentParts('12.3456'), 123456);
assert.equal(childProportion(percentParts('100')), '18446744073709551615');
assert.throws(() => percentParts('100.0001'));
assert.throws(() => percentParts('1e2'));
const children = {
  kind: 'children',
  hotkey: wallet(1),
  netuid: '1',
  children: [{ address: wallet(3), proportion: '18446744073709551615' }],
};
assert(operationSchema.safeParse(children).success);
assert(
  !operationSchema.safeParse({
    ...children,
    children: [...children.children, { address: wallet(4), proportion: '1' }],
  }).success,
);
assert(
  !operationSchema.safeParse({
    ...children,
    children: [{ address: wallet(1), proportion: '1' }],
  }).success,
);
assert(
  !operationSchema.safeParse({
    ...children,
    children: [
      { address: wallet(3), proportion: '1' },
      {
        address: encodeAddress(new Uint8Array(32).fill(3), 0),
        proportion: '1',
      },
    ],
  }).success,
);
const codec = (s: string) => ({ toString: () => s });
let owner = wallet(1);
const mock = {
  query: {
    subtensorModule: {
      networksAdded: async () => codec('true'),
      subnetOwner: async () => codec(owner),
    },
  },
} as unknown as Chain;
const operation = operationSchema.parse(control('tempo', ['1', '360']));
await assert.rejects(
  assertControlAuthority(mock, account, [operation]),
  /owns this subnet/,
);
owner = accountAddress(account);
await assertControlAuthority(mock, account, [operation]);
console.log(
  'PASS guided call allowlist, UTF-8 limits, exact percentage encoding, child allocations and effective multisig ownership',
);
