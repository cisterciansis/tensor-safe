'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { Check, ExternalLink, Plug, Unplug, Wallet } from 'lucide-react';
import type {
  Injected,
  InjectedAccount,
  InjectedWindow,
} from '@polkadot/extension-inject/types';
import { stringToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Copyable } from '@/components/copyable';
import { accountKey, type Account } from '@/lib/domain';

// Each extension is connected on its own, so access is granted and withdrawn
// per wallet. Approval itself always happens inside the extension.
export type WalletAccount = { address: string; name: string; wallet: string };
type Extension = {
  id: string;
  injected?: Injected;
  accounts: WalletAccount[];
  error?: string;
  stop?: () => void;
};
const NAMES: Record<string, string> = {
  'polkadot-js': 'Polkadot.js',
  talisman: 'Talisman',
  'subwallet-js': 'SubWallet',
  'fearless-wallet': 'Fearless',
  enkrypt: 'Enkrypt',
  'nova-wallet': 'Nova',
};
const INSTALL = [
  ['Talisman', 'https://talisman.xyz'],
  ['SubWallet', 'https://www.subwallet.app'],
  ['Polkadot.js', 'https://polkadot.js.org/extension/'],
];
export const walletName = (id: string) => NAMES[id] ?? id;
// A site only sees the accounts the user ticked for it; it cannot ask for more.
export const shareHint = (id: string) =>
  `In ${walletName(id)}, open its connected sites (website access), pick ${location.host} and tick the accounts to share. They appear here instantly.`;
// Remembered per browser only, so returning visitors reconnect silently.
const REMEMBER = 'tensor-safe:wallets';

let extensions: Extension[] = [];
const listeners = new Set<() => void>();
const EMPTY: Extension[] = [];
function set(id: string, patch: Partial<Extension>) {
  extensions = extensions.map((e) => (e.id === id ? { ...e, ...patch } : e));
  listeners.forEach((l) => l());
}
function remembered(): string[] {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER) ?? '[]');
  } catch {
    return [];
  }
}
function remember(id: string, on: boolean) {
  try {
    const ids = remembered().filter((v) => v !== id);
    localStorage.setItem(REMEMBER, JSON.stringify(on ? [...ids, id] : ids));
  } catch {}
}
const accountsOf = (id: string, list: InjectedAccount[]) =>
  list.flatMap((a) => {
    // Bittensor uses 32-byte Substrate keys; EVM accounts can't sign here.
    if (a.type === 'ethereum') return [];
    try {
      return [
        {
          address: encodeAddress(decodeAddress(a.address), 42),
          name: a.name ?? 'Unnamed',
          wallet: id,
        },
      ];
    } catch {
      return [];
    }
  });

export async function connectWallet(id: string) {
  const provider = (window as Window & Partial<InjectedWindow>).injectedWeb3?.[
    id
  ];
  if (!provider?.enable) return;
  set(id, { error: undefined });
  try {
    const injected = await provider.enable('Tensor Safe');
    set(id, {
      injected,
      accounts: accountsOf(id, await injected.accounts.get()),
      stop: injected.accounts.subscribe((list) =>
        set(id, { accounts: accountsOf(id, list) }),
      ),
    });
    remember(id, true);
  } catch (e) {
    set(id, { error: (e as Error).message || 'Access was not granted' });
  }
}
export function disconnectWallet(id: string) {
  extensions.find((e) => e.id === id)?.stop?.();
  set(id, { injected: undefined, accounts: [], stop: undefined });
  remember(id, false);
}
// Extensions inject after load; detect once, then restore remembered ones.
let detected = false;
function detect() {
  if (detected) return;
  detected = true;
  setTimeout(() => {
    const found = Object.keys(
      (window as Window & Partial<InjectedWindow>).injectedWeb3 ?? {},
    );
    extensions = found.map((id) => ({ id, accounts: [] }));
    listeners.forEach((l) => l());
    for (const id of remembered())
      if (found.includes(id)) void connectWallet(id);
  }, 400);
}
export function useWallets() {
  useEffect(detect, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => extensions,
    () => EMPTY,
  );
}
/** Signer for a connected account, or undefined if its wallet disconnected. */
export const signerFor = (wallets: Extension[], account?: WalletAccount) =>
  wallets.find((e) => e.id === account?.wallet)?.injected?.signer;

