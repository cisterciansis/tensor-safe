import assert from 'node:assert/strict';
import { ownerCredit, type OwnerState } from '../lib/accrual';
const state: OwnerState = {
  pending: '100',
  alphaOut: '500000000',
  cut: '3243',
  eligible: true,
  enabled: true,
  epoch: 1,
  owner: 'a',
  hotkey: 'b',
  registered: '1',
  leased: false,
  autoLock: false,
};
assert.equal(
  ownerCredit(state, { ...state, pending: '0', epoch: 2 }, 2),
  24742603n,
);
assert.equal(
  ownerCredit(
    { ...state, pending: '0' },
    { ...state, pending: '0', epoch: 2 },
    2,
  ),
  24742503n,
);
assert.equal(ownerCredit(state, { ...state, pending: '24742603' }, 2), 0n);
assert.equal(
  ownerCredit({ ...state, eligible: false }, { ...state, pending: '100' }, 2),
  0n,
);
assert.throws(() => ownerCredit(state, { ...state, pending: '24742604' }, 2));
assert.throws(() => ownerCredit(state, { ...state, owner: 'new' }, 2));
assert.throws(() => ownerCredit(state, { ...state, leased: true }, 2));
assert.throws(() => ownerCredit(state, { ...state, registered: '2' }, 2));
console.log(
  'PASS runtime454 fixed-point rounding, epoch credit, disabled emission and unsupported interval rejection',
);
