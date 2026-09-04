-- Single-row store for the ONE admin passcode credential.
-- Only a salted PBKDF2-SHA256 digest is stored — never the plaintext.
-- Apply with:
--   wrangler d1 execute cgpa-pilot-config --file=worker/migrations/0002_admin_auth.sql

CREATE TABLE IF NOT EXISTS admin_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  passcode_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
