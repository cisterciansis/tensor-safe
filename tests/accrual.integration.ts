import { connect } from '../lib/chain';
import { scanOwnerCredits } from '../lib/accrual';
const api = await connect('finney', true);
try {
  const hash = await api.rpc.chain.getFinalizedHead(),
    at = await api.at(hash),
    header = await api.rpc.chain.getHeader(hash);
  const owner = (await at.query.subtensorModule.subnetOwner(1)).toString(),
    hotkey = (await at.query.subtensorModule.subnetOwnerHotkey(1)).toString();
  const result = await scanOwnerCredits(
    api,
    owner,
    {
      id: 'test',
      name: 'Read only SN1',
      accountId: 'test',
      netuid: 1,
      hotkey,
      startBlock: header.number.toNumber() - 2,
      revisions: [],
    },
    header.number.toNumber() - 2,
    header.number.toNumber(),
  );
  const epoch = Number(
    (await at.query.subtensorModule.lastMechansimStepBlock(1)).toString(),
  );
  const payout = await scanOwnerCredits(
    api,
    owner,
    {
      id: 'test',
      name: 'Read-only epoch',
      accountId: 'test',
      netuid: 1,
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
  console.log(
    'PASS read-only finalized archive continuity / runtime owner-cut reconstruction',
  );
} finally {
  await api.disconnect();
}
