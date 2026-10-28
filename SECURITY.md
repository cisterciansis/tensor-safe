# Security policy

Tensor Safe coordinates multisig control of real funds. Please report vulnerabilities privately and give us a chance to fix them before disclosure.

## Reporting

Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**). Include the affected commit, impact, and steps or a proof of concept. Do not open public issues for vulnerabilities, and never include anyone's seed phrase, private key or real wallet data.

## Scope

Most relevant:

- Transaction construction, call/hash matching and multisig derivation (`lib/chain.ts`, `lib/domain.ts`, `lib/wallets.ts`).
- Signed-payload verification and offline signing (`lib/offline.ts`, `app/signing.tsx`).
- Wallet sign-in, sessions, signed changes, workspace authorization, versioned writes and settlement uniqueness (`lib/auth.ts`, `server/`, `lib/server.ts`).
- Distribution accounting and archive reconstruction (`lib/accrual.ts`, `lib/lease-history.ts`).

Known boundaries, not vulnerabilities on their own: a database host restoring an older copy of sealed state (wallet-signed records and on-chain checks guard what decides payments), behaviour of third-party wallet extensions, and the protocol rules of the Bittensor runtime itself.

## Trust model

Private keys never enter the app. Every approval is signed in the user's wallet, hardware device, Polkadot Vault or btcli, and the chain enforces the multisig threshold. Workspace roles never grant signing authority, and changes that decide where money goes carry the author's wallet signature. This is unaudited research software; use small amounts until it has had independent review.
