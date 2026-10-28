-- Wallet sign-in: one-time challenges and hashed session tokens.
CREATE TABLE `challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`message` text NOT NULL,
	`expires` integer NOT NULL
);

CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`expires` integer NOT NULL
);

CREATE INDEX `sessions_expires` ON `sessions` (`expires`);

-- Nonces of wallet-signed workspace changes, kept until expiry to block replay.
CREATE TABLE `signed_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
