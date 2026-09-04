-- CGPA Pilot configuration schema (D1).
-- Apply with:
--   wrangler d1 execute cgpa-pilot-config --file=worker/migrations/0001_init.sql
--
-- Single-row tables (id is pinned to 1) holding the AUTHORITATIVE
-- configuration: the published student document and the full admin catalog.

CREATE TABLE IF NOT EXISTS published_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS admin_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  catalog_json TEXT NOT NULL,
  note TEXT
);
