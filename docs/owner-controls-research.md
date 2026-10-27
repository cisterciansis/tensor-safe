# Owner control verification

Reviewed implementation baseline: opentensor/subtensor `14cde6410fe8ec81a940e290c56f94a632a0988d`. The research agent compared runtime455 owner implementation with that baseline and found no material owner-control changes. `tests/controls.integration.ts` independently verifies the implemented allowlist against live runtime455 metadata, including exact identity byte encoding. No transactions are broadcast by the check.

Primary source: https://github.com/opentensor/subtensor/tree/14cde6410fe8ec81a940e290c56f94a632a0988d/pallets . Dispatches, admin-utils, staking/lock.rs, coinbase/tempo_control.rs and utils/identity.rs define the authority and semantics.

- `setPerpetualLock(netuid,enabled)` affects the signing coldkey's mode. `DecayingLock(coldkey,netuid)` is Option<bool>; only Some(false) means perpetual. None is decaying. Disabling starts decay, not immediate release.
- `lockStake(hotkey,netuid,amount)` adds alpha to the account's conviction lock. Amount is additional. A nonempty lock fixes its target hotkey; moving locks is a separate action that resets conviction. Runtime availability spans the subnet and includes locked floors.
- `sudoSetOwnerCutAutoLockEnabled(netuid,enabled)` controls future owner earnings. It requires owner/root and the admin window. Disabling does not unlock prior earnings.
- `setSubnetIdentity(netuid,subnetName,githubRepo,subnetContact,subnetUrl,discord,description,logoUrl,additional)` replaces all eight fields. Name/Discord max256 UTF-8 bytes; other fields max1024. Native owner must equal the multisig origin. The UI loads the whole profile first and refuses unrecognized/non-text encodings.
- Owner hyperparameters: tempo360..50400; immunity/minimum weights u16; weights-version u64; activity factor1000..50000; transfer toggle bool; commit/reveal bool. Exact calls are in lib/controls.ts. The admin window and per-setting rate limits can change before final multisig execution.
- `sudoSetNetworkRegistrationAllowed` is root-only despite an old misleading comment. It is intentionally absent from the owner allowlist. Legacy Subtensor.setTempo is a no-op; use AdminUtils.sudoSetTempo.
- Owner/Staking proxy filters do not authorize common conviction-lock calls in the reviewed runtime. These guided requests execute directly as the multisig account.

Current rolled state: `at.call.stakeInfoRuntimeApi.getColdkeyLock(coldkey,netuid)` and `getStakeAvailabilityForColdkeys([coldkey],[netuid])`. The latter may omit zero positions. Read at one finalized hash, retain codec precision, and distinguish missing from failed responses.
