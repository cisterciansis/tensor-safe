'use client';
import { Copyable } from '@/components/copyable';
import { Tau } from '@/components/tau';
import { Choice } from '@/lib/choices';
import type { Option, u64 } from '@polkadot/types';
import type { Codec } from '@polkadot/types/types';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { connect, readAccount } from '@/lib/chain';
import { readLeaseHistory, type LeasePayout } from '@/lib/lease-history';
import { download } from './signing';
import { formatUnits, type Account } from '@/lib/domain';
const integer = BigInt;
export function AccountChain({
  account,
  onBalance,
  onPropose,
}: {
  account: Account;
  onBalance: (amount: string) => void;
  onPropose: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof readAccount>>>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [stakes, setStakes] = useState<unknown>();
  async function refresh() {
    setBusy(true);
    setError('');
    let api;
    try {
      api = await connect(account.network);
      const result = await readAccount(api, account);
      setData(result);
      onBalance(result.balance);
      const at = await api.at(result.hash);
      const call = at.call.stakeInfoRuntimeApi?.getStakeInfoForColdkey;
      if (call) setStakes((await call(result.address)).toJSON());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await api?.disconnect();
      setBusy(false);
    }
  }
  return (
    <div className="chain-details">
      <div className="panel-title">
        <h3>Finalized chain state</h3>
        <button className="text-button" onClick={refresh} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
          {busy ? 'Reading chain…' : 'Refresh from chain'}
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {data ? (
        <>
          <div className="metrics">
            <div>
              <span>Free TAO</span>
              <strong>
                {formatUnits(data.balance, 9)} <Tau />
              </strong>
            </div>
            <div>
              <span>Reserved</span>
              <strong>
                {formatUnits(data.reserved, 9)} <Tau />
              </strong>
            </div>
            <div>
              <span>Finalized block</span>
              <strong>#{data.block.toLocaleString()}</strong>
            </div>
          </div>
          <div className="detail-row">
            <span>Opening deposit</span>
            <strong>
              {formatUnits(
                (
                  integer(data.depositBase) +
                  integer(account.threshold) * integer(data.depositFactor)
                ).toString(),
                9,
              )}{' '}
              <Tau /> + network fee
            </strong>
          </div>
          <h4 className="section-label">Proxies</h4>
          <details className="technical-review">
            <summary>
              {(data.proxies as [unknown[]] | null)?.[0]?.length || 'No'}{' '}
              delegated permission(s)
            </summary>
            <pre className="code-box">
              {JSON.stringify(data.proxies, null, 2)}
            </pre>
          </details>
          <button className="button outline" onClick={onPropose}>
            Manage proxy permissions
          </button>
          <h4 className="section-label">On-chain multisig queue</h4>
          <details className="technical-review">
            <summary>
              {data.pending.length || 'No'} pending on-chain call(s)
            </summary>
            <pre className="code-box">
              {JSON.stringify(data.pending, null, 2)}
            </pre>
          </details>
          <p className="muted">
            Calls opened outside this workspace appear by hash. Preserve their
            original preimage before interacting.
          </p>
          {stakes !== undefined && (
            <>
              <h4 className="section-label">Staked positions</h4>
              <details className="technical-review">
                <summary>Runtime response</summary>
                <pre className="code-box">
                  {JSON.stringify(stakes, null, 2)}
                </pre>
              </details>
            </>
          )}
        </>
      ) : (
        <p className="section-copy">
          Read balances, proxies and pending approvals at a finalized block.
        </p>
      )}
    </div>
  );
}
export function NativeCrowdloan() {
  const [network, setNetwork] = useState<'finney' | 'test'>('finney'),
    [netuid, setNetuid] = useState(''),
    [data, setData] = useState<{
      network: 'finney' | 'test';
      leaseId: string;
      lease: ReturnType<Codec['toJSON']>;
      shares: { address: string; shareRaw: string }[];
      accumulated: string;
      block: number;
    }>(),
    [events, setEvents] = useState<LeasePayout[]>([]),
    [cursor, setCursor] = useState<string>(),
    [oldest, setOldest] = useState<number>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function inspect() {
    setBusy(true);
    setError('');
    setData(undefined);
    setEvents([]);
    setCursor(undefined);
    setOldest(undefined);
    let api;
    try {
      const id = Number(netuid);
      if (!Number.isInteger(id) || id < 1 || id > 65535)
        throw Error('Enter a subnet ID from 1 to 65535');
      api = await connect(network);
      const hash = await api.rpc.chain.getFinalizedHead();
      const at = await api.at(hash);
      const sub = at.query.subtensorModule;
      if (!sub.subnetUidToLeaseId)
        throw Error('This runtime does not expose subnet leases');
      const leaseId = (await sub.subnetUidToLeaseId(id)) as Option<u64>;
      if (leaseId.isNone)
        throw Error('This subnet has no native protocol lease');
      const key = leaseId.unwrap();
      const [lease, shares, accumulated, header] = await Promise.all([
        sub.subnetLeases(key),
        sub.subnetLeaseShares.entries(key),
        sub.accumulatedLeaseDividends(key),
        api.rpc.chain.getHeader(hash),
      ]);
      setData({
        network,
        leaseId: key.toString(),
        lease: lease.toJSON(),
        shares: shares.map(([k, v]) => ({
          address: k.args[1].toString(),
          shareRaw: v.toString(),
        })),
        accumulated: accumulated.toString(),
        block: header.number.toNumber(),
      });
      setCursor(hash.toHex());
      const page = await readLeaseHistory(api, key.toString(), hash.toHex());
      setEvents(page.payouts);
      setCursor(page.next);
      setOldest(page.oldest);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await api?.disconnect();
      setBusy(false);
    }
  }
  async function loadOlder() {
    if (!data || !cursor || busy) return;
    setBusy(true);
    setError('');
    let api;
    try {
      api = await connect(data.network);
      const page = await readLeaseHistory(api, data.leaseId, cursor);
      setEvents((previous) => [...previous, ...page.payouts]);
      setCursor(page.next);
      setOldest(page.oldest);
    } catch (e) {
      setError(
        `History unavailable: ${(e as Error).message}. Loaded payouts are retained; retry with an archive-capable RPC.`,
      );
    } finally {
      await api?.disconnect();
      setBusy(false);
    }
  }
  return (
    <section className="panel padded">
      <div className="panel-title bare">
        <h3>Protocol crowdloan</h3>
        <span className="pill">Automatic on-chain distribution</span>
      </div>
      <p className="section-copy">
        Inspect a leased subnet’s contributor rights and native alpha payouts.
        These are separate from private ownership agreements.
      </p>
      <div className="input-row">
        <label>
          Network
          <Choice
            value={network}
            onChange={(e) => setNetwork(e.target.value as 'finney' | 'test')}
          >
            <option value="finney">Bittensor Mainnet</option>
            <option value="test">Bittensor Testnet</option>
          </Choice>
        </label>
        <label>
          Subnet ID
          <input
            type="number"
            min={1}
            max={65535}
            value={netuid}
            onChange={(e) => setNetuid(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy} onClick={inspect}>
          {busy ? 'Reading finalized state…' : 'Inspect subnet'}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="metrics">
            <div>
              <span>Lease</span>
              <strong>#{data.leaseId}</strong>
            </div>
            <div>
              <span>Pending lease dividends</span>
              <strong>{formatUnits(data.accumulated, 9)} α</strong>
            </div>
            <div>
              <span>Observed through</span>
              <strong>#{data.block}</strong>
            </div>
          </div>
          <details className="technical-review">
            <summary>Lease configuration</summary>
            <pre className="code-box">
              {JSON.stringify(data.lease, null, 2)}
            </pre>
          </details>
          <h4 className="section-label">Contributor shares</h4>
          {data.shares.map((s) => (
            <div key={s.address} className="detail-row">
              <Copyable
                value={s.address}
                network={data.network}
                kind="account"
                label="contributor"
              />
              <strong>
                {(
                  (BigInt(s.shareRaw) * 10000n) /
                  18446744073709551616n
                ).toString()}{' '}
                / 10,000
              </strong>
            </div>
          ))}
          <h4 className="section-label">Finalized payout history</h4>
          {events.length ? (
            events.map((e) => (
              <div className="detail-row" key={`${e.hash}:${e.eventIndex}`}>
                <Copyable
                  value={e.hash}
                  network={data.network}
                  kind="block"
                  label={`block #${e.block}`}
                />
                <Copyable
                  value={e.contributor}
                  network={data.network}
                  kind="account"
                  label="contributor"
                />
                <strong>{formatUnits(e.alpha, 9)} α</strong>
              </div>
            ))
          ) : (
            <p className="muted">No matching payouts in the loaded range.</p>
          )}
          <p className="muted">
            {oldest === undefined
              ? 'History was not loaded.'
              : `Loaded blocks ${oldest.toLocaleString()}–${data.block.toLocaleString()}.`}{' '}
            Older payouts require archive availability. Export includes the
            loaded range and event identities.
          </p>
          <div className="input-row">
            <button
              className="button outline"
              disabled={busy || !cursor}
              onClick={loadOlder}
            >
              {busy
                ? 'Loading…'
                : cursor
                  ? 'Load 25 older blocks'
                  : 'No older page available'}
            </button>
            <button
              className="button outline"
              disabled={oldest === undefined}
              onClick={() =>
                download(`lease-${data.leaseId}-payouts.json`, {
                  network: data.network,
                  leaseId: data.leaseId,
                  fromBlock: oldest,
                  toBlock: data.block,
                  completeToGenesis: !cursor,
                  payouts: events,
                })
              }
            >
              Export loaded ledger
            </button>
          </div>
        </>
      )}
    </section>
  );
}
