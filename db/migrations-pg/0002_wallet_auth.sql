-- Postgres twin of ../migrations/0002_wallet_auth.sql. Times are epoch ms.
CREATE TABLE challenges (
	nonce text PRIMARY KEY,
	address text NOT NULL,
	message text NOT NULL,
	expires bigint NOT NULL
);

CREATE TABLE sessions (
	token_hash text PRIMARY KEY,
	address text NOT NULL,
	expires bigint NOT NULL
);
CREATE INDEX sessions_expires ON sessions (expires);

CREATE TABLE signed_nonces (
	nonce text PRIMARY KEY,
	expires bigint NOT NULL
);
