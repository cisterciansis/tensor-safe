import type { QueryableStorageMultiArg } from '@polkadot/api/types';
import type { Codec } from '@polkadot/types/types';
import type { Chain } from './chain';
import { accountKey, unitsSchema, type Agreement } from './domain';
// Validated Finney runtimes; new code requires an explicit model review (docs/chain-research.md).
// The owner cut is `cut / one`: 454 the global U16 SubnetOwnerCut, 486 slot 2 of the
// subnet's SubnetEmissionWeights, cross-checked against SubnetOwnerCutAccrued.
const RUNTIMES: Record<
  number,
  { code: string; one: bigint; accrued: boolean }
> = {
  454: {
    code: '0x725e3d1eca8d5c29c1f0fa6476d5360661b852f52aebad979d6636e227a431ef',
    one: 65535n,
    accrued: false,
  },
  486: {
    code: '0x49781ac4cfda0ac6cf6e53cfceea7c728394d9c28da7881f47e3fbfbc239800f',
    one: 18446744073709551615n,
    accrued: true,
  },
};
const unsupported = () =>
  Error(
    `Automatic owner accrual is verified only for runtimes ${Object.keys(RUNTIMES).join(', ')}`,
  );
export function runtimeForCode(code: string) {
  const spec = Object.keys(RUNTIMES).find((k) => RUNTIMES[+k].code === code);
  if (!spec) throw unsupported();
  return Number(spec);
}
export type OwnerState = {
  spec: number;
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
  accrued?: string;
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
  const rule = RUNTIMES[parent.spec];
  if (!rule) throw unsupported();
  if (parent.spec !== current.spec)
    throw Error('Runtime changed; reconcile this interval independently');
  if (parent.leased || current.leased)
    throw Error(
      'Native leases require residual accounting and are excluded from automatic private accrual',
    );
  const cut = BigInt(parent.cut);
  if (cut < 0n || cut > rule.one) throw Error('Invalid runtime owner cut');
  const increment =
    parent.eligible && parent.enabled
      ? (BigInt(current.alphaOut) * ((cut << 32n) / rule.one)) >> 32n
      : 0n;
  if (
    rule.accrued &&
    (parent.accrued === undefined ||
      current.accrued === undefined ||
      BigInt(current.accrued) - BigInt(parent.accrued) !== increment)
  )
    throw Error('Owner-cut running total does not match the reconstruction');
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
    const spec = version.specVersion.toNumber(),
      rule = RUNTIMES[spec];
    if (!rule) throw unsupported();
    if (code.toHex() !== rule.code)
      throw Error('Runtime code has not been validated for automatic accrual');
    const sub = at.query.subtensorModule,
      n = agreement.netuid;
    const item = (name: string) => {
      if (!sub?.[name]) throw Error(`Runtime storage ${name} is unavailable`);
      return sub[name];
    };
    const values = await at.queryMulti([
      [item('pendingOwnerCut'), n],
      [item('subnetAlphaOutEmission'), n],
      [item('networksAdded'), n],
      [item('firstEmissionBlockNumber'), n],
      [item('subtokenEnabled'), n],
      [item('networkRegistrationAllowed'), n],
      [item('lastMechansimStepBlock'), n],
      [item('subnetOwner'), n],
      [item('subnetOwnerHotkey'), n],
      [item('networkRegisteredAt'), n],
      [item('subnetUidToLeaseId'), n],
      [item('ownerCutAutoLockEnabled'), n],
      ...(rule.accrued
        ? [
            [item('subnetEmissionWeights'), n],
            [item('subnetOwnerCutAccrued'), n],
          ]
        : [item('subnetOwnerCut'), [item('ownerCutEnabled'), n]]),
    ] as QueryableStorageMultiArg<'promise'>[]);
    const bool = (i: number) => {
      const v = values[i].toString();
      if (v !== 'true' && v !== 'false')
        throw Error('Invalid boolean in runtime response');
      return v === 'true';
    };
    // 486: owner slot of [burn, recycle, owner, validator, miner]; a missing slot is zero.
    const weights = values[12] as unknown as Codec[];
    if (rule.accrued && !Array.isArray(weights))
      throw Error('Invalid emission weights in runtime response');
    const cut = unitsSchema.parse(
      rule.accrued ? (weights[2]?.toString() ?? '0') : values[12].toString(),
    );
    const state: OwnerState = {
      spec,
      pending: unitsSchema.parse(values[0].toString()),
      alphaOut: unitsSchema.parse(values[1].toString()),
      cut,
      eligible: bool(2) && values[3].toJSON() !== null && bool(4) && bool(5),
      enabled: rule.accrued ? BigInt(cut) > 0n : bool(13),
      epoch: Number(values[6].toString()),
      owner: accountKey(values[7].toString()),
      hotkey: accountKey(values[8].toString()),
      registered: values[9].toString(),
      leased: values[10].toJSON() !== null,
      autoLock: bool(11),
      accrued: rule.accrued
        ? unitsSchema.parse(values[13].toString())
        : undefined,
    };
    if (!bool(2) || state.owner !== owner || state.hotkey !== hotkey)
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
