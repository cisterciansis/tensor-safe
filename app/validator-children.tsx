'use client';
import { Copyable } from '@/components/copyable';
import { useState } from 'react';
import { z } from 'zod';
import { connect } from '@/lib/chain';
import { Choice } from '@/lib/choices';
import { childrenSchema, childProportion, percentParts } from '@/lib/controls';
import { addressSchema, type Account } from '@/lib/domain';
const rowsSchema = z
  .array(
    z.tuple([
      z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
      addressSchema,
    ]),
  )
  .max(5);
const integer = BigInt;
export function ValidatorChildren({
  accounts,
  editable,
  onSave,
}: {
  accounts: Account[];
  editable: boolean;
  onSave: (command: unknown) => Promise<unknown>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [hotkey, setHotkey] = useState(''),
    [netuid, setNetuid] = useState('');
  const [rows, setRows] = useState<
    { address: string; percent: string; raw?: string }[]
  >([]);
  const [snapshot, setSnapshot] = useState<{
    active: z.infer<typeof rowsSchema>;
    pending: [z.infer<typeof rowsSchema>, string | number];
    block: number;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [review, setReview] = useState(false),
    [saved, setSaved] = useState(false);
  function reset() {
    setSnapshot(undefined);
    setReview(false);
    setSaved(false);
  }
  async function load() {
    setBusy(true);
    setError('');
    reset();
    let api;
    try {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw Error('Choose an account');
      addressSchema.parse(hotkey);
      z.string()
        .regex(/^[1-9]\d{0,4}$/)
        .refine((v) => Number(v) <= 65535)
        .parse(netuid);
      api = await connect(account.network);
      const hash = await api.rpc.chain.getFinalizedHead();
      const at = await api.at(hash);
      const active = rowsSchema.parse(
        (await at.query.subtensorModule.childKeys(hotkey, netuid)).toJSON(),
      );
      const pending = z
        .tuple([
          rowsSchema,
          z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
        ])
        .parse(
          (
            await at.query.subtensorModule.pendingChildKeys(netuid, hotkey)
          ).toJSON(),
        );
      setRows(
        active.map(([share, address]) => ({
          address,
          raw: String(share),
          percent: (
            Number((integer(share) * 1000000n) / 18446744073709551615n) / 10000
          ).toFixed(4),
        })),
      );
      setSnapshot({
        active,
        pending,
        block: (await api.rpc.chain.getHeader(hash)).number.toNumber(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await api?.disconnect();
      setBusy(false);
    }
  }
  async function propose() {
    setBusy(true);
    setError('');
    try {
      const operation = childrenSchema.parse({
        kind: 'children',
        hotkey,
        netuid,
        children: rows.map((r) => ({
          address: r.address,
          proportion: r.raw ?? childProportion(percentParts(r.percent)),
        })),
      });
      if (!review) {
        setReview(true);
        return;
      }
      await onSave({
        action: 'propose',
        id: crypto.randomUUID(),
        accountId,
        title: 'Update child-validator allocations',
        operations: [operation],
      });
      setSaved(true);
      setReview(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded spaced">
      <h3>Child-validator allocations</h3>
      <p className="section-copy">
        Choose which child validators receive delegated weight. Saving replaces
        the full list. An empty list revokes all allocations.
      </p>
      <div className="form-stack">
        <label>
          Account
          <Choice
            value={accountId}
            disabled={busy || review}
            onChange={(e) => {
              setAccountId(e.target.value);
              reset();
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Choice>
        </label>
        <label>
          Parent validator hotkey
          <input
            value={hotkey}
            disabled={busy || review}
            onChange={(e) => {
              setHotkey(e.target.value);
              reset();
            }}
          />
        </label>
        <label>
          Subnet ID
          <input
            value={netuid}
            disabled={busy || review}
            onChange={(e) => {
              setNetuid(e.target.value);
              reset();
            }}
          />
        </label>
      </div>
      <div className="action-bar">
        <button
          className="button outline"
          disabled={busy || review}
          onClick={load}
        >
          Load active and pending allocations
        </button>
      </div>
      {snapshot && (
        <>
          <p className="muted">
            Finalized block #{snapshot.block}. Pending changes may activate
            later, or fail if validator relationships change. Check active
            allocations again after execution.
          </p>
          {integer(snapshot.pending[1]) > 0n && (
            <div className="notice">
              <div>
                <strong>Pending allocation change</strong>
                <p>
                  Eligible after block {String(snapshot.pending[1])}; activation
                  can happen later.
                </p>
                {snapshot.pending[0].length ? (
                  snapshot.pending[0].map(([share, child]) => (
                    <p key={child}>
                      <Copyable
                        value={child}
                        network={
                          accounts.find((a) => a.id === accountId)?.network
                        }
                        kind="hotkey"
                        label="child hotkey"
                      />{' '}
                      ·{' '}
                      {(
                        Number(
                          (integer(share) * 1000000n) / 18446744073709551615n,
                        ) / 10000
                      ).toFixed(4)}
                      %
                    </p>
                  ))
                ) : (
                  <p>All child allocations are scheduled to be revoked.</p>
                )}
              </div>
            </div>
          )}
          <details className="technical-review">
            <summary>Active and pending on-chain allocations</summary>
            <pre className="code-box">{JSON.stringify(snapshot, null, 2)}</pre>
          </details>
          {rows.map((r, i) => (
            <div className="input-row spaced" key={i}>
              <label>
                Child hotkey
                <input
                  value={r.address}
                  disabled={busy || review || !editable}
                  onChange={(e) =>
                    setRows((old) =>
                      old.map((v, n) =>
                        n === i ? { ...v, address: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Share (%)
                <input
                  value={r.percent}
                  disabled={busy || review || !editable}
                  onChange={(e) =>
                    setRows((old) =>
                      old.map((v, n) =>
                        n === i
                          ? { ...v, percent: e.target.value, raw: undefined }
                          : v,
                      ),
                    )
                  }
                />
              </label>
              <button
                className="button outline"
                disabled={busy || review || !editable}
                onClick={() => setRows((old) => old.filter((_, n) => n !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="action-bar">
            <button
              className="button outline"
              disabled={rows.length >= 5 || busy || review || !editable}
              onClick={() =>
                setRows((old) => [...old, { address: '', percent: '' }])
              }
            >
              Add child
            </button>
          </div>
          {review && (
            <div className="notice">
              <div>
                <strong>
                  {rows.length
                    ? 'Replace all allocations with this list'
                    : 'Revoke all child allocations'}
                </strong>
                {rows.map((r) => (
                  <p key={r.address}>
                    {r.address}: {r.percent}%{' '}
                    <small>
                      (encoded{' '}
                      {r.raw ?? childProportion(percentParts(r.percent))})
                    </small>
                  </p>
                ))}
                <p>
                  This creates an approval request. Scheduled does not mean
                  active.
                </p>
              </div>
            </div>
          )}
          {saved ? (
            <output className="notice">
              Request created. Open Transactions for approvals.
            </output>
          ) : (
            <div className="action-bar">
              {review && (
                <button
                  className="button outline"
                  onClick={() => setReview(false)}
                >
                  Edit
                </button>
              )}
              <button
                className="button primary"
                disabled={busy || !editable}
                onClick={propose}
              >
                {review ? 'Create approval request' : 'Review allocations'}
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </section>
  );
}
