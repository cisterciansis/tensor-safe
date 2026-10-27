import assert from 'node:assert/strict';
import { u8aToHex } from '@polkadot/util';
import { encodeAddress } from '@polkadot/util-crypto';
import {
  parseReceiving,
  rejectsLegacyKeys,
  safeMultisigId,
} from '../lib/wallets';
import { accountAddress, accountSchema, signerSchema } from '../lib/domain';

const id = (n: number) => encodeAddress(new Uint8Array(32).fill(n), 42);

// Runtime golden vectors: primitives/hashed/src/safe.rs and test_safe_composites.py.
assert.equal(
  u8aToHex(safeMultisigId([id(1), id(2)], 2)),
  u8aToHex(
    Uint8Array.from([
      42, 34, 149, 134, 241, 8, 13, 143, 224, 200, 176, 5, 78, 113, 69, 82, 238,
      255, 93, 28, 133, 45, 147, 28, 7, 7, 92, 60, 90, 205, 95, 109,
    ]),
  ),
);
assert.equal(
  u8aToHex(safeMultisigId([id(3), id(1), id(2)], 2)),
  '0xac41577a3fbc8615cae86a48a256f1878be1ea6b4c59301dbe1ceeb90324602e',
);
assert.throws(() => safeMultisigId([id(1), id(1)], 1));
assert.throws(() => safeMultisigId([id(1), id(2)], 3));
// Every ordinary public key decodes as a curve point; safe ids never do.
assert.equal(rejectsLegacyKeys(new Uint8Array(32)), false);
assert.equal(rejectsLegacyKeys(safeMultisigId([id(4), id(5)], 2)), true);

// SDK golden vector (sdk/bittensor-core/src/keys/receiving.rs); account ids
// and v2 vectors computed independently with Python hashlib/base64.
const sr = 'tao_AQEHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHB2_GKIFP7N0l';
assert.equal(parseReceiving(sr).scheme, 'sr25519');
assert.equal(
  u8aToHex(parseReceiving(sr).account),
  '0xf62033bc328d3b69d96c86c70c5f8bde9ca1d14d83787c5fb3fb7276b7121ea3',
);
const mldsa =
  'tao_AgQJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJkISgXojtIro';
assert.equal(parseReceiving(mldsa).scheme, 'mldsa65');
assert.equal(
  u8aToHex(parseReceiving(mldsa).account),
  '0xbddd07ba7d75109655eb3bdbdf23b42ce1c923c31215cf3f9987b2818334b36e',
);
const falcon =
  'tao_AgYFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFKcNfvZuMBuM';
assert.equal(parseReceiving(falcon).scheme, 'falcon512');
assert.equal(
  u8aToHex(parseReceiving(falcon).account),
  '0x3bd8eda1eee4f2e4ca4a1440fd40bd8c309d9eef1614fb8fafa7feadcc819c8a',
);
for (const bad of [
  sr + 'A', // length
  sr.slice(0, -1) + 'm', // checksum
  sr.replace('tao_', 'TAO_'), // prefix
  mldsa.slice(0, -1) + 'p', // noncanonical trailing bits
  'tao_' + 'A'.repeat(56), // zero descriptor
])
  assert.throws(() => parseReceiving(bad), bad);

// Signers accept tao_, normalize to the permanent SS58 account and keep the descriptor.
const signer = signerSchema.parse({ name: 'Q', address: mldsa });
assert.equal(signer.address, encodeAddress(parseReceiving(mldsa).account, 42));
assert.deepEqual(
  [signer.receiving, signer.scheme, signer.rotating],
  [mldsa, 'mldsa65', true],
);
assert.throws(() =>
  signerSchema.parse({ name: 'Q', address: id(1), receiving: mldsa }),
);

// Key-scheme labels are checked: fixed PQ accounts are off-curve, rotating needs tao_.
const offCurve = encodeAddress(safeMultisigId([id(1), id(2)], 2), 42);
assert.equal(
  signerSchema.parse({ name: 'M', address: offCurve, scheme: 'mldsa65' })
    .scheme,
  'mldsa65',
);
for (const bad of [
  { name: 'M', address: id(1), scheme: 'mldsa65' },
  { name: 'R', address: id(1), rotating: true },
  { name: 'X', address: id(1), receiving: 'tao_bad' },
])
  assert.equal(signerSchema.safeParse(bad).success, false);

// Mode is identity: safe and legacy derive different addresses; absent = legacy.
const base = {
  id: crypto.randomUUID(),
  name: 'T',
  network: 'finney',
  threshold: 2,
  signers: [
    { name: 'A', address: id(2) },
    { name: 'B', address: id(1) },
  ],
};
const legacy = accountSchema.parse(base);
const safe = accountSchema.parse({ ...base, mode: 'safe' });
assert.equal(
  accountAddress(safe),
  encodeAddress(safeMultisigId([id(1), id(2)], 2), 42),
);
assert.notEqual(accountAddress(safe), accountAddress(legacy));
console.log(
  'PASS safe multisig golden vectors, tao_ descriptors (v1, ML-DSA, Falcon), strict decoding and signer normalization',
);
