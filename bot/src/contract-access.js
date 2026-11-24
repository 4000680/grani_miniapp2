const initialized = new WeakMap();
const validId = value => /^[1-9]\d{0,15}$/.test(String(value || ''));

async function schema(db) {
  if (!initialized.has(db)) {
    initialized.set(db, db.prepare(`CREATE TABLE IF NOT EXISTS contract_access (
      user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
    )`).run().catch(error => { initialized.delete(db); throw error; }));
  }
  return initialized.get(db);
}

export async function hasContractAccess(env, userId) {
  if (!validId(userId) || !env.ANALYTICS_DB) return false;
  try {
    await schema(env.ANALYTICS_DB);
    const row = await env.ANALYTICS_DB.prepare('SELECT enabled FROM contract_access WHERE user_id=?').bind(String(userId)).first();
    return row ? row.enabled === 1 : String(userId) === String(env.ADMIN_ID || env.ADMIN_TELEGRAM_ID || '');
  } catch { return false; }
}

export async function setContractAccess(env, actorId, userId, enabled) {
  const adminId = String(env.ADMIN_ID || env.ADMIN_TELEGRAM_ID || '');
  if (!adminId || String(actorId) !== adminId) throw new Error('Нет доступа');
  if (!validId(userId) || typeof enabled !== 'boolean') throw new Error('Некорректные параметры доступа');
  if (!env.ANALYTICS_DB) throw new Error('База доступа недоступна');
  await schema(env.ANALYTICS_DB);
  await env.ANALYTICS_DB.prepare(`INSERT INTO contract_access(user_id,enabled,updated_by,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(String(userId), enabled ? 1 : 0, adminId, new Date().toISOString()).run();
}
