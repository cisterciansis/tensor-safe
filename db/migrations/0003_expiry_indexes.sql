-- Expiry purges and per-address challenge caps stay index-backed.
CREATE INDEX `challenges_expires` ON `challenges` (`expires`);
CREATE INDEX `challenges_address` ON `challenges` (`address`);
CREATE INDEX `signed_nonces_expires` ON `signed_nonces` (`expires`);
