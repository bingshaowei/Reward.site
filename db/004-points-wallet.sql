CREATE TABLE wallet_ledger (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  event_key text NOT NULL,
  kind text NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0),
  task_id text REFERENCES tasks(id),
  effective_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);
CREATE INDEX wallet_ledger_user_date ON wallet_ledger(user_id, effective_at, id);
ALTER TABLE tasks ADD COLUMN points_reserved bigint NOT NULL DEFAULT 0 CHECK (points_reserved >= 0);
ALTER TABLE claims ADD COLUMN overdue_days_charged integer NOT NULL DEFAULT 0;

INSERT INTO wallet_ledger(user_id,event_key,kind,amount)
SELECT user_id,'legacy','legacy',sum(units) FROM rewards
WHERE reward_type='points' GROUP BY user_id HAVING sum(units)>0;
