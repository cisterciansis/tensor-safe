# Bittensor native treasury research — 2026-09-07

## Source baseline

Inspected opentensor/subtensor at commit `14cde6410fe8ec81a940e290c56f94a632a0988d` (shallow clone `/tmp/safe-subtensor-research`). This monorepo now contains the runtime, Rust SDK core, Python SDK/CLI, docs and website. Current official docs identify v11 as the unified SDK following the July 2026 v431 release; older learnbittensor v9/v10 API references are materially outdated. No official production browser binding to the new Rust core was identified: `sdk/bittensor-core-py` is the current language binding; documentation describes future sibling bindings. Browser code should use established Substrate metadata-aware JS tooling and verify the connected runtime's capabilities. Do not hardcode call indexes or assume repository HEAD is deployed on a selected RPC.

Sources:
- https://github.com/opentensor/subtensor/tree/14cde6410fe8ec81a940e290c56f94a632a0988d/sdk
- https://www.bittensor.com/docs/internals/repo-layout
- https://www.bittensor.com/releases/v431-upgrade
- https://www.bittensor.com/docs/migration

## Multisig

Native FRAME multisig derives an address from sorted decoded public keys and threshold. Adding an account to a workspace requires no on-chain deployment. Decode and deduplicate keys (different SS58 encodings can represent the same key); sort public-key bytes, not address strings. `@polkadot/util-crypto` createKeyMulti/encodeAddress is an appropriate existing browser primitive. Membership or threshold changes derive a different address. A pure-proxy member slot permits controller rotation without changing the multisig address, but adds an operational layer that must be explicit.

Calls: `Multisig.as_multi(threshold, other_signatories, maybe_timepoint, call, max_weight)`, `approve_as_multi(threshold, other_signatories, maybe_timepoint, call_hash, max_weight)`, `cancel_as_multi(threshold, other_signatories, timepoint, call_hash)`, `as_multi_threshold_1(other_signatories, call)`. Build from live metadata. Exclude current signer from other_signatories. Initial call uses None timepoint; subsequent actions must use stored `{height,index}`. Hash-only approval does not execute; final execution needs full encoded call. Only the depositor can cancel. A rejected operation cannot be administratively deleted from chain by other members.

`Multisig.Multisigs(account, call_hash)` stores when, approvals, depositor, deposit; it does not retain full preimage. Preserve exact SCALE call bytes with hash, network genesis and runtime version in proposals; recover chain-created proposals from opener block or import preimage, and never display a guessed decoded action. Read max weight from payment/dispatch estimation for the actual inner call and support WeightV2. Opening signer funds deposit plus outer fee; treasury funds inner action. Read constants dynamically (source defaults: 100 signatories, base 0.132 TAO plus 0.032 TAO per threshold). Watch `MultisigExecuted` inner result, not only outer `system.ExtrinsicSuccess`. Same applies to `ProxyExecuted` and batch events. Finalized successful inner execution is the accounting boundary.

Source: https://www.bittensor.com/docs/guides/multisig and repository `sdk/python/bittensor/multisig.py`, `runtime/src/lib.rs`.

## Alpha transfer and distribution

Alpha is a staked position identified by coldkey, hotkey and netuid. Native call:
`SubtensorModule.transfer_stake(destination_coldkey, hotkey, origin_netuid, destination_netuid, alpha_amount)`.
Latest runtime also exposes `transfer_stake_and_hotkey(destination_coldkey, origin_hotkey, destination_hotkey, origin_netuid, destination_netuid, alpha_amount)`.
Use same origin/destination subnet for an alpha distribution: differing netuids swap through pools and introduce slippage. Query stake transfers enabled, available/unlocked position, recipient lock compatibility, minimum transfer, and estimated fee. Transfer-stake does not transfer subnet ownership. Funding a multisig with liquid TAO does not migrate ownership either; coldkey migration is a distinct delayed announced swap with strict destination requirements.

Store amounts in atomic integer units (9 decimals, BigInt/string); avoid IEEE floats anywhere amounts are allocated or signed. For off-chain agreements, explicitly distinguish contractual shares from protocol ownership. Snapshot effective share revision and finalized accrual range, compute deterministic allocations with conserved integer remainder, and reserve the accrual interval while proposal is pending. Editing recipients/amounts creates a new revision/hash; it never mutates an approved proposal. Mark payouts settled only by matching finalized exact call and successful nested dispatch. Avoid balance-difference accrual (deposits, withdrawals and price changes contaminate it); use finalized emission records, or clearly label an imported/manual verified accrual record until an indexer exists.

Source: https://www.bittensor.com/docs/tx/transfer-stake and repository `pallets/subtensor/src/macros/dispatches.rs`.

## Protocol crowdloans versus off-chain ownership

`Crowdloan.create(deposit,min_contribution,cap,end,call,target_address)` requires exactly one call or target address. A plain target-address fundraise does NOT automatically create an emissions-sharing subnet. Leased subnet registration requires inner `SubtensorModule.register_leased_network(emissions_share,end_block)` executed specifically in crowdloan finalization context; standalone execution fails. Contributor emissions_share is 0–100 percent of the OWNER CUT, not total subnet emissions. End block stops contributions; refund is explicit. Lease end block and fundraise end block are different concepts.

