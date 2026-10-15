CREATE TABLE deletion_tombstones (
  installation_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX deletion_expiry ON deletion_tombstones(expires_at);
