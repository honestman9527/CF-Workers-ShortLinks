CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY NOT NULL,
  target_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_links_expires_at ON links (expires_at);
CREATE INDEX IF NOT EXISTS idx_links_created_at_code ON links (created_at DESC, code DESC);
