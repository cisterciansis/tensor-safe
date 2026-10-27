import type { Chain } from './chain';
import { accountKey, unitsSchema, type Agreement } from './domain';
// Validated Finney runtime 454 code hash; new code requires an explicit model review.
const VERIFIED_CODE =
  '0x725e3d1eca8d5c29c1f0fa6476d5360661b852f52aebad979d6636e227a431ef';
export type OwnerState = {
  pending: string;
  alphaOut: string;
  cut: string;
  eligible: boolean;
  enabled: boolean;
  epoch: number;
  owner: string;
  hotkey: string;
  registered: string;
  leased: boolean;
  autoLock: boolean;
};
export function ownerCredit(
  parent: OwnerState,
  current: OwnerState,
  height: number,
) {
  if (
    parent.registered !== current.registered ||
    parent.owner !== current.owner ||
    parent.hotkey !== current.hotkey
  )
    throw Error(
      'Subnet identity changed; reconcile this interval independently',
    );
  if (parent.leased || current.leased)
    throw Error(
      'Native leases require residual accounting and are excluded from automatic private accrual',
    );
  const cut = BigInt(parent.cut);
  if (cut < 0n || cut > 65535n) throw Error('Invalid runtime owner cut');
  const increment =
    parent.eligible && parent.enabled
      ? (BigInt(current.alphaOut) * ((cut << 32n) / 65535n)) >> 32n
      : 0n;
  const sum = BigInt(parent.pending) + increment;
  const pending = sum > 18446744073709551615n ? 18446744073709551615n : sum;
  if (current.epoch === height) {
    if (BigInt(current.pending) !== 0n)
      throw Error('Epoch owner-cut state is inconsistent');
    return pending;
  }
  if (BigInt(current.pending) !== pending)
    throw Error('Archive owner-cut continuity check failed');
  return 0n;
}
export async function scanOwnerCredits(
  api: Chain,
  sourceAddress: string,
  agreement: Agreement,
  from: number,
  to: number,
) {
  if (to <= from || to - from > 16)
    throw Error('Accrual reads at most 16 blocks per checkpoint');
  const finalized = await api.rpc.chain.getHeader(
    await api.rpc.chain.getFinalizedHead(),
  );
  if (to > finalized.number.toNumber())
    throw Error('Accrual must stop at a finalized block');
  const owner = accountKey(sourceAddress),
    hotkey = accountKey(agreement.hotkey);
  async function snapshot(height: number) {
    const hash = await api.rpc.chain.getBlockHash(height);
    const [at, version, code] = await Promise.all([
      api.at(hash),
      api.rpc.state.getRuntimeVersion(hash),
      api.rpc.state.getStorageHash('0x3a636f6465', hash),
    ]);
    if (version.specVersion.toNumber() !== 454)
      throw Error(
        'Automatic owner accrual is currently verified only for runtime 454',
      );
    if (code.toHex() !== VERIFIED_CODE)
      throw Error('Runtime code has not been validated for automatic accrual');
    const sub = at.query.subtensorModule,
      n = agreement.netuid;
    const values = await at.queryMulti([
      [sub.pendingOwnerCut, n],
      [sub.subnetAlphaOutEmission, n],
      sub.subnetOwnerCut,
      [sub.networksAdded, n],
      [sub.firstEmissionBlockNumber, n],
      [sub.subtokenEnabled, n],
      [sub.networkRegistrationAllowed, n],
      [sub.ownerCutEnabled, n],
      [sub.lastMechansimStepBlock, n],
      [sub.subnetOwner, n],
      [sub.subnetOwnerHotkey, n],
      [sub.networkRegisteredAt, n],
      [sub.subnetUidToLeaseId, n],
      [sub.ownerCutAutoLockEnabled, n],
    ]);
    const bool = (i: number) => {
      const v = values[i].toString();
      if (v !== 'true' && v !== 'false')
        throw Error('Invalid boolean in runtime response');
      return v === 'true';
    };
    const state: OwnerState = {
      pending: unitsSchema.parse(values[0].toString()),
      alphaOut: unitsSchema.parse(values[1].toString()),
      cut: unitsSchema.parse(values[2].toString()),
      eligible: bool(3) && values[4].toJSON() !== null && bool(5) && bool(6),
      enabled: bool(7),
      epoch: Number(values[8].toString()),
      owner: accountKey(values[9].toString()),
      hotkey: accountKey(values[10].toString()),
      registered: values[11].toString(),
      leased: values[12].toJSON() !== null,
      autoLock: bool(13),
    };
    if (!bool(3) || state.owner !== owner || state.hotkey !== hotkey)
      throw Error(
        'Archive owner / hotkey does not match the funding agreement',
      );
    return { state, hash: hash.toHex(), code: code.toHex() };
  }
  let previous = await snapshot(from),
    total = 0n;
  const codeHash = previous.code;
  let locked = false;
  for (let height = from + 1; height <= to; height++) {
    const current = await snapshot(height);
    const [block, at] = await Promise.all([
      api.rpc.chain.getBlock(current.hash),
      api.at(current.hash),
    ]);
    if (
      block.block.header.parentHash.toHex() !== previous.hash ||
      current.code !== codeHash
    )
      throw Error('Archive chain or runtime changed');
    const events = await at.query.system.events();
    // Privileged runtime/storage execution falls outside this bounded reconstruction.
    const evidence = JSON.stringify([
      block.block.extrinsics.map((e) => e.method.toHuman()),
      events.toHuman(),
    ]);
    if (
      /"section"\s*:\s*"(?:sudo|scheduler)"|"method"\s*:\s*"(?:setStorage|killStorage|killPrefix|setCode|setCodeWithoutChecks|CodeUpdated|SubnetOwnerChanged)"/.test(
        evidence,
      )
    )
      throw Error(
        'Privileged or ownership-changing block requires independent reconciliation',
      );
    total += ownerCredit(previous.state, current.state, height);
    locked ||= current.state.autoLock;
    previous = current;
  }
  return {
    amount: unitsSchema.parse(total.toString()),
    toBlock: to,
    blockHash: previous.hash,
    codeHash,
    locked,
  };
}
