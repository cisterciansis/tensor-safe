import assert from 'node:assert/strict';
import { encodeAddress } from '@polkadot/util-crypto';
import { controls, type ControlAction } from '../lib/controls';
import { operationSchema } from '../lib/domain';
import { callFor, connect } from '../lib/chain';
const hotkey = encodeAddress(new Uint8Array(32).fill(3), 42);
const api = await connect('finney', true);
try {
  for (const [name, config] of Object.entries(controls)) {
    const args = config.fields.map((field) =>
      field === 'Subnet ID'
        ? '1'
        : field.includes('hotkey')
          ? hotkey
          : field.includes('Commission')
            ? '1000'
            : '0xprofile',
    );
    if (
      name === 'perpetual' ||
      name === 'autoLock' ||
      name === 'transfers' ||
      name === 'commitReveal'
    )
      (args as (string | boolean)[])[1] = false;
    if (name === 'lock') args[2] = '1000000000';
    if (name === 'tempo') args[1] = '360';
    if (
      name === 'immunity' ||
      name === 'minWeights' ||
      name === 'weightsVersion'
    )
      args[1] = '1';
    if (name === 'activity') args[1] = '1000';
    const operation = operationSchema.parse({
      kind: 'control',
      action: name as ControlAction,
      args,
    });
    const tx = callFor(api, operation);
    assert.equal(tx.method.section, config.section);
    assert.equal(tx.method.method, config.method);
    assert.equal(tx.method.args.length, config.fields.length);
    assert.equal(
      api.registry.createType('Call', tx.method.toHex()).toHex(),
      tx.method.toHex(),
    );
    if (name === 'subnetIdentity' || name === 'validatorIdentity') {
      const offset = name === 'subnetIdentity' ? 1 : 0;
      assert.equal(
        Buffer.from(tx.method.args[offset].toU8a(true)).toString('utf8'),
        '0xprofile',
      );
    }
  }
  const child = callFor(
    api,
    operationSchema.parse({
      kind: 'children',
      hotkey,
      netuid: '1',
      children: [],
    }),
  );
  assert.equal(child.method.method, 'setChildren');
  console.log(
    `PASS all guided controls against live runtime ${api.runtimeVersion.specVersion.toString()}, exact identity bytes and child revocation encoding; no broadcast`,
  );
} finally {
  await api.disconnect();
}
