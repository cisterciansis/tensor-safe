import type { Vec } from '@polkadot/types';
import type { EventRecord } from '@polkadot/types/interfaces';
import { z } from 'zod';
import type { Chain } from './chain';

export type LeasePayout = {
  block: number;
  hash: string;
  eventIndex: number;
  contributor: string;
  alpha: string;
};

// Pages bound RPC work; the canonical parent hash is the continuation cursor.
export async function readLeaseHistory(
  api: Chain,
  leaseId: string,
  cursor: string,
) {
  z.string()
    .regex(/^\d{1,20}$/)
    .parse(leaseId);
  z.string()
    .regex(/^0x[0-9a-f]{64}$/i)
    .parse(cursor);
  const payouts: LeasePayout[] = [];
  let next: string | undefined = cursor;
  let oldest = 0;
  for (let i = 0; i < 25 && next; i++) {
    const hash: string = next;
    const [snapshot, header] = await Promise.all([
      api.at(hash),
      api.rpc.chain.getHeader(hash),
    ]);
    oldest = header.number.toNumber();
    const records =
      (await snapshot.query.system.events()) as unknown as Vec<EventRecord>;
    records.forEach(({ event }, eventIndex) => {
      if (
        event.section === 'subtensorModule' &&
        event.method === 'SubnetLeaseDividendsDistributed' &&
        event.data[0].toString() === leaseId
      ) {
        payouts.push({
          block: oldest,
          hash,
          eventIndex,
          contributor: event.data[1].toString(),
          alpha: event.data[2].toString(),
        });
      }
    });
    next = oldest === 0 ? undefined : header.parentHash.toHex();
  }
  return { payouts, next, oldest };
}
