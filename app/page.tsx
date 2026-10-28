'use client';
import { ValidatorChildren } from './validator-children';
import { AccountControls } from './account-controls';
import { Tau } from '@/components/tau';
import { Choice } from '@/lib/choices';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Atom,
  BookUser,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  FileText,
  House,
  PieChart,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import Forms, { type FormKind } from './forms';
import Signing, { download } from './signing';
import { AccountChain, NativeCrowdloan } from './chain-view';
import {
  accountAddress,
  accountKey,
  agreementSigned,
  holderStatement,
  accountSigned,
  contactSigned,
  type Agreement,
  formatUnits,
  responseSchema,
  type Account,
  type Workspace,
  type Proposal,
} from '@/lib/domain';
import { SCHEMES } from '@/lib/wallets';
import { Copyable, short } from '@/components/copyable';
import { WalletMenu } from './wallets';
import { SignIn } from './sign-in';
const navigation = [
  ['Home', House],
  ['Accounts', Wallet],
  ['Transactions', ArrowLeftRight],
  ['Operate', SlidersHorizontal],
  ['Ownership', PieChart],
  ['Contacts', BookUser],
] as const;
const subtitles: Record<string, string> = {
  Home: 'Your shared Bittensor treasury.',
  Accounts: 'Multisig accounts your team controls together.',
  Transactions: 'Propose, approve and track every change.',
  Operate: 'Change subnet and validator settings, with approvals.',
  Ownership: 'Who owns what, and what they are paid.',
  Contacts: 'Addresses your team trusts.',
  Settings: 'Access, security and a record of every change.',
};
// First segment of each segmented view.
const segments: Record<string, string> = {
  Transactions: 'queue',
  Operate: 'subnet',
  Ownership: 'cap',
  Settings: 'workspace',
};
const actions: Record<string, [string, FormKind]> = {
  Accounts: ['New account', 'account'],
  Transactions: ['New transaction', 'transaction'],
  'Ownership:cap': ['New agreement', 'agreement'],
  'Ownership:payouts': ['New payout', 'distribution'],
  Contacts: ['Add contact', 'contact'],
  Settings: ['New workspace', 'workspace'],
};
const quantumSafe = (a: Account) => a.mode === 'safe';
const schemeLabel = ({ scheme, rotating }: Account['signers'][number]) =>
  scheme && SCHEMES[scheme].label + (rotating ? ' · rotating' : '');
// 'addAgreement' → 'Add agreement'
const humanize = (action: string) =>
  action
    .replace(/[A-Z]/g, (c) => ' ' + c.toLowerCase())
    .replace(/^./, (c) => c.toUpperCase());
