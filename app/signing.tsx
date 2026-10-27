'use client';
import { TransactionReview } from './transaction-review';
import { Tau } from '@/components/tau';
import { Choice } from '@/lib/choices';
import { useState, useRef, useEffect } from 'react';
import { QrDisplayPayload, QrScanSignature } from '@polkadot/react-qr';
import {
  connectWallet,
  shareHint,
  signerFor,
  useWallets,
  walletName,
} from './wallets';
import type { SignerPayloadJSON } from '@polkadot/types/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  connect,
  externalApproval,
  multisigCall,
  type Chain,
} from '@/lib/chain';
import { SCHEMES, browserSignable } from '@/lib/wallets';
import { Copyable } from '@/components/copyable';
import {
  formatUnits,
  accountKey,
  accountAddress,
  addressSchema,
  type Account,
  type Proposal,
} from '@/lib/domain';
import {
  metadataProof,
  proofHash,
  vaultPayload,
  assertFresh,
  verifyOfflineSignature,
} from '@/lib/offline';
import { ShieldCheck, Usb, ScanLine, Download, Terminal } from 'lucide-react';
export function download(name: string, value: unknown) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function Signing({
  account,
  proposal,
  onClose,
  command,
}: {
  account: Account;
  proposal: Proposal;
  onClose: () => void;
  command: (v: unknown) => Promise<unknown>;
}) {
  const [address, setAddress] = useState(''),
    [mode, setMode] = useState<'extension' | 'vault' | 'cli'>(
      account.signers.some((s) => browserSignable(s.scheme, s.rotating))
        ? 'extension'
        : 'cli',
    ),
    [cli, setCli] = useState<{ signer: string; command: string }>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState<Uint8Array>(),
    [payload, setPayload] = useState<SignerPayloadJSON>(),
    [signature, setSignature] = useState(''),
    [scan, setScan] = useState(false),
    [cancelAction, setCancelAction] = useState(false),
    [review, setReview] = useState<{
      key: string;
      callHex: string;
      decoded: unknown;
      fee: string;
      deposit: string;
    }>();
  const apiRef = useRef<Chain | null>(null),
    pending = useRef<{
      resolve: (v: { id: number; signature: `0x${string}` }) => void;
      reject: (e: Error) => void;
      bytes: Uint8Array;
      address: string;
    } | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.reject(Error('Signing closed'));
      void apiRef.current?.disconnect();
    };
  }, []);
  async function api() {
    if (!apiRef.current) apiRef.current = await connect(account.network);
    return apiRef.current;
  }
  // Connected wallet accounts that are co-signers of this multisig.
  const wallets = useWallets();
  const eligible = wallets
    .flatMap((w) => w.accounts)
    .filter(
      (a, i, all) =>
        account.signers.some(
          (s) => accountKey(s.address) === accountKey(a.address),
        ) && all.findIndex((b) => b.address === a.address) === i,
    );
  const chosen =
    address || (mode === 'extension' ? (eligible[0]?.address ?? '') : '');
  async function sign() {
    setBusy(true);
    setMessage('Preparing the exact call and signing checkpoint…');
    try {
      const chain = await api();
      const signer = addressSchema.parse(chosen);
      const tx = await multisigCall(
        chain,
        account,
        proposal,
        signer,
        cancelAction,
      );
      const key = `${chosen}:${mode}:${cancelAction}:${proposal.id}`;
      if (
        !review ||
        review.key !== key ||
        review.callHex !== tx.method.toHex()
      ) {
        const info = await tx.paymentInfo(signer);
        setReview({
          key,
          callHex: tx.method.toHex(),
          decoded: tx.method.toHuman(),
          fee: info.partialFee.toString(),
          deposit: (
            BigInt(chain.consts.multisig.depositBase.toString()) +
            BigInt(account.threshold) *
              BigInt(chain.consts.multisig.depositFactor.toString())
          ).toString(),
        });
        setMessage(
          'Review the decoded action and fee estimate below. Continue to request the signature.',
        );
        return;
      }
      const tree = await metadataProof(chain);
      let captured: SignerPayloadJSON | undefined;
      const external =
        mode === 'extension'
          ? signerFor(
              wallets,
              eligible.find((a) => a.address === signer),
            )
          : null;
      if (mode === 'extension' && !external)
        throw Error(
          'That wallet is no longer connected. Reconnect it and try again.',
        );
      await tx.signAsync(signer, {
        nonce: -1,
        era: 128,
        mode: 1,
        metadataHash: proofHash(tree),
        withSignedTransaction: false,
        signer: {
          signPayload: async (json: SignerPayloadJSON) => {
            captured = json;
            setPayload(json);
            if (mode === 'extension') {
              if (!external?.signPayload)
                throw Error('Wallet does not expose transaction signing');
              return external.signPayload(json);
            }
            const v = vaultPayload(chain, json, tree);
            setQr(v.qr);
            setMessage(
              'Scan with Polkadot Vault 7.5+ (sr25519), review every action, then scan its signature.',
            );
            return new Promise((resolve, reject) => {
              pending.current = {
                resolve,
                reject,
                bytes: v.signing,
                address: signer,
              };
            });
          },
        },
      });
      if (!captured || !alive.current) throw Error('Signing request closed');
      await assertFresh(chain, captured);
      setQr(undefined);
      setMessage('Reserving this signing attempt before broadcast…');
      await command({
        action: 'recordAttempt',
        id: proposal.id,
        signedHex: tx.toHex(),
      });
      setMessage(
        `Broadcasting ${tx.hash.toHex()}. Keep this transaction hash for recovery.`,
      );
      const finalized = await new Promise<{
        blockHash: string;
        extrinsicHash: string;
      }>((resolve, reject) => {
        let unsub: (() => void) | undefined;
        void tx
          .send((r) => {
            if (r.status.isFinalized) {
              unsub?.();
              resolve({
                blockHash: r.status.asFinalized.toHex(),
                extrinsicHash: tx.hash.toHex(),
              });
            } else if (r.isError) {
              unsub?.();
              reject(
                Error(
                  'Submission did not finalize. Reconcile the reserved attempt before retrying.',
                ),
              );
            }
          })
          .then((u) => {
            unsub = u;
          })
          .catch(reject);
      });
      await command({ action: 'reconcile', id: proposal.id, ...finalized });
      setMessage(
        'Finalized outcome recorded. An approval becomes a payment only when the multisig executes successfully.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      pending.current = null;
    }
  }
  async function prepareCli() {
    setBusy(true);
    setMessage('Preparing the exact hash approval…');
    try {
      const signer = addressSchema.parse(address);
      const r = await externalApproval(await api(), account, proposal, signer);
      setCli({ signer, command: r.command });
      setMessage(
        'Run this with btcli on the signer’s machine, then refresh. The final approval must carry the full call: submit it here from a wallet, Ledger or Vault co-signer.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function accept(value: string) {
    try {
      if (!pending.current) throw Error('No active signing request');
      const sig = verifyOfflineSignature(
        pending.current.bytes,
        value,
        pending.current.address,
      );
      pending.current.resolve({ id: 1, signature: sig });
      pending.current = null;
      setScan(false);
      setSignature('');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="flow-dialog">
        <DialogHeader>
          <DialogTitle>Review & sign</DialogTitle>
          <DialogDescription>
            {proposal.title} · {account.threshold} of {account.signers.length}{' '}
            approval policy
          </DialogDescription>
        </DialogHeader>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            Verify the destination, amount, network, and multisig on your
            signing device.
          </span>
        </div>
        <div className="detail-row">
          <span>Account address</span>
          <Copyable
            value={accountAddress(account)}
            network={account.network}
            kind="account"
            label="account address"
          />
        </div>
        <TransactionReview account={account} proposal={proposal} />
        <label className="cancel-choice">
          <input
            type="checkbox"
            checked={cancelAction}
            disabled={busy}
            onChange={(e) => setCancelAction(e.target.checked)}
          />{' '}
          Cancel on-chain proposal (opening depositor only)
        </label>
        <div className="segmented">
          <button
            disabled={busy}
            className={mode === 'extension' ? 'selected' : ''}
            onClick={() => {
              setMode('extension');
              setAddress('');
            }}
          >
            <Usb size={16} /> Wallet / Ledger
          </button>
          <button
            disabled={busy}
            className={mode === 'vault' ? 'selected' : ''}
            onClick={() => {
              setMode('vault');
              setAddress('');
            }}
          >
            <ScanLine size={16} /> Polkadot Vault
          </button>
          <button
            disabled={busy}
            className={mode === 'cli' ? 'selected' : ''}
            onClick={() => {
              setMode('cli');
              setAddress('');
            }}
          >
            <Terminal size={16} /> btcli
          </button>
        </div>
        {mode === 'cli' ? (
          <>
            <p className="muted">
              For ML-DSA, Falcon and rotating keys, which browser wallets cannot
              sign yet.
            </p>
            <label>
              Co-signer
              <Choice
                value={address}
                disabled={busy}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setCli(undefined);
                }}
              >
                <option value="">Select a co-signer</option>
                {account.signers.map((s) => (
                  <option key={s.address} value={s.address}>
                    {s.name} · {SCHEMES[s.scheme ?? 'sr25519'].label}
                    {s.rotating ? ' · rotating' : ''}
                  </option>
                ))}
              </Choice>
            </label>
            {cli?.signer === address ? (
              <>
                <pre className="code-box">{cli.command}</pre>
                <button
                  className="button outline"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(cli.command)
                      .then(() => setMessage('Command copied.'))
                      .catch(() => setMessage('Select and copy the command.'))
                  }
                >
                  Copy command
                </button>
              </>
            ) : (
              <button
                className="button primary"
                disabled={
                  busy ||
                  !address ||
                  cancelAction ||
                  proposal.status !== 'proposed'
                }
                onClick={prepareCli}
              >
                {busy ? 'Preparing…' : 'Prepare btcli approval'}
              </button>
            )}
          </>
        ) : mode === 'extension' ? (
          <>
            {eligible.length ? (
              <label>
                Signer
                <Choice
                  value={chosen}
                  disabled={busy}
                  onChange={(e) => setAddress(e.target.value)}
                >
                  {eligible.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.name} · {walletName(a.wallet)}
                    </option>
                  ))}
                </Choice>
              </label>
            ) : (
              <div className="notice-text">
                None of your connected accounts can sign for this multisig. It
                needs one of:
                <ul className="expected-signers">
                  {account.signers
                    .filter((s) => browserSignable(s.scheme, s.rotating))
                    .map((s) => (
                      <li key={s.address}>
                        {s.name} <Copyable value={s.address} label={s.name} />
                      </li>
                    ))}
                </ul>
                {wallets.find((w) => w.injected)
                  ? shareHint(wallets.find((w) => w.injected)!.id)
                  : wallets.length
                    ? 'Connect the wallet that holds one:'
                    : 'Install a wallet extension, or use Polkadot Vault or btcli.'}
                <div className="action-bar">
                  {wallets
                    .filter((w) => !w.injected)
                    .map((w) => (
                      <button
                        key={w.id}
                        className="button outline"
                        onClick={() => connectWallet(w.id)}
                      >
                        Connect {walletName(w.id)}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <label>
            Vault sr25519 co-signer address
            <input
              value={address}
              disabled={busy}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="5…"
            />
          </label>
        )}
        {qr && payload && (
          <div className="qr-surface">
            <QrDisplayPayload
              address={address}
              cmd={6}
              genesisHash={payload.genesisHash}
              payload={qr}
              size={260}
            />
            <button
              className="text-button"
              onClick={() =>
                download('tensor-safe-signing-payload.json', payload)
              }
            >
              <Download size={15} /> Export exact payload
            </button>
            {scan ? (
              <QrScanSignature
                onScan={(s) => accept(s.signature)}
                onError={(e) => setMessage(e.message)}
                size={250}
              />
            ) : (
              <button className="button outline" onClick={() => setScan(true)}>
                Scan signature
              </button>
            )}
            <label>
              Or paste signed response
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="0x…"
              />
            </label>
            <button
              className="button outline"
              onClick={() => accept(signature)}
            >
              Verify signature
            </button>
          </div>
        )}
        {review && (
          <>
            <details className="technical-review">
              <summary>Exact signing call · advanced</summary>
              <pre className="code-box">
                {JSON.stringify(review.decoded, null, 2)}
              </pre>
              <code>{review.callHex}</code>
            </details>
            <div className="detail-row">
              <span>Estimated signer fee</span>
              <strong>
                {formatUnits(review.fee, 9)} <Tau />
              </strong>
            </div>
            <div className="detail-row">
              <span>Opening deposit (first approval only)</span>
              <strong>
                {formatUnits(review.deposit, 9)} <Tau />
              </strong>
            </div>
          </>
        )}
        <output className="notice-text">{message}</output>
        {!qr && mode !== 'cli' && (
          <button
            className="button primary"
            disabled={
              busy ||
              !chosen ||
              !!proposal.attempt ||
              proposal.status !== 'proposed'
            }
            onClick={sign}
          >
            {busy
              ? 'Waiting for signer / finality…'
              : cancelAction
                ? 'Sign cancellation'
                : review
                  ? 'Sign & submit multisig action'
                  : 'Prepare signing review'}
          </button>
        )}
        {proposal.attempt && (
          <>
            <div className="notice-text">
              Unresolved attempt:{' '}
              <Copyable
                value={proposal.attempt.hash}
                network={account.network}
                kind="extrinsic"
                label="transaction hash"
              />
              <br />
              Expires at block {proposal.attempt.expires}. Reconcile its
              finalized block before another signature.
            </div>
            <button
              className="button outline"
              onClick={async () => {
                try {
                  await command({ action: 'recoverAttempt', id: proposal.id });
                  setMessage('Expired unconsumed attempt released.');
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Recover expired unbroadcast attempt
            </button>
          </>
        )}
        {['cancelled', 'failed'].includes(proposal.status) && (
          <button
            className="button outline"
            onClick={async () => {
              try {
                await command({ action: 'rebuild', id: proposal.id });
                setMessage(
                  'A new proposal was created with a fresh reference.',
                );
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Rebuild with current runtime
          </button>
        )}
        <p className="muted">
          An approval pays network fees and may reserve a multisig deposit.
          Private keys never enter this app.
        </p>
      </DialogContent>
    </Dialog>
  );
}
