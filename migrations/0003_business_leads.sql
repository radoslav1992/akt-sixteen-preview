-- Interest form on /business/ ("За бизнеса"): who would use a paid business plan and what for.
-- Nothing is sold yet; the rows are only used to contact people about the plan.

CREATE TABLE business_leads (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE, -- a repeat submission updates the row
  company TEXT,
  business_type TEXT NOT NULL, -- one of BUSINESS_TYPES in src/lib/leads.ts (validated there, so options can change)
  interests TEXT NOT NULL DEFAULT '', -- comma-separated ids from LEAD_INTERESTS
  districts TEXT,
  price_range TEXT NOT NULL, -- one of PRICE_RANGES
  consent_at TEXT NOT NULL, -- when the privacy checkbox was last ticked
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL -- rows are deleted 12 months after this (purgeOldLeads)
);

CREATE INDEX business_leads_updated_at ON business_leads(updated_at);

-- Rate limiting for the form reuses auth_attempts with a new kind.
-- SQLite cannot change a CHECK constraint in place: rebuild the table (as in 0002).
CREATE TABLE auth_attempts_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'register', 'reset', 'verify', 'alert_test', 'lead')),
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
