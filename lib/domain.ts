import { controlSchema, childrenSchema } from './controls';
import { z } from 'zod';
import {
  decodeAddress,
  encodeAddress,
  encodeMultiAddress,
} from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import {
  SCHEMES,
  isReceiving,
  parseReceiving,
  rejectsLegacyKeys,
  safeMultisigId,
  type Scheme,
} from './wallets';
export const NETWORKS = {
  finney: {
    name: 'Bittensor',
    genesis:
      '0x2f0555cc76fc2840a25a6ea3b9637146806f1f44b090c175ffde2a7e5ab36c03',
    ws: 'wss://entrypoint-finney.opentensor.ai:443',
    http: 'https://entrypoint-finney.opentensor.ai:443',
  },
  test: {
    name: 'Testnet',
    genesis:
      '0x8f9cf856bf558a14440e75569c9e58594757048d7b3a84b5d25f6bd978263105',
    ws: 'wss://test.finney.opentensor.ai:443',
    http: 'https://test.finney.opentensor.ai:443',
  },
} as const;
export const nameSchema = z.string().trim().min(1).max(80);
export const addressSchema = z
  .string()
  .min(3)
  .max(103)
  .transform((v, ctx) => {
    try {
      // A tao_ receiving address names the same permanent account as its SS58 form.
      const b = isReceiving(v) ? parseReceiving(v).account : decodeAddress(v);
      if (b.length !== 32) throw Error();
      return encodeAddress(b, 42);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid Bittensor address (5… or tao_…)',
      });
      return z.NEVER;
    }
  });
export const unitsSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .refine((v) => BigInt(v) <= 18446744073709551615n, 'Amount exceeds u64');
export const positiveUnits = unitsSchema.refine(
  (v) => BigInt(v) > 0n,
  'Amount must be positive',
);
export const hashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
export const blockSchema = z.number().int().min(0).max(4294967295);
export const netuidSchema = z.number().int().min(1).max(65535);
export const idSchema = z.uuid();
export function accountKey(address: string) {
  return u8aToHex(decodeAddress(address));
}
export function parseUnits(input: string) {
  if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(input))
    throw Error('Use a positive decimal with at most 9 decimal places');
  const [whole, fraction = ''] = input.split('.');
  return unitsSchema.parse(
    (BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'))).toString(),
  );
}
export function formatUnits(value: string, places = 4) {
  const v = BigInt(value);
  const fraction = (v % 1000000000n)
    .toString()
    .padStart(9, '0')
    .slice(0, places)
    .replace(/0+$/, '');
  return (
    (v / 1000000000n).toLocaleString('en-US') + (fraction ? '.' + fraction : '')
  );
}
const receivingSchema = z
  .string()
  .max(103)
  .refine((v) => {
    try {
      return !!parseReceiving(v);
    } catch {
      return false;
    }
  }, 'Enter a valid tao_ receiving address');
export const signerSchema = z.preprocess(
  (v) => {
    // Keep a pasted tao_ descriptor beside the permanent SS58 account it names.
    const address = (v as { address?: unknown } | null)?.address;
    if (typeof address !== 'string' || !isReceiving(address)) return v;
    try {
      const { scheme } = parseReceiving(address);
      return { ...(v as object), receiving: address, scheme, rotating: true };
    } catch {
      return v;
    }
  },
  z
    .object({
      name: nameSchema,
      address: addressSchema,
      scheme: z.enum(Object.keys(SCHEMES) as [Scheme, ...Scheme[]]).optional(),
      rotating: z.boolean().optional(),
      receiving: receivingSchema.optional(),
    })
    .strict()
    .superRefine((s, c) => {
      const issue = (message: string) =>
        c.addIssue({ code: 'custom', message });
      // Rotating wallets are only known from their descriptor.
      if (s.rotating && !s.receiving)
        return issue('Use the tao_ address of a rotating wallet');
      // Fixed ML-DSA/Falcon accounts are always off-curve (runtime is_stateless check).
      if (s.scheme && SCHEMES[s.scheme].quantum && !s.rotating) {
        let onCurve = true;
        try {
          onCurve = !rejectsLegacyKeys(decodeAddress(s.address));
        } catch {}
        if (onCurve)
          return issue('This address cannot be an ML-DSA or Falcon wallet');
      }
      if (!s.receiving) return;
      try {
        const r = parseReceiving(s.receiving);
        if (
          u8aToHex(r.account) === accountKey(s.address) &&
          s.scheme === r.scheme &&
          s.rotating === true
        )
          return;
      } catch {}
      issue('Receiving address does not match this account');
    }),
);
export const accountSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    network: z.enum(['finney', 'test']),
    // Address derivation is identity: absent means legacy, never reinterpreted.
    mode: z.enum(['legacy', 'safe']).optional(),
    threshold: z.number().int().min(2).max(32),
    signers: z.array(signerSchema).min(2).max(32),
  })
  .strict()
  .superRefine((a, c) => {
    if (a.threshold > a.signers.length)
      c.addIssue({ code: 'custom', message: 'Threshold exceeds signer count' });
    // Invalid addresses already carry their own issue.
    if (!a.signers.every((s) => typeof s.address === 'string')) return;
    if (
      new Set(a.signers.map((s) => accountKey(s.address))).size !==
      a.signers.length
    )
      c.addIssue({ code: 'custom', message: 'Signers must be unique' });
  });
