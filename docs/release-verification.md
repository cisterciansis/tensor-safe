# Auditable releases and future enclave hosting

Tensor Safe signs in the user's wallet or offline device. Neither the workspace server nor a future enclave receives wallet seeds. The server records proposals and checks submitted signatures; signing authority comes from Subtensor, not workspace membership.

## Release evidence

Commit reviewed source, install the locked dependencies with `npm ci`, and run `npm run check`, `npm test`, and `npx tsx tests/controls.integration.ts` (read-only RPC). Then run `npm run release:manifest`. The command rejects a dirty checkout, builds from that source, and writes `/tmp/tensor-safe-release-manifest.json` with the full Git commit, Node version, SHA-256 of every tracked input, and SHA-256 of emitted browser and Worker files.

Archive that manifest beside the deployment bundle and independently reproduce it from the same source, dependency lock and build environment. The manifest itself is not signed. A publisher-controlled hash page cannot independently establish trust in the publisher. Distribute the expected release commitment over an independently authenticated channel and retain the reviewed source.

The current build uses framework tooling and Google font integration. Reproducible enclave images require pinning the complete toolchain, build inputs and font assets, then comparing independent builds. A matching source commit alone does not prove byte-for-byte reproducibility or which code the browser received.

## Attested hosting

The hosted deployment runs the reproducible container image inside an AWS Nitro Enclave through Caution, and anyone can check that the running enclave was built from a given public commit. Steps and limits are in `docs/deploy-caution.md`. Storage lives outside the enclave (Postgres), sealed with a key only the enclave holds, and money-critical records also carry wallet signatures every browser verifies.

Bind the reviewed commit, lockfile, frontend assets, server image, configuration, toolchain and expected enclave measurements. The browser-delivered assets are inside the measured image. Enclave isolation does not audit business logic, prevent a malicious approved release, fix wallet firmware, or make public blockchain activity private.

## Open-source release preparation

The browser source, transaction encoders, schemas and tests are separated from platform adapters. Keep release artifacts free of credentials and local workspace data. Preserve dependency notices. The public repository is Apache-2.0 licensed.

Publish a threat model, dependency inventory and supported device/version matrix beside the source. Receive vulnerability reports privately before public disclosure. No real funds, wallet seeds, or private customer data belong in an issue or reproduction.
