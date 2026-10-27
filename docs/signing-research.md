# Browser Bittensor signing research — 2026-09-07

## Recommended implementation

Use `@polkadot/api` metadata-driven extrinsic construction and `@polkadot/extension-dapp` for injected wallets. Call `web3Enable(appName)` only from explicit connect action, then `web3Accounts()` or `web3AccountsSubscribe()`. Preserve `meta.source`; obtain exact provider using `web3FromSource(source)` (or `web3FromAddress(address)`). Compare decoded 32-byte account IDs, not SS58 text. Hardware accounts remain held by the extension; label Ledger as “via compatible wallet” rather than promising all devices/calls.

Prefer `await tx.signAsync(address, {signer, era: 64, withSignedTransaction:false, allowCallDataAlteration:false})`; after it returns revalidate freshness, then `signed.send(callback)`. This gives a check after potentially lengthy wallet/hardware approval. API source defaults `allowCallDataAlteration` to true, and even false only validates call bytes for full signedTransaction results. Refusing full signedTransaction initially is the simplest invariant. If accepting full returned extrinsics later, independently match signer, call, era, nonce, tip, asset, metadata-hash/mode and extrinsic version to the reviewed request.

Primary sources:
- https://polkadot.js.org/docs/extension/usage/
- https://polkadot.js.org/docs/extension/cookbook/
- https://raw.githubusercontent.com/polkadot-js/api/master/packages/api/src/submittable/createClass.ts
- https://www.bittensor.com/wallet

## Multisig calls

Canonicalize/sort public-key bytes; remove current signer from `otherSignatories`. Derive multisig using `createKeyMulti(addresses, threshold)` then `encodeAddress(key,42)` from `@polkadot/util-crypto`. Validate distinct keys, threshold and runtime MaxSignatories. Runtime metadata is authority for actual calls/weight shapes.

- `api.tx.multisig.approveAsMulti(threshold, others, timepointOrNull, callHash, maxWeight)` stores approval. First approval timepoint null; subsequent read `api.query.multisig.multisigs(multisigAddress, callHash)` and use its `when`.
- `api.tx.multisig.asMulti(threshold, others, timepointOrNull, innerCall.method, maxWeight)` executes when threshold met. Full call, not call hash. Preserve `innerCall.method.toHex()` and hash across approvals; never re-encode against a new runtime silently.
- `api.tx.multisig.cancelAsMulti(threshold, others, when, callHash)` cancellation is origin depositor only.
- `api.tx.multisig.asMultiThreshold1(others, innerCall.method)` only if deliberately supporting threshold 1.
- `await innerCall.paymentInfo(multisigAddress)` supplies estimated weight; estimate outer fees on fee-paying signer. Deposit = DepositBase + threshold * DepositFactor; account treasury must hold transferred assets while signer holds fee/deposit.

Sources: https://polkadot.js.org/docs/substrate/extrinsics/ and https://wiki.polkadot.com/learn/learn-guides-accounts-multisig/

## Vault QR with actual metadata proof: feasible entirely in JS

Installed only in `/tmp/vault-proof-check` for research: `@polkadot-api/merkleize-metadata@1.3.1`. Published declarations:

```ts
import { merkleizeMetadata } from '@polkadot-api/merkleize-metadata';
const merkle = merkleizeMetadata(metadataBytes, {
  decimals: 9, tokenSymbol: 'TAO',
  // optional consistency hints, checked against metadata:
  base58Prefix: 42, specName, specVersion,
});
const metadataHash = merkle.digest(); // Uint8Array32
const proof = merkle.getProofForExtrinsicPayload(barePayloadBytes);
```

Package also offers getProofForExtrinsic(tx, additionalSigned?), getProofForExtrinsicParts(bareCall, extra, additionalSigned). Bare means **no compact call length**. Supports extrinsic V4; metadata must provide System.Version and SS58Prefix. Fetch runtime metadata V15 (or supported format) at exactly the runtime/block used for the payload. Do not use transformed `asLatest` metadata as if it were original SCALE metadata.

Set runtime signed extension CheckMetadataHash mode=1 and metadataHash to digest when creating `ExtrinsicPayload`. `payload.toU8a({method:true})` is bare call + signed extensions for proof/signature; `payload.toU8a()` has the compact call length required by Vault transport. The QR transport payload is:

```
0x53 | crypto=0x01 | command=0x06 | signer-public-key32 |
encodedProof | compact(callLength) | call | extra | additionalSigned |
genesisHash32
```

