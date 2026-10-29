import assert from 'node:assert/strict';
import { ownerCredit, type OwnerState } from '../lib/accrual';
const state: OwnerState = {
  spec: 454,
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
assert.throws(() => ownerCredit({ ...state, spec: 481 }, state, 2));
// Runtime 486: owner slot of SubnetEmissionWeights in u64::MAX parts plus the running total.
// Real finalized Finney values (alpha-out 1e9 per block).
const sn73: OwnerState = {
  ...state,
  spec: 486,
  pending: '1649999995',
  alphaOut: '1000000000',
  cut: '6087425544324152032',
  epoch: 9392074,
  accrued: '1081167339141334',
};
assert.equal(
  ownerCredit(
    sn73,
    { ...sn73, pending: '1979999994', accrued: '1081167669141333' },
    9392080,
  ),
  0n,
);
assert.throws(() =>
  ownerCredit(
    sn73,
    { ...sn73, pending: '1979999994', accrued: '1081167669141334' },
    9392080,
  ),
);
assert.equal(
  ownerCredit(
    { ...sn73, pending: '118469999641', accrued: '1081165359141340' },
    { ...sn73, pending: '0', accrued: '1081165689141339' },
    9392074,
  ),
  118799999640n,
);
assert.throws(() =>
  ownerCredit(
    { ...sn73, pending: '118469999641', accrued: '1081165359141340' },
    { ...sn73, pending: '0', accrued: '1081165689141340' },
    9392074,
  ),
);
const sn41 = {
  ...sn73,
  pending: '35899999641',
  cut: '1844674407370955161',
  epoch: 9391746,
  accrued: '1089046976726398',
};
assert.equal(
  ownerCredit(
    sn41,
    { ...sn41, pending: '0', epoch: 9392106, accrued: '1089047076726397' },
    9392106,
  ),
  35999999640n,
);
const sn8 = {
  ...sn73,
  pending: '0',
  cut: '0',
  enabled: false,
  accrued: '1138560352088444',
};
assert.equal(ownerCredit(sn8, sn8, 9392135), 0n);
assert.throws(() => ownerCredit(sn8, { ...sn8, accrued: undefined }, 9392135));
assert.throws(() => ownerCredit(sn73, { ...sn73, spec: 454 }, 9392080));
console.log(
  'PASS runtime 454/486 fixed-point rounding, epoch credit, running total, disabled emission and unsupported interval rejection',
);
