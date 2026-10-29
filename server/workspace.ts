import { runtimeForCode, scanOwnerCredits } from '@/lib/accrual';
import { verifySignedExtrinsic } from '@/lib/offline';
import { blake2AsHex } from '@polkadot/util-crypto';
import type { Option } from '@polkadot/types';
import type { AccountInfo } from '@polkadot/types/interfaces';
import { z } from 'zod';
import {
  accountAddress,
  accountKey,
  commandSchema,
  workspaceSchema,
  distributionSnapshot,
  idSchema,
  accountSigned,
  agreementSigned,
  type Workspace,
} from '@/lib/domain';
import {
  db,
  identity,
  body,
  failure,
  readWorkspace,
  HttpError,
  noCache,
  ORIGIN,
  auditBinding,
  seal,
  unseal,
} from '@/lib/server';
import type { Statement } from '@/server/db';
import {
  CHANGE_TTL_MS,
  canonical,
  parseChange,
  payloadHash,
  verifyWalletSignature,
  type Attestation,
} from '@/lib/auth';
import {
  connect,
  prepareProposal,
  reconcile,
  multisigCall,
  safeCalls,
  hashedRegistration,
} from '@/lib/chain';
type Command = z.infer<typeof commandSchema>;
/**
 * A money-critical change must carry the signed-in wallet's signature over
 * this exact request: origin, route, workspace, action, network and body hash,
 * with a fresh nonce and short expiry. Returns the nonce insert so replay
 * fails inside the same transaction.
 */
