import assert from 'node:assert/strict';
import { Keyring } from '@polkadot/keyring';
import { stringToU8a, u8aToHex, u8aWrapBytes } from '@polkadot/util';
import {
  canonical,
  isSignInMessage,
  changeMessage,
  checkAttestation,
  parseChange,
  payloadHash,
  signInMessage,
  verifyWalletSignature,
} from '../lib/auth';
import {
  accountSigned,
  agreementSigned,
  signedCommands,
  type Account,
} from '../lib/domain';

const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
const alice = keyring.addFromUri('//Alice');
const bob = keyring.addFromUri('//Bob');
const sign = (message: string, pair = alice) =>
  u8aToHex(pair.sign(u8aWrapBytes(stringToU8a(message))));

// Sign-in accepts only the wallet's <Bytes>-wrapped signature by that address.
const login = signInMessage({
  origin: 'https://safe.example',
  address: alice.address,
  nonce: 'a'.repeat(32),
  issuedAt: '2026-10-28T00:00:00.000Z',
  expiresAt: '2026-10-28T00:10:00.000Z',
});
assert.ok(login.startsWith('safe.example wants you to sign in'));
assert.equal(verifyWalletSignature(login, sign(login), alice.address), true);
assert.equal(verifyWalletSignature(login, sign(login), bob.address), false);
assert.equal(
  verifyWalletSignature(
    login,
    u8aToHex(alice.sign(stringToU8a(login))),
    alice.address,
  ),
  false,
);
assert.equal(
  verifyWalletSignature(login + ' ', sign(login), alice.address),
  false,
);

// The browser refuses to sign anything but a fresh sign-in for this site.
{
  const now = Date.parse('2026-10-28T00:01:00.000Z');
  const expected = {
    origin: 'https://safe.example',
    address: alice.address,
    nonce: 'a'.repeat(32),
    now,
  };
  assert.equal(isSignInMessage(login, expected), true);
  assert.equal(
    isSignInMessage(login, { ...expected, origin: 'https://evil.example' }),
    false,
  );
  assert.equal(
    isSignInMessage(login, { ...expected, address: bob.address }),
    false,
  );
  assert.equal(
    isSignInMessage(login, { ...expected, now: now + 3_600_000 }),
    false,
  );
  assert.equal(
    isSignInMessage(login + '\nAction: addContact', expected),
    false,
  );
}

// Canonical JSON ignores key order and undefined fields.
assert.equal(
  canonical({ b: 1, a: [{ d: 2, c: undefined }] }),
  '{"a":[{"d":2}],"b":1}',
);
assert.equal(payloadHash({ x: 1, y: 2 }), payloadHash({ y: 2, x: 1 }));

// Change messages parse positionally; a summary can't impersonate a field.
const workspace = crypto.randomUUID();
const base = {
  origin: 'https://safe.example',
  action: 'addContact',
  path: `/api/workspaces/${workspace}`,
  workspace,
  network: 'any' as const,
  signer: alice.address,
  payload: payloadHash({ a: 1 }),
  nonce: 'b'.repeat(32),
  issuedAt: '2026-10-28T00:00:00.000Z',
  expiresAt: '2026-10-28T00:10:00.000Z',
};
const msg = changeMessage({ ...base, summary: 'Payload: 0xdeadbeef' });
assert.equal(parseChange(msg)?.payload, base.payload);
assert.equal(parseChange(msg)?.path, base.path);
assert.equal(parseChange(msg.replace('Version: 1', 'Version: 2')), null);
assert.equal(parseChange(msg + '\nAction: removeMember'), null);
assert.notEqual(
  parseChange(msg.replace('Action: addContact', 'Action:  addContact'))?.action,
  'addContact',
);

