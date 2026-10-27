# Investor distribution research — 2026-09-07

## Evidence reviewed

Read-only review of the public subtensor source at commit `da06f033663896ef2fdbbfc3ecc68ca908fba0f5`.

Authoritative public references:
- https://www.bittensor.com/docs — current docs identify unified SDK v11, Python SDK and CLI in the same package. Older docs.learnbittensor.org URLs redirect here.
- https://preview.bittensor.com/docs/tx/register-leased-network — lease registration uses crowdloan funds; emissions_share is 0–100 percent of the owner's cut, not overall emissions. Registration only works in crowdloan context; optional end_block or perpetual lease.
- https://preview.bittensor.com/docs/guides/subnets — native crowdloan / lease workflow.
- https://github.com/opentensor/subtensor/blob/main/pallets/subtensor/src/subnets/leasing.rs — source path also verified locally at pinned commit above.
- https://github.com/opentensor/subtensor/blob/main/pallets/subtensor/src/coinbase/run_coinbase.rs — owner-cut dispatch.
- https://preview.bittensor.com/docs/tx/transfer-stake — alpha payout transfers stake ownership; same subnet avoids pool swaps. Read runtime metadata before encoding.

## Runtime findings

`leasing.rs:245–335` implements automatic dividend distribution, carrying `AccumulatedLeaseDividends` until configured `LeaseDividendsDistributionInterval`. Contributors' positions are staked alpha on contributor coldkeys / lease hotkey. Successful atomic distribution emits `SubnetLeaseDividendsDistributed { lease_id, contributor, alpha }`. Failure retains accumulator. Native lease contributor cut uses ceiling rounding, and individual U64F64 shares also ceil; read actual runtime events for accounting instead of recreating it using a generic allocator.

`SubnetLeases`, `SubnetLeaseShares`, `AccumulatedLeaseDividends`, and finalized dividend events support a read-only native ownership view. Native lease share and operator-beneficiary roles are protocol rights; do not relabel these as legal equity. Offchain shares are a workspace agreement only.

`run_coinbase.rs:290–310` reads configurable owner cut and owner-cut-enabled state, then accumulates pending owner cut. Thus do not universally hardcode an 18% entitlement. `transfer-stake` can encounter transfer restrictions or conviction locks; destination hotkey may need to match receiver lock. Cross-subnet transfer swaps through pools and incurs slippage. Default distribution proposals should keep origin and destination netuid equal and keep the existing hotkey.

## Minimal robust model

Keep two explicitly distinct views: **Protocol crowdloan** (chain-sourced, automatic payout history) and **Private ownership** (versioned agreement, local obligations, operator-proposed payouts). Do not merge their payable balances. Private allocations apply only to agreed residual owner revenue, and record whether the agreement covers gross owner revenue or remaining revenue after native lease payouts.

Minimal records:
1. Ownership revision: agreement ID, revision ID, effective block, canonical account IDs and integer shares summing exactly to denominator (10,000 basis points for 0.01% precision), source/hotkey/netuid/genesis, distribution basis, author and previous revision hash. Editing creates a new revision effective at a future boundary. Old intervals retain old shares. Account canonicalization must compare decoded AccountId bytes, not SS58 presentation strings.
2. Revenue observation: immutable source identity, genesis, finalized block/hash and event index (where available), subnet, hotkey, integer alpha units, provenance. Distinguish verified owner-emission observations from manually declared revenue and estimates. Never infer emissions from balance increase alone: deposits, transfers, staking, locks, swaps, and withdrawals alter balance.
3. Distribution: unique agreement + revision + source interval, immutable recipient amount snapshot, total, remainder policy, source observation IDs, state, call bytes/hash, and optional submitted/finalized evidence. Only one live reservation may consume a source observation.
4. Append-only audit events: creation, supersession, approval/proposal, submission, failure, final settlement. Do not overwrite historic allocations when recipients are edited.

Accrual uses observed eligible alpha in `(previousClosedBlock, newClosedBlock]`, not a timer-derived APY. Time intervals only determine when a proposal becomes available. Split a period at ownership revision boundaries. Missing finalized source coverage blocks verified accrual; a manual declared amount can still be a clearly marked draft requiring human validation. Show an explicit observed-through block and provenance.

## Exact math

Store alpha base units as non-negative bounded BigInt internally and canonical decimal strings across JSON. Never parse monetary values with Number/parseFloat. Parse up to chain-supported decimals (currently normally 9) by string manipulation. Integer percentage shares or exact rational shares only.

For simple distribution snapshots, largest-remainder allocation is clean: `base_i = total * shares_i / denominator`; distribute the remaining integer units to descending fractional remainder, ties broken by canonical AccountId bytes. Sum must equal total, no negative allocations. State this rounding rule in snapshot. If recurring micro-accrual fairness becomes material, retain per-recipient fractional carry across observed accruals rather than repeatedly rounding tiny events; carry belongs to its original ownership revision. Batch settlement can aggregate interval amounts without changing the underlying entitlement.

## Payment and retry invariants

Draft -> proposed/awaiting approvals -> submitted -> finalized; canceled/failed states remain auditable. Proposed/submitted allocations reserve the payable amount; button clicks do not clear accrual. A prepared proposal is not a payment. Threshold multisig approval is not execution. Outer extrinsic success is insufficient: verify inner proxy result, multisig execution result and utility batch completion alongside transfers.

Prefer atomic utility.batchAll of same-subnet alpha transfer calls plus optional bounded reference remark if runtime supports the composition. Match exact decoded call tree/bytes, source account, recipients, amounts, netuid, hotkey, genesis, and successful finalized events against the immutable proposal. Idempotent settlement consumes the same chain event only once. Persist evidence using `(genesisHash, blockHash, extrinsicIndex, eventIndex)`; when the whole batch is one settlement, reserve extrinsic identity once for that batch. Do not treat a transaction hash supplied by a client as proof.

For a shared server, database unique constraints plus transaction row locks enforce one open obligation per source interval and one settlement per finalized evidence. A browser-only local ledger can prevent duplicate clicks in that browser and export audit snapshots; it cannot honestly promise cross-device double-pay prevention or trusted shared audit. Label local state accordingly. Recover submitted transactions by reconciling chain evidence before retrying; expiration/timeout alone never proves non-execution.

## Small runnable check set

Single accounting test file should cover: (1) 1 base unit split across 3 owners is conserved and deterministic; (2) huge values above Number.MAX_SAFE_INTEGER remain exact; (3) negative/decimal-overprecision/over-u64 amounts and bad share totals fail; (4) duplicate decoded wallets fail; (5) ownership revision cannot rewrite closed period; (6) a second proposal cannot reserve consumed observations; (7) submitted/approved does not become paid; (8) duplicate settlement is idempotent; (9) wrong genesis/recipient/amount and failed inner execution cannot settle; (10) export/import round trip preserves integer strings and rejects unknown unsafe fields.