function assertSigned(
  command: Command & { attestation: Attestation },
  workspace: string,
  signer: string,
  network: 'finney' | 'test' | 'any',
  authorised?: string[],
): Statement {
  const { attestation, ...unsigned } = command;
  // Only the server attaches signatures to records; never accept nested ones.
  if (canonical(unsigned).includes('"attestation":'))
    throw new HttpError(400, 'Unexpected signature field');
  if (
    authorised &&
    !authorised.some((a) => accountKey(a) === accountKey(signer))
  )
    throw new HttpError(
      403,
      'Only a co-signer of this multisig can sign this change',
    );
  const c = parseChange(attestation.message);
  const now = Date.now();
  const issued = Date.parse(c?.issuedAt ?? '');
  const expires = Date.parse(c?.expiresAt ?? '');
  if (
    !c ||
    c.origin !== ORIGIN ||
    c.path !== `/api/workspaces/${workspace}` ||
    c.workspace !== workspace ||
    c.action !== command.action ||
    c.network !== network ||
    c.signer !== signer ||
    attestation.signer !== signer ||
    c.payload !== payloadHash(unsigned) ||
    !/^[0-9a-f]{32}$/.test(c.nonce) ||
    !(issued <= now + 60_000) ||
    !(expires > now) ||
    expires - issued > CHANGE_TTL_MS ||
    !verifyWalletSignature(attestation.message, attestation.signature, signer)
  )
    throw new HttpError(403, 'Wallet signature does not match this change');
  return db()
    .prepare('INSERT INTO signed_nonces(nonce,expires) VALUES(?,?)')
    .bind(c.nonce, expires);
}
// Rotating (tao_) accounts must be registered on the network before they
// receive funds or roles. Contacts are only an address book. Fails closed.
async function assertRegistered(
  w: Workspace,
  command: z.infer<typeof commandSchema>,
  raw: unknown,
) {
  const receiving = JSON.stringify(raw).match(
    /\btao_[A-Za-z0-9_-]{56}(?:[A-Za-z0-9_-]{43})?(?![A-Za-z0-9_-])/g,
  );
  if (!receiving || command.action === 'addContact') return;
  const owner =
    command.action === 'propose'
      ? command.accountId
      : command.action === 'addAgreement'
        ? command.agreement.accountId
        : command.action === 'reviseAgreement'
          ? w.agreements.find((g) => g.id === command.id)?.accountId
          : undefined;
  const network =
    command.action === 'addAccount'
      ? command.account.network
      : w.accounts.find((a) => a.id === owner)?.network;
  if (!network) throw Error('tao_ addresses are not accepted here');
  const api = await connect(network, true);
  try {
    for (const a of new Set(receiving)) {
      const state = await hashedRegistration(api, a);
      if (state === 'unsupported')
        throw Error('This network does not support tao_ addresses yet');
      if (state !== 'registered')
        throw Error(
          `${a.slice(0, 12)}… is not registered on this network yet. Ask its owner to register it, then try again.`,
        );
    }
  } finally {
    await api.disconnect();
  }
}
export async function getWorkspace(request: Request, id: string) {
  try {
    const user = await identity(request);
    idSchema.parse(id);
    const workspace = await readWorkspace(id, user.userId);
    const [audit, members] = await Promise.all([
      db()
        .prepare(
          'SELECT id,actor,action,version,created_at,details FROM audit WHERE workspace_id=? ORDER BY version DESC LIMIT 200',
        )
        .bind(id)
        .all<{
          id: string;
          actor: string;
          action: string;
          version: number;
          details: string;
        }>(),
      db()
        .prepare('SELECT user_id,role FROM members WHERE workspace_id=?')
        .bind(id)
        .all(),
    ]);
    return Response.json(
      {
        workspace,
        audit: audit.results.map(({ id: row, ...e }) => ({
          ...e,
          details: unseal(
            e.details,
            auditBinding(id, row, e.version, e.actor, e.action),
          ),
        })),
        members: members.results,
      },
      { headers: noCache },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function updateWorkspace(request: Request, id: string) {
  let api;
  try {
    const user = await identity(request);
    idSchema.parse(id);
    const raw = await body(request);
    const { version, command } = z
      .object({ version: z.number().int().min(0), command: commandSchema })
      .strict()
      .parse(raw);
    const w = await readWorkspace(id, user.userId);
    if (w.role === 'viewer')
      throw new HttpError(403, 'Read-only workspace access');
    if (w.version !== version)
      throw new HttpError(
        409,
        'Workspace changed. Refresh before trying again',
      );
    await assertRegistered(w, command, raw);
    const mutation = crypto.randomUUID();
    let evidence: string | undefined;
    const statements: Statement[] = [];
    const signing = { id, accounts: w.accounts, origin: ORIGIN };
    // Cap tables hang off a funding account whose own signature must verify.
    const verifiedFunding = (accountId: string) => {
      const account = w.accounts.find((a) => a.id === accountId);
      if (!account || !accountSigned(signing, account))
        throw new HttpError(403, 'Funding account is not wallet-signed');
      return {
        network: account.network,
        signers: account.signers.map((s) => s.address),
      };
    };
    switch (command.action) {
      case 'addAccount':
        statements.push(
          assertSigned(
            command,
            id,
            user.userId,
            command.account.network,
            command.account.signers.map((s) => s.address),
          ),
        );
        if (w.accounts.length >= 50) throw Error('Account limit reached');
        if (
          w.accounts.some(
            (a) =>
              a.id === command.account.id ||
              (a.network === command.account.network &&
                accountAddress(a) === accountAddress(command.account)),
          )
        )
          throw Error('Account already exists');
        // Never record a safe address that this network cannot yet operate.
        if (command.account.mode === 'safe') {
          api = await connect(command.account.network, true);
          safeCalls(api);
        }
        w.accounts.push({
          ...command.account,
          attestation: command.attestation,
        });
        break;
      case 'addContact':
        statements.push(assertSigned(command, id, user.userId, 'any'));
        if (w.contacts.length >= 500) throw Error('Contact limit reached');
        if (
          w.contacts.some(
            (c) =>
              accountKey(c.address) === accountKey(command.contact.address),
          )
        )
          throw Error('Address already exists');
        w.contacts.push({
          ...command.contact,
          attestation: command.attestation,
        });
        break;
      case 'addAgreement': {
        const funding = verifiedFunding(command.agreement.accountId);
        statements.push(
          assertSigned(
            command,
            id,
            user.userId,
            funding.network,
            funding.signers,
          ),
        );
        if (w.agreements.some((a) => a.id === command.agreement.id))
          throw Error('Agreement already exists');
        if (
          command.agreement.revisions.length !== 1 ||
          command.agreement.revisions[0].effectiveBlock !==
            command.agreement.startBlock + 1
        )
          throw Error('Initial ownership must start at the opening interval');
        w.agreements.push({
          ...command.agreement,
          attestation: command.attestation,
        });
        break;
      }
      case 'reviseAgreement': {
        const a = w.agreements.find((a) => a.id === command.id);
        if (!a) throw Error('Unknown agreement');
        const funding = verifiedFunding(a.accountId);
        statements.push(
          assertSigned(
            command,
            id,
            user.userId,
            funding.network,
            funding.signers,
          ),
        );
        const last = Math.max(
          a.startBlock,
          a.accrual?.toBlock ?? 0,
          ...w.distributions
            .filter((d) => d.agreementId === a.id)
            .map((d) => d.toBlock),
          ...a.revisions.map((r) => r.effectiveBlock),
        );
        if (command.revision.effectiveBlock <= last)
          throw Error(
            'Revision must follow every reserved interval and existing revision',
          );
        a.revisions.push({
          ...command.revision,
          attestation: command.attestation,
        });
        break;
      }
      case 'accrue': {
        const a = w.agreements.find((a) => a.id === command.agreementId);
        if (!a) throw Error('Unknown agreement');
        const last = w.distributions
          .filter((d) => d.agreementId === a.id)
          .reduce((v, d) => Math.max(v, d.toBlock), a.startBlock);
        const from = a.accrual?.toBlock ?? last;
        if (
          a.revisions.some(
            (r) =>
              r.effectiveBlock > last + 1 &&
              r.effectiveBlock <= command.toBlock,
          )
        )
          throw Error(
            'Settle accrual at the ownership revision boundary first',
          );
        const account = w.accounts.find((a0) => a0.id === a.accountId)!;
        api = await connect(account.network, true);
        const observed = await scanOwnerCredits(
          api,
          accountAddress(account),
          a,
          from,
          command.toBlock,
        );
        if (a.accrual && a.accrual.codeHash !== observed.codeHash)
          throw Error('Runtime changed across accrual checkpoints');
        a.accrual = {
          ...observed,
          fromBlock: last,
          amount: (
            BigInt(a.accrual?.amount ?? '0') + BigInt(observed.amount)
          ).toString(),
          locked: observed.locked || (a.accrual?.locked ?? false),
        };
        break;
      }
      case 'distributeAccrued':
      case 'distribute': {
        if (
          w.proposals.some((p) => p.id === command.id) ||
          w.distributions.some((d) => d.id === command.id)
        )
          throw Error('Distribution ID already exists');
        const a = w.agreements.find((a) => a.id === command.agreementId);
        if (!a) throw Error('Unknown agreement');
        // Payout recipients come from the cap table: it must verify here too.
        if (!agreementSigned(signing, a))
          throw new HttpError(
            403,
            'Cap table is not wallet-signed by a co-signer',
          );
        const accrued =
          command.action === 'distributeAccrued' ? a.accrual : undefined;
        if (command.action === 'distributeAccrued' && !accrued)
          throw Error('Sync finalized archive credits first');
        const toBlock =
          command.action === 'distribute' ? command.toBlock : accrued!.toBlock;
        const amount =
          command.action === 'distribute' ? command.amount : accrued!.amount;
        const source =
          command.action === 'distribute'
            ? command.source
            : `Runtime ${runtimeForCode(accrued!.codeHash)} archive reconstruction; code ${accrued!.codeHash}; end ${accrued!.blockHash}; auto-lock ${accrued!.locked}`;
        const account = w.accounts.find((v) => v.id === a.accountId)!;
        api = await connect(account.network, true);
        const finalized = await api.rpc.chain.getHeader(
          await api.rpc.chain.getFinalizedHead(),
        );
        if (toBlock > finalized.number.toNumber())
          throw Error('Interval must end at a finalized block');
        const d = distributionSnapshot(
          a,
          w.distributions,
          command.id,
          toBlock,
          amount,
          source,
        );
        if (accrued) d.provenance = 'finalized';
        const operations = d.allocations
          .filter((v) => BigInt(v.amount) > 0n)
          .map((v) => ({
            kind: 'alpha' as const,
            to: v.address,
            amount: v.amount,
            hotkey: a.hotkey,
            netuid: a.netuid,
          }));
        const p = await prepareProposal(
          api,
          account,
          d.id,
          `${a.name} distribution`,
          operations,
        );
        p.distributionId = d.id;
        delete a.accrual;
        w.distributions.push(d);
        w.proposals.push(p);
        break;
      }
      case 'importProposal': {
        const account = w.accounts.find((a) => a.id === command.accountId);
        if (!account) throw Error('Unknown account');
        if (w.proposals.some((p) => p.id === command.id))
          throw Error('Proposal ID already exists');
        api = await connect(account.network, true);
        const call = api.registry.createType('Call', command.callHex);
        const callHash = blake2AsHex(call.toU8a());
        if (
          w.proposals.some(
            (p) =>
              p.accountId === account.id &&
              p.callHash === callHash &&
              p.status === 'proposed',
          )
        )
          throw Error('This call is already in the workspace');
        const pending = (await api.query.multisig.multisigs(
          accountAddress(account),
          callHash,
        )) as Option<never>;
        if (pending.isNone)
          throw Error('No pending on-chain multisig matches this preimage');
        w.proposals.push({
          id: command.id,
          accountId: account.id,
          title: command.title,
          external: true,
          operations: [{ kind: 'custom', callHex: call.toHex() }],
          callHex: call.toHex(),
          callHash,
          genesisHash: api.genesisHash.toHex(),
          specVersion: api.runtimeVersion.specVersion.toNumber(),
          createdAt: new Date().toISOString(),
          status: 'proposed',
        });
        break;
      }
      case 'propose': {
        const account = w.accounts.find((a) => a.id === command.accountId);
        if (!account) throw Error('Unknown account');
        if (w.proposals.some((p) => p.id === command.id))
          throw Error('Proposal already exists');
        api = await connect(account.network, true);
        w.proposals.push(
          await prepareProposal(
            api,
            account,
            command.id,
            command.title,
            command.operations,
          ),
        );
        break;
      }
      case 'rebuild': {
        const old = w.proposals.find((p) => p.id === command.id);
        if (
          !old ||
          !['cancelled', 'failed'].includes(old.status) ||
          old.attempt
        )
          throw Error(
            'Only a reconciled cancelled or failed proposal can be rebuilt',
          );
        if (
          w.proposals.some(
            (p) =>
              p.distributionId === old.distributionId &&
              old.distributionId &&
              p.status === 'proposed',
          )
        )
          throw Error('Distribution already has an active proposal');
        const account = w.accounts.find((a) => a.id === old.accountId)!;
        api = await connect(account.network, true);
        const p = await prepareProposal(
          api,
          account,
          crypto.randomUUID(),
          old.title,
          old.operations,
        );
        p.distributionId = old.distributionId;
        const d = w.distributions.find((d) => d.id === old.distributionId);
        if (d) {
          if (d.status === 'paid') throw Error('Distribution already paid');
          d.proposalId = p.id;
        }
        w.proposals.push(p);
        break;
      }
      case 'recoverAttempt': {
        const p = w.proposals.find((p) => p.id === command.id);
        if (!p?.attempt) throw Error('No unresolved attempt');
        const account = w.accounts.find((a) => a.id === p.accountId)!;
        api = await connect(account.network, true);
        const hash = await api.rpc.chain.getFinalizedHead();
        const at = await api.at(hash);
        const [head, state] = await Promise.all([
          api.rpc.chain.getHeader(hash),
          at.query.system.account(p.attempt.signer),
        ]);
        if (head.number.toNumber() <= p.attempt.expires)
          throw Error(
            'Wait until the signing era has finalized before recovery',
          );
        if (
          BigInt((state as AccountInfo).nonce.toString()) >
          BigInt(p.attempt.nonce)
        )
          throw Error(
            'Signer nonce was consumed. Find and reconcile the included transaction before retrying',
          );
        delete p.attempt;
        break;
      }
      case 'recordAttempt': {
        const p = w.proposals.find((p) => p.id === command.id);
        if (!p || p.status !== 'proposed')
          throw Error('Proposal is not available for signing');
        if (p.attempt)
          throw Error(
            'A signing attempt is unresolved. Reconcile it before signing again',
          );
        const account = w.accounts.find((a) => a.id === p.accountId)!;
        api = await connect(account.network, true);
        const tx = api.tx(command.signedHex);
        const verified = await verifySignedExtrinsic(api, tx);
        const expected = await multisigCall(
          api,
          account,
          p,
          tx.signer.toString(),
          ['cancelAsMulti', 'cancelAsMultiSafe'].includes(tx.method.method),
        );
        if (tx.method.toHex() !== expected.method.toHex())
          throw Error('Signed call differs from current multisig action');
        p.attempt = {
          hash: tx.hash.toHex(),
          signer: tx.signer.toString(),
          expires: verified.expires,
          nonce: verified.nonce,
        };
        break;
      }
      case 'reconcile': {
        const p = w.proposals.find((p) => p.id === command.id);
        if (!p) throw Error('Unknown proposal');
        if (p.status === 'finalized')
          return Response.json({ workspace: w }, { headers: noCache });
        const account = w.accounts.find((a) => a.id === p.accountId)!;
        api = await connect(account.network, true);
        const result = await reconcile(
          api,
          account,
          p,
          command.blockHash,
          command.extrinsicHash,
        );
        if (result.outcome === 'executed') {
          evidence = result.evidence;
          p.status = 'finalized';
          p.evidence = evidence;
          const d = w.distributions.find((d) => d.proposalId === p.id);
          if (d) {
            d.status = 'paid';
            d.evidence = evidence;
          }
        }
        if (result.outcome === 'cancelled' || result.outcome === 'failed')
          p.status = result.outcome;
        delete p.attempt;
        break;
      }
      case 'addMember':
      case 'removeMember':
        if (w.role !== 'owner')
          throw new HttpError(403, 'Only the workspace owner manages members');
        if (command.userId === user.userId)
          throw Error('Owner membership is implicit');
        if (command.action === 'addMember')
          statements.push(
            db()
              .prepare(
                'INSERT INTO members(workspace_id,user_id,role) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=? AND mutation=?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role',
              )
              .bind(id, command.userId, command.role, id, mutation),
          );
        else
          statements.push(
            db()
              .prepare(
                'DELETE FROM members WHERE workspace_id=? AND user_id=? AND EXISTS(SELECT 1 FROM workspaces WHERE id=? AND mutation=?)',
              )
              .bind(id, command.userId, id, mutation),
          );
        break;
    }
    workspaceSchema.parse(w);
    const { id: _, name: __, version: ___, role: ____, ...state } = w;
    const serialized = JSON.stringify(state);
    if (serialized.length > 2000000)
      throw Error(
        'Workspace storage limit reached. Export and create another workspace',
      );
    const update = db()
      .prepare(
        'UPDATE workspaces SET state=?,version=version+1,mutation=? WHERE id=? AND version=?',
      )
      .bind(seal(serialized, `${id}:state`), mutation, id, version);
    if (evidence)
      statements.push(
        db()
          .prepare(
            'INSERT INTO settlements(evidence,workspace_id,proposal_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=? AND mutation=?)',
          )
          .bind(evidence, id, (command as { id: string }).id, id, mutation),
      );
    statements.push(
      db()
        .prepare(
          'INSERT INTO audit(id,workspace_id,actor,action,version,created_at,details) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=? AND mutation=?)',
        )
        .bind(
          mutation,
          id,
          user.userId,
          command.action,
          version + 1,
          new Date().toISOString(),
          seal(
            JSON.stringify(command),
            auditBinding(
              id,
              mutation,
              version + 1,
              user.userId,
              command.action,
            ),
          ),
          id,
          mutation,
        ),
    );
    const results = await db().batch([update, ...statements]);
    if (results[0].meta.changes !== 1)
      throw new HttpError(
        409,
        'Workspace changed. Refresh before trying again',
      );
    return Response.json(
      { workspace: { ...w, version: version + 1 } },
      { headers: noCache },
    );
  } catch (e) {
    return failure(e);
  } finally {
    await api?.disconnect();
  }
}