async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = responseSchema.parse(await response.json());
  if (!response.ok)
    throw Object.assign(
      Error(
        result.error + (result.details ? ': ' + result.details.join('; ') : ''),
      ),
      { status: response.status },
    );
  return result;
}
export default function Home() {
  const [view, setView] = useState('Home'),
    [tab, setTab] = useState(''),
    [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [user, setUser] = useState<{ id: string; name: string } | null>(null),
    [signedOut, setSignedOut] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [form, setForm] = useState<{ kind: FormKind; selected?: string } | null>(
      null,
    ),
    [active, setActive] = useState<string>(),
    [signing, setSigning] = useState<Proposal | null>(null),
    [receive, setReceive] = useState(false),
    [balances, setBalances] = useState<Record<string, string>>({}),
    [audit, setAudit] = useState<
      NonNullable<ReturnType<typeof responseSchema.parse>['audit']>
    >([]),
    [members, setMembers] = useState<
      NonNullable<ReturnType<typeof responseSchema.parse>['members']>
    >([]),
    [notice, setNotice] = useState(''),
    [search, setSearch] = useState('');
  const current = useRef<Workspace | null>(null);
  const apply = useCallback((w: Workspace) => {
    current.current = w;
    setWorkspace(w);
  }, []);
  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const result = await request(`/api/workspaces/${id}`);
        apply(result.workspace!);
        setAudit(result.audit ?? []);
        setMembers(result.members ?? []);
        setError('');
      } catch (e) {
        if ((e as { status?: number }).status === 401) setSignedOut(true);
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [apply],
  );
  useEffect(() => {
    let alive = true;
    request('/api/workspaces')
      .then(async (r) => {
        if (!alive) return;
        setWorkspaces(r.workspaces ?? []);
        setUser(r.user ?? null);
        if (r.workspaces?.[0]) await load(r.workspaces[0].id);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.status === 401) setSignedOut(true);
        setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function command(value: unknown) {
    const w = current.current;
    if (!w) throw Error('Create a workspace first');
    const result = await request(`/api/workspaces/${w.id}`, {
      version: w.version,
      command: value,
    });
    apply(result.workspace!);
    return result;
  }
  async function save(value: unknown) {
    if (form?.kind === 'workspace') {
      const r = await request('/api/workspaces', value);
      const list = await request('/api/workspaces');
      setWorkspaces(list.workspaces ?? []);
      await load(r.id!);
    } else {
      const result = await command(value);
      setNotice('Saved to the workspace audit trail.');
      if (current.current) await load(current.current.id);
      return result;
    }
  }
  function open(kind: FormKind, selected?: string) {
    if (!workspace && kind !== 'workspace') {
      setForm({ kind: 'workspace' });
      return;
    }
    setForm({ kind, selected });
  }
  const accounts = workspace?.accounts ?? [],
    proposals = workspace?.proposals ?? [],
    agreements = workspace?.agreements ?? [],
    distributions = workspace?.distributions ?? [];
  const account = accounts.find((a) => a.id === active),
    pending = proposals.filter((p) => p.status === 'proposed'),
    total = accounts
      .filter((a) => a.network === 'finney')
      .reduce((s, a) => s + BigInt(balances[a.id] ?? '0'), 0n)
      .toString(),
    observed = Object.keys(balances).length;
  const editable = workspace?.role !== 'viewer';
  // Re-check stored records against their wallet signatures in this browser.
  const verifier = workspace && {
    id: workspace.id,
    accounts,
    origin: location.origin,
  };
  const signedAccount = (a: Account) =>
    !!verifier && accountSigned(verifier, a);
  const signedAgreement = (a: Agreement) =>
    !!verifier && agreementSigned(verifier, a);
  const segment = tab || segments[view];
  const title = account
    ? account.name
    : view === 'Home'
      ? (workspace?.name ?? 'Welcome')
      : view;
  const primary = account
    ? undefined
    : (actions[view] ?? actions[`${view}:${segment}`]);
  function navigate(name: string) {
    setView(name);
    setTab('');
    setActive(undefined);
    setSearch('');
    window.scrollTo(0, 0);
  }
  function show(id: string) {
    setActive(id);
    setView('Accounts');
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const ctx = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      ctx.registerTool(
        {
          name: 'inspect_treasury_workspace',
          description:
            'Read the current workspace accounts, proposal statuses and distribution intervals.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute(input: unknown) {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).length
            )
              throw Error('Expected an empty object');
            const w = current.current;
            return w
              ? {
                  name: w.name,
                  accounts: w.accounts,
                  proposals: w.proposals,
                  distributions: w.distributions,
                }
              : { workspace: null };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  function renderAccounts() {
    return accounts.length ? (
      <div className="list">
        {accounts
          .filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
          .map((a) => (
            <button
              key={a.id}
              className="account-card"
              onClick={() => show(a.id)}
            >
              <span className="account-avatar">
                {a.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-card-main">
                <strong>
                  {a.name}
                  {quantumSafe(a) && <QuantumBadge />}
                </strong>
                <small>
                  {a.threshold} of {a.signers.length} ·{' '}
                  {a.network === 'test' ? 'Testnet' : 'Mainnet'} ·{' '}
                  <code>{short(accountAddress(a))}</code>
                </small>
              </span>
              {balances[a.id] && (
                <strong className="account-amount">
                  {formatUnits(balances[a.id])} <Tau />
                </strong>
              )}
              <ChevronRight size={18} className="chevron" />
            </button>
          ))}
      </div>
    ) : (
      <Empty
        icon={Wallet}
        title="Start with a shared account"
        text="Create a multisig with your co-signers, or add one you already use."
        action="Add account"
        onAction={() => open('account')}
      />
    );
  }
  function renderProposals(items: Proposal[] = pending) {
    return items.length ? (
      <div className="list">
        {items
          .filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
          .map((p) => (
            <div className="proposal-row" key={p.id}>
              <div
                className={`transaction-icon ${p.status === 'finalized' ? 'done' : ''}`}
              >
                {p.status === 'finalized' ? (
                  <Check size={18} />
                ) : (
                  <ArrowUpRight size={18} />
                )}
              </div>
              <div className="proposal-main">
                <strong>{p.title}</strong>
                <div className="proposal-meta">
                  <span
                    className={`status ${
                      p.status === 'finalized'
                        ? 'success'
                        : p.status === 'failed'
                          ? 'danger'
                          : p.status === 'cancelled'
                            ? 'neutral'
                            : ''
                    }`}
                  >
                    {p.status === 'finalized'
                      ? 'Executed'
                      : p.attempt
                        ? 'To reconcile'
                        : p.status === 'cancelled'
                          ? 'Cancelled'
                          : p.status === 'failed'
                            ? 'Failed'
                            : 'Needs approvals'}
                  </span>
                  <small>
                    {accounts.find((a) => a.id === p.accountId)?.name} ·{' '}
                    {p.operations.length} action
                    {p.operations.length !== 1 ? 's' : ''}
                  </small>
                </div>
              </div>
              <div className="row-actions">
                <button
                  className="button outline"
                  onClick={() => setSigning(p)}
                >
                  Review
                </button>
                <button
                  className="icon-button"
                  aria-label="Reconcile transaction"
                  title="Reconcile finalized transaction"
                  onClick={() => open('reconcile', p.id)}
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Export proposal"
                  title="Export proposal"
                  onClick={() => download(`${p.id}.json`, p)}
                >
                  <Download size={16} />
                </button>
              </div>
            </div>
          ))}
      </div>
    ) : (
      <Empty
        icon={ShieldCheck}
        title="All caught up"
        text="Requests that need approval from your signers show up here."
      />
    );
  }
  if (signedOut) return <SignIn onSignedIn={() => location.reload()} />;
  return (
    <SidebarProvider>
      <Sidebar className="treasury-sidebar">
        <SidebarHeader>
          <a className="brand" href="/">
            <span className="brand-mark">
              <Tau />
            </span>
            <span>
              Tensor<span className="brand-light"> Safe</span>
            </span>
            <span className="beta">Lab</span>
          </a>
          <div className="workspace-picker">
            <span className="workspace-icon">
              {workspace?.name[0]?.toUpperCase() ?? 'T'}
            </span>
            <Choice
              aria-label="Select workspace"
              value={workspace?.id ?? ''}
              onChange={(e) =>
                e.target.value === 'new'
                  ? open('workspace')
                  : void load(e.target.value)
              }
            >
              <option value="" disabled>
                My workspace
              </option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              <option value="new">+ Create workspace</option>
            </Choice>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {navigation.map(([title, Icon]) => (
              <NavItem
                key={title}
                active={view === title && !(title === 'Accounts' && active)}
                onClick={() => navigate(title)}
              >
                <Icon size={18} />
                <span>{title}</span>
                {title === 'Transactions' && pending.length > 0 && (
                  <span className="nav-count">{pending.length}</span>
                )}
              </NavItem>
            ))}
          </SidebarMenu>
          <div className="nav-caption account-caption">
            Accounts
            <button aria-label="Add account" onClick={() => open('account')}>
              <Plus size={16} />
            </button>
          </div>
          {accounts.length ? (
            <SidebarMenu>
              {accounts.map((a) => (
                <NavItem
                  key={a.id}
                  active={active === a.id}
                  onClick={() => show(a.id)}
                >
                  <span className="mini-avatar">{a.name[0]}</span>
                  <span>{a.name}</span>
                </NavItem>
              ))}
            </SidebarMenu>
          ) : (
            <div className="sidebar-empty">Your accounts will appear here.</div>
          )}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <NavItem
              active={view === 'Settings'}
              onClick={() => navigate('Settings')}
            >
              <Settings2 size={18} />
              <span>Settings</span>
            </NavItem>
          </SidebarMenu>
          <a
            className="help-link"
            href="https://www.bittensor.com/docs"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={16} /> Bittensor docs <ExternalLink size={13} />
          </a>
          <div className="network-footer">
            <i /> Bittensor <span>Native Substrate</span>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <span className="breadcrumb">
            <SidebarTrigger className="mobile-trigger" />
            <strong className="topbar-title">{title}</strong>
          </span>
          <div className="top-actions">
            {workspace && (
              <button
                className="icon-button"
                aria-label="Refresh workspace"
                title="Refresh workspace"
                onClick={() => load(workspace.id)}
              >
                <RefreshCw size={17} className={loading ? 'spin' : ''} />
              </button>
            )}
            <WalletMenu accounts={accounts} />
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              {account && (
                <button
                  className="back-link"
                  onClick={() => setActive(undefined)}
                >
                  <ChevronLeft size={18} /> Accounts
                </button>
              )}
              <h1>{title}</h1>
              <p>
                {account ? (
                  <>
                    {account.threshold} of {account.signers.length} signers ·{' '}
                    {account.network === 'test'
                      ? 'Bittensor Testnet'
                      : 'Bittensor Mainnet'}
                    {quantumSafe(account) && <QuantumBadge />}
                  </>
                ) : (
                  subtitles[view]
                )}
              </p>
            </div>
            {editable && primary && (
              <button
                className="button primary"
                onClick={() => open(primary[1])}
              >
                <Plus size={17} />
                {primary[0]}
              </button>
            )}
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {loading && !workspace && (
            <output className="loading-line">Loading workspace…</output>
          )}
          <div className="view" key={view + (active ?? '')}>
            {view === 'Home' && (
              <>
                <section className="balance-panel">
                  <div>
                    <span className="balance-label">Total balance</span>
                    <h2>
                      {observed ? formatUnits(total) : '—'} <Tau />
                    </h2>
                    <span className="balance-caption">
                      {observed
                        ? `Mainnet · ${observed} of ${accounts.length} account(s) refreshed`
                        : 'Open an account and refresh it to see its balance.'}
                    </span>
                  </div>
                  <div className="balance-actions">
                    <button
                      className="button primary"
                      disabled={!editable}
                      onClick={() => open('transaction')}
                    >
                      <ArrowUpRight size={17} /> Send
                    </button>
                    <button
                      className="button outline"
                      onClick={() =>
                        accounts.length ? setReceive(true) : open('account')
                      }
                    >
                      <ArrowDownLeft size={17} /> Receive
                    </button>
                  </div>
                </section>
                <div className="overview-grid">
                  <Group
                    title="Needs approval"
                    count={pending.length}
                    action={
                      pending.length > 0 && (
                        <button
                          className="text-button"
                          onClick={() => navigate('Transactions')}
                        >
                          See all <ChevronRight size={15} />
                        </button>
                      )
                    }
                  >
                    {renderProposals()}
                  </Group>
                  <Group
                    title="Accounts"
                    count={accounts.length}
                    action={
                      accounts.length > 0 && (
                        <button
                          className="text-button"
                          onClick={() => navigate('Accounts')}
                        >
                          See all <ChevronRight size={15} />
                        </button>
                      )
                    }
                  >
                    {renderAccounts()}
                  </Group>
                </div>
              </>
            )}
            {view === 'Accounts' &&
              (account ? (
                <>
                  <section className="panel padded">
                    <div className="address-banner">
                      <div>
                        <span className="address-label">Account address</span>
                        <Copyable
                          value={accountAddress(account)}
                          full
                          network={account.network}
                          kind="account"
                          label="account address"
                        />
                      </div>
                      <Provenance
                        ok={signedAccount(account)}
                        signer={account.attestation?.signer}
                        you={user?.id}
                      />
                    </div>
                    {!signedAccount(account) && (
                      <div className="notice warning">
                        This account has no valid wallet signature, so its
                        signers may have been changed. Don’t fund it until a
                        co-signer re-adds it and signs.
                      </div>
                    )}
                    <div className="action-bar">
                      <button
                        className="button primary"
                        onClick={() => open('transaction', account.id)}
                        disabled={!editable}
                      >
                        <ArrowUpRight size={17} /> New transaction
                      </button>
                      <button
                        className="button outline"
                        onClick={() =>
                          download(`${account.name}.json`, account)
                        }
                      >
                        <Download size={16} /> Export
                      </button>
                    </div>
                  </section>
                  <Group
                    title="Signers"
                    action={
                      <span className="muted">
                        {account.threshold} of {account.signers.length} must
                        approve
                      </span>
                    }
                  >
                    <div className="list">
                      {account.signers.map((s) => (
                        <div key={s.address} className="signer-row">
                          <span className="account-avatar">
                            {s.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="row-main">
                            <strong>
                              {s.name}
                              {schemeLabel(s) && (
                                <span className="chip">{schemeLabel(s)}</span>
                              )}
                            </strong>
                            {s.receiving && (
                              <Copyable
                                value={s.receiving}
                                full
                                label={`${s.name}'s receiving address`}
                              />
                            )}
                            <span className={s.receiving ? 'secondary' : ''}>
                              <Copyable
                                value={s.address}
                                full
                                network={account.network}
                                kind="account"
                                label={`${s.name}'s address`}
                              />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Group>
                  <section className="panel spaced">
                    <AccountChain
                      key={account.id}
                      account={account}
                      onBalance={(amount) =>
                        setBalances((v) => ({ ...v, [account.id]: amount }))
                      }
                      onPropose={() => open('transaction', account.id)}
                    />
                  </section>
                </>
              ) : (
                <section className="panel">
                  <div className="panel-title">
                    <h3>
                      All accounts{' '}
                      <span className="count">{accounts.length}</span>
                    </h3>
                    {accounts.length > 0 && (
                      <input
                        className="search-input"
                        type="search"
                        aria-label="Search accounts"
                        placeholder="Search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    )}
                  </div>
                  {renderAccounts()}
                </section>
              ))}
            {view === 'Transactions' && (
              <Tabs value={segment} onValueChange={(v) => setTab(String(v))}>
                <div className="tab-toolbar">
                  <Segments
                    items={[
                      [
                        'queue',
                        <>
                          Queue
                          {pending.length > 0 && (
                            <span className="count">{pending.length}</span>
                          )}
                        </>,
                      ],
                      ['history', 'History'],
                    ]}
                  />
                  <input
                    className="search-input"
                    type="search"
                    aria-label="Search transactions"
                    placeholder="Search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <TabsContent value="queue" className="panel">
                  {renderProposals()}
                </TabsContent>
                <TabsContent value="history" className="panel">
                  {renderProposals(
                    proposals.filter((p) => p.status !== 'proposed'),
                  )}
                </TabsContent>
              </Tabs>
            )}
            {view === 'Operate' && (
              <Tabs value={segment} onValueChange={(v) => setTab(String(v))}>
                <div className="tab-toolbar">
                  <Segments
                    items={[
                      ['subnet', 'Subnet'],
                      ['validator', 'Validator'],
                    ]}
                  />
                </div>
                <TabsContent value="subnet">
                  <AccountControls
                    key={`owner:${workspace?.id}`}
                    group="owner"
                    accounts={accounts}
                    editable={editable}
                    onSave={save}
                    onCreate={() => open('account')}
                  />
                </TabsContent>
                <TabsContent value="validator">
                  <AccountControls
                    key={`validator:${workspace?.id}`}
                    group="validator"
                    accounts={accounts}
                    editable={editable}
                    onSave={save}
                    onCreate={() => open('account')}
                  />
                  {accounts.length > 0 && (
                    <ValidatorChildren
                      key={workspace?.id}
                      accounts={accounts}
                      editable={editable}
                      onSave={command}
                    />
                  )}
                </TabsContent>
              </Tabs>
            )}
            {view === 'Ownership' && (
              <Tabs value={segment} onValueChange={(v) => setTab(String(v))}>
                <div className="tab-toolbar">
                  <Segments
                    items={[
                      ['cap', 'Cap table'],
                      ['payouts', 'Payouts'],
                      ['crowdloan', 'Crowdloan'],
                    ]}
                  />
                </div>
                <TabsContent value="cap">
                  {agreements.length ? (
                    agreements.map((a) => {
                      const statement = new Map(
                        holderStatement(a.id, distributions).map((r) => [
                          accountKey(r.address),
                          r,
                        ]),
                      );
                      return (
                        <section className="panel agreement" key={a.id}>
                          <div className="panel-title bare">
                            <h3>
                              <span className="subnet-badge">SN{a.netuid}</span>
                              {a.name}
                              <Provenance
                                ok={signedAgreement(a)}
                                signer={a.attestation?.signer}
                                you={user?.id}
                              />
                            </h3>
                            <button
                              className="button outline"
                              onClick={() => open('revision', a.id)}
                              disabled={!editable}
                            >
                              Revise
                            </button>
                          </div>
                          <p className="muted">
                            {accounts.find((ac) => ac.id === a.accountId)?.name}{' '}
                            · {a.revisions.length} revision
                            {a.revisions.length !== 1 ? 's' : ''} · residual
                            owner alpha
                          </p>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Investor</TableHead>
                                <TableHead>Wallet</TableHead>
                                <TableHead>Share</TableHead>
                                <TableHead>Paid α</TableHead>
                                <TableHead>Pending α</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {a.revisions.at(-1)!.owners.map((o) => (
                                <TableRow key={o.address}>
                                  <TableCell>{o.name}</TableCell>
                                  <TableCell>
                                    <Copyable
                                      value={o.address}
                                      network={
                                        accounts.find(
                                          (ac) => ac.id === a.accountId,
                                        )?.network
                                      }
                                      kind="account"
                                      label={`${o.name}'s wallet`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    {(o.bps / 100).toFixed(2)}%
                                  </TableCell>
                                  <TableCell>
                                    {formatUnits(
                                      statement.get(accountKey(o.address))
                                        ?.paid ?? '0',
                                    )}
                                  </TableCell>
                                  <TableCell className="muted">
                                    {formatUnits(
                                      statement.get(accountKey(o.address))
                                        ?.reserved ?? '0',
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <div className="agreement-footer">
                            <button
                              className="text-button"
                              onClick={() => open('distribution', a.id)}
                              disabled={!editable}
                            >
                              Prepare payout <ChevronRight size={15} />
                            </button>
                            <button
                              className="text-button"
                              onClick={() =>
                                download(`${a.name}-statement.json`, {
                                  agreement: a.name,
                                  netuid: a.netuid,
                                  holders: [...statement.values()],
                                  distributions: distributions.filter(
                                    (d) => d.agreementId === a.id,
                                  ),
                                })
                              }
                            >
                              <Download size={14} /> Statement
                            </button>
                            <details className="technical-review">
                              <summary>Revision history</summary>
                              <pre className="code-box">
                                {JSON.stringify(a.revisions, null, 2)}
                              </pre>
                            </details>
                          </div>
                        </section>
                      );
                    })
                  ) : (
                    <section className="panel">
                      <Empty
                        icon={Users}
                        title="Make ownership explicit"
                        text="Record private investor shares, keep every revision, and pay out alpha with an audit trail."
                        action="New agreement"
                        onAction={() => open('agreement')}
                      />
                    </section>
                  )}
                </TabsContent>
                <TabsContent value="payouts">
                  <div className="metrics metric-cards">
                    <div>
                      <span>Agreements</span>
                      <strong>{agreements.length}</strong>
                    </div>
                    <div>
                      <span>Reserved</span>
                      <strong>
                        {
                          distributions.filter((d) => d.status === 'reserved')
                            .length
                        }
                      </strong>
                    </div>
                    <div>
                      <span>Paid</span>
                      <strong>
                        {
                          distributions.filter((d) => d.status === 'paid')
                            .length
                        }
                      </strong>
                    </div>
                  </div>
                  <section className="panel">
                    <div className="panel-title">
                      <h3>Payout ledger</h3>
                      <button
                        className="text-button"
                        onClick={() =>
                          download('distributions-audit.json', {
                            agreements,
                            distributions,
                          })
                        }
                      >
                        <Download size={15} /> Export
                      </button>
                    </div>
                    {distributions.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Agreement / interval</TableHead>
                            <TableHead>Alpha</TableHead>
                            <TableHead>Revenue source</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {distributions.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell>
                                <strong>
                                  {
                                    agreements.find(
                                      (a) => a.id === d.agreementId,
                                    )?.name
                                  }
                                </strong>
                                <small className="table-small">
                                  ({d.fromBlock}, {d.toBlock}]
                                </small>
                              </TableCell>
                              <TableCell>
                                {formatUnits(d.amount, 9)} α
                              </TableCell>
                              <TableCell>
                                <span title={d.source}>
                                  {d.provenance === 'finalized'
                                    ? 'Archive reconstructed'
                                    : 'Declared · reference attached'}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`status ${d.status === 'paid' ? 'success' : ''}`}
                                >
                                  {d.status === 'paid' ? 'Paid' : 'Reserved'}
                                </span>
                              </TableCell>
                              <TableCell>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setSigning(
                                      proposals.find(
                                        (p) => p.id === d.proposalId,
                                      )!,
                                    )
                                  }
                                >
                                  Review <ChevronRight size={15} />
                                </button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <Empty
                        icon={FileText}
                        title="No payouts yet"
                        text="Pick an agreement and a finalized block range. You’ll review every recipient’s exact amount before anything is signed."
                        action="New payout"
                        onAction={() => open('distribution')}
                      />
                    )}
                  </section>
                  <div className="notice spaced">
                    <ShieldCheck size={19} />
                    <span>
                      Allocations conserve every base unit, and a reserved
                      interval can’t be paid twice. Native crowdloan dividends
                      live under Crowdloan.
                    </span>
                  </div>
                </TabsContent>
                <TabsContent value="crowdloan">
                  <NativeCrowdloan />
                </TabsContent>
              </Tabs>
            )}
            {view === 'Contacts' &&
              (workspace?.contacts.length ? (
                <div className="list panel">
                  {workspace.contacts.map((c) => (
                    <div className="signer-row" key={c.address}>
                      <span className="account-avatar">
                        {c.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="row-main">
                        <strong>
                          {c.name}
                          {schemeLabel(c) && (
                            <span className="chip">{schemeLabel(c)}</span>
                          )}
                          <Provenance
                            ok={!!workspace && contactSigned(verifier!, c)}
                            signer={c.attestation?.signer}
                            you={user?.id}
                          />
                        </strong>
                        {c.receiving && (
                          <Copyable
                            value={c.receiving}
                            full
                            label={`${c.name}'s receiving address`}
                          />
                        )}
                        <span className={c.receiving ? 'secondary' : ''}>
                          <Copyable
                            value={c.address}
                            full
                            network="finney"
                            kind="account"
                            label={`${c.name}'s address`}
                          />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <section className="panel">
                  <Empty
                    icon={BookUser}
                    title="Know where funds go"
                    text="Save the investor, validator and team addresses you send to most."
                    action="Add contact"
                    onAction={() => open('contact')}
                  />
                </section>
              ))}
            {view === 'Settings' && (
              <Tabs value={segment} onValueChange={(v) => setTab(String(v))}>
                <div className="tab-toolbar">
                  <Segments
                    items={[
                      ['workspace', 'Workspace'],
                      ['security', 'Security'],
                      ['activity', 'Activity'],
                    ]}
                  />
                </div>
                <TabsContent value="workspace">
                  <Group
                    title="Access"
                    footer="Signing authority stays on-chain. Managers can prepare records; only an account’s signers can move funds. Members also need access to the hosted site."
                    action={
                      <span className="pill role">
                        {workspace?.role ?? 'No workspace'}
                      </span>
                    }
                  >
                    <div className="list">
                      <div className="detail-row">
                        <span>Signed in as</span>
                        {user && (
                          <Copyable value={user.id} label="your address" />
                        )}
                        <button
                          className="text-button"
                          onClick={async () => {
                            await fetch('/api/session', { method: 'DELETE' });
                            location.reload();
                          }}
                        >
                          Sign out
                        </button>
                      </div>
                      {members.map((m) => (
                        <div className="detail-row" key={m.user_id}>
                          <Copyable value={m.user_id} label="member address" />
                          <span>{m.role}</span>
                          {workspace?.role === 'owner' && (
                            <button
                              className="text-button destructive"
                              onClick={async () => {
                                try {
                                  await command({
                                    action: 'removeMember',
                                    userId: m.user_id,
                                  });
                                  await load(workspace.id);
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                      {workspace?.role === 'owner' && (
                        <button
                          className="list-button"
                          onClick={() => open('member')}
                        >
                          <Plus size={17} /> Add member by wallet address
                        </button>
                      )}
                    </div>
                  </Group>
                  <Group title="Data">
                    <div className="list">
                      <button
                        className="list-button"
                        onClick={() =>
                          download('tensor-safe-workspace.json', workspace)
                        }
                      >
                        <Download size={17} /> Export workspace
                      </button>
                      <button
                        className="list-button"
                        onClick={() => {
                          if (workspace) void load(workspace.id);
                        }}
                      >
                        <RefreshCw size={17} /> Refresh audit trail
                      </button>
                    </div>
                  </Group>
                </TabsContent>
                <TabsContent value="security">
                  <div className="notice">
                    <ShieldCheck size={19} />
                    <span>
                      These checks read saved signer settings. Open an account
                      and refresh it to review live proxies and approvals.
                    </span>
                  </div>
                  <div className="security-grid">
                    {accounts.map((a) => (
                      <section className="panel padded" key={a.id}>
                        <div className="panel-title bare">
                          <h3>
                            {a.name}
                            {quantumSafe(a) && <QuantumBadge />}
                          </h3>
                          <ShieldCheck size={20} />
                        </div>
                        <div className="security-check">
                          <Check size={17} />
                          <span>Approvals required</span>
                          <strong>
                            {a.threshold} of {a.signers.length}
                          </strong>
                        </div>
                        <div className="security-check">
                          <span
                            className={
                              a.threshold === a.signers.length
                                ? 'amber-dot'
                                : 'green-dot'
                            }
                          />
                          <span>Can lose without lockout</span>
                          <strong>
                            {a.signers.length - a.threshold} signer
                            {a.signers.length - a.threshold !== 1 ? 's' : ''}
                          </strong>
                        </div>
                        <p className="muted">
                          {a.threshold === a.signers.length
                            ? 'Every signer is required. Losing one key can lock this account.'
                            : 'Keep independent key backups, held by different people.'}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => show(a.id)}
                        >
                          Inspect proxies and deposits{' '}
                          <ChevronRight size={15} />
                        </button>
                      </section>
                    ))}
                  </div>
                  {!accounts.length && (
                    <section className="panel spaced">
                      <Empty
                        icon={ShieldCheck}
                        title="Security starts with signers"
                        text="Add an account to check its approval threshold and how many keys it can lose."
                      />
                    </section>
                  )}
                  <section className="panel padded spaced">
                    <h3>Signing boundaries</h3>
                    <div className="security-check">
                      <Check size={16} />
                      Keys stay in your extension or offline device
                    </div>
                    <div className="security-check">
                      <Check size={16} />
                      Network, runtime, call hash, nonce and mortal era are
                      checked
                    </div>
                    <div className="security-check">
                      <Check size={16} />A finalized approval is distinct from a
                      successful payment
                    </div>
                    <p className="notice-text">
                      Research lab software. Hardware interoperability and
                      real-funds operation require device testing and
                      independent security review.
                    </p>
                  </section>
                </TabsContent>
                <TabsContent value="activity">
                  <section className="panel">
                    <div className="panel-title">
                      <h3>Audit trail</h3>
                      <span className="muted">Latest 200 changes</span>
                    </div>
                    {audit.length ? (
                      <div className="list">
                        {audit.map((e, i) => (
                          <details className="audit-row" key={i}>
                            <summary>
                              <span className="audit-version">
                                v{e.version}
                              </span>
                              <strong>{humanize(e.action)}</strong>
                              <small>
                                {short(e.actor)} ·{' '}
                                {new Date(e.created_at).toLocaleString()}
                              </small>
                            </summary>
                            <pre className="code-box">
                              {JSON.stringify(JSON.parse(e.details), null, 2)}
                            </pre>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <p className="section-copy">
                        Create a workspace to start its audit trail.
                      </p>
                    )}
                  </section>
                </TabsContent>
              </Tabs>
            )}
          </div>
          <footer className="bottom-note">
            <ShieldCheck size={15} /> Non-custodial. Your keys stay with you.
            <span>
              Built for Bittensor <Tau />
            </span>
          </footer>
        </div>
      </SidebarInset>
      {notice && (
        <output className="flash">
          {notice}
          <button aria-label="Dismiss message" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </output>
      )}
      {form && (
        <Forms
          key={form.kind + form.selected}
          kind={form.kind}
          selected={form.selected}
          workspace={workspace}
          onClose={() => setForm(null)}
          onSave={save}
          signer={user?.id}
        />
      )}
      {signing && accounts.find((a) => a.id === signing.accountId) && (
        <Signing
          key={signing.id}
          proposal={
            workspace?.proposals.find((p) => p.id === signing.id) ?? signing
          }
          account={accounts.find((a) => a.id === signing.accountId)!}
          onClose={() => setSigning(null)}
          command={command}
        />
      )}
      <Dialog open={receive} onOpenChange={setReceive}>
        <DialogContent className="flow-dialog">
          <DialogHeader>
            <DialogTitle>Receive</DialogTitle>
            <DialogDescription>
              Check the full address and network before anyone sends funds.
            </DialogDescription>
          </DialogHeader>
          {accounts.map((a) => (
            <div key={a.id} className="receive-item">
              <h3>
                {a.name}
                <span className="chip">
                  {a.network === 'test' ? 'Testnet' : 'Mainnet'}
                </span>
                <Provenance
                  ok={signedAccount(a)}
                  signer={a.attestation?.signer}
                  you={user?.id}
                />
              </h3>
              <div className="address-banner">
                <Copyable
                  value={accountAddress(a)}
                  full
                  network={a.network}
                  kind="account"
                  label="receiving address"
                />
              </div>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
// Sidebar row that also closes the mobile sheet once a destination is picked.
function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => {
          onClick();
          setOpenMobile(false);
        }}
      >
        {children}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
/** Whether a record still matches the wallet signature it was created with. */
function Provenance({
  ok,
  signer,
  you,
}: {
  ok: boolean;
  signer?: string;
  you?: string;
}) {
  return ok ? (
    <span
      className="status success provenance"
      title={`Wallet-signed by ${signer}. Every browser re-checks this signature.`}
    >
      Signed by {signer === you ? 'you' : short(signer!)}
    </span>
  ) : (
    <span
      className="status danger provenance"
      title="No valid wallet signature: this record may have been changed."
    >
      Not wallet-signed
    </span>
  );
}
function QuantumBadge() {
  return (
    <span className="badge-quantum" title="Quantum-ready multisig derivation">
      <Atom size={12} /> Quantum-safe
    </span>
  );
}
function Segments({ items }: { items: [string, ReactNode][] }) {
  return (
    <TabsList className="segments">
      {items.map(([value, label]) => (
        <TabsTrigger key={value} value={value}>
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
function Group({
  title,
  count,
  action,
  footer,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <section className="group">
      <div className="group-title">
        <h2>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {action}
      </div>
      <div className="panel">{children}</div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="button outline" onClick={onAction}>
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  );
}
