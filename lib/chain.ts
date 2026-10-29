import { controls } from './controls';
import type {
  AccountInfo,
  Multisig,
  EventRecord,
  Event,
  DispatchError,
} from '@polkadot/types/interfaces';
import type { Option, Vec, Result, Null } from '@polkadot/types';
import { ApiPromise, HttpProvider, WsProvider } from '@polkadot/api';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import { blake2AsHex } from '@polkadot/util-crypto';
import { hexToU8a, stringToHex } from '@polkadot/util';
import {
  NETWORKS,
  accountAddress,
  accountKey,
  type Account,
  type Operation,
  type Proposal,
} from './domain';
import { accountId } from './wallets';
export type Chain = ApiPromise;
export async function connect(network: Account['network'], http = false) {
  const provider = http
    ? new HttpProvider(NETWORKS[network].http)
    : new WsProvider(NETWORKS[network].ws, 1000);
  const api = new ApiPromise({
    provider,
    noInitWarn: true,
    initWasm: false,
    throwOnConnect: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      api.isReadyOrError,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('RPC connection timed out. Try again.')),
          60000,
        );
      }),
    ]);
  } catch (error) {
    await api.disconnect();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (api.genesisHash.toHex() !== NETWORKS[network].genesis) {
    await api.disconnect();
    throw Error('RPC genesis does not match the selected network');
  }
  return api;
}
export function callFor(
  api: Chain,
  op: Operation,
): SubmittableExtrinsic<'promise'> {
  const sub = api.tx.subtensorModule;
  switch (op.kind) {
    case 'children':
      return api.tx.subtensorModule.setChildren(
        op.hotkey,
        op.netuid,
        op.children.map((c) => [c.proportion, c.address]),
      );
    case 'control': {
      const config = controls[op.action];
      config.schema.parse(op.args);
      const call = api.tx[config.section]?.[config.method];
      if (!call)
        throw Error('This action is unavailable in the selected runtime');
      const args =
        op.action === 'subnetIdentity'
          ? [op.args[0], ...op.args.slice(1).map((v) => stringToHex(String(v)))]
          : op.action === 'validatorIdentity'
            ? op.args.map((v) => stringToHex(String(v)))
            : op.args;
      return call(...args);
    }
    case 'transfer':
      return api.tx.balances.transferKeepAlive(op.to, op.amount);
    case 'alpha':
      return sub.transferStake(
        op.to,
        op.hotkey,
        op.netuid,
        op.netuid,
        op.amount,
      );
    case 'stake':
      return sub.addStakeLimit(
        op.hotkey,
        op.netuid,
        op.amount,
        op.limitPrice,
        false,
      );
    case 'unstake':
      return sub.removeStakeLimit(
        op.hotkey,
        op.netuid,
        op.amount,
        op.limitPrice,
        false,
      );
    case 'addProxy':
      return api.tx.proxy.addProxy(op.delegate, op.proxyType, op.delay);
    case 'removeProxy':
      return api.tx.proxy.removeProxy(op.delegate, op.proxyType, op.delay);
    case 'custom':
      return api.tx(api.registry.createType('Call', op.callHex));
  }
}
export function buildCall(
  api: Chain,
  operations: Operation[],
  reference?: string,
) {
  const calls = operations.map((o) => callFor(api, o));
  if (reference)
    calls.push(
      api.tx.system.remarkWithEvent(stringToHex(`TensorSafe:${reference}`)),
    );
  return calls.length === 1 ? calls[0] : api.tx.utility.batchAll(calls);
}
export async function assertControlAuthority(
  api: Chain,
  account: Account,
  operations: Operation[],
) {
  for (const op of operations) {
    if (op.kind === 'children') {
      if (
        BigInt(
          (await api.query.subtensorModule.owner.size(op.hotkey)).toString(),
        ) === 0n ||
        accountKey(
          (await api.query.subtensorModule.owner(op.hotkey)).toString(),
        ) !== accountKey(accountAddress(account))
      )
        throw Error('This account does not own the parent validator hotkey');
      continue;
    }
    if (op.kind !== 'control') continue;
    const config = controls[op.action];
    config.schema.parse(op.args);
    const sub = api.query.subtensorModule;
    const address = accountAddress(account);
    const subnetIndex = config.fields.findIndex(
      (field) => field === 'Subnet ID',
    );
    if (
      subnetIndex >= 0 &&
      (await sub.networksAdded(op.args[subnetIndex])).toString() !== 'true'
    )
      throw Error('Subnet does not exist');
    if (config.authority === 'owner') {
      if (
        accountKey((await sub.subnetOwner(op.args[0])).toString()) !==
        accountKey(address)
      )
        throw Error('Choose the account that owns this subnet on-chain');
    }
    if (config.authority === 'hotkeyOwner') {
      if (
        BigInt((await sub.owner.size(op.args[0])).toString()) === 0n ||
        accountKey((await sub.owner(op.args[0])).toString()) !==
          accountKey(address)
      )
        throw Error(
          'Choose the coldkey account that owns this validator hotkey',
        );
    }
    if (op.action === 'childTake') {
      const maximum = BigInt((await sub.maxChildkeyTake()).toString());
      if (BigInt(String(op.args[2])) > maximum)
        throw Error('Child commission exceeds the current chain maximum');
    }
    if (op.action === 'increaseTake' || op.action === 'decreaseTake') {
      const current = BigInt((await sub.delegates(op.args[0])).toString());
      const value = BigInt(String(op.args[1]));
      const maximum = BigInt((await sub.maxDelegateTake()).toString());
      const minimum = BigInt((await sub.minDelegateTake()).toString());
      if (value > maximum || value < minimum)
        throw Error('Commission is outside the current chain limits');
      if (op.action === 'increaseTake' ? value <= current : value >= current)
        throw Error(
          'Commission direction no longer matches current chain state; create a fresh proposal',
        );
    }
  }
}
export async function prepareProposal(
  api: Chain,
  account: Account,
  id: string,
  title: string,
  operations: Operation[],
): Promise<Proposal> {
  await assertControlAuthority(api, account, operations);
  const tx = buildCall(api, operations, id);
  return {
    id,
    accountId: account.id,
    title,
    operations,
    callHex: tx.method.toHex(),
    callHash: blake2AsHex(tx.method.toU8a()),
    genesisHash: api.genesisHash.toHex(),
    specVersion: api.runtimeVersion.specVersion.toNumber(),
    createdAt: new Date().toISOString(),
    status: 'proposed',
  };
}
export async function assertProposal(api: Chain, p: Proposal) {
  if (api.genesisHash.toHex() !== p.genesisHash)
    throw Error('Network genesis does not match proposal');
  if (api.runtimeVersion.specVersion.toNumber() !== p.specVersion)
    throw Error(
      'Runtime upgraded: rebuild and review this proposal before signing',
    );
  if (
    blake2AsHex(hexToU8a(p.callHex)) !== p.callHash ||
    buildCall(
      api,
      p.operations,
      p.external ? undefined : p.id,
    ).method.toHex() !== p.callHex
  )
    throw Error('Proposal call does not match its immutable actions');
}
export async function multisigCall(
  api: Chain,
  account: Account,
  p: Proposal,
  signer: string,
  cancel = false,
) {
  if (!cancel) await assertProposal(api, p);
  else if (
    api.genesisHash.toHex() !== p.genesisHash ||
    blake2AsHex(hexToU8a(p.callHex)) !== p.callHash
  )
    throw Error('Proposal network or call hash mismatch');
  if (
    !account.signers.some((s) => accountKey(s.address) === accountKey(signer))
  )
    throw Error('Connected signer is not an owner of this multisig');
  if (!cancel) await assertControlAuthority(api, account, p.operations);
  const other = account.signers
    .map((s) => s.address)
    .filter((s) => accountKey(s) !== accountKey(signer))
    .sort((a, b) => accountKey(a).localeCompare(accountKey(b)));
  const stored = await api.query.multisig.multisigs(
    accountAddress(account),
    p.callHash,
  );
  // Runtime metadata owns the codec shape; this adapter is the only dynamic boundary.
  const pending = (stored as Option<Multisig>).isSome
    ? (stored as Option<Multisig>).unwrap()
    : null;
  if (cancel) {
    if (
      !pending ||
      accountKey(pending.depositor.toString()) !== accountKey(signer)
    )
      throw Error('Only the opening depositor can cancel a pending multisig');
    return (
      account.mode === 'safe'
        ? safeCalls(api).cancelAsMultiSafe
        : api.tx.multisig.cancelAsMulti
    )(account.threshold, other, pending.when, p.callHash);
  }
  if (
    pending?.approvals.some(
      (a) => accountKey(a.toString()) === accountKey(signer),
    ) &&
    pending.approvals.length < account.threshold - 1
  )
    throw Error('This signer has already approved');
  const inner = api.tx(api.registry.createType('Call', p.callHex));
  const info = await inner.paymentInfo(accountAddress(account));
  return (
    account.mode === 'safe'
      ? safeCalls(api).asMultiSafe
      : api.tx.multisig.asMulti
  )(account.threshold, other, pending?.when ?? null, p.callHex, info.weight);
}
/** Safe multisig calls, detected from runtime metadata; never falls back to legacy. */
export function safeCalls(api: Chain) {
  const m = api.tx.multisig;
  if (!m.asMultiSafe || !m.approveAsMultiSafe || !m.cancelAsMultiSafe)
    throw Error('This network does not support quantum-safe multisigs yet');
  return m;
}
/**
 * Registration state of a rotating (hashed) account on this network.
 * Multisig payments must not fund an unregistered rotating recipient.
 */
