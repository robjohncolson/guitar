-- Guitar Trainer accounts: private schema in the shared curriculum_renderer project.
-- Run as postgres AFTER the operator-only role step (db/000_guitar_app_role.md).
-- Not exposed through PostgREST/the Data API: no grants to anon, authenticated or service_role.
CREATE SCHEMA guitar AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA guitar FROM PUBLIC;

CREATE TABLE guitar.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_-]{3,32}$'),
  password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 20 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz
);

CREATE TABLE guitar.sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES guitar.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON guitar.sessions (user_id);
CREATE INDEX sessions_expires_idx ON guitar.sessions (expires_at);

CREATE TABLE guitar.progress (
  user_id uuid NOT NULL REFERENCES guitar.users(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key IN ('guitar.trainer.v1', 'guitar.practice.v1', 'piece.trainer.v1')),
  value jsonb NOT NULL CHECK (octet_length(value::text) <= 524288),
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE guitar.imported_pieces (
  user_id uuid NOT NULL REFERENCES guitar.users(id) ON DELETE CASCADE,
  piece_id text NOT NULL CHECK (piece_id ~ '^mine:[A-Za-z0-9_-]{0,60}$'),
  text text NOT NULL CHECK (octet_length(text) <= 2097152),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, piece_id)
);

CREATE TABLE guitar.auth_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL CHECK (length(bucket) <= 120),
  action text NOT NULL CHECK (action IN ('signin', 'signup', 'delete')),
  success boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_attempts_bucket_idx ON guitar.auth_attempts (bucket, action, at);
CREATE INDEX auth_attempts_at_idx ON guitar.auth_attempts (at);

-- Row-level security. Auth tables are used by the server for lookups across users;
-- progress and pieces are additionally isolated in the database: every API request
-- sets guitar.user_id for its transaction, and rows of other users are invisible.
ALTER TABLE guitar.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE guitar.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE guitar.progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE guitar.imported_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE guitar.auth_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY guitar_app_users ON guitar.users TO guitar_app USING (true) WITH CHECK (true);
CREATE POLICY guitar_app_sessions ON guitar.sessions TO guitar_app USING (true) WITH CHECK (true);
CREATE POLICY guitar_app_attempts ON guitar.auth_attempts TO guitar_app USING (true) WITH CHECK (true);
CREATE POLICY owner_progress ON guitar.progress TO guitar_app
  USING (user_id = nullif(current_setting('guitar.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('guitar.user_id', true), '')::uuid);
CREATE POLICY owner_pieces ON guitar.imported_pieces TO guitar_app
  USING (user_id = nullif(current_setting('guitar.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('guitar.user_id', true), '')::uuid);

REVOKE ALL ON ALL TABLES IN SCHEMA guitar FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA guitar FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA guitar TO guitar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON guitar.users, guitar.sessions, guitar.progress, guitar.imported_pieces TO guitar_app;
GRANT SELECT, INSERT, DELETE ON guitar.auth_attempts TO guitar_app;
