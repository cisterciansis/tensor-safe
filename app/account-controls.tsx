'use client';
import { useState } from 'react';
import { hexToString, stringToHex } from '@polkadot/util';
import { Choice } from '@/lib/choices';
import { connect } from '@/lib/chain';
import {
  controls,
  controlSchema,
  percentParts,
  type ControlAction,
} from '@/lib/controls';
import {
  accountAddress,
  addressSchema,
  formatUnits,
  parseUnits,
  type Account,
} from '@/lib/domain';
const boolActions = new Set<ControlAction>([
  'perpetual',
  'autoLock',
  'transfers',
  'commitReveal',
]);
const profileFields = {
  subnetIdentity: [
    'subnetName',
    'githubRepo',
    'subnetContact',
    'subnetUrl',
    'discord',
    'description',
    'logoUrl',
    'additional',
  ],
  validatorIdentity: [
    'name',
    'url',
    'githubRepo',
    'image',
    'discord',
    'description',
    'additional',
  ],
};
export function AccountControls({
  group,
  accounts,
  editable,
  onSave,
  onCreate,
}: {
  group: 'owner' | 'validator';
  accounts: Account[];
  editable: boolean;
  onSave: (command: unknown) => Promise<unknown>;
  onCreate: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [action, setAction] = useState<ControlAction>(
    group === 'owner' ? 'perpetual' : 'validatorIdentity',
  );
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [args, setArgs] = useState<(string | boolean)[]>([]);
  const [before, setBefore] = useState<(string | boolean)[]>();
  const [lockState, setLockState] = useState<unknown>();
  const [checkpoint, setCheckpoint] = useState<number>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const selected = accounts.find((a) => a.id === accountId);
  const config = controls[action];
  const isProfile =
    action === 'subnetIdentity' || action === 'validatorIdentity';
  const isContext = (index: number) =>
    config.fields[index] === 'Subnet ID' ||
    config.fields[index].includes('hotkey');
  function change(index: number, value: string | boolean) {
    setArgs((old) =>
      Array.from({ length: config.fields.length }, (_, i) =>
        i === index ? value : (old[i] ?? ''),
      ),
    );
    setReview(false);
    setSaved(false);
    if (isContext(index)) {
      setLockState(undefined);
      setBefore(undefined);
      setCheckpoint(undefined);
    }
  }
  function reset() {
    setLockState(undefined);
    setArgs([]);
    setDrafts({});
    setBefore(undefined);
    setCheckpoint(undefined);
    setReview(false);
    setSaved(false);
    setError('');
  }
  async function load() {
    if (!selected) return;
    setBusy(true);
    setError('');
    setBefore(undefined);
    setCheckpoint(undefined);
    setLockState(undefined);
    setReview(false);
    setSaved(false);
    let api;
    try {
      for (let i = 0; i < config.fields.length; i++) {
        if (
          config.fields[i] === 'Subnet ID' &&
          !/^[1-9]\d{0,4}$/.test(String(args[i] ?? ''))
        )
          throw Error('Enter the subnet ID first');
        if (config.fields[i].includes('hotkey')) addressSchema.parse(args[i]);
      }
      api = await connect(selected.network);
      if (!api.tx[config.section]?.[config.method])
        throw Error('This runtime does not support this control');
      const hash = await api.rpc.chain.getFinalizedHead();
      const at = await api.at(hash);
      const sub = at.query.subtensorModule;
      const context = args.filter((_, i) => isContext(i));
      let loaded = Array.from(
        { length: config.fields.length },
        (_, i) => args[i] ?? '',
      );
      if (isProfile) {
        const key =
          action === 'subnetIdentity' ? args[0] : accountAddress(selected);
        const value = (await sub[config.storage](key)).toJSON();
        if (
          value !== null &&
          (typeof value !== 'object' || Array.isArray(value))
        )
          throw Error('Unexpected identity response');
        const record = (value ?? {}) as Record<string, unknown>;
        const strings = profileFields[action].map((field) => {
          const value = record[field];
          if (value === undefined) {
            if (Object.keys(record).length)
              throw Error(
                'Identity fields changed in this runtime; use advanced review before editing',
              );
            return '';
          }
          if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value))
            throw Error(
              'Unsupported identity encoding; preserve the profile with an advanced call',
            );
          const decoded = hexToString(value);
          if (stringToHex(decoded).toLowerCase() !== value.toLowerCase())
            throw Error(
              'Profile contains non-text bytes; use an advanced call to preserve them',
            );
          return decoded;
        });
        loaded =
          action === 'subnetIdentity' ? [String(args[0]), ...strings] : strings;
      } else if (config.storage) {
        const keys =
          action === 'perpetual'
            ? [accountAddress(selected), args[0]]
            : context;
        const stored = await sub[config.storage](...keys);
        const value = stored.toJSON();
        if (
          value !== null &&
          !['string', 'number', 'boolean'].includes(typeof value)
        )
          throw Error('Unexpected current setting response');
        loaded[loaded.length - 1] =
          action === 'perpetual'
            ? value === false
            : typeof value === 'boolean'
              ? value
              : typeof value === 'string' || typeof value === 'number'
                ? stored.toString()
                : '';
      }
      if (action === 'perpetual' || action === 'lock') {
        const netuid = action === 'lock' ? args[1] : args[0];
        const [lock, available] = await Promise.all([
          at.call.stakeInfoRuntimeApi.getColdkeyLock(
            accountAddress(selected),
            netuid,
          ),
          at.call.stakeInfoRuntimeApi.getStakeAvailabilityForColdkeys(
            [accountAddress(selected)],
            [netuid],
          ),
        ]);
        setLockState({ lock: lock.toJSON(), availability: available.toJSON() });
      }
      setArgs(loaded);
      setDrafts({});
      setBefore([...loaded]);
      setCheckpoint((await api.rpc.chain.getHeader(hash)).number.toNumber());
    } catch (e) {
      setError((e as Error).message);
      setBefore(undefined);
    } finally {
      await api?.disconnect();
      setBusy(false);
    }
  }
  async function propose() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const operation = controlSchema.parse({ kind: 'control', action, args });
      if (!review) {
        setReview(true);
        return;
      }
      await onSave({
        action: 'propose',
        id: crypto.randomUUID(),
        accountId,
        title: config.title,
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
  if (!accounts.length)
    return (
      <section className="panel padded">
        <h3>Choose who controls the changes</h3>
        <p className="section-copy">
          Create an account with the people who will approve changes together.
        </p>
        <button className="button primary" onClick={onCreate}>
          Set up an account
        </button>
      </section>
    );
  return (
    <section className="panel padded controls-panel">
      <div className="input-row">
        <label>
          Account
          <Choice
            value={accountId}
            disabled={busy}
            onChange={(e) => {
              setAccountId(e.target.value);
              reset();
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.network === 'finney' ? 'Mainnet' : 'Testnet'}
              </option>
            ))}
          </Choice>
        </label>
        <label>
          What would you like to change?
          <Choice
            value={action}
            disabled={busy}
            onChange={(e) => {
              setAction(e.target.value as ControlAction);
              reset();
            }}
          >
            {Object.entries(controls)
              .filter(([, c]) => c.group === group)
              .map(([key, c]) => (
                <option key={key} value={key}>
                  {c.title}
                </option>
              ))}
          </Choice>
        </label>
      </div>
      <h3 className="section-label">{config.title}</h3>
      <p className="section-copy">{config.note}</p>
      <div className="form-stack">
        {config.fields.map((label, i) => {
          const context = isContext(i);
          const disabled =
            busy ||
            (!context && before === undefined) ||
            review ||
            (!editable && !context);
          if (boolActions.has(action) && i === config.fields.length - 1)
            return (
              <label key={label}>
                {label}
                <Choice
                  value={String(args[i] ?? false)}
                  disabled={disabled}
                  onChange={(e) => change(i, e.target.value === 'true')}
                >
                  <option value="false">Off</option>
                  <option value="true">On</option>
                </Choice>
              </label>
            );
          const amount = action === 'lock' && i === 2;
          const commission = label.includes('Commission');
          return (
            <label key={label}>
              {amount
                ? 'Additional alpha to lock'
                : commission
                  ? 'Commission (%)'
                  : label}
              <input
                disabled={disabled}
                value={
                  drafts[i] ??
                  (amount && args[i]
                    ? formatUnits(String(args[i]), 9)
                    : commission && args[i]
                      ? ((Number(args[i]) * 100) / 65535).toFixed(4)
                      : String(args[i] ?? ''))
                }
                onChange={(e) => {
                  const value = e.target.value;
                  setDrafts((old) => ({ ...old, [i]: value }));
                  if (amount || commission) {
                    try {
                      const raw = amount
                        ? parseUnits(value)
                        : (
                            (BigInt(percentParts(value)) * 65535n) /
                            1000000n
                          ).toString();
                      change(i, raw);
                    } catch {
                      change(i, '');
                    }
                  } else change(i, value);
                }}
                placeholder={
                  context ? (label.includes('hotkey') ? '5…' : 'e.g. 1') : ''
                }
              />
              {label.includes('Commission') && args[i] && (
                <small>
                  Approximately {((Number(args[i]) * 100) / 65535).toFixed(4)}%
                </small>
              )}
            </label>
          );
        })}
      </div>
      <div className="action-bar">
        <button
          className="button outline"
          disabled={busy || review}
          onClick={load}
        >
          {busy ? 'Checking…' : 'Load current settings'}
        </button>
      </div>
      {lockState !== undefined && (
        <details className="technical-review">
          <summary>Current conviction and alpha availability</summary>
          <pre className="code-box">{JSON.stringify(lockState, null, 2)}</pre>
        </details>
      )}
      {checkpoint !== undefined && (
        <p className="muted">
          Read from finalized block #{checkpoint}. {selected?.threshold}{' '}
          approvals are needed. Settings may change before the final approval.
        </p>
      )}
      {config.authority === 'owner' && (
        <p className="muted">
          The selected account must own this subnet. Configuration windows and
          cooldowns are enforced by the chain.
        </p>
      )}
      {review && (
        <div className="notice">
          <div>
            <strong>Review your change</strong>
            {config.fields.map((label, i) => (
              <div key={label}>
                {label}: <code>{String(before?.[i] ?? '') || '(blank)'}</code> →{' '}
                <code>{String(args[i]) || '(blank)'}</code>
              </div>
            ))}
            <p>
              This creates a request for your account’s approvers. Nothing
              changes on-chain yet.
            </p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {saved ? (
        <output className="notice">
          Request created. Open Transactions to review and collect approvals.
        </output>
      ) : (
        <div className="action-bar">
          {review && (
            <button className="button outline" onClick={() => setReview(false)}>
              Edit
            </button>
          )}
          <button
            className="button primary"
            disabled={busy || before === undefined || !editable}
            onClick={propose}
          >
            {review ? 'Create approval request' : 'Review change'}
          </button>
        </div>
      )}
    </section>
  );
}
