PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analytics_users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  chat_available INTEGER NOT NULL DEFAULT 1,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  consent_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  telegram_update_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  section TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY(user_id) REFERENCES analytics_users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_date ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_date ON analytics_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_admin_sessions (
  admin_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by TEXT NOT NULL,
  audience TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS analytics_campaign_recipients (
  campaign_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  error_code TEXT,
  sent_at TEXT,
  PRIMARY KEY(campaign_id, user_id),
  FOREIGN KEY(campaign_id) REFERENCES analytics_campaigns(id),
  FOREIGN KEY(user_id) REFERENCES analytics_users(user_id)
);