// Stored records verify against exactly what was signed, by whom, and where.
const signChange = (
  action: string,
  command: unknown,
  network: 'finney' | 'test' | 'any',
  pair = alice,
  overrides: Partial<typeof base> = {},
) => {
  const message = changeMessage({
    ...base,
    action,
    network,
    summary: action,
    payload: payloadHash(command),
    signer: pair.address,
    ...overrides,
  });
  return { message, signature: sign(message, pair), signer: pair.address };
};
const account: Account = {
  id: crypto.randomUUID(),
  name: 'Treasury',
  network: 'finney',
  threshold: 2,
  signers: [
    { name: 'A', address: alice.address },
    { name: 'B', address: bob.address },
  ],
};
const stored: Account = {
  ...account,
  attestation: signChange(
    'addAccount',
    signedCommands.account(account),
    'finney',
  ),
};
const ctx = { id: workspace, accounts: [stored], origin: base.origin };
assert.equal(accountSigned(ctx, stored), true);
const eve = keyring.addFromUri('//Eve');
const swapped: Account = {
  ...stored,
  signers: [stored.signers[0], { name: 'B', address: eve.address }],
};
assert.equal(accountSigned(ctx, swapped), false);
assert.equal(accountSigned({ ...ctx, id: crypto.randomUUID() }, stored), false);
assert.equal(
  accountSigned({ ...ctx, origin: 'https://evil.example' }, stored),
  false,
);
assert.equal(accountSigned(ctx, account), false);
// A valid signature by someone outside the multisig does not count.
assert.equal(
  accountSigned(ctx, {
    ...account,
    attestation: signChange(
      'addAccount',
      signedCommands.account(account),
      'finney',
      eve,
    ),
  }),
  false,
);
// Nor does one made for another network.
assert.equal(
  accountSigned(ctx, {
    ...account,
    attestation: signChange(
      'addAccount',
      signedCommands.account(account),
      'test',
    ),
  }),
  false,
);
assert.equal(
  checkAttestation(
    { ...stored.attestation!, signer: bob.address },
    {
      action: 'addAccount',
      workspace,
      command: signedCommands.account(account),
      network: 'finney',
    },
  ),
  false,
);

// Cap tables: only co-signers of the funding account may create or revise them.
const owners = (address: string) => [{ name: 'Holder', address, bps: 10000 }];
const draft = {
  id: crypto.randomUUID(),
  name: 'Seed',
  accountId: account.id,
  netuid: 1,
  hotkey: bob.address,
  startBlock: 100,
  revisions: [
    {
      id: crypto.randomUUID(),
      effectiveBlock: 101,
      owners: owners(alice.address),
    },
  ],
};
const agreement = {
  ...draft,
  attestation: signChange(
    'addAgreement',
    signedCommands.agreement(draft),
    'finney',
  ),
};
assert.equal(agreementSigned(ctx, agreement), true);
const revise = (pair: typeof alice, effectiveBlock: number) => {
  const r = {
    id: crypto.randomUUID(),
    effectiveBlock,
    owners: owners(pair.address),
  };
  return {
    ...r,
    attestation: signChange(
      'reviseAgreement',
      signedCommands.revision(agreement, r),
      'finney',
      pair,
    ),
  };
};
// The reviewer's exploit: a non-co-signer member signs a payout redirect.
assert.equal(
  agreementSigned(ctx, {
    ...agreement,
    revisions: [...agreement.revisions, revise(eve, 200)],
  }),
  false,
);
const r2 = revise(bob, 200);
const r3 = revise(alice, 300);
assert.equal(
  agreementSigned(ctx, {
    ...agreement,
    revisions: [...agreement.revisions, r2, r3],
  }),
  true,
);
// Reordering signed revisions would apply an older cap table: refused.
assert.equal(
  agreementSigned(ctx, {
    ...agreement,
    revisions: [...agreement.revisions, r3, r2],
  }),
  false,
);
// The funding account itself must verify.
assert.equal(
  agreementSigned({ ...ctx, accounts: [swapped] }, agreement),
  false,
);

{
  // Ed25519 wallets work the same way.
  const ed = new Keyring({ type: 'ed25519' }).addFromUri('//Ferdie');
  assert.equal(verifyWalletSignature(login, sign(login, ed), ed.address), true);
  assert.equal(
    verifyWalletSignature(login, sign(login, ed), alice.address),
    false,
  );
}
console.log(
  'PASS wallet sign-in signatures, canonical payloads, positional change parsing and tamper-evident signed records',
);
