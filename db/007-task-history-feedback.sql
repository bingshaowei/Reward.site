ALTER TABLE tasks ADD COLUMN removed_at timestamptz;

CREATE TABLE task_references (
  task_id text NOT NULL REFERENCES tasks(id),
  reference_id text NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, reference_id),
  CHECK (task_id <> reference_id)
);

CREATE TABLE task_reward_feedback (
  task_id text NOT NULL REFERENCES tasks(id),
  user_id text NOT NULL REFERENCES users(id),
  vote text NOT NULL CHECK (vote IN ('low', 'high')),
  PRIMARY KEY (task_id, user_id)
);
