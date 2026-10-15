CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  analytics INTEGER NOT NULL CHECK(analytics IN (0,1)),
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE consent_records (
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  analytics INTEGER NOT NULL,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(installation_id, revision)
);
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  feature TEXT,
  error_code TEXT,
  duration_minutes INTEGER,
  received_at TEXT NOT NULL
);
CREATE INDEX usage_day ON usage_events(day);
CREATE INDEX usage_installation ON usage_events(installation_id);
