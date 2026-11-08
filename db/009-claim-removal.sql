ALTER TABLE claims DROP CONSTRAINT claims_status_check;
ALTER TABLE claims ADD CONSTRAINT claims_status_check CHECK (status IN ('working','submitted','revision','accepted','withdrawn','cancelled','removed'));
ALTER TABLE claims ADD COLUMN removed_at timestamptz,
  ADD COLUMN removed_by text REFERENCES users(id),
  ADD COLUMN removal_reason text CHECK (length(btrim(removal_reason)) BETWEEN 1 AND 2000);
ALTER TABLE claims ADD CONSTRAINT claim_removal_metadata CHECK (
  status <> 'removed' OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND removal_reason IS NOT NULL)
);
ALTER TABLE submissions DROP CONSTRAINT submissions_status_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_status_check CHECK (status IN ('pending','approved','revision','voided'));
ALTER TABLE audit_log ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 交付时的参与范围独立保存，后续补招不继承旧团队的成果访问权。
CREATE TABLE submission_members (
  submission_id text NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  claim_id text NOT NULL REFERENCES claims(id),
  PRIMARY KEY (submission_id, claim_id)
);
INSERT INTO submission_members(submission_id,claim_id)
  SELECT s.id,c.id FROM submissions s JOIN claims c ON c.task_id=s.task_id
  WHERE s.claim_id IS NULL AND c.created_at<=s.created_at AND c.submitted_before;
