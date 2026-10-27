import assert from 'node:assert/strict';
import { connect } from '../lib/chain';
import {
  metadataProof,
  proofHash,
  verifySignedExtrinsic,
  verifyOfflineSignature,
} from '../lib/offline';
import { Keyring } from '@polkadot/keyring';
import {
  blake2AsU8a,
  cryptoWaitReady,
  decodeAddress,
  sr25519Verify,
} from '@polkadot/util-crypto';
import { u8aConcat } from '@polkadot/util';
async function main() {
  await cryptoWaitReady();
  const api = await connect('finney', true);
  try {
    const pair = new Keyring({ type: 'sr25519' }).addFromSeed(
      new Uint8Array(32).fill(9),
    );
    const tree = await metadataProof(api),
      digest = proofHash(tree);
    const header = await api.rpc.chain.getHeader();
    const height = header.number.toNumber();
    const era = api.registry.createType('ExtrinsicEra', {
      current: height,
      period: 128,
    });
    const birth = era.asMortalEra.birth(height);
    const blockHash = await api.rpc.chain.getBlockHash(birth);
    const tx = api.tx.system.remark('0x' + '07'.repeat(500));
    const nonce = await api.rpc.system.accountNextIndex(pair.address);
    const fields = {
      method: tx.method.toHex(),
      era,
      nonce,
      tip: 0,
      blockHash,
      genesisHash: api.genesisHash,
      specVersion: api.runtimeVersion.specVersion,
      transactionVersion: api.runtimeVersion.transactionVersion,
      mode: 1,
      metadataHash: digest,
    };
    const payload = api.registry.createType('ExtrinsicPayload', fields, {
      version: 4,
    });
    const bare = payload.toU8a({ method: true });
    const signing = bare.length > 256 ? blake2AsU8a(bare) : bare;
    const raw = pair.sign(signing);
    const typed = u8aConcat(new Uint8Array([1]), raw);
    tx.addSignature(pair.address, typed, fields);
    const decoded = api.tx(tx.toHex());
    const sig = (
      decoded.inner as unknown as {
        signature: {
          multiSignature: { type: string; toU8a: () => Uint8Array };
        };
      }
    ).signature.multiSignature;
    assert.equal(decoded.mode.toNumber(), 1);
    assert.equal(sig.type, 'Sr25519');
    assert.equal(sig.toU8a().length, 65);
    assert.equal(decoded.signature.toU8a().length, 64);
    const reconstructed = api.registry.createType(
      'ExtrinsicPayload',
      {
        method: decoded.method.toHex(),
        era: decoded.era,
        nonce: decoded.nonce,
        tip: decoded.tip,
        blockHash: await api.rpc.chain.getBlockHash(
          decoded.era.asMortalEra.birth(height),
        ),
        genesisHash: api.genesisHash,
        specVersion: api.runtimeVersion.specVersion,
        transactionVersion: api.runtimeVersion.transactionVersion,
        mode: decoded.mode,
        metadataHash: digest,
      },
      { version: decoded.type },
    );
    assert.deepEqual(reconstructed.toU8a({ method: true }), bare);
    assert(
      sr25519Verify(
        signing,
        decoded.signature.toU8a(),
        decodeAddress(decoded.signer.toString()),
      ),
    );
    let rawAttachmentAccepted = false;
    try {
      api
        .tx(api.registry.createType('Call', tx.method.toHex()))
        .addSignature(pair.address, raw, fields);
      rawAttachmentAccepted = true;
    } catch {}
    console.log(
      JSON.stringify({
        type: decoded.type,
        mode: decoded.mode.toString(),
        typedType: sig.type,
        typedBytes: sig.toU8a().length,
        rawBytes: decoded.signature.toU8a().length,
        metadataHash: decoded.metadataHash?.toHex(),
        birth,
        rawAttachmentAccepted,
        signingBytes: bare.length,
      }),
    );
    await verifySignedExtrinsic(api, decoded);
    assert.equal(
      verifyOfflineSignature(
        bare,
        '0x' + Buffer.from(raw).toString('hex'),
        pair.address,
      ),
      '0x' + Buffer.from(typed).toString('hex'),
    );
    const wrong = typed.slice();
    wrong[3] ^= 1;
    const bad = api.tx(api.registry.createType('Call', tx.method.toHex()));
    bad.addSignature(pair.address, wrong, fields);
    await assert.rejects(() => verifySignedExtrinsic(api, bad));
    console.log(
      'PASS server signature verification, tamper rejection, offline typed normalization, local test-key sign + serialized extrinsic payload reconstruction + strict signature verification. No broadcast.',
    );
  } finally {
    await api.disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
