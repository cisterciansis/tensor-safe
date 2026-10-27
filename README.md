# Tensor Safe

A Safe-inspired, non-custodial Bittensor treasury workspace. Built with React, TypeScript, Substrate metadata-aware transaction tools and a small Cloudflare D1 backend. Independent project; not affiliated with Safe.

## What works

- Durable workspaces, owner/manager/viewer access, shared addresses and append-only audit events.
- Deterministic multisig creation/import, finalized balance/proxy/approval inspection, configuration export.
- TAO transfers, same-subnet alpha transfers, limit-price staking/unstaking, proxy add/remove, advanced SCALE calls and atomic batches.
- Existing on-chain multisig preimage import, approval, final execution, depositor cancellation and failed/cancelled proposal rebuild.
- Injected wallet signing, including Ledger accounts exposed by compatible extensions. No direct USB transport.
- Polkadot Vault command-6 proof-carrying QR, sr25519 signature scanning/pasting, strict verification, nonce/runtime/era checks and payload export.
- Private ownership revisions, exact integer allocations, immutable interval reservations and finalized settlement reconciliation.
- Native lease/crowdloan inspection with contributor shares, pending dividends and paginated payout history and event-identified JSON export. Protocol dividends never become private payables.

## Explicit limits

This is research-lab software, not an audited custody product. No real funds were moved during development. Hardware-device operation and a funded multi-party testnet lifecycle still need validation.

Ordinary owner emission credits have no dedicated runtime event. **Automatic archive reconstruction is implemented for stable, unleased subnets on runtime 454.** Sync runs in 16-block durable checkpoints, checks exact fixed-point owner-cut accrual and epoch drains, and rejects lease, ownership, registration, runtime or privileged-storage transitions. The configured RPC must retain the requested archive. Unsupported intervals use an explicitly declared, independently reconciled amount and source reference. Neither path infers revenue from balance growth or an APY timer. Auto-locked credits are recorded as earned, not necessarily spendable; a payout still requires available stake. Native lease history loads 25 finalized blocks per page and follows canonical parent hashes to genesis. Exports state their loaded range; archive availability determines how far back scanning can proceed.

Advanced proxy operations (announcements, delayed execution, pure proxies and beneficiary-specific calls) use reviewed SCALE calls; dedicated guided forms are not provided. External accounts must supply their exact multisig preimage. Mainnet and testnet genesis hashes are pinned.

The hosting platform initially restricts this site to its owner. Adding a workspace member does not grant platform access. Hosting access and application membership must both allow the person. Workspace roles never grant on-chain signing authority.

## Run locally

Node >=22.13; npm.

```sh
npm ci
npm run db:local
npm run dev
```

Open the URL printed by the server and use its local sign-in. The Sites development plugin provides an isolated local identity; spoofed forwarded identity headers are stripped.

```sh
npm test                 # deterministic domain, reconciliation and SQLite checks
npm run check            # TypeScript and lint; vendored UI primitives excluded
npm run test:api         # against the running local development server
npm run test:chain       # read-only live metadata + local test-key signing, never broadcast
npm run build
```

