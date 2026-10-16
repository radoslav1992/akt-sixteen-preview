-- Email verification, password reset and daily alert digests (Cloudflare Email Service).

ALTER TABLE users ADD COLUMN email_verified_at TEXT;
-- Changes in data/changes.json newer than this are still to be sent; set when alerts are switched on.
ALTER TABLE users ADD COLUMN last_alert_at TEXT;
-- Random token for one-click unsubscribe links, created with the first digest.
ALTER TABLE users ADD COLUMN unsubscribe_token TEXT;

CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY, -- sha-256 hex of the token sent by email; the token itself is never stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

CREATE TABLE alert_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('digest', 'test')),
  documents INTEGER NOT NULL,
  message_id TEXT,
  error TEXT
);

CREATE INDEX alert_log_user ON alert_log(user_id, sent_at);

-- SQLite cannot change a CHECK constraint in place: rebuild auth_attempts with the new kinds.
CREATE TABLE auth_attempts_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'register', 'reset', 'verify', 'alert_test')),
  ip TEXT,
  email TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO auth_attempts_new (id, kind, ip, email, created_at) SELECT id, kind, ip, email, created_at FROM auth_attempts;
DROP TABLE auth_attempts;
ALTER TABLE auth_attempts_new RENAME TO auth_attempts;
CREATE INDEX auth_attempts_ip ON auth_attempts(ip, created_at);
CREATE INDEX auth_attempts_email ON auth_attempts(email, created_at);
CREATE INDEX auth_attempts_created_at ON auth_attempts(created_at);
