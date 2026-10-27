import assert from 'node:assert/strict';
import type { Chain } from '../lib/chain';
import { readLeaseHistory } from '../lib/lease-history';
const hash = (height: number) => '0x' + height.toString(16).padStart(64, '0');
const event = (id: string) => ({
  event: {
    section: 'subtensorModule',
    method: 'SubnetLeaseDividendsDistributed',
    data: [id, 'contributor', '123'],
  },
});
let fail = false;
const api = {
  at: async (h: string) => ({
    query: {
      system: {
        events: async () => {
          if (fail) throw Error('pruned state');
          return Number(BigInt(h)) === 26
            ? [event('7'), event('8'), event('7')]
            : [];
        },
      },
    },
  }),
  rpc: {
    chain: {
      getHeader: async (h: string) => {
        const n = Number(BigInt(h));
        return {
          number: { toNumber: () => n },
          parentHash: { toHex: () => hash(n - 1) },
        };
      },
    },
  },
} as unknown as Chain;
const first = await readLeaseHistory(api, '7', hash(30));
assert.equal(first.oldest, 6);
assert.equal(first.next, hash(5));
assert.deepEqual(
  first.payouts.map((p) => p.eventIndex),
  [0, 2],
);
assert(first.payouts.every((p) => p.hash === hash(26) && p.alpha === '123'));
const last = await readLeaseHistory(api, '7', first.next!);
assert.equal(last.oldest, 0);
assert.equal(last.next, undefined);
fail = true;
await assert.rejects(readLeaseHistory(api, '7', hash(30)), /pruned state/);
await assert.rejects(readLeaseHistory(api, '7', 'bad cursor'));
console.log(
  'PASS lease history pagination, genesis termination, event identity and failed-page rejection',
);
