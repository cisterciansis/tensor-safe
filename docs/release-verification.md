# Auditable releases and future enclave hosting

Tensor Safe signs in the user's wallet or offline device. Neither the workspace server nor a future enclave receives wallet seeds. The server records proposals and checks submitted signatures; signing authority comes from Subtensor, not workspace membership.

## Release evidence

Commit reviewed source, install the locked dependencies with `npm ci`, and run `npm run check`, `npm test`, and `npx tsx tests/controls.integration.ts` (read-only RPC). Then run `npm run release:manifest`. The command rejects a dirty checkout, builds from that source, and writes `/tmp/tensor-safe-release-manifest.json` with the full Git commit, Node version, SHA-256 of every tracked input, and SHA-256 of emitted browser and Worker files.

Archive that manifest beside the deployment bundle and independently reproduce it from the same source, dependency lock and build environment. The manifest itself is not signed. A publisher-controlled hash page cannot independently establish trust in the publisher. Distribute the expected release commitment over an independently authenticated channel and retain the reviewed source.

The current build uses framework tooling and Google font integration. Reproducible enclave images require pinning the complete toolchain, build inputs and font assets, then comparing independent builds. A matching source commit alone does not prove byte-for-byte reproducibility or which code the browser received.

## Caution integration boundary

Caution documents source-linked build and enclave verification: https://caution.co/ and https://docs.caution.co/. Preparation here creates release inputs and a manifest; this deployment remains on Sites. No Caution enclave, attestation, audit seal or verified-runtime badge is claimed.

The current application depends on Cloudflare D1 and Sites authenticated headers. A future Caution deployment must provide a supported persistent database and a real authentication gateway which strips and verifies identity headers. Port and verify those boundaries before serving this Worker through another host. Do not expose the present Worker directly while trusting arbitrary caller-supplied identity headers.

For enclave deployment, bind the reviewed commit, lockfile, frontend assets, server image, configuration, toolchain and expected enclave measurements. Verify the attestation chain, measurements, freshness and TLS termination path. Ensure the browser-delivered assets are part of the measured release or independently hash-verified. Enclave isolation does not audit business logic, prevent a malicious approved release, fix wallet firmware, or make public blockchain activity private.

## Open-source release preparation

The browser source, transaction encoders, schemas and tests are separated from platform adapters. Keep release artifacts free of credentials and local workspace data. Preserve dependency notices and choose the project's public license before publishing a public repository. The current private source push is not a public open-source release.

Publish a threat model, dependency inventory and supported device/version matrix beside the source. Receive vulnerability reports privately before public disclosure. No real funds, wallet seeds, or private customer data belong in an issue or reproduction.
