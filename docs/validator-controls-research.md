# Validator control verification

Primary implementation: https://github.com/opentensor/subtensor/tree/14cde6410fe8ec81a940e290c56f94a632a0988d/pallets/subtensor/src . Live runtime455 metadata was checked; the executable check is tests/controls.integration.ts.

- Administration calls use coldkey origin. The multisig account must own the hotkey; a connected member owning it is insufficient.
- `setIdentity(name,url,githubRepo,image,discord,description,additional)` changes the coldkey's public identity, replacing all seven fields. UTF-8 limits:256/256/256/1024/256/1024/1024. At least one owned hotkey must be registered somewhere. It has no hotkey argument.
- `increaseTake(hotkey,take)` / `decreaseTake(hotkey,take)` encode PerU16, denominator65535. Bounds are current minDelegateTake/maxDelegateTake. Increase must exceed current take and satisfy cooldown; decrease must be lower. Live reviewed max11796, cooldown216000 blocks. Read current values, not hardcoded UI defaults.
- `setChildren(hotkey,netuid,[(u64,child)])` replaces the whole allocation list. Max5; sum<=u64MAX; no duplicate/self child. Parent ownership, stake threshold/owner-hotkey exemption and parent-child consistency are runtime-enforced. Empty list revokes all.
- `childKeys(parent,netuid)` is active; `pendingChildKeys(netuid,parent)` is pending list plus cooldown block. The order differs. With subnet tokens enabled, changes are scheduled. Eligibility is not guaranteed activation: changed relationships can cause later failure. Recheck active storage rather than labeling a scheduled event active.
- `setChildkeyTake(hotkey,netuid,take)` changes raw child take. Effective take is max(raw,global minimum,subnet minimum). Maximum and cooldown are separate from delegate take. Event omits netuid, so exact extrinsic arguments are required for reconciliation.

Existing child proportions are preserved as exact u64 decimal strings. Edited percentage inputs have at most four decimal places and round down to the native proportion. The full replacement is reviewed before an approval request is saved.
