# Deploying Tensor Safe to Caution (BYOC)

Tensor Safe runs as one AWS Nitro Enclave in your own AWS account, built by Caution from this repository's `Containerfile` and configured by `caution.hcl`. Postgres stays outside the enclave. Workspace state and audit details are sealed with `DATA_KEY` (AES-256-GCM) before they leave the enclave. TLS terminates inside the enclave (Attested TLS).

Docs index: https://docs.caution.co/llms.txt. Field reference: https://docs.caution.co/reference/caution-hcl/.

## 1. Prerequisites

- **Caution account**: an access code from info@caution.co and a passkey. Install the CLI with `make install-cli` from https://git.caution.co/public/platform. `secret send-shard` needs this host-toolchain build, not the StageX build. See https://docs.caution.co/quickstart/byoc/.
- **Docker** with the containerd image store. On Apple Silicon, turn on Rosetta in Docker Desktop, because images are `linux/amd64` (https://docs.caution.co/guides/verify-an-app/).
- **AWS BYOC environment**: run `caution init --byoc --region <region>` from this checkout, using provisioning credentials. It creates a /16 VPC, an S3 bucket for EIFs, roles and a scoped IAM user. To use an existing VPC (for example, one that already holds the database), run the manual setup with `VPC_ID=` (https://docs.caution.co/reference/byoc/). Commit the generated `.caution/deployment.json`. Copy the VPC, subnet and security group IDs into `caution { provider { ... } }`.
- **Postgres**, for example RDS for PostgreSQL in the same VPC:
  - Use private DB subnets with public access off. Inbound 5432 should come only from the enclave instances' security group.
  - Set `rds.force_ssl = 1`. Turn on automated backups and point-in-time recovery, which are the only copy of the data.
  - Create a least-privilege role. The app applies `db/migrations-pg` at startup, so the role needs DDL on its own database and nothing else:
    ```sql
    CREATE ROLE tensor_safe LOGIN PASSWORD '<generated>';
    CREATE DATABASE tensor_safe OWNER tensor_safe;
    REVOKE ALL ON DATABASE tensor_safe FROM PUBLIC;
    -- never GRANT rds_superuser / rds_iam / other databases
    ```
  - **RDS certificates are not publicly trusted.** The image trusts only the StageX Mozilla CA bundle, so `sslmode=verify-full` against RDS fails until you ship the RDS CA. Commit the bundle from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem as `deploy/rds-ca.pem` after checking it. Add `!deploy/rds-ca.pem` to `.dockerignore`. In the Containerfile `RUN` block, add `cp deploy/rds-ca.pem $R/etc/ssl/rds-ca.pem`. In `unit.env`, add `NODE_EXTRA_CA_CERTS = "/etc/ssl/rds-ca.pem"`. A Postgres provider whose certificate chains to a public CA needs none of this.
  - Put the subnet group CIDR(s) in the `tcp/5432` egress rule, one block per subnet. A Multi-AZ failover moves the instance between them.
- **DNS**: use a subdomain, such as `safe.example.com`, that you control. It must not sit behind a CDN or TLS-terminating proxy (https://docs.caution.co/guides/set-up-a-custom-domain/).
- **Public source**: every commit you deploy must also be pushed to https://github.com/cisterciansis/tensor-safe (`app_sources`). Otherwise third parties cannot reproduce it.

Fill in every `TODO` in `caution.hcl`. `http.domain` and the host in `PUBLIC_ORIGIN` must be identical.

## 2. Secrets (Locksmith quorum)

`DATABASE_URL` and `DATA_KEY` reach the app only through `env::vault(...)`. They are decrypted inside a verified enclave after enough holders approve. Never put them in the image, in `caution.hcl` literals or in Git. See https://docs.caution.co/guides/add-encrypted-secrets/.

1. Create the quorum bundle once, with at least two holders and threshold 2. Keep holder keys on hardware.
   ```sh
   caution login
   caution secret init --holder alice=external-pgp --holder bob=webauthn \
     --threshold 2 --name "Tensor Safe"
   ```
   This writes `.caution/quorum-bundle.json` and `.caution/keymaker-pcr-policy.json`. In the dashboard flow, run `caution verify --service keymaker` and save its `.policy` yourself. Holders using passkeys also trust Caution's key service, so verify it with `caution verify --service key-service`.
2. Write the values to a git-ignored `.env`. `.gitignore` already covers `.env*`.
   ```sh
   DATA_KEY=$(openssl rand -base64 32)
   DATABASE_URL=postgres://tensor_safe:<url-encoded-password>@<rds-endpoint>:5432/tensor_safe?sslmode=verify-full
   ```
3. Encrypt and check:
   ```sh
   caution secret encrypt     # -> .caution/secrets/DATA_KEY.asc, DATABASE_URL.asc
   caution secret inspect
   ```
4. Commit `.caution/quorum-bundle.json`, `.caution/keymaker-pcr-policy.json` and `.caution/secrets/*.asc`. The Containerfile copies them to `/etc/caution/` when present (self-hosted builds have none). If they're missing, the build still succeeds but the enclave can't unlock `DATABASE_URL` or `DATA_KEY` and won't start, so check they're committed before pushing. `.dockerignore` admits only those files from `.caution/`.
5. **Escrow `DATA_KEY` offline**, for example split among the holders, then delete `.env`. Sealed rows cannot be read without it. You also need the plaintext to re-encrypt it when holders change, because a new bundle means a new key.

## 3. First deploy

```sh
git push origin main            # public repo first, so the commit is reproducible
git push caution main
caution apps get                # lifecycle, DNS target, deployment ID
```

1. Create `CNAME <subdomain> -> <app-id>.apps.caution.sh`. Never point an A record at the Elastic IP.
2. Run `caution verify`. It reproduces the image from the deployed commit and checks fresh Nitro evidence. Until HTTPS is up, it reports that the PCRs are verified and the TLS binding is pending.
3. Each holder runs `caution secret send-shard`. The app is locked until the threshold is met.
4. When `https://<subdomain>/` answers, run `caution verify` again. It must print `TLS certificate binding verified`. Commit `.caution/trusted_hashes.json`.
5. Run smoke checks. `GET /` should return 200 with HTML, and `GET /api/workspaces` should return 401. `/.well-known/caution/health` and `/attestation` are platform routes.
6. Check the client-IP path. The rate limiter keys on the first `X-Forwarded-For` hop, set by enclave Caddy (`TRUST_PROXY=1`).
   - Send 21 `POST /api/session/challenge` requests within a minute, each with a different forged `X-Forwarded-For`. You should get a 429. If you do not, the header can be forged, so remove `TRUST_PROXY`.
   - Then send 20 requests from one network and 1 from another. If the second network gets a 429, every client shares one address and the sign-in limit is global.

## 4. Updates (blue-green)

This applies when `caution apps get` shows the deployments lifecycle. Legacy apps replace in place. See https://docs.caution.co/guides/deploy-updates/.

```sh
git push origin main && git push caution main     # -> candidate <id>
caution verify -d <id>                            # PCRs; TLS pending until live
caution secret send-shard -d <id>                 # every holder
caution apps switch -d <id>                       # passkey; moves the stable IP
caution verify -d <id>                            # again once HTTPS answers: TLS binding
```

- An Attested TLS candidate does not start application HTTPS until the domain resolves to it. Before the switch, you can only check `/attestation` and health.
- **The candidate runs its migrations against the live database at startup**, while the old version is still serving. Migrations must be additive (expand, then contract later) so that both versions keep working.
- Let's Encrypt allows 5 certificates per hostname per 7 days, and every new enclave needs one. Do not switch repeatedly. If HTTPS fails, stop and wait.
- After a switch timeout, check `caution apps get`, the history and the serving endpoint before retrying.
- A restarted enclave (`restart { policy = "always" }`) comes back locked. Holders must run `send-shard` again, so plan holder availability.

## 5. Rollback

Run `caution apps switch -d <previous-id>`. This works only while that deployment is still running, healthy and unlocked. It does not undo database writes or migrations. Run `caution verify -d` again afterwards for the TLS binding. Destroy old deployments with `caution apps destroy -d <id>` only once you no longer need them for rollback. Every retained deployment is a billed EC2 instance.

## 6. How anyone verifies the running deployment

```sh
git clone https://github.com/cisterciansis/tensor-safe && cd tensor-safe
caution verify --attestation-url https://<subdomain>/attestation
```

The CLI sends a fresh nonce and reads the deployed commit from the response manifest. It checks out that commit locally, rebuilds the enclave image, and checks the AWS Nitro signature chain and PCR0/1/2 against the rebuild. For Attested TLS, it also checks that the certificate served on that same HTTPS connection is the one whose fingerprint the enclave attests. Review the build artifacts directory it prints (`Containerfile.eif`, `app/`, `run.sh`, `manifest.json`).

Quick look in a browser: https://dashboard.caution.co/verify shows authenticated PCRs. It does not reproduce source or pin expected values, so compare them against PCRs you got from a trusted channel. Publish the expected PCRs (`trusted_hashes.json`) with each release, for example in a signed tag. Attested TLS needs **periodic** re-verification, which Caution Canary can automate with `--e2e-mode tls`.

**What verification proves**
- At the moment of the check, the enclave runs exactly the image reproduced from that public commit, this Containerfile and the pinned Caution platform.
- The browser bundle (`dist/client`) is inside the measured image, so the JavaScript served from the enclave is the reviewed build.
- With a completed TLS binding, the private key of the certificate on `<subdomain>` is held by that enclave, so the host cannot read the traffic.

**What it does not prove** (https://docs.caution.co/guides/verify-an-app/, https://docs.caution.co/reference/deployment-configuration/)
- That the code is safe or correct. Verification only links the running enclave to source you can review.
- Anything after the check. The certificate or deployment can change, so re-verify regularly.
- That a given browser received enclave-served assets. Ordinary browsers check only WebPKI, not Nitro evidence, and nothing pins the JavaScript in the client.
- That the egress and ingress policy is enforced. It is a host control, not an attested guarantee.
- That Postgres is honest. `DATA_KEY` gives sealed rows confidentiality and tamper detection. Anyone with database access can still delete rows, block access, or replay older sealed rows, unless the application binds versions.
- That the response manifest is authentic. It is unsigned metadata, and trust comes only from the PCR match. Debug mode zeroes PCRs and cannot be verified.
- The trust roots you still rely on: AWS Nitro hardware, Caution's Keymaker and key service (verify them with `--service`), wallet firmware and the chain itself.

## 7. Reproduce the image locally

From a **clean clone** at the deployed commit, with no extra files: the build reads only paths allowed by `.dockerignore`, and Tailwind scans everything in the context.

```sh
docker build --platform linux/amd64 --no-cache -f Containerfile -t ts:1 .
docker build --platform linux/amd64 --no-cache -f Containerfile -t ts:2 .
docker image inspect -f '{{json .RootFS.Layers}}' ts:1 ts:2   # layer diffIDs must match
```

The image ID and digest differ between builds. Caution passes no build args, so the image config `created` time is the wall clock. The enclave is built from the filesystem, which this Containerfile normalizes: mtimes are set to epoch, modes are fixed and owner is root. `caution verify` is the authoritative comparison. A fork without the `.caution` bundle files cannot build, and dummy files would produce a different filesystem.

To upgrade the base images, bump all three StageX digests to the same release (`sx2026.09.0` today), rebuild twice and compare.

## 8. Before real funds

- [ ] No `TODO` remains in `caution.hcl`, and `PUBLIC_ORIGIN` equals `https://` plus `http.domain`.
- [ ] No `debug` block. `caution verify` passes with `TLS certificate binding verified` against the public repo.
- [ ] Two independent rebuilds (one on x86_64 Linux) give identical layer diffIDs, and expected PCRs are published out of band.
- [ ] Postgres is private, TLS `verify-full` (RDS CA shipped), least-privilege role, backups and PITR tested by an actual restore.
- [ ] Egress has no `0.0.0.0/0` except tcp/443, and 5432 is limited to the DB subnets.
- [ ] Quorum threshold is at least 2, holder keys are on hardware, and `DATA_KEY` is escrowed offline. A restart drill passes: shards are released and the app serves again.
- [ ] Client-IP and rate-limit check (section 3.6) done and the result recorded.
- [ ] Rollback drill done on a candidate, and every migration so far is additive.
- [ ] Periodic external verification (Canary or a cron `caution verify`) alerts someone.
- [ ] Independent review of the code. Small amounts first (see `SECURITY.md`).
