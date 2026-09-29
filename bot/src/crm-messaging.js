const schema = [
  `CREATE TABLE IF NOT EXISTS crm_messages (
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
  )`,
  'CREATE INDEX IF NOT EXISTS idx_crm_user_messages ON crm_messages(user_id,id DESC)',
  `CREATE TABLE IF NOT EXISTS analytics_delivery_locks (
    name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`
];
const initialized = new WeakMap();

export async function ensureMessagingSchema(db) {
  if (!initialized.has(db)) {
    const ready = (async () => {
      for (const sql of schema) await db.prepare(sql).run();
    })().catch(error => { initialized.delete(db); throw error; });
    initialized.set(db, ready);
  }
  return initialized.get(db);
}

export async function acquireDeliveryLock(db) {
  await ensureMessagingSchema(db);
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await db.prepare(`INSERT INTO analytics_delivery_locks(name,token,expires_at) VALUES('campaign',?,?)
    ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
    WHERE analytics_delivery_locks.expires_at < ?`).bind(token, now + 300000, now).run();
  return result.meta?.changes ? token : null;
}

export async function releaseDeliveryLock(db, token) {
  await db.prepare("DELETE FROM analytics_delivery_locks WHERE name='campaign' AND token=?").bind(token).run();
}

export async function takeAdminSession(db, adminId, expectedStep, expectedNonce) {
  const row = await db.prepare('SELECT state_json FROM analytics_admin_sessions WHERE admin_id=?').bind(String(adminId)).first();
  if (!row) return null;
  const session = JSON.parse(row.state_json);
  if (session.step !== expectedStep || session.nonce !== expectedNonce) return null;
  const result = await db.prepare('DELETE FROM analytics_admin_sessions WHERE admin_id=? AND state_json=?')
    .bind(String(adminId), row.state_json).run();
  return result.meta?.changes ? session : null;
}

export async function recordOutgoingMessage(db, userId, text, sent, { replyToId = null, campaignId = null } = {}) {
  if (!sent?.message_id) return null;
  await ensureMessagingSchema(db);
  await db.prepare(`INSERT OR IGNORE INTO crm_messages
    (user_id,direction,message_text,telegram_message_id,reply_to_id,campaign_id,created_at)
    VALUES(?,'out',?,?,?,?,?)`)
    .bind(String(userId), text, sent.message_id, replyToId, campaignId, new Date().toISOString()).run();
  return db.prepare("SELECT * FROM crm_messages WHERE user_id=? AND direction='out' AND telegram_message_id=?")
    .bind(String(userId), sent.message_id).first();
}

export async function sendDirectMessage(db, userId, text, send, replyToId = null) {
  await ensureMessagingSchema(db);
  const user = await db.prepare('SELECT * FROM analytics_users WHERE user_id=?').bind(String(userId)).first();
  if (!user) throw new Error('CRM_USER_NOT_FOUND');
  let parent = null;
  if (replyToId) {
    parent = await db.prepare('SELECT * FROM crm_messages WHERE id=? AND user_id=?').bind(replyToId, String(userId)).first();
    if (!parent) throw new Error('CRM_REPLY_NOT_FOUND');
  }
  try {
    const sent = await send(String(userId), text, parent?.telegram_message_id || null);
    return await recordOutgoingMessage(db, userId, text, sent, { replyToId: parent?.id || null });
  } catch (error) {
    if (Number(error.telegramCode) === 403) await db.prepare('UPDATE analytics_users SET chat_available=0 WHERE user_id=?').bind(String(userId)).run();
    throw error;
  }
}

export async function receiveCrmReply(db, message, notify) {
  if (!db || message.chat?.type !== 'private' || !message.from?.id || !message.reply_to_message?.message_id) return false;
  if (String(message.text || '').startsWith('/')) return false;
  await ensureMessagingSchema(db);
  const userId = String(message.from.id);
  const parent = await db.prepare('SELECT * FROM crm_messages WHERE user_id=? AND telegram_message_id=? ORDER BY id DESC LIMIT 1')
    .bind(userId, message.reply_to_message.message_id).first();
  if (!parent) return false;
  const text = message.text || message.caption || (message.document ? `[Документ: ${message.document.file_name || 'файл'}]`
    : message.photo ? '[Фото]' : message.voice ? '[Голосовое сообщение]' : '[Сообщение с вложением]');
  const result = await db.prepare(`INSERT OR IGNORE INTO crm_messages
    (user_id,direction,message_text,telegram_message_id,reply_to_id,created_at) VALUES(?,'in',?,?,?,?)`)
    .bind(userId, text, message.message_id, parent.id, new Date().toISOString()).run();
  const incoming = await db.prepare("SELECT * FROM crm_messages WHERE user_id=? AND direction='in' AND telegram_message_id=?")
    .bind(userId, message.message_id).first();
  if (result.meta?.changes || !incoming.admin_notification_id) {
    try {
      const notification = await notify(incoming, parent, message);
      if (notification?.message_id) await db.prepare('UPDATE crm_messages SET admin_notification_id=? WHERE id=?')
        .bind(notification.message_id, incoming.id).run();
    } catch (error) {
      // A saved CRM reply must never become a vehicle/document query when notification fails.
      console.error('CRM admin notification failed', incoming.id, error);
    }
  }
  return true;
}

export async function listCrmMessages(db, userId, offset = 0) {
  await ensureMessagingSchema(db);
  return db.prepare(`SELECT m.*,p.message_text parent_text FROM crm_messages m
    LEFT JOIN crm_messages p ON p.id=m.reply_to_id WHERE m.user_id=? ORDER BY m.id DESC LIMIT 2 OFFSET ?`)
    .bind(String(userId), Math.max(0, Number(offset) || 0)).all();
}

export async function getCrmMessage(db, userId, messageId) {
  await ensureMessagingSchema(db);
  return db.prepare('SELECT * FROM crm_messages WHERE id=? AND user_id=?')
    .bind(messageId, String(userId)).first();
}
