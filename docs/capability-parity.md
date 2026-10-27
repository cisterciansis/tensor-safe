# Safe-style capability coverage

The supplied comparison describes Safe's treasury UI: multiple approvers, proposals, treasury management and integrated apps. Ethereum, Solana, subscription prices and other products' features in the comparison are context, not Bittensor runtime features.

| Capability | Tensor Safe implementation | Verification / boundary |
|---|---|---|
| Shared accounts and multiple approvers | Native Subtensor multisig derivation, sorted signers, threshold, exact preimage and timepoint | Domain and reconciliation checks; funded device lifecycle remains unverified |
| Transaction proposals and batching | Immutable proposals, unique on-chain references, atomic batches, approvals, cancellation and rebuild | Exact metadata encoding and finalized nested outcome checks |
| Treasury workspaces | Accounts, balances, contacts, team roles, proposals and audit events | Authenticated storage and compare-and-swap checks |
| Integrated treasury tools | Native subnet-owner, validator and investor distribution panels | Guided allowlisted calls, current-value reads and review |
| External app ecosystem | Reviewed custom SCALE calls support advanced native interactions | General third-party app sessions and an app marketplace are not implemented; do not claim full Safe ecosystem parity |
| Spending controls | Native multisig threshold and proxy permissions | Runtime restrictions remain authoritative; no arbitrary spending-limit module is claimed |
| Vesting / cliffs / automated release contracts | Not implemented | Streamflow is a separate product in the image; private distribution intervals do not create an on-chain vesting contract |
| Hardware and offline signing | Compatible injected Ledger transport, Vault proof-carrying QR and strict signature validation | Device execution still needs physical acceptance; no universal hardware claim |
| Auditability / enclave preparation | Source-oriented architecture, locked dependencies, reproducible-input manifest command and hosting boundary documentation | Hashes are not an audit or deployed attestation |

The interface uses beginner-oriented approval requests with an optional exact-call review. Power users can inspect call hash, preimage, network genesis, runtime version, finalized timepoint, depositor, approvals and remaining signers. Finalized execution is proven separately; an absent pending entry does not prove success.

This is a capability assessment, not a statement that Tensor Safe exceeds every mature Safe feature or is more secure than a CLI.
