ALTER TABLE attachments DROP CONSTRAINT attachments_size_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_size_check CHECK (
  size > 0 AND size <= CASE WHEN submission_id IS NULL THEN 104857600 ELSE 20971520 END
);

CREATE TABLE tags (name text PRIMARY KEY);
INSERT INTO tags (name) VALUES ('分析'), ('写代码'), ('湿实验');
CREATE TABLE task_tags (
  task_id text NOT NULL REFERENCES tasks(id),
  tag_name text NOT NULL REFERENCES tags(name),
  PRIMARY KEY (task_id, tag_name)
);
