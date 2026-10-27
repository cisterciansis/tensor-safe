import assert from 'node:assert/strict';
import { connect, buildCall, prepareProposal } from '../lib/chain';
import { accountAddress, type Account } from '../lib/domain';
import { metadataProof, vaultPayload, proofHash } from '../lib/offline';
import { encodeAddress } from '@polkadot/util-crypto';
const api = await connect('finney', true);
try {
  const address = encodeAddress(new Uint8Array(32).fill(1), 42),
    other = encodeAddress(new Uint8Array(32).fill(2), 42);
  const account: Account = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Read-only test',
    network: 'finney',
    threshold: 2,
    signers: [
      { name: 'one', address },
      { name: 'two', address: other },
    ],
  };
  const p1 = await prepareProposal(api, account, 'one', 'test', [
    { kind: 'transfer', to: address, amount: '1' },
  ]);
  const p2 = await prepareProposal(api, account, 'two', 'test', [
    { kind: 'transfer', to: address, amount: '1' },
  ]);
  assert.notEqual(p1.callHash, p2.callHash);
  const transfer = buildCall(api, [
    { kind: 'transfer', to: address, amount: '1' },
  ]);
  assert.equal(transfer.method.method, 'transferKeepAlive');
  const batch = buildCall(api, [
    { kind: 'alpha', to: address, hotkey: other, netuid: 1, amount: '1' },
    { kind: 'alpha', to: other, hotkey: other, netuid: 1, amount: '2' },
  ]);
  assert.equal(batch.method.method, 'batchAll');
  const stake = buildCall(api, [
    {
      kind: 'stake',
      hotkey: other,
      netuid: 1,
      amount: '1',
      limitPrice: '1000000',
    },
  ]);
  const tree = await metadataProof(api);
  assert.equal(tree.digest().length, 32);
  const hash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(hash);
  const payload = api.registry
    .createType('SignerPayload', {
      address,
      blockHash: hash.toHex(),
      blockNumber: header.number.toNumber(),
      era: api.registry.createType('ExtrinsicEra', {
        current: header.number.toNumber(),
        period: 128,
      }),
      genesisHash: api.genesisHash.toHex(),
      method: transfer.method.toHex(),
      nonce: 0,
      signedExtensions: api.registry.signedExtensions,
      specVersion: api.runtimeVersion.specVersion,
      transactionVersion: api.runtimeVersion.transactionVersion,
      tip: 0,
      version: 4,
      mode: 1,
      metadataHash: proofHash(tree),
    })
    .toPayload();
  const vault = vaultPayload(api, payload, tree);
  assert(vault.qr.length > vault.signing.length);
  console.log(
    JSON.stringify(
      {
        genesis: api.genesisHash.toHex(),
        spec: api.runtimeVersion.specVersion.toString(),
        multisig: accountAddress(account),
        transfer: transfer.method.toHuman(),
        stake: stake.method.toHuman(),
        proofBytes: vault.qr.length,
        signedExtensions: api.registry.signedExtensions,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS live mainnet metadata call encoding and proof payload construction; no transaction signed or broadcast',
  );
} finally {
  await api.disconnect();
}
