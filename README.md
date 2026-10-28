# Tensor Safe

A Safe-inspired, non-custodial Bittensor treasury workspace: a React single-page app and one small Node server. You sign in with your wallet, and changes that decide where money goes are wallet-signed so every browser can detect tampering. Independent project; not affiliated with Safe.

## What works

- Wallet sign-in (Sr25519/Ed25519 message signature), wallet-address members with owner/manager/viewer roles, and append-only audit events.
- Wallet-signed accounts, contacts and cap tables, re-verified in every browser and required before payouts.
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

Workspace roles never grant on-chain signing authority. Sign-in needs a browser wallet that signs messages; ML-DSA, Falcon and rotating keys can't sign in yet, so their owners sign in with any ordinary account and approve multisig actions with btcli.

## Run locally

Node >=22.13; npm.

```sh
npm ci
npm run dev        # Vite on http://localhost:3000, API on :8787 (SQLite in data/)
```

Open http://localhost:3000 and sign in with a browser wallet (Talisman, SubWallet or Polkadot.js).

```sh
npm test           # domain, accounting, wallet formats, sign-in and full server flow (offline)
npm run check      # TypeScript and lint
npm run test:chain # read-only live metadata + local test-key signing, never broadcast
npm run build      # dist/client (static app) + dist/server/main.js
npm start          # serve both from one process
```

## Small architecture

- `lib/domain.ts`: strict boundary schemas, address identity, integer math, interval rules and signed-record checks.
- `lib/chain.ts`: metadata-aware call construction, multisig lifecycle and finalized outcome verification.
- `lib/auth.ts`: the exact sign-in and signed-change messages wallets sign, shared by browser and server.
- `lib/accrual.ts`: bounded runtime-454 archive reconstruction with continuity and ownership checks.
- `lib/offline.ts`: metadata proofs and strict signed-payload verification.
- `server/`: `node:http` server (`main.ts`), wallet sessions (`session.ts`), workspace commands (`workspace.ts`, `workspaces.ts`) and storage (`db.ts`: SQLite, or Postgres when `DATABASE_URL` is set). Each state update uses a version compare-and-swap and one transaction holding the audit record, settlement evidence and signed-change nonce.
- `db/migrations`, `db/migrations-pg`: numbered SQL applied at startup.
- `app/`: the single-page app (`page.tsx`, `forms.tsx`, `signing.tsx`, `wallets.tsx`, `sign-in.tsx`, …).

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

## Sign-in, signed changes and hosting

**Sign-in.** The server issues a one-time message bound to its public origin, your address, a nonce and a 10-minute expiry. Your wallet signs it (wrapped in `<Bytes>`, so it can never be a transaction) and the server opens a 12-hour HttpOnly, SameSite=Strict session. Challenges are single use and rate-limited.

**Signed changes.** Adding an account, contact or cap table, and revising a cap table, require a wallet signature over the exact request: origin, route, workspace, action, network, body hash, signer, nonce and expiry. The server rejects a mismatch or replay and stores the signature with the record. Every browser re-checks it: a record changed after signing shows *Not wallet-signed*, and payouts refuse a cap table that doesn't verify.

**Hosting.** Configuration is environment variables:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact origin users load (`https://…`). Required in production; sign-in and same-origin checks bind to it. |
| `PORT`, `STATIC_DIR` | Listen port and the built `dist/client` to serve. |
| `DATABASE_URL` | Postgres (TLS mode in the URL). Without it, SQLite at `DATABASE_PATH` (default `data/tensor-safe.db`). |
| `DATA_KEY` | Optional base64 32-byte key. Workspace state and audit details are then AES-256-GCM sealed at rest. |
| `TRUST_PROXY` | Set behind a TLS proxy so rate limits use `X-Forwarded-For`. |
| `DB_DIR` | Directory holding `migrations/` and `migrations-pg/` (default `./db`). |

Responses carry a strict Content-Security-Policy (scripts only from this origin; network only to this origin and the Bittensor RPC endpoints), frame denial and no-referrer. For the attested deployment on AWS Nitro Enclaves via Caution, see `docs/deploy-caution.md`.

Cryptographic operations use the Polkadot libraries' JavaScript implementations; no WebAssembly is compiled at runtime.

Research and pinned source references: `docs/chain-research.md`, `docs/accounting-research.md`, `docs/signing-research.md`.

The optional `inspect_treasury_workspace` WebMCP tool exposes the current read-only state. Its runtime registration could not be exercised because this environment did not provide a supported WebMCP validation context. Browser checks used the local development and production servers with mock wallet extensions; hardware wallets and Polkadot Vault have not been exercised on real devices.

## Guided owner and validator administration

Subnet owner controls cover account conviction/perpetual locks, additional alpha locking, automatic owner-earnings locking, complete public profile replacement, and a small verified owner hyperparameter allowlist. Validator controls cover public coldkey profiles, delegate/child commission and child-validator allocation replacement. Current values are read from finalized state before editing; each change is reviewed and saved as an ordinary multisig proposal. Runtime configuration windows, cooldowns, ownership and stake requirements remain authoritative.

The optional technical review exposes call hash, exact preimage, account/network, construction runtime, finalized timepoint, depositor, approvals and decoded target. Missing pending storage is never interpreted as proof of payment.

Run `npx tsx tests/controls.integration.ts` for read-only live call encoding verification. Research: `docs/owner-controls-research.md` and `docs/validator-controls-research.md`. `docs/capability-parity.md` records capability boundaries; `docs/release-verification.md` explains the release manifest and future Caution integration. `npm run release:manifest` requires committed source, builds it and hashes the source and emitted artifacts. It does not assert an audit or enclave deployment.

## License and security

Apache-2.0; see `LICENSE`. Report vulnerabilities privately as described in `SECURITY.md`.