Source code `pallets/subtensor/src/subnets/leasing.rs`:
- Registration derives lease coldkey and hotkey, pays registration from raised TAO, grants beneficiary `SubnetLeaseBeneficiary` proxy, makes lease hotkey take zero.
- `SubnetLeases(lease_id)` records beneficiary/coldkey/hotkey/emissions_share/end_block/netuid/cost.
- `SubnetUidToLeaseId(netuid)` maps subnet to lease. `SubnetLeaseShares(lease_id,contributor)` stores U64F64 contribution/total raised, excluding beneficiary. `AccumulatedLeaseDividends(lease_id)` tracks pending atomic alpha.
- Registration refunds leftover raised TAO pro rata; rounding residue to beneficiary.
- Owner-cut distribution accumulates configured percentage rounded up. On distribution interval (source runtime 100 blocks, query constant), it atomically transfers each contributor's rounded-up share as stake from lease coldkey/hotkey to contributor coldkey on that same lease hotkey; beneficiary receives residual. Emits `SubnetLeaseDividendsDistributed {lease_id,contributor,alpha}`. Failed atomic distribution retains accrual for retry.
- Protocol payouts are automatic: dashboard must expose observation/reconciliation, not a second manual Pay action that duplicates them.
- Defined lease can be terminated by beneficiary after expiry; perpetual lease cannot. Do not imply leases confer general equity rights or immutable subnet ownership; current conviction regime makes ownership separately relevant.

Sources:
https://www.bittensor.com/docs/tx/register-leased-network
https://www.bittensor.com/docs/tx/create-crowdloan
https://github.com/opentensor/subtensor/blob/14cde6410fe8ec81a940e290c56f94a632a0988d/pallets/subtensor/src/subnets/leasing.rs

## Proxies

Read `Proxy.Proxies(real)` and `Proxy.Announcements(delegate)`. Support add_proxy, remove_proxy and immediate proxy; delayed proxy requires announce and proxy_announced, with reject/remove announcement. Pure creation needs creation block/extrinsic index retained for kill_pure. Runtime now uses additive allowlists (deprecated proxy variants deny all). `Owner` permits subnet identity/hyperparameters, excludes key rotation/value transfer. `Staking` permits stake management without ownership transfers. `Transfer` includes TAO and alpha movement. `SubnetLeaseBeneficiary` permits activation, identity, management. Do not describe NonTransfer as universally harmless: it is broad operational authority. Use live enum metadata/call filters for choices.

Sources: https://www.bittensor.com/docs/guides/proxies ; repository `common/src/proxy.rs`, `runtime/src/proxy_filters/mod.rs`.

## Ledger, extension and Vault

Browser extension injected signer integration is the shortest maintainable browser route and allows hardware accounts exposed by compatible wallets. Enumerate injected providers; request account access only after Connect. Track source/crypto type and signPayload capability, account changes, genesis, nonce, mortal era, runtime specVersion/transactionVersion. Never collect recovery material.

Current official Ledger guidance uses Polkadot generic app >=100.0.5, ed25519 derivation `m/44'/354'/account'/0'/index'`, RFC-0078 merkleized metadata and CheckMetadataHash. The old ledger-bittensor repo is not the current recommended flow. Direct USB support requires correct generic-app metadata proof integration; a button claiming Ledger support without an actual signer transport is not support. Honest alternative: Ledger through supported wallet extension and SDK/CLI handoff.

Vault >=7.5 uses proof-carrying transactions with one Bittensor chain-spec scan. SDK is `sdk/python/bittensor/vault/{signer.py,uos.py,qr.py,server.py,static/vault.html}`. UOS bytes: 0x53 | crypto (0 ed25519 /1 sr25519) | cmd | 32-byte pubkey | payload | 32-byte genesis. Command 0x06 payload = metadata proof + SCALE compact call length + call + extrinsic extensions + signed-only extensions. Legacy multipart envelope 0x00 | u16 BE frame count | u16 BE index | chunk, max chunk 1024 bytes. Legacy 0x02 requires installed metadata; 0x01 signs hash only. Generic JSON QR is NOT Vault transaction encoding. Verify returned signature against the exact prepared payload before attachment/submission; reject stale/mismatched scans. Pin mortal era; regenerate after expiry, not silently reusing signature. MEV shield signing has 8-block era and two scans, so don't casually wrap shield flows in slow multisig roundtrips.

Sources:
https://www.bittensor.com/docs/guides/ledger
https://www.bittensor.com/docs/guides/vault
https://github.com/opentensor/subtensor/blob/14cde6410fe8ec81a940e290c56f94a632a0988d/sdk/python/bittensor/vault/uos.py

## Recommended minimal shipping boundary

