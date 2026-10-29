import { connect } from '../lib/chain';
import { scanOwnerCredits } from '../lib/accrual';
const api = await connect('finney', true);
try {
  const hash = await api.rpc.chain.getFinalizedHead(),
    at = await api.at(hash),
    header = await api.rpc.chain.getHeader(hash);
  // SN1 keeps the legacy-seeded owner weight; SN41 set its own (10% at review).
  for (const netuid of [1, 41]) {
    const owner = (
        await at.query.subtensorModule.subnetOwner(netuid)
      ).toString(),
      hotkey = (
        await at.query.subtensorModule.subnetOwnerHotkey(netuid)
      ).toString();
    const result = await scanOwnerCredits(
      api,
      owner,
      {
        id: 'test',
        name: `Read-only SN${netuid}`,
        accountId: 'test',
        netuid,
        hotkey,
        startBlock: header.number.toNumber() - 2,
        revisions: [],
      },
      header.number.toNumber() - 2,
      header.number.toNumber(),
    );
    const epoch = Number(
      (
        await at.query.subtensorModule.lastMechansimStepBlock(netuid)
      ).toString(),
    );
    const payout = await scanOwnerCredits(
      api,
      owner,
      {
        id: 'test',
        name: 'Read-only epoch',
        accountId: 'test',
        netuid,
        hotkey,
        startBlock: epoch - 1,
        revisions: [],
      },
      epoch - 1,
      epoch,
    );
    if (BigInt(payout.amount) <= 0n)
      throw Error('Expected a positive epoch owner credit');
    console.log({ recent: result, epoch: payout });
  }
  console.log(
    'PASS read-only finalized archive continuity / runtime owner-cut reconstruction',
  );
} finally {
  await api.disconnect();
}