/**
 * Asks the wallet holding `address` to sign a text message. Wallets wrap it
 * in <Bytes>…</Bytes>, so it can never be mistaken for a transaction.
 */
export async function signMessage(address: string, message: string) {
  const account = extensions
    .flatMap((e) => e.accounts)
    .find((a) => accountKey(a.address) === accountKey(address));
  const signRaw = signerFor(extensions, account)?.signRaw;
  if (!account || !signRaw)
    throw Error(
      `Connect the wallet that holds ${address.slice(0, 6)}…${address.slice(-6)} to sign.`,
    );
  const { signature } = await signRaw({
    address: account.address,
    data: stringToHex(message),
    type: 'bytes',
  });
  // Some wallets prefix the scheme byte (MultiSignature); the server wants 64 bytes.
  return signature.length === 132 ? `0x${signature.slice(4)}` : signature;
}

export function WalletMenu({ accounts }: { accounts: Account[] }) {
  const wallets = useWallets();
  const connected = wallets.flatMap((w) => w.accounts);
  const roles = (address: string) =>
    accounts
      .filter((a) =>
        a.signers.some((s) => accountKey(s.address) === accountKey(address)),
      )
      .map((a) => a.name);
  const signers = connected.filter((a) => roles(a.address).length);
  return (
    <Popover>
      <PopoverTrigger
        className={`button outline wallet-button ${connected.length ? 'connected' : ''}`}
      >
        <Wallet size={16} />
        <span>
          {connected.length
            ? (signers[0]?.name ?? connected[0].name) +
              (connected.length > 1 ? ` +${connected.length - 1}` : '')
            : 'Connect wallet'}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="wallet-menu">
        <div className="wallet-menu-head">
          <strong>Wallets</strong>
          <span className="muted">
            {connected.length
              ? `${connected.length} account${connected.length > 1 ? 's' : ''} · ${signers.length} co-signer${signers.length === 1 ? '' : 's'}`
              : 'Connect a wallet to sign'}
          </span>
        </div>
        {wallets.length ? (
          wallets.map((w) => (
            <section key={w.id} className="wallet-group">
              <div className="wallet-row">
                <span className="wallet-logo">{walletName(w.id)[0]}</span>
                <span className="wallet-title">
                  <strong>{walletName(w.id)}</strong>
                  <small className={w.injected ? 'ok' : ''}>
                    {w.injected
                      ? `Connected · ${w.accounts.length} account${w.accounts.length === 1 ? '' : 's'}`
                      : (w.error ?? 'Not connected')}
                  </small>
                </span>
                {w.injected ? (
                  <button
                    type="button"
                    className="copy-mini"
                    aria-label={`Disconnect ${walletName(w.id)}`}
                    title="Disconnect"
                    onClick={() => disconnectWallet(w.id)}
                  >
                    <Unplug size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button outline small"
                    onClick={() => connectWallet(w.id)}
                  >
                    <Plug size={14} /> Connect
                  </button>
                )}
              </div>
              {w.accounts.map((a) => (
                <div key={a.address} className="wallet-account">
                  <span className="wallet-account-main">
                    <span>
                      {a.name}
                      {roles(a.address).length > 0 && (
                        <span className="chip signer-chip">
                          <Check size={11} /> Signer ·{' '}
                          {roles(a.address).join(', ')}
                        </span>
                      )}
                    </span>
                    <Copyable value={a.address} label={`${a.name}'s address`} />
                  </span>
                </div>
              ))}
              {w.injected && (
                <details className="wallet-hint">
                  <summary>Missing an account?</summary>
                  <p>{shareHint(w.id)}</p>
                </details>
              )}
            </section>
          ))
        ) : (
          <div className="wallet-empty">
            <p>No wallet extension found in this browser.</p>
            {INSTALL.map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noreferrer">
                Get {name} <ExternalLink size={12} />
              </a>
            ))}
          </div>
        )}
        <p className="wallet-foot muted">
          You choose which accounts to share inside each extension. To revoke
          this site, use the extension’s connected-sites settings. Connecting
          never grants workspace access or moves funds.
        </p>
      </PopoverContent>
    </Popover>
  );
}
