'use client';
import { controls } from '@/lib/controls';
import { useState } from 'react';
import type { Option } from '@polkadot/types';
import type { Multisig } from '@polkadot/types/interfaces';
import { connect } from '@/lib/chain';
import {
  accountAddress,
  accountKey,
  formatUnits,
  type Account,
  type Proposal,
} from '@/lib/domain';
import { Copyable } from '@/components/copyable';

const integer = BigInt;
export function TransactionReview({
  account,
  proposal,
}: {
  account: Account;
  proposal: Proposal;
}) {
  const [state, setState] = useState<{
    block: number;
    approvals: string[];
    when: string;
    depositor: string;
    target: unknown;
  }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError('');
    let api;
    try {
      api = await connect(account.network);
      const hash = await api.rpc.chain.getFinalizedHead();
      const at = await api.at(hash);
      const pending = (await at.query.multisig.multisigs(
        accountAddress(account),
        proposal.callHash,
      )) as Option<Multisig>;
      const entry = pending.isSome ? pending.unwrap() : null;
      setState({
        block: (await api.rpc.chain.getHeader(hash)).number.toNumber(),
        approvals: entry?.approvals.map((a) => a.toString()) ?? [],
        // Taostats extrinsic id: block-index, index zero-padded to four digits.
        when: entry
          ? `${entry.when.height.toString()}-${entry.when.index.toString().padStart(4, '0')}`
          : '',
        depositor: entry?.depositor.toString() ?? '',
        target: at.registry.createType('Call', proposal.callHex).toHuman(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await api?.disconnect();
      setBusy(false);
    }
  }
  const net = account.network;
  // Evidence is `genesis:blockHash:extrinsicIndex` from finalized reconciliation.
  const [, finalizedBlock, finalizedIndex] =
    proposal.evidence?.split(':') ?? [];
  const signer = (address: string) => (
    <div key={address}>
      {account.signers.find(
        (s) => accountKey(s.address) === accountKey(address),
      )?.name ?? 'Unknown'}{' '}
      · <Copyable value={address} network={net} kind="account" label="signer" />
    </div>
  );
  return (
    <>
      <p className="section-copy">
        {account.threshold} people must approve before this account can make the
        change.
      </p>
      <ol
        className={`review-actions${proposal.operations.length === 1 ? ' single' : ''}`}
      >
        {proposal.operations.map((op, index) => (
          <li key={index}>
            {op.kind === 'children' ? (
              <>
                Replace child-validator allocations for{' '}
                <Copyable
                  value={op.hotkey}
                  network={net}
                  kind="hotkey"
                  label="hotkey"
                />{' '}
                on subnet {op.netuid}:{' '}
                {op.children.length
                  ? op.children
                      .map(
                        (c) =>
                          `${c.address}: ${(Number((integer(c.proportion) * 1000000n) / 18446744073709551615n) / 10000).toFixed(4)}%`,
                      )
                      .join('; ')
                  : 'revoke all allocations'}
                . Activation may be delayed.
              </>
            ) : op.kind === 'control' ? (
              <>
                {controls[op.action].title}: {op.args.map(String).join(' · ')}
              </>
            ) : op.kind === 'transfer' ? (
              <>
                Send {formatUnits(op.amount)} TAO to{' '}
                <Copyable
                  value={op.to}
                  network={net}
                  kind="account"
                  label="recipient"
                />
              </>
            ) : op.kind === 'alpha' ? (
              <>
                Send {formatUnits(op.amount)} alpha on subnet {op.netuid} to{' '}
                <Copyable
                  value={op.to}
                  network={net}
                  kind="account"
                  label="recipient"
                />
              </>
            ) : op.kind === 'stake' || op.kind === 'unstake' ? (
              <>
                {op.kind === 'stake' ? 'Stake' : 'Unstake'}{' '}
                {formatUnits(op.amount)} {op.kind === 'stake' ? 'TAO' : 'alpha'}{' '}
                on subnet {op.netuid} {op.kind === 'stake' ? 'to' : 'from'}{' '}
                <Copyable
                  value={op.hotkey}
                  network={net}
                  kind="hotkey"
                  label="validator hotkey"
                />
                , with your price limit.
              </>
            ) : op.kind === 'addProxy' || op.kind === 'removeProxy' ? (
              <>
                {op.kind === 'addProxy' ? 'Grant' : 'Remove'} {op.proxyType}{' '}
                permission for{' '}
                <Copyable
                  value={op.delegate}
                  network={net}
                  kind="account"
                  label="delegate"
                />
              </>
            ) : (
              <>
                Custom on-chain action. Expand technical details and verify the
                decoded call before approving.
              </>
            )}
          </li>
        ))}
      </ol>
      {(proposal.attempt || finalizedBlock) && (
        <dl className="onchain-record">
          {proposal.attempt && (
            <>
              <dt>Broadcast</dt>
              <dd>
                <Copyable
                  value={proposal.attempt.hash}
                  network={net}
                  kind="extrinsic"
                  label="transaction hash"
                />{' '}
                · awaiting finality, valid until block{' '}
                {proposal.attempt.expires}
              </dd>
            </>
          )}
          {finalizedBlock && (
            <>
              <dt>Finalized in block</dt>
              <dd>
                <Copyable
                  value={finalizedBlock}
                  network={net}
                  kind="block"
                  label="block hash"
                />{' '}
                · extrinsic #{finalizedIndex}
              </dd>
            </>
          )}
        </dl>
      )}
      <details className="technical-review">
        <summary>Technical details · call, approvals and metadata</summary>
        <button className="text-button" onClick={refresh} disabled={busy}>
          {busy ? 'Checking chain…' : 'Check finalized approvals'}
        </button>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <dl>
          <dt>Account</dt>
          <dd>
            <Copyable
              value={accountAddress(account)}
              network={net}
              kind="account"
              label="account address"
            />
          </dd>
          <dt>Network</dt>
          <dd>
            {net === 'test' ? 'Testnet' : 'Mainnet'} · genesis{' '}
            <Copyable value={proposal.genesisHash} label="genesis hash" />
          </dd>
          <dt>Runtime at construction</dt>
          <dd>{proposal.specVersion}</dd>
          <dt>Call hash</dt>
          <dd>
            <Copyable value={proposal.callHash} label="call hash" />
          </dd>
          <dt>Call data (exact preimage)</dt>
          <dd>
            <Copyable value={proposal.callHex} label="call data" />
          </dd>
          {state && (
            <>
              <dt>Finalized checkpoint</dt>
              <dd>#{state.block}</dd>
              <dt>Opened in</dt>
              <dd>
                {state.when ? (
                  <Copyable
                    value={state.when}
                    full
                    network={net}
                    kind="extrinsic"
                    label="opening extrinsic"
                  />
                ) : (
                  'Not opened on-chain yet'
                )}
              </dd>
              <dt>Opening depositor</dt>
              <dd>{state.depositor ? signer(state.depositor) : '—'}</dd>
              <dt>
                Approved by ({state.approvals.length}/{account.threshold})
              </dt>
              <dd>
                {state.approvals.length
                  ? state.approvals.map(signer)
                  : 'No pending approvals at this checkpoint'}
              </dd>
              <dt>Other signers</dt>
              <dd>
                {account.signers
                  .filter(
                    (s) =>
                      !state.approvals.some(
                        (a) => accountKey(a) === accountKey(s.address),
                      ),
                  )
                  .map((s) => signer(s.address))}
              </dd>
              <dt>Decoded target at checkpoint</dt>
              <dd>
                <pre className="code-box">
                  {JSON.stringify(state.target, null, 2)}
                </pre>
              </dd>
            </>
          )}
        </dl>
        <p className="muted">
          No pending entry can mean not opened, already executed or cancelled.
          Execution is confirmed separately from finalized events.
        </p>
      </details>
    </>
  );
}