export type Account = z.infer<typeof accountSchema>;
export const accountAddress = (a: Account) =>
  a.mode === 'safe'
    ? encodeAddress(
        safeMultisigId(
          a.signers.map((s) => s.address),
          a.threshold,
        ),
        42,
      )
    : encodeMultiAddress(
        a.signers.map((s) => s.address),
        a.threshold,
        42,
      );
export const ownerSchema = z
  .object({
    name: nameSchema,
    address: addressSchema,
    bps: z.number().int().min(1).max(10000),
  })
  .strict();
export const ownersSchema = z
  .array(ownerSchema)
  .min(1)
  .max(64)
  .superRefine((a, c) => {
    if (a.reduce((s, v) => s + v.bps, 0) !== 10000)
      c.addIssue({
        code: 'custom',
        message: 'Ownership must total exactly 100%',
      });
    if (new Set(a.map((s) => accountKey(s.address))).size !== a.length)
      c.addIssue({
        code: 'custom',
        message: 'Ownership wallets must be unique',
      });
  });
export type Owner = z.infer<typeof ownerSchema>;
export function allocate(total: string, owners: Owner[]) {
  positiveUnits.parse(total);
  ownersSchema.parse(owners);
  const n = BigInt(total);
  const rows = owners.map((o) => ({
    ...o,
    amount: (n * BigInt(o.bps)) / 10000n,
    remainder: (n * BigInt(o.bps)) % 10000n,
  }));
  let dust = n - rows.reduce((s, r) => s + r.amount, 0n);
  const ranked = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? accountKey(a.address).localeCompare(accountKey(b.address))
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const row of ranked) {
    if (dust === 0n) break;
    row.amount++;
    dust--;
  }
  return rows.map(({ remainder: _remainder, ...r }) => ({
    ...r,
    amount: r.amount.toString(),
  }));
}
export const operationSchema = z.discriminatedUnion('kind', [
  controlSchema,
  childrenSchema,
  z
    .object({
      kind: z.literal('transfer'),
      to: addressSchema,
      amount: positiveUnits,
    })
    .strict(),
  z
    .object({
      kind: z.literal('alpha'),
      to: addressSchema,
      hotkey: addressSchema,
      netuid: netuidSchema,
      amount: positiveUnits,
    })
    .strict(),
  z
    .object({
      kind: z.literal('stake'),
      hotkey: addressSchema,
      netuid: netuidSchema,
      amount: positiveUnits,
      limitPrice: positiveUnits,
    })
    .strict(),
  z
    .object({
      kind: z.literal('unstake'),
      hotkey: addressSchema,
      netuid: netuidSchema,
      amount: positiveUnits,
      limitPrice: positiveUnits,
    })
    .strict(),
  z
    .object({
      kind: z.literal('addProxy'),
      delegate: addressSchema,
      proxyType: z.enum([
        'Any',
        'NonTransfer',
        'Staking',
        'Registration',
        'Transfer',
        'SmallTransfer',
        'RootWeights',
        'ChildKeys',
        'SwapHotkey',
        'SubnetOwner',
        'Owner',
        'SubnetLeaseBeneficiary',
      ]),
      delay: blockSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('removeProxy'),
      delegate: addressSchema,
      proxyType: z.string().regex(/^[A-Za-z]{1,32}$/),
      delay: blockSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('custom'),
      callHex: z.string().regex(/^0x([0-9a-fA-F]{2}){2,16384}$/),
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export const revisionSchema = z
  .object({ id: idSchema, effectiveBlock: blockSchema, owners: ownersSchema })
  .strict();
export const accrualSchema = z
  .object({
    fromBlock: blockSchema,
    toBlock: blockSchema,
    amount: unitsSchema,
    blockHash: hashSchema,
    codeHash: z.string().regex(/^0x[0-9a-f]+$/),
    locked: z.boolean(),
  })
  .strict();
export const agreementSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    accountId: idSchema,
    netuid: netuidSchema,
    hotkey: addressSchema,
    startBlock: blockSchema,
    revisions: z.array(revisionSchema).min(1).max(100),
    accrual: accrualSchema.optional(),
  })
  .strict();
export type Agreement = z.infer<typeof agreementSchema>;
export type Distribution = {
  id: string;
  agreementId: string;
  revisionId: string;
  fromBlock: number;
  toBlock: number;
  amount: string;
  allocations: (Owner & { amount: string })[];
  provenance: 'declared' | 'finalized';
  source: string;
  proposalId: string;
  status: 'reserved' | 'paid';
  evidence?: string;
};
export type Proposal = {
  id: string;
  accountId: string;
  title: string;
  operations: Operation[];
  callHex: string;
  callHash: string;
  genesisHash: string;
  specVersion: number;
  createdAt: string;
  status: 'proposed' | 'finalized' | 'cancelled' | 'failed';
  external?: boolean;
  distributionId?: string;
  evidence?: string;
  attempt?: { hash: string; signer: string; expires: number; nonce: string };
};
export type Workspace = {
  id: string;
  name: string;
  version: number;
  role: 'owner' | 'manager' | 'viewer';
  accounts: Account[];
  agreements: Agreement[];
  distributions: Distribution[];
  proposals: Proposal[];
  contacts: z.infer<typeof signerSchema>[];
};
export const emptyState = () => ({
  accounts: [],
  agreements: [],
  distributions: [],
  proposals: [],
  contacts: [],
});
export const commandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('accrue'),
      agreementId: idSchema,
      toBlock: blockSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('distributeAccrued'),
      id: idSchema,
      agreementId: idSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('importProposal'),
      id: idSchema,
      accountId: idSchema,
      title: nameSchema,
      callHex: z.string().regex(/^0x([0-9a-fA-F]{2}){2,16384}$/),
    })
    .strict(),
  z
    .object({ action: z.literal('addAccount'), account: accountSchema })
    .strict(),
  z.object({ action: z.literal('addContact'), contact: signerSchema }).strict(),
  z
    .object({
      action: z.literal('addAgreement'),
      agreement: agreementSchema.omit({ accrual: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal('reviseAgreement'),
      id: idSchema,
      revision: revisionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('propose'),
      id: idSchema,
      accountId: idSchema,
      title: nameSchema,
      operations: z.array(operationSchema).min(1).max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal('distribute'),
      id: idSchema,
      agreementId: idSchema,
      toBlock: blockSchema,
      amount: positiveUnits,
      source: z.string().trim().min(8).max(1000),
    })
    .strict(),
  z.object({ action: z.literal('rebuild'), id: idSchema }).strict(),
  z.object({ action: z.literal('recoverAttempt'), id: idSchema }).strict(),
  z
    .object({
      action: z.literal('recordAttempt'),
      id: idSchema,
      signedHex: z.string().regex(/^0x([0-9a-fA-F]{2}){10,65536}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('reconcile'),
      id: idSchema,
      blockHash: hashSchema,
      extrinsicHash: hashSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('addMember'),
      userId: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[a-zA-Z0-9_@.:-]+$/),
      role: z.enum(['manager', 'viewer']),
    })
    .strict(),
  z
    .object({
      action: z.literal('removeMember'),
      userId: z.string().min(1).max(200),
    })
    .strict(),
]);
/** Per-holder totals for one agreement: finalized (paid) and reserved (awaiting execution). */
export function holderStatement(
  agreementId: string,
  distributions: Distribution[],
) {
  const rows = new Map<
    string,
    { name: string; address: string; paid: bigint; reserved: bigint }
  >();
  for (const d of distributions)
    if (d.agreementId === agreementId)
      for (const a of d.allocations) {
        const key = accountKey(a.address);
        const row = rows.get(key) ?? {
          name: a.name,
          address: a.address,
          paid: 0n,
          reserved: 0n,
        };
        row[d.status === 'paid' ? 'paid' : 'reserved'] += BigInt(a.amount);
        rows.set(key, row);
      }
  return [...rows.values()].map((r) => ({
    ...r,
    paid: r.paid.toString(),
    reserved: r.reserved.toString(),
  }));
}
export function distributionSnapshot(
  agreement: Agreement,
  previous: Distribution[],
  id: string,
  toBlock: number,
  amount: string,
  source: string,
): Distribution {
  const last = previous
    .filter((d) => d.agreementId === agreement.id)
    .reduce((n, d) => Math.max(n, d.toBlock), agreement.startBlock);
  if (toBlock <= last)
    throw Error('This interval is already reserved or closed');
  const revision = [...agreement.revisions]
    .reverse()
    .find((r) => r.effectiveBlock <= last + 1);
  if (!revision) throw Error('No ownership revision covers this interval');
  if (
    agreement.revisions.some(
      (r) => r.effectiveBlock > last + 1 && r.effectiveBlock <= toBlock,
    )
  )
    throw Error('Split this distribution at the ownership revision boundary');
  return {
    id,
    agreementId: agreement.id,
    revisionId: revision.id,
    fromBlock: last,
    toBlock,
    amount,
    allocations: allocate(amount, revision.owners),
    provenance: 'declared',
    source,
    proposalId: id,
    status: 'reserved',
  };
}
export const proposalSchema = z
  .object({
    id: idSchema,
    accountId: idSchema,
    title: nameSchema,
    operations: z.array(operationSchema).min(1).max(64),
    callHex: z.string().regex(/^0x[0-9a-f]+$/),
    callHash: hashSchema,
    genesisHash: hashSchema,
    specVersion: blockSchema,
    createdAt: z.iso.datetime(),
    status: z.enum(['proposed', 'finalized', 'cancelled', 'failed']),
    external: z.boolean().optional(),
    distributionId: idSchema.optional(),
    evidence: z.string().max(200).optional(),
    attempt: z
      .object({
        hash: hashSchema,
        signer: addressSchema,
        expires: blockSchema,
        nonce: unitsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export const distributionSchema = z
  .object({
    id: idSchema,
    agreementId: idSchema,
    revisionId: idSchema,
    fromBlock: blockSchema,
    toBlock: blockSchema,
    amount: positiveUnits,
    allocations: z
      .array(ownerSchema.extend({ amount: unitsSchema }))
      .min(1)
      .max(64),
    provenance: z.enum(['declared', 'finalized']),
    source: z.string().max(1000),
    proposalId: idSchema,
    status: z.enum(['reserved', 'paid']),
    evidence: z.string().max(200).optional(),
  })
  .strict();
export const workspaceSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    version: z.number().int().min(0),
    role: z.enum(['owner', 'manager', 'viewer']),
    accounts: z.array(accountSchema).max(50),
    agreements: z.array(agreementSchema).max(100),
    distributions: z.array(distributionSchema).max(5000),
    proposals: z.array(proposalSchema).max(5000),
    contacts: z.array(signerSchema).max(500),
  })
  .strict();
export const responseSchema = z
  .object({
    error: z.string().optional(),
    details: z.array(z.string()).optional(),
    id: idSchema.optional(),
    workspace: workspaceSchema.optional(),
    workspaces: z
      .array(
        z
          .object({
            id: idSchema,
            name: nameSchema,
            version: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
    user: z
      .object({ id: z.string().max(200), name: z.string().max(300) })
      .strict()
      .optional(),
    audit: z
      .array(
        z
          .object({
            actor: z.string(),
            action: z.string(),
            version: z.number(),
            created_at: z.string(),
            details: z.string(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    members: z
      .array(
        z
          .object({ user_id: z.string(), role: z.enum(['manager', 'viewer']) })
          .strict(),
      )
      .optional(),
  })
  .strict();
