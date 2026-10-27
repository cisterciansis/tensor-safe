import assert from 'node:assert/strict';
import {
  commandSchema,
  accountSchema,
  accountAddress,
  accountKey,
  parseUnits,
  allocate,
  distributionSnapshot,
  holderStatement,
  ownersSchema,
  operationSchema,
} from '../lib/domain';
import { encodeAddress } from '@polkadot/util-crypto';
const a = encodeAddress(new Uint8Array(32).fill(1), 42),
  b = encodeAddress(new Uint8Array(32).fill(2), 42),
  c = encodeAddress(new Uint8Array(32).fill(3), 42);
const owners = [
  { name: 'A', address: a, bps: 3334 },
  { name: 'B', address: b, bps: 3333 },
  { name: 'C', address: c, bps: 3333 },
];
assert.equal(parseUnits('18446744073.709551615'), '18446744073709551615');
for (const v of [
  '-1',
  '1e9',
  '1.0000000001',
  '18446744073.709551616',
  '01.0',
  'NaN',
  '',
])
  assert.throws(() => parseUnits(v));
for (const total of [
  '1',
  '2',
  '100',
  '9007199254740993',
  '18446744073709551615',
]) {
  const result = allocate(total, owners);
  assert.equal(
    result.reduce((s, r) => s + BigInt(r.amount), 0n),
    BigInt(total),
  );
  assert.deepEqual(result, allocate(total, owners));
}
assert.equal(allocate('1', owners)[0].amount, '1');
assert.throws(() =>
  ownersSchema.parse([
    ...owners,
    { ...owners[0], address: encodeAddress(new Uint8Array(32).fill(1), 0) },
  ]),
);
assert.throws(() => ownersSchema.parse([{ name: 'A', address: a, bps: 9999 }]));
const account = accountSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Treasury',
  network: 'test',
  threshold: 2,
  signers: owners.map((o) => ({ name: o.name, address: o.address })),
});
assert.equal(
  accountAddress(account),
  accountAddress({ ...account, signers: [...account.signers].reverse() }),
);
assert.equal(
  accountKey(a),
  accountKey(encodeAddress(new Uint8Array(32).fill(1), 0)),
);
assert.throws(() => accountSchema.parse({ ...account, threshold: 4 }));
assert.throws(() =>
  operationSchema.parse({
    kind: 'transfer',
    to: a,
    amount: '100',
    admin: true,
  }),
);
const agreement = {
  id: 'agreement',
  name: 'SN',
  accountId: account.id,
  netuid: 1,
  hotkey: a,
  startBlock: 100,
  revisions: [{ id: 'revision', effectiveBlock: 101, owners }],
};
const first = distributionSnapshot(
  agreement,
  [],
  'one',
  200,
  '100',
  'declared report',
);
assert.equal(first.status, 'reserved');
assert.equal(first.provenance, 'declared');
assert.equal(first.fromBlock, 100);
assert.throws(() =>
  distributionSnapshot(agreement, [first], 'two', 200, '100', 'report'),
);
assert.throws(() =>
  distributionSnapshot(
    {
      ...agreement,
      revisions: [
        ...agreement.revisions,
        { id: 'next', effectiveBlock: 150, owners },
      ],
    },
    [],
    'two',
    200,
    '100',
    'report',
  ),
);
const second = distributionSnapshot(
  agreement,
  [first],
  'two',
  300,
  '100',
  'report',
);
assert.equal(second.fromBlock, 200);
console.log(
  'PASS exact amounts, conserved allocations, address identity, strict validation and non-overlapping revision intervals',
);

assert.throws(() =>
  commandSchema.parse({
    action: 'addAgreement',
    agreement: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'forged',
      accountId: account.id,
      netuid: 1,
      hotkey: a,
      startBlock: 100,
      revisions: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          effectiveBlock: 101,
          owners,
        },
      ],
      accrual: {
        fromBlock: 100,
        toBlock: 200,
        amount: '10',
        blockHash: '0x' + '01'.repeat(32),
        codeHash: '0x01',
        locked: false,
      },
    },
  }),
);
{
  const base = {
    agreementId: 'x',
    revisionId: 'r',
    fromBlock: 0,
    toBlock: 1,
    amount: '10',
    provenance: 'declared' as const,
    source: 's',
    proposalId: 'p',
  };
  const rows = holderStatement('x', [
    {
      ...base,
      id: '1',
      status: 'paid',
      allocations: [
        { name: 'A', address: a, bps: 5000, amount: '5' },
        { name: 'B', address: b, bps: 5000, amount: '5' },
      ],
    },
    {
      ...base,
      id: '2',
      status: 'reserved',
      allocations: [{ name: 'A', address: a, bps: 10000, amount: '7' }],
    },
    {
      ...base,
      id: '3',
      agreementId: 'y',
      status: 'paid',
      allocations: [{ name: 'A', address: a, bps: 10000, amount: '99' }],
    },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.paid, r.reserved]),
    [
      ['A', '5', '7'],
      ['B', '5', '0'],
    ],
  );
}
