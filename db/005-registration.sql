CREATE TABLE registration_requests (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
