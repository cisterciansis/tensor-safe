import type { Option, Bytes } from '@polkadot/types';
import type { SignerPayloadJSON } from '@polkadot/types/types';
import { merkleizeMetadata } from '@polkadot-api/merkleize-metadata';
import { hexToU8a, u8aConcat, u8aToHex } from '@polkadot/util';
import {
  sr25519Verify,
  ed25519Verify,
  decodeAddress,
  blake2AsU8a,
} from '@polkadot/util-crypto';
import type { Chain } from './chain';
export async function metadataProof(api: Chain) {
  const opaque = await api.call.metadata.metadataAtVersion(15);
  const bytes = (opaque as Option<Bytes>).unwrap().toU8a(true);
  return merkleizeMetadata(bytes, {
    decimals: api.registry.chainDecimals[0],
    tokenSymbol: api.registry.chainTokens[0],
  });
}
export function vaultPayload(
  api: Chain,
  json: SignerPayloadJSON,
  tree: Awaited<ReturnType<typeof metadataProof>>,
) {
  const payload = api.registry.createType('ExtrinsicPayload', json, {
    version: json.version,
  });
  const bare = payload.toU8a({ method: true });
  const proof = tree.getProofForExtrinsicPayload(bare);
  return { qr: u8aConcat(proof, payload.toU8a()), signing: bare, payload };
}
export function verifyOfflineSignature(
  bytes: Uint8Array,
  signature: string,
  address: string,
) {
  if (!/^0x(?:[a-fA-F0-9]{128}|01[a-fA-F0-9]{128})$/.test(signature))
    throw Error(
      'Expected an sr25519 signature (64 bytes or type 01 + 64 bytes)',
    );
  const typed = hexToU8a(signature),
    raw = typed.length === 65 ? typed.slice(1) : typed;
  if (
    !sr25519Verify(
      bytes.length > 256 ? blake2AsU8a(bytes) : bytes,
      raw,
      decodeAddress(address),
    )
  )
    throw Error('Signature does not match this payload and signer');
  return u8aToHex(u8aConcat(new Uint8Array([1]), raw));
}
export async function verifySignedExtrinsic(
  api: Chain,
  tx: ReturnType<Chain['tx']>,
) {
  if (
    !tx.isSigned ||
    tx.type !== 4 ||
    tx.era.isImmortalEra ||
    tx.mode.toNumber() !== 1
  )
    throw Error('A metadata-bound mortal v4 signature is required');
  const head = await api.rpc.chain.getHeader(),
    height = head.number.toNumber(),
    era = tx.era.asMortalEra;
  if (era.period.toNumber() > 256 || height + 2 >= era.death(height))
    throw Error('Invalid or expiring signing window');
  const nonce = await api.rpc.system.accountNextIndex(tx.signer.toString());
  if (nonce.toString() !== tx.nonce.toString())
    throw Error('Signer nonce is stale');
  const tree = await metadataProof(api);
  const payload = api.registry.createType(
    'ExtrinsicPayload',
    {
      method: tx.method.toHex(),
      era: tx.era,
      nonce: tx.nonce,
      tip: tx.tip,
      blockHash: await api.rpc.chain.getBlockHash(era.birth(height)),
      genesisHash: api.genesisHash,
      specVersion: api.runtimeVersion.specVersion,
      transactionVersion: api.runtimeVersion.transactionVersion,
      mode: tx.mode,
      metadataHash: proofHash(tree),
    },
    { version: tx.type },
  );
  const bytes = payload.toU8a({ method: true }),
    message = bytes.length > 256 ? blake2AsU8a(bytes) : bytes;
  const type = (
    tx.inner as unknown as { signature: { multiSignature: { type: string } } }
  ).signature.multiSignature.type;
  const verify =
    type === 'Sr25519'
      ? sr25519Verify
      : type === 'Ed25519'
        ? ed25519Verify
        : null;
  if (
    !verify ||
    !verify(message, tx.signature.toU8a(), decodeAddress(tx.signer.toString()))
  )
    throw Error('Invalid transaction signature');
  return { expires: era.death(height), nonce: tx.nonce.toString() };
}
export async function assertFresh(api: Chain, payload: SignerPayloadJSON) {
  const [head, nonce] = await Promise.all([
    api.rpc.chain.getHeader(),
    api.rpc.system.accountNextIndex(payload.address),
  ]);
  const era = api.registry.createType('ExtrinsicEra', payload.era);
  if (era.isImmortalEra) throw Error('A mortal signing window is required');
  const anchor = Number(BigInt(payload.blockNumber));
  const death = era.asMortalEra.death(anchor);
  if (head.number.toNumber() + 2 >= death)
    throw Error('Signing window expired. Prepare a new transaction');
  if (nonce.toString() !== BigInt(payload.nonce).toString())
    throw Error('Signer nonce changed. Prepare a new transaction');
  if (
    payload.genesisHash !== api.genesisHash.toHex() ||
    BigInt(payload.specVersion) !==
      BigInt(api.runtimeVersion.specVersion.toString()) ||
    BigInt(payload.transactionVersion) !==
      BigInt(api.runtimeVersion.transactionVersion.toString())
  )
    throw Error('Network or runtime changed');
  if (
    (
      await api.rpc.chain.getBlockHash(era.asMortalEra.birth(anchor))
    ).toHex() !== payload.blockHash
  )
    throw Error('Signing checkpoint changed');
}
export const proofHash = (tree: Awaited<ReturnType<typeof metadataProof>>) =>
  u8aToHex(tree.digest());
