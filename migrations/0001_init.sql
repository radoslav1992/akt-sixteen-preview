-- User accounts, sessions and the per-user watchlist.
-- Timestamps are ISO 8601 UTC strings (new Date().toISOString()), so they sort as text.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- ids of deleted accounts are never reused
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  email_alerts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, -- sha-256 hex of the cookie token; the token itself is never stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX sessions_user_id ON sessions(user_id);
CREATE INDEX sessions_expires_at ON sessions(expires_at);

CREATE TABLE watchlist (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('record', 'parcel', 'company', 'region', 'neighborhood', 'search')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE (user_id, kind, key)
);

-- Rate limiting: failed logins ('login') and registration attempts ('register').
CREATE TABLE auth_attempts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'register')),
  ip TEXT,
  email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX auth_attempts_ip ON auth_attempts(ip, created_at);
CREATE INDEX auth_attempts_email ON auth_attempts(email, created_at);
CREATE INDEX auth_attempts_created_at ON auth_attempts(created_at);
