import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull().default(0),
    state: text('state').notNull(),
    mutation: text('mutation').notNull(),
  },
  (t) => [index('workspaces_owner').on(t.owner)],
);
export const members = sqliteTable(
  'members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['manager', 'viewer'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('members_user').on(t.userId),
  ],
);
export const audit = sqliteTable(
  'audit',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    version: integer('version').notNull(),
    createdAt: text('created_at').notNull(),
    details: text('details').notNull(),
  },
  (t) => [index('audit_workspace_version').on(t.workspaceId, t.version)],
);
export const settlements = sqliteTable('settlements', {
  evidence: text('evidence').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  proposalId: text('proposal_id').notNull(),
});
