'use client';
import { useState } from 'react';
import { ExternalLink, Plug } from 'lucide-react';
import { Tau } from '@/components/tau';
import { short } from '@/components/copyable';
import { isSignInMessage } from '@/lib/auth';
import { connectWallet, signMessage, useWallets, walletName } from './wallets';

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? 'Sign-in failed');
  return result;
}

/** Sign in by signing a one-time message with any connected wallet account. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const wallets = useWallets();
  const accounts = wallets.flatMap((w) => w.accounts);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  async function signIn(address: string) {
    setBusy(address);
    setError('');
    try {
      const challenge = await post('/api/session/challenge', { address });
      // Sign only a genuine sign-in message for this site, account and moment,
      // so a compromised server can't slip in a change approval instead.
      if (
        !isSignInMessage(String(challenge.message), {
          origin: location.origin,
          address,
          nonce: challenge.nonce,
        })
      )
        throw Error('Unexpected sign-in request. Nothing was signed.');
      const signature = await signMessage(address, challenge.message);
      await post('/api/session', { nonce: challenge.nonce, signature });
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <main className="sign-in">
      <section className="sign-in-card">
        <span className="sign-in-mark">
          <Tau />
        </span>
        <h1>Sign in with your wallet</h1>
        <p className="muted">
          Your wallet signs a one-time message. No transaction, no fee, and no
          password.
        </p>
        {accounts.length > 0 && (
          <div className="sign-in-list">
            {accounts.map((a) => (
              <button
                key={a.wallet + a.address}
                className="sign-in-account"
                disabled={!!busy}
                onClick={() => signIn(a.address)}
              >
                <span className="account-avatar">
                  {a.name[0]?.toUpperCase()}
                </span>
                <span className="row-main">
                  <strong>{a.name}</strong>
                  <small>
                    {short(a.address)} · {walletName(a.wallet)}
                  </small>
                </span>
                <span className="text-button">
                  {busy === a.address ? 'Check your wallet…' : 'Sign in'}
                </span>
              </button>
            ))}
          </div>
        )}
        {wallets.some((w) => !w.injected) && (
          <div className="action-bar">
            {wallets
              .filter((w) => !w.injected)
              .map((w) => (
                <button
                  key={w.id}
                  className={`button ${accounts.length ? 'outline' : 'primary'}`}
                  onClick={() => connectWallet(w.id)}
                >
                  <Plug size={16} /> Connect {walletName(w.id)}
                </button>
              ))}
          </div>
        )}
        {!wallets.length && (
          <div className="wallet-empty">
            <p>Install a Bittensor-compatible wallet extension to continue.</p>
            {[
              ['Talisman', 'https://talisman.xyz'],
              ['SubWallet', 'https://www.subwallet.app'],
              ['Polkadot.js', 'https://polkadot.js.org/extension/'],
            ].map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noreferrer">
                Get {name} <ExternalLink size={12} />
              </a>
            ))}
          </div>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <p className="notice-text">
          Signing in proves you control the address. It never grants spending
          authority: only your multisig’s on-chain threshold can move funds.
        </p>
      </section>
    </main>
  );
}
