-- Postgres twin of ../migrations/0001_initial.sql.
CREATE TABLE workspaces (
	id text PRIMARY KEY,
	owner text NOT NULL,
	name text NOT NULL,
	version integer NOT NULL DEFAULT 0,
	state text NOT NULL,
	mutation text NOT NULL
);
CREATE INDEX workspaces_owner ON workspaces (owner);

CREATE TABLE members (
	workspace_id text NOT NULL REFERENCES workspaces(id),
	user_id text NOT NULL,
	role text NOT NULL,
	PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX members_user ON members (user_id);

CREATE TABLE audit (
	id text PRIMARY KEY,
	workspace_id text NOT NULL REFERENCES workspaces(id),
	actor text NOT NULL,
	action text NOT NULL,
	version integer NOT NULL,
	created_at text NOT NULL,
	details text NOT NULL
);
CREATE INDEX audit_workspace_version ON audit (workspace_id, version);

CREATE TABLE settlements (
	evidence text PRIMARY KEY,
	workspace_id text NOT NULL REFERENCES workspaces(id),
	proposal_id text NOT NULL
);
