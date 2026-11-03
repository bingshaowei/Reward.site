CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
 active boolean NOT NULL DEFAULT true, must_change_password boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1, started_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id text PRIMARY KEY, publisher_id text NOT NULL REFERENCES users(id), title text NOT NULL,
 description text NOT NULL, criteria text NOT NULL, mode text NOT NULL CHECK(mode IN ('independent','team')),
 reward_type text NOT NULL CHECK(reward_type IN ('money','points')),
 reward_units integer NOT NULL CHECK(reward_units > 0), capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
 deadline timestamptz, first_claimed_at timestamptz, team_locked boolean NOT NULL DEFAULT false,
 ended_at timestamptz, is_demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS claims (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), user_id text NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'working' CHECK(status IN ('working','submitted','revision','accepted','withdrawn','cancelled')),
 submitted_before boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,user_id)
);
CREATE TABLE IF NOT EXISTS submissions (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), claim_id text REFERENCES claims(id),
 submitter_id text NOT NULL REFERENCES users(id), content text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revision')),
 review_note text, reviewer_id text REFERENCES users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_team ON submissions(task_id) WHERE claim_id IS NULL AND status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_claim ON submissions(claim_id) WHERE claim_id IS NOT NULL AND status='pending';
CREATE TABLE IF NOT EXISTS rewards (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), claim_id text NOT NULL UNIQUE REFERENCES claims(id),
 user_id text NOT NULL REFERENCES users(id), reward_type text NOT NULL CHECK(reward_type IN ('money','points')),
 units integer NOT NULL CHECK(units >= 0), paid_at timestamptz, paid_by text REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rewards_user ON rewards(user_id);
CREATE TABLE IF NOT EXISTS attachments (
 id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), submission_id text REFERENCES submissions(id),
 owner_id text NOT NULL REFERENCES users(id), name text NOT NULL, storage_name text NOT NULL UNIQUE,
 size integer NOT NULL CHECK(size > 0 AND size <= 20971520), mime text NOT NULL,
 expired_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_task ON attachments(task_id);
CREATE TABLE IF NOT EXISTS audit_log (
 id bigserial PRIMARY KEY, actor_id text REFERENCES users(id), action text NOT NULL,
 target_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
