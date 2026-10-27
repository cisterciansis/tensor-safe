import { z } from 'zod';
import { decodeAddress } from '@polkadot/util-crypto';
const text = (bytes: number) =>
  z
    .string()
    .refine(
      (v) => new TextEncoder().encode(v).length <= bytes,
      `Maximum ${bytes} UTF-8 bytes`,
    );
const uint = (max: bigint, min = 0n) =>
  z
    .string()
    .regex(/^\d{1,20}$/)
    .refine((v) => BigInt(v) >= min && BigInt(v) <= max, `Enter ${min}–${max}`);
const u16 = uint(65535n),
  u64 = uint(18446744073709551615n),
  subnet = uint(65535n, 1n);
const address = z
  .string()
  .min(46)
  .max(64)
  .refine((v) => {
    try {
      return decodeAddress(v).length === 32;
    } catch {
      return false;
    }
  }, 'Enter a valid wallet address');
const bool = z.boolean();
// Explicit call allowlist. Runtime metadata encodes these validated arguments.
export const controls = {
  perpetual: {
    group: 'owner',
    title: 'Keep alpha locked',
    note: 'Perpetual mode keeps this account’s lock committed. Turning it off starts gradual decay; it does not unlock alpha immediately.',
    section: 'subtensorModule',
    method: 'setPerpetualLock',
    authority: 'account',
    fields: ['Subnet ID', 'Perpetual lock'],
    schema: z.tuple([subnet, bool]),
    storage: 'decayingLock',
  },
  lock: {
    group: 'owner',
    title: 'Lock additional alpha',
    note: 'Commit more existing alpha. This reduces what the account can transfer or unstake. The amount is additional, not a target total.',
    section: 'subtensorModule',
    method: 'lockStake',
    authority: 'account',
    fields: [
      'Conviction target hotkey',
      'Subnet ID',
      'Additional alpha (base units)',
    ],
    schema: z.tuple([
      address,
      subnet,
      u64.refine((v) => BigInt(v) > 0n, 'Enter a positive amount'),
    ]),
    storage: '',
  },
  autoLock: {
    group: 'owner',
    title: 'Automatically lock owner earnings',
    note: 'Future owner emissions join the conviction lock. Turning this off does not unlock existing alpha.',
    section: 'adminUtils',
    method: 'sudoSetOwnerCutAutoLockEnabled',
    authority: 'owner',
    fields: ['Subnet ID', 'Automatically lock earnings'],
    schema: z.tuple([subnet, bool]),
    storage: 'ownerCutAutoLockEnabled',
  },
  subnetIdentity: {
    group: 'owner',
    title: 'Edit subnet profile',
    note: 'All fields are public. Saving replaces the complete profile; blank fields clear existing values.',
    section: 'subtensorModule',
    method: 'setSubnetIdentity',
    authority: 'owner',
    fields: [
      'Subnet ID',
      'Subnet name',
      'Repository URL',
      'Contact',
      'Website',
      'Discord',
      'Description',
      'Logo URL',
      'Additional information',
    ],
    schema: z.tuple([
      subnet,
      text(256),
      text(1024),
      text(1024),
      text(1024),
      text(256),
      text(1024),
      text(1024),
      text(1024),
    ]),
    storage: 'subnetIdentitiesV3',
  },
  tempo: {
    group: 'owner',
    title: 'Epoch length',
    note: 'Blocks between epochs. Changing this resets the epoch schedule. Owner range: 360–50,400 blocks.',
    section: 'adminUtils',
    method: 'sudoSetTempo',
    authority: 'owner',
    fields: ['Subnet ID', 'Blocks'],
    schema: z.tuple([subnet, uint(50400n, 360n)]),
    storage: 'tempo',
  },
  immunity: {
    group: 'owner',
    title: 'New miner protection',
    note: 'How many blocks new miners are protected from pruning. Zero disables this protection.',
    section: 'adminUtils',
    method: 'sudoSetImmunityPeriod',
    authority: 'owner',
    fields: ['Subnet ID', 'Blocks'],
    schema: z.tuple([subnet, u16]),
    storage: 'immunityPeriod',
  },
  minWeights: {
    group: 'owner',
    title: 'Minimum weight destinations',
    note: 'Minimum destinations for validator weights. Coordinate this change with validators and the subnet’s miner capacity.',
    section: 'adminUtils',
    method: 'sudoSetMinAllowedWeights',
    authority: 'owner',
    fields: ['Subnet ID', 'Minimum destinations'],
    schema: z.tuple([subnet, u16]),
    storage: 'minAllowedWeights',
  },
  weightsVersion: {
    group: 'owner',
    title: 'Required validator version',
    note: 'The weights version key accepted by the subnet. Coordinate it with validator software releases.',
    section: 'adminUtils',
    method: 'sudoSetWeightsVersionKey',
    authority: 'owner',
    fields: ['Subnet ID', 'Version key'],
    schema: z.tuple([subnet, u64]),
    storage: 'weightsVersionKey',
  },
  activity: {
    group: 'owner',
    title: 'Validator activity window',
    note: 'How long validators may be inactive, measured in thousandths of an epoch. 1,000 is one epoch; 50,000 is fifty.',
    section: 'adminUtils',
    method: 'sudoSetActivityCutoffFactor',
    authority: 'owner',
    fields: ['Subnet ID', 'Thousandths of an epoch'],
    schema: z.tuple([subnet, uint(50000n, 1000n)]),
    storage: 'activityCutoffFactorMilli',
  },
  transfers: {
    group: 'owner',
    title: 'Allow alpha transfers',
    note: 'Turning this off prevents native alpha ownership transfers, including investor distributions.',
    section: 'adminUtils',
    method: 'sudoSetToggleTransfer',
    authority: 'owner',
    fields: ['Subnet ID', 'Allow transfers'],
    schema: z.tuple([subnet, bool]),
    storage: 'transferToggle',
  },
  commitReveal: {
    group: 'owner',
    title: 'Protected weight submissions',
    note: 'Enable commit and reveal for validator weights. Coordinate changes with your validator operators.',
    section: 'adminUtils',
    method: 'sudoSetCommitRevealWeightsEnabled',
    authority: 'owner',
    fields: ['Subnet ID', 'Use commit and reveal'],
    schema: z.tuple([subnet, bool]),
    storage: 'commitRevealWeightsEnabled',
  },
  validatorIdentity: {
    group: 'validator',
    title: 'Edit validator profile',
    note: 'Public profile for this account’s coldkey. Saving replaces the complete profile; blank fields clear existing values.',
    section: 'subtensorModule',
    method: 'setIdentity',
    authority: 'account',
    fields: [
      'Name',
      'Website',
      'Repository URL',
      'Image URL',
      'Discord',
      'Description',
      'Additional information',
    ],
    schema: z.tuple([
      text(256),
      text(256),
      text(256),
      text(1024),
      text(256),
      text(1024),
      text(1024),
    ]),
    storage: 'identitiesV2',
  },
  increaseTake: {
    group: 'validator',
    title: 'Increase validator commission',
    note: 'Raise delegate commission. The chain’s maximum and cooldown apply. 65,535 represents 100%.',
    section: 'subtensorModule',
    method: 'increaseTake',
    authority: 'hotkeyOwner',
    fields: ['Validator hotkey', 'Commission (out of 65,535)'],
    schema: z.tuple([address, u16]),
    storage: 'delegates',
  },
  decreaseTake: {
    group: 'validator',
    title: 'Decrease validator commission',
    note: 'Lower delegate commission. Review the current commission before choosing a new value.',
    section: 'subtensorModule',
    method: 'decreaseTake',
    authority: 'hotkeyOwner',
    fields: ['Validator hotkey', 'Commission (out of 65,535)'],
    schema: z.tuple([address, u16]),
    storage: 'delegates',
  },
  childTake: {
    group: 'validator',
    title: 'Child validator commission',
    note: 'Set raw child commission. Global and subnet minimums can make the effective commission higher. Increases have a cooldown.',
    section: 'subtensorModule',
    method: 'setChildkeyTake',
    authority: 'hotkeyOwner',
    fields: ['Validator hotkey', 'Subnet ID', 'Commission (out of 65,535)'],
    schema: z.tuple([address, subnet, u16]),
    storage: 'childkeyTake',
  },
} as const;
export type ControlAction = keyof typeof controls;
export const controlSchema = z
  .object({
    kind: z.literal('control'),
    action: z.enum(
      Object.keys(controls) as [ControlAction, ...ControlAction[]],
    ),
    args: z.array(z.union([z.string().max(4096), z.boolean()])).max(9),
  })
  .strict()
  .superRefine((v, ctx) => {
    const result = controls[v.action].schema.safeParse(v.args);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({
          code: 'custom',
          path: ['args', ...issue.path],
          message: issue.message,
        });
  });

