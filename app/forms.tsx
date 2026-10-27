'use client';
import { Choice } from '@/lib/choices';
import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ZodError } from 'zod';
import { Copyable } from '@/components/copyable';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  responseSchema,
  accountSchema,
  accountAddress,
  parseUnits,
  allocate,
  type Workspace,
  type Operation,
  formatUnits,
  type Owner,
} from '@/lib/domain';
import { connect, type Chain } from '@/lib/chain';
import {
  SCHEMES,
  isReceiving,
  parseReceiving,
  type Scheme,
} from '@/lib/wallets';
type SignerInput = { name: string; address: string; scheme?: Scheme };
// Show validation issues as plain sentences, not serialized JSON.
const message = (e: unknown) =>
  e instanceof ZodError
    ? [...new Set(e.issues.map((i) => i.message))].join('. ')
    : (e as Error).message;
export type FormKind =
  | 'workspace'
  | 'account'
  | 'transaction'
  | 'contact'
  | 'agreement'
  | 'distribution'
  | 'revision'
  | 'member'
  | 'reconcile';
export default function Forms({
  kind,
  workspace,
  selected,
  onClose,
  onSave,
}: {
  kind: FormKind;
  workspace: Workspace | null;
  selected?: string;
  onClose: () => void;
  onSave: (command: unknown) => Promise<unknown>;
}) {
  const [name, setName] = useState(''),
    [network, setNetwork] = useState<'finney' | 'test'>('test'),
    [threshold, setThreshold] = useState(2),
    [signers, setSigners] = useState<SignerInput[]>([
      { name: '', address: '' },
      { name: '', address: '' },
    ]),
    [accountMode, setAccountMode] = useState<'legacy' | 'safe'>('legacy'),
    [support, setSupport] = useState<
      Partial<Record<'finney' | 'test', boolean>>
    >({}),
    [owners, setOwners] = useState<Owner[]>([
      { name: '', address: '', bps: 10000 },
    ]),
    [accountId, setAccountId] = useState(
      selected && workspace?.accounts.some((a) => a.id === selected)
        ? selected
        : (workspace?.accounts[0]?.id ?? ''),
    ),
    [address, setAddress] = useState(''),
    [amount, setAmount] = useState(''),
    [hotkey, setHotkey] = useState(''),
    [netuid, setNetuid] = useState(''),
    [block, setBlock] = useState(''),
    [source, setSource] = useState(''),
    [agreementId, setAgreementId] = useState(
      selected ?? workspace?.agreements[0]?.id ?? '',
    ),
    [opKind, setOpKind] =
      useState<Exclude<Operation['kind'], 'control' | 'children'>>('transfer'),
    [proxyType, setProxyType] = useState('Staking'),
    [delay, setDelay] = useState('0'),
    [limit, setLimit] = useState(''),
    [operations, setOperations] = useState<Operation[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [role, setRole] = useState('viewer'),
    [existing, setExisting] = useState(false),
    [automatic, setAutomatic] = useState(true),
    [progress, setProgress] = useState('');
  const stopped = useRef(false),
    chosen = useRef(false);
  useEffect(
    () => () => {
      stopped.current = true;
    },
    [],
  );
  // Quantum-safe addresses exist only where the runtime has the safe multisig calls.
  useEffect(() => {
    if (kind !== 'account') return;
    let live = true,
      api: Chain | undefined;
    connect(network)
      .then((a) => {
        api = a;
        const ok = !!a.tx.multisig.asMultiSafe;
        if (!live) return;
        setSupport((v) => ({ ...v, [network]: ok }));
        if (!ok || !chosen.current) setAccountMode(ok ? 'safe' : 'legacy');
      })
      .catch(() => live && setSupport((v) => ({ ...v, [network]: false })))
      .finally(() => !live && api?.disconnect());
    return () => {
      live = false;
      void api?.disconnect();
    };
  }, [kind, network]);
  async function syncAccrual() {
    setBusy(true);
    setError('');
    stopped.current = false;
    try {
      let a = workspace?.agreements.find((a) => a.id === agreementId);
      if (!a) throw Error('Select an agreement');
      const target = Number(block);
      let from =
        a.accrual?.toBlock ??
        workspace!.distributions
          .filter((d) => d.agreementId === a!.id)
          .reduce((v, d) => Math.max(v, d.toBlock), a.startBlock);
      if (!Number.isInteger(target) || target <= from)
        throw Error('Choose a later finalized block');
      while (from < target && !stopped.current) {
        const end = Math.min(from + 16, target);
        setProgress(`Reconstructing blocks ${from + 1}–${end}…`);
        const result = responseSchema.parse(
          await onSave({ action: 'accrue', agreementId, toBlock: end }),
        );
        a = result.workspace!.agreements.find((v) => v.id === agreementId)!;
        from = a.accrual!.toBlock;
      }
      setProgress(
        stopped.current
          ? 'Stopped after the last saved checkpoint.'
          : `Verified archive through block ${from}`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const titles: Record<FormKind, string> = {
    workspace: 'Create workspace',
    account: 'Add multisig account',
    transaction: 'Send or request a change',
    contact: 'Add trusted address',
    agreement: 'Create private ownership agreement',
    distribution: 'Prepare alpha distribution',
    revision: 'Revise ownership',
    member: 'Add workspace member',
    reconcile: 'Reconcile finalized transaction',
  };
  function operation(): Operation {
    switch (opKind) {
      case 'transfer':
        return { kind: opKind, to: address, amount: parseUnits(amount) };
      case 'alpha':
        return {
          kind: opKind,
          to: address,
          hotkey,
          netuid: Number(netuid),
          amount: parseUnits(amount),
        };
      case 'stake':
      case 'unstake':
        return {
          kind: opKind,
          hotkey,
          netuid: Number(netuid),
          amount: parseUnits(amount),
          limitPrice: parseUnits(limit),
        };
      case 'addProxy':
      case 'removeProxy':
        return {
          kind: opKind,
          delegate: address,
          proxyType: proxyType as Extract<
            Operation,
            { kind: 'addProxy' }
          >['proxyType'],
          delay: Number(delay),
        };
      case 'custom':
        return { kind: opKind, callHex: source };
    }
  }
  const newId = () => crypto.randomUUID();
  const safeSupport = support[network];
  // Rotating wallets are identified by their tao_ descriptor, never by choice.
  const keyType = (s: SignerInput): Scheme => {
    try {
      if (isReceiving(s.address)) return parseReceiving(s.address).scheme;
    } catch {}
    return s.scheme ?? 'sr25519';
  };
  async function save() {
    setBusy(true);
    setError('');
    try {
      let command: unknown;
      switch (kind) {
        case 'workspace':
          command = { name };
          break;
        case 'account':
          command = {
            action: 'addAccount',
            account: accountSchema.parse({
              id: newId(),
              name,
              network,
              mode: accountMode,
              threshold,
              signers,
            }),
          };
          break;
        case 'contact':
          command = { action: 'addContact', contact: { name, address } };
          break;
        case 'member':
          command = { action: 'addMember', userId: address, role };
          break;
        case 'agreement':
          command = {
            action: 'addAgreement',
            agreement: {
              id: newId(),
              name,
              accountId,
              netuid: Number(netuid),
              hotkey,
              startBlock: Number(block),
              revisions: [
                { id: newId(), effectiveBlock: Number(block) + 1, owners },
              ],
            },
          };
          break;
        case 'revision':
          command = {
            action: 'reviseAgreement',
            id: agreementId,
            revision: { id: newId(), effectiveBlock: Number(block), owners },
          };
          break;
        case 'distribution':
          if (automatic) {
            const a = workspace?.agreements.find((a) => a.id === agreementId);
            if (!a?.accrual || a.accrual.toBlock !== Number(block))
              throw Error('Sync the full selected interval first');
            command = { action: 'distributeAccrued', id: newId(), agreementId };
            break;
          }
          command = {
            action: 'distribute',
            id: newId(),
            agreementId,
            toBlock: Number(block),
            amount: parseUnits(amount),
            source,
          };
          break;
        case 'transaction':
          if (existing) {
            command = {
              action: 'importProposal',
              id: newId(),
              accountId,
              title: name,
              callHex: source,
            };
            break;
          }
          command = {
            action: 'propose',
            id: newId(),
            accountId,
            title: name,
            operations: operations.length ? operations : [operation()],
          };
          break;
        case 'reconcile':
          command = {
            action: 'reconcile',
            id: selected,
            blockHash: source,
            extrinsicHash: address,
          };
          break;
      }
      await onSave(command);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  let derived = '';
  try {
    derived = accountAddress(
      accountSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        name: name || 'Account',
        network,
        mode: accountMode,
        threshold,
        signers,
      }),
    );
  } catch {}
  let preview: ReturnType<typeof allocate> = [];
  try {
    const a = workspace?.agreements.find((a) => a.id === agreementId);
    if (a) preview = allocate(parseUnits(amount), a.revisions.at(-1)!.owners);
  } catch {}
  const accountPicker = (
    <label>
      Funding multisig
      <Choice value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">Select account</option>
        {workspace?.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {a.network === 'test' ? 'Testnet' : 'Mainnet'}
          </option>
        ))}
      </Choice>
    </label>
  );
  const agreementPicker = (
    <label>
      Private agreement
      <Choice
        value={agreementId}
        onChange={(e) => setAgreementId(e.target.value)}
      >
        <option value="">Select agreement</option>
        {workspace?.agreements.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · SN{a.netuid}
          </option>
        ))}
      </Choice>
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="flow-dialog">
        <DialogHeader>
          <DialogTitle>{titles[kind]}</DialogTitle>
          <DialogDescription>
            {kind === 'distribution'
              ? 'A reserved interval and immutable allocation snapshot. No payment is recorded until finalized execution.'
              : kind === 'account'
                ? 'Choose the people who can approve spending and how many approvals are needed. Their wallets stay in their control.'
                : 'Changes are validated and saved to your workspace audit trail.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="form-stack"
        >
          {[
            'workspace',
            'account',
            'transaction',
            'contact',
            'agreement',
          ].includes(kind) && (
            <label>
              {kind === 'transaction' ? 'Transaction title' : 'Name'}
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  kind === 'account' ? 'Subnet treasury' : 'Enter a name'
                }
              />
            </label>
          )}
          {kind === 'account' && (
            <>
              <label>
                Network
                <Choice
                  value={network}
                  onChange={(e) =>
                    setNetwork(e.target.value as 'finney' | 'test')
                  }
                >
                  <option value="test">Bittensor Testnet</option>
                  <option value="finney">Bittensor Mainnet</option>
                </Choice>
              </label>
              <div className="field-heading">Address type</div>
              <div className="segmented">
                <button
                  type="button"
                  className={accountMode === 'safe' ? 'selected' : ''}
                  disabled={!safeSupport}
                  onClick={() => {
                    chosen.current = true;
                    setAccountMode('safe');
                  }}
                >
                  Quantum-safe
                </button>
                <button
                  type="button"
                  className={accountMode === 'legacy' ? 'selected' : ''}
                  onClick={() => {
                    chosen.current = true;
                    setAccountMode('legacy');
                  }}
                >
                  Standard
                </button>
              </div>
              <div className="notice-text">
                {safeSupport === undefined
                  ? 'Checking network support…'
                  : !safeSupport
                    ? 'Quantum-safe addresses turn on automatically once this network enables them. Standard matches every existing Bittensor multisig.'
                    : accountMode === 'safe'
                      ? 'No raw key can sign for this address, so it pairs with ML-DSA and Falcon co-signers. Every co-signer’s btcli must use safe mode.'
                      : 'Use Standard to import an existing multisig.'}
              </div>
              <div className="field-heading">Co-signers</div>
              {signers.map((s, i) => (
                <div className="input-row" key={i}>
                  <input
                    aria-label={`Signer ${i + 1} name`}
                    placeholder="Name"
                    required
                    value={s.name}
                    onChange={(e) =>
                      setSigners(
                        signers.map((v, j) =>
                          j === i ? { ...v, name: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`Signer ${i + 1} address`}
                    placeholder="5… or tao_…"
                    required
                    value={s.address}
                    onChange={(e) =>
                      setSigners(
                        signers.map((v, j) =>
                          j === i
                            ? { ...v, address: e.target.value.trim() }
                            : v,
                        ),
                      )
                    }
                  />
                  <Choice
                    aria-label={`Signer ${i + 1} key type`}
                    disabled={isReceiving(s.address)}
                    value={keyType(s)}
                    onChange={(e) =>
                      setSigners(
                        signers.map((v, j) =>
                          j === i
                            ? { ...v, scheme: e.target.value as Scheme }
                            : v,
                        ),
                      )
                    }
                  >
                    {Object.entries(SCHEMES).map(([id, { label }]) => (
                      <option key={id} value={id}>
                        {label}
                        {isReceiving(s.address) && id === keyType(s)
                          ? ' · rotating'
                          : ''}
                      </option>
                    ))}
                  </Choice>
                  {signers.length > 2 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove signer"
                      onClick={() =>
                        setSigners(signers.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                disabled={signers.length >= 32}
                onClick={() =>
                  setSigners([...signers, { name: '', address: '' }])
                }
              >
                <Plus size={14} /> Add co-signer
              </button>
              <label>
                Approval threshold
                <input
                  type="number"
                  required
                  min={2}
                  max={signers.length}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </label>
              {accountMode === 'legacy' &&
                signers.some((s) => SCHEMES[keyType(s)].quantum) && (
                  <div className="notice warning">
                    Standard multisig addresses can be signed for by a classical
                    key, so they are not quantum-safe even with ML-DSA or Falcon
                    co-signers.
                  </div>
                )}
              {derived && (
                <div className="notice-text">
                  Derived multisig
                  <span className="full-address">
                    <Copyable
                      value={derived}
                      full
                      network={network}
                      kind="account"
                      label="derived address"
                    />
                  </span>
                </div>
              )}
              <div className="notice-text">
                Changing signers or threshold creates a different address. Fund
                the derived account only after checking the complete
                configuration.
              </div>
            </>
          )}
          {['contact', 'member'].includes(kind) && (
            <label>
              {kind === 'member' ? 'Member user ID' : 'Wallet address'}
              <input
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={
                  kind === 'member'
                    ? 'Copy from their workspace settings'
                    : '5… or tao_…'
                }
              />
            </label>
          )}
          {kind === 'member' && (
            <label>
              Workspace role
              <Choice value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="viewer">Viewer — read only</option>
                <option value="manager">
                  Manager — prepare proposals and manage records
                </option>
              </Choice>
            </label>
          )}
          {['agreement', 'transaction'].includes(kind) && accountPicker}
          {['revision', 'distribution'].includes(kind) && agreementPicker}
          {kind === 'agreement' && (
            <>
              <label>
                Subnet ID
                <input
                  required
                  type="number"
                  min={1}
                  max={65535}
                  value={netuid}
                  onChange={(e) => setNetuid(e.target.value)}
                />
              </label>
              <label>
                Owner emission hotkey
                <input
                  required
                  value={hotkey}
                  onChange={(e) => setHotkey(e.target.value)}
                  placeholder="5…"
                />
              </label>
              <p className="notice-text">
                Private shares apply to declared residual owner alpha after
                native lease payouts. They represent your private agreement, not
                protocol ownership rights.
              </p>
            </>
          )}
          {['agreement', 'revision', 'distribution'].includes(kind) && (
            <label>
              {kind === 'agreement'
                ? 'Opening block (excluded)'
                : kind === 'revision'
                  ? 'Effective from block'
                  : 'Finalized interval end block (included)'}
              <input
                required
                type="number"
                min={0}
                max={4294967295}
                value={block}
                onChange={(e) => setBlock(e.target.value)}
              />
            </label>
          )}
          {['agreement', 'revision'].includes(kind) && (
            <>
              <div className="field-heading">
                Ownership ·{' '}
                {(owners.reduce((s, o) => s + o.bps, 0) / 100).toFixed(2)}%
                total
              </div>
              {owners.map((o, i) => (
                <div className="owner-input" key={i}>
                  <input
                    aria-label={`Investor ${i + 1} name`}
                    placeholder="Investor name"
                    required
                    value={o.name}
                    onChange={(e) =>
                      setOwners(
                        owners.map((v, j) =>
                          i === j ? { ...v, name: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`Investor ${i + 1} wallet`}
                    placeholder="Wallet address"
                    required
                    value={o.address}
                    onChange={(e) =>
                      setOwners(
                        owners.map((v, j) =>
                          i === j ? { ...v, address: e.target.value } : v,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`Investor ${i + 1} basis points`}
                    type="number"
                    min={1}
                    max={10000}
                    required
                    value={o.bps}
                    onChange={(e) =>
                      setOwners(
                        owners.map((v, j) =>
                          i === j ? { ...v, bps: Number(e.target.value) } : v,
                        ),
                      )
                    }
                  />
                  <span>bps</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove investor"
                    onClick={() => setOwners(owners.filter((_, j) => i !== j))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                disabled={owners.length >= 64}
                onClick={() =>
                  setOwners([...owners, { name: '', address: '', bps: 0 }])
                }
              >
                <Plus size={14} /> Add investor
              </button>
              <p className="muted">
                100 basis points = 1%. Total must equal 10,000 bps. New
                revisions preserve every existing distribution.
              </p>
            </>
          )}
          {kind === 'distribution' && (
            <>
              <label className="cancel-choice">
                <input
                  type="checkbox"
                  checked={automatic}
                  onChange={(e) => setAutomatic(e.target.checked)}
                />
                Reconstruct owner credits from archive (runtime 454, unleased)
              </label>
              {automatic && (
                <>
                  <div className="notice-text">
                    Observed:{' '}
                    {workspace?.agreements.find((a) => a.id === agreementId)
                      ?.accrual?.toBlock ?? 'not synced'}{' '}
                    ·{' '}
                    {formatUnits(
                      workspace?.agreements.find((a) => a.id === agreementId)
                        ?.accrual?.amount ?? '0',
                      9,
                    )}{' '}
                    α
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="button outline"
                    onClick={syncAccrual}
                  >
                    Sync to interval end
                  </button>
                  {busy && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        stopped.current = true;
                      }}
                    >
                      Stop after checkpoint
                    </button>
                  )}
                  <output>{progress}</output>
                </>
              )}

              <label>
                Accrued residual alpha
                <input
                  required={!automatic}
                  disabled={automatic}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.000000000"
                />
              </label>
              <label>
                Revenue evidence / reconciliation reference
                <textarea
                  required={!automatic}
                  disabled={automatic}
                  minLength={8}
                  maxLength={1000}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Source report, covered block range, adjustments, and reviewer…"
                />
              </label>
              <div className="notice warning">
                {automatic
                  ? 'Automatic reconstruction verifies continuous finalized state. Unsupported, locked or changed ownership intervals require separate review.'
                  : 'Declared revenue: reconcile your source independently. Balance growth alone is not revenue.'}
              </div>
              {preview.length > 0 && (
                <div className="allocation-preview">
                  {preview.map((p) => (
                    <div key={p.address}>
                      <span>{p.name}</span>
                      <strong>{formatUnits(p.amount, 9)} α</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {kind === 'transaction' && (
            <>
              <details className="technical-review">
                <summary>Advanced · import an existing request</summary>
                <label className="cancel-choice">
                  <input
                    type="checkbox"
                    checked={existing}
                    onChange={(e) => {
                      setExisting(e.target.checked);
                      setOpKind('custom');
                    }}
                  />
                  Import an existing on-chain multisig preimage
                </label>
              </details>
              <label>
                Action
                <Choice
                  value={opKind}
                  disabled={existing}
                  onChange={(e) =>
                    setOpKind(
                      e.target.value as Exclude<
                        Operation['kind'],
                        'control' | 'children'
                      >,
                    )
                  }
                >
                  <option value="transfer">Send TAO</option>
                  <option value="alpha">Transfer staked alpha</option>
                  <option value="stake">Stake with price limit</option>
                  <option value="unstake">Unstake with price limit</option>
                  <option value="addProxy">Add proxy</option>
                  <option value="removeProxy">Remove proxy</option>
                  <option value="custom">Advanced SCALE call</option>
                </Choice>
              </label>
              {['transfer', 'alpha', 'addProxy', 'removeProxy'].includes(
                opKind,
              ) && (
                <label>
                  {opKind.includes('Proxy') ? 'Delegate' : 'Recipient'}
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value.trim())}
                    placeholder="5… or tao_…"
                  />
                </label>
              )}
              {['transfer', 'alpha', 'stake', 'unstake'].includes(opKind) && (
                <label>
                  Amount (
                  {['alpha', 'unstake'].includes(opKind) ? 'alpha' : 'TAO'})
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
              )}
              {['alpha', 'stake', 'unstake'].includes(opKind) && (
                <>
                  <label>
                    Hotkey
                    <input
                      value={hotkey}
                      onChange={(e) => setHotkey(e.target.value)}
                      placeholder="5…"
                    />
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
                </>
              )}
              {['stake', 'unstake'].includes(opKind) && (
                <label>
                  {opKind === 'stake' ? 'Maximum' : 'Minimum'} TAO per alpha
                  <input
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="0.01"
                  />
                  <small>Limit orders reject partial fills.</small>
                </label>
              )}
              {opKind.includes('Proxy') && (
                <>
                  <label>
                    Runtime proxy type
                    <input
                      value={proxyType}
                      onChange={(e) => setProxyType(e.target.value)}
                      list="proxy-types"
                    />
                    <datalist id="proxy-types">
                      {[
                        'Any',
                        'Owner',
                        'Staking',
                        'Transfer',
                        'NonTransfer',
                        'SubnetLeaseBeneficiary',
                      ].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Delay in blocks
                    <input
                      type="number"
                      min={0}
                      value={delay}
                      onChange={(e) => setDelay(e.target.value)}
                    />
                  </label>
                  <p className="notice-text">
                    Proxy permissions come from the connected runtime. A nonzero
                    delay requires the announce / proxyAnnounced flow; use
                    advanced calls for those operations.
                  </p>
                </>
              )}
              {opKind === 'custom' && (
                <label>
                  Encoded call hex
                  <textarea
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="0x…"
                  />
                  <small>
                    Reviewed and decoded against runtime metadata before
                    proposal storage. Advanced calls can grant broad authority.
                  </small>
                </label>
              )}
              <button
                type="button"
                className="button outline"
                onClick={() => {
                  try {
                    setOperations([...operations, operation()]);
                    setError('');
                  } catch (e) {
                    setError(message(e));
                  }
                }}
              >
                <Plus size={14} /> Add action to batch
              </button>
              {operations.map((o, i) => (
                <div className="batch-row" key={i}>
                  <span>
                    {i + 1}. {o.kind}{' '}
                    {'amount' in o ? formatUnits(o.amount, 9) : ''}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove action"
                    onClick={() =>
                      setOperations(operations.filter((_, j) => j !== i))
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {operations.length > 0 && (
                <p className="muted">
                  {operations.length} staged actions. Multiple actions execute
                  atomically through utility.batchAll.
                </p>
              )}
            </>
          )}
          {kind === 'reconcile' && (
            <>
              <label>
                Finalized block hash
                <input
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="0x…"
                />
              </label>
              <label>
                Extrinsic hash
                <input
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x…"
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
          <button className="button primary" type="submit" disabled={busy}>
            {busy
              ? 'Validating & saving…'
              : kind === 'transaction'
                ? 'Review & save proposal'
                : kind === 'distribution'
                  ? 'Reserve interval & create proposal'
                  : 'Save'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