`TEST_ORIGIN` overrides the API test URL (default http://localhost:3001). API checks create an explicitly named local validation workspace. No production migrations contain seeds. `db:local` is for the initial empty local DB; production migration history is append-only.

## Small architecture

- `lib/domain.ts`: strict boundary schemas, address identity, integer math and interval rules.
- `lib/chain.ts`: metadata-aware call construction, multisig lifecycle and finalized outcome verification.
- `lib/accrual.ts`: bounded runtime-454 archive reconstruction with continuity and ownership checks.
- `lib/offline.ts`: metadata proofs and strict signed-payload verification.
- `app/api/workspaces`: authenticated command endpoints. Each state update uses a version compare-and-swap and an atomic batch containing the audit record and optional unique settlement evidence.
- `db/schema.ts` and `drizzle/`: durable schema and migrations.
- `app/page.tsx`, `forms.tsx`, `signing.tsx`, `chain-view.tsx`: the workspace and its interaction flows.

The workspace document is intentionally bounded to 2 MB, 50 accounts and 5,000 proposals. A single optimistic version serializes workspace mutations; normalize hot tables if sustained contention or larger histories require it. Integer units are decimal strings in JSON and BigInt in calculations. Largest-remainder allocation breaks ties by decoded AccountId, conserving every unit.

Every newly constructed proposal appends an on-chain reference inside `utility.batchAll`, producing a distinct call hash even when two payment periods have identical recipients/amounts. No browser storage is authoritative. No seeds/private keys are accepted or stored.

## Signing and recovery

1. Review the exact decoded call, fee estimate, network, signer and approval threshold.
2. Sign with an injected wallet or Vault. Metadata-bound mortal payloads expire after 128 blocks.
3. The server verifies the signature and current multisig call, then reserves the attempt before the browser broadcasts.
4. Finalization is reconciled against the canonical block, exact preimage and nested multisig result. An approval is not a payment.
5. If broadcasting fails, retain the transaction hash. Reconcile the finalized block if it was included. An expired attempt can be released only when the finalized signer nonce proves it was not consumed. If the nonce advanced, locate the included transaction; do not guess and retry.
6. Reconcile a depositor cancellation or inner execution failure before rebuilding. Rebuilding preserves the distribution allocation and creates a fresh proposal/reference.

Runtime upgrades require fresh proposal review. Pending old-runtime proposals may still be cancelled by their depositor. Imported external preimages remain explicitly external and do not use the app's generated reference.

## Quantum-safe wallets (subtensor#3220)

Support for the ML-DSA-65, Falcon-512/1024 and rotating ("hashed") wallet types is built in and switches on per network from runtime metadata. Neither mainnet nor testnet exposes it yet (runtime 486); nothing falls back to a weaker path.

- **Addresses.** Every address field accepts SS58 or a `tao_` receiving address (60 or 103 characters). A `tao_` address is checksum-verified and resolved to its permanent account; the descriptor is kept with the contact or signer. Paying, adding as a co-signer, or granting a proxy to a `tao_` account requires its finalized registration on that network.
- **Quantum-safe multisig.** New accounts can use the registration-free off-curve derivation (`Multisig.*_safe`), which no raw Sr25519/Ed25519 key can sign for. The derivation is identity: stored accounts without a mode stay legacy and are never reinterpreted. The server refuses to record a safe account on a network without the safe calls. Only a quorum that always includes quantum-resistant members is quantum-resistant.
- **Signing.** Browser wallets, Ledger and Vault only sign standard Sr25519/Ed25519 keys. Other members get an exact `btcli call Multisig.approve_as_multi[_safe]` hash approval from the review dialog; the final approval, which must carry the full call, is submitted in-app by a browser-capable co-signer.

`lib/wallets.ts` holds the formats; `tests/wallets.test.ts` checks them against the runtime and SDK golden vectors.

## Deployment and trust boundary

Sign-in comes from `oai-authenticated-user-*` headers that the hosting gateway sets after stripping any client copies. The app trusts them only when `.openai/hosting.json` names a Sites `project_id` (a build-time switch) or in `npm run dev`, where the Sites plugin plays the gateway. The published repository ships `"project_id": null`, so a production build fails closed: every workspace request returns 401 and forged headers are ignored.

To self-host elsewhere, put the Worker behind an authentication gateway that strips and sets those headers, then opt in deliberately, or replace `identity()` in `lib/server.ts` with your own verification. Never expose a build that trusts client-supplied identity headers directly. Keep secrets outside the source repository.

The supported Polkadot web shims are selected for Workers. Cryptographic operations use the library's JavaScript implementations; runtime WASM compilation is disabled for this environment. Production dependency audit was clean at build time. Remaining moderate advisories belong to development-only Drizzle tooling.

Research and pinned source references: `docs/chain-research.md`, `docs/accounting-research.md`, `docs/signing-research.md`.

The optional `inspect_treasury_workspace` WebMCP tool exposes the current read-only state. Its runtime registration could not be exercised because this environment did not provide a supported WebMCP validation context. Browser checks used the local development server with mock wallet extensions; hardware wallets and Polkadot Vault have not been exercised on real devices.

## Guided owner and validator administration

Subnet owner controls cover account conviction/perpetual locks, additional alpha locking, automatic owner-earnings locking, complete public profile replacement, and a small verified owner hyperparameter allowlist. Validator controls cover public coldkey profiles, delegate/child commission and child-validator allocation replacement. Current values are read from finalized state before editing; each change is reviewed and saved as an ordinary multisig proposal. Runtime configuration windows, cooldowns, ownership and stake requirements remain authoritative.

The optional technical review exposes call hash, exact preimage, account/network, construction runtime, finalized timepoint, depositor, approvals and decoded target. Missing pending storage is never interpreted as proof of payment.

Run `npx tsx tests/controls.integration.ts` for read-only live call encoding verification. Research: `docs/owner-controls-research.md` and `docs/validator-controls-research.md`. `docs/capability-parity.md` records capability boundaries; `docs/release-verification.md` explains the release manifest and future Caution integration. `npm run release:manifest` requires committed source, builds it and hashes the source and emitted artifacts. It does not assert an audit or enclave deployment.

## License and security

Apache-2.0; see `LICENSE`. Report vulnerabilities privately as described in `SECURITY.md`.
