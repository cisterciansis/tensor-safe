# Contributing

Thanks for helping. Tensor Safe coordinates control of real funds, so changes are judged first on correctness and safety, then on simplicity.

## Setup

Node 22.13 or newer, npm and Python 3.

```sh
npm ci
npm run dev     # http://localhost:3000, API on :8787, SQLite in data/
```

## Before you open a pull request

```sh
npm run check   # TypeScript and lint
npm test        # offline: domain, accounting, wallet formats, sign-in, full server flow
npm run build
npx oxfmt <changed files>
```

`npm run test:chain` runs read-only checks against live Bittensor RPC; run it when you touch transaction construction (`lib/chain.ts`, `lib/controls.ts`, `lib/offline.ts`) or accrual (`lib/accrual.ts`).

## Ground rules

- **Smallest change that works.** No speculative abstractions or new dependencies for what a few lines can do. Match the surrounding style.
- **Validate at boundaries.** Every API input goes through a strict zod schema that rejects unknown fields. Money is integer base units (BigInt), never floating point.
- **Fail closed.** If chain state, a signature or a runtime version can't be verified, refuse rather than guess.
- **Signed formats are frozen.** The sign-in and signed-change messages in `lib/auth.ts`, and the canonical command each signed record rebuilds (`signedCommands` in `lib/domain.ts`), are verified by every browser. Changing them breaks existing records: bump `Version:` and keep verifying the old one.
- **Runtime-specific logic is pinned.** Anything that reconstructs chain state (see `lib/accrual.ts`) is tied to verified runtime code hashes. Supporting a new runtime needs source review plus a live continuity check.
- **Tests for logic.** A new branch, parser or money path ships with a check in `tests/` that fails if it breaks.

## Security issues

Don't open public issues for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under Apache-2.0.
