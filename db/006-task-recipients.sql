ALTER TABLE tasks ADD COLUMN assignment_mode text NOT NULL DEFAULT 'public'
  CHECK (assignment_mode IN ('public', 'recommended', 'assigned'));

CREATE TABLE task_recipients (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  PRIMARY KEY (task_id, user_id)
);