`QrDisplayPayload` from `@polkadot/react-qr` accepts `address`, `cmd`, `payload:Uint8Array`, `genesisHash`, `size`, `timerDelay`. Use `cmd={6}` and `payload={u8aConcat(proof, payload.toU8a())}`; component adds public key/genesis/framing. It hardcodes SR25519, so restrict direct QR mode to SR25519 accounts. No generic “all hardware” claim. `QrScanSignature` calls `onScan({signature:'0x...'})`; its decoder is only a hex prefix wrapper, so strict signature format validation and actual `signatureVerify` remain mandatory. Scan return may contain MultiSignature type prefix; enforce known SR25519 prefix/length, verify bare payload (blake2 hash if >256 bytes according to substrate signing) with signer public key, then `tx.addSignature(address, signature, payloadJson)`.

**Verification performed:** official Vault fixture `valid_westend_transfer_with_proof.txt` decodes and re-encodes exactly using package `proof` codec. Header is 530106; 3443-byte proof; 154-byte payload; 39-byte call with SCALE compact prefix; last32 genesis. Runnable `/tmp/vault-proof-check/check.mjs`; passed. A raw Buffer subarray is unsafe for scale-ts decoder due underlying offset; `Uint8Array.from(subarray)` fixed it. Use standalone Uint8Arrays in test/interop code.

Sources:
- https://github.com/polkadot-api/polkadot-api/tree/main/packages/merkleize-metadata (README import has a typo “merkleized”; actual package name is merkleize-metadata)
- https://raw.githubusercontent.com/novasamatech/parity-signer/master/rust/transaction_parsing/src/lib.rs (command 06)
- https://raw.githubusercontent.com/novasamatech/parity-signer/master/rust/transaction_parsing/src/parse_transaction.rs (proof before compact call)
- https://raw.githubusercontent.com/novasamatech/parity-signer/master/rust/transaction_parsing/src/helpers.rs (public key, genesis framing)
- https://raw.githubusercontent.com/novasamatech/parity-signer/master/rust/parser/src/types.rs (MetadataProof struct)
- https://raw.githubusercontent.com/novasamatech/parity-signer/master/rust/transaction_signing/for_tests/valid_westend_transfer_with_proof.txt
- https://raw.githubusercontent.com/polkadot-js/ui/master/packages/react-qr/src/DisplayPayload.tsx
- https://raw.githubusercontent.com/polkadot-js/ui/master/packages/react-qr/src/ScanSignature.tsx
- https://raw.githubusercontent.com/polkadot-js/ui/master/packages/react-qr/src/util.ts

Bittensor preview docs describe Vault 7.5+, SDK `bt.VaultSigner` and `--signer vault`, but public `opentensor/bittensor master` and `bittensor-wallet main` trees inspected did not contain VaultSigner files. Thus no verified released SDK generic offline-import CLI command was found. Prefer browser proof implementation above over inventing CLI flags. Source https://preview.bittensor.com/docs/guides/vault .

## Lifetime and payload checks

Prepare one immutable payload per sign request using pinned genesis, runtime specVersion/transactionVersion, exact method bytes, nonce, mortal era (e.g.64/128 blocks), era reference blockHash, signed extension list and metadata hash. Keep it memory-only, one active request. UI edits/network/account switches invalidate request. Validate selected signer membership and intended multisig address before issuing it. Never rebuild payload when attaching scanned signature.

Use actual `ExtrinsicEra.birth(current)` / `death(current)` against chain height, not wall clock alone. Recheck RPC head, runtime, genesis, signer nonce, and metadata immediately before submission; reject expired or changed contexts and rebuild for fresh signing. Enforce an additional short UI timeout, and require remaining era headroom. Reject immortal imported requests; nonce and mortal era provide onchain replay limits. Do not infer success from broadcast or signature acceptance.

## Finalized reconciliation

Use `status.isFinalized`, then fetch corresponding block and events; locate exact tx hash/extrinsic index, filter events to `phase.isApplyExtrinsic && phase.asApplyExtrinsic == index`. Verify signed extrinsic signer and exact call match request. Require outer `system.ExtrinsicSuccess`, but this alone is insufficient for wrappers:
- `multisig.MultisigExecuted` must match multisig/callHash/timepoint and result Ok; Err means executed-failed, with deposit released but no successful distribution.
- Before threshold: `NewMultisig` / `MultisigApproval` means approved only, never paid.
- `proxy.ProxyExecuted` result must be Ok.
- For atomic distributions use `utility.batchAll`; reject any inner failure event. Avoid `batch`/`forceBatch` for ledger payments due partial execution.
- Record per-beneficiary transfer/stake event evidence and asset/netuid/amount in same extrinsic scope. Only then mark the immutable distribution checkpoint settled. Keep block hash/index/tx hash/event indexes as evidence and idempotency keys.

Source https://polkadot.js.org/docs/polkadot/events/ . API callbacks derive filtered events at finality, but an explicit reconciliation function is easier to reuse after reload and independently verify.