export async function hashedRegistration(api: Chain, address: string) {
  const registry = api.query.hashedAccounts;
  if (!registry?.accounts || !registry.mlDsaAccounts) return 'unsupported';
  const at = await api.at(await api.rpc.chain.getFinalizedHead());
  const id = accountId(address);
  const [v1, v2] = await Promise.all([
    at.query.hashedAccounts.accounts(id),
    at.query.hashedAccounts.mlDsaAccounts(id),
  ]);
  if ((v1 as Option<Null>).isSome || (v2 as Option<Null>).isSome)
    return 'registered';
  // Registration stays closed until governance enables hashed accounts.
  const enabled = at.query.adminUtils?.hashedAccountsEnabled;
  return enabled && (await enabled()).toString() !== 'true'
    ? 'unsupported'
    : 'unregistered';
}
/**
 * Exact hash-only approval for a member who signs outside the browser
 * (ML-DSA, Falcon or rotating keys via btcli). The final approval still
 * needs the full call, which any browser-capable member submits here.
 */
export async function externalApproval(
  api: Chain,
  account: Account,
  p: Proposal,
  signer: string,
) {
  await assertProposal(api, p);
  await assertControlAuthority(api, account, p.operations);
  const other = account.signers
    .map((s) => s.address)
    .filter((s) => accountKey(s) !== accountKey(signer))
    .sort((a, b) => accountKey(a).localeCompare(accountKey(b)));
  if (other.length === account.signers.length)
    throw Error('Signer is not an owner of this multisig');
  const stored = (await api.query.multisig.multisigs(
    accountAddress(account),
    p.callHash,
  )) as Option<Multisig>;
  const pending = stored.isSome ? stored.unwrap() : null;
  if (
    pending?.approvals.some(
      (a) => accountKey(a.toString()) === accountKey(signer),
    )
  )
    throw Error('This signer has already approved');
  const inner = api.tx(api.registry.createType('Call', p.callHex));
  const weight = (await inner.paymentInfo(accountAddress(account))).weight;
  const call =
    account.mode === 'safe' ? 'approve_as_multi_safe' : 'approve_as_multi';
  if (account.mode === 'safe') safeCalls(api);
  const args = {
    threshold: account.threshold,
    other_signatories: other,
    maybe_timepoint: pending
      ? {
          height: pending.when.height.toNumber(),
          index: pending.when.index.toNumber(),
        }
      : null,
    call_hash: p.callHash,
    max_weight: {
      ref_time: weight.refTime.toString(),
      proof_size: weight.proofSize.toString(),
    },
  };
  return {
    call: `Multisig.${call}`,
    args,
    network: account.network,
    command: `btcli call Multisig.${call} --args '${JSON.stringify(args)}' --network ${account.network} -w <your-wallet>  # signer ${signer}`,
  };
}
export async function readAccount(api: Chain, account: Account) {
  const address = accountAddress(account);
  const hash = await api.rpc.chain.getFinalizedHead();
  const at = await api.at(hash);
  const [balance, proxies, pending, header] = await Promise.all([
    at.query.system.account(address),
    at.query.proxy.proxies(address),
    at.query.multisig.multisigs.entries(address),
    api.rpc.chain.getHeader(hash),
  ]);
  return {
    address,
    block: header.number.toNumber(),
    hash: hash.toHex(),
    genesisHash: api.genesisHash.toHex(),
    balance: (balance as AccountInfo).data.free.toString(),
    reserved: (balance as AccountInfo).data.reserved.toString(),
    frozen: (balance as AccountInfo).data.get('frozen')?.toString() ?? '0',
    proxies: proxies.toJSON(),
    pending: pending.map(([k, v]) => ({
      hash: k.args[1].toString(),
      ...(v.toJSON() as object),
    })),
    depositBase: api.consts.multisig.depositBase.toString(),
    depositFactor: api.consts.multisig.depositFactor.toString(),
  };
}
export async function reconcile(
  api: Chain,
  account: Account,
  p: Proposal,
  blockHash: string,
  extrinsicHash: string,
) {
  if (api.genesisHash.toHex() !== p.genesisHash) throw Error('Wrong network');
  const [header, finalized] = await Promise.all([
    api.rpc.chain.getHeader(blockHash),
    api.rpc.chain.getFinalizedHead(),
  ]);
  const finalHeader = await api.rpc.chain.getHeader(finalized);
  if (
    header.number.toNumber() > finalHeader.number.toNumber() ||
    (await api.rpc.chain.getBlockHash(header.number.toNumber())).toHex() !==
      blockHash
  )
    throw Error('Block is not canonical and finalized');
  const block = await api.rpc.chain.getBlock(blockHash);
  const index = block.block.extrinsics.findIndex(
    (e) => e.hash.toHex() === extrinsicHash,
  );
  if (index < 0)
    throw Error('Transaction not found in supplied finalized block');
  const at = await api.at(blockHash);
  const all = await at.query.system.events();
  const events = (all as unknown as Vec<EventRecord>)
    .filter(
      (r: EventRecord) =>
        r.phase.isApplyExtrinsic &&
        r.phase.asApplyExtrinsic.toNumber() === index,
    )
    .map((r: EventRecord) => r.event);
  if (p.attempt && p.attempt.hash !== extrinsicHash)
    throw Error('Evidence does not match the reserved signing attempt');
  if (
    events.some(
      (e: Event) => e.section === 'system' && e.method === 'ExtrinsicFailed',
    )
  ) {
    if (!p.attempt)
      throw Error('Unrelated failed extrinsic cannot change a proposal');
    // A rejected approval can leave earlier approvals live. Keep the same proposal.
    return {
      outcome: 'rejected' as const,
      evidence: `${p.genesisHash}:${blockHash}:${index}`,
    };
  }
  const cancelled = events.find(
    (e: Event) =>
      e.section === 'multisig' &&
      e.method === 'MultisigCancelled' &&
      accountKey(e.data[2].toString()) ===
        accountKey(accountAddress(account)) &&
      e.data[3].toHex() === p.callHash,
  );
  if (cancelled && p.attempt?.hash === extrinsicHash)
    return {
      outcome: 'cancelled' as const,
      evidence: `${p.genesisHash}:${blockHash}:${index}`,
    };
  const execution = events.find(
    (e: Event) =>
      e.section === 'multisig' &&
      e.method === 'MultisigExecuted' &&
      accountKey(e.data[2].toString()) ===
        accountKey(accountAddress(account)) &&
      e.data[3].toHex() === p.callHash,
  );
  if (!execution) {
    const approval = events.find(
      (e: Event) =>
        e.section === 'multisig' &&
        ['NewMultisig', 'MultisigApproval'].includes(e.method) &&
        e.data.some((d) => d.toString() === p.callHash),
    );
    if (approval && p.attempt?.hash === extrinsicHash)
      return {
        outcome: 'approved' as const,
        evidence: `${p.genesisHash}:${blockHash}:${index}`,
      };
    throw Error('No multisig outcome matches this proposal');
  }
  if (!(execution.data[4] as Result<Null, DispatchError>).isOk)
    return {
      outcome: 'failed' as const,
      evidence: `${p.genesisHash}:${blockHash}:${index}`,
    };
  if (
    events.some(
      (e: Event) =>
        (e.section === 'proxy' &&
          e.method === 'ProxyExecuted' &&
          !(e.data[0] as Result<Null, DispatchError>).isOk) ||
        (e.section === 'utility' &&
          ['BatchInterrupted', 'ItemFailed'].includes(e.method)),
    )
  )
    throw Error('An inner operation failed');
  const outer = block.block.extrinsics[index].method;
  if (
    outer.section !== 'multisig' ||
    outer.method !== (account.mode === 'safe' ? 'asMultiSafe' : 'asMulti') ||
    outer.args[3].toHex() !== p.callHex
  )
    throw Error('Finalized call preimage differs from the proposal');
  return {
    outcome: 'executed' as const,
    evidence: `${p.genesisHash}:${blockHash}:${index}`,
    block: header.number.toNumber(),
    extrinsicHash,
  };
}