export const childrenSchema = z
  .object({
    kind: z.literal('children'),
    hotkey: address,
    netuid: subnet,
    children: z
      .array(
        z
          .object({
            address,
            proportion: u64,
          })
          .strict(),
      )
      .max(5),
  })
  .strict()
  .superRefine((v, ctx) => {
    const keys = v.children.map((c) =>
      Array.from(decodeAddress(c.address)).join(','),
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Each child wallet must be unique',
      });
    if (keys.includes(Array.from(decodeAddress(v.hotkey)).join(',')))
      ctx.addIssue({
        code: 'custom',
        message: 'A validator cannot be its own child',
      });
    if (
      v.children.reduce((sum, c) => sum + BigInt(c.proportion), 0n) >
      18446744073709551615n
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Child allocations cannot exceed 100%',
      });
  });
export const childProportion = (partsPerMillion: number) =>
  ((BigInt(partsPerMillion) * 18446744073709551615n) / 1000000n).toString();

export function percentParts(value: string): number {
  z.string()
    .regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/)
    .parse(value);
  const [whole, fraction = ''] = value.split('.');
  const parts = Number(whole) * 10000 + Number(fraction.padEnd(4, '0'));
  if (parts > 1000000) throw Error('Percentage cannot exceed 100%');
  return parts;
}
