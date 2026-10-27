// Bittensor account formats from RaoFoundation/subtensor#3220 (not yet live; gated by metadata):
// `tao_` receiving descriptors for rotating (hashed) wallets and the
// registration-free off-curve "safe" multisig derivation.
import { ed25519, ristretto255 } from '@noble/curves/ed25519';
import {
  compactToU8a,
  stringToU8a,
  u8aCmp,
  u8aConcat,
  u8aEq,
} from '@polkadot/util';
import { blake2AsU8a, decodeAddress } from '@polkadot/util-crypto';

export const SCHEMES = {
  sr25519: { label: 'Sr25519', quantum: false },
  ed25519: { label: 'Ed25519', quantum: false },
  mldsa65: { label: 'ML-DSA-65', quantum: true },
  falcon512: { label: 'Falcon-512', quantum: true },
  falcon1024: { label: 'Falcon-1024', quantum: true },
} as const;
export type Scheme = keyof typeof SCHEMES;
// Browser extensions, Ledger and Vault sign Sr25519/Ed25519 only, and only for
// standard (non-rotating) keys. Everything else signs with btcli/the SDK.
export const browserSignable = (scheme: Scheme = 'sr25519', rotating = false) =>
  !rotating && !SCHEMES[scheme].quantum;

// v1 classical hashed descriptor: version 1, scheme tag, 32-byte commitment.
const V1_SCHEMES: Record<number, Scheme> = { 1: 'sr25519', 3: 'ed25519' };
// v2 descriptor: version 2, rotating profile, 64-byte commitment. Fixed
// profiles (5, 7, 9) receive at plain SS58 and never appear in `tao_`.
const V2_ROTATING: Record<number, Scheme> = {
  4: 'mldsa65',
  6: 'falcon512',
  8: 'falcon1024',
};

const blake2 = (domain: string, data: Uint8Array) =>
  blake2AsU8a(u8aConcat(stringToU8a(domain), data), 256);
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export type Receiving = {
  account: Uint8Array;
  descriptor: Uint8Array;
  scheme: Scheme;
};

export const isReceiving = (value: string) => value.startsWith('tao_');

/** Decode a `tao_` receiving address. Rejects anything noncanonical. */
export function parseReceiving(address: string): Receiving {
  const body = address.slice(4);
  if (
    !isReceiving(address) ||
    (body.length !== 56 && body.length !== 99) ||
    !/^[A-Za-z0-9_-]+$/.test(body)
  )
    throw Error('Not a valid tao_ receiving address');
  const bytes = Uint8Array.from(
    atob(body.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  if (base64url(bytes) !== body) throw Error('Noncanonical receiving address');
  const v1 = bytes.length === 42;
  const descriptor = bytes.slice(0, v1 ? 34 : 66);
  const checksum = blake2(
    v1 ? 'bittensor/hashed/v1/receiving' : 'bittensor/ms/v2/receiving',
    descriptor,
  ).slice(0, 8);
  if (!u8aEq(checksum, bytes.slice(descriptor.length)))
    throw Error('Receiving address checksum mismatch — check for typos');
  const scheme = v1
    ? descriptor[0] === 1 && V1_SCHEMES[descriptor[1]]
    : descriptor[0] === 2 && V2_ROTATING[descriptor[1]];
  if (!scheme || descriptor.slice(2).every((b) => b === 0))
    throw Error('Unsupported receiving descriptor');
  const domain = v1
    ? 'bittensor/hashed/v1/account'
    : scheme === 'mldsa65'
      ? 'bittensor/ms/v2/account'
      : 'bittensor/falcon/v1/account';
  return { account: blake2(domain, descriptor), descriptor, scheme };
}

/** 32-byte AccountId from an SS58 or `tao_` address. */
export const accountId = (address: string) =>
  isReceiving(address)
    ? parseReceiving(address).account
    : decodeAddress(address);

/** True when neither Ed25519 (ZIP-215) nor Sr25519 (Ristretto) can decode the bytes. */
export function rejectsLegacyKeys(account: Uint8Array) {
  const decodes = (decode: () => unknown) => {
    try {
      decode();
      return true;
    } catch (e) {
      // Only a decoding rejection means off-curve; a programming error must not.
      if (e instanceof TypeError) throw e;
      return false;
    }
  };
  return (
    !decodes(() => ed25519.Point.fromBytes(account, true)) &&
    !decodes(() => ristretto255.Point.fromBytes(account))
  );
}

const MULTISIG_DOMAIN = stringToU8a('subtensor/safe-multisig/v1');

/** Off-curve multisig AccountId used by `Multisig.*_safe` calls. */
export function safeMultisigId(signers: string[], threshold: number) {
  const ids = signers.map(accountId).sort(u8aCmp);
  if (
    ids.length < 2 ||
    ids.length > 100 ||
    ids.some((id, i) => i > 0 && u8aEq(id, ids[i - 1])) ||
    threshold < 1 ||
    threshold > ids.length
  )
    throw Error(
      'A safe multisig needs 2–100 distinct members and a valid threshold',
    );
  const prefix = u8aConcat(
    compactToU8a(MULTISIG_DOMAIN.length),
    MULTISIG_DOMAIN,
    compactToU8a(ids.length),
    ...ids,
    new Uint8Array([threshold & 0xff, threshold >> 8]),
  );
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = blake2AsU8a(u8aConcat(prefix, [attempt]), 256);
    if (rejectsLegacyKeys(id)) return id;
  }
  throw Error('Safe multisig derivation exhausted');
}
