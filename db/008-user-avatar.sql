ALTER TABLE users ADD COLUMN avatar_data bytea,
  ADD COLUMN avatar_type text,
  ADD COLUMN avatar_version uuid;
ALTER TABLE users ADD CONSTRAINT user_avatar_size CHECK (octet_length(avatar_data) <= 524288);
