// Wallet sign-in and wallet-signed workspace changes. Browser and server
// build and check the exact text a wallet displays and signs.
import { hexToU8a, stringToU8a, u8aWrapBytes } from '@polkadot/util';
import {
  blake2AsHex,
  decodeAddress,
  ed25519Verify,
  sr25519Verify,
} from '@polkadot/util-crypto';
import { z } from 'zod';

export const SIGN_IN_TTL_MS = 10 * 60_000;
export const CHANGE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 12 * 60 * 60_000;

export function signInMessage(m: {
  origin: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}) {
  return [
    `${new URL(m.origin).host} wants you to sign in with your Bittensor account:`,
    m.address,
    '',
    'Sign in to Tensor Safe. This is not a transaction and costs nothing.',
    '',
    `URI: ${m.origin}`,
    'Version: 1',
    `Nonce: ${m.nonce}`,
    `Issued At: ${m.issuedAt}`,
    `Expiration Time: ${m.expiresAt}`,
  ].join('\n');
}

/**
 * True only for a genuine sign-in message for this origin, address and nonce,
 * issued around now. The browser checks this before asking the wallet to sign.
 */
export function isSignInMessage(
  message: string,
  expected: { origin: string; address: string; nonce: string; now?: number },
) {
  const now = expected.now ?? Date.now();
  const lines = message.split('\n');
  const issuedAt = (lines[8] ?? '').slice('Issued At: '.length);
  const expiresAt = (lines[9] ?? '').slice('Expiration Time: '.length);
  const issued = Date.parse(issuedAt);
  return (
    signInMessage({ ...expected, issuedAt, expiresAt }) === message &&
    Math.abs(issued - now) < 5 * 60_000 &&
    Date.parse(expiresAt) - issued <= SIGN_IN_TTL_MS
  );
}

/**
 * Wallets sign messages wrapped in <Bytes>…</Bytes>, which can never decode
 * as a transaction. Only that form is accepted: signatureVerify would also
 * retry the unwrapped bytes, so the Sr25519/Ed25519 verifiers are called directly.
 */
export function verifyWalletSignature(
  message: string,
  signature: string,
  address: string,
) {
  const attempt = (verify: () => boolean) => {
    try {
      return verify();
    } catch {
      return false;
    }
  };
  return attempt(() => {
    const data = u8aWrapBytes(stringToU8a(message));
    const sig = hexToU8a(signature);
    const key = decodeAddress(address);
    // Either verifier may throw on the other scheme's signature; try each.
    return (
      sig.length === 64 &&
      key.length === 32 &&
      (attempt(() => sr25519Verify(data, sig, key)) ||
        attempt(() => ed25519Verify(data, sig, key)))
    );
  });
}

/** Deterministic JSON: object keys sorted at every level. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}
export const payloadHash = (command: unknown) =>
  blake2AsHex(stringToU8a(canonical(command)), 256);

export type Change = {
  origin: string;
  action: string;
  path: string;
  workspace: string;
  network: 'finney' | 'test' | 'any';
  summary: string;
  payload: string;
  signer: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};
const FIELDS = [
  ['Action', 'action'],
  ['Request', 'path'],
  ['Workspace', 'workspace'],
  ['Network', 'network'],
  ['Signer', 'signer'],
  ['Payload', 'payload'],
  ['Nonce', 'nonce'],
  ['Issued At', 'issuedAt'],
  ['Expiration Time', 'expiresAt'],
] as const;

/** Binds action, route, workspace, network, body hash, signer, nonce and expiry. */
export function changeMessage(c: Change) {
  return [
    `${new URL(c.origin).host} asks you to approve a Tensor Safe change:`,
    c.summary.replace(/\s+/g, ' ').slice(0, 200),
    '',
    'This is not a transaction and costs nothing.',
    '',
    `URI: ${c.origin}`,
    'Version: 1',
    ...FIELDS.map(
      ([label, key]) => `${label}: ${key === 'path' ? 'POST ' : ''}${c[key]}`,
    ),
  ].join('\n');
}

/**
 * Field values from a change message, or null if it isn't one. Parsing is
 * positional and the message must rebuild byte-for-byte, so a summary line
 * can never impersonate a field.
 */
export function parseChange(message: string): Change | null {
  const lines = message.split('\n');
  if (lines.length !== 7 + FIELDS.length) return null;
  const parsed: Record<string, string> = {
    origin: lines[5].slice('URI: '.length),
    summary: lines[1],
  };
  FIELDS.forEach(([label, key], i) => {
    const line = lines[7 + i];
    const prefix = `${label}: ${key === 'path' ? 'POST ' : ''}`;
    parsed[key] = line.startsWith(prefix) ? line.slice(prefix.length) : '';
  });
  try {
    return changeMessage(parsed as Change) === message
      ? (parsed as Change)
      : null;
  } catch {
    return null;
  }
}

export const attestationSchema = z
  .object({
    message: z.string().min(1).max(2000),
    signature: z.string().regex(/^0x[0-9a-f]{128}$/),
    signer: z.string().min(3).max(64),
  })
  .strict();
export type Attestation = z.infer<typeof attestationSchema>;

/**
 * Checks that a stored record carries a valid wallet signature over exactly
 * this content, for this workspace, route, network and (optionally) origin,
 * by one of the authorised signers. Any browser can run it, so a tampered or
 * forged database record is visible.
 */
export function checkAttestation(
  attestation: Attestation | undefined,
  expected: {
    action: string;
    workspace: string;
    command: unknown;
    network: Change['network'];
    origin?: string;
    signers?: string[];
  },
) {
  if (!attestation) return false;
  const c = parseChange(attestation.message);
  return (
    !!c &&
    c.action === expected.action &&
    c.workspace === expected.workspace &&
    c.path === `/api/workspaces/${expected.workspace}` &&
    c.network === expected.network &&
    (!expected.origin || c.origin === expected.origin) &&
    c.signer === attestation.signer &&
    (!expected.signers || expected.signers.includes(c.signer)) &&
    c.payload === payloadHash(expected.command) &&
    verifyWalletSignature(
      attestation.message,
      attestation.signature,
      attestation.signer,
    )
  );
}