Real address derivation, strict draft validation, editable proposal construction/export, read-only chain state, injected signing with chain-derived bytes, exact integer allocation and durable local audit are independently useful. Cross-device proposal coordination and shared ownership ledger require authenticated durable backend plus finalized indexer; localStorage is neither multi-user collaboration nor tamper-proof audit. Treat any demo state explicitly as demo and offer an empty real workspace. Display unavailable integrations honestly rather than fake success. Browser-vetted metadata/signing SDK, finalized evidence and integration tests on testnet must gate real funds, especially hardware/Vault transport and nested batch payout confirmation.

## Owner accrual event investigation (important implementation limit)

At researched commit, there is NO OwnerRewards/OwnerEmission payout event. `distribute_dividends_and_incentives` (`pallets/subtensor/src/coinbase/run_coinbase.rs`, line 692 onward) directly credits owner via `increase_stake_for_hotkey_and_coldkey_on_subnet`; that helper (`staking/stake_utils.rs`, 580–598) only updates the alpha share pool and emits nothing. `macros/events.rs` has no owner accrual event. Only protocol leases offer `SubnetLeaseDividendsDistributed` as direct payout evidence.

A scanner of finalized System.Events cannot derive exact private owner cut earnings. `PendingOwnerCut` accumulates then drains in epoch processing, with current-block accrual occurring before drain; naive before/after subtraction loses that current contribution. Owner conviction change happens before distribution. Owner cut may auto-lock. Archive state and runtime-aware reconstruction/indexer are required for an exact automatic historical figure. Until then accept explicit manually verified accrual with source/reference and label it manual; never label balance-difference or nonexistent-event inference as verified chain emissions.

## Implemented archive reconstruction follow-up

Further source review produced the guarded `lib/accrual.ts` path. For unleased, stable-owner runtime-454 intervals (see the runtime 486 section below for the current rule), current `SubnetAlphaOutEmission` plus parent `PendingOwnerCut`, eligibility flags and owner-cut ratio reconstruct the exact owner credit. The ratio truncates to U96F32 first: `(alphaOut * ((ownerCutU16 << 32) / 65535)) >> 32`. Epoch drains are checked against `LastMechansimStepBlock` and zero pending; non-epoch pending must equal the reconstructed accumulation. Registration identity, owner/hotkey, runtime code, canonical parent links and privileged events are checked.

The validated Finney runtime code hash is `0x725e3d1eca8d5c29c1f0fa6476d5360661b852f52aebad979d6636e227a431ef`. A live read-only epoch check at block 9014465 reconstructed 17,819,546,778 alpha base units. A fixed-point regression vector (500,000,000 alpha-out units, cut 3243) yields 24,742,503 units; naive division overstates one unit. Runtime upgrades, leases, owner transitions and missing archive state fail closed. Earned credits can be auto-locked and are not a spendable-balance guarantee.

## Runtime 486 owner accrual

Source: opentensor/subtensor tag `v454` = `14cde6410fe8ec81a940e290c56f94a632a0988d` (`runtime/src/lib.rs:238`), tag `v486` = `72323e13249c9e25c7e792a2b3c08502c84651d5` (`runtime/src/lib.rs:242`; RaoFoundation/subtensor `v486` is the same commit). Since `v481` (commit `73d831ced`) the owner cut is slot 2 of the per-subnet `SubnetEmissionWeights` vector `[burn, recycle, owner, validator, miner]`, in u64 parts of `u64::MAX` (`pallets/subtensor/src/coinbase/run_coinbase.rs` 300–331, `subnets/emission_weights.rs` 233–301). `SubnetOwnerCut` and `OwnerCutEnabled` are deprecated and no longer read by emission (`lib.rs` 2355–2378); owners may set 0–33% via `sudo_set_subnet_emission_weights` (admin-utils call index 114). The migration seeded each subnet from the legacy cut (`migrations/migrate_seed_subnet_emission_weights.rs` 117–125), so un-customised subnets match the 454 formula bit for bit (65535 divides 2^64−1) and customised ones do not.

Unchanged at 486: eligibility (`coinbase/subnet_emissions.rs:21`), integral alpha-out (`get_subnet_terms`, 209–262), emit-then-drain order (54–64), and the epoch drain (484–485, `LastMechansimStepBlock` at 538). New `SubnetOwnerCutAccrued` (`lib.rs` 2586) is incremented by the same amount (`run_coinbase.rs` 328).

The 486 rule reads the parent's owner weight `w` (missing slot = 0): `(alphaOut * ((w << 32) / (2^64 − 1))) >> 32` when eligible and `w > 0`, and requires that increment to equal the `SubnetOwnerCutAccrued` delta on every block, epoch blocks included. Verified code hash `0x49781ac4cfda0ac6cf6e53cfceea7c728394d9c28da7881f47e3fbfbc239800f`. A read-only check over 1,440 finalized transitions (25 subnets, owner weights 0–33%, auto-lock, nine epoch drains, blocks 9392070–9392196) matched every block; the unchanged 454 formula failed 916 of them and misstated epoch credits (e.g. SN8 at 0%: 179,995,422 instead of 0).
