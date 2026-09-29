CREATE TABLE IF NOT EXISTS crm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_text TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  reply_to_id INTEGER,
  campaign_id INTEGER,
  admin_notification_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(user_id,direction,telegram_message_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_user_messages ON crm_messages(user_id,id DESC);
CREATE TABLE IF NOT EXISTS analytics_delivery_locks (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
