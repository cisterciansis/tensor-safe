import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Hash actual release inputs and emitted files; this is evidence, not attestation.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain'))
  throw Error('Commit the reviewed source before creating release evidence');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (git('status', '--porcelain'))
  throw Error(
    'Build changed tracked source; review and commit before releasing',
  );
const digest = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
const source = git('ls-files', '-z').split('\0').filter(Boolean).sort();
const assets = walk('dist/client').sort();
const server = walk('dist/server').sort();
const manifest = {
  schemaVersion: 1,
  commit: git('rev-parse', '--verify', 'HEAD'),
  node: process.version,
  source: Object.fromEntries(source.map((file) => [file, digest(file)])),
  frontend: Object.fromEntries(
    assets.map((file) => [relative('dist/client', file), digest(file)]),
  ),
  server: Object.fromEntries(
    server.map((file) => [relative('dist/server', file), digest(file)]),
  ),
  assurance:
    'File hashes only. No independent audit or enclave attestation is asserted.',
};
writeFileSync(
  '/tmp/tensor-safe-release-manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log('/tmp/tensor-safe-release-manifest.json');
