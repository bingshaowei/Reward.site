ALTER TABLE tasks ADD COLUMN publication_status text NOT NULL DEFAULT 'approved'
  CHECK (publication_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE tasks ADD COLUMN publication_note text;
ALTER TABLE tasks ADD COLUMN publication_version integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN removed_at timestamptz;
