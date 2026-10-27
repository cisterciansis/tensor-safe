import assert from 'node:assert/strict';
import { reconcile, type Chain } from '../lib/chain';
import { accountAddress, type Account, type Proposal } from '../lib/domain';
import { encodeAddress } from '@polkadot/util-crypto';
const a = encodeAddress(new Uint8Array(32).fill(1)),
  b = encodeAddress(new Uint8Array(32).fill(2));
const account: Account = {
  id: 'a',
  name: 't',
  network: 'test',
  threshold: 2,
  signers: [
    { name: 'a', address: a },
    { name: 'b', address: b },
  ],
};
const p: Proposal = {
  id: 'p',
  accountId: 'a',
  title: 'p',
  operations: [],
  callHex: '0x0102',
  callHash: 'hash',
  genesisHash: 'genesis',
  specVersion: 1,
  createdAt: '',
  status: 'proposed',
};
const scalar = (value: string) => ({
  toString: () => value,
  toHex: () => value,
});
const event = (section: string, method: string, data: unknown[] = []) => ({
  phase: { isApplyExtrinsic: true, asApplyExtrinsic: { toNumber: () => 0 } },
  event: { section, method, data },
});
const executed = (ok: boolean, hash = 'hash') =>
  event('multisig', 'MultisigExecuted', [
    scalar(a),
    {},
    scalar(accountAddress(account)),
    scalar(hash),
    { isOk: ok },
  ]);
function chain(events: unknown[], final = 100, preimage = '0x0102'): Chain {
  return {
    genesisHash: scalar('genesis'),
    rpc: {
      chain: {
        getHeader: async (hash: string) => ({
          number: { toNumber: () => (hash === 'final' ? final : 100) },
        }),
        getFinalizedHead: async () => 'final',
        getBlockHash: async () => scalar('block'),
        getBlock: async () => ({
          block: {
            extrinsics: [
              {
                hash: scalar('tx'),
                method: {
                  section: 'multisig',
                  method: 'asMulti',
                  args: [0, 0, 0, scalar(preimage)],
                },
              },
            ],
          },
        }),
      },
    },
    at: async () => ({ query: { system: { events: async () => events } } }),
  } as unknown as Chain;
}
assert.equal(
  (await reconcile(chain([executed(true)]), account, p, 'block', 'tx')).outcome,
  'executed',
);
assert.equal(
  (await reconcile(chain([executed(false)]), account, p, 'block', 'tx'))
    .outcome,
  'failed',
);
await assert.rejects(() =>
  reconcile(chain([executed(true, 'wrong')]), account, p, 'block', 'tx'),
);
await assert.rejects(() =>
  reconcile(chain([executed(true)], 99), account, p, 'block', 'tx'),
);
await assert.rejects(() =>
  reconcile(chain([executed(true)], 100, 'wrong'), account, p, 'block', 'tx'),
);
await assert.rejects(() =>
  reconcile(
    chain([event('system', 'ExtrinsicFailed')]),
    account,
    p,
    'block',
    'tx',
  ),
);
const reserved = {
  ...p,
  attempt: { hash: 'tx', signer: a, expires: 128, nonce: '0' },
};
assert.equal(
  (
    await reconcile(
      chain([event('system', 'ExtrinsicFailed')]),
      account,
      reserved,
      'block',
      'tx',
    )
  ).outcome,
  'rejected',
);
assert.equal(
  (
    await reconcile(
      chain([event('multisig', 'MultisigApproval', [scalar('hash')])]),
      account,
      reserved,
      'block',
      'tx',
    )
  ).outcome,
  'approved',
);
await assert.rejects(() =>
  reconcile(
    chain([executed(true), event('proxy', 'ProxyExecuted', [{ isOk: false }])]),
    account,
    p,
    'block',
    'tx',
  ),
);
console.log(
  'PASS finalized exact-call matching, failed nested dispatch, approval-versus-payment and unrelated-failure rejection',
);
